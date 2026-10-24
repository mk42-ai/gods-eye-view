/**
 * Incident client — the browser's only path to the incident ledger.
 * Talks to /api/ondemand/v2/incidents/* (same-origin, server key only) and
 * exposes pure helpers the composer + overlay share. No Cesium, no DOM.
 */
import {
  V2_BASE,
  resolveExternalUserId,
  resolveWorkspace,
} from '../ondemand/miniChat.js';

export const INCIDENTS_BASE = `${V2_BASE}/incidents`;
export const INCIDENT_EVENTS = Object.freeze({
  listChanged: 'gev:incidents-changed',
  sceneBuilt: 'gev:incident-scene-built',
});

export function createIncidentClient({
  fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = globalThis.localStorage,
  base = INCIDENTS_BASE,
} = {}) {
  const workspace = resolveWorkspace(storage);
  const externalUserId = resolveExternalUserId(storage, { workspace });
  const headers = () => ({
    'Content-Type': 'application/json',
    'X-Workstation-User': externalUserId,
    'X-Workstation-Workspace': workspace,
  });
  async function call(path, init = {}) {
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers: { ...headers(), ...(init.headers || {}) },
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const err = new Error(
        body?.error || body?.message || `HTTP ${res.status}`,
      );
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }
  return {
    externalUserId,
    workspace,
    list: (aoi = 'all') =>
      call(
        `/list?aoi=${encodeURIComponent(aoi)}&externalUserId=${encodeURIComponent(externalUserId)}`,
      ),
    aoi: () => call('/aoi'),
    locate: (text, { signal } = {}) =>
      call('/locate', {
        method: 'POST',
        body: JSON.stringify({ text, externalUserId }),
        signal,
      }),
    ingest: (incident, { signal } = {}) =>
      call('/ingest', {
        method: 'POST',
        body: JSON.stringify({ externalUserId, incident }),
        signal,
      }),
    refresh: ({ signal } = {}) =>
      call('/refresh', { method: 'POST', body: '{}', signal }),
  };
}

/** Status chip sequence the composer streams while it works. */
export const COMPOSER_STEPS = Object.freeze([
  { id: 'locating', label: 'locating' },
  { id: 'verifying', label: 'verifying AOI' },
  { id: 'building', label: 'building scene' },
]);

const SAME_PLACE_KM = 15;
function nearKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Decide what the composer should do with a /locate response. */
export function planFromCandidates(candidates = []) {
  if (!candidates.length) return { kind: 'none' };
  const sorted = [...candidates].sort(
    (a, b) => (b.confidence || 0) - (a.confidence || 0),
  );
  const best = sorted[0];
  // Candidates that all describe the same place (within 15 km) are one choice.
  const samePlace = sorted.every((c) => nearKm(best, c) <= SAME_PLACE_KM);
  if (sorted.length === 1 || samePlace)
    return best.aoi_membership?.inside
      ? { kind: 'single', candidate: best }
      : { kind: 'out-of-aoi', candidate: best, reason: best.reason };
  return { kind: 'pick', candidates: sorted };
}

/** Build the raw incident the composer ingests from the typed text + chosen candidate. */
export function incidentFromText(
  text,
  candidate,
  { now = new Date(), override = false } = {},
) {
  const trimmed = String(text || '').trim();
  return {
    title: trimmed.slice(0, 160),
    summary: trimmed,
    category: trimmed,
    lat: candidate.lat,
    lon: candidate.lon,
    place: candidate.name,
    time_utc: now.toISOString(),
    actors: [],
    impact: '',
    sources: [],
    confidence: 'unverified',
    provenance: `operator composer (${candidate.source || 'locate'})`,
    ...(override ? { override: true } : {}),
  };
}

/** Object context for the ASK ONDEMAND mini chat, carrying incident provenance. */
export function incidentChatContext(scene, incident, { aoi } = {}) {
  const sources = (incident?.sources || scene?.incident?.sources || []).slice(
    0,
    10,
  );
  return {
    objectType: 'alert',
    objectId: String(
      incident?.id || scene?.incident?.incident_ids?.[0] || scene?.id,
    ),
    label: incident?.title || scene?.title,
    position: incident ? { lat: incident.lat, lon: incident.lon } : null,
    timeWindow: incident?.time_utc
      ? { start: incident.time_utc, end: incident.time_utc }
      : null,
    fields: {
      incident_id: incident?.id,
      scene_id: scene?.id,
      aoi: incident?.aoi || scene?.incident?.aoi || aoi || null,
      category: incident?.category || scene?.incident?.category,
      confidence: incident?.confidence,
      summary: incident?.summary,
      place: incident?.place,
      actors: incident?.actors,
      impact: incident?.impact,
      time_utc: incident?.time_utc,
      aoi_reason: incident?.aoi_membership?.reason,
    },
    sourceRefs: sources.map((s) => ({
      url: s.url,
      published_at: s.published_at || null,
    })),
    provenance: incident?.provenance || 'incident ledger',
  };
}
