import test from 'node:test';
import assert from 'node:assert/strict';
import { runSceneEvidence, createEvidenceCache } from './pipeline.js';
import { createSources, parseRss, gdeltDate, parsePluginHits, oembedUrl, profileFromOembed, SourceError } from './sources.js';
import { createInference, inferenceEngine, deterministicIntent } from './inference.js';
import { createSceneEvidenceRoutes } from './routes.js';

const NOW = new Date('2026-10-24T06:00:00Z');
const quietInference = createInference({ engine: 'deterministic' });

function fakeSource(id, { kind = 'video', delay = 0, rows = [], fail, creds = [], configured = true, budgetMs = 1000 } = {}) {
  return {
    id, name: id, platforms: ['youtube'], kind, budgetMs, credentials: creds, docs: 'test',
    configured: () => configured,
    async run(ctx, emit) {
      await new Promise((r) => setTimeout(r, delay));
      if (fail) throw fail;
      for (const raw of rows) emit({ type: kind === 'signal' ? 'signal' : 'item', raw: { sourceId: id, sourceName: id, ...raw } });
      return { count: rows.length };
    },
  };
}
const noFetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

test('pipeline fans out in parallel, streams partials in arrival order, reports every source state', async () => {
  const events = [];
  const t0 = Date.now();
  const r = await runSceneEvidence(
    { place: 'Dubai Marina', lat: 25.08, lon: 55.14, windowHours: 72 },
    {
      now: NOW, env: {}, fetch: noFetch, inference: quietInference, defaultEndpointId: 'ep',
      cache: createEvidenceCache(),
      sources: [
        fakeSource('fast', { delay: 10, rows: [{ url: 'https://www.tiktok.com/@a/video/7690936936990592274', title: 'Dubai Marina walk' }] }),
        fakeSource('slow', { delay: 150, rows: [{ url: 'https://youtu.be/dQw4w9WgXcQ', title: 'unrelated', coords: { lat: 25.0801, lon: 55.1401 } }] }),
        fakeSource('hang', { delay: 5000, budgetMs: 200 }),
        fakeSource('boom', { delay: 5, fail: new SourceError('unavailable', 'quota exhausted') }),
        fakeSource('locked', { configured: false, creds: ['X_BEARER_TOKEN'] }),
        fakeSource('news', { kind: 'signal', delay: 20, rows: [{ title: 'Dubai Marina road closure', url: 'https://gulfnews.com/a', publishedAt: '2026-10-24T05:30:00Z' }] }),
      ],
      emit: (e, d) => events.push([e, d, Date.now() - t0]),
    },
  );
  assert.ok(Date.now() - t0 < 1500, 'parallel: total bounded by the slowest budget, not the sum');
  const order = events.filter(([e]) => e === 'item').map(([, d]) => d.id);
  assert.equal(order[0], 'tiktok:7690936936990592274'); // fast first (streamed before slow finished)
  const st = Object.fromEntries(r.sources.map((s) => [s.id, s.state]));
  assert.deepEqual(st, { fast: 'ok', slow: 'ok', hang: 'timeout', boom: 'unavailable', locked: 'credentials_required', news: 'ok' });
  assert.match(r.sources.find((s) => s.id === 'locked').note, /X_BEARER_TOKEN/);
  // ranking: exact geotag first, then text-inferred
  assert.deepEqual(r.items.map((x) => x.geo.precision), ['exact', 'text']);
  assert.equal(r.signals[0].freshness, 'LIVE');
  assert.equal(events[0][0], 'plan');
  assert.equal(events.at(-1)[0], 'done');
  assert.ok(events.some(([e]) => e === 'summary'));
  assert.ok(Number.isFinite(r.timings.firstItemMs) && r.timings.firstItemMs < r.timings.totalMs);
});

test('pipeline never substitutes data for unconfigured sources', async () => {
  const r = await runSceneEvidence({ place: 'Burj Khalifa', lat: 25.197, lon: 55.274 }, {
    now: NOW, env: {}, fetch: noFetch, inference: quietInference, emit() {},
    sources: [fakeSource('a', { configured: false, creds: ['YOUTUBE_API_KEY'], rows: [{ url: 'https://youtu.be/dQw4w9WgXcQ' }] })],
  });
  assert.equal(r.items.length, 0);
  assert.equal(r.sources[0].state, 'credentials_required');
});

test('per-scene cache: second request is served from cache with no source calls; fresh=1 bypasses', async () => {
  const cache = createEvidenceCache();
  let runs = 0;
  const src = { ...fakeSource('s', { rows: [{ url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Dubai Marina' }] }) };
  const orig = src.run;
  src.run = (...a) => (runs++, orig.apply(src, a));
  const deps = { now: NOW, env: {}, fetch: noFetch, inference: quietInference, cache, sources: [src], emit() {} };
  await runSceneEvidence({ place: 'Dubai Marina', lat: 25.08, lon: 55.14 }, deps);
  const events = [];
  const r2 = await runSceneEvidence({ place: 'Dubai Marina', lat: 25.08, lon: 55.14 }, { ...deps, emit: (e) => events.push(e) });
  assert.equal(runs, 1);
  assert.equal(r2.cached, true);
  assert.deepEqual(events, ['cached']);
  await runSceneEvidence({ place: 'Dubai Marina', lat: 25.08, lon: 55.14, fresh: true }, deps);
  assert.equal(runs, 2);
});

test('oEmbed enrichment adds public author fields and verifies embeds', async () => {
  const fetchImpl = async (url) => ({
    ok: true, status: 200,
    json: async () => (String(url).includes('tiktok.com/oembed') ? { title: 'Marina sunset', author_name: 'Dubai Amazing', author_url: 'https://www.tiktok.com/@dubai_amazing_world' } : {}),
  });
  const r = await runSceneEvidence({ place: 'Dubai Marina', lat: 25.08, lon: 55.14 }, {
    now: NOW, env: {}, fetch: fetchImpl, inference: quietInference, emit() {},
    sources: [fakeSource('s', { rows: [{ url: 'https://www.tiktok.com/@dubai_amazing_world/video/7690936936990592274', title: '' }] })],
  });
  const it = r.items[0];
  assert.equal(it.embedStatus, 'verified');
  assert.equal(it.author.name, 'Dubai Amazing');
  assert.equal(it.author.url, 'https://www.tiktok.com/@dubai_amazing_world');
  assert.ok(it.author.fields.includes('name'));
  assert.equal(it.title, 'Marina sunset');
});

test('source helpers: RSS, GDELT dates, plugin hits, oEmbed endpoints, profile mapping', () => {
  const rss = parseRss('<rss><item><title><![CDATA[A &amp; B]]></title><link>https://x.com/a</link><pubDate>Fri, 24 Oct 2026 05:00:00 GMT</pubDate><source url="u">Gulf News</source></item><item><title>bad</title><link>javascript:1</link></item></rss>');
  assert.deepEqual(rss, [{ title: 'A & B', url: 'https://x.com/a', outlet: 'Gulf News', publishedAt: '2026-10-24T05:00:00.000Z' }]);
  assert.equal(gdeltDate('20261023T113000Z'), '2026-10-23T11:30:00.000Z');
  assert.equal(gdeltDate('x'), null);
  assert.equal(parsePluginHits('blah [{"url":"https://youtu.be/dQw4w9WgXcQ","title":"t","published":"2026-10-01"}]')[0].publishedAt, '2026-10-01');
  assert.equal(parsePluginHits('see https://www.tiktok.com/@a/video/7690936936990592274.').length, 1);
  assert.match(oembedUrl('x', 'https://x.com/a/status/1'), /^https:\/\/publish\.x\.com\/oembed/);
  assert.match(oembedUrl('instagram', 'https://www.instagram.com/p/ABCDEFG/', { META_OEMBED_ACCESS_TOKEN: 't' }), /graph\.facebook\.com\/v21\.0\/instagram_oembed.*access_token=t/);
  assert.equal(profileFromOembed('tiktok', { author_name: 'N', author_url: 'https://www.tiktok.com/@nn' }).handle, 'nn');
});

test('source registry declares credentials for every official API and nothing hardcoded', () => {
  const s = createSources();
  const byId = Object.fromEntries(s.map((x) => [x.id, x]));
  assert.deepEqual(byId.youtube_data_api.credentials, ['YOUTUBE_API_KEY']);
  assert.deepEqual(byId.x_api_v2.credentials, ['X_BEARER_TOKEN']);
  assert.deepEqual(byId.instagram_graph.credentials, ['IG_GRAPH_ACCESS_TOKEN', 'IG_BUSINESS_USER_ID']);
  assert.deepEqual(byId.tiktok_research.credentials, ['TIKTOK_RESEARCH_CLIENT_KEY', 'TIKTOK_RESEARCH_CLIENT_SECRET']);
  assert.deepEqual(byId.reliefweb.credentials, ['RELIEFWEB_APPNAME']);
  for (const x of s) assert.equal(x.configured({}), x.credentials.length === 0, x.id);
  for (const x of s) assert.ok(x.budgetMs > 0 && x.budgetMs <= 25_000, `${x.id} budget`);
});

test('inference: engine selection, deterministic fallback on failure, never a data source', async () => {
  assert.equal(inferenceEngine({}), 'deterministic');
  assert.equal(inferenceEngine({}, { hasOnDemand: true }), 'cerebras-ondemand');
  assert.equal(inferenceEngine({ CEREBRAS_API_KEY: 'k' }, { hasOnDemand: true }), 'cerebras-direct');
  assert.equal(inferenceEngine({ CEREBRAS_API_KEY: 'k', SCENE_EVIDENCE_CEREBRAS: 'off' }), 'deterministic');
  assert.equal(deterministicIntent('burj khalifa check if there is any incidents').place.toLowerCase(), 'burj khalifa');
  const ok = createInference({ env: { CEREBRAS_API_KEY: 'k' }, fetch: async (url, init) => {
    assert.equal(url, 'https://api.cerebras.ai/v1/chat/completions');
    assert.match(init.headers.authorization, /^Bearer k$/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"place":"Burj Khalifa","aliases":["برج خليفة"],"intent":"incident_search","windowHours":24}' } }] }) };
  } });
  const p = await ok.parseIntent('burj khalifa any incidents last 24h');
  assert.equal(p.engine, 'cerebras-direct');
  assert.deepEqual(p.aliases, ['برج خليفة']);
  assert.equal(p.windowHours, 24);
  const bad = createInference({ env: { CEREBRAS_API_KEY: 'k' }, fetch: async () => ({ ok: false, status: 500 }) });
  const f = await bad.parseIntent('Dubai Marina');
  assert.equal(f.engine, 'deterministic');
  assert.match(f.fallback, /cerebras_http_500/);
  const s = await bad.summarize({ place: 'X', items: [{ freshness: 'STALE', geo: { precision: 'text' }, platform: 'youtube', title: 't' }], signals: [], sources: [] });
  assert.equal(s.engine, 'deterministic');
});

function mockRes() {
  const chunks = [];
  return { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, flushHeaders() {}, write(c) { chunks.push(String(c)); }, end(c) { if (c) chunks.push(String(c)); this.ended = true; }, chunks };
}

test('routes: SSE stream, sources listing, cache lookup, validation', async () => {
  const sources = [fakeSource('s', { rows: [{ url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Dubai Marina' }] }), fakeSource('locked', { configured: false, creds: ['X_BEARER_TOKEN'] })];
  const h = createSceneEvidenceRoutes({ env: {}, fetch: noFetch, sources, inference: quietInference, invoke: async () => ({ answer: '' }) });
  const url = (q) => new URL(`http://x/api/ondemand/v2/scene/evidence${q}`);
  const req = { headers: {}, on() {}, off() {} };
  let res = mockRes();
  assert.equal(await h(req, res, { path: '/scene/evidence', method: 'GET', url: url('?place=Dubai%20Marina&lat=25.08&lon=55.14') }), true);
  assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');
  const body = res.chunks.join('');
  assert.match(body, /event: plan/);
  assert.match(body, /event: item/);
  assert.match(body, /event: done/);
  assert.match(body, /credentials_required/);
  res = mockRes();
  await h(req, res, { path: '/scene/evidence/sources', method: 'GET', url: url('/sources') });
  const listed = JSON.parse(res.chunks.join('') || '{}');
  assert.ok(listed.sources || res.statusCode);
  res = mockRes();
  await h(req, res, { path: '/scene/evidence', method: 'GET', url: url('') });
  assert.equal(res.statusCode, 400);
  res = mockRes();
  await h(req, res, { path: '/scene/evidence', method: 'GET', url: url('?place=x&lat=500&lon=1') });
  assert.equal(res.statusCode, 400);
  const key = (body.match(/"key":"([^"]+)"/) || [])[1];
  res = mockRes();
  await h(req, res, { path: '/scene/evidence/cache', method: 'GET', url: url(`/cache?key=${encodeURIComponent(key)}`) });
  assert.equal(res.statusCode, 200);
  assert.equal(await h(req, mockRes(), { path: '/scene/videos', method: 'GET', url: url('') }), false);
});
