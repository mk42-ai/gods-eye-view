import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createChatBatchClient,
  probeChatBatch,
  resetChatBatchProbeCache,
  getChatBatchCapability,
} from './chat-batch.js';

test('createChatBatchClient: returns available: false with exact status and body on HTTP 405', async () => {
  resetChatBatchProbeCache();
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      status: 405,
      ok: false,
      text: async () =>
        JSON.stringify({
          message: 'Chat batch creation is currently unavailable',
          errorCode: 'method_not_allowed',
        }),
    };
  };

  const client = createChatBatchClient({
    fetchImpl: fakeFetch,
    baseUrl: 'https://api.on-demand.io',
    apiKeyProvider: () => 'test-key',
  });

  const res = await client.submitBatch([{ query: 'test' }]);
  assert.equal(res.available, false);
  assert.equal(res.status, 405);
  assert.ok(res.body.includes('Chat batch creation is currently unavailable'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.on-demand.io/chat/v1/batches');
  assert.equal(calls[0].opts.headers.apikey, 'test-key');

  // Second call returns cached unavailable result without re-fetching
  const res2 = await client.submitBatch([{ query: 'test2' }]);
  assert.equal(res2.available, false);
  assert.equal(calls.length, 1);
});

test('createChatBatchClient: handles HTTP 404 Route not found', async () => {
  resetChatBatchProbeCache();
  const fakeFetch = async () => ({
    status: 404,
    ok: false,
    text: async () => 'Route not found',
  });

  const client = createChatBatchClient({ fetchImpl: fakeFetch });
  const res = await client.submitBatch([]);
  assert.equal(res.available, false);
  assert.equal(res.status, 404);
  assert.equal(res.body, 'Route not found');
});

test('createChatBatchClient: handles network error gracefully', async () => {
  resetChatBatchProbeCache();
  const fakeFetch = async () => {
    throw new Error('connect ECONNREFUSED');
  };

  const client = createChatBatchClient({ fetchImpl: fakeFetch });
  const res = await client.submitBatch([]);
  assert.equal(res.available, false);
  assert.ok(res.error.includes('ECONNREFUSED'));
});

test('probeChatBatch: records {available, status, body, checkedAt} and caches for 10 minutes', async () => {
  resetChatBatchProbeCache();
  let time = 1_000_000;
  let fetchCount = 0;
  const fakeFetch = async () => {
    fetchCount++;
    return {
      status: 405,
      ok: false,
      text: async () =>
        JSON.stringify({
          message: 'Chat batch creation is currently unavailable',
          errorCode: 'method_not_allowed',
        }),
    };
  };

  const probe1 = await probeChatBatch({
    fetchImpl: fakeFetch,
    now: () => time,
  });
  assert.equal(probe1.available, false);
  assert.equal(probe1.status, 405);
  assert.ok(
    probe1.body.includes('Chat batch creation is currently unavailable'),
  );
  assert.equal(probe1.checkedAt, new Date(time).toISOString());
  assert.equal(fetchCount, 1);

  // Advance time by 5 minutes (within 10-minute cache)
  time += 5 * 60_000;
  const probe2 = await probeChatBatch({
    fetchImpl: fakeFetch,
    now: () => time,
  });
  assert.equal(fetchCount, 1, 'did not re-fetch within TTL');
  assert.equal(probe2.status, 405);

  // Advance time past 10 minutes -> re-probes
  time += 6 * 60_000;
  const probe3 = await probeChatBatch({
    fetchImpl: fakeFetch,
    now: () => time,
  });
  assert.equal(fetchCount, 2, 're-probed after TTL expired');
  assert.equal(probe3.checkedAt, new Date(time).toISOString());

  const capability = getChatBatchCapability(probe3);
  assert.equal(capability.available, false);
  assert.equal(capability.status, 405);
  assert.equal(capability.checkedAt, new Date(time).toISOString());
});
