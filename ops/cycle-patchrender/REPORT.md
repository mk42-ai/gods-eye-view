# Patch-render merge cycle (2026-11-05)

Branch `feat/patch-render-merge` from `feat/scene-video-evidence@2182d64` (baseline untouched; `ops/cycle-geopatch/` left untracked as found).

* **Render host** (H100, via attached SSH): render_service deployed to `/localstorage/mk.thomas/gev/render_service`
  (checkpoint of the previous tree: `checkpoint-patchrender-20261105T1054Z`). 6 persistent Blender 4.2.3 workers,
  3 per approved GPU (2 = GPU-b2aff670…, 6 = GPU-2c78264d…), UUID-pinned; GPU 1 never used.
* **Measured**: steady 19.3–27.2 fps (640x360, 4 spp, OptiX denoise), first frame 20–58 s; GPU evidence run
  24.96 fps / 28.9 s TTFF, 120 frames split 60/59 across GPUs 2/6, six renderer PIDs seen only on the two approved UUIDs.
* **Custom tool**: `ondemandPatchRender` plugin-1793879365 / agent-1793879365 (OpenAPI at `/api/patch-render/openapi.json`).
* **QA**: 4 headless-browser runs (2 prompts × 1440x900 / 390x844) all pass; see `VERIFICATION.json` and `evidence/`.
