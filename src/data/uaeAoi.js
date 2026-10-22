/**
 * UAE AOI library — the FeatureCollection in
 * src/data/local_data/uae-aoi/uae-aoi.json (Polygon features = areas of
 * interest, Point/LineString features = protected assets), plus the pure
 * geometry and gazetteer helpers the SCENES panel, the incident routes and
 * the composer share. No DOM, no Node builtins: the same module runs in the
 * browser bundle and under node:test on the server.
 */
import UAE_AOI_COLLECTION from './local_data/uae-aoi/uae-aoi.json' with { type: 'json' };

export const UAE_AOI_GROUP_IDS = Object.freeze([
  'IRAN',
  'YEMEN',
  'SOMALIA',
  'UAE_HOME_BORDER',
]);

/** Dropdown/label text per group id (the "UAE AOI (all)" entry is `ALL`). */
export const UAE_AOI_GROUP_LABELS = Object.freeze({
  ALL: 'UAE AOI (all)',
  IRAN: 'IRAN',
  YEMEN: 'YEMEN',
  SOMALIA: 'SOMALIA',
  UAE_HOME_BORDER: 'UAE HOME BORDER',
});

/** Legal/protected-asset zone tags (UAE Federal Penal Code derived categories). */
export const UAE_ZONE_TAGS = Object.freeze(
  Object.keys(UAE_AOI_COLLECTION.legal_categories || {}),
);

export const UAE_AOI_GROUPS = Object.freeze(
  (UAE_AOI_COLLECTION.groups || []).map((g) => Object.freeze({ ...g })),
);

const FEATURES = UAE_AOI_COLLECTION.features || [];
const AOI_FEATURES = Object.freeze(
  FEATURES.filter(
    (f) => f.properties?.kind === 'aoi' && f.geometry?.type === 'Polygon',
  ),
);
const ASSET_FEATURES = Object.freeze(
  FEATURES.filter((f) => f.properties?.kind === 'asset'),
);

/** The raw FeatureCollection (frozen reference, never mutated). */
export function uaeAoiCollection() {
  return UAE_AOI_COLLECTION;
}

/** Polygon AOI features, in file order. */
export function listAois({ group } = {}) {
  return group && group !== 'ALL'
    ? AOI_FEATURES.filter((f) => f.properties.group === group)
    : [...AOI_FEATURES];
}

/** Protected-asset point/line features, in file order. */
export function listAssets({ group } = {}) {
  return group && group !== 'ALL'
    ? ASSET_FEATURES.filter((f) => f.properties.group === group)
    : [...ASSET_FEATURES];
}

export function getAoi(id) {
  return AOI_FEATURES.find((f) => f.properties.id === id) || null;
}

/** Artwork path for a group (served from /public/assets/aoi). */
export function groupArtwork(group) {
  return UAE_AOI_GROUPS.find((g) => g.id === group)?.artwork || null;
}

/** Normalise a longitude into [-180, 180). */
export function wrapLongitude(lon) {
  let x = ((Number(lon) + 180) % 360) - 180;
  if (x < -180) x += 360;
  return x === 180 ? -180 : x;
}

/**
 * Ray-casting point-in-polygon on a GeoJSON linear ring ([lon, lat] pairs).
 * Antimeridian-safe: every vertex is unwrapped to the branch nearest the
 * ring's first vertex, and the test point to the branch nearest that, so a
 * ring crossing ±180° (e.g. a Pacific box spanning 170°E…-170°E) behaves like
 * any other polygon. Points on an edge count as inside (closed boundary).
 *
 * @param {number} lon
 * @param {number} lat
 * @param {Array<[number, number]>} ring closed or open linear ring
 * @returns {boolean}
 */
export function pointInRing(lon, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  const x0 = wrapLongitude(ring[0][0]);
  const unwrap = (value) => {
    let x = wrapLongitude(value);
    if (x - x0 > 180) x -= 360;
    else if (x0 - x > 180) x += 360;
    return x;
  };
  const px = unwrap(lon);
  const py = Number(lat);
  const n = ring.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = unwrap(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = unwrap(ring[j][0]);
    const yj = Number(ring[j][1]);
    if (onSegment(px, py, xi, yi, xj, yj)) return true;
    const crosses = yi > py !== yj > py;
    if (!crosses) continue;
    const xAt = ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (px < xAt) inside = !inside;
  }
  return inside;
}

function onSegment(px, py, x1, y1, x2, y2, eps = 1e-9) {
  const cross = (px - x1) * (y2 - y1) - (py - y1) * (x2 - x1);
  if (Math.abs(cross) > eps) return false;
  const dot = (px - x1) * (px - x2) + (py - y1) * (py - y2);
  return dot <= eps;
}

/** Point-in-polygon honouring holes (outer ring minus inner rings). */
export function pointInPolygon(lon, lat, polygon) {
  const rings = polygon?.type === 'Polygon' ? polygon.coordinates : polygon;
  if (!Array.isArray(rings) || !rings.length) return false;
  if (!pointInRing(lon, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i++)
    if (pointInRing(lon, lat, rings[i])) return false;
  return true;
}

/**
 * The AOI containing a point, preferring the smallest matching polygon so a
 * harbour AOI wins over the EEZ ring that also contains it.
 * @returns {{id:string, group:string, country:string, name:string, feature:object}|null}
 */
export function findAoiForPoint(lat, lon, { group } = {}) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon)))
    return null;
  let best = null;
  for (const feature of listAois({ group })) {
    if (!pointInPolygon(Number(lon), Number(lat), feature.geometry)) continue;
    const radius = Number(feature.properties.radius_km) || Infinity;
    if (!best || radius < best.radius) best = { feature, radius };
  }
  if (!best) return null;
  const p = best.feature.properties;
  return {
    id: p.id,
    group: p.group,
    country: p.country,
    name: p.name,
    feature: best.feature,
  };
}

/** Keep only the items whose lat/lon fall inside an AOI; tags each with `matchedAoi`. */
export function filterByAoi(items, { group, allowOutside = false } = {}) {
  const inside = [];
  const outside = [];
  for (const item of items || []) {
    const match = findAoiForPoint(item?.lat, item?.lon, { group });
    if (match) inside.push({ ...item, matchedAoi: summariseAoi(match) });
    else outside.push(item);
  }
  return allowOutside ? { inside, outside } : inside;
}

export function summariseAoi(match) {
  if (!match) return null;
  return {
    id: match.id,
    group: match.group,
    country: match.country,
    name: match.name,
  };
}

// ----------------------------------------------------------------- gazetteer

function normaliseToken(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`-]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every AOI name + alias → the AOI it points at, longest alias first. */
export const GAZETTEER = Object.freeze(
  AOI_FEATURES.flatMap((feature) => {
    const p = feature.properties;
    const names = [p.name, ...(p.aliases || [])];
    return names.map((name) => ({
      alias: name,
      key: normaliseToken(name),
      aoiId: p.id,
      group: p.group,
      country: p.country,
      name: p.name,
      lat: p.center.lat,
      lon: p.center.lon,
    }));
  })
    .filter((entry) => entry.key.length >= 3)
    .sort((a, b) => b.key.length - a.key.length),
);

/**
 * Fuzzy, dynamic gazetteer match for arbitrary text: case-insensitive,
 * accent-insensitive, token-boundary alias matching (longest alias wins; ties
 * go to the earliest mention in the text). Falls back to a single-token
 * prefix match ("Hodeid" → Hodeidah) when no whole alias is present.
 *
 * @param {string} text
 * @returns {{aoiId:string, group:string, country:string, name:string, lat:number, lon:number, alias:string, confidence:number}|null}
 */
export function gazetteerLookup(text) {
  const haystack = ` ${normaliseToken(text)} `;
  if (haystack.trim().length === 0) return null;
  let best = null;
  for (const entry of GAZETTEER) {
    const index = haystack.indexOf(` ${entry.key} `);
    if (index < 0) continue;
    const score = entry.key.length * 1000 - index;
    if (!best || score > best.score) best = { entry, score };
  }
  if (best)
    return {
      ...best.entry,
      confidence: Math.min(0.95, 0.6 + best.entry.key.length / 40),
    };
  const tokens = haystack.trim().split(' ');
  for (const token of tokens) {
    if (token.length < 5) continue;
    const entry = GAZETTEER.find(
      (candidate) =>
        candidate.key.startsWith(token) ||
        (token.length >= 6 && token.startsWith(candidate.key)),
    );
    if (entry) return { ...entry, confidence: 0.4 };
  }
  return null;
}

/** Every alias the gazetteer knows (for docs/tests). */
export function gazetteerAliases() {
  return GAZETTEER.map((entry) => entry.alias);
}
