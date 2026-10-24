/** Source-backed media admission. Pure, shared by the server and browser.
 * Neither model answers, captions, profile locations nor geocoder anchors are
 * recording evidence. Unknown data is deliberately retained as unknown.
 */
export const EVIDENCE_POLICY_VERSION = 'source-recording-v2';
export const DEFAULT_WINDOW_HOURS = 1;
const HOUR = 3_600_000;
const RAD = Math.PI / 180;
const EARTH_KM = 6371.0088;
export const REJECTION_LABELS = Object.freeze({
  unverified_provider_record: 'Raw source record unavailable; a model/search answer is not verification',
  not_video: 'Source does not establish that this item is a video',
  missing_media_location: 'No source-backed recording location',
  invalid_media_location: 'Invalid WGS84 recording geometry',
  imprecise_media_location: 'Broad/ambiguous place geometry extends outside the AOI',
  outside_aoi: 'Recording location is outside the selected AOI',
  missing_recording_time: 'Recording time unknown; publication/retrieval time is not recording time',
  invalid_recording_time: 'Recording time is invalid or implausible',
  imprecise_recording_time: 'Recording-time precision cannot establish the selected interval',
  outside_time_window: 'Recording is outside the selected UTC interval',
  playback_not_authorized: 'No source-authorized embed or media delivery',
});
export function validPoint(lat, lon) {
  return typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}
export function haversineKm(a, b) {
  if (!validPoint(a?.lat, a?.lon) || !validPoint(b?.lat, b?.lon)) return null;
  const dlat = (b.lat - a.lat) * RAD, dlon = (b.lon - a.lon) * RAD;
  const q = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dlon / 2) ** 2;
  return EARTH_KM * 2 * Math.asin(Math.sqrt(Math.min(1, q)));
}
export function zonedInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const day = Number(value.slice(8, 10)), month = Number(value.slice(5, 7)), year = Number(value.slice(0, 4));
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}
export function resolveEvidenceWindow(input = {}, now = new Date()) {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error('invalid_execution_time');
  if (input.timeMode === 'historical') {
    const startUtc = zonedInstant(input.windowStart), endUtc = zonedInstant(input.windowEnd);
    if (!startUtc || !endUtc || Date.parse(startUtc) >= Date.parse(endUtc) || Date.parse(endUtc) > nowMs || Date.parse(endUtc) - Date.parse(startUtc) > 31 * 24 * HOUR) throw new Error('invalid_historical_window');
    return { mode: 'historical', startUtc, endUtc, hours: (Date.parse(endUtc) - Date.parse(startUtc)) / HOUR, basis: 'explicit-recording-time-interval' };
  }
  if (input.timeMode && input.timeMode !== 'recent') throw new Error('invalid_time_mode');
  const hours = input.windowHours === undefined ? DEFAULT_WINDOW_HOURS : Number(input.windowHours);
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) throw new Error('invalid_window_hours');
  return { mode: 'recent', startUtc: new Date(nowMs - hours * HOUR).toISOString(), endUtc: new Date(nowMs).toISOString(), hours, basis: 'recording-time-not-publication' };
}
function insideRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > point.lat) !== (yj > point.lat) && point.lon < (xj - xi) * (point.lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segmentDistance(point, a, b) {
  // Local tangent-plane distance for small AOIs; vertices use WGS84 haversine.
  const scale = Math.cos(point.lat * RAD), x1 = (a[0] - point.lon) * RAD * EARTH_KM * scale, y1 = (a[1] - point.lat) * RAD * EARTH_KM;
  const x2 = (b[0] - point.lon) * RAD * EARTH_KM * scale, y2 = (b[1] - point.lat) * RAD * EARTH_KM;
  const dx = x2 - x1, dy = y2 - y1, t = Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x1 + t * dx, y1 + t * dy);
}
export function measureMediaGeometry(geometry, anchor) {
  if (!validPoint(anchor?.lat, anchor?.lon) || !geometry) return null;
  if (geometry.type === 'Point') {
    const c = geometry.coordinates;
    if (!Array.isArray(c) || !validPoint(c[1], c[0])) return null;
    const d = haversineKm(anchor, { lat: c[1], lon: c[0] });
    return { distanceKm: d, maxDistanceKm: d, method: 'haversine-point', precision: 'exact', lat: c[1], lon: c[0] };
  }
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : null;
  if (!Array.isArray(polygons) || !polygons.length || polygons.length > 30) return null;
  let min = Infinity, max = 0;
  for (const rings of polygons) {
    if (!Array.isArray(rings) || !rings.length) return null;
    for (const ring of rings) {
      if (!Array.isArray(ring) || ring.length < 4 || ring.length > 2000 || ring.some((c) => !Array.isArray(c) || !validPoint(c[1], c[0]))) return null;
      if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) return null;
      for (let i = 0; i < ring.length; i++) {
        max = Math.max(max, haversineKm(anchor, { lat: ring[i][1], lon: ring[i][0] }));
        if (i) min = Math.min(min, segmentDistance(anchor, ring[i - 1], ring[i]));
      }
    }
    if (insideRing(anchor, rings[0]) && !rings.slice(1).some((r) => insideRing(anchor, r))) min = 0;
  }
  return { distanceKm: min, maxDistanceKm: max, method: 'polygon-edge-local-tangent+vertex-haversine', precision: 'area', lat: null, lon: null };
}
export function qualifyRecording(raw = {}, { anchor, radiusKm = 5, window, now = new Date() } = {}) {
  window ||= resolveEvidenceWindow({}, now);
  const reasons = [];
  const add = (r) => { if (!reasons.includes(r)) reasons.push(r); };
  const evidence = raw.evidence || {};
  if (evidence.kind !== 'provider-record' || evidence.verified !== true) add('unverified_provider_record');
  if (raw.mediaType !== 'video') add('not_video');
  const location = raw.mediaLocation;
  let measurement = null;
  if (!location || location.sourceVerified !== true || location.basis !== 'recording-location' || !location.field || !location.geometry) add('missing_media_location');
  else {
    measurement = measureMediaGeometry(location.geometry, anchor);
    if (!measurement) add('invalid_media_location');
    else {
      const uncertainty = Number(location.uncertaintyKm ?? 0);
      if (!Number.isFinite(uncertainty) || uncertainty < 0) add('invalid_media_location');
      else if (measurement.distanceKm > radiusKm) add('outside_aoi');
      else if (measurement.maxDistanceKm + uncertainty > radiusKm) add('imprecise_media_location');
    }
  }
  const rt = raw.recordingTime;
  let recordedAt = null;
  if (!rt || rt.sourceVerified !== true || rt.basis !== 'recorded' || !rt.field || !rt.value) add('missing_recording_time');
  else {
    recordedAt = zonedInstant(rt.value);
    if (!recordedAt || Date.parse(recordedAt) < Date.UTC(2005, 0, 1) || Date.parse(recordedAt) > new Date(now).getTime()) add('invalid_recording_time');
    else {
      const precisionMs = rt.precision === 'second' ? 1000 : rt.precision === 'minute' ? 60_000 : rt.precision === 'day' ? 24 * HOUR : null;
      if (precisionMs === null) add('imprecise_recording_time');
      else {
        const from = Date.parse(recordedAt), to = from + precisionMs;
        if (to <= Date.parse(window.startUtc) || from >= Date.parse(window.endUtc)) add('outside_time_window');
        else if (from < Date.parse(window.startUtc) || to > Date.parse(window.endUtc)) add('imprecise_recording_time');
      }
    }
  }
  if (raw.playback?.authorized !== true || raw.playback?.type !== 'official-embed') add('playback_not_authorized');
  return {
    eligible: reasons.length === 0, reasons, labels: reasons.map((r) => REJECTION_LABELS[r]),
    recordedAt, recordingTimeSource: rt?.sourceVerified ? rt.field || null : null,
    recordingTimePrecision: rt?.precision || 'unknown', measurement,
    window, policyVersion: EVIDENCE_POLICY_VERSION,
    freshness: reasons.length ? 'UNVERIFIED' : window.mode === 'historical' ? 'HISTORICAL' : 'RECENT',
  };
}
