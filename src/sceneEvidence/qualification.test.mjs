import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyRecording, resolveEvidenceWindow, measureMediaGeometry, zonedInstant } from './qualification.js';
import { buildEvidenceItem, parsePostUrl, evidenceKey } from './model.js';
const now = new Date('2026-10-24T06:00:00Z');
const ctx = { now, anchor: { lat: 25.08, lon: 55.14 }, radiusKm: 5, window: resolveEvidenceWindow({}, now) };
const record = () => ({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', mediaType: 'video',
  evidence: { kind: 'provider-record', verified: true },
  mediaLocation: { sourceVerified: true, field: 'recordingDetails.location', basis: 'recording-location', geometry: { type: 'Point', coordinates: [55.14, 25.08] } },
  recordingTime: { sourceVerified: true, basis: 'recorded', field: 'recordingDetails.recordingDate', precision: 'second', value: '2026-10-24T05:30:00Z' },
  playback: { authorized: true, type: 'official-embed' },
});
test('strict recording: source-backed location/time/video/authorized embed is eligible', () => {
  const q = qualifyRecording(record(), ctx); assert.equal(q.eligible, true); assert.equal(q.freshness, 'RECENT'); assert.equal(q.measurement.distanceKm, 0);
});
for (const [name, mutate, reason] of [
  ['model answer cannot verify facts', r => { r.evidence = { kind: 'discovery-answer', verified: true }; }, 'unverified_provider_record'],
  ['publication time is not recording time', r => { r.publishedAt = r.recordingTime.value; delete r.recordingTime; }, 'missing_recording_time'],
  ['retrieval time is not recording time', r => { r.fetchedAt = r.recordingTime.value; delete r.recordingTime; }, 'missing_recording_time'],
  ['tweet creation is not recording time', r => { r.recordingTime.basis = 'publication'; }, 'missing_recording_time'],
  ['profile coordinates are not recording coordinates', r => { r.mediaLocation.basis = 'author-profile'; }, 'missing_media_location'],
  ['caption and search centroid do not establish location', r => { delete r.mediaLocation; r.title = 'Dubai Marina'; r.coords = ctx.anchor; }, 'missing_media_location'],
  ['latitude range', r => { r.mediaLocation.geometry.coordinates[1] = 91; }, 'invalid_media_location'],
  ['longitude range', r => { r.mediaLocation.geometry.coordinates[0] = 181; }, 'invalid_media_location'],
  ['string coordinates rejected', r => { r.mediaLocation.geometry.coordinates[0] = '55.14'; }, 'invalid_media_location'],
  ['recording outside radius', r => { r.mediaLocation.geometry.coordinates[0] = 56; }, 'outside_aoi'],
  ['recording uncertainty crosses radius', r => { r.mediaLocation.uncertaintyKm = 10; }, 'imprecise_media_location'],
  ['future recording time', r => { r.recordingTime.value = '2026-10-24T07:00:00Z'; }, 'invalid_recording_time'],
  ['ambiguous timezone', r => { r.recordingTime.value = '2026-10-24T05:30:00'; }, 'invalid_recording_time'],
  ['invalid calendar date', r => { r.recordingTime.value = '2026-02-30T05:30:00Z'; }, 'invalid_recording_time'],
  ['old recording remains old despite new publication', r => { r.recordingTime.value = '2026-09-01T05:30:00Z'; r.publishedAt = now.toISOString(); }, 'outside_time_window'],
  ['date-only precision cannot certify this hour', r => { r.recordingTime.value = '2026-10-24T00:00:00Z'; r.recordingTime.precision = 'day'; }, 'imprecise_recording_time'],
  ['no proof of video media type', r => { r.mediaType = 'post'; }, 'not_video'],
  ['expired playback authorization not silently refreshed', r => { r.playback.authorized = false; }, 'playback_not_authorized'],
]) test(`strict recording rejects ${name}`, () => { const r = record(); mutate(r); const q = qualifyRecording(r, ctx); assert.equal(q.eligible, false); assert.ok(q.reasons.includes(reason), JSON.stringify(q)); });
test('timezone boundaries compare actual instants and exclude upper boundary', () => {
  const r = record(); r.recordingTime.value = '2026-10-24T09:30:00+04:00'; assert.equal(qualifyRecording(r, ctx).eligible, true);
  r.recordingTime.value = '2026-10-24T10:00:00+04:00'; assert.ok(qualifyRecording(r, ctx).reasons.includes('outside_time_window'));
});
test('historical footage only qualifies in an explicitly matching historical interval', () => {
  const r = record(); r.recordingTime.value = '2026-09-01T05:30:00Z';
  assert.equal(qualifyRecording(r, ctx).eligible, false);
  const window = resolveEvidenceWindow({ timeMode: 'historical', windowStart: '2026-09-01T00:00:00Z', windowEnd: '2026-09-02T00:00:00Z' }, now);
  const q = qualifyRecording(r, { ...ctx, window }); assert.equal(q.eligible, true); assert.equal(q.freshness, 'HISTORICAL');
});
test('broad area overlapping AOI remains imprecise, not exact centroid', () => {
  const r = record(); r.mediaLocation.geometry = { type: 'Polygon', coordinates: [[[54,24],[56,24],[56,26],[54,26],[54,24]]] };
  const q = qualifyRecording(r, ctx); assert.equal(q.measurement.distanceKm, 0); assert.equal(q.measurement.lat, null); assert.ok(q.reasons.includes('imprecise_media_location'));
});
test('small area contained by AOI uses polygon-edge distance, never a point', () => {
  const g = { type: 'Polygon', coordinates: [[[55.139,25.079],[55.141,25.079],[55.141,25.081],[55.139,25.081],[55.139,25.079]]] };
  const m = measureMediaGeometry(g, ctx.anchor); assert.equal(m.precision, 'area'); assert.equal(m.distanceKm, 0); assert.equal(m.lon, null); assert.ok(m.maxDistanceKm < 1);
});
test('cache identity varies by AOI text, time window and historical interval', () => {
  const a = { sceneId: 'same', place: 'Dubai', lat: 25, lon: 55 };
  assert.notEqual(evidenceKey(a), evidenceKey({ ...a, text: 'airport fire' }));
  assert.notEqual(evidenceKey(a), evidenceKey({ ...a, windowHours: 24 }));
  assert.notEqual(evidenceKey(a), evidenceKey({ ...a, timeMode: 'historical', windowStart: '2026-01-01T00:00:00Z' }));
});
for (const url of ['https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ','https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ','https://user:password@www.youtube.com/watch?v=dQw4w9WgXcQ','http://www.youtube.com/watch?v=dQw4w9WgXcQ','https://www.youtube.com:444/watch?v=dQw4w9WgXcQ']) test('post URL refuses spoofing: ' + url.replace(/user:password/, 'userinfo'), () => assert.equal(parsePostUrl(url), null));
test('normalization never derives recording time/author/location from discovery text', () => {
  const item = buildEvidenceItem({ url: 'https://www.tiktok.com/@public/video/7690936936990592274', publishedAt: now.toISOString(), title: 'Dubai Marina', author: { name: 'claimed name' }, coords: ctx.anchor }, { ...ctx, place: 'Dubai Marina' });
  assert.equal(item.eligible, false); assert.equal(item.recordedAt, null); assert.equal(item.publishedAt, null); assert.equal(item.geo.lat, null); assert.deepEqual(item.author.fields, []); assert.equal(item.embedUrl, null);
});
test('invalid/reversed/future or unzoned historical intervals fail closed', () => {
  for (const q of [{ windowHours: -1 }, { windowHours: 169 }, { timeMode: 'bad' }, { timeMode: 'historical', windowStart: '2026-10-24T07:00:00Z', windowEnd: '2026-10-24T08:00:00Z' }]) assert.throws(() => resolveEvidenceWindow(q, now));
  assert.equal(zonedInstant('not-a-date'), null);
});
