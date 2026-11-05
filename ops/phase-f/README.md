# Phase F — honest testing record (UTC 2026-11-03)

Three passes of the three required scenes, each a 60 s / 24 fps / 1280×720 sequence rendered with Blender 4.2 Cycles +
OptiX sharded over H100 GPUs **2, 6, 1** (GPUs 0/3/4/5 remained occupied by Kubernetes-managed DeepSeek pods, see
ops/gpu-host). Raw per-job status JSON, events.jsonl and 2 s nvidia-smi samples sit beside this file; the aggregate is
`metrics-summary.json`. Frames/MP4s stay on the host under `/localstorage/mk.thomas/gev/jobs/<job_id>/` and were served
through the tunnel + the app proxy during the run; thumbnails + full frame 720 of pass 3 are in `frames/`.

| scene | pass | job | ttff (s) | 60 s render wall (s) | fps sustained | × real-time | placed assets | GPU util mean % (2 / 6 / 1) | GPU mem max MiB (2 / 6 / 1) |
|---|---|---|---|---|---|---|---|---|---|
| Yas Mall car crash · dusk | 1 | c4c4919ac7ea | 24.6 | 218.0 | 6.61 | 0.28 | 37 | 29 / 38 / 29 | 4403 / 4403 / 15679 |
| Dubai Marina raid · night | 1 | ee86c262aa2f | 15.9 | 327.4 | 4.40 | 0.18 | 1 (sparse model spec, no repair) | 59 / 61 / 58 | 4375 / 4397 / 15673 |
| Emirates Palace crowd · midday | 1 | 01e0d2366aaf | 20.6 | 284.3 | 5.07 | 0.21 | 57 | 50 / 52 / 44 | 8761 / 8761 / 20037 |
| Yas Mall · dusk | 2 (exposure calibrated, template repair) | f18d1cdceba7 | 30.3 | 254.1 | 5.67 | 0.24 | 102 | 46 / 40 / 39 | see json |
| Dubai Marina · night | 2 | 36f1cbfa48d2 | 19.8 | 360.5 | 3.99 | 0.17 | 103 | 69 / 61 / 69 | see json |
| Emirates Palace · midday | 2 | 9ab743ffbb7c | 35.9 | 302.3 | 4.76 | 0.20 | 81 | 46 / 48 / 34 | see json |
| **Yas Mall · dusk** | **3 (final: + roof imagery, faint roads)** | **32a3969d7aef** | **34.0** | **236.1** | **6.10** | **0.25** | 97 | 25 / 28 / 30 | see json |
| **Dubai Marina · night** | **3** | **770b2a7562c0** | **20.9** | **354.5** | **4.06** | **0.17** | 105 | 61 / 56 / 54 | see json |
| **Emirates Palace · midday** | **3** | **959ffb7e097c** | **40.1** | **292.3** | **4.93** | **0.21** | 122 | 52 / 53 / 42 | see json |

GPU memory stayed ≤ 20 GB per GPU (GPU 1 carries another tenant's 11 GB). Scene-spec model on every run:
`predefined-kimi-k3-fast` (HTTP 200, 6.6–9.2 s, schema-valid each time; the Cerebras fallback was never needed).
Encoding on every run: **libx264** because h264_nvenc fails on this host; MP4s are 49–59 MB each.

## Verdict against the brief's real-time targets
* **ttff ≤ 60 s: MET** on all 9 runs (15.9–40.1 s, of which ≈ 10–16 s is geocode + imagery + OSM + model and ≈ 11–17 s is
  Blender scene build + OptiX BVH per shard).
* **sustained ≥ 24 fps: NOT MET** — 4.0–6.6 fps on 3 GPUs (≈ 0.17–0.28× real-time). Per-GPU shard throughput at 24 spp
  adaptive + OptiX denoise is ≈ 1.5–2.7 fps; linear scaling across all 7 H100s would reach ≈ 10–18 fps, still short.
  Reaching 24 fps needs lower spp / resolution or Eevee-Next (both exposed as `RENDER_SAMPLES` / `RENDER_RES` env knobs,
  not re-measured).

## Side-by-side assessment (compare/side-by-side-*.png: GT 3D · GT 2D · look-dev · pass-1 · pass-3 ×2)
* **Geometry / layout:** satellite ground texture + OSM footprints put the Yas Mall block, its ring road and the Marina
  towers/waterline where the ground-truth views have them (footprint count 40 / 42 / 9; Emirates Palace is sparsely mapped
  in OSM so its grounds read mostly from the imagery). The ground truth is an oblique photoreal 3D-tiles view with far more
  detail (edge density 0.30–0.39 vs 0.07–0.14 in our frames).
* **Lighting / exposure:** pass 1 was ≈ 2 stops hot (frame luma 200–209 vs GT 116–161); after calibration pass-3 lumas are
  113–130 (Yas dusk), 38 (Marina night, GT 82 / look-dev 61 — night is darker than the references because the Dikhololo
  HDRI has no city glow; beacons and emissive cordons provide the only point light) and ≈ 140–150 (Palace midday vs GT 116).
* **Staging:** cordon rings, cones, barriers, patrol cars, ambulance, bus, CCTV sprites and crowd clusters are placed from the
  Kimi spec + template repair; props are stylised CC0 low-poly, so close-ups do not match the look-dev photoreal cars.
  **Honest gap:** these are illustrative staging renders, not photoreal reconstructions, and every frame/MP4/panel carries
  "Illustrative render · not evidence".
* Pass 1 → pass 3 fixes: `_tile()` call bug, glTF join crash, Overpass 406 → OSM API, sparse-spec template repair
  (Marina went from 1 to 105 placed assets), exposure table per time of day, satellite-projected roof caps, road strips
  reduced to faint centrelines so the imagery shows through.
