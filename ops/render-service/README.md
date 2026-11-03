# Phase C — render service record (UTC 2026-11-03)

| item | value |
|---|---|
| host | school-hack-h100-100 (93.119.168.123), user mk.thomas, 7× H100 80GB visible |
| service dir | /localstorage/mk.thomas/gev/render_service (copy of repo `render_service/`) |
| launcher | `/localstorage/mk.thomas/gev/render_service/run.sh` via `setsid nohup` (no systemd rights needed for a user unit; tmux absent); restart helper `/localstorage/mk.thomas/gev/restart.sh` |
| secrets | `/localstorage/mk.thomas/gev/render_service.env` (0600): RENDER_SERVICE_TOKEN, ONDEMAND_API_KEY, RENDER_GPUS=2,6,1, RENDER_PUBLIC_BASE, SCENE_OVERPASS_ENDPOINTS — never committed |
| local bind | 0.0.0.0:8791 (public IP routable from the host itself; from outside the hoster/k8s firewall drops 8791 — probe `curl 93.119.168.123:8791` → timeout) |
| public base URL | **https://sail-maiden-eyed-remainder.trycloudflare.com** (cloudflared quick tunnel, started 09:19:50Z; quick tunnels are ephemeral and die with the process) |
| stream | `GET /stream/{job}` multipart/x-mixed-replace MJPEG (WebRTC not stood up) |
| GPUs used | 2, 6 (fully free after Phase A) + 1 (~70 GB free); GPUs 0,3,4,5 stay occupied by Kubernetes-managed DeepSeek pods that node credentials cannot stop |
| render stack | Blender 4.2.3 LTS headless, Cycles + **OptiX** on H100 (first OptiX kernel compile ≈ 4 min per GPU, cached afterwards: 1.2 s re-probe), OptiX denoise, adaptive sampling 24 spp, AgX view transform, 1280×720, 24 fps |
| encode | ffmpeg 4.4.2 **h264_nvenc fails on this host** ("OpenEncodeSessionEx failed: unsupported device (2)") on every GPU tried → automatic libx264 fallback (recorded per job as `encoder`) |
| land patch | Esri World Imagery z18 tiles (keyless) stitched; OSM buildings (height/levels extruded) + roads from **api.openstreetmap.org/api/0.6/map** — public Overpass mirrors answered 406 / timed out from the host; no Google Maps key on the host so Photorealistic 3D Tiles were not used |
| scene spec | OnDemand Chat API, `predefined-kimi-k3-fast` first (HTTP 200, 6.6–6.8 s, schema-valid on every run) → `predefined-cerebras-qwen-3.8-27b` → template |

Timeline: 08:45Z Blender download · 09:03Z OptiX probe ok · 09:08Z assets converted · 09:19Z service up · 09:21–09:34Z three smoke jobs (first two exposed `_tile()` arg bug and a glTF-join bug, fixed) · 09:48Z Phase-F runs started.
