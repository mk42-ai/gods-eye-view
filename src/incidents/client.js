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

/** Keep long prompt instructions out of the geocoder, without losing a named
 * supported landmark that appears later in the prompt. Full text still goes to the LLM. */
export function locationQueryForPrompt(value) {
  const text = String(value || '')
    .trim()
    .slice(0, 6000);
  const explicit = text.match(/^\s*(?:location|place)\s*:\s*([^\r\n]+)/im);
  if (explicit) return explicit[1].trim();
  const known = [
    ...text.matchAll(
      /\b(?:Burj Khalifa|Umm[\s-]+Suq(?:eim|aim)|Dubai Marina)\b/gi,
    ),
  ].map((m) => m[0]);
  if (new Set(known.map((s) => s.toLowerCase())).size === 1) return known[0];
  return text.split(/\r?\n/)[0];
}

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
  async function call(path, init = {}, prefix = base) {
    const res = await fetchImpl(`${prefix}${path}`, {
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
      // Platform errors may nest {error:{code,message}}; never show "[object Object]".
      const nested =
        body?.error && typeof body.error === 'object'
          ? body.error.message || body.error.code
          : null;
      const err = new Error(
        String(
          nested ||
            (typeof body?.error === 'string' ? body.error : '') ||
            body?.message ||
            `HTTP ${res.status}`,
        ),
      );
      err.status = res.status;
      err.body = body;
      throw err;
    }
    if (!body || typeof body !== 'object')
      throw new Error('Invalid server response. Please retry the AOI request.');
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
    constructScene: (payload, { signal } = {}) =>
      call(
        '/scene-plans/construct',
        {
          method: 'POST',
          body: JSON.stringify(payload),
          signal,
        },
        V2_BASE,
      ),
    constructSceneStream: async (
      payload,
      {
        signal,
        onEvent = () => {},
        onHeartbeat = () => {},
        lastEventId = null,
      } = {},
    ) => {
      const reqHeaders = {
        ...headers(),
        Accept: 'text/event-stream',
        ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
      };
      const res = await fetchImpl(`${V2_BASE}/scene-plans/construct/stream`, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify({
          ...payload,
          ...(lastEventId ? { lastEventId } : {}),
        }),
        signal,
      });
      if (!res.ok) {
        let errBody = null;
        try {
          errBody = await res.json();
        } catch {}
        const nested =
          errBody?.error && typeof errBody.error === 'object'
            ? errBody.error.message || errBody.error.code
            : null;
        const err = new Error(
          String(
            nested ||
              (typeof errBody?.error === 'string' ? errBody.error : '') ||
              errBody?.message ||
              `HTTP ${res.status}`,
          ),
        );
        err.status = res.status;
        err.body = errBody;
        throw err;
      }
      const contentType = res.headers?.get?.('content-type') || '';
      if (
        contentType &&
        !contentType.includes('text/event-stream') &&
        !contentType.includes('text/plain')
      ) {
        const err = new Error('Non-SSE response received from stream endpoint');
        err.code = 'non_sse_response';
        throw err;
      }
      const decoder = new TextDecoder();
      let buffer = '';
      let completedResult = null;

      let activeReader = null;
      const onAbort = () => {
        try {
          activeReader?.cancel?.();
        } catch {}
      };
      signal?.addEventListener?.('abort', onAbort, { once: true });

      const readIterator = async function* () {
        if (res.body?.getReader) {
          const reader = res.body.getReader();
          activeReader = reader;
          try {
            while (true) {
              if (signal?.aborted) break;
              const { done, value } = await reader.read();
              if (done) break;
              yield value;
            }
          } finally {
            activeReader = null;
            reader.releaseLock?.();
          }
        } else if (res.body && res.body[Symbol.asyncIterator]) {
          for await (const chunk of res.body) {
            if (signal?.aborted) break;
            yield chunk;
          }
        }
      };

      try {
        for await (const chunk of readIterator()) {
          if (signal?.aborted) {
            const err = new Error('Request cancelled.');
            err.name = 'AbortError';
            throw err;
          }
          buffer +=
            typeof chunk === 'string'
              ? chunk
              : decoder.decode(chunk, { stream: true });
          const parts = buffer.split(/\r?\n\r?\n/);
          buffer = parts.pop() || '';
          for (const block of parts) {
            if (!block.trim()) continue;
            if (signal?.aborted) {
              const err = new Error('Request cancelled.');
              err.name = 'AbortError';
              throw err;
            }
            const lines = block.split(/\r?\n/);
            let event = 'message';
            let id = null;
            const dataLines = [];
            for (const line of lines) {
              if (!line || line.startsWith(':')) continue;
              if (line.startsWith('id:')) id = line.slice(3).trim();
              else if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) {
                let d = line.slice(5);
                if (d.startsWith(' ')) d = d.slice(1);
                dataLines.push(d);
              }
            }
            if (dataLines.length === 0 && !id && event === 'message') {
              // Comment-only block (": heartbeat"): the server is alive and
              // still working — liveness, not an event.
              if (lines.some((line) => line.startsWith(':')))
                try {
                  onHeartbeat();
                } catch {}
              continue;
            }
            const rawData = dataLines.join('\n');
            let parsedData = rawData;
            try {
              parsedData = JSON.parse(rawData);
            } catch {}
            const eventObj = { id, event, data: parsedData, raw: rawData };
            if (signal?.aborted) {
              const err = new Error('Request cancelled.');
              err.name = 'AbortError';
              throw err;
            }
            onEvent(eventObj);
            if (event === 'done') {
              completedResult = parsedData?.result || parsedData;
              return completedResult;
            }
            if (event === 'error') {
              const err = new Error(
                parsedData?.message || parsedData?.code || 'Stream error',
              );
              err.code = parsedData?.code || 'stream_error';
              err.details = parsedData;
              throw err;
            }
            if (event === 'resume_unavailable') {
              const err = new Error('Session resume unavailable');
              err.code = 'resume_unavailable';
              err.details = parsedData;
              throw err;
            }
          }
        }
      } finally {
        signal?.removeEventListener?.('abort', onAbort);
      }
      return completedResult;
    },
    narrateScene: (payload, { signal } = {}) =>
      call(
        '/scene-plans/narration',
        {
          method: 'POST',
          body: JSON.stringify(payload),
          signal,
        },
        V2_BASE,
      ),
    locate: (text, { signal } = {}) =>
      call('/locate', {
        method: 'POST',
        // A multiline scene prompt uses its first line as the location query;
        // the complete prompt is sent unchanged to the scene planner later.
        body: JSON.stringify({
          text: locationQueryForPrompt(text),
          externalUserId,
        }),
        signal,
      }),
    search: (text, candidate, { signal } = {}) =>
      call('/search', {
        method: 'POST',
        body: JSON.stringify({ text, candidate, externalUserId }),
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

const SAME_PLACE_KM = 0.25;
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
