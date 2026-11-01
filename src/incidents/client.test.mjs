import test from 'node:test';
import assert from 'node:assert/strict';
import { createIncidentClient } from './client.js';
const storage = { getItem: () => null, setItem() {} };

test('malformed successful response is an actionable request error, not a missing location', async () => {
  const client = createIncidentClient({ storage, fetch: async () => ({ ok: true, json: async () => { throw new SyntaxError('fixture invalid JSON'); } }) });
  await assert.rejects(client.locate('Dubai Marina'), /Invalid server response.*retry/i);
});
test('non-2xx responses retain their real HTTP status and message', async () => {
  const client = createIncidentClient({ storage, fetch: async () => ({ ok: false, status: 503, json: async () => ({ error: 'Location service temporarily unavailable' }) }) });
  await assert.rejects(client.locate('Dubai Marina'), e => e.status === 503 && /temporarily unavailable/.test(e.message));
});
test('valid live-shaped candidate response and cancellation signal pass through unchanged', async () => {
  const result = { candidates: [{ name: 'Dubai Marina', lat: 25.0786415, lon: 55.1352524, verified: true }], status: 'resolved' };
  const abort = new AbortController(); let init;
  const client = createIncidentClient({ storage, fetch: async (_url, options) => { init = options; return { ok: true, json: async () => result }; } });
  assert.equal(await client.locate('Dubai Marina', { signal: abort.signal }), result);
  assert.equal(init.signal, abort.signal);
  assert.equal(JSON.parse(init.body).text, 'Dubai Marina');
});

test('constructSceneStream streams SSE events and resolves on done', async () => {
  const events = [
    'id: r1:1\nevent: status\ndata: {"stage":"locating"}\n\n',
    'id: r1:2\nevent: done\ndata: {"result":{"ok":true,"plan":{"title":"Stream Scene"}}}\n\n',
  ];
  const stream = new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(new TextEncoder().encode(e));
      controller.close();
    },
  });
  let requestedUrl = null;
  let requestedHeaders = null;
  const client = createIncidentClient({
    storage,
    fetch: async (url, init) => {
      requestedUrl = url;
      requestedHeaders = init.headers;
      return {
        ok: true,
        headers: new Map([['content-type', 'text/event-stream']]),
        body: stream,
      };
    },
  });

  const received = [];
  const result = await client.constructSceneStream(
    { prompt: 'Dubai Marina' },
    {
      onEvent: (evt) => received.push(evt),
      lastEventId: 'r1:0',
    },
  );

  assert.match(requestedUrl, /\/scene-plans\/construct\/stream$/);
  assert.equal(requestedHeaders['Last-Event-ID'], 'r1:0');
  assert.equal(received.length, 2);
  assert.equal(received[0].event, 'status');
  assert.equal(received[1].event, 'done');
  assert.equal(result.ok, true);
  assert.equal(result.plan.title, 'Stream Scene');
});

