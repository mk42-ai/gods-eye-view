#!/usr/bin/env node
/**
 * Live validation of server/ondemand/foundation/* against the real OnDemand
 * API. Requires ONDEMAND_API_KEY (or ON_DEMAND_API_KEY) in the environment.
 * Prints a REDACTED JSON evidence array (no key, no long tokens) suitable for
 * pasting into docs/agent-execution/TEST_RESULTS.md.
 *
 *   npm run ondemand:foundation:live
 */
import {
  createOnDemandClient,
  OnDemandHttpError,
  redact,
} from '../server/ondemand/foundation/client.js';
import { createConversationStore } from '../server/ondemand/foundation/conversation-store.js';
import { createFoundationHandler } from '../server/ondemand/foundation/proxy-route.js';
import { contractRegistry } from '../server/ondemand/foundation/contracts.js';
import { __reloadConfigForTests } from '../server/ondemand/config.js';
import { makeReq, makeRes } from '../server/ondemand/test-helpers.mjs';

if (!process.env.ONDEMAND_API_KEY && process.env.ON_DEMAND_API_KEY) {
  process.env.ONDEMAND_API_KEY = process.env.ON_DEMAND_API_KEY;
}
__reloadConfigForTests();
const key = process.env.ONDEMAND_API_KEY || '';
const ts = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const rows = [];
const ok = (test, result, evidence) => {
  rows.push({
    test,
    result,
    evidence: redact(
      typeof evidence === 'string' ? evidence : JSON.stringify(evidence),
      key,
    ).slice(0, 500),
    timestamp: ts(),
  });
  console.error(`[${rows.at(-1).timestamp}] ${result.padEnd(5)} ${test}`);
};
const ENDPOINT =
  process.env.ONDEMAND_FULFILLMENT_ENDPOINT_ID || 'predefined-gpt-6-luna';
const USER = 'gev-foundation-live';
const client = createOnDemandClient({ log: () => {} });
const store = createConversationStore({ backend: 'memory' });
const handler = createFoundationHandler({ client, store });

async function call(method, url, body, headers = {}) {
  const res = makeRes();
  await handler(
    makeReq({ method, url, headers: { host: 'localhost', ...headers }, body }),
    res,
  );
  return res;
}

try {
  if (!key) throw new Error('ONDEMAND_API_KEY not set');
  // 1 client: session create + list + get
  const t0 = Date.now();
  const s = await client.sessions.create({
    externalUserId: USER,
    pluginIds: ['plugin-1713924030'],
  });
  ok(
    'client.sessions.create (externalUserId + 1 pluginId)',
    /^[0-9a-f]{24}$/.test(s.id) ? 'PASS' : 'FAIL',
    { ms: Date.now() - t0, pluginIds: s.pluginIds },
  );
  const l = await client.sessions.list({ externalUserId: USER, limit: 2 });
  ok(
    'client.sessions.list pagination',
    Array.isArray(l.data) ? 'PASS' : 'FAIL',
    { count: l.data.length, pagination: l.pagination },
  );
  const g = await client.sessions.get(s.id);
  ok('client.sessions.get', g?.externalUserId === USER ? 'PASS' : 'FAIL', {
    keys: Object.keys(g || {}),
  });
  // 2 client: sync query
  const t1 = Date.now();
  const q = await client.query.sync(s.id, {
    query: 'Reply with exactly: FOUNDATION-LIVE-OK',
    endpointId: ENDPOINT,
    fulfillmentOnly: true,
    reasoningEffort: 'low',
  });
  ok(
    `client.query.sync fulfillmentOnly (${ENDPOINT})`,
    q?.data?.answer?.includes('FOUNDATION-LIVE-OK') ? 'PASS' : 'FAIL',
    { ms: Date.now() - t1, answer: q?.data?.answer, status: q?.data?.status },
  );
  // 3 client: stream with abort propagation
  const t2 = Date.now();
  const st = await client.query.stream(s.id, {
    query: 'In one sentence, what is a spatial intelligence workstation?',
    endpointId: ENDPOINT,
    fulfillmentOnly: true,
    reasoningEffort: 'low',
  });
  const types = [];
  let text = '';
  let first = 0;
  for await (const e of st.events) {
    if (!first) first = Date.now() - t2;
    types.push(e.event);
    if (e.answer) text += e.answer;
    if (e.event === 'done') break;
  }
  ok(
    'client.query.stream SSE parse (deltas, metricsLog, heartbeat, [DONE])',
    types.includes('done') && text.length > 10 ? 'PASS' : 'FAIL',
    {
      ttfbMs: first,
      totalMs: Date.now() - t2,
      events: types.length,
      distinct: [...new Set(types)],
      text: text.slice(0, 80),
    },
  );
  const ctrl = new AbortController();
  const st2 = await client.query.stream(
    s.id,
    {
      query: 'Count slowly from one to fifty in words.',
      endpointId: ENDPOINT,
      fulfillmentOnly: true,
    },
    { signal: ctrl.signal },
  );
  let n = 0;
  let aborted = false;
  try {
    for await (const e of st2.events) {
      n += 1;
      if (n === 3) ctrl.abort();
    }
  } catch (e) {
    aborted = e?.name === 'OnDemandAbortError';
  }
  ok(
    'client.query.stream abort propagation (caller abort stops upstream read)',
    aborted || n <= 5 ? 'PASS' : 'FAIL',
    { eventsBeforeAbort: n, abortedError: aborted },
  );
  // 4 client: plugin query (RAG)
  const t3 = Date.now();
  const pq = await client.query.sync(s.id, {
    query:
      'Give one current news headline about Abu Dhabi with its source URL.',
    endpointId: ENDPOINT,
    pluginIds: ['plugin-1713924030'],
    reasoningEffort: 'low',
  });
  ok(
    'client.query.sync with plugin-1713924030 (Internet web search)',
    pq?.data?.answer ? 'PASS' : 'FAIL',
    { ms: Date.now() - t3, answer: pq?.data?.answer?.slice(0, 160) },
  );
  // 5 client: inactive plugin → typed error, no retry storm
  try {
    await client.sessions.create({
      externalUserId: USER,
      pluginIds: ['plugin-1785777296'],
    });
    ok(
      'client: inactive plugin-1785777296 rejected upstream',
      'FAIL',
      'unexpected success',
    );
  } catch (e) {
    ok(
      'client: inactive plugin-1785777296 → OnDemandHttpError 400 (not retried)',
      e instanceof OnDemandHttpError && e.status === 400 ? 'PASS' : 'FAIL',
      { status: e.status, message: e.upstream?.message },
    );
  }
  // 6 client: workflow execute + follow (polling)
  const wfId = '6aace534859f7b0abb53d99a';
  const wf = await client.workflows.get(wfId);
  ok(
    'client.workflows.get (ONDEMAND_SPATIAL_WORKFLOW_ID real id)',
    wf?.isActive ? 'PASS' : 'FAIL',
    {
      name: wf?.name,
      isActive: wf?.isActive,
      nodes: wf?.nodes?.length,
      trigger: wf?.trigger?.type,
    },
  );
  const ex = await client.workflows.execute(wfId);
  let last;
  let logs = 0;
  for await (const snap of client.workflows.follow(ex.executionID, {
    intervalMs: 3000,
    maxMs: 45_000,
  })) {
    last = snap;
    logs += snap.newLogs.length;
  }
  ok(
    'client.workflows.execute + follow (status + logs polling)',
    ex.executionID && logs > 0 ? 'PASS' : 'FAIL',
    { status: last?.status, terminal: last?.terminal, logLines: logs },
  );
  // 7 proxy route end-to-end (no client key anywhere)
  let r = await call('GET', '/health');
  ok(
    'route GET /api/ondemand/v2/health',
    r.statusCode === 200 && r.json().keySource === 'server' ? 'PASS' : 'FAIL',
    r.json(),
  );
  r = await call('GET', '/contracts');
  ok(
    'route GET /api/ondemand/v2/contracts',
    r.statusCode === 200 &&
      r.json().contracts.length === contractRegistry.size()
      ? 'PASS'
      : 'FAIL',
    { contracts: r.json().contracts.length },
  );
  const ctx = {
    objectType: 'aircraft',
    objectId: 'live-A6-EVN',
    label: 'EK203 (test object)',
    position: { lat: 25.25, lon: 55.36, alt: 10668 },
    provenance: { provider: 'test', fetchedAt: ts() },
  };
  const t4 = Date.now();
  r = await call(
    'POST',
    '/chat',
    {
      externalUserId: USER,
      objectContext: ctx,
      query:
        'What object am I looking at and at what altitude? Answer from the context only.',
      responseMode: 'sync',
      endpointId: ENDPOINT,
    },
    { 'x-ondemand-key': 'client-key-must-be-ignored' },
  );
  const j1 = r.json();
  ok(
    'route POST /chat sync — object-context grounded, client key header ignored',
    r.statusCode === 200 &&
      /10668|10,668|EK203/.test(j1.answer || '') &&
      r.getHeader('x-ondemand-key-source') === 'server'
      ? 'PASS'
      : 'FAIL',
    {
      ms: Date.now() - t4,
      status: r.statusCode,
      reused: j1.reused,
      objectContextKey: j1.objectContextKey,
      answer: (j1.answer || j1.error || '').slice(0, 140),
    },
  );
  r = await call('POST', '/chat', {
    externalUserId: USER,
    objectContext: ctx,
    query: 'Repeat the altitude.',
    responseMode: 'sync',
    endpointId: ENDPOINT,
  });
  ok(
    'route POST /chat sync — second turn reuses the SAME session (isolation key user+object)',
    r.json().reused === true && r.json().sessionId === j1.sessionId
      ? 'PASS'
      : 'FAIL',
    {
      reused: r.json().reused,
      sameSession: r.json().sessionId === j1.sessionId,
    },
  );
  r = await call('POST', '/chat', {
    externalUserId: USER + '-other',
    objectContext: ctx,
    query: 'Repeat the altitude.',
    responseMode: 'sync',
    endpointId: ENDPOINT,
  });
  ok(
    'route POST /chat sync — different externalUserId gets a DIFFERENT session',
    r.json().sessionId && r.json().sessionId !== j1.sessionId ? 'PASS' : 'FAIL',
    { different: r.json().sessionId !== j1.sessionId },
  );
  const t5 = Date.now();
  r = await call('POST', '/chat', {
    externalUserId: USER,
    objectContext: {
      objectType: 'camera',
      objectId: 'live-cam-1',
      label: 'Test camera',
    },
    query: 'Say OK.',
    responseMode: 'stream',
    endpointId: ENDPOINT,
  });
  const body = r.text();
  ok(
    'route POST /chat stream — SSE relay (session preamble, message events, done)',
    r.getHeader('content-type')?.includes('event-stream') &&
      body.includes('event: session') &&
      body.includes('event: done')
      ? 'PASS'
      : 'FAIL',
    { ms: Date.now() - t5, bytes: body.length, head: body.slice(0, 160) },
  );
  r = await call(
    'GET',
    `/messages?externalUserId=${USER}&objectContextKey=aircraft:live-A6-EVN&limit=5`,
  );
  ok(
    'route GET /messages (history via conversation key)',
    r.statusCode === 200 && Array.isArray(r.json().data) ? 'PASS' : 'FAIL',
    { count: r.json().data?.length },
  );
  r = await call('GET', `/conversations?externalUserId=${USER}`);
  ok(
    'route GET /conversations (per-user listing)',
    r.statusCode === 200 && r.json().conversations.length >= 2
      ? 'PASS'
      : 'FAIL',
    { conversations: r.json().conversations.length },
  );
  r = await call('DELETE', '/conversations', {
    externalUserId: USER,
    objectContextKey: 'aircraft:live-A6-EVN',
  });
  ok(
    'route DELETE /conversations (close mapping)',
    r.json().closed === true ? 'PASS' : 'FAIL',
    r.json(),
  );
  r = await call('POST', '/workflows/execute', { workflowId: wfId });
  ok(
    'route POST /workflows/execute',
    r.statusCode === 202 && r.json().executionID ? 'PASS' : 'FAIL',
    {
      status: r.statusCode,
      streamPath: r.json().streamPath?.replace(/[0-9a-f]{24}/, '<id>'),
    },
  );
} catch (err) {
  ok('fatal', 'FAIL', {
    name: err?.name,
    message: err?.message,
    status: err?.status,
    upstream: err?.upstream,
  });
}
const pass = rows.filter((r) => r.result === 'PASS').length;
console.log(
  JSON.stringify(
    { generatedUtc: ts(), pass, fail: rows.length - pass, rows },
    null,
    1,
  ),
);
process.exit(rows.length - pass === 0 ? 0 : 1);
