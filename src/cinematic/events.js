/**
 * Typed SSE event contract for the Live Cinematic Intelligence Engine.
 *
 * Shared by the server emitter (server/scene-plans/index.js + director) and
 * the browser reducer (src/cinematic/sceneRuntime.js). Dependency-free.
 *
 * Every frame: `id: <runId>:<seq>` (monotonic per run), `event: <name>` and a
 * JSON `data` object that ALWAYS carries the correlation envelope
 * `{ runId, sceneId, sceneVersion, seq, traceId, t, elapsedMs }`.
 * Legacy events (`status`, `thinking`, `plan`, `element_added`,
 * `narration_token`, `usage`, `done`, `error`, `resume_unavailable`) remain
 * emitted for older clients; new clients act on the typed set below.
 */

export const CINEMATIC_EVENTS = Object.freeze([
  'run.started',
  'model.selected',
  'scene.planning',
  'asset.loading',
  'asset.ready',
  'scene.initialized',
  'scene.object.created',
  'scene.object.updated',
  'scene.patch',
  'scene.ready',
  'cinematic.started',
  'cinematic.shot.changed',
  'intelligence.received',
  'intelligence.validated',
  'tool.started',
  'tool.completed',
  'tool.failed',
  'answer.delta',
  'answer.completed',
  'run.completed',
  'run.failed',
]);

export const LEGACY_EVENTS = Object.freeze([
  'status',
  'thinking',
  'plan',
  'element_added',
  'snap_batch_progress',
  'narration_token',
  'usage',
  'done',
  'error',
  'resume_unavailable',
]);

const KNOWN = new Set([...CINEMATIC_EVENTS, ...LEGACY_EVENTS]);
export const isKnownEvent = (name) => KNOWN.has(name);

/** Progressive construction stages (Stage A–F). */
export const STAGES = Object.freeze({
  A: 'geographic_world',
  B: 'planning',
  C: 'initial_assets',
  D: 'first_playable_shot',
  E: 'enrichment',
  F: 'live_intelligence',
});

/** Execution states — the ONLY values the UI may show. */
export const RUN_STATES = Object.freeze([
  'idle',
  'queued',
  'running',
  'partially_completed',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
]);

/** Runtime modes — never conflated on one scene. */
export const RUNTIME_MODES = Object.freeze({
  SIMULATION: 'cinematic_simulation',
  RECONSTRUCTION: 'evidence_driven_reconstruction',
  LIVE: 'live_intelligence_visualization',
});

/**
 * Build the correlation envelope merged into every event payload.
 * @param {{runId:string,sceneId?:string|null,sceneVersion?:number,traceId?:string,startedAt?:number}} run
 * @param {number} seq
 */
export function envelope(run, seq, now = Date.now()) {
  return {
    runId: run.runId,
    sceneId: run.sceneId ?? null,
    sceneVersion: Number.isFinite(run.sceneVersion) ? run.sceneVersion : 0,
    seq,
    traceId: run.traceId || run.runId,
    t: new Date(now).toISOString(),
    elapsedMs: Math.max(0, now - (run.startedAt ?? now)),
  };
}

/** Instrumented milestones (ms after run.started) — see docs/evidence report. */
export const METRIC_KEYS = Object.freeze([
  'ttftMs', // first answer.delta from the director model
  'firstSceneInstructionMs', // first scene.patch / scene.object.created from the director
  'firstRenderedObjectMs', // client: first entity added to Cesium
  'firstPlayableShotMs', // cinematic.started
  'evidenceToVisualMs', // intelligence.received → scene.object.* applied
  'fps',
  'heapUsedMb',
]);
