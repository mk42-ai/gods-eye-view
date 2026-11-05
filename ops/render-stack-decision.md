# Render-stack decision (2026-11-03)

Candidates named in the brief, evaluated against what could actually be installed and run **headless on the
user's host within this task** (host: Ubuntu 22.04, driver 570.148.08 / CUDA 12.8, no docker, sudo available,
7× H100 of which 2–3 were free after Phase A; no X server):

| Stack | Verdict | Evidence |
|---|---|---|
| **Blender 4.2 LTS — Cycles + OptiX, headless** | **CHOSEN** | Single 352 MB tarball, no root install; `-b --factory-startup` works with no display; OptiX device enumerated on H100 (`DEV NVIDIA H100 80GB HBM3 OPTIX True`), first kernel compile ≈ 4 min per GPU then cached (re-probe 1.2 s); built-in glTF importer + USD exporter cover the asset-conversion step too; multi-GPU by frame-sharding one `blender` process per GPU (`CUDA_VISIBLE_DEVICES`). Live path-tracing, PBR, HDRI lighting, OptiX denoise. |
| NVIDIA Omniverse / Isaac Sim RTX path tracer (USD) | rejected | Requires the Omniverse Launcher / Kit SDK download with an NVIDIA account + EULA acceptance and a multi-GB container; the host has no docker/containerd access for the user, and interactive EULA/login is not possible in a non-interactive SSH session. Not installable within the task. |
| Unreal Engine 5 Pixel Streaming (Lumen / path tracer) | rejected | Linux binaries need an Epic account-linked GitHub access + source build or an Epic-launcher download (tens of GB, hours to compile); Pixel Streaming additionally needs a signalling server and a GPU-backed X/Vulkan session. Out of reach for this task's time box and the host's headless setup. |

Measured reality of the chosen stack (3 × 60 s scenes, 1280×720, 24 spp adaptive + OptiX denoise, 3 GPUs):
time-to-first-frame 16–30 s (≤ 60 s budget met), sustained 4.4–6.6 fps (≈0.18–0.28× real-time; the 24 fps
real-time target is **not** met). Scaling notes: per-GPU shard throughput ≈ 2.6 fps at these settings; even all
7 GPUs would give ≈ 18 fps, so real-time at 720p needs either Eevee-Next (rasteriser), fewer samples, or
lower resolution — all available as service env knobs (`RENDER_SAMPLES`, `RENDER_RES`).

Streaming: MJPEG (`multipart/x-mixed-replace`) of the newest frame — acceptable per the brief; WebRTC was not stood up.
Encoding: `h264_nvenc` fails on this host (ffmpeg 4.4.2: "OpenEncodeSessionEx failed: unsupported device (2)" on
every GPU tried) → automatic libx264 fallback, recorded per job.
