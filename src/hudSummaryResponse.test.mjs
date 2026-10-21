import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HUD_SUMMARY_UNCONFIGURED_CODE,
  isHudSummaryUnconfigured,
  keylessHudSummaryResponse,
} from './hudSummaryResponse.js';

const UNCONFIGURED_PAYLOAD = {
  configured: false,
  code: HUD_SUMMARY_UNCONFIGURED_CODE,
  error: null,
  summary: null,
};


function invokeRoute(handler, { method = 'GET', url = '/', remoteAddress = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const headers = new Map();
    const req = {
      method,
      url,
      headers: {},
      socket: { remoteAddress },
    };
    const res = {
      statusCode: 200,
      setHeader(name, value) {
        headers.set(String(name).toLowerCase(), String(value));
      },
      end(body = '') {
        resolve({
          statusCode: this.statusCode,
          headers: Object.fromEntries(headers),
          body: body ? JSON.parse(String(body)) : null,
        });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test('builds an HTTP-success capability response only for a blank key', () => {
  assert.deepEqual(keylessHudSummaryResponse(undefined), {
    statusCode: 200,
    payload: UNCONFIGURED_PAYLOAD,
  });
  assert.deepEqual(keylessHudSummaryResponse('  '), {
    statusCode: 200,
    payload: UNCONFIGURED_PAYLOAD,
  });
  assert.equal(keylessHudSummaryResponse('configured-key'), null);
});

test('recognizes only the exact deliberate no-key fallback response', () => {
  assert.equal(isHudSummaryUnconfigured(200, UNCONFIGURED_PAYLOAD), true);
  assert.equal(isHudSummaryUnconfigured(503, UNCONFIGURED_PAYLOAD), false);
  assert.equal(isHudSummaryUnconfigured(200, {
    ...UNCONFIGURED_PAYLOAD,
    error: 'provider failed',
  }), false);
  assert.equal(isHudSummaryUnconfigured(200, {
    ...UNCONFIGURED_PAYLOAD,
    summary: 'Unexpected provider output',
  }), false);
  assert.equal(isHudSummaryUnconfigured(200, {
    ...UNCONFIGURED_PAYLOAD,
    configured: true,
  }), false);
  assert.equal(isHudSummaryUnconfigured(200, {
    ...UNCONFIGURED_PAYLOAD,
    unexpected: true,
  }), false);
  assert.equal(isHudSummaryUnconfigured(200, {
    code: HUD_SUMMARY_UNCONFIGURED_CODE,
  }), false);
});

test('does not hide real provider and HTTP failures', () => {
  assert.equal(isHudSummaryUnconfigured(502, {
    code: HUD_SUMMARY_UNCONFIGURED_CODE,
  }), false);
  assert.equal(isHudSummaryUnconfigured(503, UNCONFIGURED_PAYLOAD), false);
  assert.equal(isHudSummaryUnconfigured(200, { error: 'provider failed' }), false);
});

test('the v2 HUD summary route answers the graceful unconfigured shape when no OnDemand key is set', async () => {
  const previous = process.env.ONDEMAND_API_KEY;
  process.env.ONDEMAND_API_KEY = '';
  try {
    const { __reloadConfigForTests } = await import('../server/ondemand/config.js');
    __reloadConfigForTests();
    const { createFoundationHandler } = await import(['..', 'server', 'ondemand', 'foundation', 'proxy-route.js'].join('/'));
    const handler = createFoundationHandler({ store: { backend: 'memory', get: async () => undefined, put: async (u, c, p) => ({ ...p, objectContextKey: 'hudSummary:global' }), touch: async () => {}, listByUser: async () => [], close: async () => true } });
    const response = await new Promise((resolve, reject) => {
      const headers = new Map();
      const req = { method: 'POST', url: '/summaries/hud', headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' }, on() {}, off() {}, async *[Symbol.asyncIterator]() { yield Buffer.from('{"placeLabels":["Abu Dhabi"]}'); } };
      const res = { statusCode: 200, setHeader(n, v) { headers.set(String(n).toLowerCase(), String(v)); }, end(body = '') { resolve({ statusCode: this.statusCode, headers: Object.fromEntries(headers), body: body ? JSON.parse(String(body)) : null }); } };
      Promise.resolve(handler(req, res)).catch(reject);
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, UNCONFIGURED_PAYLOAD);
    assert.equal(isHudSummaryUnconfigured(response.statusCode, response.body), true);
    assert.equal(response.headers['x-ondemand-key-source'], 'server');
  } finally {
    if (previous === undefined) delete process.env.ONDEMAND_API_KEY;
    else process.env.ONDEMAND_API_KEY = previous;
    const { __reloadConfigForTests } = await import('../server/ondemand/config.js');
    __reloadConfigForTests();
  }
});

// The OpenAI provider module (and its 410 tombstone for /api/openai/hud-summary)
// was deleted 2026-10-21 together with the OpenAI Realtime stack; the HUD summary
// lives only on /api/ondemand/v2/summaries/hud (covered above).
