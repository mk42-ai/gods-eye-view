import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeographicScene,
  createGeographicSceneStore,
  GEOGRAPHIC_SCENE_STORAGE_KEY,
  GEOGRAPHIC_SCENE_VERSION,
} from './geographicScene.js';
import { altitudeForZoom } from '../incidents/model.js';

// Synthetic fixture: intentionally not a claim that these are Dubai Marina coordinates.
const candidate = {
  name: 'Dubai Marina', lat: 23.456789, lon: 55.123456,
  verified: true, confidence: 0.91, source: 'geocode_place',
  aoi_membership: { inside: true, aoi_ids: ['uae'] },
};
const now = '2026-10-24T01:49:00.000Z';
const make = (change = {}) => buildGeographicScene({ candidate: { ...candidate, ...change }, now });
function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
  };
}
function distance(a, b) {
  const r = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

test('builds a distinctive incident-compatible geographic scene, not an incident', () => {
  const scene = make();
  assert.equal(scene.title, 'Dubai Marina — Waterfront Orbit');
  assert.equal(scene.version, GEOGRAPHIC_SCENE_VERSION);
  assert.equal(scene.geographic, true);
  assert.equal(scene.category, 'geographic');
  assert.equal(scene.aoi, 'uae');
  assert.deepEqual(scene.anchor, { name: candidate.name, lat: candidate.lat, lon: candidate.lon });
  for (const field of ['incident_ids', 'markers', 'evidence', 'timeline_events'])
    assert.deepEqual(scene[field], []);
  assert.equal(scene.preserveMapLabels, true);
  assert.equal(scene.imagerySynthesis, false);
});

test('pure stable identity ignores text, extraction, and creation time', () => {
  const scene = make();
  assert.deepEqual(make(), scene);
  const other = buildGeographicScene({ candidate, now: '2027-01-01',
    text: 'unverified claimed attack', extraction: { place: 'different place' } });
  assert.equal(other.id, scene.id);
  assert.equal(other.title, scene.title);
  assert.notEqual(other.createdAt, scene.createdAt);
  assert.equal(JSON.stringify(other).includes('claimed attack'), false);
});

test('identity distinguishes nearby coordinates, place names, and providers without hash truncation', () => {
  const scenes = [make(), make({ lat: candidate.lat + 1e-8 }),
    make({ lon: candidate.lon + 1e-8 }), make({ source: 'gazetteer' }),
    make({ name: 'Dubai Marina / East' }), make({ name: 'Dubai Marina % East' })];
  assert.equal(new Set(scenes.map((s) => s.id)).size, scenes.length);
  assert.ok(scenes.every((s) => s.id.startsWith('geo-scene-v1-')));
  assert.equal(make({ lat: -0 }).id, make({ lat: 0 }).id);
});

test('geocoder certainty is kept separate from incident certainty', () => {
  const scene = make({ confidence: 1 });
  assert.equal(scene.confidence, 'unverified');
  assert.deepEqual(scene.provenance, { kind: 'geocoder', source: 'geocode_place',
    confidence: 1, verified: true, incidentConfirmed: false });
  assert.match(scene.summary, /not a confirmed incident/);
  assert.ok(scene.steps.every((s) => s.landmarkVerified === false));
});

test('rejects unverified, contradicted, and model-only coordinate candidates', () => {
  for (const change of [ { verified: false }, { verified: undefined },
    { validated: false }, { verified: false, validated: true },
    { source: 'ondemand-entity-extraction', verified: true } ])
    assert.throws(() => make(change), /verified geocoder/);
  assert.throws(() => buildGeographicScene(), /verified geocoder/);
});

test('accepts explicitly validated candidates without inventing a confidence score', () => {
  const scene = make({ verified: undefined, validated: true, confidence: undefined });
  assert.equal(scene.provenance.confidence, null);
  assert.equal(make({ confidence: 0 }).provenance.confidence, 0);
  for (const confidence of [-1, 2, NaN, Infinity, '0.9'])
    assert.equal(make({ confidence }).provenance.confidence, null);
});

test('strictly rejects missing, nonnumeric, nonfinite and out-of-range coordinates', () => {
  for (const lat of [undefined, null, '', '23.4', NaN, Infinity, -91, 91])
    assert.throws(() => make({ lat }), /finite WGS84/);
  for (const lon of [undefined, null, '', '55.1', NaN, Infinity, -181, 181])
    assert.throws(() => make({ lon }), /finite WGS84/);
  assert.throws(() => make({ name: '' }), /resolved place name/);
});

test('has four deliberate distinct waypoints/bearings/heights and monotonic timing', () => {
  const { keyframes, steps } = make();
  assert.equal(keyframes.length, 4);
  assert.equal(steps.length, 4);
  assert.deepEqual(keyframes.map((k) => k.label), ['Basin overview',
    'Marina Walk waterfront', 'Inlet / JBR waterfront', 'Orbit closure']);
  assert.deepEqual(keyframes.map((k) => k.bearing), [30, 120, 210, 300]);
  assert.deepEqual(keyframes.map((k) => k.altitudeM), [2400, 1200, 900, 1800]);
  assert.deepEqual(keyframes.map((k) => k.timeOffsetSec), [0, 8, 18, 28]);
  assert.deepEqual(keyframes.map((k) => k.time), [0, 8 / 28, 18 / 28, 1]);
  assert.equal(steps.reduce((sum, s) => sum + s.durationSec, 0), 28);
});

test('computes a small-radius plan from the supplied anchor, not Dubai coordinates', () => {
  for (const anchor of [candidate, { ...candidate, lat: -33, lon: -71 },
    { ...candidate, lat: 0, lon: 179.999 }, { ...candidate, lat: 89.999, lon: 45 }]) {
    const scene = buildGeographicScene({ candidate: anchor, now });
    for (const [i, expected] of [0, 350, 650, 0].entries()) {
      assert.ok(Math.abs(distance(anchor, scene.keyframes[i]) - expected) < 0.1);
      assert.ok(distance(anchor, scene.keyframes[i]) < scene.aoiRadiusM);
      assert.ok(Number.isFinite(scene.keyframes[i].zoom));
      assert.ok(scene.keyframes[i].lon >= -180 && scene.keyframes[i].lon <= 180);
    }
  }
});

test('closes at the original anchor and encodes altitude for the existing incident adapter', () => {
  const scene = make();
  for (const frame of scene.keyframes) {
    assert.ok(Math.abs(altitudeForZoom(frame.zoom, frame.lat) - frame.altitudeM) < 1e-8);
  }
  assert.deepEqual(scene.keyframes.map((k) => [k.lat, k.lon]).at(-1),
    [scene.anchor.lat, scene.anchor.lon]);
  for (const [i, step] of scene.steps.entries()) {
    assert.equal(step.camera.alt, scene.keyframes[i].altitudeM);
    assert.equal(step.camera.heading, scene.keyframes[i].bearing);
    assert.equal(step.camera.altitudeReference, 'ellipsoid');
  }
});

test('timestamp is explicit UTC; omitted clock is deterministic rather than wall-clock dependent', () => {
  assert.equal(make().createdAt, now);
  assert.equal(buildGeographicScene({ candidate, now: new Date(now) }).createdAt, now);
  assert.equal(buildGeographicScene({ candidate }).createdAt, '1970-01-01T00:00:00.000Z');
  for (const value of ['not a date', null, {}, NaN])
    assert.throws(() => buildGeographicScene({ candidate, now: value }), /timestamp|Date/);
});

test('does not mutate or retain references to caller data', () => {
  const input = { ...candidate, aoi_membership: Object.freeze({ inside: true, aoi_ids: Object.freeze(['uae']) }) };
  Object.freeze(input);
  const scene = buildGeographicScene({ candidate: input, now });
  scene.anchor.name = 'Edited output';
  assert.equal(input.name, 'Dubai Marina');
  assert.equal(make().anchor.name, 'Dubai Marina');
});

test('uses resolved name for non-marina candidates, never requesting text or arbitrary provider URLs', () => {
  const scene = buildGeographicScene({ candidate: { ...candidate, name: 'Other Harbor',
    source: 'https://provider.test?api_key=SECRET', aoi_membership: undefined },
    text: 'Dubai Marina', extraction: { place: 'Dubai Marina' }, now });
  assert.equal(scene.title, 'Other Harbor — Geographic Orbit');
  assert.equal(scene.aoi, 'geographic');
  assert.equal(scene.provenance.source, 'geocoder');
  assert.ok(!JSON.stringify(scene).includes('SECRET'));
});

test('save/load/list survive re-creating the store and use a separate versioned namespace', () => {
  const storage = memoryStorage();
  storage.setItem('gev-scene-project', 'unrelated');
  const first = createGeographicSceneStore(storage);
  const scene = make();
  assert.deepEqual(first.list(), []);
  assert.equal(first.load(scene.id), null);
  assert.equal(first.save(scene).saved, true);
  const reloaded = createGeographicSceneStore(storage);
  assert.deepEqual(reloaded.load(scene.id), scene);
  assert.deepEqual(reloaded.list(), [scene]);
  assert.equal(storage.getItem('gev-scene-project'), 'unrelated');
});

test('rename persists title without changing identity or creating a duplicate', () => {
  const store = createGeographicSceneStore(memoryStorage());
  const scene = make();
  store.save(scene);
  const result = store.rename(scene.id, 'Evening marina orbit', { now: '2026-10-24T02:00:00Z' });
  assert.equal(result.saved, true);
  assert.equal(result.id, scene.id);
  assert.equal(store.list().length, 1);
  assert.equal(store.load(scene.id).title, 'Evening marina orbit');
  assert.equal(store.load(scene.id).updatedAt, '2026-10-24T02:00:00.000Z');
  assert.equal(store.load(scene.id).createdAt, now);
  assert.equal(store.rename('missing', 'Name').reason, 'not-found');
  for (const title of ['', '  ', 'x'.repeat(301), '\u0000bad'])
    assert.equal(store.rename(scene.id, title).reason, 'invalid-title');
  assert.equal(store.rename(scene.id, 'Good', { now: 'bad' }).reason, 'invalid-timestamp');
});

test('same title at distinct coordinates does not overwrite another cached scene', () => {
  const store = createGeographicSceneStore(memoryStorage());
  const a = make();
  const b = make({ lon: candidate.lon + 0.001 });
  assert.equal(a.title, b.title);
  assert.equal(store.save(a).saved, true);
  assert.equal(store.save(b).saved, true);
  assert.equal(store.list().length, 2);
  assert.deepEqual(store.load(a.id), a);
  assert.deepEqual(store.load(b.id), b);
  assert.equal(store.save(a).saved, true);
  assert.equal(store.list().length, 2);
});

test('quota failure is explicitly unsuccessful and leaves the previous persisted scene intact', () => {
  const storage = memoryStorage();
  const store = createGeographicSceneStore(storage);
  const scene = make();
  store.save(scene);
  storage.setItem = () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); };
  assert.deepEqual(store.rename(scene.id, 'Unsaved'), { saved: false, reason: 'quota-exceeded' });
  assert.equal(store.load(scene.id).title, scene.title);
  assert.equal(store.list().length, 1);
});

test('silent no-op storage cannot be reported as a successful save', () => {
  const storage = memoryStorage();
  storage.setItem = () => {};
  assert.deepEqual(createGeographicSceneStore(storage).save(make()),
    { saved: false, reason: 'write-not-persisted' });
});

test('missing, restricted and throwing storage fail gracefully without false saves', () => {
  for (const storage of [undefined, null, {}, { getItem() { throw new Error('denied'); }, setItem() {} }]) {
    const store = createGeographicSceneStore(storage);
    assert.deepEqual(store.list(), []);
    assert.equal(store.load('x'), null);
    assert.equal(store.save(make()).saved, false);
    assert.equal(store.rename('x', 'Name').saved, false);
  }
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error('denied'); };
  assert.equal(createGeographicSceneStore(storage).save(make()).reason, 'storage-write-failed');
});

test('corrupt, foreign-version, duplicate-id and malformed scene envelopes are not trusted or overwritten', () => {
  const scene = make();
  const envelope = { schema: scene.schema, version: 1, scenes: [scene] };
  const invalid = ['{not json', 'null', JSON.stringify({ ...envelope, version: 99 }),
    JSON.stringify({ ...envelope, scenes: [scene, scene] }),
    JSON.stringify({ ...envelope, scenes: [{ ...scene, confidence: 'confirmed' }] }),
    JSON.stringify({ ...envelope, scenes: [{ ...scene, keyframes: [] }] }),
    JSON.stringify({ ...envelope, scenes: [{ ...scene, id: 'collision' }] })];
  for (const text of invalid) {
    const storage = memoryStorage();
    storage.setItem(GEOGRAPHIC_SCENE_STORAGE_KEY, text);
    const store = createGeographicSceneStore(storage);
    assert.deepEqual(store.list(), []);
    assert.equal(store.load(scene.id), null);
    assert.equal(store.save(scene).reason, 'corrupt-storage');
    assert.equal(storage.getItem(GEOGRAPHIC_SCENE_STORAGE_KEY), text);
  }
});

test('save rejects modified evidence, coordinate, provenance, label and camera invariants', () => {
  const store = createGeographicSceneStore(memoryStorage());
  for (const scene of [null, {}, { ...make(), imagerySynthesis: true },
    { ...make(), incident_ids: ['fabricated'] }, { ...make(), evidence: [{ url: 'unsafe' }] },
    { ...make(), provenance: { ...make().provenance, incidentConfirmed: true } },
    { ...make(), keyframes: make().keyframes.map((k, i) => i ? k : { ...k, lat: 91 }) }])
    assert.equal(store.save(scene).reason, 'invalid-scene');
  assert.deepEqual(store.list(), []);
});

test('only allowlisted scene fields persist, never extra request/account/provider credentials', () => {
  const storage = memoryStorage();
  const scene = make();
  const store = createGeographicSceneStore(storage);
  assert.equal(store.save({ ...scene, apiKey: 'SENSITIVE', raw: { authorization: 'SENSITIVE' },
    extraction: { account: 'SENSITIVE' }, text: 'SENSITIVE' }).saved, true);
  assert.equal(storage.getItem(GEOGRAPHIC_SCENE_STORAGE_KEY).includes('SENSITIVE'), false);
  assert.deepEqual(store.load(scene.id), scene);
});

test('load/list/results are detached from storage; external mutation cannot corrupt cached content', () => {
  const store = createGeographicSceneStore(memoryStorage());
  const scene = make();
  const saved = store.save(scene);
  saved.scene.title = 'Mutated result';
  store.load(scene.id).steps[0].camera.lat = 91;
  store.list()[0].anchor.lon = -91;
  assert.deepEqual(store.load(scene.id), scene);
});
