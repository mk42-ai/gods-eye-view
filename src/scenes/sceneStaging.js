/**
 * Scene Staging — the deterministic engine's output contract (GeoJSON layers +
 * legend + a single badge). Browser + Node, dependency-free. The renderer, the
 * saved-scene store and the explanation panel trust ONLY what passes
 * `validateSceneStaging`. See SCENE_ARCHITECTURE.md §4.
 */
import {
  validateSceneSpec,
  ELEMENT_TYPES,
  DYNAMIC_ELEMENT_TYPES,
  parseDynamicSceneSpec,
} from './sceneSpec.js';

export const SCENE_STAGING_VERSION = 1;
export const STAGING_BADGE_TEXT =
  'ILLUSTRATIVE – suggested, not verified deployment';
export const STAGING_COLORS = Object.freeze({
  navy: '#0B1220',
  teal: '#14B8A6',
  mint: '#A7F3D0',
  white: '#FFFFFF',
  amber: '#F59E0B',
});
export const STAGING_ROLES = Object.freeze([
  'focal',
  'cordon',
  'route',
  'unit',
  'cone',
  'barrier',
  'signal',
  'zone',
  'marker',
  'overwatch',
  'command',
  'node',
]);
export const LINE_STYLES = Object.freeze([
  'cordon_inner',
  'cordon_outer',
  'route_approach',
  'route_egress',
  'route_line',
]);
export const ICON_KEYS = Object.freeze([
  'cone',
  'police_unit',
  'barrier',
  'cctv_signal',
  'checkpoint',
  'staging_point',
  'perimeter_unit',
  'crowd_zone',
  'start_finish',
  'egress',
  'command_post',
  'cctv',
  'cordon_node',
  'route_start',
  'route_finish',
  'generic',
  'vehicle_police_car',
  'vehicle_ambulance',
  'vehicle_fire_engine',
  'vehicle_civilian_sedan',
  'aircraft_helicopter',
  'aircraft_fixed_wing',
  'person_runner',
  'person_police_officer',
  'signage_road_closed',
  'effect_smoke_fire',
  'alert_state_1',
  'alert_state_2',
  'alert_state_3',
  'alert_state_4',
  'barrier_crowd',
  'cone_cluster',
  'crowd_spectators',
  'person_responder',
  'vehicle_city_bus',
  'vehicle_police_motorcycle',
  'sensor_cctv_feed',
  'evidence_pin_verified',
  'marker_air_raid_impact_sim',
  'vessel_marine_patrol',
  'medical_point',
  'marine_patrol',
  'vehicle_checkpoint',
  'screening_lane',
  'road_closed',
  'civilian_sedan',
]);
export const PROVENANCES = Object.freeze([
  'osm-footprint-buffer',
  'circle-buffer',
  'osrm-route',
  'overpass-highway',
  'turf-along',
  'turf-intersect',
  'camera-discovery',
  'anchor',
]);
/** symbol-sort-key: focal > cordons > zones > routes > command_post/overwatch > unit/checkpoint/cordon_node > cctv > generic > cones. */
export const PRIORITY = Object.freeze({
  focal: 100,
  cordon: 90,
  zone: 85,
  route: 80,
  command_post: 70,
  overwatch: 70,
  unit: 60,
  checkpoint: 60,
  cordon_node: 60,
  marker: 55,
  signal: 50,
  cctv: 50,
  generic: 40,
  barrier: 20,
  cone: 10,
});
export const MAX_FEATURES_PER_LAYER = 600;
export const MAX_VERTICES = 800;
export const LABEL_MAX = 48;

export class SceneStagingError extends Error {
  constructor(path, reason) {
    super(`${path}: ${reason}`);
    this.name = 'SceneStagingError';
    this.code = 'invalid_scene_staging';
  }
}
const fail = (path, reason) => {
  throw new SceneStagingError(path, reason);
};
const plain = (v) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const CITATION_TOKEN = /\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/;
function text(v, path, max) {
  if (typeof v !== 'string' || !v.trim() || v.length > max || CONTROL.test(v))
    fail(path, `must be non-empty text (maximum ${max})`);
  return v;
}
function keys(value, path, allowed, required = []) {
  if (!plain(value)) fail(path, 'must be a plain object');
  for (const k of Object.keys(value))
    if (!allowed.includes(k)) fail(`${path}.${k}`, 'unknown field');
  for (const k of required)
    if (!Object.hasOwn(value, k)) fail(`${path}.${k}`, 'required');
}
const finite = (v, path, min, max) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    fail(path, `must be a number in [${min}, ${max}]`);
  return v;
};
const lonLat = (p, path) => {
  if (!Array.isArray(p) || p.length !== 2) fail(path, 'must be [lon, lat]');
  return [
    finite(p[0], `${path}[0]`, -180, 180),
    finite(p[1], `${path}[1]`, -90, 90),
  ];
};
function ring(r, path) {
  if (!Array.isArray(r) || r.length < 4 || r.length > MAX_VERTICES)
    fail(path, `ring needs 4–${MAX_VERTICES} vertices`);
  const out = r.map((p, i) => lonLat(p, `${path}[${i}]`));
  const [a, b] = [out[0], out.at(-1)];
  if (a[0] !== b[0] || a[1] !== b[1]) fail(path, 'ring must be closed');
  return out;
}
function properties(p, path, kind) {
  keys(
    p,
    path,
    [
      'id',
      'element',
      'role',
      'label',
      'priority',
      'icon',
      'lineStyle',
      'color',
      'provenance',
      'illustrative',
      'heading',
      'index',
      'labelFor',
      'widthClass',
      'distanceM',
      'status',
      'source',
      'confidence',
      'evidenceTier',
      'generic',
      'relevance',
      'atSec',
    ],
    [
      'id',
      'element',
      'role',
      'priority',
      'color',
      'provenance',
      'illustrative',
    ],
  );
  const id = text(p.id, `${path}.id`, 80);
  if (!/^[a-z][a-z0-9_-]*$/.test(id)) fail(`${path}.id`, 'invalid identifier');
  if (
    !ELEMENT_TYPES.includes(p.element) &&
    !DYNAMIC_ELEMENT_TYPES.includes(p.element) &&
    p.element !== 'focal' &&
    p.generic !== true
  )
    fail(`${path}.element`, 'unknown element');
  if (!STAGING_ROLES.includes(p.role)) fail(`${path}.role`, 'unknown role');
  const out = {
    id,
    element: p.element,
    role: p.role,
    priority: finite(p.priority, `${path}.priority`, 0, 1000),
    color: /^#[0-9a-fA-F]{6}$/.test(p.color)
      ? p.color
      : fail(`${path}.color`, 'must be #rrggbb'),
    provenance: PROVENANCES.includes(p.provenance)
      ? p.provenance
      : fail(`${path}.provenance`, 'unknown provenance'),
    illustrative:
      p.illustrative === true
        ? true
        : fail(`${path}.illustrative`, 'must be true'),
  };
  if (p.label !== undefined) {
    const label = text(p.label, `${path}.label`, LABEL_MAX);
    if (CITATION_TOKEN.test(label))
      fail(`${path}.label`, 'citation tokens are not allowed on map labels');
    if (/^\s*illustrative\b/i.test(label))
      fail(
        `${path}.label`,
        'the illustrative badge is rendered once, not per label',
      );
    out.label = label;
  }
  if (p.icon !== undefined) {
    if (!ICON_KEYS.includes(p.icon)) fail(`${path}.icon`, 'unknown icon');
    out.icon = p.icon;
  }
  if (p.lineStyle !== undefined) {
    if (!LINE_STYLES.includes(p.lineStyle))
      fail(`${path}.lineStyle`, 'unknown lineStyle');
    out.lineStyle = p.lineStyle;
  }
  if (p.heading !== undefined)
    out.heading = finite(p.heading, `${path}.heading`, 0, 360);
  if (p.index !== undefined)
    out.index = finite(p.index, `${path}.index`, 0, 100000);
  if (p.labelFor !== undefined)
    out.labelFor = text(p.labelFor, `${path}.labelFor`, 80);
  if (p.widthClass !== undefined) {
    if (!['major', 'minor'].includes(p.widthClass))
      fail(`${path}.widthClass`, 'major|minor');
    out.widthClass = p.widthClass;
  }
  if (p.distanceM !== undefined)
    out.distanceM = finite(p.distanceM, `${path}.distanceM`, 0, 1e6);
  if (p.status !== undefined) {
    if (!['live', 'recorded', 'unavailable', 'unknown'].includes(p.status))
      fail(`${path}.status`, 'invalid status');
    out.status = p.status;
  }
  if (p.source !== undefined)
    out.source = text(p.source, `${path}.source`, 200);
  if (p.confidence !== undefined)
    out.confidence = finite(p.confidence, `${path}.confidence`, 0, 1);
  if (p.evidenceTier !== undefined) {
    if (!['sourced', 'inferred', 'generated'].includes(p.evidenceTier))
      fail(`${path}.evidenceTier`, 'sourced|inferred|generated');
    out.evidenceTier = p.evidenceTier;
  }
  if (p.generic !== undefined) {
    if (typeof p.generic !== 'boolean')
      fail(`${path}.generic`, 'must be boolean');
    out.generic = p.generic;
  }
  if (p.relevance !== undefined)
    out.relevance = finite(p.relevance, `${path}.relevance`, 0, 1);
  if (p.atSec !== undefined)
    out.atSec = finite(p.atSec, `${path}.atSec`, 0, 1e7);
  if (kind === 'label' && out.label === undefined)
    fail(`${path}.label`, 'labels need text');
  return out;
}
function collection(fc, path, geometryType, kind) {
  keys(fc, path, ['type', 'features'], ['type', 'features']);
  if (fc.type !== 'FeatureCollection')
    fail(`${path}.type`, 'FeatureCollection');
  if (
    !Array.isArray(fc.features) ||
    fc.features.length > MAX_FEATURES_PER_LAYER
  )
    fail(`${path}.features`, `array of at most ${MAX_FEATURES_PER_LAYER}`);
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f, i) => {
      const p = `${path}.features[${i}]`;
      keys(
        f,
        p,
        ['type', 'geometry', 'properties'],
        ['type', 'geometry', 'properties'],
      );
      if (f.type !== 'Feature') fail(`${p}.type`, 'Feature');
      keys(
        f.geometry,
        `${p}.geometry`,
        ['type', 'coordinates'],
        ['type', 'coordinates'],
      );
      if (f.geometry.type !== geometryType)
        fail(`${p}.geometry.type`, geometryType);
      let coordinates;
      if (geometryType === 'Point')
        coordinates = lonLat(
          f.geometry.coordinates,
          `${p}.geometry.coordinates`,
        );
      else if (geometryType === 'LineString') {
        const c = f.geometry.coordinates;
        if (!Array.isArray(c) || c.length < 2 || c.length > MAX_VERTICES)
          fail(`${p}.geometry.coordinates`, `2–${MAX_VERTICES} vertices`);
        coordinates = c.map((q, j) =>
          lonLat(q, `${p}.geometry.coordinates[${j}]`),
        );
      } else {
        const c = f.geometry.coordinates;
        if (!Array.isArray(c) || c.length < 1 || c.length > 8)
          fail(`${p}.geometry.coordinates`, '1–8 rings');
        coordinates = c.map((r, j) =>
          ring(r, `${p}.geometry.coordinates[${j}]`),
        );
      }
      return {
        type: 'Feature',
        geometry: { type: geometryType, coordinates },
        properties: properties(f.properties, `${p}.properties`, kind),
      };
    }),
  };
}

/** Validate an engine output. Returns a fresh JSON value or throws SceneStagingError. */
export function validateSceneStaging(raw) {
  const path = 'staging';
  keys(
    raw,
    path,
    [
      'version',
      'illustrative',
      'spec',
      'anchor',
      'model',
      'timing',
      'sources',
      'unavailable',
      'layers',
      'badge',
      'legend',
      'summary',
      'notes',
      'timeline',
    ],
    [
      'version',
      'illustrative',
      'spec',
      'anchor',
      'model',
      'timing',
      'sources',
      'unavailable',
      'layers',
      'badge',
      'legend',
    ],
  );
  if (raw.version !== SCENE_STAGING_VERSION)
    fail(`${path}.version`, `must equal ${SCENE_STAGING_VERSION}`);
  if (raw.illustrative !== true) fail(`${path}.illustrative`, 'must be true');
  let spec;
  try {
    spec = validateSceneSpec(raw.spec);
  } catch {
    const dyn = parseDynamicSceneSpec(raw.spec);
    if (
      !dyn.spec ||
      !Array.isArray(dyn.spec.elements) ||
      dyn.spec.elements.length === 0
    )
      fail(`${path}.spec`, 'spec must have at least one valid element');
    spec = dyn.spec;
  }
  keys(
    raw.anchor,
    `${path}.anchor`,
    ['name', 'lat', 'lon'],
    ['name', 'lat', 'lon'],
  );
  const anchor = {
    name: text(raw.anchor.name, `${path}.anchor.name`, 300),
    lat: finite(raw.anchor.lat, `${path}.anchor.lat`, -90, 90),
    lon: finite(raw.anchor.lon, `${path}.anchor.lon`, -180, 180),
  };
  keys(
    raw.model,
    `${path}.model`,
    [
      'provider',
      'id',
      'endpointId',
      'latencyMs',
      'attempts',
      'fallback',
      'repaired',
      'reasons',
    ],
    ['provider', 'id', 'latencyMs', 'attempts', 'repaired'],
  );
  if (!['cerebras-direct', 'ondemand', 'template'].includes(raw.model.provider))
    fail(`${path}.model.provider`, 'unknown provider');
  const model = {
    provider: raw.model.provider,
    id: text(raw.model.id, `${path}.model.id`, 120),
    latencyMs: finite(raw.model.latencyMs, `${path}.model.latencyMs`, 0, 1e7),
    attempts: (Array.isArray(raw.model.attempts)
      ? raw.model.attempts
      : fail(`${path}.model.attempts`, 'array')
    )
      .slice(0, 12)
      .map((a, i) => {
        keys(
          a,
          `${path}.model.attempts[${i}]`,
          ['provider', 'id', 'ok', 'ms', 'error'],
          ['provider', 'id', 'ok', 'ms'],
        );
        return {
          provider: text(
            a.provider,
            `${path}.model.attempts[${i}].provider`,
            40,
          ),
          id: text(a.id, `${path}.model.attempts[${i}].id`, 120),
          ok: a.ok === true,
          ms: finite(a.ms, `${path}.model.attempts[${i}].ms`, 0, 1e7),
          ...(a.error !== undefined
            ? {
                error: text(a.error, `${path}.model.attempts[${i}].error`, 300),
              }
            : {}),
        };
      }),
    repaired: raw.model.repaired === true,
    ...(raw.model.endpointId !== undefined
      ? {
          endpointId: text(
            raw.model.endpointId,
            `${path}.model.endpointId`,
            120,
          ),
        }
      : {}),
    ...(raw.model.fallback !== undefined && raw.model.fallback !== null
      ? { fallback: text(raw.model.fallback, `${path}.model.fallback`, 60) }
      : {}),
    ...(Array.isArray(raw.model.reasons)
      ? {
          reasons: raw.model.reasons
            .slice(0, 12)
            .map((r, i) => text(r, `${path}.model.reasons[${i}]`, 300)),
        }
      : {}),
  };
  keys(
    raw.timing,
    `${path}.timing`,
    ['specMs', 'overpassMs', 'routingMs', 'geometryMs', 'totalMs'],
    ['specMs', 'geometryMs', 'totalMs'],
  );
  const timing = {};
  for (const k of [
    'specMs',
    'overpassMs',
    'routingMs',
    'geometryMs',
    'totalMs',
  ])
    if (raw.timing[k] !== undefined)
      timing[k] = finite(raw.timing[k], `${path}.timing.${k}`, 0, 1e7);
  keys(
    raw.sources,
    `${path}.sources`,
    ['footprint', 'roads', 'routing', 'overpassEndpoint', 'cacheHit'],
    ['footprint', 'roads', 'routing'],
  );
  const sources = {
    footprint: text(raw.sources.footprint, `${path}.sources.footprint`, 60),
    roads: text(raw.sources.roads, `${path}.sources.roads`, 60),
    routing: text(raw.sources.routing, `${path}.sources.routing`, 60),
    ...(raw.sources.overpassEndpoint !== undefined
      ? {
          overpassEndpoint: text(
            raw.sources.overpassEndpoint,
            `${path}.sources.overpassEndpoint`,
            200,
          ),
        }
      : {}),
    ...(raw.sources.cacheHit !== undefined
      ? { cacheHit: raw.sources.cacheHit === true }
      : {}),
  };
  if (!Array.isArray(raw.unavailable) || raw.unavailable.length > 40)
    fail(`${path}.unavailable`, 'array');
  const unavailable = raw.unavailable.map((u, i) => {
    keys(
      u,
      `${path}.unavailable[${i}]`,
      ['element', 'reason'],
      ['element', 'reason'],
    );
    return {
      element: text(u.element, `${path}.unavailable[${i}].element`, 40),
      reason: text(u.reason, `${path}.unavailable[${i}].reason`, 200),
    };
  });
  keys(
    raw.layers,
    `${path}.layers`,
    ['areas', 'lines', 'points', 'labels'],
    ['areas', 'lines', 'points', 'labels'],
  );
  const layers = {
    areas: collection(
      raw.layers.areas,
      `${path}.layers.areas`,
      'Polygon',
      'area',
    ),
    lines: collection(
      raw.layers.lines,
      `${path}.layers.lines`,
      'LineString',
      'line',
    ),
    points: collection(
      raw.layers.points,
      `${path}.layers.points`,
      'Point',
      'point',
    ),
    labels: collection(
      raw.layers.labels,
      `${path}.layers.labels`,
      'Point',
      'label',
    ),
  };
  const ids = new Set();
  for (const layer of Object.values(layers))
    for (const f of layer.features) {
      if (ids.has(f.properties.id))
        fail(`${path}.layers`, `duplicate feature id ${f.properties.id}`);
      ids.add(f.properties.id);
    }
  const seenLabels = new Set();
  for (const f of layers.labels.features) {
    const key = f.properties.label.trim().toLowerCase();
    if (seenLabels.has(key))
      fail(`${path}.layers.labels`, `duplicate label “${f.properties.label}”`);
    seenLabels.add(key);
  }
  keys(raw.badge, `${path}.badge`, ['text', 'single'], ['text', 'single']);
  if (raw.badge.text !== STAGING_BADGE_TEXT || raw.badge.single !== true)
    fail(`${path}.badge`, 'must be the single illustrative badge');
  if (!Array.isArray(raw.legend) || raw.legend.length > 24)
    fail(`${path}.legend`, 'array');
  const legend = raw.legend.map((l, i) => {
    const p = `${path}.legend[${i}]`;
    keys(
      l,
      p,
      ['key', 'label', 'swatch', 'color', 'icon', 'count'],
      ['key', 'label', 'swatch', 'color', 'count'],
    );
    if (!['area', 'line', 'icon', 'dot'].includes(l.swatch))
      fail(`${p}.swatch`, 'area|line|icon|dot');
    return {
      key: text(l.key, `${p}.key`, 40),
      label: text(l.label, `${p}.label`, 80),
      swatch: l.swatch,
      color: /^#[0-9a-fA-F]{6}$/.test(l.color)
        ? l.color
        : fail(`${p}.color`, '#rrggbb'),
      count: finite(l.count, `${p}.count`, 0, 100000),
      ...(l.icon !== undefined
        ? {
            icon: ICON_KEYS.includes(l.icon)
              ? l.icon
              : fail(`${p}.icon`, 'unknown icon'),
          }
        : {}),
    };
  });
  const out = {
    version: SCENE_STAGING_VERSION,
    illustrative: true,
    spec,
    anchor,
    model,
    timing,
    sources,
    unavailable,
    layers,
    badge: { text: STAGING_BADGE_TEXT, single: true },
    legend,
  };
  if (raw.summary !== undefined)
    out.summary = text(raw.summary, `${path}.summary`, 300);

  if (raw.notes !== undefined) {
    if (!Array.isArray(raw.notes) || raw.notes.length > 50)
      fail(`${path}.notes`, 'array of at most 50');
    out.notes = raw.notes.map((n, i) => {
      const np = `${path}.notes[${i}]`;
      if (!plain(n)) fail(np, 'must be a plain object');
      const noteOut = {};
      if (n.text !== undefined) noteOut.text = text(n.text, `${np}.text`, 300);
      else if (n.label !== undefined)
        noteOut.text = text(n.label, `${np}.label`, 300);
      else if (n.title !== undefined)
        noteOut.text = text(n.title, `${np}.title`, 300);
      else noteOut.text = 'Intel note';

      if (n.evidenceTier !== undefined) {
        if (!['sourced', 'inferred', 'generated'].includes(n.evidenceTier))
          fail(`${np}.evidenceTier`, 'sourced|inferred|generated');
        noteOut.evidenceTier = n.evidenceTier;
      } else {
        noteOut.evidenceTier = 'inferred';
      }

      if (n.citations !== undefined) {
        if (!Array.isArray(n.citations)) fail(`${np}.citations`, 'array');
        noteOut.citations = n.citations.map((c, j) => {
          const cp = `${np}.citations[${j}]`;
          if (
            !plain(c) ||
            typeof c.url !== 'string' ||
            !c.url.trim() ||
            c.url.length > 2000
          )
            fail(cp, 'citation requires url <= 2000 chars');
          return {
            url: c.url.trim(),
            ...(c.title ? { title: text(c.title, `${cp}.title`, 300) } : {}),
          };
        });
      } else {
        noteOut.citations = [];
      }

      if (n.confidence !== undefined)
        noteOut.confidence = finite(n.confidence, `${np}.confidence`, 0, 1);
      if (n.source !== undefined)
        noteOut.source = text(n.source, `${np}.source`, 200);

      return noteOut;
    });
  }

  if (raw.timeline !== undefined) {
    if (!Array.isArray(raw.timeline) || raw.timeline.length > 100)
      fail(`${path}.timeline`, 'array of at most 100');
    out.timeline = raw.timeline.map((t, i) => {
      const tp = `${path}.timeline[${i}]`;
      if (!plain(t)) fail(tp, 'must be a plain object');
      const itemOut = {
        atSec: finite(t.atSec ?? 0, `${tp}.atSec`, 0, 1e7),
        title: text(t.title ?? t.label ?? 'Event', `${tp}.title`, 120),
      };
      if (t.confidence !== undefined)
        itemOut.confidence = finite(t.confidence, `${tp}.confidence`, 0, 1);
      if (t.source !== undefined)
        itemOut.source = text(t.source, `${tp}.source`, 200);
      return itemOut;
    });
  }

  return JSON.parse(JSON.stringify(out));
}

/** Strip bracketed citation tokens and an illustrative prefix from any label text. */
export function cleanMapLabel(value, max = LABEL_MAX) {
  const s = String(value ?? '')
    .replace(/\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, '')
    .replace(/^\s*illustrative[\s:·–-]*/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Quick counts for the explanation panel / QA. */
export function stagingCounts(staging) {
  const counts = {};
  for (const layer of ['areas', 'lines', 'points'])
    for (const f of staging?.layers?.[layer]?.features || []) {
      // area + marker pairs (crowd zones, egress) count once
      if (
        layer === 'points' &&
        ['crowd_zone', 'egress_route'].includes(f.properties.element)
      )
        continue;
      const key = f.properties.element;
      counts[key] = (counts[key] || 0) + 1;
    }
  return counts;
}

/** Signature used to prove different prompts produce different staging. */
export function stagingSignature(staging) {
  let h = 2166136261;
  for (const layer of ['areas', 'lines', 'points'])
    for (const f of staging?.layers?.[layer]?.features || [])
      for (const ch of JSON.stringify([
        f.properties.element,
        f.geometry.coordinates,
      ]))
        h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
