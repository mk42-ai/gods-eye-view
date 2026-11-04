# Live Cinematic Intelligence Engine — module contract (2026-11-01)

Shared by the four parallel work packages. Files listed under an owner are edited ONLY by
that owner during the parallel phase; the orchestrator integrates afterwards. Already present
(do not rewrite, extend only through the owner): `src/cinematic/assetIds.js`,
`src/cinematic/events.js`, `src/cinematic/sceneSchema.js`, `src/cinematic/qaCommands.js`,
`public/scene-icons/*` (30 keys, manifest v3), `public/models/cinematic/*.glb`.

Conventions: ES modules, Node 22 `node:test` tests next to the module (`*.test.mjs`), no new
npm dependencies, no secrets in code/logs/tests, `server/` may import `src/cinematic/*` and
`src/scenes/*` (pure modules only); `src/` never imports `server/`.
Browser code must survive React-free DOM (`document`), run with Cesium 1.124 (`import * as
Cesium from 'cesium'`), and never destroy/recreate the viewer.

## A — OnDemand runtime (owner: Agent 1) — `server/ondemand/runtime/*`, `server/scene-plans/director.js`, `server/scene-plans/qa.js`, `server/scene-plans/cinematic-routes.js`

Live API facts (probed 2026-11-01T12:46Z, see `docs/evidence-2026-11-01-cinematic/ondemand-live-registry.txt`):
* `POST {base}/chat/v1/sessions` body `{externalUserId, pluginIds?}` → 201 `{data:{id}}`.
* `POST {base}/chat/v1/sessions/{id}/query` body `{query, endpointId, responseMode:'stream'|'sync', pluginIds?, fulfillmentOnly?, reasoningEffort?, modelConfigs?{fulfillmentPrompt,temperature,topP,stopSequences,…}}`.
  Stream frames: `event:message` + `data:{sessionId,messageId,status:'processing',eventIndex,answer:'<delta>',eventType:'fulfillment'}`;
  `data:{…,eventType:'metricsLog',publicMetrics:{inputTokens,outputTokens,totalTokens,ragTimeSec,fulfillmentTimeSec,totalTimeSec}}`;
  `event:heartbeat` + `data:{sessionId,messageId,time}`; final `data:[DONE]`. Deltas may contain several tokens; accumulate.
* `GET {base}/config/v1/public/endpoints` → `{data:[{endpoint_id,endpoint_name,model_id,status:'active'|'inactive'|'deployed',streaming_supported,context_length,reasoning_efforts:[…]|null,endpoint_type?}]}` (98 rows).
* Auth: `apikey` header from `server/ondemand/config.js` (`config.apiKey`, env `ONDEMAND_API_KEY`); use `ondemandFetch` from `server/ondemand/client.js` like `server/scene-plans/transport.js` does. Never log/echo the key.
* `predefined-gpt-6.1-sol-ultra-fast` does not exist (HTTP 400). Cerebras-backed endpoint: `predefined-cerebras-qwen-3.8-27b` (active, streaming, ctx 128k, reasoning low/medium/max).

### `server/ondemand/runtime/model-registry.js`
```js
export function createModelRegistry({ fetchImpl?, getSettings?, ttlMs = 300000, now? })
  .list({ refresh?: boolean }) → Promise<{ fetchedAt, source:'live'|'cache'|'unavailable', models: ModelInfo[] , error?: string }>
  .isAvailable(endpointId) → Promise<boolean>          // status==='active'||'deployed' from the LIVE list; never invented
  .pickForTask(task, { prefer?: string[] }) → Promise<ModelInfo|null>   // tasks: 'scene_direction','camera_direction','scene_patch','event_interpretation','qa','rapid_revision','planner','research','narration'
  .assignments() → Record<task, endpointId>            // env SCENE_MODEL_<TASK> overrides, else Cerebras-first default order
  .health() → { cached:boolean, fetchedAt, count, cerebrasAvailable:boolean }
ModelInfo = { endpointId, name, modelId, provider ('cerebras'|'openai'|'anthropic'|'google'|'deepseek'|'xai'|'meta'|'moonshot'|'zai'|'qwen'|'minimax'|'byoi'|'byom'|'other' derived from ids), status, available:boolean, streaming:boolean, contextLength:number|null, reasoningEfforts:string[], cerebras:boolean, premium?:boolean }
```
Default preference per task: Cerebras active endpoints → `predefined-gpt-6.1-sol` → any active streaming endpoint. `planner` keeps `SCENE_PLAN_ENDPOINT_ID` (existing env) when available.

### `server/ondemand/runtime/sessions.js`
```js
export function createSessionManager({ transport?, ttlMs = 1500000, maxSessions = 200, now? })
  .acquire({ purpose, pluginIds = [], reuse = true, signal }) → Promise<{ id, externalUserId, pluginIds, purpose, createdAt, lastUsedAt, refs }>
  .release(id)                      // decrements refs; a session with refs>0 is NEVER evicted/reset
  .reset(purpose)                   // forget sessions for purpose (next acquire creates); refuses while refs>0 (returns {reset:false, reason:'active_stream'})
  .cleanup({ now }) → { evicted:number }   // TTL/LRU, idle only
  .stats() → { total, active, byPurpose }
```
Strict separation: session ids are OnDemand `sessions.data.id`; model ids are `endpointId`s; the manager never stores a model id inside a session record and never deletes a session mid-stream.

### `server/ondemand/runtime/stream-adapter.js`
```js
export async function streamQuery({ fetchImpl?, getSettings?, sessionId, query, endpointId, pluginIds?, fulfillmentOnly=true, reasoningEffort?, modelConfigs?, signal, onDelta(text, { eventIndex, elapsedMs }), onMetrics(publicMetrics), onHeartbeat?(), timeoutMs=120000, firstByteTimeoutMs=30000 })
 → { answer, messageId, sessionId, ttftMs, firstByteMs, totalMs, deltas, outputTokens|null, inputTokens|null, tokensPerSec|null, publicMetrics|null, endpointId, aborted:false }
export function parseOnDemandSseFrames(chunkText, state) → { events:[{event, data}], state }   // incremental, handles partial frames, [DONE], heartbeat
```
Errors: non-2xx → `OnDemandStreamError{status, code:'provider_request_failed'|'endpoint_invalid'(400 invalid endpointId)|'rate_limited'(429)|'provider_unavailable'}`; abort → `AbortError`; stream with 0 deltas and no [DONE] within timeout → `code:'stream_timeout'`. Never retries after first byte.
Also `export function createNdjsonAccumulator(onLine)` — feeds deltas, splits on `\n`, tolerates `\r`, strips ``` fences, yields complete lines.

### `server/scene-plans/director.js` — Cinematic Director
```js
export function createCinematicDirector({ registry, sessions, streamQuery?, now?, log? })
  .direct({ prompt, origin:{name,lat,lon,approximate?,precision?,confidence?}, researchedRoutes?:[{name,coordinates:[[lon,lat],…]}], scenarioHint?, mode?, durationHint?, sceneId, runId, endpointId?, signal, emit(eventName, data), repairBudget = 1 })
   → Promise<{ scene: CinematicScene (validated), model:{endpointId,modelId,provider,ttftMs,tokensPerSec,outputTokens,latencyMs}, invalidLines:[{error,line}], repairs:number, assetSubstitutions:[…] }>
```
Prompt = system framing (illustrative/hypothetical, never factual; no tactical detail for police scenes; label hypothetical air raids) + `DIRECTOR_LINE_SPEC` + the list of REGISTERED ASSET IDS from `src/cinematic/assetIds.js` (grouped by category) + origin + researched routes (only these may be copied into `route.coordinates`) + required scenario shape rules (marathon: runners with `run` behaviour along the route, spectators `crowd`, barriers, moving traffic `drive`; police_response: units `drive`+`arrive`, officers, cordon barriers, command post; air_raid_hypothetical: aircraft `fly` paths, effects, `hypothetical:true` on every entity/effect, labels contain "HYPOTHETICAL").
Streaming: `streamQuery(responseMode stream)` → `createNdjsonAccumulator` → `parseDirectorLine` per line → for valid lines `emit`:
`answer.delta` (every delta, with `{text}`), `scene.planning` once at first delta, `scene.object.created` for entity/route/effect, `cinematic.shot.changed` is NOT emitted here (that is the browser), `scene.patch` for shots/beats/timeline/classification as `{patch: ScenePatch}` where ops are the matching `add_shot`/`add_timeline_event`/`set_classification`/`set_title`, `answer.completed` at `[DONE]`.
Before zod: normalise `entity.assetId` with `resolveAssetId` (record substitution, `reason`), clamp numbers into range, default `uncertainty:'illustrative'`. Repair: if after `end` the scene has < 3 entities or 0 shots or 0 beats or any invalid lines, ONE follow-up query in the SAME session: "Re-emit ONLY the following corrected/missing lines…" and merge. Final scene passes `CinematicSceneSchema`; otherwise throw `DirectorError{code:'director_invalid'}` with the first issues (the route returns `run.failed`).
Model selection: `endpointId` param → `registry.pickForTask('scene_direction')`; emit `model.selected {endpointId, modelId, provider, cerebras, reason}` first.

### `server/scene-plans/qa.js`
```js
export function createSceneQa({ registry, sessions, streamQuery?, log? })
  .ask({ question, context (from buildQaContext), sceneId, endpointId?, signal, onDelta? })
   → { answer, commands:[QaCommand], model:{endpointId,modelId,ttftMs,latencyMs,tokensPerSec}, repaired:boolean }
```
Uses `QA_COMMAND_SPEC`; validates with `validateQaResponse`; one repair attempt; a free-text answer with `commands:[]` is a valid outcome. The server NEVER claims a command succeeded.

### `server/scene-plans/cinematic-routes.js`
`export function createCinematicMiddleware({ registry?, sessions?, director?, qa?, env? })` returning `(req,res) => Promise<void>` handling (paths are relative, orchestrator mounts under `/api/ondemand/v2/scene-plans`):
* `GET  /models` → `{ok:true, fetchedAt, source, models:[ModelInfo], assignments, cerebrasAvailable}`
* `POST /models/check` `{endpointId}` → `{ok, endpointId, available, model?}` (live check, 400 for malformed)
* `POST /director/stream` `{prompt, origin, researchedRoutes?, sceneId?, runId?, endpointId?, mode?, scenarioHint?}` → SSE using `createSceneEventStream` from `./stream.js` (events above + `run.started`, `run.completed {scene, model, metrics}` / `run.failed {code,message}`); honour `Last-Event-ID`; abort on client close.
* `POST /qa` `{question, context, sceneId, endpointId?}` → JSON `{ok, answer, commands, model}`; errors `{ok:false,error:{code,message}}` with proper status (400 validation, 503 not configured, 502 provider, 504 timeout).
* `POST /patch/validate` `{patch}` → `{ok, patch}` or 400 with zod issues (used by the test-injection UI and the live-intelligence path).
Error envelope and `x-ondemand-key`/`apikey` header rejection exactly like `createScenePlanMiddleware` in `server/scene-plans/index.js`.

Tests (mock fetch; NO live calls in unit tests): registry parse/availability/pick order/env overrides/cache TTL; session lifecycle incl. refs & never-delete-active; SSE frame parser with split chunks/heartbeat/[DONE]/metrics; NDJSON accumulator; director happy path + invalid line + asset substitution + repair; qa validation + repair; routes (models/qa/patch/validate/director stream headers + event order). Live probe scripts (optional, `scripts/qa-cinematic-live-ondemand.mjs`) may use `ONDEMAND_API_KEY=$ON_DEMAND_API_KEY` from the environment and must redact.

## B — Cesium cinematic runtime (owner: Agent 2) — `src/cinematic/geoSceneContext.js`, `src/cinematic/assetRegistry.js`, `src/cinematic/sceneRuntime.js`, `src/cinematic/cameraDirector.js`, `src/cinematic/playbackController.js`, `src/cinematic/effects.js`, `src/cinematic/runtimeReducer.js`

### `geoSceneContext.js`
```js
export function createGeoSceneContext({ viewer?, origin:{lat,lon,heightM?,name}, boundsRadiusM = 1500 })
  .origin, .frame (Matrix4 from Cesium.Transforms.eastNorthUpToFixedFrame), .inverseFrame
  .localToCartesian({eastM,northM,heightM=0}) → Cartesian3 (ECEF)
  .localToCartographic(local) → {lat,lon,heightM}
  .cartesianToLocal(c3) → {eastM,northM,heightM}
  .wgs84ToLocal({lat,lon,heightM?}) → local
  .headingToQuaternion({eastM,northM}, headingDeg) → Quaternion (HeadingPitchRoll in ENU frame)
  .bounds() → {west,south,east,north} degrees, .rectangle() → Cesium.Rectangle
  async .sampleTerrain(viewer, positions:[{lat,lon}]) → {heights:number[], sampled:boolean, source:'sampleTerrainMostDetailed'|'ellipsoid'|'unavailable'}   // never throws; flags approximation
  .groundHeightAt(local) → number (cached from samples, 0 = ellipsoid when unsampled)
```
Pure math must have unit tests against `Cesium.Cartesian3.fromDegrees` round-trips (|err| < 1e-6 m at 1 km) at Burj Khalifa (25.1972, 55.2744) and Umm Suqeim.

### `assetRegistry.js` (browser)
Wraps `src/cinematic/assetIds.js`: `createAssetRegistry({ fetchImpl?, log? })` with `.preload(ids) → {ready:[], failed:[{id,reason}]}` (HEAD/GET of sprite PNG / GLB; missing → mark unavailable), `.billboardFor(assetId, {scale})` → `{image, width, height, substituted, asset}`, `.modelFor(assetId)` → `{uri, asset}|null`, `.resolve(id)` → `resolveAssetId(id,{unavailable})`, `.substitutions()` log, `.emit` of `asset.loading` / `asset.ready` through an `onEvent` callback.

### `runtimeReducer.js` (pure, Node-testable)
```js
export function createRuntimeReducer({ onApply?, now? })
  .ingest(sseEvent:{id,event,data}) → { accepted:boolean, reason?: 'stale_seq'|'stale_version'|'unknown_event'|'scene_mismatch'|'invalid_patch', scene?: CinematicScene, changes?: diff }
  .state() → { runId, sceneId, sceneVersion, lastSeq, runState (RUN_STATES), metrics:{ttftMs,firstSceneInstructionMs,…}, model, stage:'A'..'F', invalid:[…] }
  .scene() → CinematicScene|null
  .applyPatch(patch, {source}) → applyScenePatch result (local patches, e.g. Q&A / test injection)
  .reset()
```
Rules: events with `data.seq <= lastSeq` for the same runId are dropped (`stale_seq`); a new `runId` resets; `scene.patch` with `baseVersion` older than current is applied op-by-op through `applyScenePatch` (stale ops rejected, counted); `run.failed`/`run.completed`/`answer.*` update runState + metrics; `scene.object.created` adds the entity/route/effect (validated with zod, invalid → `invalid[]`, never thrown); legacy `element_added`/`plan`/`done` are accepted for metrics only (no scene mutation).

### `sceneRuntime.js` (Cesium)
```js
export function createSceneRuntime({ viewer, document, assets?, onEvent?, log? })
  .attach(scene:CinematicScene) / .update(scene, changes?)  // incremental: diff ids, create/update/remove entities in ONE CustomDataSource 'cinematic-scene'; batch all DOM/Cesium writes per requestAnimationFrame (queue + flush)
  .context → GeoSceneContext; .dataSource
  .entityById(id) → Cesium.Entity|null;  .positionAt(id, sec) → Cartesian3|null
  .setHighlight(id, on, alertState?), .select(id)/.selected()
  .snapshot() → { sceneId, sceneVersion, entities:[{id,label,assetId,lat,lon,heightM,visible,behavior}], routes:[{id,closed}], shots:[…], playback } // for QA confirmation + evidence
  .destroy()
```
Entities: billboards from `assetRegistry.billboardFor` (`heightReference: CLAMP_TO_GROUND` unless `position.heightM`/aircraft), labels ≤ 48 chars with halo (reuse `STAGING_LABEL_FONT` idea), `count>1` → up to 60 billboards spread in a disc/along path (deterministic PRNG seeded by id), `uncertainty`: illustrative = teal, approximate = amber dashed outline label suffix "≈", verified = mint + `sprite.alert.state_4` badge; `hypothetical` → label prefix "HYPOTHETICAL ·". Behaviours → `SampledPositionProperty` (+ `VelocityOrientationProperty`/heading quaternion) over `[start, start+durationSec]` in **scene clock time** (see playback) with `path` waypoints or synthesized (drive along route coordinates when `followEntityId`/route tag matches; orbit; hover). Routes → polylines; `closed:true` → red dashed material + `sprite.signage.road_closed` billboard at midpoint + label "ROAD CLOSED (illustrative)" when provenance.kind==='test' or 'generated'. Effects (`effects.js`): `Cesium.ParticleSystem` for smoke/fire/dust bound to the entity position; `emergency_lights` toggles billboard color red/blue by clock; `haze` = fog density tweak restored on removal. All effect/model loads must fall back gracefully (`asset.loading`/`asset.ready`/failed through `onEvent`).

### `playbackController.js`
```js
export function createPlaybackController({ viewer, onChange? })
  .load(scene)   // sets viewer.clock.startTime/stopTime from a fixed epoch (JulianDate of scene.provenance.generatedAt or 2026-01-01T00:00Z) + durationSec, clockRange CLAMPED, multiplier 1, shouldAnimate false
  .play() .pause() .resume() .restart() .seek(sec) .setSpeed(x) .positionSec() .durationSec() .state() → {state,positionSec,speed,cameraMode,followEntityId,live}
  .setCameraMode('cinematic'|'follow'|'free', {entityId?}) .follow(entityId) .returnToCinematic()
  .selectEvent(beatIndex|atSec)
  .setLive(bool)  // live mode: clock tracks now; new evidence never rewinds; replay mode: clock bounded
  .onTick(cb) → unsubscribe  // called from viewer.clock.onTick with {sec, julian}
  .extendDuration(sec)  // when a patch appends a later beat — never moves positionSec backwards
```
Deterministic: `seek(t)` twice yields identical `positionSec` and identical `positionAt(id,t)`; survives re-renders (idempotent `load` for same sceneId/version keeps position).

### `cameraDirector.js`
```js
export function createCameraDirector({ viewer, context, runtime, playback, onShotChanged? })
  .setShots(shots) .currentShot(sec) .enable(bool) .interrupt(shot, {reason, priority}) .release()
  .poseForShot(shot, sec, {subjectPositions}) → {position:Cartesian3, heading, pitch, roll}   // pure for tests given a context
  .tick(sec)  // called on preRender when enabled & cameraMode==='cinematic'; eased interpolation between shot poses (ease_in_out etc.), subject tracking (centroid of subjectIds at time sec), orbit = heading sweep over duration, vehicle_follow = chase cam behind heading, terrain/clipping check (camera height ≥ ground + 5 m via context.groundHeightAt; never below), no camera.flyTo spam: ONE smooth per-frame setView
```
Shot scheduling: sort by startSec; interruption only when `priority` ≥ current shot priority and current `interruptible`; low-priority interrupts are queued as annotations (returned to the Live Intelligence Director). `cinematic.shot.changed` through `onShotChanged({shot, at})`.

Tests: reducer (stale drop, version, invalid patch), geo transforms, playback determinism (fake clock), camera poses (no NaN, height ≥ ground, orbit sweep monotonic), runtime snapshot with a fake viewer (pattern: `src/incidents/ui/sceneStagingLayer.test.mjs` fake DOM + real Cesium in Node).

## C — Snapchat + evidence + live intelligence (owner: Agent 3) — `server/scene-footage/metrics.js`, `server/scene-footage/evidence-pipeline.js`, `server/scene-footage/routes.js`, `server/scene-footage/snapchat.js`, `server/scene-footage/fanout.js`, `src/cinematic/liveIntelligenceDirector.js`, `src/sceneFootage/*` (metrics display), `scripts/qa-snapchat-live-probe.mjs`

* `metrics.js`: `createFootageMetrics()` → `.start(step)`, `.success/.failure(step, {status})`, `.rateLimit({remaining, resetAt})`, `.batch({jobId,state})`, `.record({raw, unique, duplicates, relevant})`, `.snapshot()` → `{requestsAttempted, requestsSucceeded, requestsFailed, results, unique, duplicates, relevant, activeBatchJobs, rateLimit:{state:'ok'|'throttled'|'unknown',remaining?,resetAt?}, startedAt, finishedAt, errors:[{step,status,code}]}` — populated ONLY from executed requests (ladder + fan-out), returned in the `/footage/snapchat` response as `metrics` and rendered in `src/sceneFootage/panel.js` ("Requests 7/7 ok · 12 results · 9 unique · 3 dup · 4 relevant · batch: unavailable (405)").
* Transport: direct plugin queries only (`POST /chat/v1/sessions` + `POST /chat/v1/sessions/{id}/query`, sync, `pluginIds`), verified live with `scripts/qa-snapchat-live-probe.mjs` (key from env, redacted); evidence under `docs/evidence-2026-11-02-direct-plugin/`. The earlier multi-query transport experiment was removed on 2026-11-02 (user instruction).
* Pagination/cursor: the Snapchat plugin is an OnDemand chat plugin (`plugin-1792945050`, operation `fetchSnapchatVideosByPlace({places,limit})`); document what it supports (limit only? cursor?) by inspecting its response under `scripts/qa-snapchat-live-probe.mjs` (sequential pagination attempt with increasing `limit`, time-window partition prompts, geographic partition across neighbourhood variants, bounded concurrency = existing fan-out). Record the real numbers (requests, unique, duplicates, errors) to `docs/evidence-2026-11-02-direct-plugin/snapchat-direct-probe/snapchat-direct-probe.json`. Never invent endpoints.
* `evidence-pipeline.js`: `normalizeClips(clips, {scene:{lat,lon}, retrievedAt})` → `EvidenceSchema[]` (ids `ev-snap-<storyId>`), `dedupeEvidence`, `clusterEvidence({timeBucketMin=30})`, `evidenceToPatch({evidence, sceneId, baseVersion, origin, maxMarkers=40})` → validated `ScenePatch` (`source:'intelligence'`, ops `add_evidence` + `add_entity` markers: verified → `sprite.alert.state_4`, `uncertainty:'verified'`, local position from lat/lon via equirectangular offset; candidate → `sprite.alert.state_2`, `uncertainty:'approximate'`, placed on a deterministic ring (radius 60–140 m by hash) with label "Snapchat · unverified location", provenance `{kind:'evidence', evidenceId, url, tier}`) + `add_timeline_event` per cluster. Route: `POST /api/scenes/:locationId/footage/snapchat` accepts optional `{sceneId, baseVersion}` and returns `patch` alongside clips. Also `POST /api/scenes/:locationId/footage/evidence/patch` `{records:[Evidence], sceneId, baseVersion}` for other sources/test injection.
* `src/cinematic/liveIntelligenceDirector.js` (pure logic + thin runtime hooks):
```js
export function createLiveIntelligenceDirector({ runtime, playback, cameraDirector, onEvent?, autoDirect = true, now? })
  .setAutoDirect(bool) .autoDirect()
  .receive({ patch, priority:'low'|'normal'|'high', relevance:0..1, source }) → { applied, rejected, camera:'interrupted'|'queued'|'annotated'|'none', eventId }
  .queue() .flushQueue() .feed() → [{at, source, summary, tier, camera, sceneVersion}]
  .onScenePatchEvent(sseEvent)  // from reducer: intelligence.received → validate → apply → intelligence.validated
```
Rules: never rewind playback; high relevance (≥ 0.7, or priority 'high') AND autoDirect → `cameraDirector.interrupt(overhead_intelligence shot above the new markers, 8 s, priority 90)`; otherwise annotate (highlight + feed entry) and queue. Tests cover queue/annotate/interrupt and the toggle.

## D — UI, QA harness, regression tests (owner: Agent 4) — `src/cinematic/ui/*`, `src/cinematic/qaExecutor.js`, `src/sharelink.hashKeys.test.mjs`, `scripts/qa-cinematic.mjs`, `src/cinematic/debugApi.js`

* `qaExecutor.js`: `createQaExecutor({ runtime, playback, cameraDirector, reducer, liveDirector })` `.execute(commands) → [{command, ok, confirmed:boolean, before, after, diff, reason?}]` — executes validated commands against the runtime and CONFIRMS by reading state back (`runtime.snapshot()`, `playback.state()`, camera pose); `explain_change` reads `scene.history` + provenance.
* `ui/cinematicPanel.js`: mounts `#cinematic-panel` (dark theme, matches `.scene-studio` styles) containing: mode label (one of the 3 modes, never conflated), Stage A–F progress with timestamps (`#cinematic-stages`), model chip (`#cinematic-model`: endpointId · TTFT · tok/s from REAL deltas), metrics strip (`#cinematic-metrics`: first instruction, first object, first playable shot, FPS, heap), run state badge (`#cinematic-run-state`, values = RUN_STATES only), model picker (`#cinematic-model-picker`, options from `GET /api/ondemand/v2/scene-plans/models`, per-task assignment select; selection persisted in localStorage `gev.cinematic.models.v1`), auto-direction toggle (`#cinematic-autodirect`), live feed (`#cinematic-feed`), test-injection button (`#cinematic-inject-closure` → builds a labelled `test_injection` road-closure patch for the first route or a synthetic 2-point route near origin, applies through the live director), playback controls (`#cinematic-play`, `#cinematic-pause`, `#cinematic-restart`, `#cinematic-seek` range, `#cinematic-speed`, `#cinematic-camera-mode`), Q&A form (`#cinematic-qa-form`, `#cinematic-qa-input`, `#cinematic-qa-log`) calling `POST /api/ondemand/v2/scene-plans/qa` with `buildQaContext(...)` then `qaExecutor.execute` and printing confirmed/failed per command. Expose `mount({document, container, runtime, playback, cameraDirector, reducer, liveDirector, client})`.
* `debugApi.js`: `installDebugApi(window, deps)` → `window.__gevCinematic = { scene(), state(), metrics(), events() (ring of last 2000 SSE events with t), snapshot(), applyPatch(p), inject(kind), playback, camera(), qa(question), setModel(task,id), fps() }` used by the QA script and by the evidence report.
* `src/sharelink.hashKeys.test.mjs`: regression that the 27 approved keys (`v lat lon alt heading pitch roll style bloom sharpen bi bv si hud hv dm dd da kf ko cr sc scf map l lo ui`) are ALL produced by `ShareLinkManager.prototype._buildHashParams` with a minimal fake viewer/camera and providers, and round-trip through `scripts/qa-scene-videos.mjs`'s `APPROVED_HASH` parser; fail if a key is dropped or renamed.
* `scripts/qa-cinematic.mjs`: puppeteer (repo devDependency + `/usr/bin/chromium`, own process group, hard kill on exit, wall-clock cap) driving a deployed URL for Demos A–I at 1440×900 and 390×844: type prompt in `#incident-composer-input`, click `#incident-composer-submit`, wait for `window.__gevCinematic.state().runState` ∈ {succeeded, partially_completed, failed} (cap 240 s), capture: screenshots at first playable shot / mid / final, SSE trace (`events()`), metrics, scene snapshot, console errors, network failures, FPS (rAF counter over 3 s), heap (`performance.memory` when present); Demo B injects a closure via `inject('road_closure')` and verifies diff; Demo H runs Q&A commands and records before/after snapshots; Demo I forces a failure (`window.__gevCinematicForceModel='predefined-does-not-exist'` → expect `run.failed` and run-state ≠ succeeded); Demo F switches models via `setModel`. Output JSON + Markdown to `--out` dir. Must tolerate missing features (mark `not_run` with reason).

## Orchestrator-owned (do NOT edit): `server/scene-plans/index.js`, `server/ondemand/foundation/proxy-route.js`, `src/incidents/ui/index.js`, `src/incidents/ui/composer.js`, `src/incidents/client.js`, `src/scenes/geographicScene.js`, `style.css`, `package.json`, docs.
