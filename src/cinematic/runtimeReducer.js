/**
 * Pure SSE event reducer for the Cinematic Scene Runtime.
 * Manages run state, monotonic sequencing, scene patching, object creation,
 * stage progression, and latency metrics. Dependency-free (no Cesium).
 */
import { isKnownEvent, RUN_STATES, RUNTIME_MODES, STAGES } from './events.js';
import {
  EntitySchema,
  RouteSchema,
  EffectSchema,
  ScenePatchSchema,
  emptyScene,
  applyScenePatch,
  diffScenes,
  safeValidateCinematicScene,
} from './sceneSchema.js';

function initialMetrics() {
  return {
    ttftMs: null,
    firstSceneInstructionMs: null,
    firstRenderedObjectMs: null,
    firstPlayableShotMs: null,
    evidenceToVisualMs: null,
    answerChars: 0,
    staleOpsCount: 0,
    intelligenceReceivedCount: 0,
    intelligenceValidatedCount: 0,
  };
}

function ensureSafeOrigin(raw, defaultTitle = 'Scene') {
  const o = raw || {};
  return {
    name: (o.name && String(o.name).trim()) || defaultTitle || 'Origin',
    lat: typeof o.lat === 'number' ? o.lat : 0,
    lon: typeof o.lon === 'number' ? o.lon : 0,
    heightM: typeof o.heightM === 'number' ? o.heightM : 0,
    ...(o.approximate != null ? { approximate: Boolean(o.approximate) } : {}),
    ...(o.precision != null ? { precision: String(o.precision) } : {}),
    ...(o.confidence != null ? { confidence: Number(o.confidence) } : {}),
  };
}

function ensureSafeSceneId(id, fallback = 'scene-default') {
  if (typeof id === 'string' && id.trim().length >= 4) {
    return id.trim();
  }
  return fallback;
}

function initialState() {
  return {
    runId: null,
    sceneId: null,
    sceneVersion: 0,
    lastSeq: -1,
    runState: 'idle',
    startedAt: null,
    mode: RUNTIME_MODES.SIMULATION,
    title: 'Scene',
    origin: null,
    model: null,
    stage: 'A',
    invalid: [],
    metrics: initialMetrics(),
    error: null,
    _lastIntelligenceReceivedAt: null,
  };
}

/**
 * Pure step function for the runtime reducer.
 *
 * @param {{state: object, scene: object|null}} context
 * @param {{id?: string, event: string, data: any}} sseEvent
 * @param {{now?: () => number}} [options]
 * @returns {{context: {state: object, scene: object|null}, result: object}}
 */
export function reduceEvent(
  context,
  sseEvent,
  { now = () => Date.now() } = {},
) {
  let { state, scene } = context;
  state = {
    ...state,
    metrics: { ...state.metrics },
    invalid: [...state.invalid],
  };

  if (!sseEvent || typeof sseEvent !== 'object' || !sseEvent.event) {
    return {
      context: { state, scene },
      result: { accepted: false, reason: 'malformed_event' },
    };
  }

  const eventName = sseEvent.event;
  let data = sseEvent.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      data = { text: data };
    }
  }
  if (!data || typeof data !== 'object') {
    data = {};
  }

  // Check new runId
  if (data.runId && state.runId && data.runId !== state.runId) {
    state = initialState();
    scene = null;
    state.runId = data.runId;
  }

  // Check monotonic seq per runId
  if (typeof data.seq === 'number') {
    if (
      data.seq <= state.lastSeq &&
      state.runId &&
      (!data.runId || data.runId === state.runId)
    ) {
      return {
        context: { state, scene },
        result: { accepted: false, reason: 'stale_seq' },
      };
    }
    state.lastSeq = data.seq;
  }

  if (!isKnownEvent(eventName)) {
    return {
      context: { state, scene },
      result: { accepted: false, reason: 'unknown_event' },
    };
  }

  const currentNow = now();
  const elapsed = () => {
    if (typeof data.elapsedMs === 'number') return data.elapsedMs;
    if (state.startedAt != null)
      return Math.max(0, currentNow - state.startedAt);
    return 0;
  };

  switch (eventName) {
    case 'run.started': {
      state.runId = data.runId || state.runId;
      state.sceneId = data.sceneId || state.sceneId;
      state.mode = data.mode || state.mode || RUNTIME_MODES.SIMULATION;
      state.title = data.title || state.title || 'Scene';
      state.origin = data.origin || state.origin;
      state.runState = 'running';
      state.startedAt = data.startedAt || currentNow;
      state.stage = 'A';
      return {
        context: { state, scene },
        result: { accepted: true },
      };
    }

    case 'model.selected': {
      state.model = data;
      return {
        context: { state, scene },
        result: { accepted: true },
      };
    }

    case 'scene.planning': {
      state.stage = 'B';
      return {
        context: { state, scene },
        result: { accepted: true },
      };
    }

    case 'asset.loading':
    case 'asset.ready': {
      if (state.stage === 'B') state.stage = 'C';
      return {
        context: { state, scene },
        result: { accepted: true },
      };
    }

    case 'answer.delta': {
      if (state.metrics.ttftMs == null && state.startedAt != null) {
        state.metrics.ttftMs = elapsed();
      }
      const text = data.text || data.answer || '';
      state.metrics.answerChars += text.length;
      return {
        context: { state, scene },
        result: { accepted: true },
      };
    }

    case 'answer.completed': {
      return {
        context: { state, scene },
        result: { accepted: true },
      };
    }

    case 'scene.initialized': {
      if (data.scene) {
        const validated = safeValidateCinematicScene(data.scene);
        if (validated.success) {
          const before = scene;
          scene = validated.data;
          state.sceneId = scene.sceneId;
          state.sceneVersion = scene.sceneVersion;
          const changes = before ? diffScenes(before, scene) : null;
          return {
            context: { state, scene },
            result: { accepted: true, scene, changes },
          };
        } else {
          state.invalid.push({
            event: 'scene.initialized',
            errors: validated.error.issues,
          });
          return {
            context: { state, scene },
            result: { accepted: false, reason: 'invalid_scene' },
          };
        }
      }
      return {
        context: { state, scene },
        result: { accepted: false, reason: 'missing_scene' },
      };
    }

    case 'scene.object.created': {
      if (
        state.metrics.firstSceneInstructionMs == null &&
        state.startedAt != null
      ) {
        state.metrics.firstSceneInstructionMs = elapsed();
      }

      if (!scene) {
        const sid = ensureSafeSceneId(
          state.sceneId || data.sceneId,
          state.runId ? `scene-${state.runId}` : 'scene-default',
        );
        scene = emptyScene({
          sceneId: sid,
          runId: state.runId,
          origin: ensureSafeOrigin(state.origin || data.origin, state.title),
          mode: state.mode,
          title: state.title,
        });
      }

      const nextScene = structuredClone(scene);
      let accepted = false;
      let reason;

      if (data.entity) {
        const parsed = EntitySchema.safeParse(data.entity);
        if (parsed.success) {
          const ent = parsed.data;
          const idx = nextScene.entities.findIndex((e) => e.id === ent.id);
          if (idx !== -1) nextScene.entities[idx] = ent;
          else nextScene.entities.push(ent);

          if (!nextScene.assetIds.includes(ent.assetId)) {
            nextScene.assetIds.push(ent.assetId);
          }
          accepted = true;
        } else {
          state.invalid.push({
            event: 'scene.object.created',
            kind: 'entity',
            error: parsed.error.issues,
            data: data.entity,
          });
          reason = 'invalid_entity';
        }
      } else if (data.route) {
        const parsed = RouteSchema.safeParse(data.route);
        if (parsed.success) {
          const rt = parsed.data;
          const idx = nextScene.routes.findIndex((r) => r.id === rt.id);
          if (idx !== -1) nextScene.routes[idx] = rt;
          else nextScene.routes.push(rt);
          accepted = true;
        } else {
          state.invalid.push({
            event: 'scene.object.created',
            kind: 'route',
            error: parsed.error.issues,
            data: data.route,
          });
          reason = 'invalid_route';
        }
      } else if (data.effect) {
        const parsed = EffectSchema.safeParse(data.effect);
        if (parsed.success) {
          const eff = parsed.data;
          const idx = nextScene.effects.findIndex((e) => e.id === eff.id);
          if (idx !== -1) nextScene.effects[idx] = eff;
          else nextScene.effects.push(eff);
          accepted = true;
        } else {
          state.invalid.push({
            event: 'scene.object.created',
            kind: 'effect',
            error: parsed.error.issues,
            data: data.effect,
          });
          reason = 'invalid_effect';
        }
      } else {
        // Raw object fallback
        const asEntity = EntitySchema.safeParse(data);
        if (asEntity.success) {
          const ent = asEntity.data;
          const idx = nextScene.entities.findIndex((e) => e.id === ent.id);
          if (idx !== -1) nextScene.entities[idx] = ent;
          else nextScene.entities.push(ent);
          if (!nextScene.assetIds.includes(ent.assetId))
            nextScene.assetIds.push(ent.assetId);
          accepted = true;
        } else {
          state.invalid.push({
            event: 'scene.object.created',
            error: 'unrecognized_object',
            data,
          });
          reason = 'unrecognized_object';
        }
      }

      if (accepted) {
        nextScene.sceneVersion += 1;
        state.sceneVersion = nextScene.sceneVersion;
        const changes = diffScenes(scene, nextScene);
        scene = nextScene;
        return {
          context: { state, scene },
          result: { accepted: true, scene, changes },
        };
      }

      return {
        context: { state, scene },
        result: { accepted: false, reason },
      };
    }

    case 'scene.object.updated': {
      if (!scene) {
        return {
          context: { state, scene },
          result: { accepted: false, reason: 'no_scene' },
        };
      }
      const nextScene = structuredClone(scene);
      let updated = false;

      if (data.entityId && data.changes) {
        const idx = nextScene.entities.findIndex((e) => e.id === data.entityId);
        if (idx !== -1) {
          nextScene.entities[idx] = {
            ...nextScene.entities[idx],
            ...data.changes,
            id: data.entityId,
          };
          updated = true;
        }
      } else if (data.routeId && data.changes) {
        const idx = nextScene.routes.findIndex((r) => r.id === data.routeId);
        if (idx !== -1) {
          nextScene.routes[idx] = {
            ...nextScene.routes[idx],
            ...data.changes,
            id: data.routeId,
          };
          updated = true;
        }
      }

      if (updated) {
        nextScene.sceneVersion += 1;
        state.sceneVersion = nextScene.sceneVersion;
        const changes = diffScenes(scene, nextScene);
        scene = nextScene;
        return {
          context: { state, scene },
          result: { accepted: true, scene, changes },
        };
      }

      return {
        context: { state, scene },
        result: { accepted: false, reason: 'object_not_found' },
      };
    }

    case 'scene.patch': {
      const source = data.source || data.patch?.source;
      if (
        state.metrics.firstSceneInstructionMs == null &&
        source === 'director' &&
        state.startedAt != null
      ) {
        state.metrics.firstSceneInstructionMs = elapsed();
      }

      const rawPatch = data.patch || data;
      const patch = {
        patchId: rawPatch.patchId || `patch-${Date.now()}`,
        sceneId:
          rawPatch.sceneId ||
          state.sceneId ||
          (scene ? scene.sceneId : 'scene-default'),
        baseVersion:
          typeof rawPatch.baseVersion === 'number'
            ? rawPatch.baseVersion
            : scene
              ? scene.sceneVersion
              : 0,
        ops: rawPatch.ops || [],
        reason: rawPatch.reason || 'patch',
        source: rawPatch.source || source || 'director',
        ...(rawPatch.evidenceIds ? { evidenceIds: rawPatch.evidenceIds } : {}),
        ...(rawPatch.priority ? { priority: rawPatch.priority } : {}),
        ...(rawPatch.label ? { label: rawPatch.label } : {}),
        ...(rawPatch.createdAt ? { createdAt: rawPatch.createdAt } : {}),
      };
      const parsedPatch = ScenePatchSchema.safeParse(patch);
      if (!parsedPatch.success) {
        state.invalid.push({
          event: 'scene.patch',
          error: parsedPatch.error.issues,
          patch,
        });
        return {
          context: { state, scene },
          result: { accepted: false, reason: 'invalid_patch' },
        };
      }

      if (!scene) {
        const sid = ensureSafeSceneId(
          parsedPatch.data.sceneId || state.sceneId,
          state.runId ? `scene-${state.runId}` : 'scene-default',
        );
        scene = emptyScene({
          sceneId: sid,
          runId: state.runId,
          origin: ensureSafeOrigin(state.origin, state.title),
          mode: state.mode,
          title: state.title,
        });
      }

      const patchRes = applyScenePatch(scene, parsedPatch.data, {
        now: new Date(currentNow).toISOString(),
      });

      const staleOps = patchRes.rejected.filter(
        (r) => r.reason === 'stale',
      ).length;
      state.metrics.staleOpsCount += staleOps;

      if (patchRes.rejected.some((r) => r.reason === 'scene_mismatch')) {
        return {
          context: { state, scene },
          result: { accepted: false, reason: 'scene_mismatch' },
        };
      }

      const changes = diffScenes(scene, patchRes.scene);
      scene = patchRes.scene;
      state.sceneVersion = scene.sceneVersion;

      return {
        context: { state, scene },
        result: {
          accepted: patchRes.applied.length > 0,
          scene,
          changes,
          applied: patchRes.applied,
          rejected: patchRes.rejected,
          stale: patchRes.stale,
        },
      };
    }

    case 'scene.ready': {
      state.stage = 'D';
      return {
        context: { state, scene },
        result: { accepted: true },
      };
    }

    case 'cinematic.started': {
      state.stage = 'D';
      if (
        state.metrics.firstPlayableShotMs == null &&
        state.startedAt != null
      ) {
        state.metrics.firstPlayableShotMs = elapsed();
      }
      return {
        context: { state, scene },
        result: { accepted: true },
      };
    }

    case 'cinematic.shot.changed': {
      return {
        context: { state, scene },
        result: { accepted: true },
      };
    }

    case 'intelligence.received': {
      state.stage = 'F';
      state.metrics.intelligenceReceivedCount += 1;
      state._lastIntelligenceReceivedAt = currentNow;
      return {
        context: { state, scene },
        result: { accepted: true },
      };
    }

    case 'intelligence.validated': {
      state.metrics.intelligenceValidatedCount += 1;
      if (
        state._lastIntelligenceReceivedAt != null &&
        state.metrics.evidenceToVisualMs == null
      ) {
        state.metrics.evidenceToVisualMs = Math.max(
          0,
          currentNow - state._lastIntelligenceReceivedAt,
        );
      }
      return {
        context: { state, scene },
        result: { accepted: true },
      };
    }

    case 'run.completed': {
      state.runState =
        state.invalid.length > 0 ? 'partially_completed' : 'succeeded';
      if (data.metrics) {
        state.metrics = { ...state.metrics, ...data.metrics };
      }
      if (data.model) {
        state.model = data.model;
      }
      return {
        context: { state, scene },
        result: { accepted: true },
      };
    }

    case 'run.failed': {
      state.runState = 'failed';
      state.error = data.error || data.message || 'run_failed';
      return {
        context: { state, scene },
        result: { accepted: true },
      };
    }

    default: {
      // Legacy events or tooling events
      if (eventName === 'done' && state.runState === 'running') {
        state.runState =
          state.invalid.length > 0 ? 'partially_completed' : 'succeeded';
      } else if (eventName === 'error') {
        state.runState = 'failed';
        state.error = data.error || 'legacy_error';
      }
      return {
        context: { state, scene },
        result: { accepted: true },
      };
    }
  }
}

/**
 * Stateful wrapper around reduceEvent.
 *
 * @param {object} [options]
 * @param {Function} [options.onApply]
 * @param {() => number} [options.now]
 */
export function createRuntimeReducer({ onApply, now = () => Date.now() } = {}) {
  let context = {
    state: initialState(),
    scene: null,
  };

  function ingest(sseEvent) {
    const { context: nextContext, result } = reduceEvent(context, sseEvent, {
      now,
    });
    context = nextContext;
    if (result.accepted && result.changes && typeof onApply === 'function') {
      try {
        onApply(context.scene, result.changes);
      } catch (err) {
        console.error('[runtimeReducer] onApply error:', err);
      }
    }
    return result;
  }

  function applyPatch(patch, { source = 'user' } = {}) {
    return ingest({
      event: 'scene.patch',
      data: {
        patch: {
          ...patch,
          source: patch.source || source,
        },
      },
    });
  }

  function markRendered(at = now()) {
    if (
      context.state.metrics.firstRenderedObjectMs == null &&
      context.state.startedAt != null
    ) {
      context.state.metrics.firstRenderedObjectMs = Math.max(
        0,
        at - context.state.startedAt,
      );
    }
  }

  function reset() {
    context = {
      state: initialState(),
      scene: null,
    };
  }

  return {
    ingest,
    state: () => structuredClone(context.state),
    scene: () => context.scene,
    applyPatch,
    markRendered,
    reset,
  };
}
