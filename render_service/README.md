# render_service — Gods-Eye View hyper-real render pipeline (H100 host)

FastAPI service that turns a prompt into a path-traced, satellite-textured staging render of the scene
(Blender 4.2 Cycles + OptiX on the host's free H100s), streams frames (MJPEG) and encodes a 60 s MP4 (NVENC).
Every output is labelled **Illustrative render · not evidence**.

Pipeline: geocode (known-places table → Nominatim) → land patch (Esri World Imagery tiles + OSM buildings/roads via
Overpass; Google 3D Tiles not used — no Google key on the host) → Scene Spec via OnDemand Chat API
(`predefined-kimi-k3-fast` → `predefined-cerebras-qwen-3.8-27b` → scenario template) → shapely placement from
`assets/manifest.json` → Cycles/OptiX frame shards per GPU → ffmpeg h264_nvenc.

Run on the host: `render_service.env` holds `RENDER_SERVICE_TOKEN`, `ONDEMAND_API_KEY`, `RENDER_GPUS`,
`RENDER_PUBLIC_BASE`; `./run.sh` (started detached with setsid/nohup; see ops/render-service/).

## Studio reference assets (2026-11-04)

`render_service/references/` holds the four studio reference PNGs supplied for crash scenes and
`references.py` binds them to the scene (nothing is invented — meshes stay the Kenney/Poly Haven
glbs, the references drive materials, decals and the facade texture):

| file | reference | binding |
|---|---|---|
| `D3IfJIiClM.png` | silver sedan, crumpled front | `civilian_sedan` paint (sampled 0.40/0.41/0.41) + damage decal on the front third |
| `Rv6TULP5dW.png` | blue hatchback, dented corner | `civilian_hatchback` = sedan mesh (0.92 footprint) + blue paint (0.17/0.26/0.44) + decal |
| `HrOVNUqLwL.png` | mall entrance facade module | tiled wall texture (12 m x 9 m module) on the focal mall's OSM footprint(s) — mall/venue focal kinds only |
| `ewvknQr9AP.png` | collision debris cluster | ground decal plane (3.2 m, studio grey keyed to alpha) at the debris-field centre + the debris glbs |

Every job reports `references[]` (`applied`, `applied_count`, `reason`) and the Blender log line
`SCENE_READY … facade=N references=[…]`; the workstation outliner lists them under "Reference assets".
Deploy: copy `references.py`, `references/*.png`, `pipeline.py`, `app.py`, `blender_scene.py` to the host
service dir and restart `run.sh` (`GEV_REFERENCES_DIR` overrides the default `<service dir>/references`).
GPU policy is unchanged: `RENDER_GPUS` must be `2,6`; any other index is rejected at startup
(`gpu_policy.rejected_from_env`) and the proxy refuses hosts advertising other GPUs (HTTP 409).

Tests (no Blender/network): `GEV_ROOT=<repo> python3 render_service/test_references.py`.
