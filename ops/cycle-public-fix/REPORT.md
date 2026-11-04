# Public-preview fix cycle — Scene Workstation (2026-11-04)

Preview (this cycle): https://ondemand-agent-mqb0wgj5e-schoolhack-web-team.vercel.app  (dpl_2HP9n9dQt4xAxzzXxmCouS1Vpzws, build-id `public-fix-2026-11-04`)
Branch `feat/scene-video-evidence` (PR #4): 25ea685 → **314a8c5** → **aeebd86** (pushed; origin == HEAD).
Machine-readable matrix: `TEST-MATRIX.json` (18 passed · 1 partial · 1 blocked · 1 not run · 0 failed).

## Build-to-source evidence
| item | value |
|---|---|
| repo | github.com/mk42-ai/gods-eye-view, remote `origin` HTTPS |
| branch at start | `feat/scene-video-evidence` @ 25ea6851, working tree clean, == origin |
| checkpoint f20fab6 | present locally ("restore approved deployment dpl_H9yVA3kDuV8ekgs7xzj7AjDPgaSH source tree") — untouched |
| baseline/approved-k8v6snzk7 | **not on origin** (`fatal: couldn't find remote ref`); nothing was reset or force-pushed |
| old public preview | ondemand-agent-od4dxd8pa… served build-id `direct-plugin-2026-11-02` = dist of 25ea685 |

## Reproduction on the PUBLIC URL (Chrome MCP, fresh session, 21:01Z)
* Idle page (`?prompt=car crash yas mall`): `#ws-frame` had `hidden=true` but computed `display:block` and a 133×18 px box → **the broken-image placeholder + alt text "Blender Cycles render" rendered**. Root cause: `.ws-frame{display:block}` (author rule) outranks the UA `[hidden]{display:none}` rule. `__ws.buildRequests` was 0 → the screenshot in the task is the idle state before any Build (status "Ready", outliner "No scene yet", 0/0), not a failed build.
* Pressing Build on the old deployment did work end-to-end (job 599dc7b9d875: 1 POST, 28 polls, `latest.jpg` HTTP 200 image/jpeg 35 495 B, img 1280×720, lumMean 124.9, 98 objects, 96 frames, GPUs 6,2, client TTFF 36.5 s). So frame delivery through the same-origin proxy → RENDER_SERVICE_URL (cloudflared quick tunnel, server-side env) is public and not the fault.
* Remaining defects fixed in place: (1) idle broken `<img>`; (2) no visible progress ("Building — rendering frame i/N on GPU x"); (3) failures only in the small status badge — now a banner with HTTP status + code + message + Retry, and a "complete but no frame decoded" case is treated as a failure, never "Ready"; (4) scrub thumb not driven while frames arrive; (5) Play queued ~1 MB PNG requests faster than a slow link could load them (ERR_ABORTED storm) — Play now steps only after each frame decodes.
* Console on the old deployment: one CSP `frame-src` error from the `vercel.live` feedback toolbar (Vercel preview injection). The new deployment shows 0 console errors / 0 page errors / 0 failed requests in all 7 validator runs.

## Changes (all mine; no pre-existing uncommitted work existed)
* `index.html`, `src/workstation/main.js`, `src/workstation/model.js` (new, pure presentation model), `src/workstation/model.test.mjs` (new, 7 tests), `src/workstation/workstation.css`.
* `render_service/references.py` (new), `render_service/references/*.png` (the 4 studio references), `pipeline.py` (crash pair = silver sedan + blue hatchback, debris decal, mall-facade footprint selection, `references[]` in scene/job), `blender_scene.py` (paint+decal materials, facade material, decal plane, `facade=`/`references=` in SCENE_READY), `app.py` (job `references`, health `references`), `README.md`, `test_references.py` (new, 3 tests).

## Validation on the NEW deployment (ui-validator, 1440×900 + 390×844)
| prompt | job | img | latest.jpg | frame 1 PNG | lumMean | client/service TTFF | fps sustained/steady | GPUs | Play |
|---|---|---|---|---|---|---|---|---|---|
| car crash yas mall | 82ff33725f54 | 1280×720 | 200 image/jpeg 37 659 B | 200 image/png 954 154 B | 124.6 | 31.9 / 29.5 s | 0.95 / 1.19 | 6, 2 | 96→2 |
| police at Emirates Palace | 4fe0fe187038 | 1280×720 | 200 image/jpeg 159 163 B | 200 image/png 1 340 190 B | 125.4 | 37.2 / 36.0 s | 1.55 / 2.31 | 6, 2 | 96→4 |
| Kane's Boxing Gym Abu Dhabi | 3bfce0be48ab | 1280×720 | 200 image/jpeg 189 310 B | 200 image/png 1 406 021 B | 99.0 | 23.1 / 21.8 s | 3.00 / 4.21 | 6, 2 | 96→4 |
| concert crowd at Etihad Arena | de948c716f5e | 1280×720 | 200 image/jpeg 123 954 B | 200 image/png 1 306 384 B | 127.5 | 35.7 / 33.5 s | 1.65 / 2.60 | 6, 2 | 96→3 |

Each run also asserted: exactly 1 build request; outliner ≥ 6 object rows incl. "Camera (crane orbit)", "Placed assets", "Reference assets"; properties populated; scrub max 96 enabled, readout "96 / 96"; both shards on GPU 2/6; no `.cesium-viewer`, `.legend`, `.sprite`; no "gpu_policy_violation" / "Scene build failed" / "No scene yet".
Idle run: no `<img>` in the viewport, no alt text, progress + banner hidden. Building run: progress panel "Building — fetching land patch…" visible, no `<img>`. Error-banner run (POST mocked to 409): banner "Scene build failed · HTTP 409 gpu_policy_violation — … Advertised GPUs: 2, 6, 1", state=error, Retry visible, badge not "Ready".
Pairwise SSIM (frame 48, 8×8 window): yas–palace 0.191, yas–kanes 0.107, yas–etihad 0.274, palace–kanes 0.085, palace–etihad 0.127, kanes–etihad 0.093 → distinct scenes.

## GPU evidence
`/api/scenes/render/health`: `gpus ["2","6"]`, `rejected_from_env []`, `violations []`, `device_order PCI_BUS_ID`, `backend OPTIX`. Per-job `gpu_metrics` (service-side nvidia-smi samples during render) and Blender `SCENE_READY cuda_visible=2|6 … devices=['NVIDIA H100 80GB HBM3']` are in `evidence/status-*.json`. No fresh host-shell nvidia-smi log: no SSH connection was attached to this request.

## Tests / checks (logs in this folder)
unit 4950 (4949 pass, 1 skipped Node-24 gate) · backend 578/578 (ON_DEMAND_API_KEY unset) · render_service 3/3 · format:check 0 · check:boundaries 0 · check:secrets 0 · vite build 0.

## Still not working / not done
1. **Reference-asset bindings are not live on the H100 render host** (no SSH this request): live jobs report `references: null` and the outliner shows the four references as "not applied on render host". The host also still has the 14-key manifest (no `civilian_sedan`/`civilian_taxi`/`debris_*` glbs in git — they live only on the host). Deploy: copy `render_service/{references.py,pipeline.py,app.py,blender_scene.py,references/}` → `/localstorage/mk.thomas/gev/render_service/`, restart `run.sh`.
2. The render host is reached through an ephemeral cloudflared quick tunnel; if it dies the app now shows "Render service unreachable · HTTP 502" instead of hanging, but renders stop until the tunnel is restarted.
3. 27-key camera-hash persistence (legacy.html) was not re-executed this cycle (page untouched; prior evidence stands).
4. Steady fps is 1–4 fps at 24 spp / 1280×720 — not real-time.
