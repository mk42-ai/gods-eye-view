# Bounded geographic Blender renderer

Python **3.10+**, Blender **4.2.3 LTS**, one FastAPI/uvicorn process, two persistent Blender slots at most. This is **illustrative staging, not evidence**. OSM footprints/centerlines are contributed geographic data; vehicle arrangements, lighting, materials, heights lacking source tags and all terrain elevation are explicitly approximate. There is no rendered-city, unrelated-image or generic-road fallback.

## Geographic contract

`POST /render` (also `/render/start`) accepts:

```json
{
  "prompt": "Illustrative road incident at the selected point",
  "lat": 24.4886,
  "lon": 54.6085,
  "selectedCoordinates": true,
  "duration_s": 60,
  "time_of_day": "midday"
}
```

The coordinates above are a **selected-coordinate example**, not a claimed exact match for a named business. Use `selectedCoordinates: true` only after explicit selection. For an upstream verified named location instead send `locationVerification: {verified:true, precision:"exact", source:"...", featureId:"node/..."}`. That assertion is trusted only from the authenticated upstream proxy, which must verify the match; this service does not independently geocode names. City-level, district-level and approximate matches are rejected. Legacy `lng` is supported; conflicting `lon`/`lng` is rejected. Optional `aoi` is `[west,south,east,north]`, includes the selected coordinate, and has sides of 100–1200 m. No antimeridian/polar patches.

The WGS84 AOI is transformed using a per-origin ellipsoidal azimuthal-equidistant projection (pyproj), metres, **east +X / north +Y / up +Z**. All OSM buildings, waterways and road surfaces are clipped against the actual densified projected boundary, not a loosely fitted satellite tile rectangle. Polygon holes are retained and triangulated with constrained Delaunay triangles. Incomplete ways, unclosed rings and incomplete multipolygons are omitted with explicit limitations, never stitched with invented edges.

Sources: bounded [OSM API 0.6 map](https://wiki.openstreetmap.org/wiki/API_v0.6#Retrieving_map_data_by_bounding_box:_GET_/api/0.6/map), then bounded [Overpass JSON](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL#out) requests with meta/geometry. Every patch records endpoint, request bounds, retrieval time, source response SHA256, feature versions/timestamps and geometry hashes. Attribution: **© OpenStreetMap contributors, ODbL 1.0** ([copyright](https://www.openstreetmap.org/copyright), [license](https://opendatacommons.org/licenses/odbl/1-0/)). OSM service failure or an empty usable dataset fails the job. No tile provider is used.

Terrain elevation is **unavailable**, with local Z=0 a declared flat reference plane (not sea-level/AMSL). OSM `height` is a contributed attribute, not measured here; `building:levels × 3.2m` and a missing-height 8m default are separately labeled approximations. Roads use source centerlines, source width when usable, otherwise labeled class-width assumptions. Bridges/tunnels/nonzero layers cannot ground staged objects. Grounded instance records identify their exact source road/water polygon; objects with no suitable bounded mapped surface are omitted. The full transformed asset must remain inside the patch. A supplied mall facade reference can apply to a named matching mall only, never an arbitrary neighboring building or palace.

## Camera / publication contract

`POST /render/{jobId}/camera`:

- `{ "action": "orbit-left", "revision": 1 }`, or `orbit-right`, `forward`, `back`, `up`, `down`.
- `{ "position": [x,y,z], "target": [x,y,z], "fovDeg": 45, "revision": 1 }`.

Returns a **new `jobId` / `job_id`** with the same `sceneId`, `patchId`, immutable source data and updated pose. Camera revisions must increase across the whole scene session (409 otherwise). The latest accepted pose is the basis for the next action. The service validates a downward frustum whose **four ground-intersection corners remain within the patch**, near clipping and complete camera-to-target building intersections. Invalid moves return 422; no buildings are hidden or deleted to fake a valid view. Initial camera selection is subject to the same checks. Frame poses are rendered in Blender, not image/CSS transforms.

One immutable geographic/asset scene is retained in each Blender process and reused for compatible camera commands. Cache keys include source versions/hashes, geographic origin/bounds, scene spec, seed, lighting/time and asset/reference hashes. A GPU can retain one scene; evicted scene sessions return 409. There are at most two workers, eight queued commands per worker, four coordinators and twelve admitted jobs. Successive camera revisions coalesce by cancelling superseded work. Cancellation is checked between GPU frames: an in-flight render may finish but **cannot publish** after cancellation/revision change. Each frame has a 180s deadline and at most one replacement-worker retry on the same approved GPU.

`POST /render/{jobId}/cancel` requests cancellation. Status/media routes remain:

- `/status/{jobId}`, `/jobs`, `/stream/{jobId}`
- `/frames/{jobId}/latest.jpg`
- `/frames/{jobId}/{n}.jpg`, immutable per-frame `url` in status
- `/frames/{jobId}/{n}.png` converts the published JPEG for compatibility
- `/video/{jobId}.mp4`

Authentication is bearer token (media also supports `?token=`). An unconfigured token is 503, not anonymous access. Old pre-repair on-disk jobs are rejected with 410; their unverified geography/device claims must not be presented as new verified output.

A job first publishes an 8-sample **640×360 JPEG**, then **960×540** quality JPEG. Initial sequences contain up to 120 separately rendered camera views at a nominal **2 fps export timeline**, reduced for longer requested durations by the frame cap. Sequences stop if their next view would violate geography. Camera jobs return preview + quality for the requested view. MJPEG transmits only new completed frames. **No claim of 24 real fps or realtime throughput is made.** `fps_sustained` and `unique_views_per_second` are measured separately from `timeline_fps`; progressive quality upgrades are not new unique camera views. libx264 CPU encoding is allowed and has its own time bound.

Publication occurs only after GPU result identity validation, JPEG decoding and SHA256 verification; file moves/manifests are atomic. Frame records include id, byte hash, creation UTC, actual pose, all source IDs, patch/scene IDs, request/job hash, worker PID, selected Cycles ID/name/type, authorized UUID/PCI and elapsed render time. Identical byte frames can still occur (e.g., a homogeneous scene); metadata never fabricates a distinct hash. Preview/quality images are immutable; `/latest.jpg` points to the latest published one.

## GPU policy

`nvidia-smi --query-gpu=index,uuid,pci.bus_id,name` is parsed at startup admission and at each worker launch. Only these **physical** identities are permitted:

| Physical index | Required UUID                            | Required PCI bus |
| -------------- | ---------------------------------------- | ---------------- |
| 2              | GPU-b2aff670-0bcc-b834-af70-421466084d30 | 00000000:45:00.0 |
| 6              | GPU-2c78264d-f20e-47cb-3976-a85395cbad55 | 00000001:45:00.0 |

Each child gets `CUDA_VISIBLE_DEVICES=<resolved UUID>`, not a numeric CUDA ordinal. All Cycles devices are disabled first, then exactly one **PCI-matched OPTIX** device is enabled; CPU remains disabled. Missing/mismatched/ambiguous hardware, unauthorized `RENDER_GPUS`, or absent OptiX fails closed. All initial, progressive, camera and retry paths call this same policy. The only separate export path is CPU libx264; it cannot select a GPU. `/health` reports configured inventory, workers and policy; **a healthy inventory is not proof of a successful GPU render**. Use actual frame GPU/PID evidence and host process telemetry for live acceptance.

## Install / validate / deploy (operator-owned)

1. Copy the reviewed **whole `render_service/` tree**, including modules/references, to the existing approved service location. This change does not copy assets or modify existing secret configuration.
2. Install `python3 -m pip install -r render_service/requirements.txt` in the approved service Python environment. New dependency: pyproj; Shapely **2.1+** is required for constrained triangulation (host observed 2.1.2). Blender imports only standard-library helpers plus its bundled bpy/mathutils; it does not need pyproj/Shapely installed into Blender Python.
3. Keep existing asset directories, Blender binary, secret file and port. The existing `run.sh` remains unchanged. Restart only the explicitly approved renderer via the main operator; do not touch unrelated GPU processes/services. Do not run two renderer services concurrently; **uvicorn --workers 1** is required.
4. Install pytest for local tests and run `PYTHONDONTWRITEBYTECODE=1 GEV_ROOT="$PWD" python3 -m pytest -q -p no:cacheprovider render_service` from the repository. Tests use mocks/fixtures for GPUs and Blender and never read secrets. A CPU ffmpeg export test runs when ffmpeg is available.
5. Live acceptance: start one explicitly selected or exact-verified patch; require first preview + quality JPEG, camera revision produces a changed pose/new job/image, and status hashes match the downloaded bytes. Check `frame.gpu`, `workerPid`, `jobHash`, `sourceIds`; correlate worker PIDs with read-only nvidia-smi compute-process UUIDs. Repeat with both approved worker identities. Reject any CPU/nonapproved render. Verify source outage, invalid/ambiguous location, stale revision and out-of-patch camera errors.

No renderer process, service, Kubernetes object, environment file or asset was modified remotely by this implementation. Runtime logs live under `$GEV_ROOT/runtime/worker_*/blender.log`; per-job `events.jsonl`, `scene.json`, `job.json` and media live under `$GEV_ROOT/jobs/{jobId}`. Retention/pruning of on-disk jobs/logs is an operator task; in-memory state/queues are bounded.
