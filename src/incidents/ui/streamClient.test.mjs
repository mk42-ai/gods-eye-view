import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamClient, parseSseBlock } from './streamClient.js';

function createMockStream(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk,
        );
      }
      controller.close();
    },
  });
}

test('parseSseBlock parses multi-line data joined by newlines', () => {
  const block = `id: 42\nevent: note\ndata: line 1\ndata: line 2`;
  const parsed = parseSseBlock(block);
  assert.equal(parsed.id, '42');
  assert.equal(parsed.event, 'note');
  assert.equal(parsed.data, 'line 1\nline 2');
});

test('parseSseBlock ignores comments starting with colon', () => {
  const block = `: heartbeat\n: another comment\nid: 99\nevent: status\ndata: {"stage":"locating"}`;
  const parsed = parseSseBlock(block);
  assert.equal(parsed.id, '99');
  assert.equal(parsed.event, 'status');
  assert.deepEqual(parsed.data, { stage: 'locating' });
});

test('streamClient parses stream chunks and dispatches typed events', async () => {
  const sseBody = [
    ': heartbeat\n\n',
    'id: req:1\nevent: status\ndata: {"stage":"locating"}\n\n',
    'id: req:2\nevent: plan\ndata: {"spec":{"scenarioType":"police_raid"}}\n\n',
    'id: req:3\nevent: done\ndata: {"result":{"ok":true,"plan":{"id":"p1"}}}\n\n',
  ];

  const fakeFetch = async () => ({
    ok: true,
    headers: new Map([['content-type', 'text/event-stream']]),
    body: createMockStream(sseBody),
  });

  const client = createStreamClient({ fetch: fakeFetch });
  const received = [];
  const result = await client.stream('http://example.com/stream', {
    onEvent: (evt) => received.push(evt),
  });

  assert.equal(received.length, 3);
  assert.equal(received[0].event, 'status');
  assert.equal(received[1].event, 'plan');
  assert.equal(received[2].event, 'done');
  assert.deepEqual(result, { ok: true, plan: { id: 'p1' } });
});

test('streamClient reconnect sends Last-Event-ID header and query on reconnect', async () => {
  let callCount = 0;
  const requests = [];

  const fakeFetch = async (url, init) => {
    callCount += 1;
    requests.push({ url, headers: init.headers });
    if (callCount === 1) {
      // First call drops after emitting event 1
      return {
        ok: true,
        headers: new Map([['content-type', 'text/event-stream']]),
        body: createMockStream([
          'id: req:1\nevent: status\ndata: {"stage":"locating"}\n\n',
        ]),
      };
    }
    // Reconnect call finishes with event 2 and done
    return {
      ok: true,
      headers: new Map([['content-type', 'text/event-stream']]),
      body: createMockStream([
        'id: req:2\nevent: done\ndata: {"result":{"ok":true,"reconnected":true}}\n\n',
      ]),
    };
  };

  const client = createStreamClient({
    fetch: fakeFetch,
    backoffMs: 10,
    maxRetries: 2,
  });
  const received = [];
  const result = await client.stream('http://example.com/stream', {
    onEvent: (evt) => received.push(evt),
  });

  assert.equal(callCount, 2);
  assert.equal(requests[1].headers['Last-Event-ID'], 'req:1');
  assert.equal(received.length, 2);
  assert.equal(received[1].event, 'done');
  assert.equal(result.reconnected, true);
});

test('streamClient cancel aborts connection and propagates AbortError', async () => {
  const controller = new AbortController();
  const fakeFetch = async (_url, init) => {
    return new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => {
        const err = new Error('Request cancelled.');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };

  const client = createStreamClient({ fetch: fakeFetch });
  const streamPromise = client.stream('http://example.com/stream', {
    signal: controller.signal,
  });

  controller.abort();
  await assert.rejects(streamPromise, { name: 'AbortError' });
});
