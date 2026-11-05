# Gods Eye View restore + patch-render merge cycle (2026-11-05)

Branch `feat/patch-render-merge` (continues PR #5) from `97272ba`. `ops/cycle-geopatch/` was untracked before this
cycle and is left untracked. Checkpoint `f20fab6` (approved k8v6snzk7 tree) is an untouched ancestor;
`baseline/approved-k8v6snzk7` does not exist on origin (`git ls-remote`).

* **TASK A** — `index.html` is the Gods Eye View console again (Cesium/Esri globe, Scenes/Layers, Display/CCTV/Context,
  tactical HUD, command bar, 27 camera hash keys, approved saved view loads with all 27 keys unchanged). The Blender-only
  Scene Workstation moved to `workstation.html` → `/workstation` (Vite multi-page input, vercel.json rewrite, dev-server).
* **TASK B** — `src/incidents/ui/hyperRealRender.js` is a collapsible right-rail panel: MJPEG/frame/MP4 viewport badged
  `Illustrative render · not evidence` with GPU/fps HUD, Outliner tree (Terrain/Buildings/Roads/Vehicles/Debris/…),
  Properties (location/rotation/scale), Render sheet (`GPU 2 + 6 · Cycles OptiX`), timeline Play/scrub, failure banner
  with HTTP status + Retry. Build scene → exactly ONE `POST /api/patch-render` (the ondemandPatchRender contract);
  typing never renders.
* **TASK C** — render_service on the H100 (SSH): `resolution` 640x360|960x540|1280x720 per request (quality still 1280x720,
  MP4 canvas follows the sequence width); night lighting anchored at the camera/staged action (street cameras far from the
  patch origin rendered black). 11 live jobs, all frames on GPU UUIDs b2aff670 (2) / 2c78264d (6) only.
  Measured @1280x720: first frame 19–52 s, steady 12.6–14.0 fps (target ≥24 fps NOT met; 960x540 = 22.5 fps, 640x360 = 21.6 fps).
* **Custom tool** — `On-Demand Patch Render` plugin-1793906268 / agent-1793906268 (auto tool creation job
  aa560509…, OpenAPI imported from the live deployment). Old plugin-1793879365 marked SUPERSEDED (its server returns
  DEPLOYMENT_NOT_FOUND and `PUT /plugin/v1/{id}` cannot change `action.schema`). Sample call → job `601d17ac3bb3469085e6`,
  96/96 frames, 1280x720 frame + MP4 served through the proxy.
* **TASK D** — 4 live UI runs (2 prompts × 1440x900 / 390x844): typing sent 0 builds, 1 render POST per Build,
  non-blank 1280x720 frames (lumStd 44–48), Outliner groups, Properties transforms, timeline advanced, 27 hash keys,
  0 page errors. Two CDP-screencast MP4s + `VERIFICATION.json`.
