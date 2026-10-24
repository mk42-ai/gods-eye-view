import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState,
  applyEvent,
  visibleItems,
  toggleFilter,
  saveSceneEvidence,
  loadSceneEvidence,
  diffAgainstCache,
  listCachedScenes,
  encodeShare,
  decodeShare,
} from './store.js';
import { buildEvidenceItem } from './model.js';
import { createSceneEvidencePanel, timelinePosition, formatAge } from './panel.js';

const NOW = new Date('2026-10-24T06:00:00Z');
const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
};
const item = (url, title, extra = {}) => buildEvidenceItem({ url, title, ...extra }, { now: NOW, place: 'Dubai Marina', anchor: { lat: 25.08, lon: 55.14 } });

test('reducer: plan → items stream in ranked → done; first-card timing recorded', () => {
  let s = initialState({ place: 'Dubai Marina', lat: 25.08, lon: 55.14 });
  s.client.startedAt = 1000;
  s = applyEvent(s, 'plan', { key: 'k', place: 'Dubai Marina', sources: [{ id: 'a', state: 'running' }, { id: 'b', state: 'credentials_required' }] }, 1100);
  assert.equal(s.phase, 'streaming');
  s = applyEvent(s, 'item', item('https://youtu.be/dQw4w9WgXcQ', 'random'), 2500);
  assert.equal(s.client.firstCardMs, 1500);
  s = applyEvent(s, 'item', item('https://www.tiktok.com/@a/video/7690936936990592274', 'Dubai Marina walk'), 3000);
  assert.equal(s.items[0].platform, 'tiktok'); // text geo outranks none
  s = applyEvent(s, 'source', { id: 'a', state: 'ok', count: 2 }, 3100);
  assert.equal(s.sources.find((x) => x.id === 'a').state, 'ok');
  s = applyEvent(s, 'signal', { id: 's1', title: 't', publishedAt: '2026-10-24T05:00:00Z' }, 3200);
  assert.equal(s.client.firstSignalMs, 2200);
  s = applyEvent(s, 'done', { key: 'k', items: s.items, signals: s.signals, sources: s.sources, timings: { totalMs: 4000 } }, 5000);
  assert.equal(s.phase, 'done');
  assert.equal(s.client.doneMs, 4000);
});

test('filters toggle and apply', () => {
  let s = initialState({});
  s = applyEvent(s, 'item', item('https://youtu.be/dQw4w9WgXcQ', 'random'));
  s = applyEvent(s, 'item', item('https://www.tiktok.com/@a/video/7690936936990592274', 'Dubai Marina walk'));
  s = toggleFilter(s, 'precisions', 'text');
  assert.deepEqual(visibleItems(s).map((x) => x.platform), ['tiktok']);
  s = toggleFilter(s, 'precisions', 'text');
  assert.equal(visibleItems(s).length, 2);
});

test('scene cache: save → reload re-ages freshness; diff on rebuild; Instagram metadata stripped', () => {
  const st = memStorage();
  let s = initialState({ place: 'Dubai Marina', lat: 25.08, lon: 55.14 });
  s = applyEvent(s, 'item', item('https://www.instagram.com/reel/DO-zCYMjPV2/', 'secret caption', { author: { name: 'n' } }));
  s = applyEvent(s, 'item', item('https://www.tiktok.com/@a/video/7690936936990592274', 'Dubai Marina walk'));
  s = applyEvent(s, 'done', { items: s.items, signals: [], sources: [] });
  assert.equal(saveSceneEvidence(st, s, NOW.getTime()), true);
  assert.doesNotMatch(st._m.get('gev.sceneEvidence.v1'), /secret caption/);
  const back = loadSceneEvidence(st, s.key, NOW);
  assert.equal(back.items.length, 2);
  assert.ok(back.cachedAt);
  assert.equal(listCachedScenes(st)[0].items, 2);
  let s2 = initialState({ place: 'Dubai Marina', lat: 25.08, lon: 55.14, fresh: true });
  s2 = applyEvent(s2, 'item', item('https://www.tiktok.com/@a/video/7690936936990592274', 'Dubai Marina walk'));
  s2 = applyEvent(s2, 'item', item('https://youtu.be/dQw4w9WgXcQ', 'Dubai Marina new'));
  s2 = applyEvent(s2, 'done', { items: s2.items, signals: [], sources: [] });
  const d = diffAgainstCache(st, s2);
  assert.deepEqual(d.added, ['youtube:dQw4w9WgXcQ']);
  assert.deepEqual(d.removed, ['instagram:DO-zCYMjPV2']);
});

test('share links round-trip and reject junk', () => {
  const enc = encodeShare({ place: 'Burj Khalifa', lat: 25.1972, lon: 55.2744, windowHours: 24, sceneId: 'geo-x' });
  const dec = decodeShare(enc);
  assert.deepEqual(dec, { place: 'Burj Khalifa', lat: 25.1972, lon: 55.2744, windowHours: 24, sceneId: 'geo-x' });
  assert.equal(decodeShare('%7Bbad'), null);
  assert.equal(decodeShare(encodeURIComponent(JSON.stringify({ p: '' }))), null);
  assert.equal(decodeShare(encodeURIComponent(JSON.stringify({ p: 'x', a: 999, o: 1 }))).lat, undefined);
});

test('timeline position is log-scaled with now at the right', () => {
  assert.equal(timelinePosition(0), 100);
  assert.equal(timelinePosition(8760), 0);
  assert.ok(timelinePosition(1) > timelinePosition(72));
  assert.equal(timelinePosition(null), null);
  assert.equal(formatAge(0.5), '30 min ago');
  assert.equal(formatAge(100), '4 d ago');
});

// ---------------------------------------------------------------- panel over a tiny DOM
function makeDoc() {
  const mk = (tag) => {
    const listeners = new Map();
    const node = {
      tagName: tag.toUpperCase(), children: [], attrs: new Map(), dataset: {}, style: {}, textContent: '', hidden: false,
      set className(v) { this.attrs.set('class', v); }, get className() { return this.attrs.get('class') || ''; },
      set id(v) { this.attrs.set('id', v); }, get id() { return this.attrs.get('id'); },
      setAttribute(k, v) { this.attrs.set(k, String(v)); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); },
      getAttribute(k) { return this.attrs.get(k) ?? null; },
      append(...k) { for (const c of k) this.appendChild(c); },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      replaceChildren(...k) { this.children = []; for (const c of k) this.appendChild(c); },
      addEventListener(t, f) { listeners.set(t, [...(listeners.get(t) || []), f]); },
      dispatch(t, e = {}) { for (const f of listeners.get(t) || []) f({ stopPropagation() {}, ...e }); },
      remove() {},
    };
    return node;
  };
  return { createElement: mk, body: mk('body') };
}
const find = (n, pred) => { if (pred(n)) return n; for (const c of n.children || []) { const r = find(c, pred); if (r) return r; } return null; };
const all = (n, pred, out = []) => { if (pred(n)) out.push(n); for (const c of n.children || []) all(c, pred, out); return out; };

function sseBody(events) {
  const text = events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  let done = false;
  return { getReader: () => ({ read: async () => (done ? { done: true } : ((done = true), { value: bytes, done: false })) }) };
}

test('panel: streams SSE into cards, source status shows credentials-required, card click loads lazy embed, profile popup shows only public fields', async () => {
  const doc = makeDoc();
  const st = memStorage();
  const it1 = item('https://www.tiktok.com/@dubai_amazing_world/video/7690936936990592274', 'Dubai Marina 4K', { author: { name: 'Dubai Amazing', url: 'https://www.tiktok.com/@dubai_amazing_world', followers: 1200, source: 'tiktok oEmbed' } });
  const events = [
    ['plan', { key: 'k1', place: 'Dubai Marina', sources: [{ id: 'od_search_tiktok', name: 'TikTok', state: 'running' }, { id: 'x_api_v2', name: 'X API', state: 'credentials_required', credentials: ['X_BEARER_TOKEN'] }] }],
    ['item', it1],
    ['source', { id: 'od_search_tiktok', state: 'ok', count: 1, ms: 5000 }],
    ['signal', { id: 's', title: 'Road closure near Dubai Marina', url: 'https://gulfnews.com/a', outlet: 'Gulf News', publishedAt: '2026-10-24T03:00:00Z', freshness: 'RECENT', kind: 'news', source: { name: 'Google News RSS' }, geo: { precision: 'text' } }],
    ['summary', { text: 'One stale item.', engine: 'deterministic' }],
    ['done', { key: 'k1', place: 'Dubai Marina', items: [it1], signals: [], sources: [{ id: 'od_search_tiktok', name: 'TikTok', state: 'ok', count: 1 }, { id: 'x_api_v2', name: 'X API', state: 'credentials_required', credentials: ['X_BEARER_TOKEN'] }], timings: { totalMs: 6000 } }],
  ];
  let calls = 0;
  const panel = createSceneEvidencePanel({ document: doc, window: {}, storage: st, fetch: async () => (calls++, { ok: true, body: sseBody(events) }) });
  await panel.open({ text: 'Dubai Marina', place: 'Dubai Marina', lat: 25.08, lon: 55.14 });
  const root = panel.element;
  assert.equal(root.dataset.phase, 'done');
  const cards = all(root, (n) => n.className === 'sev-card');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].getAttribute('data-freshness'), 'STALE');
  assert.equal(cards[0].getAttribute('data-geo'), 'text');
  const geoBadge = find(cards[0], (n) => n.getAttribute?.('data-geo-badge'));
  assert.match(geoBadge.textContent, /^~TEXT-INFERRED 40%/); // approximate is labelled, never "exact"
  const credRow = find(root, (n) => n.getAttribute?.('data-source-id') === 'x_api_v2');
  assert.equal(credRow.getAttribute('data-state'), 'credentials_required');
  assert.match(find(credRow, (n) => n.className === 'sev__source-meta').textContent, /X_BEARER_TOKEN/);
  // first item auto-selected → embed iframe lazy
  const frame = find(root, (n) => n.tagName === 'IFRAME');
  assert.equal(frame.getAttribute('loading'), 'lazy');
  assert.match(frame.getAttribute('src'), /tiktok\.com\/player\/v1\/7690936936990592274/);
  // profile popup
  find(cards[0], (n) => n.className?.includes('sev-card__profile')).dispatch('click');
  const pop = find(root, (n) => n.id === 'scene-evidence-profile');
  assert.equal(pop.hidden, false);
  assert.ok(find(pop, (n) => n.className === 'sev__profile-followers'));
  assert.match(find(pop, (n) => n.className === 'sev__profile-note').textContent, /name, handle, url, followers/);
  assert.equal(find(pop, (n) => n.className === 'sev__profile-bio'), null); // not returned → not shown
  // reopen → served from the local cache with NO network call
  const before = calls;
  await panel.open({ text: 'Dubai Marina', place: 'Dubai Marina', lat: 25.08, lon: 55.14 }, { preferCache: true });
  assert.equal(calls, before);
  assert.equal(root.dataset.phase, 'cached');
});

test('panel: HTTP errors surface as an error state (no fabricated data)', async () => {
  const doc = makeDoc();
  const panel = createSceneEvidencePanel({ document: doc, window: {}, storage: memStorage(), fetch: async () => ({ ok: false, status: 503, text: async () => '{"error":"ondemand_not_configured"}' }) });
  await panel.open({ text: 'Dubai Marina', place: 'Dubai Marina', lat: 25.08, lon: 55.14 });
  assert.equal(panel.element.dataset.phase, 'error');
  assert.equal(panel.state.items.length, 0);
  assert.match(find(panel.element, (n) => n.id === 'scene-evidence-status').textContent, /HTTP 503/);
});
