import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatTransport } from './transport.js';

// Mocked HTTP only. This suite does not assert live batch/Snapchat authorization.
const session = { id: 'fixture-session', pluginIds: [] };
const mid = 'fixture-message';
function harness(rows, extra = {}) {
  const calls = [];
  let index = 0;
  const transport = createChatTransport({
    getSettings: () => ({
      apiKey: 'fixture',
      baseUrl: 'https://fixture.example',
      fulfillmentEndpointId: 'fixture',
    }),
    fetchImpl: async (url, init) => {
      calls.push({
        url,
        method: init.method,
        signal: init.signal,
        timeoutMs: init.timeoutMs,
      });
      return {
        ok: true,
        json: async () => ({ data: rows[Math.min(index++, rows.length - 1)] }),
      };
    },
    sleep: async () => {},
    pollIntervalMs: 0,
    maxPolls: 3,
    ...extra,
  });
  return { transport, calls };
}
const pending = () => ({
  sessionId: session.id,
  messageId: mid,
  status: 'processing',
});

test('processing polls the documented GET message endpoint, never resubmits the POST', async () => {
  const h = harness([
    pending(),
    { id: mid, sessionId: session.id, status: 'processing' },
    {
      id: mid,
      sessionId: session.id,
      status: 'completed',
      answer: '{"ok":true}',
    },
  ]);
  const result = await h.transport.query(session, 'fixture query');
  assert.equal(result.answer, '{"ok":true}');
  assert.equal(result.messageId, mid);
  assert.deepEqual(
    h.calls.map((c) => c.method),
    ['POST', 'GET', 'GET'],
  );
  assert.equal(
    h.calls[1].url,
    'https://fixture.example/chat/v1/sessions/fixture-session/messages/fixture-message',
  );
});
test('failed terminal output is never accepted as successful scene content', async () => {
  const h = harness([
    pending(),
    { id: mid, status: 'failed', answer: 'not a scene' },
  ]);
  await assert.rejects(() => h.transport.query(session, 'fixture'), {
    code: 'provider_output_missing',
  });
});
test('status polling has a hard count limit', async () => {
  const h = harness([pending()], { maxPolls: 2 });
  await assert.rejects(() => h.transport.query(session, 'fixture'), {
    code: 'provider_poll_timeout',
  });
  assert.equal(h.calls.length, 3);
});
test('a processing reply with no message identity is not blindly retried', async () => {
  const h = harness([{ status: 'processing' }]);
  await assert.rejects(() => h.transport.query(session, 'fixture'), {
    code: 'provider_pending',
  });
  assert.equal(h.calls.length, 1);
});
test('a different message/session cannot satisfy this construction request', async () => {
  for (const row of [
    { id: 'wrong-message', status: 'completed', answer: '{}' },
    { id: mid, sessionId: 'wrong-session', status: 'completed', answer: '{}' },
  ]) {
    const h = harness([pending(), row]);
    await assert.rejects(
      () => h.transport.query(session, 'fixture'),
      (e) =>
        ['provider_message_mismatch', 'provider_session_mismatch'].includes(
          e.code,
        ),
    );
  }
});
test('unknown polling status is a failure rather than fabricated completion', async () => {
  const h = harness([pending(), { id: mid, status: 'queued', answer: '{}' }]);
  await assert.rejects(() => h.transport.query(session, 'fixture'), {
    code: 'provider_status_invalid',
  });
});
test('caller cancellation during polling does not start another GET', async () => {
  const abort = new AbortController();
  const h = harness([pending()], { sleep: async () => abort.abort() });
  await assert.rejects(
    () => h.transport.query(session, 'fixture', { signal: abort.signal }),
    { name: 'AbortError' },
  );
  assert.equal(h.calls.length, 1);
});
test('expired absolute polling deadline never starts a GET', async () => {
  const h = harness([pending()], { pollTimeoutMs: 0 });
  await assert.rejects(() => h.transport.query(session, 'fixture'), {
    code: 'provider_poll_timeout',
  });
  assert.equal(h.calls.length, 1);
});
