/**
 * Gods-Eye Footage Ranker
 *
 * Pure scoring and clustering engine for footage items against scene context.
 *
 * Ranking formula:
 *   rankScore = 0.35 * distanceScore + 0.30 * timeScore + 0.25 * relevance + 0.10 * geoConfScore
 *
 * Components:
 *   distanceScore = exp(-distanceKm / 3)                  (0 if distanceKm is null / unknown)
 *   timeScore     = exp(-|timeDeltaSec| / tau)            (tau = 30 days for rebuild, 6 hours otherwise)
 *   relevance     = raw.relevance in [0, 1]               (defaults to 0.5 if unspecified)
 *   geoConfScore  = exact: 1.0, inferred: 0.6, unknown: 0.2
 *
 * Weights:
 *   distance:  0.35
 *   time:      0.30
 *   relevance: 0.25
 *   geo:       0.10
 */

import { haversineKm } from '../../aoi/membership.js';

export { haversineKm };

export const RANK_WEIGHTS = Object.freeze({
  distance: 0.35,
  time: 0.3,
  relevance: 0.25,
  geo: 0.1,
});

export function distanceScore(km) {
  if (km === null || km === undefined || !Number.isFinite(km)) return 0;
  return Math.exp(-Math.max(0, km) / 3);
}

export function timeDeltaSec(uploadedAt, tRef) {
  const tUp = Date.parse(uploadedAt || '');
  const tR = Date.parse(tRef || '');
  if (!Number.isFinite(tUp) || !Number.isFinite(tR)) return null;
  return Math.round((tUp - tR) / 1000);
}

export function timeScore(deltaSec, kind = 'live') {
  if (deltaSec === null || deltaSec === undefined || !Number.isFinite(deltaSec))
    return 0;
  const tau = kind === 'rebuild' ? 30 * 86400 : 6 * 3600;
  return Math.exp(-Math.abs(deltaSec) / tau);
}

export function geoConfScore(confidence) {
  switch (confidence) {
    case 'exact':
      return 1.0;
    case 'inferred':
      return 0.6;
    case 'unknown':
    default:
      return 0.2;
  }
}

export function recencyOf(uploadedAt, nowMs = Date.now(), kind = 'live') {
  if (kind === 'rebuild') return 'ARCHIVE';
  const t = Date.parse(uploadedAt || '');
  if (!Number.isFinite(t)) return 'ARCHIVE';
  const ageMs = nowMs - t;
  if (ageMs < 15 * 60_000) return 'LIVE';
  if (ageMs < 24 * 3_600_000) return 'RECENT';
  return 'ARCHIVE';
}

export function rankScore(item, scene, nowMs = Date.now()) {
  const kind = scene?.kind || 'live';
  const dScore = distanceScore(item?.distanceKm);
  const delta =
    item?.timeDelta !== null && Number.isFinite(item?.timeDelta)
      ? item.timeDelta
      : timeDeltaSec(item?.uploadedAt, scene?.tRef);
  const tScore = timeScore(delta, kind);
  const rel =
    typeof item?.relevance === 'number' && Number.isFinite(item.relevance)
      ? Math.max(0, Math.min(1, item.relevance))
      : 0.5;
  const gScore = geoConfScore(item?.location?.confidence);

  return (
    RANK_WEIGHTS.distance * dScore +
    RANK_WEIGHTS.time * tScore +
    RANK_WEIGHTS.relevance * rel +
    RANK_WEIGHTS.geo * gScore
  );
}

export function rankItems(items, scene, nowMs = Date.now()) {
  if (!Array.isArray(items)) return [];
  const targetLat = scene?.target?.lat;
  const targetLon = scene?.target?.lon;
  const hasTarget = Number.isFinite(targetLat) && Number.isFinite(targetLon);
  const tRef = scene?.tRef || new Date(nowMs).toISOString();
  const kind = scene?.kind || 'live';

  const processed = items.map((item) => {
    const itemLat = item?.location?.lat;
    const itemLon = item?.location?.lon;
    const hasLoc = Number.isFinite(itemLat) && Number.isFinite(itemLon);

    let distanceKm = null;
    if (hasLoc && hasTarget) {
      distanceKm =
        Math.round(haversineKm(itemLat, itemLon, targetLat, targetLon) * 1000) /
        1000;
    }

    const timeDelta = timeDeltaSec(item?.uploadedAt, tRef);
    const recency = recencyOf(item?.uploadedAt, nowMs, kind);
    const partial = { ...item, distanceKm, timeDelta, recency };
    const score = rankScore(partial, scene, nowMs);
    return { ...partial, rankScore: Math.round(score * 10000) / 10000 };
  });

  return processed.sort(
    (a, b) =>
      (b.rankScore ?? 0) - (a.rankScore ?? 0) ||
      (b.uploadedAt || '').localeCompare(a.uploadedAt || ''),
  );
}

export function clusterItems(items, project, px = 100, min = 8) {
  if (!Array.isArray(items) || typeof project !== 'function') return [];
  const buckets = new Map();

  for (const item of items) {
    const lat = item?.location?.lat;
    const lon = item?.location?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const pt = project(lat, lon);
    if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
    const gx = Math.floor(pt.x / px);
    const gy = Math.floor(pt.y / px);
    const key = `${gx}:${gy}`;
    let b = buckets.get(key);
    if (!b) {
      b = { key, items: [], sumX: 0, sumY: 0 };
      buckets.set(key, b);
    }
    b.items.push(item);
    b.sumX += pt.x;
    b.sumY += pt.y;
  }

  const clusters = [];
  for (const b of buckets.values()) {
    if (b.items.length >= min) {
      clusters.push({
        key: b.key,
        items: b.items,
        x: Math.round((b.sumX / b.items.length) * 10) / 10,
        y: Math.round((b.sumY / b.items.length) * 10) / 10,
      });
    }
  }
  return clusters;
}

export function formatDistance(km) {
  if (km === null || km === undefined || !Number.isFinite(km)) return '—';
  if (km < 0.5) {
    return `${Math.round(km * 1000)} m from target`;
  }
  const formatted = km < 10 ? km.toFixed(1) : Math.round(km).toString();
  return `${formatted} km from target`;
}

export function formatDelta(sec, kind = 'live') {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  if (kind === 'live') {
    const age = Math.abs(sec);
    if (age < 60) return 'posted just now';
    if (age < 3600) return `posted ${Math.round(age / 60)} min ago`;
    if (age < 86400) return `posted ${Math.round(age / 3600)} h ago`;
    return `posted ${Math.round(age / 86400)} d ago`;
  }
  const sign = sec >= 0 ? '+' : '−';
  const suffix = sec >= 0 ? 'after incident' : 'before incident';
  const mag = Math.abs(sec);
  let val;
  if (mag < 3600) val = `${Math.round(mag / 60)} min`;
  else if (mag < 86400) val = `${Math.round(mag / 3600)} h`;
  else val = `${Math.round(mag / 86400)} d`;
  return `${sign}${val} ${suffix}`;
}
