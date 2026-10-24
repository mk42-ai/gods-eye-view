/**
 * Scene builder — prompt → parse → geocode → AOI register → route plan →
 * S0..S4 fly-in → progressive footage → rank → play on S4 arrival.
 * Also owns Open (zero-network restore), Recreate (replay + diff) and
 * Duplicate. Every scene has its own AbortSignal (store.beginScene) so a
 * newer scene cancels the older one's route call, flight and stream.
 */
import { createScene, sceneLifecycle } from './scenes/models.js';
import { parsePrompt, geocodePlace, deriveTRef } from './scenes/prompt.js';
import { sceneFromFallback } from './scenes/share.js';
import { planRoute } from './route/client.js';
import { startRouteMonitor } from './route/monitor.js';
import { runFootagePipeline } from './footage/pipeline.js';
import { rankItems } from './footage/ranker.js';
import { buildScenePath } from './camera/ladder.js';
import { diffFootage } from './diff.js';
import { normaliseItem } from './footage/normalisers.js';

/**
 * Last-resort evidence when every live source returned 0 items: the verified
 * Umm Suqeim research fixture (tests/fixtures/step1-fixtures.json). Items are
 * flagged `fixture:true`, captioned "FIXTURE ·" and keep their `verified`
 * flag, so the showcase renders without passing fixtures off as live data.
 */
export function fixtureFootage(fixture, scene) {
  if (!fixture) return [];
  const t = fixture.incident?.target || {};
  const rows = [
    ...(fixture.articles || [])
      .filter((a) => a?.url)
      .map((a) => ({
        source: 'web',
        title: `FIXTURE · ${a.publisher}: ${String(a.title ?? '')}`,
        url: a.url,
        published_at: a.publishedAtUTC,
        author: a.publisher,
        verified: a.verified === true,
      })),
    ...(fixture.socialPosts || [])
      .filter((p) => p?.url && p.reachable)
      .map((p) => ({
        source: p.platform === 'facebook' ? 'web' : p.platform,
        title: `FIXTURE · ${String(p.title ?? `${p.platform} post (unverified)`)}`,
        url: p.url,
        published_at: fixture.incident?.reportedAtUTC,
        author: String(p.author ?? p.platform),
        verified: p.verified === true,
      })),
  ];
  return rows.map((raw, i) => {
    const item = normaliseItem(
      {
        ...raw,
        freshness: 'ARCHIVE',
        relevance: raw.verified ? 0.9 : 0.4,
        lat: t.lat,
        lon: t.lon,
      },
      { sceneId: scene.id },
    );
    return {
      ...item,
      fixture: true,
      verified: raw.verified,
      recency: 'ARCHIVE',
      rankScore: (raw.verified ? 1 : 0.5) - i * 0.01,
      location: {
        lat: t.lat,
        lon: t.lon,
        confidence: 'approx',
        basis: 'fixture',
      },
    };
  });
}

async function loadStep1Fixture() {
  try {
    const mod = await import('../../tests/fixtures/step1-fixtures.json');
    return mod.default || mod;
  } catch {
    return null;
  }
}

const DEFAULT_PRESET = Object.freeze({
  alt: 18000,
  heading: 0,
  pitch: 60,
  dwell: [4.2, 11],
});

/** @returns {{lat:number,lon:number,alt:number}|null} */
function readCamera(viewer, Cesium) {
  const carto = viewer?.camera?.positionCartographic;
  if (!carto || !Cesium) return null;
  return {
    lat: Cesium.Math.toDegrees(carto.latitude),
    lon: Cesium.Math.toDegrees(carto.longitude),
    alt: carto.height,
  };
}

export function createSceneBuilder({
  store,
  register,
  camera,
  client,
  ranker,
  footageCache,
  routeCache,
  sceneUi,
  sidebar,
  fetch: fetchImpl,
  viewer,
  Cesium,
  now,
  emit,
  events,
  enabledSources,
  window: win,
  onRegisterPrompt,
  findAoi,
  syncShare,
}) {
  const monitors = new Map(); // sceneId → {stop}
  let destroyed = false;

  const setStatus = (id, status, error = null) => {
    try {
      store.setStatus(id, status, error);
    } catch {
      store.patchScene(id, { status, error });
    }
    emit(events.status, { sceneId: id, status, at: now() });
    syncShare?.();
  };

  const fail = (id, code, message) => {
    setStatus(id, 'error', { code, message });
    sceneUi.setPoster?.(code === 'quota' ? 'quota' : 'error');
    return null;
  };

  function keywordsOf(parsed) {
    return parsed.incident || parsed.raw || '';
  }

  /** Resolve the AOI for a target, asking to register it when outside. */
  async function resolveAoi(target) {
    const hit = findAoi(target.lat, target.lon);
    if (hit)
      return {
        id: hit.id,
        name: hit.name,
        country: hit.country,
        category: hit.category,
        inRegister: true,
        radiusKm: hit.radiusKm,
      };
    const added = await onRegisterPrompt?.({
      name: target.name,
      lat: target.lat,
      lon: target.lon,
    });
    if (!added) return null;
    return {
      id: added.id,
      name: added.name,
      country: added.country,
      category: added.category,
      inRegister: true,
      radiusKm: added.radiusKm,
    };
  }

  /** Full pipeline. Resolves the Scene (status playing) or null. */
  async function buildFromPrompt(text, { reuseId = null, tRefOverride } = {}) {
    const raw = String(text || '').trim();
    if (!raw || destroyed) return null;
    const parsed = parsePrompt(raw);
    const id = reuseId || createScene({}).id;
    const signal = store.beginScene(id);
    const existing = store.getState().scenes[id];
    const base =
      existing ||
      createScene({
        id,
        title: raw,
        prompt: raw,
        kind: parsed.kind,
        preset: { ...DEFAULT_PRESET },
      });
    store.upsertScene({ ...base, status: 'parsing', error: null });
    store.setActive(id);
    sceneUi.setPoster?.('loading');
    emit(events.status, { sceneId: id, status: 'parsing', at: now() });

    // 1. geocode
    const target = await geocodePlace(parsed.placeName || raw, {
      fetch: fetchImpl,
      register,
    });
    if (signal.aborted) return null;
    if (!target) return fail(id, 'no-place', 'No place could be identified');
    // 2. AOI register (decline = build nothing, fetch nothing)
    const aoi = await resolveAoi(target);
    if (signal.aborted) return null;
    if (!aoi) {
      store.removeScene(id);
      sceneUi.setPoster?.('outsideRegister');
      return null;
    }
    const tRefInfo =
      tRefOverride || deriveTRef({ kind: parsed.kind, text: raw, now: now() });
    store.patchScene(id, {
      target,
      aoi,
      kind: parsed.kind,
      tRef: tRefInfo.tRef,
      tRefLabel: tRefInfo.tRefLabel,
      status: 'geocoded',
      lifecycle: sceneLifecycle(
        {
          ...(existing?.lifecycle || {}),
          createdAt:
            existing?.lifecycle?.createdAt || new Date(now()).toISOString(),
          lastBuiltAt: new Date(now()).toISOString(),
          buildCount: (existing?.lifecycle?.buildCount || 0) + 1,
        },
        now(),
      ),
    });
    emit(events.status, { sceneId: id, status: 'geocoded', at: now() });
    return continueBuild(id, { parsed, signal });
  }

  /** Route → fly → fetch → rank → play (shared by build and recreate). */
  async function continueBuild(id, { parsed, signal, previousFootage = null }) {
    const scene = () => store.getState().scenes[id];
    const s0 = scene();
    if (!s0) return null;
    // 3. route agent BEFORE any camera move
    setStatus(id, 'routing');
    const origin = readCamera(viewer, Cesium) || {
      lat: s0.target.lat,
      lon: s0.target.lon,
      alt: 8_000_000,
    };
    const route = await planRoute({
      origin,
      target: s0.target,
      aoiId: s0.aoi.id,
      tRef: s0.tRef,
      preset: s0.preset,
      pins: [],
      fetch: fetchImpl,
      signal,
      cache: routeCache,
      now,
    });
    if (signal.aborted) return null;
    sidebar.setRouteAgent?.({
      status: route.fallback ? 'error' : 'ok',
      latencyMs: route.latencyMs ?? null,
    });
    store.patchScene(id, { route });
    if (route.fallback) sceneUi.setPoster?.('routeFallback');
    // 4. fly S0..S4 while footage streams in parallel
    setStatus(id, 'flying');
    const path =
      route.scenePath?.length >= 5
        ? route.scenePath
        : buildScenePath({
            origin,
            target: s0.target,
            preset: s0.preset,
            approachBearing: route.approachBearing,
          });
    const arrival = camera.flyScenePath(path, { signal, sceneId: id });
    const footagePromise = fetchFootage(id, {
      parsed,
      signal,
      previousFootage,
    });
    const result = await arrival;
    if (signal.aborted || result !== 'arrived') return null;
    store.patchScene(id, {
      camera: {
        lat: path[4].lat,
        lon: path[4].lon,
        alt: path[4].alt,
        heading: path[4].heading,
        pitch: path[4].pitch,
        roll: 0,
        stage: 'S4',
      },
    });
    // 5. top-ranked clip autoplays ONLY on S4 arrival
    const summary = await footagePromise;
    if (signal.aborted) return null;
    const top = scene()?.footage?.[0] || null;
    setStatus(id, top ? 'playing' : 'ranked');
    if (top) sceneUi.playNow(top);
    else sceneUi.setPoster?.(summary?.quotaOnly ? 'quota' : 'empty');
    startMonitor(id, signal);
    setStatus(id, 'saved');
    store.patchScene(id, { status: 'playing' });
    emit(events.built, { sceneId: id, at: now() });
    return scene();
  }

  async function fetchFootage(id, { parsed, signal, previousFootage }) {
    const s = store.getState().scenes[id];
    setStatus(id, 'fetching');
    const summary = await runFootagePipeline({
      scene: { ...s, keywords: keywordsOf(parsed) },
      client,
      ranker,
      cache: footageCache,
      signal,
      enabled: enabledSources,
      now,
      onItem: (item) => store.mergeFootage(id, [item]),
      onSource: (platform, status) =>
        store.setSourceStatus(id, platform, status),
      onRanked: (items) => {
        const diffed = previousFootage
          ? diffFootage(previousFootage, items)
          : null;
        store.mergeFootage(id, diffed ? diffed.items : items, {
          force: true,
          replace: true,
        });
        if (diffed) store.patchScene(id, { lastDiff: diffed.summary });
        if (!signal.aborted) setStatus(id, 'ranked');
      },
    });
    if (signal.aborted) return summary;
    if (!(store.getState().scenes[id]?.footage?.length > 0)) {
      const fx = fixtureFootage(
        await loadStep1Fixture(),
        store.getState().scenes[id],
      );
      if (fx.length) {
        store.mergeFootage(id, fx, { force: true, replace: true });
        store.patchScene(id, { fixtureFallback: true });
        if (summary)
          summary.earliestUploadedAt =
            summary.earliestUploadedAt ||
            fx
              .map((f) => f.uploadedAt)
              .filter(Boolean)
              .sort()[0] ||
            null;
      }
    }
    const statuses = Object.values(summary?.sources || {}).map((x) => x.status);
    summary.quotaOnly =
      statuses.length > 0 &&
      statuses.every((st) => st === 'quota' || st === 'inactive');
    const earliest = summary?.earliestUploadedAt || null;
    const s2 = store.getState().scenes[id];
    if (s2) {
      const start =
        earliest && s2.kind !== 'live'
          ? earliest
          : new Date(now() - 3600_000).toISOString();
      store.patchScene(id, {
        timeline: {
          start: new Date(
            Math.min(Date.parse(start), Date.parse(s2.tRef)),
          ).toISOString(),
          end: new Date(
            Math.max(now(), Date.parse(s2.tRef) + 3600_000),
          ).toISOString(),
          markers: [{ at: s2.tRef, kind: 'tRef', label: s2.tRefLabel }],
        },
      });
    }
    return summary;
  }

  function startMonitor(id, signal) {
    monitors.get(id)?.stop();
    const mock = /[?&]alerts=mock/.test(String(win?.location?.search || ''));
    monitors.set(
      id,
      startRouteMonitor({
        sceneId: id,
        fetch: fetchImpl,
        signal,
        mock,
        onAlert: (alert) => {
          const s = store.getState().scenes[id];
          if (!s) return;
          store.patchScene(id, {
            route: { ...s.route, alerts: [...(s.route.alerts || []), alert] },
            timeline: {
              ...s.timeline,
              markers: [
                ...(s.timeline?.markers || []),
                {
                  at: alert.at,
                  kind: 'alert',
                  label: alert.text,
                  refId: alert.id,
                },
              ],
            },
          });
          sceneUi.mapLayers?.pulseRoute?.(alert.routeId);
        },
      }),
    );
  }

  /** Zero-network restore straight to S4 (no fetch, no route call). */
  async function openScene(id, { playback } = {}) {
    let scene = store.getState().scenes[id];
    if (!scene) {
      scene = await store.load?.(id);
      if (!scene) return null;
      store.upsertScene(scene);
    }
    const signal = store.beginScene(id);
    store.setActive(id);
    playback?.stopItem?.();
    const cam = scene.camera || scene.route?.scenePath?.[4];
    if (cam)
      await camera.setStage('S4', scene.route?.scenePath, {
        signal,
        camera: cam,
      });
    if (signal.aborted) return null;
    const top = scene.footage?.[0] || null;
    store.patchScene(id, { status: 'playing' });
    emit(events.status, { sceneId: id, status: 'playing', at: now() });
    // Zero-network restore: the top clip is ARMED (selected, poster, overlay)
    // but not started — no embed/iframe/video request until the user plays.
    if (top) sceneUi.arm?.(top);
    syncShare?.();
    return store.getState().scenes[id];
  }

  /** Replay from S0, re-call the route agent, refetch with the same tRef (live → now) and diff. */
  async function recreateScene(id) {
    const prev = store.getState().scenes[id];
    if (!prev) return null;
    const parsed = parsePrompt(prev.prompt);
    const tRefOverride =
      prev.kind === 'live'
        ? deriveTRef({ kind: 'live', text: prev.prompt, now: now() })
        : { tRef: prev.tRef, tRefLabel: prev.tRefLabel };
    footageCache.clear?.();
    routeCache.clear?.();
    const signal = store.beginScene(id);
    store.setActive(id);
    store.patchScene(id, {
      status: 'routing',
      tRef: tRefOverride.tRef,
      tRefLabel: tRefOverride.tRefLabel,
      lifecycle: sceneLifecycle(
        {
          ...prev.lifecycle,
          lastBuiltAt: new Date(now()).toISOString(),
          buildCount: (prev.lifecycle?.buildCount || 0) + 1,
        },
        now(),
      ),
    });
    sceneUi.setPoster?.('recreateDiff');
    const scene = await continueBuild(id, {
      parsed,
      signal,
      previousFootage: prev.footage || [],
    });
    return scene
      ? {
          scene,
          diff: scene.lastDiff || {
            added: 0,
            removed: 0,
            unchanged: scene.footage.length,
          },
        }
      : null;
  }

  function duplicate(id) {
    const src = store.getState().scenes[id];
    if (!src) return null;
    const copy = createScene({
      ...src,
      id: undefined,
      title: `${src.title} (copy)`,
      lifecycle: sceneLifecycle(
        {
          createdAt: new Date(now()).toISOString(),
          buildCount: src.lifecycle?.buildCount || 0,
        },
        now(),
      ),
    });
    store.upsertScene({
      ...copy,
      footage: src.footage.map((f) => ({ ...f, sceneId: copy.id })),
      status: 'saved',
    });
    return copy;
  }

  /** Source toggles remove/restore a platform's pins + cards without refetching. */
  function applySourceFilter() {
    const state = store.getState();
    const scene = state.scenes[state.activeId];
    if (!scene) return;
    const filtered = scene.footage.map((f) => ({
      ...f,
      hidden: enabledSources[f.platform] === false,
    }));
    const sources = { ...scene.sources };
    for (const p of Object.keys(sources))
      sources[p] = { ...sources[p], enabled: enabledSources[p] !== false };
    store.patchScene(scene.id, { sources });
    store.mergeFootage(scene.id, filtered, { force: true, replace: true });
    sceneUi.setFilter?.((item) => enabledSources[item.platform] !== false);
  }

  async function restoreFromHash(decoded) {
    if (!decoded) return null;
    if (decoded.sceneId) {
      const stored =
        store.getState().scenes[decoded.sceneId] ||
        (await store.load?.(decoded.sceneId));
      if (stored) {
        store.upsertScene(stored);
        return openScene(stored.id);
      }
    }
    if (decoded.fallback) {
      const scene = sceneFromFallback(decoded.fallback);
      if (!scene) return null;
      scene.footage = rankItems(scene.footage || [], scene, now());
      store.upsertScene({ ...scene, status: 'saved' });
      return openScene(scene.id);
    }
    return null;
  }

  return {
    buildFromPrompt,
    openScene,
    recreateScene,
    duplicate,
    applySourceFilter,
    restoreFromHash,
    continueBuild,
    destroy() {
      destroyed = true;
      for (const m of monitors.values()) m.stop();
      monitors.clear();
    },
  };
}
