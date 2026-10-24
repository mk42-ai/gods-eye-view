/**
 * Great-circle route fallback with curated Dubai road network.
 * Browser ES module — no DOM, no Node builtins.
 */

import { haversineKm } from '../../aoi/membership.js';
import { buildScenePath, bearingDeg } from '../camera/ladder.js';

export const DUBAI_CENTER = Object.freeze({ lat: 25.2048, lon: 55.2708 });

export const DUBAI_GROUND_ROUTES = Object.freeze([
  {
    id: 'szr',
    name: 'Sheikh Zayed Road (E11)',
    kind: 'motorway',
    status: 'unknown',
    source: 'curated-table (no live status)',
    geometry: [
      [25.2048, 55.2708],
      [25.1859, 55.2534],
      [25.1663, 55.2318],
      [25.1415, 55.2076],
      [25.1165, 55.1832],
      [25.0901, 55.1569],
    ],
  },
  {
    id: 'alwasl',
    name: 'Al Wasl Road (D92)',
    kind: 'arterial',
    status: 'unknown',
    source: 'curated-table (no live status)',
    geometry: [
      [25.2176, 55.2581],
      [25.1955, 55.2374],
      [25.1727, 55.2178],
      [25.1521, 55.2003],
      [25.1317, 55.1838],
    ],
  },
  {
    id: 'jumeirah',
    name: 'Jumeirah Street (D94)',
    kind: 'arterial',
    status: 'unknown',
    source: 'curated-table (no live status)',
    geometry: [
      [25.2261, 55.2612],
      [25.204, 55.242],
      [25.1795, 55.2217],
      [25.1567, 55.2005],
      [25.1388, 55.185],
    ],
  },
]);

export function fallbackRoute({
  origin,
  target,
  preset = { alt: 18000, heading: 0, pitch: 60, dwell: [4.2, 11] },
  aoiId = null,
  basis = 'great-circle-fallback',
  now = () => Date.now(),
} = {}) {
  const tLat = Number(target?.lat) || 0;
  const tLon = Number(target?.lon) || 0;
  const nowIso = new Date(
    typeof now === 'function' ? now() : now,
  ).toISOString();

  let approachBearing = preset?.heading ?? 0;
  if (
    origin &&
    Number.isFinite(origin.lat) &&
    Number.isFinite(origin.lon) &&
    (origin.lat !== tLat || origin.lon !== tLon)
  ) {
    approachBearing = bearingDeg(origin.lat, origin.lon, tLat, tLon);
  }

  const scenePath = buildScenePath({
    origin,
    target,
    preset,
    approachBearing,
  });

  const distToDubaiKm = haversineKm(
    tLat,
    tLon,
    DUBAI_CENTER.lat,
    DUBAI_CENTER.lon,
  );
  const isWithinDubai = distToDubaiKm <= 15;

  const groundRoutes = isWithinDubai
    ? DUBAI_GROUND_ROUTES.map((route) => ({
        ...route,
        geometry: route.geometry.map((pt) => [...pt]),
        status: 'unknown',
        lastChecked: nowIso,
        source: 'curated-table (no live status)',
      }))
    : [];

  return {
    scenePath,
    approachBearing,
    groundRoutes,
    alerts: [],
    confidence: 0.3,
    basis,
    fallback: true,
  };
}
