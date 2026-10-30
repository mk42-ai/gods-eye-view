/**
 * Pure SCENE authorization, deliberately separate from the broad interest map.
 * No I/O, provider calls, text geocoding, DOM access, or implicit global state.
 * Numeric coordinates are authoritative; mentioning UAE never grants access.
 */
import config from '../../config/aoi/scene-aois.json' with { type: 'json' };
import { distanceToAoiKm, pointInBbox, pointInRing } from './membership.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const sceneAoiConfig = deepFreeze(config);
const policy = sceneAoiConfig.policy;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const validNumber = (value, limit) =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

function coordinatesOf(coords) {
  if (!coords || typeof coords !== 'object' || Array.isArray(coords)) return null;
  if (!own(coords, 'lat') || !validNumber(coords.lat, 90)) return null;
  const hasLon = own(coords, 'lon');
  const hasLng = own(coords, 'lng');
  if (!hasLon && !hasLng) return null;
  if (hasLon && !validNumber(coords.lon, 180)) return null;
  if (hasLng && !validNumber(coords.lng, 180)) return null;
  if (hasLon && hasLng && coords.lon !== coords.lng) return null;
  return { lat: coords.lat, lon: hasLon ? coords.lon : coords.lng };
}

function ringBox(ring) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of ring) {
    box[0] = Math.min(box[0], lon);
    box[1] = Math.min(box[1], lat);
    box[2] = Math.max(box[2], lon);
    box[3] = Math.max(box[3], lat);
  }
  return box;
}

// Include polygon edges explicitly. membership.pointInRing uses ray casting,
// whose boundary result alone depends on edge direction. Holes remain holes.
function ringContains(lat, lon, ring) {
  if (pointInRing(lat, lon, ring)) return true;
  const epsilon = 1e-10;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j];
    const [bx, by] = ring[i];
    if (lon < Math.min(ax, bx) - epsilon || lon > Math.max(ax, bx) + epsilon ||
        lat < Math.min(ay, by) - epsilon || lat > Math.max(ay, by) + epsilon) continue;
    const length = Math.hypot(bx - ax, by - ay);
    if (length === 0) {
      if (Math.hypot(lon - ax, lat - ay) <= epsilon) return true;
    } else if (Math.abs((lon - ax) * (by - ay) - (lat - ay) * (bx - ax)) / length <= epsilon) {
      return true;
    }
  }
  return false;
}

const masks = sceneAoiConfig.country_masks.map(({ country, geometry }) => ({
  country,
  polygons: (geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates])
    .map((rings) => ({ rings, bbox: ringBox(rings[0]) })),
}));

function inCountry(country, lat, lon) {
  const mask = masks.find((item) => item.country === country);
  return Boolean(mask?.polygons.some(({ rings, bbox }) =>
    pointInBbox(lat, lon, bbox) && ringContains(lat, lon, rings[0]) &&
    !rings.slice(1).some((hole) => ringContains(lat, lon, hole))));
}

const explicitAois = sceneAoiConfig.aois.filter((aoi) =>
  aoi.id !== policy.bbox_aoi_id && policy.allowed_groups.includes(aoi.group));

/**
 * Resolve a scene's positive spatial authorization without side effects.
 * @param {string} text Descriptive only; never a spatial authorization input.
 * @param {{lat:number, lon?:number, lng?:number}} coords WGS84 decimal degrees.
 * @returns {{allowed:boolean,aoiId:string|null,reason:string,code:string}}
 */
export function resolveIncidentGate(text, coords) {
  // Do not infer coordinates from text or allow caller-supplied AOI/override flags.
  void text;
  const point = coordinatesOf(coords);
  const base = {
    allowed: false, aoiId: null, aoiIds: [], aoi_ids: [],
    policyVersion: sceneAoiConfig.version, textUsedForAuthorization: false,
    coordinates: point, country: null,
  };
  const deny = (code, reason, country = null) => ({ ...base, code, reason, country });
  const allow = (aoi, code, country, hits = [aoi]) => ({
    ...base, allowed: true, aoiId: aoi.id, aoiIds: hits.map((hit) => hit.id),
    aoi_ids: hits.map((hit) => hit.id), aoiName: aoi.name, group: aoi.group,
    country, code, reason: `IN_SCENE_AOI: ${aoi.name}`,
    boundaryType: aoi.boundary_type,
  });
  if (!point) return deny('INVALID_COORDINATES', 'OUT_OF_SCENE_AOI: invalid or conflicting WGS84 coordinates');
  const { lat, lon } = point;
  if (!pointInBbox(lat, lon, policy.generous_bbox))
    return deny('OUTSIDE_SCENE_BBOX', 'OUT_OF_SCENE_AOI: outside the explicit UAE scene envelope');

  // Negative masks prevent a generous rectangle from admitting foreign land,
  // waters, islands, or Oman enclaves merely because their latitude is similar.
  if (inCountry('IR', lat, lon))
    return deny('EXCLUDED_FOREIGN_GEOGRAPHY', 'OUT_OF_SCENE_AOI: Iran is contextual geography, not a UAE scene AOI', 'IR');
  const oman = inCountry('OM', lat, lon);
  const country = oman ? 'OM' : inCountry('AE', lat, lon) ? 'AE' : null;
  const hits = explicitAois.filter((aoi) => distanceToAoiKm(lat, lon, aoi) <= (aoi.buffer_km || 0));
  const borders = hits.filter((aoi) => aoi.group === policy.foreign_exception_group);
  // Only these named, bounded border circles intentionally cross into Oman.
  if (borders.length) return allow(borders[0], 'EXPLICIT_BORDER_ZONE', country, borders);
  if (oman)
    return deny('EXCLUDED_FOREIGN_GEOGRAPHY', 'OUT_OF_SCENE_AOI: Oman is excluded outside explicit UAE border zones', 'OM');
  if (hits.length) return allow(hits[0], hits[0].group === 'protected-assets' ? 'EXPLICIT_PROTECTED_ASSET' : 'EXPLICIT_UAE_AOI', country, hits);
  if (country === policy.bbox_requires_country) {
    const bbox = sceneAoiConfig.aois.find((aoi) => aoi.id === policy.bbox_aoi_id);
    return allow(bbox, 'UAE_BBOX_INTERSECTION', country);
  }
  return deny('NO_POSITIVE_SCENE_AOI', 'OUT_OF_SCENE_AOI: no explicit UAE AOI, border zone, protected asset, or UAE bbox intersection');
}
