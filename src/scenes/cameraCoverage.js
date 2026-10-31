/**
 * Scene-only CCTV relevance. No fetch, inferred camera locations, title-based
 * live detection, Cesium pose defaults, layer activation, or fallback camera.
 *
 * Explicit evidence contract (the current legacy UI snapshot does NOT meet it):
 * locationEvidence: { verified:true, sourceUrl, kind:'provider-coordinate' |
 *   'survey' | 'geocoded-camera-address' }. Geocodes additionally require
 *   subject:'physical-camera', cameraId matching id, and a nonempty address.
 * coverage: { radiusM?, bounds?:[west,south,east,north], headingDeg?, fovDeg?,
 *   evidence:{verified:true,sourceUrl} }. Bounds mean *view coverage*, not a
 *   catalog/search bounding box. Heading/FOV are clockwise degrees from north.
 * permissions: { view:true|false, embed:true|false,
 *   evidence:{verified:true,sourceUrl} }. Unknown permissions fail closed.
 * availabilityEvidence: { verified:true, sourceUrl, checkedAt, kind:
 *   'live-stream' | 'live-snapshot' | 'recorded-media', capturedAt? }.
 * 'live-stream' means observed current stream activity, NOT HTTP 200, a title,
 * a playlist URL, or a page's LIVE badge. A snapshot also needs fresh capturedAt.
 * mediaUrl/frameUrl/streamUrl/url: authorized playback target, never synthesized.
 *
 * verified is an attestation by the provider adapter, not validation performed
 * here. Never set it merely because a record came through an existing proxy.
 */
export const EARTH_RADIUS_M = 6371008.8;
export const DEFAULT_MAX_DISTANCE_M = 5000;
export const DEFAULT_MAX_LIVE_AGE_MS = 120000;
export const NO_RELEVANT_CAMERA = 'no-relevant-accessible-camera';
const DEG = Math.PI / 180;
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const own = (o, key) => Object.prototype.hasOwnProperty.call(o || {}, key);

export function cameraSourceUrl(value) {
  try {
    const url = new URL(text(value));
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function proven(evidence) {
  return (
    evidence?.verified === true && Boolean(cameraSourceUrl(evidence.sourceUrl))
  );
}

export function validCameraPoint(value) {
  return value &&
    finite(value.lat) &&
    Math.abs(value.lat) <= 90 &&
    finite(value.lon) &&
    Math.abs(value.lon) <= 180
    ? { lat: value.lat, lon: value.lon }
    : null;
}

/** Metres along the WGS84 mean-radius sphere; NaN for invalid coordinates. */
export function haversineDistanceM(a, b) {
  const p = validCameraPoint(a),
    q = validCameraPoint(b);
  if (!p || !q) return NaN;
  const h =
    Math.sin(((q.lat - p.lat) * DEG) / 2) ** 2 +
    Math.cos(p.lat * DEG) *
      Math.cos(q.lat * DEG) *
      Math.sin(((q.lon - p.lon) * DEG) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

export function bearingDegrees(a, b) {
  const p = validCameraPoint(a),
    q = validCameraPoint(b);
  if (!p || !q) return NaN;
  const delta = (q.lon - p.lon) * DEG;
  const y = Math.sin(delta) * Math.cos(q.lat * DEG);
  const x =
    Math.cos(p.lat * DEG) * Math.sin(q.lat * DEG) -
    Math.sin(p.lat * DEG) * Math.cos(q.lat * DEG) * Math.cos(delta);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

export function verifiedCameraLocation(camera) {
  const point = validCameraPoint(camera?.location || camera);
  const evidence = camera?.locationEvidence;
  if (!point || !proven(evidence)) return null;
  if (
    !['provider-coordinate', 'survey', 'geocoded-camera-address'].includes(
      evidence.kind,
    )
  )
    return null;
  if (
    evidence.kind === 'geocoded-camera-address' &&
    (evidence.subject !== 'physical-camera' ||
      !text(camera.id) ||
      evidence.cameraId !== camera.id ||
      !text(evidence.address))
  )
    return null;
  return { ...point, evidence: { ...evidence } };
}

/** An explicit scene target only; never a fly-in keyframe or an averaged centroid. */
export function sceneCameraTarget(scene) {
  return (
    validCameraPoint(scene?.anchor) ||
    validCameraPoint(scene?.target) ||
    validCameraPoint(scene?.location) ||
    validCameraPoint(scene)
  );
}

function boundsValues(bounds) {
  const vals = Array.isArray(bounds)
    ? bounds
    : bounds && [bounds.west, bounds.south, bounds.east, bounds.north];
  if (!vals || vals.length !== 4 || !vals.every(finite)) return null;
  const [west, south, east, north] = vals;
  if (
    Math.abs(west) > 180 ||
    Math.abs(east) > 180 ||
    Math.abs(south) > 90 ||
    Math.abs(north) > 90 ||
    south > north
  )
    return null;
  return { west, south, east, north };
}

/** All declared coverage constraints must pass; missing/invalid proof is unknown. */
export function cameraCoverageAt(camera, target) {
  const location = verifiedCameraLocation(camera),
    point = validCameraPoint(target);
  const unknown = (reason) => ({ status: 'unknown', reason });
  if (!location || !point) return unknown('location-unverified');
  const spec = camera?.coverage;
  if (!proven(spec?.evidence)) return unknown('coverage-unverified');
  const distanceM = haversineDistanceM(location, point);
  const checks = [];
  let invalid = false,
    extent = false;
  if (own(spec, 'bounds')) {
    const b = boundsValues(spec.bounds);
    if (!b) invalid = true;
    else {
      extent = true;
      const inLon =
        b.west <= b.east
          ? point.lon >= b.west && point.lon <= b.east
          : point.lon >= b.west || point.lon <= b.east;
      checks.push({
        constraint: 'bounds',
        matches: inLon && point.lat >= b.south && point.lat <= b.north,
      });
    }
  }
  if (own(spec, 'radiusM')) {
    if (!finite(spec.radiusM) || spec.radiusM <= 0) invalid = true;
    else {
      extent = true;
      checks.push({
        constraint: 'radius',
        matches: distanceM <= spec.radiusM + 1e-6,
      });
    }
  }
  if (own(spec, 'headingDeg') || own(spec, 'fovDeg')) {
    if (
      !finite(spec.headingDeg) ||
      !finite(spec.fovDeg) ||
      spec.fovDeg <= 0 ||
      spec.fovDeg > 360
    )
      invalid = true;
    else {
      const heading = ((spec.headingDeg % 360) + 360) % 360;
      const bearing = bearingDegrees(location, point);
      const delta = Math.abs(((bearing - heading + 540) % 360) - 180);
      checks.push({
        constraint: 'fov',
        matches: distanceM < 1e-6 || delta <= spec.fovDeg / 2 + 1e-9,
      });
    }
  }
  const failed = checks.find((check) => !check.matches);
  if (failed)
    return {
      status: 'outside',
      reason: `outside-${failed.constraint}`,
      distanceM,
      checks,
    };
  if (invalid || !extent)
    return {
      ...unknown(invalid ? 'invalid-coverage' : 'coverage-extent-unknown'),
      distanceM,
      checks,
    };
  return {
    status: 'covered',
    reason: 'within-verified-coverage',
    distanceM,
    checks,
    sourceUrl: cameraSourceUrl(spec.evidence.sourceUrl),
  };
}

function timeMs(value) {
  if (finite(value)) return value;
  return text(value) ? Date.parse(value) : NaN;
}

function fresh(value, now, maxAge) {
  const stamp = timeMs(value);
  return Number.isFinite(stamp) && stamp <= now && now - stamp <= maxAge;
}

export function cameraPermissions(camera) {
  const p = camera?.permissions;
  const denied = p?.view === false || p?.embed === false;
  return {
    allowed:
      !denied && proven(p?.evidence) && p.view === true && p.embed === true,
    denied,
    reason: denied
      ? 'access-or-embedding-restricted'
      : proven(p?.evidence) && p.view === true && p.embed === true
        ? 'permitted'
        : 'permission-unverified',
  };
}

/** Preserve non-live states. A successful proxy response is never live evidence. */
export function classifyCameraStatus(
  camera,
  { now = Date.now(), maxLiveAgeMs = DEFAULT_MAX_LIVE_AGE_MS } = {},
) {
  const statuses = [camera?.status, camera?.sourceStatus].map((value) =>
    text(value).toLowerCase(),
  );
  const status = statuses.find(Boolean) || '';
  const evidence = camera?.availabilityEvidence;
  const kind = text(evidence?.kind);
  const result = (state, verified, reason) => ({
    status: state,
    verified,
    reason,
    observedStatus: status || 'unknown',
    checkedAt: proven(evidence) ? (evidence.checkedAt ?? null) : null,
  });
  if (
    cameraPermissions(camera).denied ||
    statuses.some((s) => ['restricted', 'private', 'blocked'].includes(s))
  )
    return result('restricted', false, 'access-or-embedding-restricted');
  if (
    statuses.some((s) =>
      ['offline', 'unavailable', 'disabled', 'error'].includes(s),
    )
  )
    return result('offline', false, 'source-offline');
  if (
    ['streetview', 'synthetic', 'fallback', 'seed'].includes(
      text(camera?.sourceKind).toLowerCase(),
    ) ||
    statuses.includes('degraded')
  )
    return result('unknown', false, 'fallback-not-live');
  // A provider can explicitly identify archival media; it is never relabelled live.
  if (
    statuses.some((s) => ['recorded', 'archival', 'archive'].includes(s)) ||
    kind === 'recorded-media'
  )
    return result(
      'recorded',
      proven(evidence) && kind === 'recorded-media',
      'recorded-not-live',
    );
  const recent =
    finite(now) &&
    finite(maxLiveAgeMs) &&
    maxLiveAgeMs > 0 &&
    proven(evidence) &&
    fresh(evidence.checkedAt, now, maxLiveAgeMs);
  if (
    recent &&
    (kind === 'live-stream' ||
      (kind === 'live-snapshot' &&
        fresh(evidence.capturedAt, now, maxLiveAgeMs)))
  )
    return result('live', true, 'recent-live-evidence');
  return result(
    'unknown',
    false,
    proven(evidence) && ['live-stream', 'live-snapshot'].includes(kind)
      ? 'live-evidence-stale-or-incomplete'
      : 'live-status-unverified',
  );
}

function playbackUrl(camera) {
  for (const value of [
    camera?.mediaUrl,
    camera?.frameUrl,
    camera?.streamUrl,
    camera?.url,
  ]) {
    const raw = text(value);
    if (/^\/(?!\/)/.test(raw) && !/[\\\s]/.test(raw)) return raw;
    const absolute = cameraSourceUrl(raw);
    if (absolute) return absolute;
  }
  return null;
}

export function assessSceneCamera(camera, target, options = {}) {
  const location = verifiedCameraLocation(camera);
  const point = validCameraPoint(target);
  const distanceM =
    location && point ? haversineDistanceM(location, point) : null;
  const maxDistanceM =
    finite(options.maxDistanceM) && options.maxDistanceM >= 0
      ? options.maxDistanceM
      : DEFAULT_MAX_DISTANCE_M;
  const coverage = cameraCoverageAt(camera, point);
  const availability = classifyCameraStatus(camera, options);
  const permissions = cameraPermissions(camera);
  const mediaUrl = playbackUrl(camera);
  const reasons = [];
  if (!text(camera?.id)) reasons.push('camera-identity-missing');
  if (!point) reasons.push('scene-target-missing');
  if (!location) reasons.push('location-unverified');
  if (distanceM !== null && distanceM > maxDistanceM)
    reasons.push('beyond-relevance-distance');
  if (coverage.status !== 'covered') reasons.push(coverage.reason);
  if (!permissions.allowed) reasons.push(permissions.reason);
  if (
    !availability.verified ||
    !['live', 'recorded'].includes(availability.status)
  )
    reasons.push(availability.reason);
  if (!mediaUrl) reasons.push('playback-url-missing-or-unsafe');
  return {
    camera,
    id: text(camera?.id),
    name: text(camera?.name) || text(camera?.id) || 'Unnamed camera',
    location,
    distanceM,
    coverage,
    status: availability.status,
    availability,
    permissions,
    mediaUrl,
    provider:
      text(camera?.provider) || text(camera?.sourceLabel) || 'Unknown source',
    sourceUrl:
      cameraSourceUrl(camera?.sourceUrl) ||
      cameraSourceUrl(location?.evidence.sourceUrl),
    usable: reasons.length === 0,
    reasons: [...new Set(reasons)],
  };
}

/** Nearest *relevant usable* record, deterministic tie break; never first-catalog fallback. */
export function selectSceneCamera(scene, cameras = [], options = {}) {
  const target = sceneCameraTarget(scene);
  const candidates = (Array.isArray(cameras) ? cameras : [])
    .filter((c) => c && typeof c === 'object')
    .map((camera) => assessSceneCamera(camera, target, options))
    .sort(
      (a, b) =>
        (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const selected = candidates.find((candidate) => candidate.usable) || null;
  return {
    status: selected ? 'selected' : NO_RELEVANT_CAMERA,
    selected,
    candidates,
    target,
    reason: selected
      ? 'nearest-relevant-usable-camera'
      : !target
        ? 'scene-target-missing'
        : NO_RELEVANT_CAMERA,
  };
}
