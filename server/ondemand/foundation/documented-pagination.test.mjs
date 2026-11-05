import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createOnDemandClient } from './client.js';
import { __reloadConfigForTests } from '../config.js';
let saved;
beforeEach(() => {
  saved = { ...process.env };
  process.env.ONDEMAND_API_KEY = 'fixture-key-only';
  __reloadConfigForTests();
});
afterEach(() => {
  process.env = saved;
  __reloadConfigForTests();
});
const sid = '6ad7ddc47bb80aa7c2d9757f';
const mid = '6ad7ddc47bb80aa7c2d9757e';
test('cursor iteration follows the live documented pagination.next field with a hard page cap', async () => {
  const urls = [];
  const c = createOnDemandClient({
    fetchImpl: async (url) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify({
          data: [{ id: urls.length }],
          pagination: { next: `cursor-${urls.length}` },
        }),
      );
    },
  });
  const found = [];
  for await (const row of c.sessions.iterate({ limit: 10 }, {}, 2))
    found.push(row.id);
  assert.deepEqual(found, [1, 2]);
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[1]).searchParams.get('cursor'), 'cursor-1');
});
test('single-message polling GET preserves identifiers and never invokes a query', async () => {
  const calls = [];
  const c = createOnDemandClient({
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method });
      return new Response(
        JSON.stringify({
          data: { id: mid, sessionId: sid, status: 'completed', answer: '{}' },
        }),
      );
    },
  });
  assert.equal((await c.sessions.message(sid, mid)).status, 'completed');
  assert.equal(calls[0].method, 'GET');
  assert.ok(calls[0].url.endsWith(`/sessions/${sid}/messages/${mid}`));
  await assert.rejects(() => c.sessions.message(sid, '../bad'));
  assert.equal(calls.length, 1);
});
