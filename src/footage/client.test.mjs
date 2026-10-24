import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSseBlock, footageQueryString, createFootageClient } from './client.js';

test('footageQueryString encodes the contract params', () => {
  const qs = footageQueryString({ lat: 25.147, lon: 55.199, keywords: 'car crash', mode: 'rebuild', since: '2y', limit: 8 });
  const p = new URLSearchParams(qs);
  assert.equal(p.get('lat'), '25.1470');
  assert.equal(p.get('mode'), 'rebuild');
  assert.equal(p.get('since'), '2y');
  assert.equal(p.get('keywords'), 'car crash');
});

test('parseSseBlock reads event + JSON data', () => {
  assert.deepEqual(parseSseBlock('event: item\ndata: {"a":1}'), { event: 'item', data: { a: 1 } });
  assert.equal(parseSseBlock(': comment only'), null);
});

test('stream() dispatches frames from a chunked body', async () => {
  const frames = 'event: query\ndata: {"mode":"live"}\n\nevent: item\ndata: {"url":"u1"}\n\nevent: source_done\ndata: {"source":"youtube","status":"ok"}\n\nevent: done\ndata: {"ok":true}\n\n';
  const chunks = [frames.slice(0, 20), frames.slice(20, 61), frames.slice(61)];
  const body = {
    getReader() {
      let i = 0;
      return { read: async () => (i < chunks.length ? { value: new TextEncoder().encode(chunks[i++]), done: false } : { value: undefined, done: true }) };
    },
  };
  const client = createFootageClient({ fetch: async () => ({ ok: true, body }) });
  const seen = [];
  const done = await client.stream({ lat: 1, lon: 2 }, { onItem: (i) => seen.push(i.url), onSourceDone: (s) => seen.push(s.source) });
  assert.deepEqual(seen, ['u1', 'youtube']);
  assert.deepEqual(done, { ok: true });
});

test('stream() falls back to /search when the stream endpoint is not ok', async () => {
  const calls = [];
  const client = createFootageClient({
    fetch: async (url) => {
      calls.push(url);
      if (url.includes('/stream')) return { ok: false, body: null };
      return { ok: true, json: async () => ({ query: {}, sources: [{ source: 'youtube', status: 'ok' }], items: [{ url: 'x' }] }) };
    },
  });
  const items = [];
  const done = await client.stream({ lat: 1, lon: 2 }, { onItem: (i) => items.push(i) });
  assert.equal(items.length, 1);
  assert.equal(done.items.length, 1);
  assert.equal(calls.length, 2);
});
