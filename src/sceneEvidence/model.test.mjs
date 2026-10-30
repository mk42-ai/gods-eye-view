import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFreshness,
  tiktokIdDate,
  xIdDate,
  instagramShortcodeDate,
  parsePostUrl,
  scoreGeo,
  buildEvidenceItem,
  rankEvidence,
  dedupeEvidence,
  filterEvidence,
  refreshFreshness,
  sanitizeForCache,
  diffEvidence,
  evidenceKey,
  buildSignal,
  deterministicSummary,
  publicProfile,
  mentionsPlace,
} from './model.js';

const NOW = new Date('2026-10-24T06:00:00Z');
const H = 3_600_000;
const at = (hoursAgo) => new Date(NOW.getTime() - hoursAgo * H).toISOString();

test('freshness classes: LIVE <1h, RECENT <72h, STALE <30d, ARCHIVAL beyond/undated/future', () => {
  assert.equal(classifyFreshness(at(0.5), NOW).freshness, 'LIVE');
  assert.equal(classifyFreshness(at(1), NOW).freshness, 'RECENT'); // exclusive bound
  assert.equal(classifyFreshness(at(71.9), NOW).freshness, 'RECENT');
  assert.equal(classifyFreshness(at(72), NOW).freshness, 'STALE');
  assert.equal(classifyFreshness(at(719), NOW).freshness, 'STALE');
  assert.equal(classifyFreshness(at(720), NOW).freshness, 'ARCHIVAL');
  const u = classifyFreshness(null, NOW);
  assert.equal(u.freshness, 'ARCHIVAL');
  assert.equal(u.undated, true);
  assert.equal(classifyFreshness(at(-5), NOW).freshness, 'ARCHIVAL');
  assert.equal(classifyFreshness('not a date', NOW).undated, true);
});

test('id-derived dates (TikTok / X snowflakes, Instagram shortcode)', () => {
  assert.equal(tiktokIdDate('7690936936990592274'), '2026-09-29T12:43:17.000Z');
  assert.equal(xIdDate('507185938620219395'), '2014-09-03T15:18:45.483Z');
  assert.equal(instagramShortcodeDate('DO-zCYMjPV2'), '2025-09-24T10:13:06.162Z');
  assert.equal(instagramShortcodeDate('C1'), null); // too short: not a media shortcode
  assert.equal(tiktokIdDate('abc'), null);
});

test('parsePostUrl recognises the four platforms and builds official embed URLs', () => {
  const yt = parsePostUrl('https://youtu.be/dQw4w9WgXcQ?t=3');
  assert.equal(yt.platform, 'youtube');
  assert.match(yt.embedUrl, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  const tt = parsePostUrl('https://www.tiktok.com/@dubai_amazing_world/video/7690936936990592274?lang=en');
  assert.equal(tt.platform, 'tiktok');
  assert.equal(tt.handle, 'dubai_amazing_world');
  assert.match(tt.embedUrl, /tiktok\.com\/player\/v1\/7690936936990592274/);
  const ig = parsePostUrl('https://www.instagram.com/reels/DO-zCYMjPV2');
  assert.equal(ig.platform, 'instagram');
  assert.equal(ig.url, 'https://www.instagram.com/reel/DO-zCYMjPV2/');
  assert.equal(ig.embedUrl, 'https://www.instagram.com/reel/DO-zCYMjPV2/embed/');
  const x = parsePostUrl('https://twitter.com/DubaiPoliceHQ/status/1849000000000000000');
  assert.equal(x.platform, 'x');
  assert.match(x.embedUrl, /platform\.twitter\.com\/embed\/Tweet\.html\?id=1849000000000000000/);
  assert.equal(parsePostUrl('https://www.instagram.com/icdubaimarina'), null); // a profile is not a post
  assert.equal(parsePostUrl('https://example.com/video'), null);
});

test('geo precision never upgrades: exact only with coordinates; place/text pins are approximate', () => {
  const anchor = { lat: 25.08, lon: 55.14 };
  const ex = scoreGeo({ coords: { lat: 25.0801, lon: 55.1402 }, anchor });
  assert.equal(ex.precision, 'exact');
  assert.equal(ex.approximate, false);
  const pl = scoreGeo({ placeTag: { name: 'Dubai Marina' }, anchor });
  assert.equal(pl.precision, 'place');
  assert.equal(pl.approximate, true);
  assert.equal(pl.lat, null); // place tags must not borrow the AOI centroid
  const tx = scoreGeo({ text: 'Walking tour of Dubai Marina at night', place: 'Dubai Marina', anchor });
  assert.equal(tx.precision, 'text');
  assert.equal(tx.approximate, true);
  assert.ok(tx.confidence < pl.confidence && pl.confidence < ex.confidence);
  const no = scoreGeo({ text: 'Best beaches in Spain', place: 'Dubai Marina', anchor });
  assert.equal(no.precision, 'none');
  assert.equal(no.lat, null);
  assert.equal(mentionsPlace('Burj-Khalifa fireworks', 'Burj Khalifa'), true);
  assert.equal(mentionsPlace('marinade recipe', 'Marina'), false);
});

test('buildEvidenceItem derives dates from ids, flags window membership, keeps provenance', () => {
  const it = buildEvidenceItem(
    { url: 'https://www.tiktok.com/@x/video/7690936936990592274', title: 'Dubai Marina 4K', sourceId: 'tavily', sourceName: 'Tavily', via: 'OnDemand plugin-1740745780', query: 'site:tiktok.com Dubai Marina' },
    { now: NOW, place: 'Dubai Marina', anchor: { lat: 25.08, lon: 55.14 }, windowHours: 72 },
  );
  assert.equal(it.id, 'tiktok:7690936936990592274');
  assert.equal(it.dateSource, null);
  assert.equal(it.recordedAt, null);
  assert.equal(it.freshness, 'UNVERIFIED');
  assert.equal(it.inWindow, false);
  assert.equal(it.geo.precision, 'text');
  assert.equal(it.source.via, 'OnDemand plugin-1740745780');
  assert.equal(it.author.handle, undefined); // URL claim is not a sourced author record
  assert.equal(buildEvidenceItem({ url: 'https://example.com' }, { now: NOW }), null);
});

test('ranking: geo precision first, then freshness, then recency', () => {
  const mk = (id, precision, freshness, publishedAt) => ({ id, geo: { precision }, freshness, publishedAt });
  const ranked = rankEvidence([
    mk('a', 'text', 'LIVE', at(0.2)),
    mk('b', 'exact', 'ARCHIVAL', at(9000)),
    mk('c', 'place', 'RECENT', at(5)),
    mk('d', 'place', 'RECENT', at(2)),
    mk('e', 'none', 'LIVE', at(0.1)),
  ]);
  assert.deepEqual(ranked.map((x) => x.id), ['b', 'd', 'c', 'a', 'e']);
  assert.deepEqual(ranked.map((x) => x.rank), [1, 2, 3, 4, 5]);
});

test('dedupe merges same post id and collapses same-author near-identical reposts', () => {
  const base = { platform: 'youtube', freshness: 'STALE', publishedAt: null, author: { handle: 'chan', fields: ['handle'] } };
  const out = dedupeEvidence([
    { ...base, id: 'youtube:1', title: 'Dubai Marina night walk 4K', geo: { precision: 'none' }, source: { id: 's1' } },
    { ...base, id: 'youtube:1', title: 'Dubai Marina night walk 4K', geo: { precision: 'text' }, source: { id: 's2' } },
    { ...base, id: 'youtube:2', title: 'Dubai Marina night walk 4K', geo: { precision: 'text' }, source: { id: 's1' } },
    { ...base, id: 'youtube:3', title: 'Completely different video about JBR beach', geo: { precision: 'text' }, source: { id: 's1' } },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].geo.precision, 'text');
  assert.deepEqual(out[0].duplicates, ['youtube:2']);
});

test('filters by geo precision and freshness; refreshFreshness ages cached items', () => {
  const items = [
    { id: 'a', geo: { precision: 'text' }, freshness: 'RECENT', publishedAt: at(2) },
    { id: 'b', geo: { precision: 'none' }, freshness: 'ARCHIVAL', publishedAt: null },
  ];
  assert.deepEqual(filterEvidence(items, { precisions: ['text'] }).map((x) => x.id), ['a']);
  assert.deepEqual(filterEvidence(items, { freshness: ['ARCHIVAL'] }).map((x) => x.id), ['b']);
  assert.equal(filterEvidence(items, {}).length, 2);
  const later = new Date(NOW.getTime() + 80 * H);
  assert.equal(refreshFreshness(items, later)[0].freshness, 'STALE');
});

test('Instagram cache sanitisation drops metadata Meta forbids persisting', () => {
  const ig = buildEvidenceItem(
    { url: 'https://www.instagram.com/reel/DO-zCYMjPV2/', title: 'caption text', author: { name: 'n', handle: 'dubai.travelers' } },
    { now: NOW },
  );
  const s = sanitizeForCache(ig);
  assert.equal(s.id, ig.id);
  assert.equal(s.url, ig.url);
  assert.doesNotMatch(s.title, /caption text/);
  assert.deepEqual(s.author.fields, []);
  const yt = buildEvidenceItem({ url: 'https://youtu.be/dQw4w9WgXcQ', title: 'kept' }, { now: NOW });
  assert.equal(sanitizeForCache(yt).title, 'kept');
});

test('diffEvidence reports added / removed / changed against a cached scene', () => {
  const prev = [
    { id: 'a', freshness: 'RECENT', publishedAt: 'x', geo: { precision: 'text' } },
    { id: 'b', freshness: 'STALE', publishedAt: 'y', geo: { precision: 'none' } },
  ];
  const next = [
    { id: 'a', freshness: 'STALE', publishedAt: 'x', geo: { precision: 'text' } },
    { id: 'c', freshness: 'LIVE', publishedAt: 'z', geo: { precision: 'exact' } },
  ];
  const d = diffEvidence(prev, next);
  assert.deepEqual(d.added, ['c']);
  assert.deepEqual(d.removed, ['b']);
  assert.deepEqual(d.changed, [{ id: 'a', fields: ['freshness'] }]);
  assert.equal(d.unchanged, 0);
});

test('evidenceKey is stable and scene-scoped', () => {
  assert.equal(evidenceKey({ place: 'Dubai Marina', lat: 25.07861, lon: 55.13531 }), 'place:dubai-marina|25.079,55.135|r5|w1|q:dubai-marina|recent|||source-recording-v2');
  assert.equal(evidenceKey({ sceneId: 'geo-1', lat: 1, lon: 2, windowHours: 24 }), 'scene:geo-1|1.000,2.000|r5|w24|q:|recent|||source-recording-v2');
});

test('signals, public profile whitelist and deterministic summary', () => {
  const s = buildSignal({ url: 'https://gulfnews.com/a', title: 'Road closure near Dubai Marina', outlet: 'Gulf News', publishedAt: at(3) }, { now: NOW, place: 'Dubai Marina' });
  assert.equal(s.freshness, 'CONTEXT');
  assert.equal(s.publicationFreshness, 'RECENT');
  assert.equal(s.geo.precision, 'text');
  assert.equal(buildSignal({ url: 'javascript:alert(1)', title: 'x' }), null);
  const p = publicProfile({ name: 'Dubai Police', handle: '@DubaiPoliceHQ', followers: '0', email: 'private@x', phone: '1' }, 'oEmbed');
  assert.deepEqual(p.fields, ['name', 'handle', 'followers']);
  assert.equal(p.email, undefined);
  assert.equal(p.handle, 'DubaiPoliceHQ');
  const sum = deterministicSummary({ place: 'Dubai Marina', items: [{ freshness: 'STALE', geo: { precision: 'text' } }], signals: [s], sources: [{ state: 'ok' }, { state: 'credentials_required' }] });
  assert.equal(sum.engine, 'deterministic-policy');
  assert.match(sum.text, /0 source-verified/);
  assert.match(sum.text, /No verified recent footage/);
  assert.match(sum.text, /1 unverified context/);
});
