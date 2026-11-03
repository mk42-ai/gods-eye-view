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
