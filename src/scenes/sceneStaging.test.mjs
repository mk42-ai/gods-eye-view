import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSceneStaging,
  cleanMapLabel,
  stagingCounts,
  stagingSignature,
  PRIORITY,
  STAGING_BADGE_TEXT,
  SceneStagingError,
} from './sceneStaging.js';

const SPEC = {
  scenarioType: 'police_raid',
  focalEntity: { name: 'Fixture Hotel', kind: 'building' },
  elements: [
    { type: 'inner_cordon', params: { radius_m: 80 } },
    { type: 'outer_cordon', params: { radius_m: 220 } },
  ],
  confidence: 0.8,
};

const base = (id, element, role, extra = {}) => ({
  id,
  element,
  role,
  priority: PRIORITY[role],
  color: '#14B8A6',
  provenance: 'anchor',
  illustrative: true,
  ...extra,
});

function makeStaging() {
  return {
    version: 1,
    illustrative: true,
    spec: structuredClone(SPEC),
    anchor: { name: 'Fixture Hotel', lat: 25.1412, lon: 55.1853 },
    model: {
      provider: 'template',
      id: 't',
      latencyMs: 0,
      attempts: [],
      repaired: true,
    },
    timing: { specMs: 0, geometryMs: 1, totalMs: 1 },
    sources: { footprint: 'osm-building', roads: 'overpass', routing: 'osrm' },
    unavailable: [],
    layers: {
      areas: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [55.185, 25.141],
                  [55.186, 25.141],
                  [55.186, 25.142],
                  [55.185, 25.142],
                  [55.185, 25.141],
                ],
              ],
            },
            properties: base('focal-footprint', 'focal', 'focal', {
              label: 'Fixture Hotel',
              provenance: 'osm-footprint-buffer',
            }),
          },
        ],
      },
      lines: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [55.17, 25.15],
                [55.18, 25.145],
              ],
            },
            properties: base('approach-route-1', 'approach_route', 'route', {
              lineStyle: 'route_approach',
              provenance: 'osrm-route',
            }),
          },
        ],
      },
      points: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [55.1853, 25.1425] },
            properties: base('cones-1', 'cones', 'cone', {
              icon: 'cone',
              provenance: 'turf-along',
            }),
          },
        ],
      },
      labels: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [55.1853, 25.1412] },
            properties: base('label-focal-1', 'focal', 'focal', {
              label: 'Fixture Hotel',
              labelFor: 'focal-footprint',
            }),
          },
        ],
      },
    },
    badge: { text: STAGING_BADGE_TEXT, single: true },
    legend: [],
  };
}

const rejects = (mutate, name) => {
  const s = makeStaging();
  mutate(s);
  assert.throws(() => validateSceneStaging(s), SceneStagingError, name);
};

test('validateSceneStaging returns a deep-equal fresh copy', () => {
  const s = makeStaging();
  const out = validateSceneStaging(s);
  assert.deepEqual(out, s);
  assert.notEqual(out, s);
  assert.notEqual(out.layers.areas, s.layers.areas);
  out.layers.points.features[0].geometry.coordinates[0] = 0;
  assert.equal(s.layers.points.features[0].geometry.coordinates[0], 55.1853);
});

test('validateSceneStaging rejects version / illustrative / badge problems', () => {
  rejects((s) => (s.version = 2), 'version');
  rejects((s) => (s.illustrative = false), 'illustrative');
  rejects((s) => (s.badge.text = 'Something else'), 'badge text');
  rejects((s) => (s.badge.single = false), 'badge single');
  rejects((s) => (s.extra = 1), 'unknown top-level key');
});

test('validateSceneStaging rejects citation tokens and illustrative prefixes in labels', () => {
  for (const label of ['Venue [1,2]', 'Venue [3]', 'Venue [1-2]']) {
    rejects(
      (s) => (s.layers.labels.features[0].properties.label = label),
      label,
    );
    rejects(
      (s) => (s.layers.areas.features[0].properties.label = label),
      label,
    );
  }
  rejects(
    (s) =>
      (s.layers.labels.features[0].properties.label =
        'ILLUSTRATIVE Fixture Hotel'),
    'illustrative prefix',
  );
});

test('validateSceneStaging rejects duplicate ids and duplicate labels', () => {
  rejects(
    (s) => (s.layers.points.features[0].properties.id = 'focal-footprint'),
    'dup id',
  );
  rejects((s) => {
    const dup = structuredClone(s.layers.labels.features[0]);
    dup.properties.id = 'label-focal-2';
    dup.properties.label = 'FIXTURE hotel';
    s.layers.labels.features.push(dup);
  }, 'dup label (case-insensitive)');
});

test('validateSceneStaging rejects bad enums, colours, geometry and property keys', () => {
  rejects(
    (s) => (s.layers.points.features[0].properties.icon = 'rocket'),
    'unknown icon',
  );
  rejects(
    (s) => (s.layers.lines.features[0].properties.lineStyle = 'dotted'),
    'unknown lineStyle',
  );
  rejects(
    (s) => (s.layers.points.features[0].properties.color = 'teal'),
    'colour name',
  );
  rejects(
    (s) => (s.layers.points.features[0].properties.color = '#fff'),
    'short colour',
  );
  rejects(
    (s) => s.layers.areas.features[0].geometry.coordinates[0].pop(),
    'unclosed ring',
  );
  rejects(
    (s) => (s.layers.points.features[0].properties.foo = 'bar'),
    'property not allowed',
  );
  rejects((s) => {
    s.layers.lines.features[0].geometry = {
      type: 'Point',
      coordinates: [55.18, 25.14],
    };
  }, 'Point in lines layer');
  rejects(
    (s) => (s.layers.points.features[0].properties.provenance = 'guess'),
    'unknown provenance',
  );
});

test('cleanMapLabel strips citation tokens, the illustrative prefix and truncates', () => {
  assert.equal(cleanMapLabel('Fixture Hotel [1,2,3]'), 'Fixture Hotel');
  assert.equal(
    cleanMapLabel('ILLUSTRATIVE · Fixture   Hotel'),
    'Fixture Hotel',
  );
  assert.equal(cleanMapLabel('  A [1]  B [2-3] '), 'A B');
  const long = cleanMapLabel('x'.repeat(100));
  assert.equal(long.length, 48);
  assert.ok(long.endsWith('…'));
  assert.equal(cleanMapLabel(null), '');
});

test('stagingCounts counts areas, lines and points but not labels', () => {
  const s = makeStaging();
  assert.deepEqual(stagingCounts(s), { focal: 1, approach_route: 1, cones: 1 });
  assert.deepEqual(stagingCounts({}), {});
});

test('stagingSignature is stable and changes with a coordinate', () => {
  const a = makeStaging();
  const b = makeStaging();
  assert.equal(stagingSignature(a), stagingSignature(b));
  assert.match(stagingSignature(a), /^[0-9a-f]{8}$/);
  b.layers.points.features[0].geometry.coordinates[0] += 0.001;
  assert.notEqual(stagingSignature(a), stagingSignature(b));
  // labels do not participate in the signature
  const c = makeStaging();
  c.layers.labels.features[0].geometry.coordinates[1] += 0.001;
  assert.equal(stagingSignature(a), stagingSignature(c));
});

test('PRIORITY ordering: focal > cordon > route > unit > signal > barrier > cone', () => {
  assert.ok(PRIORITY.focal > PRIORITY.cordon);
  assert.ok(PRIORITY.cordon > PRIORITY.route);
  assert.ok(PRIORITY.route > PRIORITY.unit);
  assert.ok(PRIORITY.unit > PRIORITY.signal);
  assert.ok(PRIORITY.signal > PRIORITY.barrier);
  assert.ok(PRIORITY.barrier > PRIORITY.cone);
});
