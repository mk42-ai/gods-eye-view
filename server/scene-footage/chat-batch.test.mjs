import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatBatchClient } from './chat-batch.js';

test('createChatBatchClient: returns available: false with exact status and body on HTTP 405', async () => {
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
  const fakeFetch = async () => {
    throw new Error('connect ECONNREFUSED');
  };

  const client = createChatBatchClient({ fetchImpl: fakeFetch });
  const res = await client.submitBatch([]);
  assert.equal(res.available, false);
  assert.ok(res.error.includes('ECONNREFUSED'));
});
