import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createScenePanel,
  modelLine,
  locationBadgeText,
  sourceChips,
  ELEMENT_LABELS,
  ELEMENT_ICONS,
} from './scenePanel.js';
import {
  STAGING_BADGE_TEXT,
  STAGING_COLORS,
  validateSceneStaging,
} from '../../scenes/sceneStaging.js';
import { SCENARIO_LABELS } from '../../scenes/sceneTemplates.js';

// ---- minimal fake DOM (pattern from sceneGeometryLayer.test.mjs) ------------
function makeDoc() {
  const doc = {};
  function mk(tag) {
    const attrs = new Map();
    let ownText = '';
    const node = {
      tagName: tag.toUpperCase(),
      id: '',
      children: [],
      parentNode: null,
      dataset: {},
      src: '',
      alt: '',
      width: 0,
      height: 0,
      href: '',
      target: '',
      rel: '',
      title: '',
      get textContent() {
        return ownText + this.children.map((c) => c.textContent).join('');
      },
      set textContent(v) {
        ownText = String(v);
        for (const c of this.children) c.parentNode = null;
        this.children = [];
      },
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
        if (n.startsWith('data-')) delete this.dataset[n.slice(5)];
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

// ---- compact valid staging fixture -----------------------------------------
const { teal, mint, white } = STAGING_COLORS;
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
const LON = 55.1853;
const LAT = 25.1412;
const ring = (d) => [
  [
    [LON - d, LAT - d],
    [LON + d, LAT - d],
    [LON + d, LAT + d],
    [LON - d, LAT + d],
    [LON - d, LAT - d],
  ],
];
const area = (id, element, role, color, prov, d, extra) => ({
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: ring(d) },
  properties: props(id, element, role, 90, color, prov, extra),
});
const line = (id, element, color, lineStyle, dx, extra = {}) => ({
  type: 'Feature',
  geometry: {
    type: 'LineString',
    coordinates: [
      [LON + dx, LAT + dx],
      [LON, LAT],
    ],
  },
  properties: props(id, element, 'route', 80, color, 'osrm-route', {
    lineStyle,
    ...extra,
  }),
});
const point = (id, element, role, priority, prov, dx, dy, extra = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [LON + dx, LAT + dy] },
  properties: props(id, element, role, priority, teal, prov, extra),
});
const label = (id, element, role, priority, color, text, dy) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [LON, LAT + dy] },
  properties: props(id, element, role, priority, color, 'anchor', {
    label: text,
  }),
});

function makeStaging({ barriers = false, model, unavailable } = {}) {
  const elements = [
    { type: 'inner_cordon', params: { radius_m: 80 } },
    { type: 'outer_cordon', params: { radius_m: 220 } },
    { type: 'approach_route', params: { count: 2 } },
    { type: 'egress_route', params: { count: 1, direction: 'NE' } },
    { type: 'staging_point', params: { direction: 'N' } },
    { type: 'perimeter_unit', params: { count: 2 } },
    { type: 'cones', params: { spacing_m: 8 } },
    { type: 'cctv_signal', params: { count: 2 } },
    ...(barriers ? [{ type: 'barriers', params: { count: 4 } }] : []),
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
    anchor: { name: 'Fixture Hotel', lat: LAT, lon: LON },
    model: model || {
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
    unavailable: unavailable || [
      { element: 'cctv_signal', reason: 'client cameras only' },
      ...(barriers
        ? [{ element: 'barriers', reason: 'no suitable road segment' }]
        : []),
    ],
    layers: {
      areas: fc([
        area(
          'focal-footprint',
          'focal',
          'focal',
          white,
          'osm-footprint-buffer',
          0.0002,
          { label: 'Fixture Hotel' },
        ),
        area(
          'inner-cordon',
          'inner_cordon',
          'cordon',
          teal,
          'circle-buffer',
          0.0008,
          { lineStyle: 'cordon_inner' },
        ),
        area(
          'outer-cordon',
          'outer_cordon',
          'cordon',
          mint,
          'circle-buffer',
          0.002,
          { lineStyle: 'cordon_outer' },
        ),
      ]),
      lines: fc([
        line(
          'approach-route-1',
          'approach_route',
          teal,
          'route_approach',
          0.004,
          { label: 'Approach route 1' },
        ),
        line('egress-route', 'egress_route', mint, 'route_egress', -0.003),
      ]),
      points: fc([
        point('cones-1', 'cones', 'cone', 10, 'turf-along', 0.001, 0, {
          icon: 'cone',
          heading: 90,
        }),
        point('cones-2', 'cones', 'cone', 10, 'turf-along', 0.0011, 0, {
          icon: 'cone',
          heading: 90,
        }),
        point('cones-3', 'cones', 'cone', 10, 'turf-along', 0.0012, 0, {
          icon: 'cone',
          heading: 90,
        }),
        point(
          'perimeter-unit-1',
          'perimeter_unit',
          'unit',
          60,
          'turf-intersect',
          0,
          0.0008,
          { icon: 'police_unit' },
        ),
        point(
          'staging-point',
          'staging_point',
          'unit',
          65,
          'anchor',
          0,
          0.003,
          { icon: 'staging_point' },
        ),
        point(
          'egress-marker',
          'egress_route',
          'marker',
          55,
          'osrm-route',
          -0.003,
          -0.003,
          { icon: 'egress' },
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
          0,
        ),
        label(
          'label-inner-cordon-2',
          'inner_cordon',
          'cordon',
          90,
          mint,
          'Inner cordon · 80 m',
          0.0008,
        ),
        label(
          'label-approach-route-1-3',
          'approach_route',
          'route',
          80,
          teal,
          'Approach route 1',
          0.002,
        ),
        label(
          'label-staging-point-4',
          'staging_point',
          'unit',
          65,
          teal,
          'Staging point (N)',
          0.003,
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

const makeScene = (overrides = {}) => ({
  id: 's1',
  title: 'Police raid at Fixture Hotel [1,2]',
  staging: makeStaging(),
  locationResolution: {
    approximate: true,
    confidence: 0.78,
    sourceCount: 3,
    precision: 'address',
  },
  citations: [
    { url: 'https://example.org/a', title: 'Source A [1]' },
    { url: 'https://example.org/a' },
    { url: 'https://news.example.com/b', title: 'B' },
  ],
  geometry: {
    citations: [{ id: 'c1', url: 'https://osm.example/c', title: 'C' }],
  },
  cameraMarkers: 1,
  ...overrides,
});

function setup(t) {
  const document = makeDoc();
  const panel = createScenePanel({ document });
  document.body.append(panel.element);
  t.after(() => panel.destroy());
  const q = (sel) => panel.element.querySelector(sel);
  return { panel, document, q, root: panel.element };
}

test('hidden until setScene, then title/summary/scenario/location', (t) => {
  const { panel, q, root } = setup(t);
  assert.equal(root.hidden, true);
  const scene = makeScene();
  panel.setScene(scene);
  assert.equal(root.hidden, false);
  assert.equal(root.dataset.scenario, 'police_raid');
  assert.equal(
    q('#scene-panel-title').textContent,
    'Police raid at Fixture Hotel',
  );
  assert.equal(q('#scene-panel-summary').textContent, scene.staging.summary);
  assert.equal(
    q('#scene-panel-scenario').textContent,
    SCENARIO_LABELS.police_raid,
  );
  assert.ok(q('#scene-panel-location').textContent.includes('Fixture Hotel'));
  const badge = q('#scene-panel-location-badge');
  assert.equal(badge.dataset.kind, 'approximate');
  assert.equal(badge.textContent, 'Approximate · 78% confidence');
  panel.setScene(
    makeScene({ locationResolution: { approximate: false, confidence: 0.95 } }),
  );
  assert.equal(q('#scene-panel-location-badge').dataset.kind, 'verified');
  assert.equal(
    q('#scene-panel-location-badge').textContent,
    'Verified · 95% confidence',
  );
  panel.setScene(makeScene({ locationResolution: undefined }));
  assert.equal(
    q('#scene-panel-location-badge').textContent,
    'Location verified',
  );
  assert.equal(root.querySelectorAll('#scene-panel-location-badge').length, 1);
});

test('elements list: one li per spec element type with icon, label and count', (t) => {
  const { panel, q } = setup(t);
  const scene = makeScene();
  panel.setScene(scene);
  const items = q('#scene-panel-elements').children;
  const types = scene.staging.spec.elements.map((e) => e.type);
  assert.equal(items.length, 8);
  assert.deepEqual(
    items.map((li) => li.dataset.element),
    types,
  );
  for (const li of items) {
    const type = li.dataset.element;
    const img = li.querySelector('img');
    if (ELEMENT_ICONS[type]) {
      assert.ok(img, `${type} icon`);
      assert.ok(
        img.src.endsWith(`/scene-icons/svg/${ELEMENT_ICONS[type]}.svg`),
      );
    } else assert.equal(img, null);
    assert.ok(li.textContent.includes(ELEMENT_LABELS[type]));
  }
  const count = (type) =>
    items
      .find((li) => li.dataset.element === type)
      .querySelector('.scene-panel__count');
  assert.equal(count('cones').textContent, '× 3');
  assert.equal(count('inner_cordon').textContent, '× 1');
  assert.equal(count('cctv_signal').textContent, '× 1');
  panel.setScene(makeScene({ staging: makeStaging({ barriers: true }) }));
  const barriers = q('#scene-panel-elements').children.find(
    (li) => li.dataset.element === 'barriers',
  );
  assert.ok(barriers);
  assert.equal(
    barriers.querySelector('.scene-panel__count').textContent,
    'not derived',
  );
  assert.equal(
    barriers.querySelector('.scene-panel__count').title,
    'no suitable road segment',
  );
  assert.equal(q('#scene-panel-elements').children.length, 9);
});

test('sources: numbered, deduplicated link chips; heading hidden when empty', (t) => {
  const { panel, q } = setup(t);
  panel.setScene(makeScene());
  const links = q('#scene-panel-sources').querySelectorAll('a');
  assert.equal(links.length, 3);
  assert.deepEqual(
    links.map((a) => a.textContent),
    ['1 · example.org', '2 · news.example.com', '3 · osm.example'],
  );
  for (const a of links) {
    assert.equal(a.target, '_blank');
    assert.equal(a.rel, 'noopener noreferrer');
    assert.ok(!a.title.includes('[1]'));
    assert.ok(a.href.startsWith('https://'));
  }
  assert.equal(links[0].title, 'Source A');
  const heads = q('#scene-panel-sources').parentNode.children.filter(
    (c) => c.tagName === 'H4',
  );
  const sourcesHead = heads.find((h) => h.textContent === 'Sources');
  assert.equal(sourcesHead.hidden, false);
  panel.setScene(makeScene({ citations: [], geometry: {} }));
  assert.equal(q('#scene-panel-sources').children.length, 0);
  assert.equal(sourcesHead.hidden, true);
  assert.equal(q('#scene-panel-sources').hidden, true);
});

test('exactly one caveat line, no citation tokens, no stacked banners', (t) => {
  const { panel, root } = setup(t);
  panel.setScene(makeScene());
  const caveats = root.querySelectorAll('#scene-panel-caveat');
  assert.equal(caveats.length, 1);
  assert.equal(caveats[0].tagName, 'P');
  const text = root.textContent;
  assert.ok(!text.includes('[1'));
  assert.ok((text.match(/not a verified/g) || []).length <= 1);
  assert.equal((text.match(/not a verified/g) || []).length, 1);
  assert.ok(!text.includes(STAGING_BADGE_TEXT));
});

test('built line and modelLine variants', (t) => {
  const { panel, q } = setup(t);
  panel.setScene(makeScene());
  const built = q('#scene-panel-built');
  assert.equal(
    built.textContent,
    'Built with OnDemand predefined-cerebras-qwen-3.8-27b in 1830 ms',
  );
  assert.equal(built.dataset.latencyMs, '1830');
  assert.equal(built.dataset.totalMs, '3200');
  assert.equal(
    modelLine({ provider: 'template', id: 'template' }),
    'Built with scenario template (no model)',
  );
  assert.equal(
    modelLine({ provider: 'template', id: 'template', latencyMs: 0 }),
    'Built with scenario template (no model) in 0 ms',
  );
  assert.ok(
    modelLine({
      provider: 'cerebras-direct',
      id: 'qwen-3.8-27b',
      latencyMs: 900,
    }).startsWith('Built with Cerebras qwen-3.8-27b'),
  );
  assert.equal(
    modelLine({
      provider: 'template',
      id: 'template',
      latencyMs: 12,
      fallback: 'template',
    }),
    'Built with scenario template (no model) in 12 ms · fallback',
  );
  assert.equal(modelLine(null), '');
});

test('sourceChips dedupes, strips www., skips invalid URLs, caps and numbers', () => {
  const chips = sourceChips(
    [
      { url: 'https://www.example.org/a', title: 'A [1]' },
      { url: 'https://www.example.org/a', title: 'dup' },
      { url: 'not a url', title: 'bad' },
      { title: 'no url' },
      { url: 'https://news.example.com/b' },
      { url: 'https://osm.example/c', title: 'C' },
    ],
    2,
  );
  assert.equal(chips.length, 2);
  assert.deepEqual(
    chips.map((c) => c.number),
    [1, 2],
  );
  assert.equal(chips[0].host, 'example.org');
  assert.equal(chips[0].title, 'A');
  assert.equal(chips[1].host, 'news.example.com');
  assert.equal(chips[1].title, 'news.example.com');
  assert.equal(sourceChips([]).length, 0);
  assert.equal(sourceChips(undefined).length, 0);
});

test('locationBadgeText rounding', () => {
  assert.deepEqual(
    locationBadgeText({ approximate: true, confidence: 0.784 }),
    {
      kind: 'approximate',
      text: 'Approximate · 78% confidence',
    },
  );
  assert.deepEqual(
    locationBadgeText({ approximate: false, confidence: 0.955 }),
    {
      kind: 'verified',
      text: 'Verified · 96% confidence',
    },
  );
  assert.deepEqual(locationBadgeText({ approximate: true }), {
    kind: 'approximate',
    text: 'Approximate · 0% confidence',
  });
  assert.deepEqual(locationBadgeText(null), {
    kind: 'verified',
    text: 'Location verified',
  });
});

test('getState, setScene(null) and destroy', (t) => {
  const { panel, document, root } = setup(t);
  panel.setScene(makeScene());
  const s = panel.getState();
  assert.equal(s.visible, true);
  assert.equal(s.title, 'Police raid at Fixture Hotel');
  assert.equal(s.summary, makeStaging().summary);
  assert.equal(s.scenario, SCENARIO_LABELS.police_raid);
  assert.equal(s.locationBadge, 'Approximate · 78% confidence');
  assert.ok(Array.isArray(s.elements));
  assert.equal(s.elements.length, 8);
  for (const e of s.elements) assert.equal(typeof e, 'string');
  assert.ok(s.elements.some((e) => e.includes('Traffic cones')));
  assert.equal(s.sources, 3);
  assert.equal(
    s.built,
    'Built with OnDemand predefined-cerebras-qwen-3.8-27b in 1830 ms',
  );
  panel.setScene(null);
  assert.equal(root.hidden, true);
  assert.equal(panel.getState().visible, false);
  assert.equal(root.dataset.scenario, undefined);
  assert.equal(document.querySelector('#scene-panel'), root);
  panel.destroy();
  assert.equal(document.querySelector('#scene-panel'), null);
});

test('ELEMENT_LABELS and ELEMENT_ICONS cover dynamic intelligence types', () => {
  const dynamicKeys = [
    'threat_zone',
    'interest_zone',
    'crowd_density_zone',
    'overwatch',
    'command_post',
    'cordon_node',
    'cctv_pick',
    'intel_note',
    'timeline_event',
    'generic',
  ];
  for (const k of dynamicKeys) {
    assert.ok(ELEMENT_LABELS[k], `missing label for ${k}`);
    assert.ok(Object.hasOwn(ELEMENT_ICONS, k), `missing icon entry for ${k}`);
  }
});
