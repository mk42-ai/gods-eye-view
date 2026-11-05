# Render service integration (Agent 2, in progress)

Owned changes are confined to `render_service/**`. No remote writes, service restarts, git commit/push, Node/frontend or `.env` edits.

## Contract for main / Node proxy

- Existing `POST /render` retained; `POST /render/start` alias added. Accept `prompt`, `lat`, `lon` (legacy `lng`), optional `aoi: [west,south,east,north]`, `locationVerification`, `selectedCoordinates`, `duration_s`, `time_of_day`.
- **No prompt-only city/landmark guessing.** Send `selectedCoordinates: true` only for explicit user-selected coordinates, OR `locationVerification: {verified: true, precision: 'exact', source: '…', featureId: 'node/…|way/…|relation/…'}` for a verified exact match. Missing/rejected evidence is HTTP 422. Unavailable bounded OSM geography fails the job; no generic-road, city or imagery fallback.
- `POST /render/{jobId}/camera`: `{action:'orbit-left'|'orbit-right'|'forward'|'back'|'up'|'down', revision:positiveInteger}` OR `{position:[x,y,z], target:[x,y,z], fovDeg:45, revision:positiveInteger}`. Local metres: +X east, +Y north, +Z up. Returns **new jobId/job_id** and media URLs, same sceneId/patchId; poll/render the new job, not the parent. Revisions are scene-monotonic; stale revisions return 409. Camera moves rejected with 422 if footprint, ground/near-clip or building constraints fail. Pending older camera jobs are cancelled; render-in-progress results cannot publish stale frames.
- Status includes `patch: {id,bounds,origin,localBounds,crs,elevation,provenance,featureIds,verification}`, `sceneId`, `patchId`, `revision`, `pose`, frame records (`id`, SHA256 `hash`, `createdUtc`, `pose`, `sourceIds`, GPU/worker evidence), `latestFrame` and actual measured `fps_sustained`. JPEG frame template added; legacy PNG route kept via conversion.
- Initial/progressive image is 640px JPEG followed by 960px quality JPEG. Neither render throughput nor MJPEG polling is advertised as 24 real fps. Playback cadence remains distinct from measured unique-view production. Camera jobs reuse the exact cached scene source data.
- `POST /render/{jobId}/cancel` added; queue overflow is HTTP 429; unavailable GPU policy is HTTP 503. GPU rendering is UUID-pinned OptiX-only on resolved physical indices 2/6; the host must use one uvicorn process.

## Host compatibility observed read-only

Python 3.10.12; Blender 4.2.3 LTS; FastAPI 0.135.1; Pydantic 2.12.5; Shapely 2.1.2. UUID/PCI mapping confirmed against main inventory for physical GPU 2 and 6. Deployment/test details will be appended after implementation.

## Implementation complete / deployment hand-off

- All three core files were replaced/updated in place after reading their original implementations. New modules: `geography.py`, `camera.py`, `gpu_policy.py`, `worker_pool.py`. `references.py` no longer applies a mall facade to a generic nearby venue. `run.sh` is unchanged.
- New runtime dependency: `pyproj>=3.6,<4`; Shapely minimum is now `2.1` (the actual host is already 2.1.2). Local tests used Python 3.13; all 13 Python files additionally parse against the Python 3.10 grammar. Blender code targets observed 4.2.3. No Blender/real GPU render has been performed by this subagent.
- **78 tests passed** (including real CPU ffmpeg export, offline geography/camera/GPU-policy/queue/API/cancellation fixtures). Public OSM API read-only smoke succeeded in 0.72s for a selected 200m patch: 31 roads, 1 building, 33 version records, ODbL provenance, response SHA256 `8d580ce0b230e3966c847664aa50dc6b1c425a2e3a06a6b719d005e657a4eb13`. A separate default-size real-source CPU feasibility check returned 223 clipped roads (87 drivable), 45 buildings and a valid constrained downward camera. These are source/CPU checks, **not** GPU throughput evidence or exact named-business verification.
- Publish/submit response includes both `jobId` and `job_id`. **Forward `selectedCoordinates` or `locationVerification`**, and carry `revision` per scene; do not auto-upgrade an approximate geocoder result to exact. A prompt without one of those gates is now 422 before GPU admission.
- New cameras cancel superseded jobs (including the initial orbit sequence) so the selected view is not overwritten. Poll the returned new job ID and use `latestFrame.pose`, `latestFrame.hash`, `latestFrame.id`, `latestFrame.gpu`/`workerPid`, `jobHash`, and `unique_views_per_second`. The worker keeps scene state rather than rebuilding every camera update. Cancellation is between GPU frames, not an instantaneous interrupt.
- Legacy `/frames/{id}/{n}.png` still converts JPEG; prefer new JPEG template and immutable frame URL. Archived jobs from the old unverified implementation return **410**; a service restart or evicted scene requires a fresh render before camera movement.
- Export timeline defaults to **2 fps and at most 120 unique sequence frames**, not 24 real fps. Capture throughput must be reported from measured `fps_sustained` / `unique_views_per_second`; no live performance claim has been made.
- `/health` inventory alone does not prove GPU rendering. Main must deploy, create actual frames and correlate `frame.gpu.cyclesDevice`, UUID/PCI and PID with host nvidia-smi. No remote write/restart/stop or git commit/push was performed. See README for exact acceptance/deploy steps.
