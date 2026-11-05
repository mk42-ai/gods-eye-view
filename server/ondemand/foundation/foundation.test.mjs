/**
 * Foundation unit tests — mocked fetch, no network. Run with
 * `npm run test:ondemand` (server/ondemand/*.test.mjs glob also picks this
 * directory up through test:foundation).
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { __reloadConfigForTests } from '../config.js';
import {
  makeReq,
  makeRes,
  jsonResponse,
  sseResponse,
} from '../test-helpers.mjs';
import {
  createOnDemandClient,
  OnDemandHttpError,
  OnDemandNotConfiguredError,
  OnDemandAbortError,
  parseSseBlock,
  parseSse,
  redact,
} from './client.js';
import {
  validateSubmitQuery,
  validateCreateSession,
  ValidationError,
} from './types.js';
import {
  defineContract,
  validateInputs,
  createContractRegistry,
  COMMON_ERRORS,
  ContractError,
} from './plugin-contract.js';
import { contractRegistry } from './contracts.js';
import {
  createConversationStore,
  objectContextKey,
  __resetConversationStoreForTests,
} from './conversation-store.js';
import { createFoundationHandler, contextPrompt } from './proxy-route.js';
import { resolveRequestKey, clientKeyAllowed } from '../client.js';

const SERVER_KEY = 'server-key-test-0123456789abcdef';
const SID = '6ad7ddc47bb80aa7c2d9757f';
let savedEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  delete process.env.ONDEMAND_ALLOW_CLIENT_KEY;
  process.env.ONDEMAND_API_KEY = SERVER_KEY;
  process.env.ONDEMAND_REQUEST_TIMEOUT_MS = '2000';
  __reloadConfigForTests();
  __resetConversationStoreForTests();
});
afterEach(() => {
  process.env = savedEnv;
  __reloadConfigForTests();
});

function recordingFetch(responses) {
  const calls = [];
  let i = 0;
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return typeof next === 'function' ? next(url, init) : next;
  };
  fn.calls = calls;
  return fn;
}

describe('types', () => {
  test('validateSubmitQuery enforces required fields, enum, plugin ids', () => {
    assert.throws(() => validateSubmitQuery({}), ValidationError);
    assert.throws(
      () =>
        validateSubmitQuery({
          query: 'q',
          endpointId: 'e',
          responseMode: 'bogus',
        }),
      /responseMode/,
    );
    assert.throws(
      () =>
        validateSubmitQuery({
          query: 'q',
          endpointId: 'e',
          responseMode: 'sync',
          pluginIds: ['nope'],
        }),
      /plugin id/,
    );
    const ok = validateSubmitQuery({
      query: 'q',
      endpointId: 'e',
      responseMode: 'stream',
      pluginIds: ['plugin-1713924030', 'plugin-1713924030'],
      reasoningEffort: 'low',
    });
    assert.deepEqual(ok.pluginIds, ['plugin-1713924030']);
  });
  test('validateCreateSession caps plugin ids at 20', () => {
    const ids = Array.from(
      { length: 21 },
      (_, i) => `plugin-17${String(i).padStart(8, '0')}`,
    );
    assert.throws(
      () => validateCreateSession({ externalUserId: 'u', pluginIds: ids }),
      /at most 20/,
    );
  });
});

describe('client', () => {
  test('throws OnDemandNotConfiguredError lazily when no server key', async () => {
    delete process.env.ONDEMAND_API_KEY;
    __reloadConfigForTests();
    const c = createOnDemandClient({
      fetchImpl: recordingFetch([jsonResponse(200, {})]),
    });
    await assert.rejects(() => c.sessions.list(), OnDemandNotConfiguredError);
  });
  test('sends apikey header from server config, JSON body, and never leaks the key in errors/logs', async () => {
    const lines = [];
    const f = recordingFetch([
      jsonResponse(201, { data: { id: SID, externalUserId: 'u1' } }),
    ]);
    const c = createOnDemandClient({ fetchImpl: f, log: (l) => lines.push(l) });
    const s = await c.sessions.create({
      externalUserId: 'u1',
      pluginIds: ['plugin-1713924030'],
    });
    assert.equal(s.id, SID);
    assert.equal(f.calls[0].init.headers.apikey, SERVER_KEY);
    assert.equal(f.calls[0].init.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(f.calls[0].init.body), {
      externalUserId: 'u1',
      pluginIds: ['plugin-1713924030'],
    });
    assert.ok(lines.every((l) => !l.includes(SERVER_KEY)));
  });
  test('retries on 429 honouring Retry-After, then succeeds', async () => {
    const f = recordingFetch([
      jsonResponse(429, { message: 'slow down' }, { 'retry-after': '0' }),
      jsonResponse(200, { data: [], pagination: null }),
    ]);
    const c = createOnDemandClient({
      fetchImpl: f,
      retry: { retries: 2, baseDelayMs: 1, maxDelayMs: 2 },
    });
    const out = await c.sessions.list({ externalUserId: 'u1' });
    assert.equal(f.calls.length, 2);
    assert.deepEqual(out.data, []);
  });
  test('gives up after retries with OnDemandHttpError carrying a redacted envelope', async () => {
    const f = recordingFetch([
      jsonResponse(503, { message: `boom ${SERVER_KEY}` }),
    ]);
    const c = createOnDemandClient({
      fetchImpl: f,
      retry: { retries: 1, baseDelayMs: 1, maxDelayMs: 1 },
    });
    await assert.rejects(
      () => c.sessions.list(),
      (err) => {
        assert.ok(err instanceof OnDemandHttpError);
        assert.equal(err.status, 503);
        assert.equal(JSON.stringify(err.upstream).includes(SERVER_KEY), false);
        return true;
      },
    );
    assert.equal(f.calls.length, 2);
  });
  test('does not retry 4xx client errors', async () => {
    const f = recordingFetch([jsonResponse(400, { message: 'bad' })]);
    const c = createOnDemandClient({
      fetchImpl: f,
      retry: { retries: 3, baseDelayMs: 1, maxDelayMs: 1 },
    });
    await assert.rejects(() => c.sessions.get(SID), /ondemand_http_400/);
    assert.equal(f.calls.length, 1);
  });
  test('timeout surfaces as OnDemandAbortError(timeout)', async () => {
    const f = recordingFetch([
      (url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    ]);
    const c = createOnDemandClient({
      fetchImpl: f,
      timeoutMs: 20,
      retry: { retries: 0 },
    });
    await assert.rejects(
      () => c.sessions.list(),
      (e) => e instanceof OnDemandAbortError && e.reason === 'timeout',
    );
  });
  test('caller abort propagates to upstream fetch', async () => {
    const ctrl = new AbortController();
    let upstreamAborted = false;
    const f = recordingFetch([
      (url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => {
            upstreamAborted = true;
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }),
    ]);
    const c = createOnDemandClient({
      fetchImpl: f,
      timeoutMs: 5000,
      retry: { retries: 0 },
    });
    const p = c.sessions.list({}, { signal: ctrl.signal });
    ctrl.abort();
    await assert.rejects(
      p,
      (e) => e instanceof OnDemandAbortError && e.reason === 'aborted',
    );
    assert.equal(upstreamAborted, true);
  });
  test('stream: parses the real wire format (message deltas, metricsLog, heartbeat, [DONE])', async () => {
    const chunks = [
      `event:message\ndata:{"sessionId":"${SID}","messageId":"m","status":"processing","eventIndex":1,"answer":"Hi","eventType":"fulfillment"}\n\n`,
      `event:message\ndata:{"sessionId":"${SID}","messageId":"m","status":"processing","eventIndex":2,"answer":" there","eventType":"fulfillment"}\n\nevent:message\ndata:{"eventType":"metricsLog","publicMetrics":{"totalTokens":5}}\n\n`,
      `event:heartbeat\ndata:{"time":"t"}\n\n: keepalive\n\nevent:message\ndata:[DONE]\n\n`,
    ];
    const f = recordingFetch([sseResponse(200, chunks)]);
    const c = createOnDemandClient({ fetchImpl: f });
    const { events } = await c.query.stream(SID, {
      query: 'hi',
      endpointId: 'predefined-gpt-6-luna',
      fulfillmentOnly: true,
    });
    const got = [];
    for await (const e of events) got.push(e);
    assert.deepEqual(
      got.map((e) => e.event),
      ['message', 'message', 'message', 'heartbeat', 'done'],
    );
    assert.equal(got[0].answer + got[1].answer, 'Hi there');
    assert.equal(got[4].data, '[DONE]');
    assert.equal(f.calls[0].init.headers.accept, 'text/event-stream');
  });
  test('parseSseBlock ignores comments and handles multi-line data', () => {
    assert.equal(parseSseBlock(': keepalive'), null);
    assert.deepEqual(parseSseBlock('data: a\ndata: b'), {
      event: 'message',
      data: 'a\nb',
    });
  });
  test('redact strips the key and long tokens', () => {
    assert.equal(
      redact(`x ${SERVER_KEY} y ${'a'.repeat(50)}`, SERVER_KEY),
      'x <redacted> y <redacted-long-token>',
    );
  });
  test('workflows.follow polls to a terminal state and yields new logs only', async () => {
    const EX = '6ad7de5b5e60695bc4d05253';
    let n = 0;
    const f = recordingFetch([
      (url) => {
        if (url.endsWith('/logs'))
          return jsonResponse(200, {
            data: [
              { nodeKey: 'a', message: 'one' },
              { nodeKey: 'b', message: 'two' },
            ].slice(0, n),
          });
        n += 1;
        return jsonResponse(200, {
          data: { id: EX, status: n >= 2 ? 'success' : 'executing' },
        });
      },
    ]);
    const c = createOnDemandClient({ fetchImpl: f });
    const snaps = [];
    for await (const s of c.workflows.follow(EX, { intervalMs: 1 }))
      snaps.push(s);
    assert.equal(snaps.at(-1).terminal, true);
    assert.equal(
      snaps.reduce((a, s) => a + s.newLogs.length, 0),
      2,
    );
  });
});

describe('plugin contract', () => {
  test('defineContract rejects malformed contracts and freezes good ones', () => {
    assert.throws(() => defineContract({ name: 'bad name' }), ContractError);
    const c = defineContract({
      name: 'demo_tool',
      description: 'a demo tool for tests',
      kind: 'ondemand-tool',
      toolRoute: '/api/tools/demo',
      inputs: {
        q: { type: 'string', required: true },
        n: { type: 'integer', minimum: 1, maximum: 3 },
      },
      outputs: { ok: { type: 'boolean' } },
      errorStates: COMMON_ERRORS,
      provenance: {
        provider: 'x',
        kind: 'ondemand-tool',
        citationsRequired: false,
      },
      paginated: false,
      streaming: false,
      availability: 'active',
    });
    assert.ok(Object.isFrozen(c));
    assert.deepEqual(validateInputs(c, { q: 'hi', n: 2, extra: 1 }), {
      q: 'hi',
      n: 2,
    });
    assert.throws(() => validateInputs(c, { n: 2 }), /required/);
    assert.throws(() => validateInputs(c, { q: 'x', n: 9 }), /> 3/);
  });
  test('registry refuses duplicates and lists only active plugin ids', () => {
    const r = createContractRegistry();
    // 11 plugins + 1 hand-written tool + 20 registry-derived tools + 1 workflow (2026-10-21)
    assert.equal(contractRegistry.size(), 33);
    assert.equal(contractRegistry.list({ kind: 'ondemand-tool' }).length, 21);
    const active = contractRegistry.activePluginIds();
    assert.equal(active.length, 10);
    assert.equal(
      active.includes('plugin-1785777296'),
      false,
      'X MCP is inactive',
    );
    assert.throws(
      () => contractRegistry.register(contractRegistry.get('reddit_posts')),
      /duplicate/,
    );
    assert.equal(r.size(), 0);
  });
});

describe('conversation store', () => {
  test('isolates sessions per externalUserId + objectContext and survives KV failure', async () => {
    const failingKv = {
      async get() {
        throw new Error('kv down');
      },
      async set() {
        throw new Error('kv down');
      },
    };
    const warns = [];
    const s = createConversationStore({
      kv: failingKv,
      warn: (m) => warns.push(m),
    });
    assert.equal(s.backend, 'kv+memory');
    await s.put(
      'u1',
      { objectType: 'aircraft', objectId: 'A1' },
      { sessionId: 's-a' },
    );
    await s.put(
      'u1',
      { objectType: 'camera', objectId: 'C1' },
      { sessionId: 's-c' },
    );
    await s.put(
      'u2',
      { objectType: 'aircraft', objectId: 'A1' },
      { sessionId: 's-u2' },
    );
    assert.equal((await s.get('u1', 'aircraft:A1')).sessionId, 's-a');
    assert.equal((await s.get('u2', 'aircraft:A1')).sessionId, 's-u2');
    assert.equal((await s.listByUser('u1')).length, 2);
    await s.touch('u1', 'aircraft:A1');
    assert.equal((await s.get('u1', 'aircraft:A1')).turns, 1);
    await s.close('u1', 'aircraft:A1');
    assert.equal(await s.get('u1', 'aircraft:A1'), undefined);
    assert.ok(warns.length > 0);
  });
  test('objectContextKey sanitises', () => {
    assert.equal(
      objectContextKey({ objectType: 'cam', objectId: 'x y' }),
      'cam:x_y',
    );
    assert.equal(objectContextKey(undefined), 'global');
  });
});

describe('proxy route (/api/ondemand/v2)', () => {
  test('legacy override is OFF by default: x-ondemand-key is ignored', () => {
    assert.equal(clientKeyAllowed(), false);
    assert.deepEqual(
      resolveRequestKey(
        makeReq({ headers: { 'x-ondemand-key': 'user-key-zzz' } }),
      ),
      { apiKeyOverride: undefined, source: 'server', rejected: false },
    );
  });
  test('health + contracts', async () => {
    const h = createFoundationHandler({
      client: createOnDemandClient({ fetchImpl: recordingFetch([]) }),
      store: createConversationStore({ backend: 'memory' }),
    });
    let res = makeRes();
    await h(
      makeReq({ method: 'GET', url: '/health', headers: { host: 'h' } }),
      res,
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().keySource, 'env:persistent');
    assert.equal(res.json().keyHolder, 'server');
    assert.equal(res.json().keyEnvName, 'ONDEMAND_API_KEY');
    assert.equal(res.json().configured, true);
    assert.ok(!JSON.stringify(res.json()).includes(SERVER_KEY));
    assert.equal(res.getHeader('x-ondemand-key-source'), 'server');
    res = makeRes();
    await h(
      makeReq({ method: 'GET', url: '/contracts', headers: { host: 'h' } }),
      res,
    );
    assert.equal(res.json().contracts.length, 33);
  });
  test('chat sync: creates a session keyed by object context, grounds the prompt, reuses on second call; client key header ignored', async () => {
    const f = recordingFetch([
      jsonResponse(201, { data: { id: SID } }),
      jsonResponse(200, {
        data: {
          sessionId: SID,
          messageId: 'm1',
          answer: 'A1',
          status: 'completed',
        },
      }),
      jsonResponse(200, {
        data: {
          sessionId: SID,
          messageId: 'm2',
          answer: 'A2',
          status: 'completed',
        },
      }),
    ]);
    const store = createConversationStore({ backend: 'memory' });
    const h = createFoundationHandler({
      client: createOnDemandClient({ fetchImpl: f }),
      store,
    });
    const body = {
      externalUserId: 'u1',
      objectContext: { objectType: 'aircraft', objectId: 'A1', label: 'EK203' },
      query: 'where is it?',
      responseMode: 'sync',
      endpointId: 'predefined-gpt-6-luna',
    };
    let res = makeRes();
    await h(
      makeReq({
        method: 'POST',
        url: '/chat',
        headers: { host: 'h', 'x-ondemand-key': 'user-key-must-not-be-used' },
        body,
      }),
      res,
    );
    assert.equal(res.statusCode, 200, res.text());
    assert.equal(res.json().answer, 'A1');
    assert.equal(res.json().reused, false);
    assert.equal(f.calls[0].init.headers.apikey, SERVER_KEY);
    assert.equal(f.calls[1].init.headers.apikey, SERVER_KEY);
    const sent = JSON.parse(f.calls[1].init.body);
    assert.ok(sent.modelConfigs.fulfillmentPrompt.includes('EK203'));
    assert.equal(sent.fulfillmentOnly, true);
    res = makeRes();
    await h(
      makeReq({ method: 'POST', url: '/chat', headers: { host: 'h' }, body }),
      res,
    );
    assert.equal(res.json().reused, true);
    assert.equal(f.calls.length, 3, 'no second session creation');
    assert.equal((await store.get('u1', 'aircraft:A1')).turns, 2);
  });
  test('chat stream: relays parsed SSE with a session preamble and done event', async () => {
    const f = recordingFetch([
      jsonResponse(201, { data: { id: SID } }),
      sseResponse(200, [
        `event:message\ndata:{"answer":"Hi","eventType":"fulfillment"}\n\n`,
        `event:message\ndata:[DONE]\n\n`,
      ]),
    ]);
    const h = createFoundationHandler({
      client: createOnDemandClient({ fetchImpl: f }),
      store: createConversationStore({ backend: 'memory' }),
    });
    const res = makeRes();
    await h(
      makeReq({
        method: 'POST',
        url: '/chat',
        headers: { host: 'h' },
        body: {
          externalUserId: 'u1',
          query: 'hi',
          pluginIds: ['plugin-1713924030'],
        },
      }),
      res,
    );
    const text = res.text();
    assert.ok(text.startsWith('event: session\n'), text);
    assert.ok(text.includes('event: message\ndata: {"answer":"Hi"'));
    assert.ok(text.includes('event: done\n'));
    assert.equal(
      JSON.parse(f.calls[1].init.body).fulfillmentOnly,
      false,
      'plugins present → RAG on',
    );
    assert.equal(
      res.getHeader('content-type'),
      'text/event-stream; charset=utf-8',
    );
  });
  test('validation errors are 400 and nothing goes upstream; cross-origin is 403', async () => {
    const f = recordingFetch([]);
    const h = createFoundationHandler({
      client: createOnDemandClient({ fetchImpl: f }),
      store: createConversationStore({ backend: 'memory' }),
    });
    let res = makeRes();
    await h(
      makeReq({
        method: 'POST',
        url: '/chat',
        headers: { host: 'h' },
        body: { externalUserId: 'u1' },
      }),
      res,
    );
    assert.equal(res.statusCode, 400);
    assert.equal(f.calls.length, 0);
    res = makeRes();
    await h(
      makeReq({
        method: 'POST',
        url: '/chat',
        headers: { host: 'h', origin: 'https://evil.example' },
        body: {},
      }),
      res,
    );
    assert.equal(res.statusCode, 403);
  });
  test('upstream 429 after retries → 429 rate_limited envelope without the key', async () => {
    const f = recordingFetch([jsonResponse(429, { message: 'limit' })]);
    const h = createFoundationHandler({
      client: createOnDemandClient({
        fetchImpl: f,
        retry: { retries: 1, baseDelayMs: 1, maxDelayMs: 1 },
      }),
      store: createConversationStore({ backend: 'memory' }),
    });
    const res = makeRes();
    await h(
      makeReq({
        method: 'POST',
        url: '/conversations',
        headers: { host: 'h' },
        body: { externalUserId: 'u1' },
      }),
      res,
    );
    assert.equal(res.statusCode, 429);
    assert.equal(res.json().error, 'rate_limited');
    assert.equal(res.text().includes(SERVER_KEY), false);
  });
  test('contextPrompt is undefined without context', () => {
    assert.equal(contextPrompt(undefined), undefined);
  });
});

describe('source-level guards', () => {
  test('no foundation module is imported from src/ and no key literal is logged', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = new URL('../../../', import.meta.url).pathname;
    const walk = (d) =>
      readdirSync(join(root, d), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
      );
    const srcFiles = walk('src').filter((f) => /\.(m?js|html)$/.test(f));
    for (const f of srcFiles)
      assert.equal(
        readFileSync(join(root, f), 'utf8').includes(
          'server/ondemand/foundation',
        ),
        false,
        f,
      );
    for (const f of ['client.js', 'proxy-route.js', 'conversation-store.js']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
      assert.doesNotMatch(
        src,
        /console\.\w+\([^)]*(apikey|apiKey|headers)/,
        `${f} must never log headers/keys`,
      );
      assert.equal(
        src.includes('x-ondemand-key'),
        false,
        `${f} must not read the client key header`,
      );
    }
  });
});
