/**
 * UAE AOI incidents — shared, dependency-free incident model used by the
 * serverless /api/incidents routes, the SCENES panel and the bottom incident
 * composer. Everything here is pure (no DOM, no Node builtins, no fetch).
 *
 * Incident shape (src/data/local_data/uae-aoi/uae-aoi-seed-incidents.json):
 *   { id, headline, country, group, aoi_id, lat, lon, incident_type,
 *     severity: LOW|MEDIUM|HIGH|CRITICAL, event_time_utc (ISO 8601 UTC),
 *     summary, source_url, source_name,
 *     camera: { ona_deg, altitude_m, mode:'NORMAL', labels:'OFF', dwell_in_s, dwell_hold_s } }
 */
import SEED from './local_data/uae-aoi/uae-aoi-seed-incidents.json' with { type: 'json' };
import {
  UAE_AOI_GROUP_IDS,
  UAE_AOI_GROUP_LABELS,
  findAoiForPoint,
  getAoi,
  summariseAoi,
} from './uaeAoi.js';

export const SEVERITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DEDUPE_GRID_DEG = 0.1;
const MAX_TEXT = 2048;

/** Frozen copy of the shipped seed incidents (never mutated by callers). */
export function seedIncidents() {
  return (SEED.incidents || []).map((incident) => normaliseIncident(incident));
}

export const SEED_GENERATED_UTC = SEED.generated_utc || null;

function clampText(value, max = MAX_TEXT) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Normalise a free-form severity string to one of SEVERITIES (default MEDIUM). */
export function normaliseSeverity(value) {
  const s = String(value || '')
    .trim()
    .toUpperCase();
  if (SEVERITIES.includes(s)) return s;
  if (/CRIT|SEVERE|EXTREME/.test(s)) return 'CRITICAL';
  if (/HIGH|MAJOR/.test(s)) return 'HIGH';
  if (/LOW|MINOR|INFO/.test(s)) return 'LOW';
  return 'MEDIUM';
}

/** ISO-8601 UTC string or null (never a guessed date). */
export function toIsoUtc(value) {
  if (value === undefined || value === null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Stable headline key: lowercase, punctuation/stop-words stripped, tokens sorted. */
export function normaliseHeadline(text) {
  const stop = new Set([
    'a',
    'an',
    'the',
    'of',
    'in',
    'on',
    'at',
    'to',
    'and',
    'for',
    'by',
    'with',
    'after',
    'near',
    'off',
    'as',
    'from',
  ]);
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !stop.has(token))
    .sort()
    .join(' ');
}

/** Round a coordinate onto the dedupe grid (0.1° by default). */
export function gridCell(lat, lon, step = DEDUPE_GRID_DEG) {
  const r = (v) => (Math.round(Number(v) / step) * step).toFixed(1);
  return `${r(lat)},${r(lon)}`;
}

/** Dedupe key = normalised headline + 0.1° cell (the 24 h window is applied by dedupeIncidents). */
export function dedupeKey(incident) {
  return `${normaliseHeadline(incident.headline)}|${gridCell(incident.lat, incident.lon)}`;
}

/**
 * Collapse duplicates: same dedupe key AND event times within 24 h keep the
 * earliest-ingested record (the first in input order). Records whose key
 * matches but whose event times are more than 24 h apart are both kept.
 * @param {Array<object>} incidents
 * @returns {{kept: Array<object>, dropped: Array<object>}}
 */
export function dedupeIncidents(incidents) {
  const kept = [];
  const dropped = [];
  const byKey = new Map();
  for (const incident of incidents || []) {
    const key = dedupeKey(incident);
    const time = new Date(incident.event_time_utc || 0).getTime();
    const existing = byKey.get(key) || [];
    const duplicate = existing.find(
      (other) => Math.abs(other.time - time) <= DEDUPE_WINDOW_MS,
    );
    if (duplicate) {
      dropped.push({ ...incident, duplicateOf: duplicate.incident.id });
      continue;
    }
    existing.push({ time, incident });
    byKey.set(key, existing);
    kept.push(incident);
  }
  return { kept, dropped };
}

/** Deterministic id from the dedupe key (no randomness, safe across instances). */
export function incidentIdFor(incident) {
  const key = `${dedupeKey(incident)}|${(incident.event_time_utc || '').slice(0, 13)}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `inc-${h.toString(16).padStart(8, '0')}`;
}

/** Camera preset scaled to the AOI radius (ONA 35–65°, altitude 8–120 km). */
export function cameraPresetFor({ aoiId, severity, radiusKm } = {}) {
  const aoi = aoiId ? getAoi(aoiId) : null;
  const radius = Number(radiusKm) || Number(aoi?.properties?.radius_km) || 30;
  const altitude = Math.round(
    Math.min(120_000, Math.max(8_000, radius * 1800)),
  );
  const ona = Math.round(
    Math.min(65, Math.max(35, 65 - Math.log10(Math.max(1, radius)) * 10)),
  );
  const hold =
    severity === 'CRITICAL'
      ? 14
      : severity === 'HIGH'
        ? 12
        : severity === 'LOW'
          ? 9
          : 10;
  return {
    ona_deg: ona,
    altitude_m: altitude,
    mode: 'NORMAL',
    labels: 'OFF',
    dwell_in_s: Math.min(5, Math.max(3.5, 3.5 + radius / 120)),
    dwell_hold_s: hold,
  };
}

/**
 * Validate + normalise an incident payload (ingest or seed). Throws
 * `IncidentValidationError` with `.field` on a hard error; fills group /
 * country / aoi_id from the AOI polygon that contains the point when absent.
 */
export class IncidentValidationError extends Error {
  constructor(field, message) {
    super(`${field}: ${message}`);
    this.name = 'IncidentValidationError';
    this.field = field;
  }
}

export function normaliseIncident(raw, { now = () => new Date() } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new IncidentValidationError('incident', 'object required');
  const headline = clampText(raw.headline, 512);
  if (!headline)
    throw new IncidentValidationError('headline', 'non-empty text required');
  const lat = finiteOrNull(raw.lat);
  const lon = finiteOrNull(raw.lon);
  if (lat === null || lon === null)
    throw new IncidentValidationError('lat/lon', 'finite numbers required');
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180)
    throw new IncidentValidationError('lat/lon', 'out of range');
  const match = findAoiForPoint(lat, lon);
  const group = String(raw.group || match?.group || '').toUpperCase();
  if (group && !UAE_AOI_GROUP_IDS.includes(group))
    throw new IncidentValidationError(
      'group',
      `one of ${UAE_AOI_GROUP_IDS.join(', ')}`,
    );
  const event_time_utc = toIsoUtc(raw.event_time_utc) || toIsoUtc(now());
  const camera = {
    ...cameraPresetFor({
      aoiId: raw.aoi_id || match?.id,
      severity: normaliseSeverity(raw.severity),
    }),
    ...(raw.camera && typeof raw.camera === 'object'
      ? Object.fromEntries(
          Object.entries(raw.camera).filter(
            ([k, v]) =>
              [
                'ona_deg',
                'altitude_m',
                'mode',
                'labels',
                'dwell_in_s',
                'dwell_hold_s',
              ].includes(k) && v !== undefined,
          ),
        )
      : {}),
  };
  const incident = {
    id: clampText(raw.id, 96) || null,
    headline,
    country: clampText(raw.country || match?.country || '', 64),
    group: group || null,
    aoi_id: clampText(raw.aoi_id || match?.id || '', 96) || null,
    lat,
    lon,
    incident_type: clampText(raw.incident_type || 'unclassified', 96),
    severity: normaliseSeverity(raw.severity),
    event_time_utc,
    summary: clampText(raw.summary, MAX_TEXT),
    source_url: safeUrl(raw.source_url),
    source_name: clampText(raw.source_name, 160),
    camera,
    ...(raw.ingested_at ? { ingested_at: toIsoUtc(raw.ingested_at) } : {}),
    ...(raw.provenance && typeof raw.provenance === 'object'
      ? { provenance: raw.provenance }
      : {}),
    insideAoi: !!match,
    ...(match ? { matchedAoi: summariseAoi(match) } : {}),
  };
  if (!incident.id) incident.id = incidentIdFor(incident);
  return incident;
}

export function safeUrl(value) {
  const text = clampText(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Counts per group (always lists every group, zero-filled). */
export function countsByGroup(incidents) {
  const counts = Object.fromEntries(UAE_AOI_GROUP_IDS.map((g) => [g, 0]));
  for (const incident of incidents || [])
    if (incident.group in counts) counts[incident.group] += 1;
  return counts;
}

/**
 * Live "time since event" label from an ISO timestamp — `3m`, `5h`, `12d`,
 * `3mo`, `2y`; `now` for < 60 s; `—` when the timestamp is unknown; `future`
 * when the event is ahead of the clock.
 */
export function timeSince(eventTimeUtc, now = Date.now()) {
  const t = new Date(eventTimeUtc || NaN).getTime();
  if (!Number.isFinite(t)) return '—';
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const delta = nowMs - t;
  if (delta < 0) return 'future';
  const s = Math.floor(delta / 1000);
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 60) return `${d}d`;
  const mo = Math.floor(d / 30.44);
  if (mo < 24) return `${mo}mo`;
  return `${Math.floor(d / 365.25)}y`;
}

/** Heading for the first incident bearing on nothing in particular — a stable, deterministic yaw from the id. */
function headingFor(id) {
  let h = 0;
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (h - 180) % 60;
}

/** Card metadata carried by an incident shot (validated by src/director/document.js). */
export function incidentCardFor(incident) {
  return {
    id: incident.id,
    country: incident.country || null,
    group: incident.group || null,
    aoi_id: incident.aoi_id || null,
    incident_type: incident.incident_type || null,
    severity: incident.severity,
    event_time_utc: incident.event_time_utc,
    source_url: incident.source_url || null,
    source_name: incident.source_name || null,
    summary: incident.summary || null,
    lat: Number(incident.lat),
    lon: Number(incident.lon),
    insideAoi: incident.insideAoi !== false,
  };
}

/**
 * Convert an incident into one SCENES-panel shot. The shot title is the
 * headline, the preset line stays `NORMAL · OFF · 4.2s + 13.0s`, and the
 * incident metadata rides in `shot.incident` for the card chips.
 */
export function incidentToShot(incident, { shotId } = {}) {
  const cam = incident.camera || cameraPresetFor({ aoiId: incident.aoi_id });
  const ona = Number(cam.ona_deg) || 50;
  return {
    id: shotId || `shot-${incident.id}`,
    title: incident.headline,
    durationSec: Number(cam.dwell_in_s) || 4.2,
    holdSec: Number(cam.dwell_hold_s) || 13,
    camera: {
      lat: Number(incident.lat),
      lon: Number(incident.lon),
      alt: Number(cam.altitude_m) || 30000,
      heading: headingFor(incident.id),
      pitch: -(90 - ona),
      roll: 0,
    },
    visual: {
      style: 'normal',
      detection: { mode: String(cam.labels || 'OFF').toUpperCase() },
      hud: { visible: true, variant: 'tactical' },
    },
    layers: {},
    incident: incidentCardFor(incident),
  };
}

/** Scene id/title for an incident group (one scene per AOI group). */
export function groupSceneFor(group) {
  const id = UAE_AOI_GROUP_IDS.includes(group) ? group : 'OUTSIDE_AOI';
  return {
    id: `uae-aoi-${id.toLowerCase().replace(/_/g, '-')}`,
    title: id === 'OUTSIDE_AOI' ? 'OUTSIDE UAE AOI' : UAE_AOI_GROUP_LABELS[id],
    group: id,
  };
}

/**
 * Build the UAE AOI scene library: one scene per group, one shot per
 * incident, newest event first. Groups without incidents still get an
 * (empty) scene so the dropdown always lists all four.
 */
export function incidentsToScenes(incidents) {
  const scenes = new Map();
  for (const group of UAE_AOI_GROUP_IDS) {
    const meta = groupSceneFor(group);
    scenes.set(meta.id, {
      id: meta.id,
      title: meta.title,
      releaseLayerIds: [],
      appliedShotPacks: [],
      shots: [],
    });
  }
  const sorted = [...(incidents || [])].sort((a, b) =>
    String(b.event_time_utc || '').localeCompare(
      String(a.event_time_utc || ''),
    ),
  );
  for (const incident of sorted) {
    const meta = groupSceneFor(incident.group);
    if (!scenes.has(meta.id))
      scenes.set(meta.id, {
        id: meta.id,
        title: meta.title,
        releaseLayerIds: [],
        appliedShotPacks: [],
        shots: [],
      });
    scenes.get(meta.id).shots.push(incidentToShot(incident));
  }
  return [...scenes.values()];
}
