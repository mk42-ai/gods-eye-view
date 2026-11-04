/**
 * AOI membership — pure geometry over config/aoi/uae-interest.json.
 *
 * Runs unchanged in the browser (scene filter, composer) and on the server
 * (/api/ondemand/v2/incidents ingest/locate): no DOM, no Node builtins, no
 * network. The config is injected by the caller (`createAoiIndex(config)`)
 * so each runtime loads it the way it prefers (Vite JSON import vs fs).
 *
 * Supported AOI kinds
 *   polygon — `ring` of [lon, lat] vertices (ray casting) + `buffer_km`
 *   bbox    — [west, south, east, north] + `buffer_km`
 *   circle  — `center` {lat, lon} + `radius_km` (+ optional `buffer_km`)
 *
 * membership(lat, lon) → {
 *   inside: boolean,
 *   aoi_ids: string[],            every AOI (or its buffer) containing the point
 *   groups: string[],             distinct AOI groups hit
 *   nearest: {id, name, km},      closest AOI edge, also when inside
 *   reason: string                'IN_AOI: <names>' or
 *                                 'OUT_OF_AOI: nearest AOI <name> at <km> km'
 * }
 */

export const EARTH_RADIUS_KM = 6371.0088;
const DEG = Math.PI / 180;

/** Great-circle distance in km (haversine). */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Ray-casting point-in-polygon; `ring` is [[lon, lat], …] (closed or open). */
export function pointInRing(lat, lon, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInBbox(lat, lon, bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return false;
  const [west, south, east, north] = bbox;
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

/** Distance (km) from a point to a great-circle segment, approximated on a local tangent plane. */
function segmentDistanceKm(lat, lon, [lon1, lat1], [lon2, lat2]) {
  const cosLat = Math.cos(lat * DEG);
  const px = (lon - lon1) * cosLat;
  const py = lat - lat1;
  const vx = (lon2 - lon1) * cosLat;
  const vy = lat2 - lat1;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * vx + py * vy) / len2)) : 0;
  const cx = lon1 + (t * vx) / (cosLat || Number.EPSILON);
  const cy = lat1 + t * vy;
  return haversineKm(lat, lon, cy, cx);
}

/** Distance from a point to the nearest edge of a ring (0 when on the edge). */
export function ringEdgeDistanceKm(lat, lon, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    best = Math.min(best, segmentDistanceKm(lat, lon, ring[j], ring[i]));
  }
  return best;
}

function bboxRing([west, south, east, north]) {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ];
}

/**
 * Signed-ish distance from a point to one AOI: 0 when inside the core shape,
 * otherwise km to the core edge (buffers are applied by the caller).
 */
export function distanceToAoiKm(lat, lon, aoi) {
  switch (aoi.kind) {
    case 'polygon':
      return pointInRing(lat, lon, aoi.ring)
        ? 0
        : ringEdgeDistanceKm(lat, lon, aoi.ring);
    case 'bbox':
      return pointInBbox(lat, lon, aoi.bbox)
        ? 0
        : ringEdgeDistanceKm(lat, lon, bboxRing(aoi.bbox));
    case 'circle': {
      const d = haversineKm(lat, lon, aoi.center.lat, aoi.center.lon);
      return Math.max(0, d - (Number(aoi.radius_km) || 0));
    }
    default:
      return Infinity;
  }
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Validate the shape of one AOI entry; throws with the offending id.
 * @param {object} aoi
 */
export function validateAoi(aoi) {
  const bad = (why) => {
    throw new Error(`aoi ${aoi?.id || '?'}: ${why}`);
  };
  if (!aoi || typeof aoi.id !== 'string' || !aoi.id) bad('id required');
  if (typeof aoi.name !== 'string' || !aoi.name) bad('name required');
  if (typeof aoi.group !== 'string' || !aoi.group) bad('group required');
  if (aoi.kind === 'polygon') {
    if (!Array.isArray(aoi.ring) || aoi.ring.length < 3) bad('ring < 3');
    for (const v of aoi.ring)
      if (
        !Array.isArray(v) ||
        v.length !== 2 ||
        !Number.isFinite(v[0]) ||
        !Number.isFinite(v[1]) ||
        Math.abs(v[0]) > 180 ||
        Math.abs(v[1]) > 90
      )
        bad('ring vertex must be [lon, lat]');
  } else if (aoi.kind === 'bbox') {
    if (!Array.isArray(aoi.bbox) || aoi.bbox.length !== 4) bad('bbox[4]');
    const [w, s, e, n] = aoi.bbox;
    if (!(w < e && s < n)) bad('bbox must be [west,south,east,north]');
  } else if (aoi.kind === 'circle') {
    if (
      !aoi.center ||
      !Number.isFinite(aoi.center.lat) ||
      !Number.isFinite(aoi.center.lon)
    )
      bad('center {lat,lon}');
    if (!(Number(aoi.radius_km) > 0)) bad('radius_km > 0');
  } else bad(`unknown kind ${aoi.kind}`);
  if (aoi.buffer_km !== undefined && !(Number(aoi.buffer_km) >= 0))
    bad('buffer_km >= 0');
  return aoi;
}

/**
 * Build a queryable index from the JSON config.
 * @param {object} config parsed config/aoi/uae-interest.json
 * @param {{groups?: string[]}} [options] restrict to some groups (layer toggles)
 */
export function createAoiIndex(config, { groups } = {}) {
  if (!config || !Array.isArray(config.aois))
    throw new Error('aoi config: aois[] required');
  const enabled = groups ? new Set(groups) : null;
  const aois = config.aois
    .map(validateAoi)
    .filter((aoi) => !enabled || enabled.has(aoi.group));
  const byId = new Map(aois.map((aoi) => [aoi.id, aoi]));
  const gazetteer = Array.isArray(config.gazetteer) ? config.gazetteer : [];

  /** Effective inclusion radius beyond the core shape. */
  const bufferOf = (aoi) => Number(aoi.buffer_km) || 0;

  function membership(lat, lon) {
    lat = Number(lat);
    lon = Number(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon))
      return {
        inside: false,
        aoi_ids: [],
        groups: [],
        nearest: null,
        reason: 'OUT_OF_AOI: invalid coordinates',
      };
    const hits = [];
    let nearest = null;
    for (const aoi of aois) {
      const core = distanceToAoiKm(lat, lon, aoi);
      const beyond = Math.max(0, core - bufferOf(aoi));
      if (beyond === 0)
        hits.push({ id: aoi.id, name: aoi.name, group: aoi.group, km: core });
      if (!nearest || beyond < nearest.km)
        nearest = { id: aoi.id, name: aoi.name, group: aoi.group, km: beyond };
    }
    hits.sort((a, b) => a.km - b.km);
    const inside = hits.length > 0;
    return {
      inside,
      aoi_ids: hits.map((h) => h.id),
      groups: [...new Set(hits.map((h) => h.group))],
      nearest: nearest
        ? { id: nearest.id, name: nearest.name, km: round1(nearest.km) }
        : null,
      reason: inside
        ? `IN_AOI: ${hits
            .slice(0, 3)
            .map((h) => h.name)
            .join(', ')}`
        : nearest
          ? `OUT_OF_AOI: nearest AOI ${nearest.name} at ${round1(nearest.km)} km`
          : 'OUT_OF_AOI: no AOI configured',
    };
  }

  /** Case-insensitive gazetteer lookup: exact alias → contains → token overlap. */
  function gazetteerLookup(text, limit = 5) {
    const q = String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!q) return [];
    const scored = [];
    for (const entry of gazetteer) {
      const names = [entry.name, ...(entry.aliases || [])].map((n) =>
        String(n).toLowerCase(),
      );
      let score = 0;
      for (const n of names) {
        if (q === n) score = Math.max(score, 1);
        else if (new RegExp(`(^|\\W)${escapeRe(n)}(\\W|$)`).test(q))
          score = Math.max(
            score,
            0.9 - Math.min(0.3, (q.length - n.length) / 200),
          );
        else if (n.length >= 4 && q.includes(n)) score = Math.max(score, 0.6);
      }
      if (score > 0) scored.push({ entry, score });
    }
    scored.sort(
      (a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name),
    );
    return scored.slice(0, limit).map(({ entry, score }) => ({
      name: entry.name,
      lat: entry.lat,
      lon: entry.lon,
      country: entry.country ?? null,
      verified: entry.verified !== false,
      confidence: Math.round(score * 100) / 100,
      source: 'gazetteer',
      ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}),
    }));
  }

  return {
    aois,
    groups: config.groups || {},
    buffers: config.buffers_km || {},
    get(id) {
      return byId.get(id) || null;
    },
    membership,
    gazetteerLookup,
    /** Every AOI as a renderable outline: [{id,name,group,ring:[[lon,lat]…],color}]. */
    outlines(segments = 48) {
      return aois.map((aoi) => ({
        id: aoi.id,
        name: aoi.name,
        group: aoi.group,
        color: config.groups?.[aoi.group]?.color || '#ffffff',
        ring: outlineRing(aoi, segments),
      }));
    },
  };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Closed ring approximating the AOI core shape (circles → regular polygon). */
export function outlineRing(aoi, segments = 48) {
  if (aoi.kind === 'polygon') return [...aoi.ring, aoi.ring[0]];
  if (aoi.kind === 'bbox') {
    const r = bboxRing(aoi.bbox);
    return [...r, r[0]];
  }
  const { lat, lon } = aoi.center;
  const r = Number(aoi.radius_km) || 0;
  const ring = [];
  for (let i = 0; i <= segments; i += 1) {
    const brg = (i / segments) * 2 * Math.PI;
    const dLat = (r / EARTH_RADIUS_KM) * Math.cos(brg);
    const dLon = ((r / EARTH_RADIUS_KM) * Math.sin(brg)) / Math.cos(lat * DEG);
    ring.push([lon + dLon / DEG, lat + dLat / DEG]);
  }
  return ring;
}
