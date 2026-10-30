/**
 * Scene evidence — browser-side state reducer, scene cache and share links.
 * Pure (storage is injected), so it is unit-testable without a DOM.
 */
import {
  rankEvidence,
  dedupeEvidence,
  refreshFreshness,
  sanitizeForCache,
  diffEvidence,
  evidenceKey,
  filterEvidence,
} from './model.js';

export const CACHE_STORAGE_KEY = 'gev.sceneEvidence.v2';
export const CACHE_MAX = 24;

export function initialState(request = {}) {
  return {
    request,
    key: evidenceKey({
      sceneId: request.sceneId,
      place: request.place || request.text,
      lat: request.lat,
      lon: request.lon,
      radiusKm: request.radiusKm,
      windowHours: request.windowHours, text: request.text, timeMode: request.timeMode, windowStart: request.windowStart, windowEnd: request.windowEnd,
    }),
    phase: 'idle', // idle | streaming | done | cached | error | timeout
    place: request.place || '',
    aliases: [],
    engine: null,
    sources: [],
    items: [],
    candidates: [],
    transport: [],
    totals: null,
    window: null,
    requestId: request.requestId || null,
    snapshotAt: null,
    signals: [],
    summary: null,
    timings: {},
    client: {
      startedAt: null,
      firstCardMs: null,
      firstSignalMs: null,
      firstProviderResultMs: null,
      doneMs: null,
    },
    selectedId: null,
    filters: { precisions: [], freshness: [] },
    diff: null,
    cachedAt: null,
    error: null,
  };
}

function upsert(list, item) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, item];
  const next = list.slice();
  next[i] = { ...list[i], ...item };
  return next;
}

/** Apply one SSE event. Returns a NEW state object. */
export function applyEvent(state, event, data, nowMs = Date.now()) {
  if (state.requestId && data?.requestId && data.requestId !== state.requestId) return state;
  const s = { ...state };
  const since = () => (s.client.startedAt ? nowMs - s.client.startedAt : null);
  switch (event) {
    case 'plan':
      s.phase = 'streaming';
      s.window = data.window || s.window;
      s.requestId = data.requestId || s.requestId;
      s.serverKey = data.key || null;
      s.place = data.place || s.place;
      s.aliases = data.aliases || [];
      s.engine = data.engine || null;
      s.sources = (data.sources || []).map((x) => ({ ...x }));
      break;
    case 'transport':
      s.transport = [...s.transport, data];
      break;
    case 'candidate':
      s.candidates = rankEvidence(upsert(s.candidates, data));
      break;
    case 'source': {
      const i = s.sources.findIndex((x) => x.id === data.id);
      s.sources =
        i === -1
          ? [...s.sources, data]
          : s.sources.map((x, k) => (k === i ? { ...x, ...data } : x));
      break;
    }
    case 'item':
      if (data.eligible !== true) { s.candidates = rankEvidence(upsert(s.candidates, data)); break; }
      s.items = rankEvidence(upsert(s.items, data));
      if (s.client.firstCardMs === null)
        s.client = { ...s.client, firstCardMs: since() };
      break;
    case 'signal':
      if (!s.signals.some((x) => x.id === data.id))
        s.signals = [...s.signals, data].sort(
          (a, b) =>
            (Date.parse(b.publishedAt || 0) || 0) -
            (Date.parse(a.publishedAt || 0) || 0),
        );
      if (s.client.firstSignalMs === null)
        s.client = { ...s.client, firstSignalMs: since() };
      break;
    case 'summary':
      s.summary = data;
      break;
    case 'done':
    case 'cached':
      s.phase = event === 'cached' ? 'cached' : 'done';
      s.items = rankEvidence(dedupeEvidence(data.items || s.items)).filter((x) => x.eligible === true);
      s.candidates = rankEvidence(data.candidates || s.candidates);
      s.totals = data.totals || s.totals;
      s.window = data.window || s.window;
      s.transport = data.transport || s.transport;
      s.signals = data.signals || s.signals;
      s.sources = data.sources || s.sources;
      s.summary = data.summary || s.summary;
      s.timings = data.timings || {};
      s.cachedAt = data.cachedAt || null;
      s.place = data.place || s.place;
      s.serverKey = data.key || s.serverKey || null;
      s.client = { ...s.client, doneMs: since() };
      break;
    case 'error':
      s.phase = 'error';
      s.error = String(data?.error || data || 'error');
      break;
    case 'timeout':
      s.phase = 'timeout';
      s.error = String(data?.error || 'timed out');
      break;
    default:
      return state;
  }
  return s;
}

export function visibleItems(state) {
  return filterEvidence(state.items, state.filters);
}

export function toggleFilter(state, kind, value) {
  const cur = new Set(state.filters[kind] || []);
  if (cur.has(value)) cur.delete(value);
  else cur.add(value);
  return { ...state, filters: { ...state.filters, [kind]: [...cur] } };
}

// ---------------------------------------------------------------- scene cache (localStorage)
function readAll(storage) {
  try {
    const raw = storage?.getItem?.(CACHE_STORAGE_KEY);
    const j = raw ? JSON.parse(raw) : {};
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}
function writeAll(storage, all) {
  try {
    storage?.setItem?.(CACHE_STORAGE_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/** Persist a finished result for a scene (Instagram metadata stripped). */
export function saveSceneEvidence(storage, state, nowMs = Date.now()) {
  if (!state?.key || !['done', 'cached'].includes(state.phase)) return false;
  const all = readAll(storage);
  all[state.key] = {
    at: nowMs,
    request: state.request,
    place: state.place,
    items: state.items.map(sanitizeForCache),
    candidates: state.candidates.map(sanitizeForCache),
    signals: state.signals,
    sources: state.sources,
    summary: state.summary,
    timings: state.timings,
  };
  const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
  for (const k of keys.slice(CACHE_MAX)) delete all[k];
  return writeAll(storage, all);
}

/** Load a cached result (freshness re-derived against `now`). */
export function loadSceneEvidence(storage, key, now = new Date()) {
  const e = readAll(storage)[key];
  if (!e) return null;
  return {
    ...e,
    items: rankEvidence(refreshFreshness(e.items || [], now, e.request || {})),
    cachedAt: new Date(e.at).toISOString(),
  };
}

export function listCachedScenes(storage) {
  const all = readAll(storage);
  return Object.entries(all)
    .map(([key, v]) => ({
      key,
      place: v.place,
      at: v.at,
      items: v.items?.length || 0,
    }))
    .sort((a, b) => b.at - a.at);
}

/** Diff a fresh rebuild against the cached version of the same scene. */
export function diffAgainstCache(storage, state) {
  const prev = readAll(storage)[state.key];
  if (!prev) return null;
  return {
    ...diffEvidence(prev.items || [], state.items),
    cachedAt: new Date(prev.at).toISOString(),
  };
}

// ---------------------------------------------------------------- share links
export function encodeShare(request = {}) {
  const r = {
    p: String(request.place || request.text || '').slice(0, 80),
    a: Number.isFinite(request.lat) ? +request.lat.toFixed(5) : undefined,
    o: Number.isFinite(request.lon) ? +request.lon.toFixed(5) : undefined,
    w: Number.isFinite(request.windowHours) ? request.windowHours : undefined,
    m: request.timeMode, b: request.windowStart, e: request.windowEnd,
    s: request.sceneId ? String(request.sceneId).slice(0, 160) : undefined,
  };
  return encodeURIComponent(JSON.stringify(r));
}
export function decodeShare(param) {
  try {
    const r = JSON.parse(decodeURIComponent(String(param || '')));
    if (!r || typeof r.p !== 'string' || !r.p.trim()) return null;
    const lat = Number(r.a);
    const lon = Number(r.o);
    const ok =
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180;
    return {
      place: r.p.slice(0, 80),
      lat: ok ? lat : undefined,
      lon: ok ? lon : undefined,
      windowHours: Number.isFinite(Number(r.w))
        ? Math.max(1, Math.min(168, Number(r.w)))
        : 1,
      ...(r.m === 'historical' ? { timeMode: 'historical', windowStart: r.b, windowEnd: r.e } : {}),
      sceneId: typeof r.s === 'string' ? r.s.slice(0, 160) : undefined,
    };
  } catch {
    return null;
  }
}
