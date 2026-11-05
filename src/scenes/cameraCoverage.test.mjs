import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EARTH_RADIUS_M,
  NO_RELEVANT_CAMERA,
  haversineDistanceM,
  bearingDegrees,
  validCameraPoint,
  verifiedCameraLocation,
  sceneCameraTarget,
  cameraCoverageAt,
  cameraPermissions,
  classifyCameraStatus,
  assessSceneCamera,
  selectSceneCamera,
} from './cameraCoverage.js';

const NOW = Date.parse('2026-10-31T12:00:00Z');
const sourceUrl = 'https://camera-provider.example/camera/fixture';
const proof = { verified: true, sourceUrl };
const target = { lat: 0, lon: 0.001 };
const scene = { id: 'fixture-scene', anchor: target };
const camera = (patch = {}) => ({
  id: 'fixture-camera',
  name: 'Test fixture only',
  provider: 'Fixture provider',
  lat: 0,
  lon: 0,
  locationEvidence: { ...proof, kind: 'provider-coordinate' },
  coverage: {
    radiusM: 500,
    headingDeg: 90,
    fovDeg: 90,
    evidence: { ...proof },
  },
  permissions: { view: true, embed: true, evidence: { ...proof } },
  availabilityEvidence: {
    ...proof,
    kind: 'live-stream',
    checkedAt: NOW - 1000,
  },
  mediaUrl: '/api/cctv/media/fixture-camera',
  ...patch,
});
const choose = (rows, opts = {}) =>
  selectSceneCamera(scene, rows, { now: NOW, ...opts });
const approx = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('haversine metres: one equatorial degree, symmetry, identity and antipodes', () => {
  const a = { lat: 0, lon: 0 },
    b = { lat: 0, lon: 1 };
  approx(haversineDistanceM(a, b), 111195.0802335329);
  approx(haversineDistanceM(a, b), haversineDistanceM(b, a));
  assert.equal(haversineDistanceM(a, a), 0);
  approx(haversineDistanceM(a, { lat: 0, lon: 180 }), Math.PI * EARTH_RADIUS_M);
  approx(
    haversineDistanceM({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 }),
    22239.0160467,
    1e-4,
  );
});

test('invalid numeric data is rejected rather than coerced to (0,0)', () => {
  for (const bad of [
    null,
    {},
    { lat: null, lon: 0 },
    { lat: '0', lon: 0 },
    { lat: false, lon: 0 },
    { lat: 91, lon: 0 },
    { lat: 0, lon: -181 },
    { lat: NaN, lon: 0 },
  ]) {
    assert.equal(validCameraPoint(bad), null);
    assert.ok(Number.isNaN(haversineDistanceM(bad, target)));
  }
});

test('cardinal bearings are measured clockwise from north', () => {
  const a = { lat: 0, lon: 0 };
  assert.equal(bearingDegrees(a, { lat: 1, lon: 0 }), 0);
  assert.equal(bearingDegrees(a, { lat: 0, lon: 1 }), 90);
  assert.equal(bearingDegrees(a, { lat: -1, lon: 0 }), 180);
  assert.equal(bearingDegrees(a, { lat: 0, lon: -1 }), 270);
});

test('raw layer coordinates and generated headings are not evidence', () => {
  const raw = camera({
    locationEvidence: undefined,
    headingDeg: 90,
    fovDeg: 74,
    rangeM: 700,
  });
  assert.equal(verifiedCameraLocation(raw), null);
  assert.equal(choose([raw]).status, NO_RELEVANT_CAMERA);
  assert.ok(
    choose([raw]).candidates[0].reasons.includes('location-unverified'),
  );
  assert.equal(
    verifiedCameraLocation(
      camera({
        locationEvidence: { ...proof, sourceUrl: 'javascript:alert(1)' },
      }),
    ),
    null,
  );
});

test('a geocoder result requires physical-camera/address provenance tied to this camera', () => {
  const base = { ...proof, kind: 'geocoded-camera-address' };
  assert.equal(
    verifiedCameraLocation(camera({ locationEvidence: base })),
    null,
  );
  assert.equal(
    verifiedCameraLocation(
      camera({
        locationEvidence: {
          ...base,
          subject: 'city',
          address: 'Test street',
          cameraId: 'fixture-camera',
        },
      }),
    ),
    null,
  );
  assert.equal(
    verifiedCameraLocation(
      camera({
        locationEvidence: {
          ...base,
          subject: 'physical-camera',
          address: 'Test street',
          cameraId: 'different',
        },
      }),
    ),
    null,
  );
  assert.ok(
    verifiedCameraLocation(
      camera({
        locationEvidence: {
          ...base,
          subject: 'physical-camera',
          address: 'Test camera mount address',
          cameraId: 'fixture-camera',
        },
      }),
    ),
  );
});

test('nearby camera with unknown coverage is not selected', () => {
  const c = camera({ coverage: undefined });
  assert.equal(cameraCoverageAt(c, target).status, 'unknown');
  assert.equal(choose([c]).selected, null);
  assert.ok(choose([c]).candidates[0].distanceM < 112);
});

test('unproven or malformed coverage fails closed', () => {
  for (const coverage of [
    { radiusM: 500 },
    { radiusM: 500, evidence: { ...proof, verified: false } },
    { radiusM: '500', evidence: proof },
    { radiusM: -1, evidence: proof },
    { bounds: [0, 2, 1, 1], evidence: proof },
    { headingDeg: 90, fovDeg: 90, evidence: proof },
    { radiusM: 500, fovDeg: 90, evidence: proof },
  ]) {
    assert.equal(
      cameraCoverageAt(camera({ coverage }), target).status,
      'unknown',
    );
  }
});

test('explicit radius is honoured, inclusive of its boundary', () => {
  const radiusM = haversineDistanceM(camera(), target);
  assert.equal(
    cameraCoverageAt(camera({ coverage: { radiusM, evidence: proof } }), target)
      .status,
    'covered',
  );
  assert.equal(
    cameraCoverageAt(
      camera({ coverage: { radiusM: 100, evidence: proof } }),
      target,
    ).reason,
    'outside-radius',
  );
});

test('FOV rejects the wrong direction even when a camera is closer', () => {
  const wrong = camera({
    id: 'wrong-way',
    lon: 0.0009,
    coverage: { radiusM: 500, headingDeg: 270, fovDeg: 90, evidence: proof },
  });
  assert.equal(cameraCoverageAt(wrong, target).reason, 'outside-fov');
  assert.equal(choose([wrong, camera()]).selected.id, 'fixture-camera');
});

test('FOV handles north wrap-around, full circles and a coincident target', () => {
  const north = { lat: 0.001, lon: 0 };
  assert.equal(
    cameraCoverageAt(
      camera({
        coverage: { radiusM: 500, headingDeg: 359, fovDeg: 4, evidence: proof },
      }),
      north,
    ).status,
    'covered',
  );
  assert.equal(
    cameraCoverageAt(
      camera({
        coverage: {
          radiusM: 500,
          headingDeg: 180,
          fovDeg: 360,
          evidence: proof,
        },
      }),
      north,
    ).status,
    'covered',
  );
  assert.equal(
    cameraCoverageAt(camera(), { lat: 0, lon: 0 }).status,
    'covered',
  );
});

test('bounds use [west,south,east,north], including the antimeridian', () => {
  const coverage = { bounds: [-0.001, -0.001, 0.001, 0.001], evidence: proof };
  assert.equal(
    cameraCoverageAt(camera({ coverage }), target).status,
    'covered',
  );
  assert.equal(
    cameraCoverageAt(camera({ coverage }), { lat: 0, lon: 0.002 }).reason,
    'outside-bounds',
  );
  const c = camera({
    lon: 179.9,
    coverage: { bounds: [179, -1, -179, 1], evidence: proof },
  });
  assert.equal(cameraCoverageAt(c, { lat: 0, lon: -179.9 }).status, 'covered');
  assert.equal(
    cameraCoverageAt(c, { lat: 0, lon: 0 }).reason,
    'outside-bounds',
  );
});

test('all explicit coverage constraints must pass, not just one', () => {
  const coverage = {
    bounds: [-1, -1, 1, 1],
    radiusM: 500,
    headingDeg: 270,
    fovDeg: 30,
    evidence: proof,
  };
  assert.equal(
    cameraCoverageAt(camera({ coverage }), target).reason,
    'outside-fov',
  );
});

test('LIVE title, sourceStatus ok, frame URL and recent retrieval do not prove live', () => {
  const c = camera({
    name: 'LIVE webcam',
    sourceStatus: 'ok',
    availabilityEvidence: undefined,
    updatedAt: NOW,
  });
  assert.equal(classifyCameraStatus(c, { now: NOW }).status, 'unknown');
  assert.equal(choose([c]).selected, null);
});

test('live status requires trusted, current activity evidence; stale and future checks fail', () => {
  assert.equal(classifyCameraStatus(camera(), { now: NOW }).status, 'live');
  for (const patch of [
    { checkedAt: NOW - 120001 },
    { checkedAt: NOW + 1 },
    { checkedAt: null },
    { verified: false },
    { kind: 'http-success' },
  ]) {
    assert.equal(
      classifyCameraStatus(
        camera({
          availabilityEvidence: { ...camera().availabilityEvidence, ...patch },
        }),
        { now: NOW },
      ).status,
      'unknown',
    );
  }
  assert.equal(
    classifyCameraStatus(camera(), { now: NOW, maxLiveAgeMs: 0 }).status,
    'unknown',
  );
});

test('live snapshots require recent capture time, not only load time', () => {
  const evidence = { ...proof, kind: 'live-snapshot', checkedAt: NOW };
  assert.equal(
    classifyCameraStatus(camera({ availabilityEvidence: evidence }), {
      now: NOW,
    }).status,
    'unknown',
  );
  assert.equal(
    classifyCameraStatus(
      camera({
        availabilityEvidence: { ...evidence, capturedAt: NOW - 900000 },
      }),
      { now: NOW },
    ).status,
    'unknown',
  );
  assert.equal(
    classifyCameraStatus(
      camera({
        availabilityEvidence: {
          ...evidence,
          capturedAt: new Date(NOW - 1000).toISOString(),
        },
      }),
      { now: NOW },
    ).status,
    'live',
  );
});

test('offline and restriction reports override apparently fresh live evidence', () => {
  for (const patch of [
    { status: 'offline' },
    { status: 'live', sourceStatus: 'offline' },
  ]) {
    assert.equal(
      classifyCameraStatus(camera(patch), { now: NOW }).status,
      'offline',
    );
    assert.equal(choose([camera(patch)]).selected, null);
  }
  assert.equal(
    classifyCameraStatus(
      camera({ permissions: { view: false, embed: true, evidence: proof } }),
      { now: NOW },
    ).status,
    'restricted',
  );
});

test('recorded remains recorded and needs evidence to be usable', () => {
  const c = camera({
    status: 'recorded',
    availabilityEvidence: {
      ...proof,
      kind: 'recorded-media',
      checkedAt: NOW - 86400000,
    },
  });
  assert.equal(choose([c]).selected.status, 'recorded');
  assert.equal(
    classifyCameraStatus(
      camera({ status: 'recorded', availabilityEvidence: undefined }),
      { now: NOW },
    ).status,
    'recorded',
  );
  assert.equal(
    choose([camera({ status: 'recorded', availabilityEvidence: undefined })])
      .selected,
    null,
  );
});

test('streetview/synthetic/seed fallback is never accepted as physical camera footage', () => {
  for (const sourceKind of ['streetview', 'synthetic', 'seed', 'fallback']) {
    assert.equal(choose([camera({ sourceKind })]).selected, null);
    assert.equal(
      choose([
        camera({
          sourceKind,
          availabilityEvidence: { ...proof, kind: 'recorded-media' },
        }),
      ]).selected,
      null,
    );
  }
  assert.equal(choose([camera({ sourceStatus: 'degraded' })]).selected, null);
});

test('view and embedding both need explicit permission proof', () => {
  for (const permissions of [
    undefined,
    {},
    { view: true, embed: true },
    { view: true, evidence: proof },
    { view: true, embed: false, evidence: proof },
    { view: true, embed: true, evidence: { ...proof, verified: false } },
  ]) {
    assert.equal(cameraPermissions(camera({ permissions })).allowed, false);
    assert.equal(choose([camera({ permissions })]).selected, null);
  }
  assert.equal(cameraPermissions(camera()).allowed, true);
});

test('unsafe or missing playback URLs never produce a usable candidate', () => {
  for (const mediaUrl of [
    '',
    undefined,
    'javascript:alert(1)',
    '//other.example/stream',
    '/\\other.example/stream',
    'https://user:password@camera.example/stream',
  ]) {
    assert.equal(choose([camera({ mediaUrl })]).selected, null);
  }
});

test('no unrelated first-camera fallback when closest camera is offline', () => {
  const far = camera({
    id: 'far',
    lon: 1,
    coverage: { radiusM: 500000, evidence: proof },
  });
  const result = choose([camera({ status: 'offline' }), far]);
  assert.equal(result.status, NO_RELEVANT_CAMERA);
  assert.equal(result.selected, null);
  assert.ok(
    result.candidates
      .find((c) => c.id === 'far')
      .reasons.includes('beyond-relevance-distance'),
  );
});

test('nearest usable wins regardless of list order or live-vs-recorded label', () => {
  const closer = camera({
    id: 'closer',
    lon: 0.0005,
    status: 'recorded',
    availabilityEvidence: { ...proof, kind: 'recorded-media' },
  });
  assert.equal(choose([camera(), closer]).selected.id, 'closer');
  assert.equal(choose([closer, camera()]).selected.id, 'closer');
  assert.equal(choose([closer], { maxDistanceM: 10 }).selected, null);
});

test('ties are deterministic and selection is pure', () => {
  const deepFreeze = (v) => {
    if (v && typeof v === 'object') {
      Object.values(v).forEach(deepFreeze);
      Object.freeze(v);
    }
    return v;
  };
  const rows = deepFreeze([camera({ id: 'b' }), camera({ id: 'a' })]);
  const before = JSON.stringify(rows);
  assert.equal(choose(rows).selected.id, 'a');
  assert.equal(JSON.stringify(rows), before);
  assert.deepEqual(
    rows.map((c) => c.id),
    ['b', 'a'],
  );
});

test('selection surfaces source, location, distance, evidence status and reasons', () => {
  const selected = choose([camera()]).selected;
  assert.equal(selected.provider, 'Fixture provider');
  assert.equal(selected.sourceUrl, sourceUrl);
  approx(selected.distanceM, 111.1950802335329);
  assert.equal(selected.coverage.status, 'covered');
  assert.equal(selected.availability.checkedAt, NOW - 1000);
  assert.deepEqual(selected.reasons, []);
});

test('scene target must be explicit: approach keyframes never imply the target', () => {
  assert.equal(sceneCameraTarget({ keyframes: [target] }), null);
  assert.equal(
    selectSceneCamera({ keyframes: [target] }, [camera()], { now: NOW }).reason,
    'scene-target-missing',
  );
  assert.deepEqual(
    sceneCameraTarget({ anchor: target, keyframes: [{ lat: 80, lon: 80 }] }),
    target,
  );
  assert.equal(choose([]).status, NO_RELEVANT_CAMERA);
  assert.equal(choose([camera({ id: '' })]).selected, null);
});
