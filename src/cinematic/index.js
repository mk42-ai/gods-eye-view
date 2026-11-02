/**
 * Live Cinematic Intelligence Engine — browser integration.
 *
 * ONE place where the pieces built in src/cinematic/* are wired to the
 * existing Cesium viewer and incidents UI:
 *
 *   SSE (construct/stream) --> runtimeReducer --> sceneRuntime (Cesium, rAF batched)
 *                                   │                 │
 *                                   ├--> playbackController (viewer.clock)
 *                                   ├--> cameraDirector (preRender tick)
 *                                   ├--> liveIntelligenceDirector (evidence patches)
 *                                   └--> cinematicPanel + debugApi (window.__gevCinematic)
 *
 * The viewer is NEVER destroyed or recreated; everything attaches to the
 * existing instance. Older scenes (no `cinematic` document) still render
 * through the legacy layers untouched.
 */
import * as Cesium from 'cesium';
import { createRuntimeReducer } from './runtimeReducer.js';
import { createSceneRuntime } from './sceneRuntime.js';
import { createPlaybackController } from './playbackController.js';
import { createCameraDirector } from './cameraDirector.js';
import { createLiveIntelligenceDirector } from './liveIntelligenceDirector.js';
import { createQaExecutor } from './qaExecutor.js';
import { mountCinematicPanel } from './ui/cinematicPanel.js';
import {
  installDebugApi,
  recordEvent,
  createEventRingBuffer,
} from './debugApi.js';
import { buildQaContext } from './qaCommands.js';
import { CINEMATIC_EVENTS } from './events.js';
import { safeValidateCinematicScene } from './sceneSchema.js';

const V2 = '/api/ondemand/v2/scene-plans';
const MODELS_STORAGE_KEY = 'gev.cinematic.models.v1';
const TYPED = new Set(CINEMATIC_EVENTS);

export function installCinematicEngine({
  viewer,
  document: doc = globalThis.document,
  window: win = globalThis.window,
  container,
  fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
  headers = () => ({}),
  log = () => {},
} = {}) {
  if (!viewer || !doc) return null;

  const ring = createEventRingBuffer();
  const feed = [];
  let panel = null;
  let modelAssignments = readAssignments(win);
  let models = [];
  let attachedSceneId = null;

  // ---- runtime pieces ------------------------------------------------------
  const playback = createPlaybackController({
    viewer,
    onChange: () => scheduleUpdate(),
    entityGetter: (id) => runtime?.entityById?.(id) || null,
    positionsSnapshotGetter: (sec) => runtime?.positionsSnapshot?.(sec) || {},
  });
  const runtime = createSceneRuntime({
    viewer,
    document: doc,
    playback,
    onEvent: (name, data) => {
      recordEvent(ring, { event: name, data });
      if (name === 'asset.ready' && data?.substituted)
        pushFeed(
          `asset ${data.assetId} → ${data.used || 'fallback'} (${data.reason || 'substituted'})`,
          'system',
        );
    },
    log,
  });
  const reducer = createRuntimeReducer({
    onApply: (scene, changes) => {
      if (!scene) return;
      applyScene(scene, changes);
    },
  });
  let cameraDirector = null;
  function ensureCameraDirector() {
    if (cameraDirector || !runtime.context) return cameraDirector;
    cameraDirector = createCameraDirector({
      viewer,
      context: runtime.context,
      runtime,
      playback,
      onShotChanged: ({ shot, at, reason }) => {
        recordEvent(ring, {
          event: 'cinematic.shot.changed',
          data: {
            shotId: shot?.id,
            type: shot?.type,
            title: shot?.title,
            at,
            reason,
          },
        });
        reducer.ingest({
          event: 'cinematic.shot.changed',
          data: { shotId: shot?.id, type: shot?.type, at },
        });
        scheduleUpdate();
      },
    });
    return cameraDirector;
  }
  // Consumers destructure `cameraDirector` at construction time, before the
  // first scene exists; this proxy forwards to the real director lazily.
  const cameraProxy = {
    interrupt: (shot, opts) =>
      ensureCameraDirector()?.interrupt(shot, opts) ?? {
        accepted: false,
        queued: false,
        reason: 'no_scene',
      },
    release: () => cameraDirector?.release?.(),
    currentShot: (sec) => cameraDirector?.currentShot?.(sec) ?? null,
    setShots: (shots) => ensureCameraDirector()?.setShots(shots),
    enable: (v) => ensureCameraDirector()?.enable(v),
    isEnabled: () => Boolean(cameraDirector?.isEnabled?.()),
    poseForShot: (...a) => ensureCameraDirector()?.poseForShot(...a) ?? null,
  };
  const liveDirector = createLiveIntelligenceDirector({
    runtime,
    playback,
    cameraDirector: cameraProxy,
    applyPatch: (patch) => {
      const res = reducer.applyPatch(patch, {
        source: patch.source || 'intelligence',
      });
      return {
        scene: reducer.scene(),
        applied: res.accepted ? res.applied || res.changes || [] : [],
        rejected: res.accepted ? res.rejected || [] : [{ reason: res.reason }],
        stale: res.reason === 'stale_version' || res.stale === true,
      };
    },
    onEvent: (name, data) => {
      recordEvent(ring, { event: name, data });
      reducer.ingest({ event: name, data });
      scheduleUpdate();
    },
  });
  const qaExecutor = createQaExecutor({
    runtime,
    playback,
    cameraDirector: cameraProxy,
    reducer,
    liveDirector,
  });

  // ---- client (server routes) ---------------------------------------------
  const client = {
    async cinematicModels() {
      const res = await fetchImpl(`${V2}/models`, { headers: headers() });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok)
        throw new Error(body?.error?.message || `HTTP ${res.status}`);
      return body;
    },
    async cinematicQa(question, context) {
      const scene = reducer.scene();
      const res = await fetchImpl(`${V2}/qa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({
          question,
          context,
          sceneId: scene?.sceneId || context?.sceneId || 'scene-none',
          ...(modelAssignments.qa ? { endpointId: modelAssignments.qa } : {}),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok)
        throw new Error(body?.error?.message || `HTTP ${res.status}`);
      return body;
    },
    /** Live Intelligence source: Open-Meteo observation → validated patch. */
    async cinematicWeather({ lat, lon, sceneId, baseVersion, atSec }) {
      const res = await fetchImpl(`${V2}/intel/weather`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ lat, lon, sceneId, baseVersion, atSec }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        const err = new Error(body?.error?.message || `HTTP ${res.status}`);
        err.status = res.status;
        err.code = body?.error?.code;
        throw err;
      }
      return body;
    },
  };

  /**
   * Live Intelligence: pull the current Open-Meteo observation for the active
   * scene origin and route it through the director (validated patch, camera
   * priority, feed entry). Returns the server payload plus the director
   * result; throws when there is no scene or the provider failed — the UI
   * shows the failure, never a fabricated update.
   */
  async function pullLiveWeather() {
    const scene = reducer.scene();
    if (!scene?.origin) throw new Error('No active scene for live weather');
    const started = performance.now();
    const body = await client.cinematicWeather({
      lat: scene.origin.lat,
      lon: scene.origin.lon,
      sceneId: scene.sceneId,
      baseVersion: scene.sceneVersion,
      atSec: playback.positionSec(),
    });
    const receivedAt = performance.now();
    recordEvent(ring, {
      event: 'intelligence.received',
      data: {
        source: 'open-meteo',
        label: body.label,
        latencyMs: body.latencyMs,
        patchId: body.patch?.patchId,
      },
    });
    const result = liveDirector.receive({
      patch: body.patch,
      priority: body.patch?.priority || 'normal',
      relevance: body.effect ? 0.75 : 0.4,
      source: 'intelligence',
    });
    const evidenceToVisualMs = Math.round(performance.now() - receivedAt);
    reducer.ingest({
      event: 'intelligence.validated',
      data: {
        source: 'open-meteo',
        applied: result.applied?.length || 0,
        rejected: result.rejected?.length || 0,
        evidenceToVisualMs,
      },
    });
    pushFeed(
      `${body.attribution}: ${body.label} · ${body.summary} (${body.latencyMs} ms fetch, ${evidenceToVisualMs} ms to visual, ${result.applied?.length || 0} ops)`,
      'intelligence',
    );
    scheduleUpdate();
    return {
      ...body,
      result,
      evidenceToVisualMs,
      roundTripMs: Math.round(performance.now() - started),
    };
  }

  // ---- scene application ---------------------------------------------------
  let firstRenderMarked = false;
  function applyScene(scene, changes) {
    const first = attachedSceneId !== scene.sceneId;
    if (first) {
      attachedSceneId = scene.sceneId;
      runtime.attach(scene);
      playback.load(scene);
      firstRenderMarked = false;
    } else {
      runtime.update(scene, changes);
      if (scene.timeline?.durationSec > playback.durationSec())
        playback.extendDuration(scene.timeline.durationSec);
    }
    const cam = ensureCameraDirector();
    cam?.setShots(scene.shots || []);
    if (!firstRenderMarked && scene.entities?.length) {
      firstRenderMarked = true;
      reducer.markRendered();
    }
    // Stage D: the first shot becomes playable as soon as BOTH an entity and a
    // shot exist — the director streams entities before shots, so this is
    // re-checked on every applied change until it fires once per run.
    if (!cinematicStarted) startFirstPlayableShot(scene);
    scheduleUpdate();
  }
  let cinematicStarted = false;
  function startFirstPlayableShot(scene) {
    if (cinematicStarted || !scene.shots?.length || !scene.entities?.length)
      return;
    cinematicStarted = true;
    ensureCameraDirector()?.enable(true);
    playback.setCameraMode('cinematic');
    playback.play();
    reducer.ingest({
      event: 'cinematic.started',
      data: { shotId: scene.shots[0]?.id },
    });
    recordEvent(ring, {
      event: 'cinematic.started',
      data: { shotId: scene.shots[0]?.id },
    });
  }
  // Camera tick on preRender — ONE smooth setView per frame, never flyTo spam.
  const preRender = () => {
    const cam = cameraDirector;
    if (!cam || !cam.isEnabled?.()) return;
    const st = playback.state();
    if (st.cameraMode !== 'cinematic') return;
    const sec = playback.positionSec();
    try {
      cam.tick(sec);
    } catch (err) {
      log(`[cinematic] camera tick error: ${err?.message || err}`);
    }
  };
  viewer.scene.preRender.addEventListener(preRender);
  // Playback needs the real render loop while playing.
  const unTick = playback.onTick(() => {
    const st = playback.state();
    if (st.state === 'playing') {
      viewer.scene.requestRender?.();
      scheduleUpdate();
    }
  });

  // ---- SSE intake ----------------------------------------------------------
  /** Feed one SSE frame (from constructWithStream) into the engine. */
  function onStreamEvent(evt) {
    if (!evt?.event) return;
    recordEvent(ring, { id: evt.id, event: evt.event, data: evt.data });
    // Legacy terminal frames still decide the run state truthfully: a scene
    // `error` (e.g. needs_clarification) is a FAILED run, never a hang.
    if (evt.event === 'error' || evt.event === 'done') {
      reducer.ingest({
        event: evt.event,
        data: {
          error: evt.data?.code || evt.data?.message,
          message: evt.data?.message,
        },
      });
      if (evt.event === 'error')
        pushFeed(
          `scene request failed: ${evt.data?.code || ''} ${evt.data?.message || ''}`.trim(),
          'system',
        );
      scheduleUpdate();
      return;
    }
    if (!TYPED.has(evt.event)) return;
    if (evt.event === 'run.started') {
      // A new run: reset playback/camera for the next scene document.
      cinematicStarted = false;
      attachedSceneId = null;
      cameraDirector?.release?.();
    }
    const res = reducer.ingest({
      id: evt.id,
      event: evt.event,
      data: evt.data,
    });
    if (evt.event === 'model.selected')
      pushFeed(
        `model ${evt.data?.endpointId}${evt.data?.cerebras ? ' (Cerebras)' : ''}`,
        'system',
      );
    if (evt.event === 'run.failed')
      pushFeed(
        `run failed: ${evt.data?.code || ''} ${evt.data?.message || ''}`.trim(),
        'system',
      );
    if (evt.event === 'scene.patch' && evt.data?.stage === 'E')
      pushFeed('Stage E enrichment: researched routes added', 'research');
    if (!res?.accepted && res?.reason && res.reason !== 'unknown_event')
      log(`[cinematic] dropped ${evt.event}: ${res.reason}`);
    scheduleUpdate();
  }

  /** Attach a saved/completed cinematic scene document (reload / library). */
  function attachScene(scene, { runId } = {}) {
    const parsed = safeValidateCinematicScene(scene);
    if (!parsed.success) return false;
    cinematicStarted = false;
    attachedSceneId = null;
    reducer.reset();
    reducer.ingest({
      event: 'run.started',
      data: {
        runId: runId || parsed.data.runId || parsed.data.sceneId,
        sceneId: parsed.data.sceneId,
        mode: parsed.data.mode,
        origin: parsed.data.origin,
        title: parsed.data.title,
        seq: 1,
      },
    });
    reducer.ingest({
      event: 'scene.initialized',
      data: { scene: parsed.data, seq: 2 },
    });
    reducer.ingest({
      event: 'run.completed',
      data: { seq: 3, model: parsed.data.provenance?.model || null },
    });
    applyScene(reducer.scene(), null);
    return true;
  }

  function clear() {
    cinematicStarted = false;
    attachedSceneId = null;
    cameraDirector?.release?.();
    cameraDirector?.enable?.(false);
    playback.pause();
    reducer.reset();
    scheduleUpdate();
  }

  // ---- panel + debug api ---------------------------------------------------
  function pushFeed(summary, source = 'system') {
    const entry = { at: new Date().toISOString(), source, summary };
    feed.unshift(entry);
    feed.splice(80);
    panel?.appendFeed(entry);
  }
  let updatePending = false;
  function scheduleUpdate() {
    if (updatePending || !panel) return;
    updatePending = true;
    const raf = win?.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
    raf(() => {
      updatePending = false;
      try {
        const state = reducer.state();
        panel.update(
          {
            ...state,
            playback: playback.state(),
            feed,
            liveFeed: liveDirector.feed?.() || [],
            autoDirect: liveDirector.autoDirect(),
          },
          reducer.scene(),
        );
      } catch (err) {
        log(`[cinematic] panel update error: ${err?.message || err}`);
      }
    });
  }
  function onModelChange(task, endpointId) {
    modelAssignments = { ...modelAssignments, [task]: endpointId };
    try {
      win?.localStorage?.setItem(
        MODELS_STORAGE_KEY,
        JSON.stringify(modelAssignments),
      );
    } catch {}
    pushFeed(`model assignment ${task} → ${endpointId}`, 'user');
  }
  function mountPanel(target) {
    if (panel) return panel;
    panel = mountCinematicPanel({
      document: doc,
      window: win,
      container: target || container,
      runtime,
      playback,
      cameraDirector: cameraProxy,
      reducer,
      liveDirector,
      qaExecutor,
      client,
      onModelChange,
      inject: () => win?.__gevCinematic?.inject?.('road_closure'),
      pullLiveWeather,
    });
    void refreshModels();
    scheduleUpdate();
    return panel;
  }
  async function refreshModels() {
    try {
      const body = await client.cinematicModels();
      models = body.models || [];
      panel?.setModels(models, {
        ...(body.assignments || {}),
        ...modelAssignments,
      });
      return models;
    } catch (err) {
      log(`[cinematic] models unavailable: ${err?.message || err}`);
      panel?.setModels([], modelAssignments);
      return [];
    }
  }

  const debug = installDebugApi(win, {
    ringBuffer: ring,
    reducer,
    runtime,
    playback,
    viewer,
    liveDirector,
    qaExecutor,
    client,
    onModelChange,
    getModels: async () => {
      const list = models.length ? models : await refreshModels();
      return list;
    },
    pullLiveWeather,
  });

  /** Model id to send with the next build (picker / forceModel / none). */
  function selectedEndpointId() {
    const forced = win?.__gevCinematicForceModel;
    if (typeof forced === 'string' && forced) return forced;
    return modelAssignments.scene_direction || undefined;
  }

  function destroy() {
    viewer.scene.preRender.removeEventListener(preRender);
    unTick?.();
    panel?.destroy();
    runtime.destroy();
    if (win && win.__gevCinematic === debug) delete win.__gevCinematic;
  }

  return {
    onStreamEvent,
    attachScene,
    clear,
    mountPanel,
    refreshModels,
    selectedEndpointId,
    reducer,
    runtime,
    playback,
    get cameraDirector() {
      return ensureCameraDirector();
    },
    liveDirector,
    qaExecutor,
    client,
    pullLiveWeather,
    buildQaContext: (extra = {}) =>
      buildQaContext({
        scene: reducer.scene(),
        playback: playback.state(),
        ...extra,
      }),
    scene: () => reducer.scene(),
    state: () => reducer.state(),
    events: () => ring.toArray?.() || [],
    destroy,
  };
}

function readAssignments(win) {
  try {
    const raw = win?.localStorage?.getItem(MODELS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
