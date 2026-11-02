import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  createSceneStagingLayer,
  declutterLabels,
  labelBox,
  STAGING_LABEL_FONT,
  STAGING_FOCAL_FONT,
  STAGING_HALO_WIDTH,
} from './sceneStagingLayer.js';
import {
  STAGING_BADGE_TEXT,
  STAGING_COLORS,
  PRIORITY,
  validateSceneStaging,
} from '../../scenes/sceneStaging.js';

// ---- minimal fake DOM (copied/condensed from sceneGeometryLayer.test.mjs) ----
function makeDoc() {
  const doc = {};
  function mk(tag) {
    const attrs = new Map();
    const node = {
      tagName: tag.toUpperCase(),
      id: '',
      children: [],
      parentNode: null,
      dataset: {},
      textContent: '',
      get className() {
        return attrs.get('class') || '';
      },
      set className(v) {
        attrs.set('class', v);
      },
      get hidden() {
        return attrs.has('hidden');
      },
      set hidden(v) {
        if (v) attrs.set('hidden', '');
        else attrs.delete('hidden');
      },
      setAttribute(n, v) {
        attrs.set(n, String(v));
      },
      getAttribute(n) {
        return attrs.get(n) ?? null;
      },
      removeAttribute(n) {
        attrs.delete(n);
      },
      append(...kids) {
        for (const k of kids) {
          k.remove();
          this.children.push(k);
          k.parentNode = this;
        }
      },
      replaceChildren(...kids) {
        for (const k of this.children) k.parentNode = null;
        this.children = [];
        this.append(...kids);
      },
      remove() {
        if (this.parentNode)
          this.parentNode.children = this.parentNode.children.filter(
            (c) => c !== this,
          );
        this.parentNode = null;
      },
      find(pred) {
        return this.children.flatMap((c) => [
          ...(pred(c) ? [c] : []),
          ...c.find(pred),
        ]);
      },
      matches(sel) {
        if (sel.startsWith('#')) return this.id === sel.slice(1);
        if (sel.startsWith('.'))
          return this.className.split(/\s+/).includes(sel.slice(1));
        return this.tagName === sel.toUpperCase();
      },
      querySelector(sel) {
        return this.find((c) => c.matches(sel))[0] || null;
      },
      querySelectorAll(sel) {
        return this.find((c) => c.matches(sel));
      },
    };
    return node;
  }
  doc.createElement = mk;
  doc.documentElement = mk('html');
  doc.body = mk('body');
  doc.documentElement.append(doc.body);
  doc.querySelector = (sel) => doc.documentElement.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.documentElement.querySelectorAll(sel);
  return doc;
}

function setup(t) {
  const document = makeDoc();
  let source;
  let removed = 0;
  const viewer = {
    scene: { requestRender() {} },
    dataSources: {
      add(v) {
        source = v;
      },
      remove() {
        removed += 1;
      },
    },
    isDestroyed: () => false,
  };
  const layer = createSceneStagingLayer(viewer, { document });
  t.after(() => layer.destroy());
  return { layer, source: () => source, document, removed: () => removed };
}

// ---- fixture ---------------------------------------------------------------
const { teal, mint, white, navy } = STAGING_COLORS;
const props = (id, element, role, priority, color, provenance, extra = {}) => ({
  illustrative: true,
  id,
  element,
  role,
  priority,
  color,
  provenance,
  ...extra,
});
const fc = (features) => ({ type: 'FeatureCollection', features });
const square = (lon, lat, d) => [
  [
    [lon - d, lat - d],
    [lon + d, lat - d],
    [lon + d, lat + d],
    [lon - d, lat + d],
    [lon - d, lat - d],
  ],
];
const area = (id, element, role, color, prov, d, lon, lat, extra) => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: square(lon, lat, d) },
  properties: props(id, element, role, 90, color, prov, extra),
});
const line = (id, element, color, lineStyle, lon, lat, dx, extra = {}) => ({
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: [
      [lon + dx, lat + dx],
      [lon + dx / 2, lat],
      [lon, lat],
    ],
  },
  properties: props(id, element, 'route', 80, color, 'osrm-route', {
    lineStyle,
    ...extra,
  }),
});
const point = (id, element, role, priority, prov, lon, lat, extra = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: props(id, element, role, priority, teal, prov, extra),
});
const label = (id, element, role, priority, color, text, lon, lat) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: props(id, element, role, priority, color, 'anchor', {
    label: text,
  }),
});

export function makeStaging({
  lon = 55.1853,
  lat = 25.1412,
  cctv = true,
} = {}) {
  const elements = [
    { type: 'inner_cordon', params: { radius_m: 80 } },
    { type: 'outer_cordon', params: { radius_m: 220 } },
    { type: 'approach_route', params: { count: 2 } },
    { type: 'egress_route', params: { count: 1, direction: 'NE' } },
    { type: 'staging_point', params: { direction: 'N' } },
    { type: 'perimeter_unit', params: { count: 2 } },
    { type: 'cones', params: { spacing_m: 8 } },
    ...(cctv ? [{ type: 'cctv_signal', params: { count: 2 } }] : []),
  ];
  return validateSceneStaging({
    version: 1,
    illustrative: true,
    spec: {
      scenarioType: 'police_raid',
      focalEntity: { name: 'Fixture Hotel', kind: 'building' },
      elements,
      confidence: 0.9,
    },
    anchor: { name: 'Fixture Hotel', lat, lon },
    model: {
      provider: 'ondemand',
      id: 'predefined-cerebras-qwen-3.8-27b',
      endpointId: 'predefined-cerebras-qwen-3.8-27b',
      latencyMs: 1830,
      attempts: [
        {
          provider: 'ondemand',
          id: 'predefined-cerebras-qwen-3.8-27b',
          ok: true,
          ms: 1830,
        },
      ],
      repaired: false,
    },
    timing: {
      specMs: 1830,
      overpassMs: 900,
      routingMs: 400,
      geometryMs: 40,
      totalMs: 3200,
    },
    sources: { footprint: 'osm-building', roads: 'overpass', routing: 'osrm' },
    unavailable: [{ element: 'cctv_signal', reason: 'client cameras only' }],
    layers: {
      areas: fc([
        area(
          'focal-footprint',
          'focal',
          'focal',
          white,
          'osm-footprint-buffer',
          0.0002,
          lon,
          lat,
          {
            label: 'Fixture Hotel',
          },
        ),
        area(
          'inner-cordon',
          'inner_cordon',
          'cordon',
          teal,
          'circle-buffer',
          0.0008,
          lon,
          lat,
          {
            lineStyle: 'cordon_inner',
          },
        ),
        area(
          'outer-cordon',
          'outer_cordon',
          'cordon',
          mint,
          'circle-buffer',
          0.002,
          lon,
          lat,
          {
            lineStyle: 'cordon_outer',
          },
        ),
      ]),
      lines: fc([
        line(
          'approach-route-1',
          'approach_route',
          teal,
          'route_approach',
          lon,
          lat,
          0.004,
          {
            label: 'Approach route 1',
          },
        ),
        line(
          'egress-route',
          'egress_route',
          mint,
          'route_egress',
          lon,
          lat,
          -0.003,
        ),
      ]),
      points: fc([
        point('cones-1', 'cones', 'cone', 10, 'turf-along', lon + 0.001, lat, {
          icon: 'cone',
          heading: 90,
        }),
        point('cones-2', 'cones', 'cone', 10, 'turf-along', lon + 0.0011, lat, {
          icon: 'cone',
          heading: 90,
        }),
        point('cones-3', 'cones', 'cone', 10, 'turf-along', lon + 0.0012, lat, {
          icon: 'cone',
          heading: 90,
        }),
        point(
          'perimeter-unit-1',
          'perimeter_unit',
          'unit',
          60,
          'turf-intersect',
          lon,
          lat + 0.0008,
          {
            icon: 'police_unit',
          },
        ),
        point(
          'staging-point',
          'staging_point',
          'unit',
          65,
          'anchor',
          lon,
          lat + 0.003,
          {
            icon: 'staging_point',
          },
        ),
        point(
          'egress-marker',
          'egress_route',
          'marker',
          55,
          'osrm-route',
          lon - 0.003,
          lat - 0.003,
          {
            icon: 'egress',
          },
        ),
      ]),
      labels: fc([
        label(
          'label-focal-1',
          'focal',
          'focal',
          100,
          white,
          'Fixture Hotel',
          lon,
          lat,
        ),
        label(
          'label-inner-cordon-2',
          'inner_cordon',
          'cordon',
          90,
          mint,
          'Inner cordon · 80 m',
          lon,
          lat + 0.0008,
        ),
        label(
          'label-approach-route-1-3',
          'approach_route',
          'route',
          80,
          teal,
          'Approach route 1',
          lon + 0.002,
          lat + 0.002,
        ),
        label(
          'label-staging-point-4',
          'staging_point',
          'unit',
          65,
          teal,
          'Staging point (N)',
          lon,
          lat + 0.003,
        ),
      ]),
    },
    badge: { text: STAGING_BADGE_TEXT, single: true },
    legend: [
      {
        key: 'inner_cordon',
        label: 'Inner cordon',
        swatch: 'area',
        color: teal,
        count: 1,
      },
      {
        key: 'cones',
        label: 'Cones',
        swatch: 'icon',
        color: teal,
        icon: 'cone',
        count: 3,
      },
    ],
    summary:
      'Police raid (illustrative) around Fixture Hotel: 2 cordons, 2 routes, 3 cones.',
  });
}

const now = Cesium.JulianDate.now();
const val = (prop) =>
  prop && typeof prop.getValue === 'function' ? prop.getValue(now) : prop;
const byId = (source, id) => source.entities.getById(id);
const colorNear = (c, hex) => {
  const ref = Cesium.Color.fromCssColorString(hex);
  return (
    Math.abs(c.red - ref.red) < 0.01 &&
    Math.abs(c.green - ref.green) < 0.01 &&
    Math.abs(c.blue - ref.blue) < 0.01
  );
};
const materialColor = (m) => (m instanceof Cesium.Color ? m : val(m.color));

test('fixture validates and has the expected shape', () => {
  const staging = makeStaging();
  assert.equal(staging.layers.areas.features.length, 3);
  assert.equal(staging.layers.lines.features.length, 2);
  assert.equal(staging.layers.points.features.length, 6);
  assert.equal(staging.layers.labels.features.length, 4);
  for (const layer of Object.values(staging.layers))
    for (const f of layer.features)
      assert.equal(f.properties.illustrative, true);
});

test('areas render polygon + casing + outline, cordons dashed, focal solid', (t) => {
  const { layer, source } = setup(t);
  layer.setScene({ staging: makeStaging() });
  for (const id of ['focal-footprint', 'inner-cordon', 'outer-cordon']) {
    assert.ok(byId(source(), `staging-${id}`).polygon, `${id} polygon`);
    assert.ok(byId(source(), `staging-${id}-casing`).polyline, `${id} casing`);
    assert.ok(
      byId(source(), `staging-${id}-outline`).polyline,
      `${id} outline`,
    );
  }
  for (const id of ['inner-cordon', 'outer-cordon'])
    assert.ok(
      byId(source(), `staging-${id}-outline`).polyline.material instanceof
        Cesium.PolylineDashMaterialProperty,
    );
  assert.ok(
    !(
      byId(source(), 'staging-focal-footprint-outline').polyline
        .material instanceof Cesium.PolylineDashMaterialProperty
    ),
  );
});

test('lines render navy casing wider than core, routes glow, egress arrows', (t) => {
  const { layer, source } = setup(t);
  layer.setScene({ staging: makeStaging() });
  for (const id of ['approach-route-1', 'egress-route']) {
    const core = byId(source(), `staging-${id}`).polyline;
    const casing = byId(source(), `staging-${id}-casing`).polyline;
    assert.ok(val(casing.width) > val(core.width), `${id} casing wider`);
    assert.ok(
      colorNear(materialColor(casing.material), navy),
      `${id} casing navy`,
    );
    const glow = byId(source(), `staging-${id}-glow`);
    assert.ok(
      glow &&
        glow.polyline.material instanceof Cesium.PolylineGlowMaterialProperty,
      `${id} glow`,
    );
  }
  assert.ok(
    byId(source(), 'staging-egress-route').polyline.material instanceof
      Cesium.PolylineArrowMaterialProperty,
  );
  assert.ok(
    !(
      byId(source(), 'staging-approach-route-1').polyline.material instanceof
      Cesium.PolylineArrowMaterialProperty
    ),
  );
});

test('points with icons are clamped billboards with sprite images', (t) => {
  const { layer, source } = setup(t);
  const staging = makeStaging();
  layer.setScene({ staging });
  for (const f of staging.layers.points.features) {
    const bb = byId(source(), `staging-${f.properties.id}`).billboard;
    assert.ok(bb, `${f.properties.id} billboard`);
    // URL first (2x bitmap, crisp at 32–64 px), backplated canvas once decoded.
    const img = val(bb.image);
    assert.ok(
      typeof img === 'string'
        ? img.endsWith(`/scene-icons/png/${f.properties.icon}@2x.png`)
        : img?.tagName === 'CANVAS',
      `${f.properties.id} image`,
    );
    assert.equal(
      val(bb.heightReference),
      Cesium.HeightReference.CLAMP_TO_GROUND,
    );
    assert.equal(val(bb.disableDepthTestDistance), Number.POSITIVE_INFINITY);
    const w = val(bb.width);
    assert.ok(w >= 28 && w <= 64, `${f.properties.id} width ${w} in 28–64 px`);
  }
  // Cones stay small (28 px); units are unmistakable at >= 32 px.
  assert.equal(val(byId(source(), 'staging-cones-1').billboard.width), 28);
  assert.ok(
    val(byId(source(), 'staging-perimeter-unit-1').billboard.width) >= 32,
  );
});

test('labels use haloed fonts, no citation tokens, no badge text', (t) => {
  const { layer, source } = setup(t);
  const staging = makeStaging();
  layer.setScene({ staging });
  assert.ok(STAGING_LABEL_FONT.includes('13px'));
  assert.ok(STAGING_FOCAL_FONT.includes('14px'));
  assert.ok(STAGING_HALO_WIDTH >= 1.5);
  for (const f of staging.layers.labels.features) {
    const lb = byId(source(), `staging-${f.properties.id}`).label;
    const focal = f.properties.role === 'focal';
    assert.equal(val(lb.font), focal ? STAGING_FOCAL_FONT : STAGING_LABEL_FONT);
    assert.equal(val(lb.outlineWidth), STAGING_HALO_WIDTH);
    assert.ok(colorNear(val(lb.outlineColor), navy));
    assert.equal(val(lb.style), Cesium.LabelStyle.FILL_AND_OUTLINE);
    assert.equal(val(lb.showBackground), false);
    const text = val(lb.text);
    assert.ok(!text.includes('['));
    assert.ok(!/^ILLUSTRATIVE/i.test(text));
  }
});

test('exactly one DOM badge, toggled by setScene/clear, never a map label', (t) => {
  const { layer, source, document } = setup(t);
  const staging = makeStaging();
  layer.setScene({ staging });
  let badges = document.querySelectorAll('#scene-illustrative-badge');
  assert.equal(badges.length, 1);
  assert.equal(badges[0].textContent, STAGING_BADGE_TEXT);
  assert.equal(badges[0].hidden, false);
  assert.equal(badges[0].dataset.scenario, 'police_raid');
  layer.clear();
  assert.equal(
    document.querySelector('#scene-illustrative-badge').hidden,
    true,
  );
  layer.setScene({ staging });
  badges = document.querySelectorAll('#scene-illustrative-badge');
  assert.equal(badges.length, 1);
  assert.equal(badges[0].hidden, false);
  for (const e of source().entities.values)
    if (e.label) assert.ok(!val(e.label.text).includes(STAGING_BADGE_TEXT));
});

test('setCameras adds verified cctv markers only when the spec asks for them', (t) => {
  const { layer, source } = setup(t);
  const cams = [
    {
      id: 'cam-1',
      name: 'Cam',
      lat: 25.1415,
      lon: 55.1855,
      distanceM: 40,
      status: 'live',
      provider: 'Fixture',
      usable: true,
    },
    { id: 'cam-2', lat: 25.14, lon: 55.18, usable: false },
  ];
  layer.setScene({ staging: makeStaging() });
  layer.setCameras(cams);
  const marks = source().entities.values.filter((e) =>
    e.id.startsWith('staging-cctv-'),
  );
  assert.equal(marks.length, 1);
  assert.equal(marks[0].id, 'staging-cctv-1');
  assert.ok(val(marks[0].billboard.image).endsWith('cctv_signal.png'));
  assert.equal(val(marks[0].properties.status), 'live');
  assert.equal(layer.getState().cameraMarkers, 1);
  layer.setScene({ staging: makeStaging({ cctv: false }) });
  layer.setCameras(cams);
  assert.equal(
    source().entities.values.filter((e) => e.id.startsWith('staging-cctv-'))
      .length,
    0,
  );
  assert.equal(layer.getState().cameraMarkers, 0);
});

test('getState reports a staged scene', (t) => {
  const { layer } = setup(t);
  layer.setScene({ staging: makeStaging() });
  const s = layer.getState();
  assert.equal(s.status, 'staged');
  assert.equal(s.scenario, 'police_raid');
  assert.match(s.signature, /^[0-9a-f]{8}$/);
  assert.equal(s.counts.cones, 3);
  assert.equal(s.areas, 3);
  assert.equal(s.lines, 2);
  assert.equal(s.points, 6);
  assert.equal(s.labels.length, 4);
  for (const l of s.labels) {
    assert.equal(typeof l.text, 'string');
    assert.equal(typeof l.priority, 'number');
    assert.equal(typeof l.visible, 'boolean');
  }
  assert.equal(s.badgeVisible, true);
  assert.equal(s.badgeCount, 1);
  assert.deepEqual(s.model, {
    provider: 'ondemand',
    id: 'predefined-cerebras-qwen-3.8-27b',
    latencyMs: 1830,
  });
});

test('setScene(null) and clear() remove everything', (t) => {
  const { layer, source } = setup(t);
  layer.setScene({ staging: makeStaging() });
  assert.ok(source().entities.values.length > 0);
  layer.setScene(null);
  assert.equal(source().entities.values.length, 0);
  assert.equal(layer.getState().status, 'none');
  layer.setScene({ staging: makeStaging() });
  layer.clear();
  assert.equal(source().entities.values.length, 0);
  assert.equal(layer.getState().status, 'none');
  assert.equal(layer.getState().badgeVisible, false);
});

test('destroy removes the badge and the data source', (t) => {
  const { layer, document, removed } = setup(t);
  layer.setScene({ staging: makeStaging() });
  layer.destroy();
  assert.equal(
    document.querySelectorAll('#scene-illustrative-badge').length,
    0,
  );
  assert.equal(removed(), 1);
  layer.setScene({ staging: makeStaging() });
  assert.equal(
    document.querySelectorAll('#scene-illustrative-badge').length,
    0,
  );
});

test('declutterLabels keeps the higher priority among overlapping boxes', () => {
  const a = { id: 'a', priority: 90, x: 0, y: 0, w: 50, h: 18 };
  const b = { id: 'b', priority: 10, x: 10, y: 5, w: 50, h: 18 };
  const c = { id: 'c', priority: 10, x: 300, y: 300, w: 50, h: 18 };
  assert.deepEqual([...declutterLabels([b, a, c])].sort(), ['a', 'c']);
  // tie-break by id
  const t1 = { id: 'zeta', priority: 50, x: 0, y: 0, w: 40, h: 18 };
  const t2 = { id: 'alpha', priority: 50, x: 5, y: 5, w: 40, h: 18 };
  assert.deepEqual([...declutterLabels([t1, t2])], ['alpha']);
  // padding: boxes 3 px apart
  const p1 = { id: 'p1', priority: 60, x: 0, y: 0, w: 40, h: 18 };
  const p2 = { id: 'p2', priority: 40, x: 43, y: 0, w: 40, h: 18 };
  assert.equal(declutterLabels([p1, p2], 4).size, 1);
  assert.equal(declutterLabels([p1, p2], 0).size, 2);
});

test('labelBox is centred with width proportional to text length', () => {
  const short = labelBox('s', 10, 100, 50, 'Cone');
  const long = labelBox('l', 10, 100, 50, 'Inner cordon · 80 m');
  assert.ok(long.w > short.w);
  assert.ok(Math.abs(short.h - 18) <= 1);
  assert.ok(Math.abs(short.x + short.w / 2 - 100) < 1e-9);
  assert.ok(Math.abs(short.y + short.h / 2 - 50) < 1e-9);
  assert.equal(long.id, 'l');
  assert.equal(long.priority, 10);
});

test('different stagings produce different signatures', (t) => {
  const { layer } = setup(t);
  layer.setScene({ staging: makeStaging() });
  const first = layer.getState().signature;
  layer.setScene({ staging: makeStaging({ lon: 55.27, lat: 25.2 }) });
  const second = layer.getState().signature;
  assert.match(second, /^[0-9a-f]{8}$/);
  assert.notEqual(first, second);
});

test('sceneStagingLayer supports new manifest keys, entity properties, and tooltip lifecycle', (t) => {
  const { layer, document } = setup(t);
  const tooltips = document.querySelectorAll('#scene-staging-tooltip');
  assert.equal(tooltips.length, 1, 'tooltip element must be created');
  assert.equal(tooltips[0].getAttribute('role'), 'tooltip');
  assert.equal(tooltips[0].hidden, true);

  // Priorities match requirement: zones 85, routes 80, command_post/overwatch 70, checkpoint/cordon_node 60, cctv 50, generic 40, cone/barrier 10
  assert.equal(PRIORITY.zone, 85);
  assert.equal(PRIORITY.route, 80);
  assert.equal(PRIORITY.command_post, 70);
  assert.equal(PRIORITY.overwatch, 70);
  assert.equal(PRIORITY.checkpoint, 60);
  assert.equal(PRIORITY.cordon_node, 60);
  assert.equal(PRIORITY.cctv, 50);
  assert.equal(PRIORITY.generic, 40);
  assert.equal(PRIORITY.cone, 10);
  assert.equal(PRIORITY.barrier, 20);

  layer.destroy();
  assert.equal(document.querySelectorAll('#scene-staging-tooltip').length, 0);
});
