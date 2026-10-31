/**
 * Research-grounded scene geometry: a shared, dependency-free boundary used by
 * the server (validation of grounded output), persistence (saved scenes) and the
 * map layer (spec → renderable lines, dots and areas).
 *
 * Every coordinate in a valid geometry block came from a geocoder/router
 * response (OpenStreetMap Nominatim / OSRM). The language model only names
 * features and cites sources; it never supplies coordinates. Nothing here
 * fabricates or "fills in" geometry: invalid input is rejected, empty research
 * stays empty and is rendered as an explicit empty state.
 */
export const SCENE_GEOMETRY_VERSION = 1;
export const GEOMETRY_KINDS = Object.freeze(['point', 'route', 'area']);
export const GEOMETRY_STATUSES = Object.freeze([
  'grounded',
  'partial',
  'empty',
  'unavailable',
]);
export const MAX_GEOMETRY_FEATURES = 12;
export const MAX_LINE_VERTICES = 600;
export const MAX_RING_VERTICES = 600;
/** Grounded features must lie near the verified anchor (wrong-city geocodes are rejected). */
export const MAX_FEATURE_DISTANCE_KM = 60;
export const SUGGESTED_MARKER_LABEL =
  'Suggested / illustrative – not verified deployment';

export class SceneGeometryError extends Error {
  constructor(path, reason) {
    super(`${path}: ${reason}`);
    this.name = 'SceneGeometryError';
    this.code = 'invalid_scene_geometry';
  }
}
const fail = (path, reason) => {
  throw new SceneGeometryError(path, reason);
};
const plain = (v) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
function text(value, path, max, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return undefined;
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    CONTROL.test(value)
  )
    fail(path, `must be non-empty text (maximum ${max})`);
  return value;
}
function keys(value, path, allowed, required = []) {
  if (!plain(value)) fail(path, 'must be a plain object');
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(`${path}.${key}`, 'unknown field');
  for (const key of required)
    if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'required');
}
function publicUrl(value, path) {
  text(value, path, 2048);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(path, 'must be a public HTTP(S) URL');
  }
  const host = url.hostname.toLowerCase();
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !host.includes('.') ||
    host === 'localhost' ||
    /\.(?:localhost|local|internal)$/.test(host) ||
    /^(?:\d+\.){3}\d+$/.test(host) ||
    host.includes(':') ||
    [...url.searchParams.keys()].some((k) =>
      /^(?:api[-_]?key|authorization|password|secret|token|sig)$/i.test(k),
    )
  )
    fail(path, 'must be a public HTTP(S) URL without credentials');
  return value;
}
function isoOrNull(value, path) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    fail(path, 'must be an ISO timestamp or null');
  return new Date(value).toISOString();
}
const lonLat = (pair, path) => {
  if (
    !Array.isArray(pair) ||
    pair.length !== 2 ||
    typeof pair[0] !== 'number' ||
    typeof pair[1] !== 'number' ||
    !Number.isFinite(pair[0]) ||
    !Number.isFinite(pair[1]) ||
    Math.abs(pair[0]) > 180 ||
    Math.abs(pair[1]) > 90
  )
    fail(path, 'must be a [longitude, latitude] pair');
  return [pair[0], pair[1]];
};

export function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function validateShape(geometry, kind, path, anchor) {
  keys(geometry, path, ['type', 'coordinates'], ['type', 'coordinates']);
  const near = (pair, p) => {
    if (
      anchor &&
      haversineKm(anchor, { lon: pair[0], lat: pair[1] }) >
        MAX_FEATURE_DISTANCE_KM
    )
      fail(p, `lies more than ${MAX_FEATURE_DISTANCE_KM} km from the anchor`);
    return pair;
  };
  if (kind === 'point') {
    if (geometry.type !== 'Point') fail(`${path}.type`, 'point needs Point');
    return {
      type: 'Point',
      coordinates: near(
        lonLat(geometry.coordinates, `${path}.coordinates`),
        path,
      ),
    };
  }
  if (kind === 'route') {
    if (geometry.type !== 'LineString')
      fail(`${path}.type`, 'route needs LineString');
    const line = geometry.coordinates;
    if (
      !Array.isArray(line) ||
      line.length < 2 ||
      line.length > MAX_LINE_VERTICES
    )
      fail(`${path}.coordinates`, `needs 2–${MAX_LINE_VERTICES} vertices`);
    return {
      type: 'LineString',
      coordinates: line.map((pair, i) =>
        near(lonLat(pair, `${path}.coordinates[${i}]`), path),
      ),
    };
  }
  if (geometry.type !== 'Polygon') fail(`${path}.type`, 'area needs Polygon');
  const ring = geometry.coordinates?.[0];
  if (
    !Array.isArray(geometry.coordinates) ||
    geometry.coordinates.length !== 1 ||
    !Array.isArray(ring) ||
    ring.length < 4 ||
    ring.length > MAX_RING_VERTICES
  )
    fail(`${path}.coordinates`, 'area needs one closed outer ring');
  const out = ring.map((pair, i) =>
    near(lonLat(pair, `${path}.coordinates[0][${i}]`), path),
  );
  if (out[0][0] !== out.at(-1)[0] || out[0][1] !== out.at(-1)[1])
    fail(`${path}.coordinates`, 'outer ring must be closed');
  return { type: 'Polygon', coordinates: [out] };
}

/**
 * Validate (and deep-copy) a grounded geometry block. Never clamps, snaps or
 * invents values. `anchor` ({lat,lon}) enables the distance guard.
 */
export function validateSceneGeometry(raw, { anchor } = {}) {
  const path = 'geometry';
  keys(
    raw,
    path,
    [
      'version',
      'status',
      'illustrative',
      'interpretation',
      'timeContext',
      'features',
      'citations',
      'unresolved',
      'provider',
      'checkedAt',
      'message',
    ],
    ['version', 'status', 'illustrative', 'features', 'citations'],
  );
  if (raw.version !== SCENE_GEOMETRY_VERSION)
    fail(`${path}.version`, `must equal ${SCENE_GEOMETRY_VERSION}`);
  if (!GEOMETRY_STATUSES.includes(raw.status))
    fail(`${path}.status`, `must be one of ${GEOMETRY_STATUSES.join(', ')}`);
  if (raw.illustrative !== true) fail(`${path}.illustrative`, 'must be true');
  if (!Array.isArray(raw.citations) || raw.citations.length > 40)
    fail(`${path}.citations`, 'invalid array (maximum 40)');
  const citationIds = new Set();
  const citations = raw.citations.map((c, i) => {
    const p = `${path}.citations[${i}]`;
    keys(c, p, ['id', 'url', 'title', 'checked'], ['id', 'url']);
    const id = text(c.id, `${p}.id`, 16);
    if (!/^c\d{1,3}$/.test(id) || citationIds.has(id))
      fail(`${p}.id`, 'must be a unique c<number> identifier');
    citationIds.add(id);
    const out = { id, url: publicUrl(c.url, `${p}.url`) };
    if (c.title !== undefined) out.title = text(c.title, `${p}.title`, 300);
    if (c.checked !== undefined) {
      if (!['mentions_feature', 'reachable', 'unchecked'].includes(c.checked))
        fail(`${p}.checked`, 'invalid check result');
      out.checked = c.checked;
    }
    return out;
  });
  if (
    !Array.isArray(raw.features) ||
    raw.features.length > MAX_GEOMETRY_FEATURES
  )
    fail(
      `${path}.features`,
      `invalid array (maximum ${MAX_GEOMETRY_FEATURES})`,
    );
  const featureIds = new Set();
  const features = raw.features.map((f, i) => {
    const p = `${path}.features[${i}]`;
    keys(
      f,
      p,
      [
        'id',
        'kind',
        'name',
        'role',
        'geometry',
        'citationIds',
        'activeWindow',
        'provenance',
      ],
      ['id', 'kind', 'name', 'geometry', 'citationIds', 'provenance'],
    );
    const id = text(f.id, `${p}.id`, 64);
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id) || featureIds.has(id))
      fail(`${p}.id`, 'must be a unique identifier');
    featureIds.add(id);
    if (!GEOMETRY_KINDS.includes(f.kind))
      fail(`${p}.kind`, `must be one of ${GEOMETRY_KINDS.join(', ')}`);
    if (!Array.isArray(f.citationIds) || f.citationIds.length > 10)
      fail(`${p}.citationIds`, 'invalid array');
    for (const cid of f.citationIds)
      if (!citationIds.has(cid))
        fail(`${p}.citationIds`, 'unknown citation reference');
    keys(
      f.provenance,
      `${p}.provenance`,
      ['source', 'url', 'licence', 'query'],
      ['source'],
    );
    const provenance = {
      source: text(f.provenance.source, `${p}.provenance.source`, 200),
    };
    if (f.provenance.url !== undefined)
      provenance.url = publicUrl(f.provenance.url, `${p}.provenance.url`);
    if (f.provenance.licence !== undefined)
      provenance.licence = text(
        f.provenance.licence,
        `${p}.provenance.licence`,
        120,
      );
    if (f.provenance.query !== undefined)
      provenance.query = text(f.provenance.query, `${p}.provenance.query`, 300);
    const out = {
      id,
      kind: f.kind,
      name: text(f.name, `${p}.name`, 200),
      geometry: validateShape(f.geometry, f.kind, `${p}.geometry`, anchor),
      citationIds: [...f.citationIds],
      provenance,
    };
    if (f.role !== undefined) out.role = text(f.role, `${p}.role`, 120);
    if (f.activeWindow !== undefined && f.activeWindow !== null) {
      keys(f.activeWindow, `${p}.activeWindow`, [
        'startUtc',
        'endUtc',
        'description',
      ]);
      const startUtc = isoOrNull(
        f.activeWindow.startUtc,
        `${p}.activeWindow.startUtc`,
      );
      const endUtc = isoOrNull(
        f.activeWindow.endUtc,
        `${p}.activeWindow.endUtc`,
      );
      if (startUtc && endUtc && Date.parse(startUtc) > Date.parse(endUtc))
        fail(`${p}.activeWindow`, 'start must not be after end');
      out.activeWindow = { startUtc, endUtc };
      if (f.activeWindow.description !== undefined)
        out.activeWindow.description = text(
          f.activeWindow.description,
          `${p}.activeWindow.description`,
          300,
        );
    }
    return out;
  });
  if (raw.status === 'grounded' && !features.length)
    fail(`${path}.status`, 'grounded geometry needs at least one feature');
  if (['empty', 'unavailable'].includes(raw.status) && features.length)
    fail(`${path}.status`, `${raw.status} geometry cannot carry features`);
  const out = {
    version: SCENE_GEOMETRY_VERSION,
    status: raw.status,
    illustrative: true,
    features,
    citations,
  };
  if (raw.interpretation !== undefined) {
    keys(raw.interpretation, `${path}.interpretation`, [
      'summary',
      'sceneType',
    ]);
    out.interpretation = {};
    if (raw.interpretation.summary !== undefined)
      out.interpretation.summary = text(
        raw.interpretation.summary,
        `${path}.interpretation.summary`,
        600,
      );
    if (raw.interpretation.sceneType !== undefined)
      out.interpretation.sceneType = text(
        raw.interpretation.sceneType,
        `${path}.interpretation.sceneType`,
        80,
      );
  }
  if (raw.timeContext !== undefined && raw.timeContext !== null) {
    keys(raw.timeContext, `${path}.timeContext`, [
      'description',
      'startUtc',
      'endUtc',
    ]);
    out.timeContext = {
      startUtc: isoOrNull(
        raw.timeContext.startUtc,
        `${path}.timeContext.startUtc`,
      ),
      endUtc: isoOrNull(raw.timeContext.endUtc, `${path}.timeContext.endUtc`),
    };
    if (raw.timeContext.description !== undefined)
      out.timeContext.description = text(
        raw.timeContext.description,
        `${path}.timeContext.description`,
        300,
      );
  }
  if (raw.unresolved !== undefined) {
    if (!Array.isArray(raw.unresolved) || raw.unresolved.length > 40)
      fail(`${path}.unresolved`, 'invalid array');
    out.unresolved = raw.unresolved.map((u, i) => {
      keys(
        u,
        `${path}.unresolved[${i}]`,
        ['name', 'reason'],
        ['name', 'reason'],
      );
      return {
        name: text(u.name, `${path}.unresolved[${i}].name`, 200),
        reason: text(u.reason, `${path}.unresolved[${i}].reason`, 200),
      };
    });
  }
  for (const key of ['provider', 'message'])
    if (raw[key] !== undefined)
      out[key] = text(raw[key], `${path}.${key}`, 600);
  if (raw.checkedAt !== undefined)
    out.checkedAt = isoOrNull(raw.checkedAt, `${path}.checkedAt`);
  return out;
}

/** Recording window → absolute UTC range (recent windows are relative to `now`). */
export function recordingRange(selectedTime, now = Date.now()) {
  const t = selectedTime || {};
  if (t.timeMode === 'historical' && t.windowStart && t.windowEnd) {
    const start = Date.parse(t.windowStart);
    const end = Date.parse(t.windowEnd);
    if (Number.isFinite(start) && Number.isFinite(end) && start <= end)
      return {
        start,
        end,
        label: `${new Date(start).toISOString().slice(0, 16)}Z → ${new Date(end).toISOString().slice(0, 16)}Z`,
      };
  }
  const hours = Number(t.windowHours) > 0 ? Number(t.windowHours) : 1;
  const end = typeof now === 'number' ? now : Date.parse(now);
  return {
    start: end - hours * 3600000,
    end,
    label: `Last ${hours} hour${hours === 1 ? '' : 's'}`,
  };
}

/** 'in-window' | 'outside-window' | 'time-unknown' for one feature. */
export function featureTimeState(feature, range, timeContext) {
  const window = feature.activeWindow || timeContext || null;
  const start = window?.startUtc ? Date.parse(window.startUtc) : null;
  const end = window?.endUtc ? Date.parse(window.endUtc) : null;
  if (start === null && end === null) return 'time-unknown';
  const s = start ?? -Infinity;
  const e = end ?? Infinity;
  return s <= range.end && e >= range.start ? 'in-window' : 'outside-window';
}

/**
 * Pure spec → renderable geometry. Coordinates are passed through unchanged
 * (GeoJSON [lon, lat] order is preserved as explicit lon/lat fields), so the
 * map projects exactly what research returned. Changing `selectedTime` only
 * changes `timeState` / emphasis, never geometry.
 */
export function geometryRenderSpec(
  geometry,
  { selectedTime, now = Date.now() } = {},
) {
  const range = recordingRange(selectedTime, now);
  const numberOf = new Map(
    (geometry?.citations || []).map((c, i) => [c.id, i + 1]),
  );
  const spec = {
    status: geometry?.status || 'unavailable',
    windowLabel: range.label,
    range: {
      startUtc: new Date(range.start).toISOString(),
      endUtc: new Date(range.end).toISOString(),
    },
    points: [],
    lines: [],
    areas: [],
    citations: (geometry?.citations || []).map((c, i) => ({
      ...c,
      number: i + 1,
    })),
    counts: {
      points: 0,
      lines: 0,
      areas: 0,
      inWindow: 0,
      outsideWindow: 0,
      timeUnknown: 0,
    },
  };
  for (const f of geometry?.features || []) {
    const timeState = featureTimeState(f, range, geometry.timeContext);
    spec.counts[
      timeState === 'in-window'
        ? 'inWindow'
        : timeState === 'outside-window'
          ? 'outsideWindow'
          : 'timeUnknown'
    ] += 1;
    const base = {
      id: f.id,
      label: f.name,
      role: f.role || f.kind,
      citationNumbers: f.citationIds
        .map((id) => numberOf.get(id))
        .filter(Boolean),
      provenance: f.provenance,
      timeState,
    };
    if (f.kind === 'point') {
      const [lon, lat] = f.geometry.coordinates;
      spec.points.push({ ...base, lon, lat });
    } else if (f.kind === 'route') {
      const coords = f.geometry.coordinates;
      const mid = coords[Math.floor(coords.length / 2)];
      spec.lines.push({
        ...base,
        coordinates: coords.map(([lon, lat]) => [lon, lat]),
        labelAt: { lon: mid[0], lat: mid[1] },
      });
    } else {
      const ring = f.geometry.coordinates[0];
      const n = ring.length - 1;
      const c = ring
        .slice(0, n)
        .reduce(
          (acc, [lon, lat]) => ({
            lon: acc.lon + lon / n,
            lat: acc.lat + lat / n,
          }),
          { lon: 0, lat: 0 },
        );
      spec.areas.push({
        ...base,
        ring: ring.map(([lon, lat]) => [lon, lat]),
        labelAt: c,
      });
    }
  }
  spec.counts.points = spec.points.length;
  spec.counts.lines = spec.lines.length;
  spec.counts.areas = spec.areas.length;
  return spec;
}

/** A stable, short signature of the geometry (used to prove prompts differ). */
export function geometrySignature(geometry) {
  let h = 2166136261;
  for (const f of geometry?.features || [])
    for (const ch of JSON.stringify([f.kind, f.geometry.coordinates]))
      h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Plain-language summary used by the scene-aware chat/studio. */
export function describeGeometry(geometry) {
  if (!geometry) return 'No research geometry is attached to this scene.';
  if (!geometry.features.length)
    return `Research geometry: ${geometry.status}. ${geometry.message || 'No researched locations, routes or areas could be grounded; nothing was drawn.'}`;
  const parts = geometry.features.map(
    (f) =>
      `${f.kind} “${f.name}”${f.role ? ` (${f.role})` : ''} [${f.provenance.source}]`,
  );
  return `Research geometry (${geometry.status}, ILLUSTRATIVE): ${parts.join('; ')}. ${geometry.citations.length} research citation(s).`;
}
