/**
 * Camera stage ladder constants, waypoints generator and spherical math.
 * Browser ES module — no DOM, no Node builtins.
 */

export const EARTH_RADIUS_KM = 6371.0088;
const DEG = Math.PI / 180;

/** Stage ladder configuration S0..S4 per Contract §4. */
export const LADDER = Object.freeze([
  {
    stage: 'S0',
    alt: 8_000_000,
    pitch: -90,
    durationMs: 1200,
    holdMs: 1500,
    revealLayers: ['globe', 'viirs', 'aoi-rings', 'target-region'],
  },
  {
    stage: 'S1',
    alt: 1_200_000,
    pitch: -70,
    durationMs: 2200,
    holdMs: 1500,
    revealLayers: ['country-outline', 'scene-aoi-ring', 'ground-routes'],
  },
  {
    stage: 'S2',
    alt: 18_000,
    pitch: -60,
    durationMs: 2600,
    holdMs: 4200,
    revealLayers: ['pins', 'distance-rings', 'header'],
  },
  {
    stage: 'S3',
    alt: 2_000,
    pitch: -45,
    durationMs: 2200,
    holdMs: 1500,
    revealLayers: ['clusters', 'leader-lines', 'route-labels'],
  },
  {
    stage: 'S4',
    alt: 300,
    pitch: -30,
    durationMs: 2300,
    holdMs: 11000,
    revealLayers: ['rail', 'timeline', 'player'],
  },
]);

/** Initial bearing from (lat1, lon1) to (lat2, lon2) in degrees [0, 360). */
export function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = (Number(lat1) || 0) * DEG;
  const p2 = (Number(lat2) || 0) * DEG;
  const dL = ((Number(lon2) || 0) - (Number(lon1) || 0)) * DEG;
  const y = Math.sin(dL) * Math.cos(p2);
  const x =
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dL);
  return (((Math.atan2(y, x) / DEG) % 360) + 360) % 360;
}

/** Destination point given start (lat, lon), bearing in degrees, and distance in km. */
export function destinationPoint(lat, lon, bearing, km) {
  const dR = (Number(km) || 0) / EARTH_RADIUS_KM;
  const brg = (Number(bearing) || 0) * DEG;
  const l1 = (Number(lat) || 0) * DEG;
  const n1 = (Number(lon) || 0) * DEG;
  const l2 = Math.asin(
    Math.sin(l1) * Math.cos(dR) + Math.cos(l1) * Math.sin(dR) * Math.cos(brg),
  );
  const n2 =
    n1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(dR) * Math.cos(l1),
      Math.cos(dR) - Math.sin(l1) * Math.sin(l2),
    );
  return { lat: l2 / DEG, lon: ((n2 / DEG + 540) % 360) - 180 };
}

/** Interpolate between numbers or coordinates {lat, lon}. */
export function interpolate(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (!a || !b) return a || b;
  const lat1 = (a.lat ?? a[0] ?? 0) * DEG;
  const lon1 = (a.lon ?? a[1] ?? 0) * DEG;
  const lat2 = (b.lat ?? b[0] ?? 0) * DEG;
  const lon2 = (b.lon ?? b[1] ?? 0) * DEG;
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  if (d < 1e-9) {
    const la = a.lat ?? a[0] ?? 0;
    const lb = b.lat ?? b[0] ?? 0;
    const na = a.lon ?? a[1] ?? 0;
    const nb = b.lon ?? b[1] ?? 0;
    return { lat: la + (lb - la) * t, lon: na + (nb - na) * t };
  }
  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x =
    A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y =
    A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  return {
    lat: Math.atan2(z, Math.sqrt(x * x + y * y)) / DEG,
    lon: Math.atan2(y, x) / DEG,
  };
}

/** Array of n points along the great circle between a and b. */
export function greatCirclePoints(a, b, n) {
  const count = Math.max(0, Math.floor(n));
  if (count <= 0) return [];
  if (count === 1) return [interpolate(a, b, 0)];
  return Array.from({ length: count }, (_, i) =>
    interpolate(a, b, i / (count - 1)),
  );
}

/** Nearest ladder stage for a given altitude by log-altitude. */
export function stageForAltitude(alt) {
  const logAlt = Math.log(Math.max(1, Number(alt) || 1));
  let bestStage = LADDER[0].stage;
  let bestDist = Infinity;
  for (const item of LADDER) {
    const dist = Math.abs(logAlt - Math.log(item.alt));
    if (dist < bestDist) {
      bestDist = dist;
      bestStage = item.stage;
    }
  }
  return bestStage;
}

/** Sum of waypoint travel durations in milliseconds. */
export function totalTravelMs(path) {
  return Array.isArray(path)
    ? path.reduce((sum, wp) => sum + (Number(wp.durationMs) || 0), 0)
    : 0;
}

/** Build 5 waypoints S0..S4 matching Contract §4. */
export function buildScenePath({
  origin,
  target,
  preset = { alt: 18000, heading: 0, pitch: 60, dwell: [4.2, 11] },
  approachBearing,
} = {}) {
  const tLat = Number(target?.lat) || 0;
  const tLon = Number(target?.lon) || 0;
  let bearing = approachBearing;
  if (
    bearing === undefined ||
    bearing === null ||
    Number.isNaN(Number(bearing))
  ) {
    if (
      origin &&
      Number.isFinite(origin.lat) &&
      Number.isFinite(origin.lon) &&
      (origin.lat !== tLat || origin.lon !== tLon)
    ) {
      bearing = bearingDeg(origin.lat, origin.lon, tLat, tLon);
    } else {
      bearing = preset?.heading ?? 0;
    }
  }
  bearing = (((Number(bearing) || 0) % 360) + 360) % 360;
  const back = (bearing + 180) % 360;

  const makeWp = (stage, lat, lon, alt, hdg, pt) => {
    const l = LADDER.find((x) => x.stage === stage);
    return {
      lat,
      lon,
      alt: alt ?? l.alt,
      heading: hdg ?? bearing,
      pitch: pt ?? l.pitch,
      durationMs: l.durationMs,
      easing: 'quadInOut',
      stage,
      revealLayers: [...l.revealLayers],
    };
  };

  const s1Pos = destinationPoint(tLat, tLon, back, 2 * DEG * EARTH_RADIUS_KM);
  const s4Pos = destinationPoint(tLat, tLon, back, 0.35);

  return [
    makeWp('S0', tLat, tLon, LADDER[0].alt, bearing, LADDER[0].pitch),
    makeWp('S1', s1Pos.lat, s1Pos.lon, LADDER[1].alt, bearing, LADDER[1].pitch),
    makeWp(
      'S2',
      tLat,
      tLon,
      preset?.alt ?? LADDER[2].alt,
      preset?.heading ?? bearing,
      LADDER[2].pitch,
    ),
    makeWp('S3', tLat, tLon, LADDER[3].alt, bearing, LADDER[3].pitch),
    makeWp(
      'S4',
      s4Pos.lat,
      s4Pos.lon,
      LADDER[4].alt,
      bearingDeg(s4Pos.lat, s4Pos.lon, tLat, tLon),
      LADDER[4].pitch,
    ),
  ];
}
