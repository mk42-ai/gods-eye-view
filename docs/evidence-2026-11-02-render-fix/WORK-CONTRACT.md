# Parallel work contract — 2026-11-02 render-fix turn

Repository: `/home/appuser/work/6692b763e851d28a036ab30e/6ae56302679e6131953805be/gods-eye-view`
(branch `feat/scene-video-evidence`, HEAD `a9c7419`). EDIT IN PLACE. Never re-scaffold,
never `git add -A`, never commit (the orchestrator commits), never touch `.env`,
never print/log any API key, never add npm dependencies, no secrets in code/tests/docs.
Node 22 `node:test` tests live next to the module (`*.test.mjs`). Browser code must survive
a React-free DOM (`document`) and Cesium 1.138 (`import * as Cesium from 'cesium'`).
`src/` never imports `server/`; `server/` may import pure modules from `src/scenes/*`
and `src/cinematic/*`. Run `node --test <your test files>` before you finish and
`node scripts/check-import-directions.mjs && node scripts/check-package-boundaries.mjs`.
Run `npx prettier --write <files you changed>` (prettier is installed) on JS you edit.

## Shared vocabulary (used by several agents — do not rename)

### Icon keys (sprite manifest `public/scene-icons/manifest.json`, owner: Agent 3)
Existing keys stay valid. NEW/REPLACED artwork keys that other agents may reference:

| key | artwork (tools/scene-icons/sources) | meaning |
|---|---|---|
| `perimeter_unit` | `foot_patrol_officer.png` (NEW art, replaces SVG ring glyph) | foot patrol officer |
| `police_unit` | `police_patrol_car.png` (NEW art, replaces SVG) | police patrol car |
| `vehicle_police_car` | `police_patrol_car.png` | police patrol car |
| `vehicle_police_motorcycle` | existing | police escort motorcycle |
| `vehicle_city_bus` | existing | city bus |
| `vessel_marine_patrol` | existing | marine patrol boat |
| `marine_patrol` | alias of `vessel_marine_patrol` | marine patrol boat |
| `cone_cluster` | existing | traffic cone cluster |
| `cctv` / `cctv_signal` / `sensor_cctv_feed` | `cctv.png` / `sensor_cctv_feed.png` (cctv_signal replaces SVG) | CCTV marker (renderer adds heading FOV wedge) |
| `crowd_spectators` | `spectator_crowd_cluster.png` (NEW art) | spectator crowd cluster |
| `crowd_zone` | `spectator_crowd_cluster.png` (replaces SVG) | crowd cluster |
| `barrier_crowd` | `crowd_control_barrier.png` (NEW art) | crowd-control barrier segment |
| `barrier` | existing | road barrier |
| `cordon_node` | `checkpoint_cordon_node.png` (NEW art) | cordon node |
| `checkpoint` | `checkpoint_cordon_node.png` (NEW art) | vehicle checkpoint |
| `vehicle_checkpoint` | alias of `checkpoint` | vehicle checkpoint on approach road |
| `screening_lane` | `crowd_control_barrier.png` (reuse) | screening lane / queue channel |
| `command_post` | `event_command_post.png` (NEW art) | command post |
| `staging_point` | `event_command_post.png` (replaces SVG) | staging point |
| `medical_point` | `ambulance_medical_point.png` (NEW) | medical point |
| `vehicle_ambulance` | `ambulance_medical_point.png` (NEW art) | ambulance |
| `person_police_officer` | `foot_patrol_officer.png` (NEW art) | foot officer |
| `signage_road_closed` | `road_closed_barricade.png` (NEW art) | road closed |
| `road_closed` | alias of `signage_road_closed` | road closed barricade |
| `start_finish` | `start_finish_gate.png` (NEW art, replaces SVG) | start/finish gate |
| `vehicle_civilian_sedan` | `civilian_sedan.png` (NEW art) | civilian sedan |
| `civilian_sedan` | alias of `vehicle_civilian_sedan` | civilian sedan |
| `generic` | generated | fallback dot |

All PNGs ≤ 128 px (`<key>.png` 64 px, `<key>@2x.png` 128 px; `@4x` files are REMOVED).
`public/scene-icons/sprite.png` (64 px cells) and `sprite@2x.png` (128 px cells) +
`sprite.json`/`sprite@2x.json` (MapLibre format `{x,y,width,height,pixelRatio}`).
Browser helper (Agent 3 writes it): `src/scenes/spriteAtlas.js` exporting
`createSpriteAtlas({ document, baseUrl='/scene-icons/' })` →
`{ load(): Promise, imageFor(key, {scale=2}) → { id:'gev-sprite:<key>@<scale>', image:<HTMLCanvasElement|string url>, width, height }, has(key), keys() }`.
Until `load()` resolves, `imageFor` returns the PNG URL (`/scene-icons/png/<key>@2x.png`) so
callers never block. Cesium billboards must be created as
`{ image: entry.image, id?: … }` — when `image` is a canvas, set `billboard.image = entry.id`
via `Cesium.BillboardGraphics({ image: canvas })` is fine (Cesium dedupes by object identity);
the helper caches ONE canvas per key+scale so the TextureAtlas never grows per entity.

### Scene Spec element types (owner: Agent 4, file `src/scenes/sceneSpec.js`)
New DYNAMIC_ELEMENT_TYPES: `vehicle_checkpoint`, `screening_lane`, `medical_point`,
`marine_patrol`, `foot_patrol`, `escort_motorcycle`, `shuttle_bus`, `road_closed`.
New scenarioType `police_protection` (event security at a landmark venue).
Engine (`server/scene-plans/engine.js`) emits features whose `properties.icon` uses the keys
above; `properties.role` ∈ existing STAGING_ROLES; `properties.priority` per existing table
(command_post 70, medical_point 70, checkpoint 60, marine_patrol 60, foot_patrol 60,
screening_lane 40, barrier 20, cone 10).

### Render guard (owner: Agent 1, file `src/app/renderGuard.js`)
`installRenderGuard(viewer, { window, document, onRecover })` sets
`window.__gevRender = { stats(): {renderErrors, contextLost, contextRestored, recoveries, lastError, lastErrorAt}, budget(): {entities, billboards, labels, primitives, polylines, tilesetCacheMb}, reduceBudget(), recover(reason) }`.
Recovery dispatches `window.dispatchEvent(new CustomEvent('gev:render-recovered', {detail:{reason, attempt}}))`;
`src/incidents/ui/index.js` (Agent 1 owns this file this turn) listens and re-applies the
current staging scene + cinematic scene. Non-blocking toast element id `gev-render-toast`.
Budget constants exported from `src/cinematic/renderBudget.js` (Agent 1):
`MAX_BILLBOARDS_PER_SCENE=600`, `MAX_MEMBERS_PER_ENTITY=12`, `DENSITY_POLYGON_THRESHOLD=12`,
`MAX_LABELS_VISIBLE=24`, `MAX_PARTICLE_SYSTEMS=4`, `MAX_PARTICLE_EMISSION=24`,
`TILESET_CACHE_BYTES`, `TILESET_CACHE_OVERFLOW_BYTES`, `SOFTWARE_TILESET_CACHE_BYTES`.

### Playback (owner: Agent 2)
`playbackController` state object gains `hasTimeDynamic:boolean`, `tour:boolean` (camera tour
mode active). `window.__gevCinematic.playback` already exposes the controller; keep
`playback.state()` returning `{state, positionSec, durationSec, speed, cameraMode, followEntityId, live, hasTimeDynamic, tour}`.
Panel ids kept: `#cinematic-play`, `#cinematic-pause`, `#cinematic-restart`, `#cinematic-seek`,
`#cinematic-position`; new `#cinematic-playhead` (progress bar, `role=progressbar`,
`aria-valuenow` = percent) and `#cinematic-window-label` (recording-window label).

### File ownership (strict — do not edit a file you do not own)
* Agent 1 (A render crash + cinematic runtime budgets + HYPOTHETICAL prefix removal):
  `src/app/viewer.js`, `src/app/scene.js`, NEW `src/app/renderGuard.js` (+test), NEW
  `src/cinematic/renderBudget.js` (+test), `src/cinematic/sceneRuntime.js` (+test),
  `src/cinematic/effects.js`, `src/cinematic/assetRegistry.js`, `src/maps/google3d.js`,
  `src/incidents/ui/index.js`, `src/ui/styles.js` + NEW `src/app/renderGuard.css`,
  `src/cinematic/debugApi.js` (only to add `render()` passthrough), `server/scene-plans/legacy-plan.js` (drop 'HYPOTHETICAL · ' label prefix).
* Agent 2 (B playback): `src/cinematic/playbackController.js` (+test),
  `src/cinematic/ui/cinematicPanel.js` (+test), `src/cinematic/ui/cinematic.css`,
  `src/cinematic/cameraDirector.js` (+test), `src/cinematic/index.js`.
* Agent 3 (C icons + D staging-layer polish + legend): `tools/scene-icons/build-icons.mjs`,
  `tools/scene-icons/sources/*` (ADD files only), `public/scene-icons/**`,
  `src/cinematic/assetIds.js` (+test), NEW `src/scenes/spriteAtlas.js` (+test),
  `src/scenes/sceneStaging.js` (ICON_KEYS only), `src/scenes/iconManifest.test.mjs`,
  `src/incidents/ui/sceneStagingLayer.js` (+test), `src/incidents/ui/sceneStreamLayer.js`,
  `src/incidents/ui/scenePanel.js` (legend), `style.css` (ONLY append a clearly delimited
  block `/* === scene legend / hover 2026-11-02 === */` at the END of the file),
  `SCENE_ARCHITECTURE.md` §6.
* Agent 4 (E reliability + police-protection template): `src/scenes/sceneSpec.js` (+test),
  `src/scenes/sceneTemplates.js` (+test), `server/scene-plans/engine.js` (+test),
  `server/scene-plans/geometry.js`, `server/scene-plans/specModel.js` (+test),
  `server/scene-plans/location.js` (+test), `server/scene-plans/research.js`,
  `server/scene-plans/director.js` (+test), `server/scene-plans/index.js`,
  `server/scene-plans/stream.js`, `src/cinematic/sceneSchema.js` (ONLY to add
  `police_protection` to the scenarioType enum), `src/incidents/ui/composer.js` (candidate
  chooser only), `src/incidents/client.js`.
* Agent 5 (F Snapchat): `server/scene-footage/**`, `src/sceneFootage/**`,
  `src/incidents/ui/sceneFootageControls.js` (+test), `src/sceneEvidence/panel.js` + `store.js`
  (+tests), `docs/SNAPCHAT_PLUGIN.md`, NEW `scripts/qa-snapchat-live-probe.mjs`,
  NEW `docs/evidence-2026-11-02-render-fix/snapchat-live-probe.txt`.

Report back (as your final message): files changed, tests added + their pass counts,
anything you could NOT do and why, and any cross-agent interface you relied on.
