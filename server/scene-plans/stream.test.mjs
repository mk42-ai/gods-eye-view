import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSceneEventStream,
  tokenizeNarration,
  resetSessionRing,
} from './stream.js';

function createMockResponse() {
  const headers = {};
  const chunks = [];
  let ended = false;
  return {
    headers,
    chunks,
    get ended() {
      return ended;
    },
    statusCode: 200,
    headersSent: false,
    setHeader(name, val) {
      headers[name.toLowerCase()] = val;
    },
    flushHeaders() {
      this.headersSent = true;
    },
    write(chunk) {
      chunks.push(chunk);
      return true;
    },
    end() {
      ended = true;
    },
  };
}

test('createSceneEventStream emits monotonic IDs and retry header on open', () => {
  resetSessionRing();
  const res = createMockResponse();
  const stream = createSceneEventStream(res, {
    requestId: 'req-123',
    heartbeatMs: 60000,
  });

  assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-cache, no-transform');
  assert.equal(res.chunks[0], 'retry: 3000\n\n');

  stream.emit('status', { stage: 'locating', text: 'Locating venue' });
  stream.emit('thinking', { note: 'Classifying scenario' });

  assert.equal(res.chunks.length, 3);
  assert.match(res.chunks[1], /^id: req-123:1\nevent: status\ndata: /);
  assert.match(res.chunks[2], /^id: req-123:2\nevent: thinking\ndata: /);

  const parsed1 = JSON.parse(
    res.chunks[1].split('data: ')[1].replace(/\n\n$/, ''),
  );
  assert.equal(parsed1.stage, 'locating');
  assert.ok(parsed1.t);
  assert.ok(typeof parsed1.elapsedMs === 'number');

  stream.close();
  assert.equal(res.ended, true);
});

test('createSceneEventStream sends heartbeat comment periodically', async () => {
  resetSessionRing();
  const res = createMockResponse();
  const stream = createSceneEventStream(res, {
    requestId: 'req-hb',
    heartbeatMs: 20,
  });

  await new Promise((r) => setTimeout(r, 65));
  stream.close();

  const heartbeats = res.chunks.filter((c) => c === ': heartbeat\n\n');
  assert.ok(
    heartbeats.length >= 2,
    `Expected >= 2 heartbeats, got ${heartbeats.length}`,
  );
});

test('replay after Last-Event-ID for known request', () => {
  resetSessionRing();
  const res1 = createMockResponse();
  const stream1 = createSceneEventStream(res1, {
    requestId: 'req-replay',
    heartbeatMs: 60000,
  });

  stream1.emit('status', { stage: 'locating', text: 'Step 1' });
  stream1.emit('plan', { spec: { scenarioType: 'police_raid' } });
  stream1.emit('done', { result: { ok: true } });
  stream1.close();

  assert.equal(res1.chunks.length, 4); // retry: 3000, id:1, id:2, id:3

  // Reconnect with Last-Event-ID: req-replay:1
  const res2 = createMockResponse();
  const stream2 = createSceneEventStream(res2, {
    requestId: 'req-replay',
    lastEventId: 'req-replay:1',
    heartbeatMs: 60000,
  });

  // Since stream1 was already closed, stream2 replayed events > 1 and closed
  assert.equal(res2.chunks.length, 3); // retry: 3000, id:2, id:3
  assert.match(res2.chunks[1], /^id: req-replay:2\nevent: plan\n/);
  assert.match(res2.chunks[2], /^id: req-replay:3\nevent: done\n/);
  assert.equal(res2.ended, true);
  assert.equal(stream2.id(), 'req-replay');
});

test('resume_unavailable emitted when Last-Event-ID refers to unknown request ID', () => {
  resetSessionRing();
  const res = createMockResponse();
  const stream = createSceneEventStream(res, {
    requestId: 'req-cold',
    lastEventId: 'req-unknown:3',
    heartbeatMs: 60000,
  });

  assert.equal(stream.unavailable, true);
  assert.equal(res.ended, true);
  const unavailableChunk = res.chunks.find((c) =>
    c.includes('event: resume_unavailable'),
  );
  assert.ok(unavailableChunk, 'resume_unavailable should be emitted');
  assert.match(unavailableChunk, /unknown_session_or_cold_instance/);
});

test('abort signal stops further emissions and clears heartbeat', async () => {
  resetSessionRing();
  const res = createMockResponse();
  const controller = new AbortController();
  const stream = createSceneEventStream(res, {
    requestId: 'req-abort',
    heartbeatMs: 15,
    signal: controller.signal,
  });

  stream.emit('status', { stage: 'locating', text: 'Before abort' });
  assert.equal(res.chunks.length, 2);

  controller.abort();
  stream.emit('status', { stage: 'planning', text: 'After abort' });
  assert.equal(
    res.chunks.length,
    2,
    'Should not emit new events after abort signal',
  );

  await new Promise((r) => setTimeout(r, 40));
  const heartbeatsAfter = res.chunks.filter((c) => c === ': heartbeat\n\n');
  assert.equal(
    heartbeatsAfter.length,
    0,
    'No heartbeat should be sent after abort',
  );
  stream.close();
});

test('tokenizeNarration splits text into word-ish chunks of ~2-6 chars', () => {
  const text = 'Three walkers gather at the illustrated venue.';
  const tokens = tokenizeNarration(text);
  assert.ok(tokens.length >= 6);
  for (const token of tokens) {
    assert.ok(
      token.length >= 1 && token.length <= 6,
      `Token "${token}" has length ${token.length}`,
    );
  }
  assert.equal(tokens.join(''), text);
});
