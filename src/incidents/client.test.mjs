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
