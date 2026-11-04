import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlannedScene,
  buildGeographicScene,
  createGeographicSceneStore,
  localOffsetToWgs84,
  GEOGRAPHIC_SCENE_STORAGE_KEY,
  GEOGRAPHIC_SCENE_STORAGE_VERSION,
} from './geographicScene.js';

const now = '2026-10-31T00:00:00.000Z';
const candidate = {
  name: 'Synthetic waterfront',
  lat: 25.2,
  lon: 55.3,
  verified: true,
  source: 'geocode_place',
};
function fixture() {
  return {
    version: 1,
    title: 'Illustrative gathering',
    illustrative: true,
    durationSec: 36,
    location: { name: candidate.name, lat: candidate.lat, lon: candidate.lon },
    camera: { distanceM: 100, heading: 0, pitch: -30, framing: 'wide' },
    entities: [
      {
        id: 'runners',
        type: 'runner',
        label: 'Runners',
        quantity: 7,
        position: { eastM: 100, northM: 0 },
        heading: 90,
      },
      {
        id: 'police',
        type: 'police',
        label: 'Police',
        quantity: 3,
        position: { eastM: 80, northM: 15 },
        heading: 0,
      },
      {
        id: 'vehicles',
        type: 'police_vehicle',
        label: 'Parked police cars',
        quantity: 2,
        position: { eastM: -25, northM: 30 },
        heading: 180,
      },
      {
        id: 'barriers',
        type: 'barrier',
        label: 'Barriers',
        quantity: 6,
        position: { eastM: 95, northM: 20 },
        heading: 90,
      },
    ],
    relationships: [{ from: 'police', to: 'runners', relation: 'near' }],
    beats: [
      {
        atSec: 0,
        title: 'Opening',
        narration: 'Illustrative opening, not a reported event.',
        entityIds: [],
      },
      {
        atSec: 9,
        title: 'Runners',
        narration: 'The authored runners group.',
        entityIds: ['runners'],
        camera: { distanceM: 40, heading: 90, pitch: -45, framing: 'close' },
      },
      {
        atSec: 27,
        title: 'Police',
        narration: 'The authored police group.',
        entityIds: ['police'],
      },
    ],
    citations: [
      {
        url: 'https://www.openstreetmap.org/node/123',
        title: 'Location reference',
        publishedAt: now,
      },
    ],
    verification: {
      status: 'location_verified',
      locationSource: 'Synthetic geocoder fixture',
      checkedAt: now,
      limitations: ['All staging is illustrative.'],
    },
  };
}
function make(overrides = {}) {
  return buildPlannedScene({
    candidate,
    plan: fixture(),
    text: 'Refined prompt',
    originalPrompt: 'Original prompt',
    now,
    ...overrides,
  });
}
function memory() {
  const values = new Map();
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}
function meters(a, b) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) *
      Math.cos(b.lat * rad) *
      Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(h));
}

test('per-quantity placements retain formation, deterministic coordinates and illustrative provenance', () => {
  const plan = fixture();
  const scene = make({ plan });
  assert.deepEqual(plan, fixture());
  assert.deepEqual(make(), scene);
  assert.equal(scene.placements.length, 18);
  for (const entity of plan.entities)
    assert.equal(
      scene.placements.filter((p) => p.entityId === entity.id).length,
      entity.quantity,
    );
  for (const p of scene.placements) {
    assert.equal(p.illustrative, true);
    assert.equal(p.incidentConfirmed, false);
    assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lon));
    assert.ok(
      Math.abs(
        meters(scene.anchor, p) -
          Math.hypot(p.position.eastM, p.position.northM),
      ) < 0.001,
    );
  }
  const unique = new Set(scene.placements.map((p) => `${p.lat},${p.lon}`));
  assert.equal(unique.size, 18);
  assert.match(scene.summary, /not a confirmed incident/);
  assert.deepEqual(scene.evidence, []);
  assert.deepEqual(scene.incident_ids, []);
  assert.equal(scene.provenance.incidentConfirmed, false);
  assert.deepEqual(
    buildGeographicScene({
      plan,
      candidate,
      text: 'Refined prompt',
      originalPrompt: 'Original prompt',
      now,
    }),
    scene,
  );
});

test('uses every authored beat, camera, focus centroid, and exact duration instead of a fixed four-shot orbit', () => {
  const plan = fixture();
  plan.beats.splice(2, 0, {
    ...plan.beats[1],
    atSec: 16,
    title: 'Context',
    entityIds: [],
  });
  const scene = make({ plan });
  assert.equal(scene.keyframes.length, plan.beats.length + 1);
  assert.deepEqual(
    scene.keyframes.map((k) => k.timeOffsetSec),
    [0, 9, 16, 27, 36],
  );
  assert.equal(
    scene.steps.reduce((n, step) => n + step.durationSec, 0),
    36,
  );
  assert.equal(scene.durationSec, 36);
  assert.equal(scene.keyframes.at(-1).time, 1);
  assert.equal(scene.keyframes[1].framing, 'close');
  assert.ok(Math.abs(scene.keyframes[1].altitudeM - 40 * Math.SQRT1_2) < 1e-10);
  assert.equal(scene.keyframes[1].bearing, 90);
  assert.ok(Math.abs(meters(scene.anchor, scene.keyframes[1]) - 100) < 2);
  assert.ok(
    Math.abs(
      meters(scene.keyframes[1], scene.steps[1].camera) - 40 * Math.SQRT1_2,
    ) < 0.001,
  );
  assert.equal(scene.steps[1].narration, plan.beats[1].narration);
  assert.equal(scene.steps[1].provenance, 'illustrative-staging');
});

test('transforms offsets across the dateline and near poles without clamping or swapping axes', () => {
  for (const anchor of [
    { lat: 0, lon: 179.9999 },
    { lat: 89.99, lon: 45 },
    { lat: -33, lon: -71 },
  ]) {
    const point = localOffsetToWgs84(anchor, 120, 160);
    assert.ok(Math.abs(meters(anchor, point) - 200) < 0.001);
    assert.ok(
      point.lat >= -90 &&
        point.lat <= 90 &&
        point.lon >= -180 &&
        point.lon <= 180,
    );
  }
  assert.ok(localOffsetToWgs84({ lat: 0, lon: 0 }, 100, 0).lon > 0);
  assert.ok(localOffsetToWgs84({ lat: 0, lon: 0 }, 0, 100).lat > 0);
  assert.throws(() => localOffsetToWgs84(candidate, Infinity, 0));
});

test('coincident groups are deconflicted without random placement or overlapping footprints', () => {
  const plan = fixture();
  plan.entities.forEach((e) => {
    e.position = { eastM: 0, northM: 0 };
  });
  const scene = make({ plan });
  assert.deepEqual(make({ plan }), scene);
  for (let i = 0; i < scene.placements.length; i++)
    for (let j = i + 1; j < scene.placements.length; j++)
      assert.ok(meters(scene.placements[i], scene.placements[j]) > 1.2);
});

test('refuses invalid generated plans, unverified candidates, and mismatched anchors', () => {
  const bad = [
    (p) => (p.illustrative = false),
    (p) => (p.durationSec = 181),
    (p) => (p.entities[0].quantity = 999),
    (p) => (p.beats[1].entityIds = ['missing']),
    (p) => (p.location.lat += 0.1),
    (p) => (p.extra = 'unknown'),
    (p) => (p.location.sourceUrl = 'https://example.org/?token=x'),
  ];
  for (const edit of bad) {
    const plan = fixture();
    edit(plan);
    assert.throws(() => make({ plan }));
  }
  assert.throws(() => make({ candidate: { ...candidate, verified: false } }));
  assert.throws(() =>
    make({ candidate: { ...candidate, name: 'Different unverified venue' } }),
  );
  const canonical = fixture();
  canonical.location.name = 'Verified canonical name';
  const named = make({
    plan: canonical,
    candidate: { ...candidate, name: 'Verified canonical name' },
  });
  assert.equal(named.anchor.name, 'Verified canonical name');
  const store = createGeographicSceneStore(memory());
  assert.equal(store.save(named).saved, true);
});

test('full structured scene, prompt notes, selected time, chat, citations, camera, hash and narration round-trip', () => {
  const storage = memory();
  const store = createGeographicSceneStore(storage);
  const scene = {
    ...make({
      selectedTime: {
        timeMode: 'range',
        windowHours: 24,
        windowStart: now,
        windowEnd: '2026-11-01T00:00:00Z',
      },
    }),
    chat: [
      { id: 'u1', role: 'user', content: 'Move the illustrative barriers.' },
      {
        role: 'assistant',
        text: 'Updated the planned formation.',
        timestamp: now,
      },
    ],
    cameraSelection: { mode: 'plan', beatIndex: 1 },
    cameraState: {
      lat: 25.2,
      lon: 55.3,
      alt: 125,
      heading: 45,
      pitch: -50,
      roll: 0,
    },
    hashSnapshot: {
      aoi: 'uae',
      x: '55.3',
      'future-original-key': { arbitrary: [1, true, 'opaque'] },
      layers: 'traffic,roads',
    },
    narrationConfig: {
      enabled: true,
      voiceURI: 'local-test-voice',
      lang: 'en-GB',
      rate: 1.2,
      pitch: 1,
      volume: 0.7,
    },
  };
  const result = store.save(scene);
  assert.equal(result.saved, true);
  assert.equal(
    JSON.parse(storage.getItem(GEOGRAPHIC_SCENE_STORAGE_KEY)).version,
    GEOGRAPHIC_SCENE_STORAGE_VERSION,
  );
  assert.deepEqual(createGeographicSceneStore(storage).load(scene.id), scene);
  result.scene.hashSnapshot.layers = 'changed';
  assert.equal(store.load(scene.id).hashSnapshot.layers, 'traffic,roads');
  assert.equal(store.rename(scene.id, 'Renamed', { now }).saved, true);
  assert.deepEqual(store.load(scene.id).plan, scene.plan);
  assert.equal(store.load(scene.id).title, 'Renamed');
});

test('reads old version-one scenes without writes, migrates envelope only after a valid save', () => {
  const old = buildGeographicScene({ candidate, now });
  const storage = memory();
  const original = JSON.stringify({
    schema: old.schema,
    version: 1,
    scenes: [old],
  });
  storage.setItem(GEOGRAPHIC_SCENE_STORAGE_KEY, original);
  const store = createGeographicSceneStore(storage);
  assert.deepEqual(store.list(), [old]);
  assert.equal(storage.getItem(GEOGRAPHIC_SCENE_STORAGE_KEY), original);
  const scene = make();
  assert.equal(store.save(scene).saved, true);
  assert.deepEqual(store.load(old.id), old);
  assert.deepEqual(store.load(scene.id), scene);
  assert.equal(
    JSON.parse(storage.getItem(GEOGRAPHIC_SCENE_STORAGE_KEY)).version,
    2,
  );
  assert.equal(store.getStatus().persistence, 'browser-local');
});

test('legacy scenes can retain newly allowlisted notes without changing their camera schema', () => {
  const scene = {
    ...buildGeographicScene({ candidate, now }),
    originalPrompt: 'Old source',
    refinedPrompt: 'New note',
    hashSnapshot: '#original=opaque&v=2',
  };
  const store = createGeographicSceneStore(memory());
  assert.equal(store.save(scene).saved, true);
  assert.deepEqual(store.load(scene.id), scene);
});

test('rejects malformed/unsafe saved content, does not silently overwrite corrupt storage', () => {
  const scene = make();
  for (const alter of [
    (s) => (s.chat = [{ role: 'system', content: 'unsafe' }]),
    (s) => (s.chat = [{ role: 'user', content: 'ok', password: 'abc' }]),
    (s) => (s.hashSnapshot = { apiKey: 'secret' }),
    (s) => (s.hashSnapshot = { VITE_CESIUM_ION_ACCESS_TOKEN: 'secret' }),
    (s) => (s.cameraSelection = { mode: { unexpected: true } }),
    (s) => (s.hashSnapshot = JSON.parse('{"__proto__":{"polluted":true}}')),
    (s) => (s.narrationConfig = { enabled: true, audioBlob: 'payload' }),
    (s) => (s.narrationConfig = { rate: Infinity }),
    (s) => (s.citations = [{ url: 'javascript:alert(1)' }]),
    (s) => (s.citations = [{ url: 'https://u:p@example.org' }]),
    (s) => (s.citations = [{ url: 'https://example.org?access_token=secret' }]),
    (s) => (s.cameraState = { lat: 91 }),
    (s) => (s.selectedTime = { unknown: 'unsafe' }),
    (s) => (s.refinedPrompt = 'api_key=SECRETXYZ'),
    (s) => (s.placements[0].lat += 0.1),
    (s) => (s.unknownField = 'untrusted'),
  ]) {
    const bad = structuredClone(scene);
    alter(bad);
    const storage = memory();
    const store = createGeographicSceneStore(storage);
    assert.equal(store.save(bad).reason, 'invalid-scene');
    const corrupt = JSON.stringify({
      schema: scene.schema,
      version: 2,
      scenes: [bad],
    });
    storage.setItem(GEOGRAPHIC_SCENE_STORAGE_KEY, corrupt);
    assert.deepEqual(store.list(), []);
    assert.equal(store.save(scene).reason, 'corrupt-storage');
    assert.equal(storage.getItem(GEOGRAPHIC_SCENE_STORAGE_KEY), corrupt);
    assert.equal(store.getStatus().reason, 'corrupt-storage');
  }
});

test('optional undefined time controls are omitted, binary data and class instances cannot persist', () => {
  const scene = make({
    selectedTime: {
      timeMode: 'recent',
      windowHours: 1,
      windowStart: undefined,
      windowEnd: undefined,
    },
  });
  assert.deepEqual(scene.selectedTime, { timeMode: 'recent', windowHours: 1 });
  const store = createGeographicSceneStore(memory());
  assert.equal(
    store.save({ ...scene, hashSnapshot: new Uint8Array([1, 2]) }).reason,
    'invalid-scene',
  );
  assert.equal(
    store.save({ ...scene, narrationConfig: new Date() }).reason,
    'invalid-scene',
  );
});

test('server-resolved APPROXIMATE anchor builds, is labelled, and round-trips with its location resolution', () => {
  const resolvedCandidate = {
    name: "Kane's Boxing Academy — AD City",
    lat: 24.4850018,
    lon: 54.3586369,
    verified: true,
    resolvedBy: 'scene-planner',
    approximate: true,
    precision: 'address',
    confidence: 0.78,
    source: 'openstreetmap',
    sourceUrl: 'https://www.openstreetmap.org/way/27374404',
  };
  const plan = fixture();
  plan.location = {
    name: resolvedCandidate.name,
    lat: resolvedCandidate.lat,
    lon: resolvedCandidate.lon,
    sourceUrl: resolvedCandidate.sourceUrl,
  };
  plan.verification.status = 'location_approximate';
  const locationResolution = {
    method: 'perplexity-research+osm',
    precision: 'address',
    precisionText: 'researched address / host building (OpenStreetMap)',
    approximate: true,
    confidence: 0.78,
    name: resolvedCandidate.name,
    lat: resolvedCandidate.lat,
    lon: resolvedCandidate.lon,
    geocoder: 'OpenStreetMap Photon (komoot)',
    geocoderUrl: resolvedCandidate.sourceUrl,
    sourceCount: 2,
    citations: [
      {
        url: 'https://privilee.ae/insider/now-on-privilee-kane-s-boxing-academy',
        title: 'Privilee',
      },
    ],
    alternatives: [
      {
        name: "Kane's Boxing Academy — Al Raha Branch",
        lat: 24.439,
        lon: 54.574,
        precision: 'address',
        confidence: 0.66,
        citations: [],
      },
    ],
  };
  const scene = make({
    plan,
    candidate: resolvedCandidate,
    locationResolution,
  });
  assert.equal(scene.provenance.kind, 'resolved-location');
  assert.equal(scene.provenance.approximate, true);
  assert.equal(
    scene.provenance.verified,
    false,
    'approximate anchors are not labelled verified',
  );
  assert.match(scene.summary, /APPROXIMATE/);
  assert.equal(scene.locationResolution.alternatives.length, 1);
  const store = createGeographicSceneStore(memory());
  const saved = store.save(scene);
  assert.equal(saved.saved, true);
  const loaded = store.load(scene.id);
  assert.equal(loaded.locationResolution.approximate, true);
  assert.equal(loaded.provenance.approximate, true);
  // The legacy (non-planned) builder still refuses unverified candidates.
  assert.throws(() =>
    buildGeographicScene({
      candidate: {
        ...resolvedCandidate,
        verified: false,
        resolvedBy: undefined,
      },
      now,
    }),
  );
});
