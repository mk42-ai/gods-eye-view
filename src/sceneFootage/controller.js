/**
 * Scene footage controller (browser, DOM-free, unit-testable).
 *
 * One active scene at a time. Every open() bumps a generation token and aborts
 * the previous request (AbortController); a response is applied only when its
 * generation AND locationId still match the active scene, so a slow reply for
 * scene A can never overwrite scene B (rapid A→B→A→C switching).
 *
 * Refresh: a timer re-queries the active scene every `refreshMs` (UI control,
 * clamped to the server's minimum), pauses while document.hidden, keeps the
 * currently playing clip untouched and merges new clips without duplicates.
 */
import { locationIdFor } from './places.js';

export const FOOTAGE_URL = (locationId) =>
  `/api/scenes/${encodeURIComponent(locationId)}/footage/snapchat`;
export const REFRESH_CHOICES_MS = Object.freeze([
  30_000, 60_000, 120_000, 300_000, 0,
]);

export function formatAgo(iso, nowMs) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 48 * 3600) return `${Math.round(s / 3600)}h ago`;
  if (s < 60 * 86400) return `${Math.round(s / 86400)}d ago`;
  if (s < 730 * 86400) return `${Math.round(s / (30.44 * 86400))}mo ago`;
  return `${Math.round(s / (365.25 * 86400))}y ago`;
}
export const utcStamp = (iso) =>
  Number.isFinite(Date.parse(iso || ''))
    ? `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : null;

/** Honest timestamp lines for one clip — never substitutes one time for another. */
export function clipTimeLines(clip, nowMs) {
  const pub = clip.publicationTime
    ? `published ${formatAgo(clip.publicationTime, nowMs)} (${utcStamp(clip.publicationTime)})`
    : 'publication time unknown';
  const cap = clip.captureTime
    ? `captured ${formatAgo(clip.captureTime, nowMs)} (${utcStamp(clip.captureTime)})`
    : 'capture time unknown';
  const ret = `retrieved ${formatAgo(clip.retrievalTime, nowMs) || 'unknown'}`;
  const live =
    clip.isLive === true && clip.liveConfirmedBy ? 'LIVE' : 'not live';
  return { pub, cap, ret, live };
}

export function mergeClips(current, incoming, { selectedId } = {}) {
  const byId = new Map(current.map((c) => [c.id, c]));
  const blob = (u) => {
    try {
      const x = new URL(u);
      return x.origin + x.pathname;
    } catch {
      return u;
    }
  };
  // Near-identical re-upload key — mirrors server nearDuplicateKey().
  const near = (c) => {
    const text = String(c?.caption || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '');
    return text.length >= 12 && Number.isFinite(c?.durationMs)
      ? `n:${text.slice(0, 160)}|${Math.round(c.durationMs / 1000)}`
      : null;
  };
  const known = new Set(
    current.flatMap((c) =>
      [
        c.id,
        c.sourceUrl,
        c.mediaHash,
        c.mediaUrl && blob(c.mediaUrl),
        near(c),
      ].filter(Boolean),
    ),
  );
  let added = 0;
  for (const c of incoming) {
    if (byId.has(c.id)) {
      const prev = byId.get(c.id);
      // Fresh SAS links / metrics for clips that are NOT playing; the playing clip keeps its element + src.
      byId.set(
        c.id,
        c.id === selectedId
          ? {
              ...c,
              mediaUrl: prev.mediaUrl,
              mediaExpiresAt: prev.mediaExpiresAt,
            }
          : c,
      );
      continue;
    }
    const keys = [
      c.sourceUrl,
      c.mediaHash,
      c.mediaUrl && blob(c.mediaUrl),
      near(c),
    ].filter(Boolean);
    if (keys.some((k) => known.has(k))) continue;
    keys.forEach((k) => known.add(k));
    byId.set(c.id, c);
    added += 1;
  }
  const merged = [...byId.values()].sort(
    (a, b) =>
      (Date.parse(b.publicationTime || 0) || 0) -
      (Date.parse(a.publicationTime || 0) || 0),
  );
  return { clips: merged, added };
}

export function createFootageController({
  fetch: fetchImpl = (...a) => globalThis.fetch(...a),
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  document: doc = globalThis.document,
  onChange = () => {},
  defaultRefreshMs = 120_000,
  minRefreshMs = 30_000,
} = {}) {
  let generation = 0;
  let abort = null;
  let timer = null;
  let destroyed = false;
  const listeners = new Set([onChange]);
  const initial = () => ({
    phase: 'idle',
    scene: null,
    locationId: null,
    generation,
    clips: [],
    selectedId: null,
    coverageLevel: null,
    coverageLabel: null,
    expanded: false,
    retrievalTime: null,
    lastCheckedAt: null,
    error: null,
    message: null,
    refreshMs: defaultRefreshMs,
    minRefreshMs,
    refreshCount: 0,
    paused: false,
    expiredRetried: [],
    ladder: [],
    requestedLabel: null,
    trigger: null,
    history: [],
    userRefresh: false,
  });
  let state = initial();
  const emit = () => {
    for (const fn of listeners)
      try {
        fn(state);
      } catch {
        /* listener errors are isolated */
      }
  };
  const set = (patch) => {
    state = { ...state, ...patch };
    emit();
  };

  const hidden = () => Boolean(doc?.hidden);
  function schedule() {
    clearTimer(timer);
    timer = null;
    if (destroyed || !state.scene || !state.refreshMs) return;
    timer = setTimer(
      () => {
        if (hidden()) {
          set({ paused: true });
          return;
        } // resumed by visibilitychange
        void request({ refresh: true });
      },
      Math.max(state.refreshMs, state.minRefreshMs),
    );
  }
  const onVisibility = () => {
    if (!state.scene) return;
    if (hidden()) {
      clearTimer(timer);
      timer = null;
      set({ paused: true });
    } else {
      set({ paused: false });
      schedule();
    }
  };
  doc?.addEventListener?.('visibilitychange', onVisibility);

  async function request({
    refresh = false,
    fresh = false,
    reason = null,
  } = {}) {
    const scene = state.scene;
    if (!scene) return null;
    const run = generation;
    abort?.abort();
    const ctl = new AbortController();
    abort = ctl;
    if (!refresh) set({ phase: 'loading', error: null, message: null });
    else set({ refreshing: true });
    const body = {
      locationId: state.locationId,
      lat: scene.lat,
      lon: scene.lon,
      placeName: scene.placeName || null,
      bbox: scene.bbox || null,
      clientTimeIso: new Date(now()).toISOString(),
      fresh: fresh || refresh,
    };
    let res, json;
    try {
      res = await fetchImpl(FOOTAGE_URL(state.locationId), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      json = await res.json().catch(() => null);
    } catch (error) {
      if (ctl.signal.aborted || run !== generation) return null;
      set({
        phase: state.clips.length ? 'ready' : 'plugin_error',
        refreshing: false,
        error: 'network_error',
        message: 'Footage request failed (network).',
      });
      schedule();
      return null;
    }
    // Stale-response guard: generation token AND location identity.
    if (
      run !== generation ||
      ctl.signal.aborted ||
      !json ||
      (json.locationId && json.locationId !== state.locationId)
    ) {
      state.history.push({
        discarded: true,
        generation: run,
        locationId: json?.locationId || null,
      });
      return null;
    }
    const minMs = Number(json.refresh?.minMs) || state.minRefreshMs;
    const base = {
      refreshing: false,
      minRefreshMs: minMs,
      refreshMs: state.userRefresh
        ? state.refreshMs
          ? Math.max(state.refreshMs, minMs)
          : 0
        : Math.max(Number(json.refresh?.defaultMs) || state.refreshMs, minMs),
      lastCheckedAt: json.lastCheckedAt || new Date(now()).toISOString(),
      requestId: json.requestId,
      trace: json.trace || [],
      ladder: json.ladder || state.ladder,
    };
    if (!res.ok || (json.state !== 'ok' && json.state !== 'empty')) {
      const st = json.state || 'plugin_error';
      const keep = refresh && state.clips.length;
      set({
        ...base,
        phase: keep ? 'ready' : st,
        error: json.error || st,
        message: keep
          ? `Refresh failed (${json.error || st}); showing the last results.`
          : null,
      });
      if (st !== 'credentials_required') schedule();
      return json;
    }
    const merged = mergeClips(refresh ? state.clips : [], json.clips || [], {
      selectedId: state.selectedId,
    });
    let selectedId =
      state.selectedId && merged.clips.some((c) => c.id === state.selectedId)
        ? state.selectedId
        : merged.clips[0]?.id || null;
    if (reason === 'expired' && state.selectedId) {
      const fresh1 = (json.clips || []).find((c) => c.id === state.selectedId);
      if (fresh1)
        merged.clips = merged.clips.map((c) =>
          c.id === fresh1.id ? fresh1 : c,
        );
    }
    set({
      ...base,
      phase: merged.clips.length ? 'ready' : 'empty',
      clips: merged.clips,
      selectedId,
      coverageLevel: json.coverageLevel,
      coverageLabel: json.coverageLabel,
      expanded: Boolean(json.expanded),
      retrievalTime: json.retrievalTime,
      cached: Boolean(json.cached),
      emptyReason: json.emptyReason || null,
      refreshCount: state.refreshCount + (refresh ? 1 : 0),
      lastAdded: merged.added,
      error: null,
      message: reason === 'expired' ? 'Media link refreshed.' : null,
    });
    schedule();
    return json;
  }

  const api = {
    get state() {
      return state;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Open (or re-open) a scene. Same locationId + same generation → no-op unless force. */
    open(scene, { trigger = 'api', force = false } = {}) {
      if (
        destroyed ||
        !scene ||
        !Number.isFinite(scene.lat) ||
        !Number.isFinite(scene.lon)
      )
        return null;
      const locationId = scene.locationId || locationIdFor(scene);
      if (
        !force &&
        locationId === state.locationId &&
        state.phase !== 'idle' &&
        !['plugin_error', 'timeout', 'rate_limited'].includes(state.phase)
      )
        return null;
      generation += 1;
      abort?.abort();
      clearTimer(timer);
      timer = null;
      state = {
        ...initial(),
        refreshMs: state.refreshMs,
        userRefresh: state.userRefresh,
        history: state.history,
        scene: { ...scene },
        locationId,
        generation,
        trigger,
        requestedLabel: scene.placeName || null,
      };
      emit();
      return request();
    },
    refresh() {
      return request({ refresh: true });
    },
    select(id) {
      if (state.clips.some((c) => c.id === id)) set({ selectedId: id });
    },
    setRefreshMs(ms) {
      const n = Number(ms);
      set({
        userRefresh: true,
        refreshMs: !n ? 0 : Math.max(n, state.minRefreshMs),
      });
      schedule();
    },
    /** Media element failed. Expired/forbidden SAS → re-fetch ONCE per clip, then report. */
    async mediaFailed(id) {
      const clip = state.clips.find((c) => c.id === id);
      if (!clip) return 'unknown';
      if (state.expiredRetried.includes(id)) {
        set({
          phase: 'ready',
          error: 'media_expired',
          message:
            'Media link expired again after one re-fetch. Open the original on Snapchat.',
        });
        return 'gave-up';
      }
      set({
        expiredRetried: [...state.expiredRetried, id],
        message: 'Media link expired — re-fetching once…',
      });
      await request({ fresh: true, reason: 'expired' });
      return 'refetched';
    },
    close() {
      generation += 1;
      abort?.abort();
      clearTimer(timer);
      timer = null;
      state = {
        ...initial(),
        refreshMs: state.refreshMs,
        history: state.history,
      };
      emit();
    },
    destroy() {
      api.close();
      destroyed = true;
      doc?.removeEventListener?.('visibilitychange', onVisibility);
      listeners.clear();
    },
  };
  return api;
}
