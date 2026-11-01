# Scene staging delivery report — 2026-11-01 (UTC)

Repository `mk42-ai/gods-eye-view`, branch `feat/scene-video-evidence`, edited **in place**
in the session workspace. Base `948b962` (= origin tip at start). Commits this turn:
`5c7712c` (two-tier staging), `41d3e85` (location geocoder fix), plus the evidence commit.
`f20fab6` (approved checkpoint; restore of `dpl_H9yVA3kDuV8ekgs7xzj7AjDPgaSH`), `b698032`,
`cca89df`, `5c56f4d`, `d26f844` remain ancestors. A branch named
`baseline/approved-k8v6snzk7` does **not** exist on origin (checked with `git ls-remote`);
nothing was reset, rewritten or force-pushed.

## Preview

* Final: `https://ondemand-agent-hw1klznal-schoolhack-web-team.vercel.app`
  (`dpl_GFH4w7Y3TaXtVUCbwqSHzX1ozZKE`, 06:06:41Z)
* Earlier this turn: `dpl_AgmSekUY79g5u3vyxVZiXcPHpXyS` (05:42Z), `dpl_J4x4tR91KWtvU5PTTfCoHGwoseMw` (05:53Z).
* Before: `https://ondemand-agent-56wy5f2wv-schoolhack-web-team.vercel.app` (`dpl_4cHyhFAaizTqX9KrHczZo3pPUMbC`).

## What changed (see `SCENE_ARCHITECTURE.md`)

| Area | Files |
|---|---|
| Scene Spec DSL (zod + JSON Schema) | `src/scenes/sceneSpec.js` |
| Scenario templates / repair | `src/scenes/sceneTemplates.js` |
| Engine → renderer contract | `src/scenes/sceneStaging.js` |
| Fast-model tier chain | `server/scene-plans/specModel.js` |
| Overpass / OSRM client + cache | `server/scene-plans/osm.js` |
| Deterministic engine (Turf) | `server/scene-plans/engine.js` |
| Construct integration | `server/scene-plans/index.js` |
| Geocoder fix | `server/scene-plans/location.js` |
| Renderer (Cesium) | `src/incidents/ui/sceneStagingLayer.js` |
| Left panel | `src/incidents/ui/scenePanel.js`, `sceneStudio.js`, `scene-studio.css` |
| Wiring + persistence | `src/incidents/ui/index.js`, `src/scenes/geographicScene.js` |
| Label clean-up | `sceneGeometryLayer.js`, `geographicOverlay.js` |
| Assets | `public/scene-icons/{png,svg,sprite.png,sprite@2x.png,sprite.json,sprite@2x.json}` |
| QA driver | `scripts/qa-scene-staging.mjs` |

Pre-existing work on the branch (948b962 and earlier) is untouched apart from the files above.

## Model availability (live, 2026-11-01)

* `GET /config/v1/public/endpoints`: `predefined-gpt-6.1-sol`, `predefined-gpt-6.1-terra`,
  `predefined-cerebras-qwen-3.8-27b` (model_id `qwen-3.8-27b`) exist. Probes with
  `predefined-gpt-6.1-ultra-fast` and `predefined-gpt-6.1-sol-ultra-fast` → HTTP 400
  `endpointId … is invalid`. **No ultra-fast sol endpoint exists.**
* `CEREBRAS_API_KEY` is not configured (execution env or Vercel project) → direct tier
  inactive; the app returns `credentialRequest {service: Cerebras, fields: [CEREBRAS_API_KEY], optional: true}`
  and continues. Effective primary on the live preview: `ondemand:predefined-cerebras-qwen-3.8-27b`
  (2.0–4.4 s per classification, schema-valid on all 8 live runs after shorthand normalisation).

## Tests (timestamped outputs in this directory)

* Frontend `npm test`: 4,762 tests, **4,761 pass**, 0 fail, 1 skipped (pre-existing Node-24
  allocation budget skip on Node 22). +61 new.
* Backend `node --test server/**/*.test.mjs`: **712 pass**, 0 fail (+41 new).
  With the platform `ON_DEMAND_API_KEY` exported into the shell, 14 pre-existing
  environment-dependent tests fail identically on the untouched 948b962 tree; the repo's unit
  runner strips those variables, and the recorded run does the same.
* `check:boundaries`, `check:secrets`, `check:secrets:dist`: pass. `format --check`: all
  touched files formatted; `src/ui/walkthrough.js` was already unformatted on 948b962.
* All unit tests use fixtures/injected transports. Live-provider evidence is the puppeteer
  run below, not the unit suites.

## Live validation (final preview, `scripts/qa-scene-staging.mjs`, puppeteer + /usr/bin/chromium)

8/8 prompt × viewport checks pass (`after3/qa-scene-staging-after.json`,
`after3/mobile/qa-scene-staging-after.json`, `per-prompt-timing.json`):

| prompt | viewport | spec ms | geometry ms | render ms | wall ms | model |
|---|---|---|---|---|---|---|
| police raid at Burj Al Arab | 1440x900 | 2878 | 141 | 1472 | 122491 | ondemand:predefined-cerebras-qwen-3.8-27b |
| kanes boxing gym abu dhabi police raid | 1440x900 | 3421 | 96 | 1730 | 93617 | same |
| im doing a raid in the dubai marina | 1440x900 | 2609 | 84 | 2379 | 84646 | same |
| Dubai Run on Sheikh Zayed Road | 1440x900 | 4074 | 20 | 957 | 159814 | same |
| police raid at Burj Al Arab | 390x844 | 2736 | 59 | 1070 | 119465 | same |
| kanes boxing gym abu dhabi police raid | 390x844 | 2824 | 77 | 1618 | 96643 | same |
| im doing a raid in the dubai marina | 390x844 | 3343 | 70 | 1199 | 91147 | same |
| Dubai Run on Sheikh Zayed Road | 390x844 | 4403 | 2 | 2008 | 156220 | same |

Per run: 0 construct calls while typing, exactly 1 on Build, form state `done`, schema-valid
spec, raids: 4 line features + inner/outer cordon polygons, 0 overlapping visible label
boxes, min label 13 px, halo 4, exactly one `#scene-illustrative-badge`, 0 `ILLUSTRATIVE…`
map labels, 0 citation-token labels, panel without `[n]` tokens, "Built with … in … ms"
shown. Wall time is dominated by the pre-existing Perplexity research + planner LLM
(60–160 s); the new staging path itself is 4.5–7.8 s.

Defects found live and fixed this turn: (1) both OnDemand endpoints emitted shorthand
(flattened params, missing confidence) → template fallback; parser now normalises it.
(2) "kanes boxing gym abu dhabi police raid" geocoded "police raid" to a Mumbai locality and
the AOI gate failed the scene; scenario vocabulary is now stripped before geocoding and city
guesses must match their tokens (regression test added).

## Limitations / open issues

* `cctv_signal` markers come only from verified camera discovery; no verified camera
  qualified near the four prompts, so the panel shows "not derived" and no camera icon is drawn.
* Overpass: `overpass-api.de`, `kumi.systems` and `private.coffee` answer HTTP 406 from this
  egress; `overpass.openstreetmap.fr` and `overpass.osm.ch` work and are first in
  `SCENE_OVERPASS_ENDPOINTS`. Serverless `/tmp` cache is per instance.
* The focal label uses the operator's prompt words when the research anchor name is a long
  address (e.g. "kanes boxing gym abu dhabi"); the location badge marks it approximate.
* Renderer is Cesium (the app's existing stack); MapLibre symbol semantics are mapped 1:1
  (halo, size, sort-key declutter, casing/glow). The sprite/atlas is MapLibre/deck.gl ready.
* Not re-exercised live this turn (unchanged code paths): recording-window recolour, the 27
  camera hash keys, save/reload, ElevenLabs narration (still billing-blocked per earlier turns),
  Snapchat discovery. Unit coverage for those paths is unchanged and green.
* `ui_validate.py --eval` cannot await a two-minute build (30 s cap); its final run therefore
  covers the pre-build state, health, assets and the absence of stacked labels, while the
  build assertions are in the puppeteer evidence.
