import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOnDemandSseFrames,
  createNdjsonAccumulator,
  streamQuery,
  OnDemandStreamError,
} from './stream-adapter.js';

test('parseOnDemandSseFrames parses complete and split frames incrementally', () => {
  // Chunk 1 has a partial frame
  const chunk1 =
    'event: message\ndata: {"sessionId":"s1","messageId":"m1","status":"processing","eventIndex":0,"answer":"Hello ';
  const res1 = parseOnDemandSseFrames(chunk1);
  assert.equal(res1.events.length, 0);
  assert.ok(res1.state.buffer.length > 0);

  // Chunk 2 completes the frame and starts a heartbeat
  const chunk2 =
    'world!","eventType":"fulfillment"}\n\nevent: heartbeat\ndata: {"time":"12:00"}\n\n';
  const res2 = parseOnDemandSseFrames(chunk2, res1.state);
  assert.equal(res2.events.length, 2);
  assert.equal(res2.events[0].event, 'message');
  assert.equal(res2.events[0].data.answer, 'Hello world!');
  assert.equal(res2.events[1].event, 'heartbeat');

  // Chunk 3 has metrics and [DONE]
  const chunk3 =
    'data: {"eventType":"metricsLog","publicMetrics":{"inputTokens":10,"outputTokens":25}}\n\ndata: [DONE]\n\n';
  const res3 = parseOnDemandSseFrames(chunk3, res2.state);
  assert.equal(res3.events.length, 2);
  assert.equal(res3.events[0].data.eventType, 'metricsLog');
  assert.equal(res3.events[0].data.publicMetrics.outputTokens, 25);
  assert.equal(res3.events[1].data, '[DONE]');
});

test('createNdjsonAccumulator strips code fences and splits lines reliably', () => {
  const lines = [];
  const acc = createNdjsonAccumulator((line) => lines.push(line));

  acc.feed('```json\n{"kind":"classification","title":"A"}\r\n');
  acc.feed('{"kind":"timeline","durationSec":60}\n');
  acc.feed('{"kind":"entity","entity":{"id":"e1"');
  acc.feed('}}\n```\n');
  acc.flush();

  assert.deepEqual(lines, [
    '{"kind":"classification","title":"A"}',
    '{"kind":"timeline","durationSec":60}',
    '{"kind":"entity","entity":{"id":"e1"}}',
  ]);
});

function createMockStream(chunks) {
  const encoder = new TextEncoder();
  let idx = 0;
  return new ReadableStream({
    pull(controller) {
      if (idx < chunks.length) {
        controller.enqueue(encoder.encode(chunks[idx++]));
      } else {
        controller.close();
      }
    },
  });
}

test('streamQuery happy path consumes SSE frames, invokes callbacks and measures metrics', async () => {
  const frames = [
    'event: message\ndata: {"sessionId":"sess-1","messageId":"msg-1","status":"processing","eventIndex":0,"answer":"{\\"kind\\":\\"classification\\"}\\n","eventType":"fulfillment"}\n\n',
    'event: heartbeat\ndata: {"time":"12:00"}\n\n',
    'event: message\ndata: {"sessionId":"sess-1","messageId":"msg-1","status":"processing","eventIndex":1,"answer":"{\\"kind\\":\\"end\\"}\\n","eventType":"fulfillment"}\n\n',
    'data: {"eventType":"metricsLog","publicMetrics":{"inputTokens":50,"outputTokens":100}}\n\n',
    'data: [DONE]\n\n',
  ];

  let requestedUrl = '';
  let requestedBody = null;

  const mockFetch = async (url, opts) => {
    requestedUrl = url;
    requestedBody = opts.body;
    return {
      ok: true,
      status: 200,
      body: createMockStream(frames),
    };
  };

  const deltas = [];
  let metricsReceived = null;
  let heartbeatCount = 0;

  const result = await streamQuery({
    fetchImpl: mockFetch,
    getSettings: () => ({
      apiKey: 'test-key',
      baseUrl: 'https://api.test',
    }),
    sessionId: 'sess-1',
    query: 'Generate scene',
    endpointId: 'predefined-cerebras-qwen-3.8-27b',
    onDelta: (text, meta) => deltas.push({ text, meta }),
    onMetrics: (m) => {
      metricsReceived = m;
    },
    onHeartbeat: () => heartbeatCount++,
  });

  assert.ok(requestedUrl.includes('/chat/v1/sessions/sess-1/query'));
  assert.equal(requestedBody.endpointId, 'predefined-cerebras-qwen-3.8-27b');
  assert.equal(requestedBody.responseMode, 'stream');

  assert.equal(deltas.length, 2);
  assert.equal(heartbeatCount, 1);
  assert.ok(metricsReceived);
  assert.equal(metricsReceived.outputTokens, 100);

  assert.equal(result.sessionId, 'sess-1');
  assert.equal(result.messageId, 'msg-1');
  assert.equal(result.outputTokens, 100);
  assert.equal(result.inputTokens, 50);
  assert.ok(result.tokensPerSec > 0);
  assert.equal(result.deltas, 2);
  assert.equal(result.aborted, false);
});

test('streamQuery estimates tokensPerSec when metricsLog is absent', async () => {
  const sampleAnswer = 'A'.repeat(100);
  const frames = [
    `event: message\ndata: {"sessionId":"sess-1","messageId":"msg-1","status":"processing","eventIndex":0,"answer":${JSON.stringify(sampleAnswer)},"eventType":"fulfillment"}\n\n`,
    'data: [DONE]\n\n',
  ];

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    body: createMockStream(frames),
  });

  const result = await streamQuery({
    fetchImpl: mockFetch,
    getSettings: () => ({ apiKey: 'test-key' }),
    sessionId: 'sess-1',
    query: 'test',
    endpointId: 'ep-1',
  });

  assert.equal(result.outputTokens, null);
  assert.equal(result.estimated, true);
  assert.ok(result.tokensPerSec > 0);
});

test('streamQuery error handling for HTTP statuses and timeouts', async () => {
  // Test HTTP 400 -> endpoint_invalid
  const mock400 = async () => ({
    ok: false,
    status: 400,
    text: async () => 'Invalid endpoint ID',
  });
  await assert.rejects(
    streamQuery({
      fetchImpl: mock400,
      getSettings: () => ({ apiKey: 'k' }),
      sessionId: 's',
      query: 'q',
      endpointId: 'bad-endpoint',
    }),
    (err) => {
      assert.ok(err instanceof OnDemandStreamError);
      assert.equal(err.status, 400);
      assert.equal(err.code, 'endpoint_invalid');
      return true;
    },
  );

  // Test HTTP 429 -> rate_limited
  const mock429 = async () => ({
    ok: false,
    status: 429,
    text: async () => 'Too many requests',
  });
  await assert.rejects(
    streamQuery({
      fetchImpl: mock429,
      getSettings: () => ({ apiKey: 'k' }),
      sessionId: 's',
      query: 'q',
      endpointId: 'ep-1',
    }),
    (err) => {
      assert.equal(err.status, 429);
      assert.equal(err.code, 'rate_limited');
      return true;
    },
  );

  // Test 0 deltas and no [DONE] -> stream_timeout
  const mockEmpty = async () => ({
    ok: true,
    status: 200,
    body: createMockStream([': heartbeat\n\n']),
  });
  await assert.rejects(
    streamQuery({
      fetchImpl: mockEmpty,
      getSettings: () => ({ apiKey: 'k' }),
      sessionId: 's',
      query: 'q',
      endpointId: 'ep-1',
    }),
    (err) => {
      assert.equal(err.code, 'stream_timeout');
      return true;
    },
  );
});

test('streamQuery honours abort signal', async () => {
  const controller = new AbortController();
  controller.abort();

  const mockFetch = async () => ({
    ok: true,
    status: 200,
    body: createMockStream([]),
  });

  await assert.rejects(
    streamQuery({
      fetchImpl: mockFetch,
      getSettings: () => ({ apiKey: 'k' }),
      sessionId: 's',
      query: 'q',
      endpointId: 'ep-1',
      signal: controller.signal,
    }),
    (err) => err.name === 'AbortError',
  );
});

test('parseOnDemandSseFrames handles windows CRLF and multi-line data', () => {
  const chunk = 'event: message\r\ndata: line 1\r\ndata: line 2\r\n\r\n';
  const res = parseOnDemandSseFrames(chunk);
  assert.equal(res.events.length, 1);
  assert.equal(res.events[0].data, 'line 1\nline 2');
});

test('streamQuery aborts if firstByteTimeoutMs expires', async () => {
  const hangingFetch = async (url, { signal }) => {
    return new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => {
        reject(new DOMException('Timeout', 'AbortError'));
      });
    });
  };

  await assert.rejects(
    streamQuery({
      fetchImpl: hangingFetch,
      getSettings: () => ({ apiKey: 'k' }),
      sessionId: 's',
      query: 'q',
      endpointId: 'ep-1',
      firstByteTimeoutMs: 50,
      timeoutMs: 1000,
    }),
    (err) =>
      err instanceof OnDemandStreamError && err.code === 'stream_timeout',
  );
});
