import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSceneGeometry,
  geometryRenderSpec,
  geometrySignature,
  featureTimeState,
  recordingRange,
  describeGeometry,
  SCENE_GEOMETRY_VERSION,
} from './sceneGeometry.js';
import {
  buildPlannedScene,
  createGeographicSceneStore,
} from './geographicScene.js';

// Synthetic fixtures only (no provider calls). Coordinates are Dubai-local.
const ANCHOR = { lat: 25.0805, lon: 55.1403 };
const geometry = (over = {}) => ({
  version: SCENE_GEOMETRY_VERSION,
  status: 'grounded',
  illustrative: true,
  features: [
    {
      id: 'f1',
      kind: 'route',
      name: 'Researched route',
      role: 'race course',
      geometry: {
        type: 'LineString',
        coordinates: [
          [55.1403, 25.0805],
          [55.145, 25.084],
          [55.15, 25.09],
        ],
      },
      citationIds: ['c1'],
      provenance: { source: 'OSRM road routing over OpenStreetMap' },
      activeWindow: {
        startUtc: '2026-10-31T02:00:00Z',
        endUtc: '2026-10-31T06:00:00Z',
      },
    },
    {
      id: 'f2',
      kind: 'point',
      name: 'Start area',
      geometry: { type: 'Point', coordinates: [55.1401, 25.0801] },
      citationIds: ['c1', 'c2'],
      provenance: { source: 'OpenStreetMap Nominatim geocoder' },
    },
    {
      id: 'f3',
      kind: 'area',
      name: 'Venue footprint',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [55.139, 25.079],
            [55.141, 25.079],
            [55.141, 25.081],
            [55.139, 25.081],
            [55.139, 25.079],
          ],
        ],
      },
      citationIds: [],
      provenance: { source: 'OpenStreetMap Nominatim geocoder' },
    },
  ],
  citations: [
    { id: 'c1', url: 'https://example.org/route', title: 'Route source' },
    { id: 'c2', url: 'https://example.com/start' },
  ],
  ...over,
});

test('spec→geometry passes researched coordinates through unchanged as lines, dots and areas', () => {
  const g = validateSceneGeometry(geometry(), { anchor: ANCHOR });
  const spec = geometryRenderSpec(g, {
    selectedTime: { windowHours: 72 },
    now: Date.parse('2026-10-31T12:00:00Z'),
  });
  assert.equal(spec.lines.length, 1);
  assert.equal(spec.points.length, 1);
  assert.equal(spec.areas.length, 1);
  assert.deepEqual(
    spec.lines[0].coordinates,
    geometry().features[0].geometry.coordinates,
  );
  assert.equal(spec.points[0].lon, 55.1401);
  assert.equal(spec.points[0].lat, 25.0801);
  assert.deepEqual(spec.points[0].citationNumbers, [1, 2]);
  assert.deepEqual(spec.lines[0].citationNumbers, [1]);
  assert.equal(spec.areas[0].ring.length, 5);
  assert.ok(Math.abs(spec.areas[0].labelAt.lon - 55.14) < 1e-9);
  assert.equal(spec.citations[1].number, 2);
});

test('changing the recording window changes only time state, never geometry', () => {
  const g = validateSceneGeometry(geometry(), { anchor: ANCHOR });
  const now = Date.parse('2026-10-31T12:00:00Z');
  const wide = geometryRenderSpec(g, {
    selectedTime: { windowHours: 72 },
    now,
  });
  const narrow = geometryRenderSpec(g, {
    selectedTime: { windowHours: 1 },
    now,
  });
  assert.equal(wide.lines[0].timeState, 'in-window');
  assert.equal(narrow.lines[0].timeState, 'outside-window');
  assert.equal(narrow.points[0].timeState, 'time-unknown');
  assert.deepEqual(wide.lines[0].coordinates, narrow.lines[0].coordinates);
  assert.deepEqual(
    [wide.points[0].lat, wide.points[0].lon],
    [narrow.points[0].lat, narrow.points[0].lon],
  );
  assert.equal(wide.windowLabel, 'Last 72 hours');
  assert.equal(narrow.windowLabel, 'Last 1 hour');
  const hist = recordingRange({
    timeMode: 'historical',
    windowStart: '2026-10-31T03:00:00Z',
    windowEnd: '2026-10-31T04:00:00Z',
  });
  assert.equal(featureTimeState(g.features[0], hist), 'in-window');
});

test('different researched geometry yields a different signature', () => {
  const a = validateSceneGeometry(geometry(), { anchor: ANCHOR });
  const moved = geometry();
  moved.features[1].geometry.coordinates = [55.2, 25.1];
  const b = validateSceneGeometry(moved, { anchor: ANCHOR });
  assert.notEqual(geometrySignature(a), geometrySignature(b));
  assert.equal(
    geometrySignature(a),
    geometrySignature(validateSceneGeometry(geometry(), { anchor: ANCHOR })),
  );
});

test('validation rejects invented or malformed geometry instead of fixing it', () => {
  const bad = [
    (g) => (g.illustrative = false),
    (g) => (g.features[1].geometry.coordinates = [255, 25]),
    (g) => (g.features[1].geometry.coordinates = [-0.12, 51.5]), // far from anchor
    (g) => (g.features[0].geometry.coordinates = [[55.14, 25.08]]),
    (g) => g.features[2].geometry.coordinates[0].pop(),
    (g) => (g.features[0].citationIds = ['c9']),
    (g) => (g.citations[0].url = 'http://127.0.0.1/x'),
    (g) => (g.citations[0].url = 'https://example.org/?sig=abc'),
    (g) => (g.features[0].kind = 'polygon'),
    (g) => (g.features[0].extra = true),
    (g) => (g.status = 'empty'),
    (g) => (g.features = []),
  ];
  for (const edit of bad) {
    const g = geometry();
    edit(g);
    assert.throws(() => validateSceneGeometry(g, { anchor: ANCHOR }), {
      code: 'invalid_scene_geometry',
    });
  }
});

test('empty research is an explicit empty state with no drawable features', () => {
  const g = validateSceneGeometry(
    {
      version: 1,
      status: 'empty',
      illustrative: true,
      features: [],
      citations: [],
      message: 'Nothing grounded.',
    },
    { anchor: ANCHOR },
  );
  const spec = geometryRenderSpec(g, {});
  assert.equal(spec.status, 'empty');
  assert.equal(spec.points.length + spec.lines.length + spec.areas.length, 0);
  assert.match(describeGeometry(g), /nothing was drawn|Nothing grounded/i);
});

const plan = () => ({
  version: 1,
  title: 'Fixture staging',
  illustrative: true,
  durationSec: 12,
  location: {
    name: 'Dubai Marina',
    lat: ANCHOR.lat,
    lon: ANCHOR.lon,
    sourceUrl: 'https://www.openstreetmap.org/node/1',
  },
  camera: { distanceM: 600, heading: 10, pitch: -40, framing: 'wide' },
  entities: [
    {
      id: 'runners',
      type: 'runner',
      label: 'Runners',
      quantity: 3,
      position: { eastM: 10, northM: 10 },
      heading: 45,
    },
  ],
  relationships: [],
  beats: [
    {
      atSec: 0,
      title: 'Start',
      narration: 'Runners gather.',
      entityIds: ['runners'],
    },
  ],
  citations: [],
  verification: {
    status: 'location_verified',
    locationSource: 'Fixture',
    checkedAt: '2026-10-31T00:00:00Z',
    limitations: ['Illustrative.'],
  },
});
const candidate = {
  name: 'Dubai Marina',
  lat: ANCHOR.lat,
  lon: ANCHOR.lon,
  verified: true,
  source: 'fixture',
  sourceUrl: 'https://www.openstreetmap.org/node/1',
};

test('planned scenes carry validated geometry and it survives save → reload unchanged', () => {
  const scene = buildPlannedScene({
    plan: plan(),
    candidate,
    geometry: geometry(),
    text: 'p',
    now: '2026-10-31T00:00:00Z',
  });
  assert.equal(scene.geometry.features.length, 3);
  const data = new Map();
  const storage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
  };
  const store = createGeographicSceneStore(storage);
  const saved = store.save(scene);
  assert.equal(saved.saved, true, saved.reason);
  const loaded = store.load(scene.id);
  assert.deepEqual(loaded.geometry, scene.geometry);
  assert.throws(() =>
    buildPlannedScene({
      plan: plan(),
      candidate,
      geometry: { ...geometry(), version: 9 },
    }),
  );
  // Older saved scenes without geometry still load (null = none researched).
  const legacy = buildPlannedScene({
    plan: plan(),
    candidate,
    text: 'p',
    now: '2026-10-31T00:00:00Z',
  });
  assert.equal(legacy.geometry, null);
});
