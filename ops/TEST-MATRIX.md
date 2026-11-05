# Test matrix — 2026-11-03 (all UTC)

| check | status | when | evidence |
|---|---|---|---|
| SSH to H100 host, nvidia-smi BEFORE | passed | 08:39:16Z | ops/gpu-host/nvidia-smi-before.txt |
| Inventory of model-serving processes (ps, nvidia-smi apps, crictl, systemd) | passed | 08:39–08:42Z | ops/gpu-host/inventory-before-*.txt |
| Stop DeepSeek-serving processes | **partial** | 08:43:27Z | llama-dsv41 + cloudflared-dsv41 stopped & disabled; 4 k8s DeepSeek pods NOT stoppable (no Deployment RBAC) — ops/gpu-host/README-phase-a.md |
| Delete DeepSeek weights (du before, rm) | passed (host-owned) / blocked (k8s emptyDir) | 08:43:38Z | 211G `/localstorage/mk.thomas/models/dsv41-gguf` deleted; 2×16G pod caches untouched — deleted-paths.txt, du-before.txt |
| nvidia-smi AFTER + df before/after | passed | 08:44:16Z | nvidia-smi-after.txt (GPU2 77569→0 MiB, GPU1 75915→11279, GPU0 81017→76355); /localstorage 212G→510M |
| Asset research (license-clear sources) | passed | 08:47–08:55Z | ops/asset-research.md, ops/baseline/asset-research.txt |
| Render-stack decision | passed | 09:03Z (OptiX probe) | ops/render-stack-decision.md, ops/baseline/blender-optix-probe*.txt |
| Asset conversion → glb + usdc, manifest 14/14 keys + 3 HDRIs | passed | 09:08:56Z | assets/manifest.json |
| Kimi K3 fast id resolved from live registry + probe | passed | 08:56Z | ops/model-switch/kimi-k3-fast-probe.json (predefined-kimi-k3-fast, HTTP 200, 2.9 s) |
| render_service up on host (:8791) + public base URL via cloudflared | passed | 09:19:24Z / 09:19:59Z | ops/render-service/README.md |
| Service smoke jobs (3 s) end-to-end incl. MP4 | passed after 2 fixes | 09:34:38Z | ops/baseline + job logs on host |
| NVENC encode | **failed → libx264 fallback** | every job | "OpenEncodeSessionEx failed: unsupported device (2)" |
| Plugin creation via auto-tool-creation (isAutoSave) | passed | 09:42:18Z | ops/plugin-tests/plugin-created.json (plugin-1793698938 / agent-1793698938) |
| Plugin credential binding | **blocked (platform)** | 09:44–09:50Z | configuration_create returns fields:null; tool calls → "field Authorization is missing in agent plugin config" — ops/plugin-tests/ |
| Live plugin test calls (renderScene / getRenderStatus / getStream) | **failed** (3/3, auth missing) | 09:45–09:50Z | ops/plugin-tests/live-calls.jsonl |
| Model-switch diff (cerebras → kimi-k3-fast, cerebras kept as fallback) | passed | 09:5xZ | ops/model-switch/kimi-k3-fast-switch.diff |
| Frontend unit tests (`npm test`) | passed 4942 / 0 fail / 1 skip | 09:56Z | ops/test-logs/frontend-unit.log |
| Backend unit tests (server/**, api/**; run with ON_DEMAND_API_KEY unset) | passed 829 / 0 | 09:54:51Z | ops/test-logs/backend-unit.log |
| New tests: server/scene-render/routes.test.mjs (5), src/incidents/ui/hyperRealRender.test.mjs (3), model-registry kimi preference (1) | passed | 09:5xZ | included in the suites above |
| check:boundaries, check:secrets, check:secrets:dist, format | passed | 09:5xZ | shell output in run log |
| Production build (vite) | passed, exit 0, dist 49 MB | 09:56:21Z | ops/test-logs/build.log |
| Commit + push feat/scene-video-evidence | passed | cc03fcc 09:57Z, 4d40ca7 10:59Z | git log |
| PR | existing **PR #4** (create → 422 "already exists") | 09:57:45Z | https://github.com/mk42-ai/gods-eye-view/pull/4 |
| Vercel preview deploy | passed | 09:57–09:59Z | dpl_EYsYdvW8Db86Hy8k6eumnnWscBoL |
| Headless browser: smoke (composer, toggle disabled w/o scene, panel in right rail, badge text) | passed | 10:00:17Z | .ui-proof/after-smoke-1280x800.png |
| Headless browser: Build scene → Hyper-real toggle → job via /api/scenes/render → panel stage/meta | passed | 10:07:40Z | .ui-proof/after-hyperreal-flow-1440x900.png (job 73a90cb7b50b, stage land_patch→render) |
| Headless browser: live MJPEG stream renders in panel (naturalWidth 1280×720), badge visible, first frame 43.95 s | passed | 11:02:12Z | .ui-proof/after-hyperreal-stream-1440x900.png (job cbf9c8c4cc68), ops/test-logs/ui-validator-hyperreal-stream.json |
| 27 camera URL-hash keys present + survive reload | passed | 10:25–10:26Z | .ui-proof/after-hash-27-keys*.png, ops/test-logs/ui-validator-hash-27-keys*.json |
| Phase F: 3 scenes × 60 s, ttff ≤ 60 s | passed (15.9–40.1 s) | 09:48–10:50Z | ops/phase-f/metrics-summary.json |
| Phase F: sustained ≥ 24 fps | **failed** (4.0–6.6 fps on 3 GPUs) | same | ops/phase-f/README.md |
| Phase F: per-GPU util/mem samples | passed (2 s nvidia-smi samples) | same | ops/phase-f/*.nvidia-smi-samples.json |
| Side-by-side vs ground truth + look-dev | passed (produced) + written assessment | 10:58Z | ops/phase-f/compare/side-by-side-{yas,marina,palace}.png |
| Approved baseline preserved (f20fab6 ancestor, no reset/force-push) | passed | 08:39Z | ops/baseline/base-revision.txt |
| WebRTC stream | not run (MJPEG used, allowed by brief) | — | — |
| Google Photorealistic 3D Tiles land patch | not run (no Google key on host) → Esri imagery + OSM extrusions | — | render_service/README.md |
| All 6 GPUs for rendering | **not achieved** — 3 GPUs (2,6,1); 0,3,4,5 held by k8s pods | — | ops/gpu-host/README-phase-a.md |
