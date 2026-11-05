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

test('an explicit cones/barriers count is spread over the closed segments and hard-capped (readability)', () => {
  const spec = structuredClone(SPEC);
  for (const e of spec.elements) {
    if (e.type === 'cones') e.params = { ...e.params, count: 24 };
    if (e.type === 'barriers') e.params = { ...e.params, count: 12 };
  }
  const out = stage({ spec });
  const cones = byElement(out.points, 'cones');
  const barriers = byElement(out.points, 'barriers');
  assert.ok(cones.length > 0 && cones.length <= 24, `cones ${cones.length}`);
  assert.ok(
    barriers.length > 0 && barriers.length <= 12,
    `barriers ${barriers.length}`,
  );
  const sources = new Set(cones.map((p) => p.properties.source));
  assert.ok(sources.size >= 2, 'markers are shared across closed roads');
  const huge = structuredClone(SPEC);
  for (const e of huge.elements)
    if (e.type === 'cones') e.params = { ...e.params, count: 200 };
  assert.ok(byElement(stage({ spec: huge }).points, 'cones').length <= 48);
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

test('engine renders dynamic intelligence elements (zones, markers, notes, timeline, generic)', () => {
  const dynamicSpec = {
    scenarioType: 'police_raid',
    focalEntity: { name: 'Fixture Hotel', kind: 'building' },
    elements: [
      {
        type: 'threat_zone',
        radius_m: 80,
        offset: { eastM: 100, northM: 50 },
        confidence: 0.85,
        source: 'Intelligence briefing',
        label: 'Threat Alpha',
      },
      {
        type: 'interest_zone',
        radius_m: 120,
        offset: { eastM: -150, northM: -100 },
        confidence: 0.7,
        label: 'Interest Bravo',
      },
      {
        type: 'crowd_density_zone',
        radius_m: 90,
        offset: { eastM: 200, northM: -200 },
        confidence: 0.6,
      },
      {
        type: 'overwatch',
        offset: { eastM: 250, northM: 250 },
        confidence: 0.9,
        label: 'Overwatch 1',
      },
      {
        type: 'command_post',
        offset: { eastM: -300, northM: 100 },
        confidence: 0.95,
        label: 'Tactical TOC',
      },
      {
        type: 'cordon_node',
        offset: { eastM: 50, northM: -150 },
        confidence: 0.8,
      },
      {
        type: 'cctv_pick',
        offset: { eastM: 80, northM: 80 },
        relevance: 0.9,
        confidence: 0.75,
        source: 'CAM-101',
      },
      {
        type: 'intel_note',
        offset: { eastM: 150, northM: 150 },
        label: 'Suspect vehicle spotted',
        evidenceTier: 'sourced',
        citations: [{ url: 'https://news.org/incident', title: 'News report' }],
      },
      {
        type: 'intel_note',
        label: 'Background assessment note',
        evidenceTier: 'inferred',
      },
      {
        type: 'timeline_event',
        atSec: 60,
        title: 'Perimeter established',
      },
      {
        type: 'drone_orbit',
        offset: { eastM: 400, northM: -400 },
        generic: true,
        label: 'Drone coverage',
      },
    ],
    confidence: 0.9,
  };

  const staged = stageFromData({
    spec: dynamicSpec,
    anchor: ANCHOR,
    buildings: BUILDINGS,
    roads: ROADS,
  });

  // 1. Zones
  const threatArea = staged.areas.find(
    (a) => a.properties.element === 'threat_zone',
  );
  assert.ok(threatArea);
  assert.equal(threatArea.properties.color, '#F59E0B');
  assert.equal(threatArea.properties.confidence, 0.85);
  assert.equal(threatArea.properties.source, 'Intelligence briefing');

  const interestArea = staged.areas.find(
    (a) => a.properties.element === 'interest_zone',
  );
  assert.ok(interestArea);
  assert.equal(interestArea.properties.color, '#14B8A6');

  const crowdDensityArea = staged.areas.find(
    (a) => a.properties.element === 'crowd_density_zone',
  );
  assert.ok(crowdDensityArea);
  assert.equal(crowdDensityArea.properties.color, '#A7F3D0');

  // 2. Point markers
  const overwatchPt = staged.points.find(
    (p) => p.properties.element === 'overwatch',
  );
  assert.ok(overwatchPt);
  assert.equal(overwatchPt.properties.icon, 'command_post');
  assert.equal(overwatchPt.properties.priority, 70);

  const cpPt = staged.points.find(
    (p) => p.properties.element === 'command_post',
  );
  assert.ok(cpPt);
  assert.equal(cpPt.properties.icon, 'command_post');
  assert.equal(cpPt.properties.priority, 70);

  const cordonPt = staged.points.find(
    (p) => p.properties.element === 'cordon_node',
  );
  assert.ok(cordonPt);
  assert.equal(cordonPt.properties.icon, 'cordon_node');
  assert.equal(cordonPt.properties.priority, 60);

  const cctvPt = staged.points.find(
    (p) => p.properties.element === 'cctv_pick',
  );
  assert.ok(cctvPt);
  assert.equal(cctvPt.properties.icon, 'cctv');
  assert.equal(cctvPt.properties.priority, 50);
  assert.equal(cctvPt.properties.relevance, 0.9);

  // 3. Generic unknown
  const dronePt = staged.points.find(
    (p) => p.properties.element === 'drone_orbit',
  );
  assert.ok(dronePt);
  assert.equal(dronePt.properties.icon, 'generic');
  assert.equal(dronePt.properties.generic, true);
  assert.equal(dronePt.properties.priority, 40);

  // 4. Notes: collected into notes[]
  assert.equal(staged.notes.length, 2);
  assert.equal(staged.notes[0].text, 'Suspect vehicle spotted');
  assert.equal(staged.notes[0].evidenceTier, 'sourced');
  assert.equal(staged.notes[0].citations[0].url, 'https://news.org/incident');
  // Note with offset is in labels
  assert.ok(staged.labels.some((l) => l.properties.element === 'intel_note'));
  // Note without offset has no point feature
  assert.ok(!staged.points.some((p) => p.properties.element === 'intel_note'));

  // 5. Timeline: collected into timeline[]
  assert.equal(staged.timeline.length, 1);
  assert.equal(staged.timeline[0].atSec, 60);
  assert.equal(staged.timeline[0].title, 'Perimeter established');

  // 6. Output validates with validateSceneStaging
  const fullStaging = {
    version: 1,
    illustrative: true,
    spec: dynamicSpec,
    anchor: ANCHOR,
    model: {
      provider: 'template',
      id: 'test',
      latencyMs: 10,
      attempts: [],
      repaired: false,
    },
    timing: { specMs: 1, geometryMs: 1, totalMs: 2 },
    sources: {
      footprint: 'osm-building',
      roads: 'overpass',
      routing: 'unavailable',
    },
    unavailable: [],
    layers: {
      areas: { type: 'FeatureCollection', features: staged.areas },
      lines: { type: 'FeatureCollection', features: staged.lines },
      points: { type: 'FeatureCollection', features: staged.points },
      labels: { type: 'FeatureCollection', features: staged.labels },
    },
    badge: { text: STAGING_BADGE_TEXT, single: true },
    legend: staged.legend,
    summary: stagingSummary(dynamicSpec, ANCHOR, {}),
    notes: staged.notes,
    timeline: staged.timeline,
  };
  const validated = validateSceneStaging(fullStaging);
  assert.equal(validated.version, 1);
  assert.equal(validated.illustrative, true);
  assert.equal(validated.notes.length, 2);
  assert.equal(validated.timeline.length, 1);
  assert.deepEqual(validateSceneStaging(validated), validated);
});

test('stageFromData renders a mixed spec deterministically (same input -> same output)', () => {
  const spec = {
    scenarioType: 'police_raid',
    focalEntity: { name: 'Fixture Hotel', kind: 'building' },
    elements: [
      { type: 'inner_cordon', params: { radius_m: 80 } },
      {
        type: 'threat_zone',
        radius_m: 90,
        offset: { eastM: 100, northM: 50 },
        label: 'Threat 1',
      },
      { type: 'command_post', offset: { eastM: -200, northM: 100 } },
      {
        type: 'drone_uav',
        generic: true,
        offset: { eastM: 300, northM: 300 },
      },
    ],
    confidence: 0.9,
  };
  const a = stageFromData({
    spec,
    anchor: ANCHOR,
    buildings: BUILDINGS,
    roads: ROADS,
    now: () => 1000,
  });
  const b = stageFromData({
    spec,
    anchor: ANCHOR,
    buildings: BUILDINGS,
    roads: ROADS,
    now: () => 1000,
  });
  assert.deepEqual(a, b);
});
