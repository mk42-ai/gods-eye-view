/**
 * Footage place-name ladder — shared by the server route
 * (server/scene-footage/snapchat.js) and the browser controller so both derive
 * the same stable locationId for a coordinate. Pure: no I/O, no DOM.
 * Config: config/aoi/footage-places.json (editable; see its notes).
 */
import placesConfig from '../../config/aoi/footage-places.json' with { type: 'json' };

export const COVERAGE_LEVELS = Object.freeze([
  'landmark',
  'neighborhood',
  'district',
  'city',
]);
export const normPlace = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
export const compactPlace = (s) => normPlace(s).replace(/\s+/g, '');
const norm = normPlace;
const R = 6371.0088;
export function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad,
    dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const PLACES = placesConfig.places;
const BY_ID = new Map(PLACES.map((p) => [p.id, p]));
const levelIndex = (level) => COVERAGE_LEVELS.indexOf(level);

/** Narrowest known place whose planning radius contains the point (or null). */
export function placeForPoint(lat, lon, places = PLACES) {
  let best = null;
  for (const p of places) {
    const d = haversineKm({ lat, lon }, p.center);
    if (d > p.radius_km) continue;
    const rank = levelIndex(p.level) * 1000 + d;
    if (!best || rank < best.rank) best = { place: p, rank, km: d };
  }
  return best ? { ...best.place, km: Math.round(best.km * 100) / 100 } : null;
}

/**
 * Configured place for a free-text name: exact (normalised) name first, else
 * the longest configured name that appears as whole words inside the text
 * ("Jumeirah Beach Residence, Dubai" → jumeirah-beach-residence).
 */
export function findPlaceByName(placeName, places = PLACES) {
  const q = norm(placeName);
  if (q.length < 3) return null;
  const exact = places.find((p) => p.names.some((n) => norm(n) === q));
  if (exact) return exact;
  let best = null;
  for (const p of places)
    for (const n of p.names) {
      const nn = norm(n);
      if (nn.length < 3 || !` ${q} `.includes(` ${nn} `)) continue;
      if (!best || nn.length > best.len) best = { p, len: nn.length };
    }
  return best ? best.p : null;
}

/** Narrowest (landmark < neighborhood < district < city) of the given places; nulls ignored. */
export function narrowestPlace(places) {
  return (places || [])
    .filter(Boolean)
    .reduce(
      (best, p) =>
        !best || levelIndex(p.level) < levelIndex(best.level) ? p : best,
      null,
    );
}

/** Stable, URL-safe location id for a coordinate (+ optional place name). */
export function locationIdFor({ lat, lon, placeName } = {}) {
  const p =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? placeForPoint(lat, lon)
      : null;
  const named = findPlaceByName(placeName);
  const chosen = named || p;
  if (chosen) return `snap-${chosen.id}`;
  return `pt-${Number(lat).toFixed(3)}_${Number(lon).toFixed(3)}`
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/\./g, 'd');
}

/**
 * Narrow-to-wide place-name ladder. Starts at the place the operator asked
 * for (by name) or, failing that, the narrowest configured place containing
 * the coordinate (or bbox centre), then follows `parent` links. Levels wider
 * than maxCoverageLevel are reported as `capped` and never queried.
 *
 * If strictBounds is true or radiusKm is provided, steps outside the requested
 * geographic boundary are capped with an explicit cappedReason.
 */
export function buildLadder(
  { lat, lon, placeName, bbox } = {},
  {
    maxCoverageLevel = 'district',
    places = PLACES,
    strictBounds = false,
    radiusKm = null,
  } = {},
) {
  const byId =
    places === PLACES ? BY_ID : new Map(places.map((p) => [p.id, p]));
  let point =
    Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  if (!point && Array.isArray(bbox) && bbox.length === 4)
    point = { lat: (bbox[1] + bbox[3]) / 2, lon: (bbox[0] + bbox[2]) / 2 };
  const cap = levelIndex(maxCoverageLevel);
  const named = findPlaceByName(placeName, places);
  let start =
    named || (point ? placeForPoint(point.lat, point.lon, places) : null);
  const steps = [];
  const seen = new Set();
  if (!start && placeName && norm(placeName).length >= 3) {
    steps.push({
      level: 'landmark',
      placeId: null,
      names: [String(placeName).trim().slice(0, 80)],
      label: String(placeName).trim().slice(0, 80),
      capped: false,
      source: 'requested-name',
    });
  }
  let stepIndex = 0;
  while (start && !seen.has(start.id)) {
    seen.add(start.id);
    let capped = levelIndex(start.level) > cap;
    let cappedReason = capped ? 'max-coverage-level' : null;

    if (!capped && strictBounds && stepIndex > 0) {
      capped = true;
      cappedReason = 'strict-bounds';
    } else if (
      !capped &&
      Number.isFinite(radiusKm) &&
      radiusKm > 0 &&
      point &&
      start.center
    ) {
      const dist = haversineKm(point, start.center);
      if (dist + (Number(start.radius_km) || 0) > radiusKm) {
        capped = true;
        cappedReason = 'beyond-requested-radius';
      }
    }

    steps.push({
      level: start.level,
      placeId: start.id,
      names: [...start.names],
      label: start.names[0],
      capped,
      ...(cappedReason ? { cappedReason } : {}),
      source: start.source,
    });
    start = start.parent ? byId.get(start.parent) : null;
    stepIndex += 1;
  }
  return steps;
}
