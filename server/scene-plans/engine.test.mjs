import test from 'node:test';
import assert from 'node:assert/strict';
import * as turf from '@turf/turf';
import { stageFromData, stagingSummary, createSceneEngine } from './engine.js';
import { templateSpec } from '../../src/scenes/sceneTemplates.js';
import {
  validateSceneStaging,
  STAGING_BADGE_TEXT,
} from '../../src/scenes/sceneStaging.js';

// ---- synthetic fixtures (no network) ---------------------------------------
const ANCHOR = { name: 'Fixture Hotel', lat: 25.1412, lon: 55.1853 };
const M_LAT = 111320;
const M_LON = M_LAT * Math.cos((ANCHOR.lat * Math.PI) / 180);
const r6 = (v) => Math.round(v * 1e6) / 1e6;
/** [lon, lat] offset from the anchor by dx metres east and dy metres north. */
const at = (dxM, dyM) => [
  r6(ANCHOR.lon + dxM / M_LON),
  r6(ANCHOR.lat + dyM / M_LAT),
];
const road = (name, highway, major, coordinates) => ({
  type: 'Feature',
  properties: { osmId: name.length, name, highway, major, oneway: false },
  geometry: { type: 'LineString', coordinates },
});
const BUILDINGS = [
  {
    type: 'Feature',
    properties: { osmId: 1, name: 'Fixture Hotel', building: 'hotel' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [at(-30, -30), at(30, -30), at(30, 30), at(-30, 30), at(-30, -30)],
      ],
    },
  },
];
const ROADS = [
  road(
    'Fixture Boulevard',
    'primary',
    true,
    [-1000, -500, 0, 500, 1000].map((x) => at(x, 150)),
  ),
  road(
    'Fixture Lane',
    'residential',
    false,
    [-600, -300, 0, 300, 600].map((y) => at(40, y)),
  ),
  road('Far Road', 'tertiary', true, [at(-500, 3000), at(500, 3000)]),
];
const APPROACH_1 = [
  [55.17, 25.15],
  [55.18, 25.145],
  [55.1853, 25.1425],
];
const APPROACH_2 = [
  [55.2, 25.13],
  [55.1853, 25.1425],
];
const EGRESS = [
  [55.1853, 25.1412],
  [55.19, 25.15],
];
const ROUTES = {
  approach: [{ coordinates: APPROACH_1, distanceM: 1800 }],
  egress: { coordinates: EGRESS, distanceM: 1200 },
};
const SPEC = templateSpec('police raid at Fixture Hotel');
const KM = { units: 'kilometers' };
const stage = (overrides = {}) =>
  stageFromData({
    spec: SPEC,
    anchor: ANCHOR,
    buildings: BUILDINGS,
    roads: ROADS,
    routes: ROUTES,
    ...overrides,
  });
const byElement = (list, element) =>
  list.filter((f) => f.properties.element === element);
const dist = (a, b) => turf.distance(turf.point(a), turf.point(b), KM) * 1000;
const toLine = (coord, line) =>
  turf.pointToLineDistance(turf.point(coord), line, KM) * 1000;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
/** Distances between consecutive placements on the same road. */
const consecutiveSpacing = (pts) => {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1].properties, pts[i].properties];
    if (a.source === b.source && b.index === a.index + 1)
      out.push(
        dist(pts[i - 1].geometry.coordinates, pts[i].geometry.coordinates),
      );
  }
  return out;
};
const countElements = (s) => {
  const counts = {};
  for (const f of [...s.areas, ...s.lines, ...s.points]) {
    // mirrors createSceneEngine: crowd zones are area + marker pairs
    if (f.properties.element === 'crowd_zone' && f.geometry.type === 'Point')
      continue;
    counts[f.properties.element] = (counts[f.properties.element] || 0) + 1;
  }
  return counts;
};
/** Wrap a stageFromData result exactly as createSceneEngine does. */
const wrap = (staged, spec = SPEC, anchor = ANCHOR) => ({
  version: 1,
  illustrative: true,
  spec,
  anchor,
  model: {
    provider: 'template',
    id: 't',
    latencyMs: 0,
    attempts: [],
    repaired: true,
  },
  timing: { specMs: 0, geometryMs: 1, totalMs: 1 },
  sources: { footprint: 'osm-building', roads: 'overpass', routing: 'osrm' },
  unavailable: staged.unavailable,
  layers: {
    areas: { type: 'FeatureCollection', features: staged.areas },
    lines: { type: 'FeatureCollection', features: staged.lines },
    points: { type: 'FeatureCollection', features: staged.points },
    labels: { type: 'FeatureCollection', features: staged.labels },
  },
  badge: { text: STAGING_BADGE_TEXT, single: true },
  legend: staged.legend,
});

assert.equal(SPEC.scenarioType, 'police_raid');
const full = stage();
const outer = full.areas.find((a) => a.properties.id === 'outer-cordon');
const inner = full.areas.find((a) => a.properties.id === 'inner-cordon');
const outerPoly = turf.polygon(outer.geometry.coordinates);
const outerLine = turf.polygonToLine(outerPoly);
const outerDist = (coord) => toLine(coord, outerLine);
const inOuter = (coord) =>
  turf.booleanPointInPolygon(turf.point(coord), outerPoly);
const center = [ANCHOR.lon, ANCHOR.lat];

test('footprint and cordons: osm footprint, nested rings, outer radius about the spec radius', () => {
  const focal = full.areas.find((a) => a.properties.id === 'focal-footprint');
  assert.equal(full.footprintSource, 'osm-building');
  assert.equal(focal.properties.provenance, 'osm-footprint-buffer');
  assert.equal(focal.properties.element, 'focal');
  assert.equal(inner.properties.lineStyle, 'cordon_inner');
  assert.equal(outer.properties.lineStyle, 'cordon_outer');
  assert.ok(
    turf.booleanWithin(turf.polygon(inner.geometry.coordinates), outerPoly),
  );
  const nearest = Math.min(
    ...outer.geometry.coordinates[0].map((c) => dist(center, c)),
  );
  assert.ok(
    nearest >= 0.9 * 250 && nearest <= 1.4 * 250,
    `nearest outer vertex ${nearest} m`,
  );
  assert.ok(
    turf.booleanPointInPolygon(
      turf.point(center),
      turf.polygon(focal.geometry.coordinates),
    ),
  );
});

test('cones and barriers follow the closed road segments at the requested spacing', () => {
  const cones = byElement(full.points, 'cones');
  const barriers = byElement(full.points, 'barriers');
  assert.ok(cones.length > 20);
  assert.ok(barriers.length > 5);
  const coneGaps = consecutiveSpacing(cones);
  const barrierGaps = consecutiveSpacing(barriers);
  assert.ok(coneGaps.length > 10);
  assert.ok(
    Math.abs(median(coneGaps) - 8) <= 2,
    `cone median ${median(coneGaps)}`,
  );
  assert.ok(
    Math.abs(median(barrierGaps) - 25) <= 6.25,
    `barrier median ${median(barrierGaps)}`,
  );
  for (const p of [...cones, ...barriers]) {
    assert.ok(
      inOuter(p.geometry.coordinates),
      `${p.properties.id} outside the outer cordon`,
    );
    assert.equal(p.properties.provenance, 'turf-along');
    assert.ok(p.properties.heading >= 0 && p.properties.heading < 360);
  }
  assert.equal(cones[0].properties.icon, 'cone');
  assert.equal(barriers[0].properties.icon, 'barrier');
  const sources = new Set(cones.map((p) => p.properties.source));
  assert.ok(sources.has('Fixture Boulevard') && sources.has('Fixture Lane'));
  assert.ok(!sources.has('Far Road'));
});

test('perimeter units sit on access points, checkpoints 18 m outside them', () => {
  const units = byElement(full.points, 'perimeter_unit');
  assert.equal(units.length, 6);
  assert.equal(full.accessPoints, 4);
  const intersect = units.filter(
    (u) => u.properties.provenance === 'turf-intersect',
  );
  assert.equal(intersect.length, 4);
  assert.deepEqual(units.slice(0, 4), intersect);
  for (const u of units)
    assert.ok(
      outerDist(u.geometry.coordinates) <= 30,
      `${u.properties.id} is off the ring`,
    );
  const checkpoints = byElement(full.points, 'checkpoint');
  assert.equal(checkpoints.length, 2);
  for (const c of checkpoints) {
    assert.equal(c.properties.icon, 'checkpoint');
    assert.equal(c.properties.source, 'Fixture Boulevard');
    const offsets = intersect.map((u) =>
      dist(u.geometry.coordinates, c.geometry.coordinates),
    );
    const nearestUnit = Math.min(...offsets);
    assert.ok(
      nearestUnit >= 15 && nearestUnit <= 21,
      `checkpoint offset ${nearestUnit} m`,
    );
    assert.ok(!inOuter(c.geometry.coordinates));
  }
});

test('staging point snaps to the nearest open road north of the anchor', () => {
  const staging = byElement(full.points, 'staging_point');
  assert.equal(staging.length, 1);
  const [s] = staging;
  assert.equal(s.properties.provenance, 'overpass-highway');
  assert.equal(s.properties.icon, 'staging_point');
  assert.ok(!inOuter(s.geometry.coordinates));
  assert.ok(s.geometry.coordinates[1] > ANCHOR.lat);
  assert.deepEqual(full.stagingCoord.map(r6), s.geometry.coordinates);
});

test('approach and egress routes become lines; two distinct approaches yield two lines', () => {
  const approach = byElement(full.lines, 'approach_route');
  assert.equal(approach.length, 1);
  assert.equal(approach[0].properties.lineStyle, 'route_approach');
  assert.equal(approach[0].properties.provenance, 'osrm-route');
  const egress = byElement(full.lines, 'egress_route');
  assert.equal(egress.length, 1);
  assert.equal(egress[0].properties.lineStyle, 'route_egress');
  const marker = full.points.find((p) => p.properties.id === 'egress-marker');
  assert.equal(marker.properties.icon, 'egress');
  assert.deepEqual(marker.geometry.coordinates, EGRESS.at(-1));
  const approach2 = [
    ...ROUTES.approach,
    { coordinates: APPROACH_2, distanceM: 2100 },
  ];
  const two = stage({ routes: { ...ROUTES, approach: approach2 } });
  assert.equal(byElement(two.lines, 'approach_route').length, 2);
  assert.equal(two.legend.find((l) => l.key === 'approach_route').count, 2);
});

test('labels are unique, clean, short and the focal label has priority 100', () => {
  const seen = new Set();
  for (const l of full.labels) {
    const text = l.properties.label;
    assert.ok(!seen.has(text.toLowerCase()), `duplicate label ${text}`);
    seen.add(text.toLowerCase());
    assert.ok(!text.includes('['));
    assert.ok(!/^illustrative/i.test(text));
    assert.ok(text.length <= 48);
  }
  const focal = full.labels.find(
    (l) => l.properties.labelFor === 'focal-footprint',
  );
  assert.equal(focal.properties.priority, 100);
  assert.equal(focal.properties.label, 'Fixture Hotel');
});

test('legend counts match the layers and unavailable lists only cctv_signal', () => {
  const legend = Object.fromEntries(full.legend.map((l) => [l.key, l]));
  const areaKeys = ['focal', 'inner_cordon', 'outer_cordon'];
  const pointKeys = [
    'cones',
    'barriers',
    'perimeter_unit',
    'checkpoint',
    'staging_point',
  ];
  const lineKeys = ['approach_route', 'egress_route'];
  for (const k of [...areaKeys, ...pointKeys, ...lineKeys])
    assert.ok(legend[k], `legend missing ${k}`);
  for (const k of areaKeys)
    assert.equal(legend[k].count, byElement(full.areas, k).length);
  for (const k of pointKeys)
    assert.equal(legend[k].count, byElement(full.points, k).length);
  for (const k of lineKeys)
    assert.equal(legend[k].count, byElement(full.lines, k).length);
  assert.deepEqual(
    full.unavailable.map((u) => u.element),
    ['cctv_signal'],
  );
  assert.match(full.unavailable[0].reason, /client/i);
});

test('wrapped output passes validateSceneStaging', () => {
  const staging = validateSceneStaging(wrap(full));
  assert.equal(staging.layers.points.features.length, full.points.length);
  assert.equal(staging.badge.text, STAGING_BADGE_TEXT);
});

test('degraded: no buildings falls back to a circle footprint', () => {
  const s = stage({ buildings: [] });
  assert.equal(s.footprintSource, 'circle-fallback');
  const focal = s.areas.find((a) => a.properties.id === 'focal-footprint');
  assert.equal(focal.properties.provenance, 'circle-buffer');
  assert.ok(s.areas.find((a) => a.properties.id === 'inner-cordon'));
  assert.ok(s.areas.find((a) => a.properties.id === 'outer-cordon'));
  validateSceneStaging(wrap(s));
});

test('degraded: no roads reports cones, barriers, perimeter units as unavailable', () => {
  const s = stage({ roads: [] });
  assert.equal(byElement(s.points, 'cones').length, 0);
  assert.equal(byElement(s.points, 'barriers').length, 0);
  const reasons = Object.fromEntries(
    s.unavailable.map((u) => [u.element, u.reason]),
  );
  assert.match(reasons.cones, /road network/i);
  assert.match(reasons.barriers, /road network/i);
  assert.ok(reasons.perimeter_unit);
  const units = byElement(s.points, 'perimeter_unit');
  assert.equal(units.length, 6);
  for (const u of units) {
    assert.equal(u.properties.provenance, 'circle-buffer');
    assert.ok(outerDist(u.geometry.coordinates) <= 30);
  }
  validateSceneStaging(wrap(s));
});

test('degraded: no routes reports approach and egress routes as unavailable', () => {
  const s = stage({ routes: {} });
  const elements = s.unavailable.map((u) => u.element);
  assert.ok(elements.includes('approach_route'));
  assert.ok(elements.includes('egress_route'));
  assert.equal(s.lines.length, 0);
  validateSceneStaging(wrap(s));
});

test('crowd event with a researched course draws the route line, zones and barriers', () => {
  const spec = templateSpec(
    'marathon along Fixture Course',
    'crowd_event',
    'Fixture Course',
  );
  const course = [at(-750, 400), at(-250, 420), at(250, 380), at(750, 400)];
  const courseLine = turf.lineString(course);
  assert.ok(Math.abs(turf.length(courseLine, KM) - 1.5) < 0.05);
  const s = stage({
    spec,
    routes: {},
    researchRoutes: [{ name: 'Fixture Course', coordinates: course }],
  });
  const line = s.lines.find((l) => l.properties.id === 'route-line');
  assert.equal(line.properties.lineStyle, 'route_line');
  assert.equal(line.properties.label, 'Fixture Course');
  const sf = s.points.find((p) => p.properties.id === 'start-finish');
  assert.deepEqual(sf.geometry.coordinates, course[0]);
  assert.equal(sf.properties.icon, 'start_finish');
  assert.equal(byElement(s.areas, 'crowd_zone').length, 2);
  for (const m of byElement(s.points, 'crowd_zone'))
    assert.ok(toLine(m.geometry.coordinates, courseLine) < 5);
  const barriers = byElement(s.points, 'barriers');
  assert.ok(barriers.length >= 30);
  for (const b of barriers) {
    assert.equal(b.properties.provenance, 'turf-along');
    assert.ok(toLine(b.geometry.coordinates, courseLine) < 5);
  }
  assert.equal(byElement(s.points, 'perimeter_unit').length, 4);
  const summary = stagingSummary(spec, ANCHOR, countElements(s));
  assert.ok(summary.includes('routed course corridor'));
  assert.match(summary, /2 crowd zones/);
  assert.ok(!summary.includes('['));
  validateSceneStaging(wrap(s, spec));
});

test('stageFromData is deterministic', () => {
  const a = JSON.stringify(stage({ now: () => 0 }));
  const b = JSON.stringify(stage({ now: () => 0 }));
  assert.equal(a, b);
});

test('createSceneEngine with an injected osm client returns a validated staging', async () => {
  const osm = {
    surroundings: async () => ({
      ok: true,
      buildings: BUILDINGS,
      roads: ROADS,
      endpoint: 'https://fixture',
      cacheHit: false,
      ms: 5,
    }),
    route: async (from, to) => ({
      ok: true,
      coordinates: [from, to],
      distanceM: 1000,
      ms: 3,
    }),
  };
  const logs = [];
  const engine = createSceneEngine({ osm, log: (e) => logs.push(e) });
  const staging = await engine.stage({ spec: SPEC, anchor: ANCHOR });
  assert.deepEqual(validateSceneStaging(staging), staging);
  assert.equal(staging.sources.roads, 'overpass');
  assert.equal(staging.sources.routing, 'osrm');
  assert.equal(staging.sources.footprint, 'osm-building');
  assert.equal(staging.sources.overpassEndpoint, 'https://fixture');
  for (const k of [
    'specMs',
    'overpassMs',
    'routingMs',
    'geometryMs',
    'totalMs',
  ])
    assert.equal(typeof staging.timing[k], 'number');
  assert.equal(typeof staging.summary, 'string');
  assert.ok(!staging.summary.includes('['));
  const lines = staging.layers.lines.features;
  assert.equal(
    byElement(lines, 'approach_route').length,
    1,
    'identical distances are deduplicated',
  );
  assert.equal(byElement(lines, 'egress_route').length, 1);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].event, 'staging');
});

test('createSceneEngine still builds a scene when Overpass is unavailable', async () => {
  const osm = {
    surroundings: async () => ({
      ok: false,
      buildings: [],
      roads: [],
      endpoint: null,
      cacheHit: false,
      ms: 2,
      reason: 'x',
    }),
    route: async () => ({
      ok: false,
      coordinates: null,
      distanceM: 0,
      ms: 1,
      reason: 'down',
    }),
  };
  const staging = await createSceneEngine({ osm }).stage({
    spec: SPEC,
    anchor: ANCHOR,
  });
  assert.deepEqual(validateSceneStaging(staging), staging);
  assert.equal(staging.sources.roads, 'unavailable');
  assert.equal(staging.sources.routing, 'unavailable');
  assert.equal(staging.sources.footprint, 'circle-fallback');
  assert.ok(
    staging.unavailable.some(
      (u) => /Overpass/.test(u.reason) && u.reason.includes('x'),
    ),
  );
  assert.ok(
    staging.layers.areas.features.some(
      (a) => a.properties.id === 'outer-cordon',
    ),
  );
  assert.ok(staging.unavailable.some((u) => u.element === 'approach_route'));
});
