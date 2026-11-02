# Scene architecture — two-tier Scene Spec DSL + deterministic engine

_Status: implemented on `feat/scene-video-evidence` (2026-11-01). This document is
the contract between the fast model, the deterministic engine, the renderer and
the left-panel explanation. Keep it in sync with `src/scenes/sceneSpec.js`,
`src/scenes/sceneTemplates.js`, `src/scenes/sceneStaging.js`,
`server/scene-plans/specModel.js` and `server/scene-plans/engine.js`._

## 1. Split of responsibilities

| Tier                                                   | Owner                                                          | Allowed to do                                                                                                                                                                                                                                         | Never does                                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Fast model** (tier 1)                                | `server/scene-plans/specModel.js`                              | Emit ONE Scene Spec JSON: `scenarioType`, `focalEntity`, abstract `elements[]` with scalar `params`, `confidence`                                                                                                                                     | Emit coordinates, polygons, routes, labels drawn on the map, free text drawn on the map                             |
| **Deterministic engine** (tier 2, heavy prebuilt code) | `server/scene-plans/engine.js` (+ `osm.js`)                    | Resolve the anchor (existing Perplexity-first chain in `location.js`), fetch OSM footprints/roads (Overpass `around:`), route approach/egress (OSRM), compute cordons/cones/barriers/units/staging (Turf.js), de-duplicate labels, cache per location | Ask a model for geometry; invent coordinates when a data source is unavailable (it records `unavailable[]` instead) |
| **Renderer**                                           | `src/incidents/ui/sceneStagingLayer.js` (Cesium entities)      | Cased + glowing lines, dashed cordons, icon billboards from the sprite atlas, haloed labels ≥ 13 px with priority declutter, ONE fixed "ILLUSTRATIVE" badge                                                                                           | Repeat the illustrative warning as map labels; show `[1,2,3]` citation tokens on the map                            |
| **Explanation panel**                                  | `src/incidents/ui/scenePanel.js` (mounted in `sceneStudio.js`) | Title, one-line summary, Scenario, Location + confidence badge, Elements with icon + count, numbered source chips, single caveat line, "Built with `<model>` in `<ms>`"                                                                               | Stack warning banners; print raw citation tokens                                                                    |

The renderer in this application is **CesiumJS** (3D globe, photorealistic tiles).
MapLibre GL JS was the preferred renderer in the brief; the app's existing map
stack, camera handoff and 27 URL-hash keys are Cesium, so the MapLibre symbol
semantics are implemented 1:1 on Cesium primitives (see §5). The sprite atlas is
shipped in MapLibre/deck.gl format so a MapLibre or deck.gl consumer can
register the same images without conversion.

## 2. Scene Spec DSL (`src/scenes/sceneSpec.js`)

```jsonc
{
  "scenarioType": "police_raid | route_closure | crowd_event | perimeter_cordon | motorcade | observation",
  "focalEntity": { "name": "Burj Al Arab", "kind": "building | venue | road | area | landmark | event | unknown" },
  "elements": [
    {
      "type": "inner_cordon | outer_cordon | approach_route | egress_route | staging_point | perimeter_unit | checkpoint | cones | barriers | cctv_signal | crowd_zone | route_line | start_finish | threat_zone | interest_zone | overwatch | command_post | cordon_node | crowd_density_zone | cctv_pick | intel_note | timeline_event | <custom>",
      "label": "string <= 48 chars (sanitized)",
      "confidence": 0-1, // default 0.5
      "source": "string <= 120 chars (sanitized)",
      "offset": { "eastM": -5000 to 5000, "northM": -5000 to 5000 }, // clamped to AOI bbox when provided
      "params": { "radius_m?": 5-5000, "count?": 1-200, "spacing_m?": 2-500, "direction?": "N|NE|E|SE|S|SW|W|NW" },
      // element-specific fields:
      "relevance": 0-1, // cctv_pick
      "evidenceTier": "sourced | inferred | generated", // intel_note
      "citations": [{ "url": "http(s) <= 2000 chars", "title": "string <= 300" }], // intel_note
      "atSec": 0+, // timeline_event
      "title": "string <= 80 chars (sanitized)" // timeline_event
    }
  ],
  "confidence": 0-1
}
```

- **Closed validation** with **zod** (`SceneSpecSchema`, `strictObject` everywhere) for legacy and strict endpoints (`SCENE_SPEC_JSON_SCHEMA`, `SCENE_SPEC_STRICT_JSON_SCHEMA`).
- **Permissive dynamic validation** via `parseDynamicSceneSpec(raw, {bbox?})`:
  - Dynamically supports `DYNAMIC_ELEMENT_TYPES` alongside `ELEMENT_TYPES`.
  - **Unknown element types are accepted** (not rejected) and marked `generic: true` so the renderer displays a generic marker; `rejected[]` is reserved strictly for structural failures (non-object, missing element type).
  - Coercions and bounds enforcement are tracked in `coerced[]`.
  - Strings are sanitized (stripping control chars, HTML tags, and bracketed `[n]` citation tokens).
  - `SCENE_SPEC_DYNAMIC_JSON_SCHEMA` publishes the open enum specification to models.
- `repairSceneSpec(raw, prompt)` (`sceneTemplates.js`) is used as a fallback **ONLY** when model output yields zero valid elements.

## 3. Model fallback chain (`server/scene-plans/specModel.js`)

Checked against the live OnDemand registry on 2026-11-01 (`GET /config/v1/public/endpoints`

- live `/chat/v1/sessions/{id}/query` probes):

| Order | Provider / endpoint                                                                                                                                                                                                                                | Notes                                                                                                                                                                                                                                                                    |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | **Cerebras direct** `https://api.cerebras.ai/v1/chat/completions`, model `qwen-3.8-27b`, `response_format:{type:'json_schema', json_schema:{strict:true}}`, `temperature:0`, `max_tokens:400`, `reasoning_effort:'none'`, **2 s timeout, 1 retry** | Only when `CEREBRAS_API_KEY` is configured server-side. Fallback model `qwen-3-235b-a22b-instruct-2507` (non-strict JSON + validation) when strict returns 400.                                                                                                          |
| 2     | **OnDemand** `predefined-cerebras-qwen-3.8-27b` (Cerebras-hosted `qwen-3.8-27b` through the existing server key)                                                                                                                                   | Measured 2.0–3.7 s per classification on the four QA prompts (all schema-valid after normalisation); `fulfillmentOnly:true`. 15 s budget.                                                                                                                                |
| 3     | **OnDemand** `predefined-gpt-6.1-sol`, `reasoningEffort:'medium'`                                                                                                                                                                                  | The brief's "GPT 6.1 sol ultra-fast" endpoint does **not** exist: `predefined-gpt-6.1-ultra-fast` and `predefined-gpt-6.1-sol-ultra-fast` are rejected with HTTP 400 `endpointId … is invalid`; the registry has `gpt-6.1-sol` and `gpt-6.1-terra` only. Measured 2.9 s. |
| 4     | **Scenario template** (`templateSpec`)                                                                                                                                                                                                             | Always succeeds → a scene ALWAYS builds.                                                                                                                                                                                                                                 |

The service logs `{provider, endpointId/model, latencyMs, attempts, fallback}` and
returns it as `staging.model`; the UI shows `Built with <model> in <ms>`. When
`CEREBRAS_API_KEY` is absent the health/construct response carries
`credentialRequest: {service:'Cerebras', fields:['CEREBRAS_API_KEY'], optional:true}`
— the build is never blocked on it.

## 4. Scene Staging output (`src/scenes/sceneStaging.js`) — engine → renderer contract

```jsonc
{
  "version": 1,
  "illustrative": true,                       // always
  "spec": { ...SceneSpec },
  "anchor": { "name": "Burj Al Arab", "lat": 25.1412, "lon": 55.1853 },
  "model": { "provider": "cerebras-direct|ondemand|template", "id": "qwen-3.8-27b", "endpointId?": "...", "latencyMs": 1830, "attempts": [{provider,id,ok,ms,error?}], "fallback": null | "template", "repaired": false, "reasons": [] },
  "timing": { "specMs": 1830, "overpassMs": 900, "routingMs": 1200, "geometryMs": 40, "totalMs": 4000 },
  "sources": { "footprint": "osm-building|circle-fallback", "roads": "overpass|unavailable", "routing": "osrm|unavailable", "overpassEndpoint?": "https://…", "cacheHit": false },
  "unavailable": [ { "element": "cones", "reason": "road network unavailable" } ],
  "layers": {
    "areas":  { "type": "FeatureCollection", "features": [ Polygon features ] },
    "lines":  { "type": "FeatureCollection", "features": [ LineString features ] },
    "points": { "type": "FeatureCollection", "features": [ Point features ] },
    "labels": { "type": "FeatureCollection", "features": [ Point features, de-duplicated ] }
  },
  "badge": { "text": "ILLUSTRATIVE – suggested, not verified deployment", "single": true },
  "legend": [ { "key": "inner_cordon", "label": "Inner cordon", "swatch": "area|line|icon", "color": "#14B8A6", "icon?": "perimeter_unit", "count": 1 } ]
}
```

Feature `properties` (every feature):

| property        | values                                                                                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | unique, `^[a-z][a-z0-9_-]*$`                                                                                                                                                                                                           |
| `element`       | one of the DSL element types (or custom unknown string when `generic: true`)                                                                                                                                                           |
| `role`          | `focal`, `cordon`, `route`, `unit`, `cone`, `barrier`, `signal`, `zone`, `marker`, `overwatch`, `command`, `node`                                                                                                                      |
| `label`         | ≤ 48 chars, **no** `[n]` tokens, no "ILLUSTRATIVE" prefix                                                                                                                                                                              |
| `priority`      | integer sort key: focal 100 > cordons 90 > zones 85 > routes 80 > command_post/overwatch 70 > units/checkpoints/cordon_node 60 > marker 55 > cctv 50 > generic 40 > barriers 20 > cones 10                                             |
| `icon?`         | sprite key (`cone`, `police_unit`, `barrier`, `cctv_signal`, `checkpoint`, `staging_point`, `perimeter_unit`, `crowd_zone`, `start_finish`, `egress`, `command_post`, `cctv`, `cordon_node`, `route_start`, `route_finish`, `generic`) |
| `lineStyle?`    | `cordon_inner`, `cordon_outer` (dashed), `route_approach`, `route_egress`, `route_line` (glow)                                                                                                                                         |
| `color`         | `#14B8A6` teal (primary), `#A7F3D0` mint (highlight), `#FFFFFF` (accent), `#F59E0B` amber (threat zones)                                                                                                                               |
| `provenance`    | `osm-footprint-buffer`, `circle-buffer`, `osrm-route`, `overpass-highway`, `turf-along`, `turf-intersect`, `camera-discovery`, `anchor`                                                                                                |
| `illustrative`  | `true`                                                                                                                                                                                                                                 |
| `confidence?`   | 0–1                                                                                                                                                                                                                                    |
| `source?`       | attribution string ≤ 120 chars, sanitized                                                                                                                                                                                              |
| `evidenceTier?` | `sourced`, `inferred`, `generated`                                                                                                                                                                                                     |
| `generic?`      | `true` when rendered as generic fallback marker                                                                                                                                                                                        |
| `relevance?`    | 0–1 (for CCTV picks)                                                                                                                                                                                                                   |

Staging envelope also includes:

- `notes[]`: collected intel notes `{ text, evidenceTier, citations: [{url, title}], confidence?, source? }`. Label-only features on map if carrying offset; not rendered as markers.
- `timeline[]`: timed sequence `{ atSec, title, confidence?, source? }`.

`validateSceneStaging(raw)` (browser + Node, dependency-free) rejects anything
else: this is what the saved-scene store and the renderer trust.

## 5. Rendering rules (Cesium ⇄ MapLibre equivalence)

| Brief (MapLibre)                                   | Cesium implementation                                                                                                                                                                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text-halo-width ≥ 1.5`, `text-halo-color #0B1220` | `LabelStyle.FILL_AND_OUTLINE`, `outlineWidth: 4` (≈2 px at DPR 1), `outlineColor #0B1220`                                                                                                                                                       |
| `text-size 13–14`, zoom interpolation              | `font: '600 13px …'` (14 px for the focal label), `scaleByDistance` 1.0 → 0.85                                                                                                                                                                  |
| `text-allow-overlap:false` + `symbol-sort-key`     | `postRender` declutter: project every label, greedy by `priority`, hide lower-priority labels whose screen box overlaps (zones 85 > routes 80 > command_post/overwatch 70 > checkpoint/cordon_node 60 > cctv 50 > generic 40 > cone/barrier 10) |
| de-duplicated labels                               | engine emits one label per element group (`labels` layer); identical texts are merged                                                                                                                                                           |
| line casing + core                                 | `PolylineOutlineMaterialProperty` (outline `#0B1220`, width 2) around teal/mint core; cordons `PolylineDashMaterialProperty`; routes `PolylineGlowMaterialProperty`                                                                             |
| icon sprites + `icon-size` by zoom                 | billboards from `/scene-icons/png/<key>.png` (32 px 1x, 64 px 2x) with `scaleByDistance`                                                                                                                                                        |
| hover inspection                                   | lightweight DOM `#scene-staging-tooltip` driven by Cesium `ScreenSpaceEventHandler` `MOUSE_MOVE` → `scene.pick` showing element type, confidence %, source attribution, evidence tier, and relevance                                            |
| ONE watermark badge                                | fixed `#scene-illustrative-badge` DOM element, never a map label                                                                                                                                                                                |

## 6. Asset catalogue (`public/scene-icons/`)

Generated PNGs (black background keyed to alpha, centred, 8 % padding) and
hand-authored SVGs in the palette (teal `#14B8A6`, mint `#A7F3D0`, white, navy
`#0B1220`, amber `#F59E0B`). Sprite sheets `sprite.png` (64 px, 1x) and `sprite@2x.png` (128 px, 2x)
with MapLibre-format JSON atlases (`sprite.json`, `sprite@2x.json`; each entry
`{x,y,width,height,pixelRatio,sdf:false}`), usable directly as a MapLibre sprite
or as a deck.gl `iconAtlas` + `iconMapping`.

Asset keying and sprite rebuild pipeline: `tools/scene-icons/build-icons.mjs`

- Reads 1024×1024 RGB source PNGs with pure black `#000000` background.
- Soft threshold keying: `alpha = clamp((max(r,g,b) - 8) / 40, 0, 1)`, un-premultiplying color toward original hue `c / alpha`.
- 1 px alpha erosion and feather to eliminate black fringe.
- Bounding box content cropping + 8% padding, centered on square.
- Exports 64 px (`png/<key>.png`) and 128 px (`png/<key>@2x.png`).
- Rebuilds `sprite.png` (1024×192, 16 columns grid) and `sprite@2x.png` (2048×384), `sprite.json`, `sprite@2x.json`, and `manifest.json` (version 5: 46 keys + `elementTypeIcons` map) with SHA-256 hashes.
- Route flag keys: `route_start` (normal) and `route_finish` (horizontally mirrored via `flop()`).
- Generic marker: generated target dot sprite with teal ring and white center.

| key                        | PNG (1x / 2x)                                | SVG                                  | sprite index | source                                                       |
| -------------------------- | -------------------------------------------- | ------------------------------------ | ------------ | ------------------------------------------------------------ |
| cone                       | `png/cone.png` (`@2x`)                       | `svg/cone.svg`                       | 0            | `tools/scene-icons/sources/cone.png`                         |
| police_unit                | `png/police_unit.png` (`@2x`)                | `svg/police_unit.svg`                | 1            | `tools/scene-icons/sources/police_patrol_car.png`             |
| barrier                    | `png/barrier.png` (`@2x`)                    | `svg/barrier.svg`                    | 2            | `tools/scene-icons/sources/barrier.png`                      |
| cctv_signal                | `png/cctv_signal.png` (`@2x`)                | `svg/cctv_signal.svg`                | 3            | `tools/scene-icons/sources/cctv.png`                         |
| checkpoint                 | `png/checkpoint.png` (`@2x`)                 | `svg/checkpoint.svg`                 | 4            | `tools/scene-icons/sources/checkpoint_cordon_node.png`        |
| staging_point              | `png/staging_point.png` (`@2x`)              | `svg/staging_point.svg`              | 5            | `tools/scene-icons/sources/event_command_post.png`           |
| perimeter_unit             | `png/perimeter_unit.png` (`@2x`)             | `svg/perimeter_unit.svg`             | 6            | `tools/scene-icons/sources/foot_patrol_officer.png`          |
| crowd_zone                 | `png/crowd_zone.png` (`@2x`)                 | `svg/crowd_zone.svg`                 | 7            | `tools/scene-icons/sources/spectator_crowd_cluster.png`      |
| start_finish               | `png/start_finish.png` (`@2x`)               | `svg/start_finish.svg`               | 8            | `tools/scene-icons/sources/start_finish_gate.png`            |
| egress                     | `png/egress.png` (`@2x`)                     | `svg/egress.svg`                     | 9            | `tools/scene-icons/sources/egress.png`                       |
| command_post               | `png/command_post.png` (`@2x`)               | `svg/command_post.svg`               | 10           | `tools/scene-icons/sources/event_command_post.png`           |
| cctv                       | `png/cctv.png` (`@2x`)                       | `svg/cctv.svg`                       | 11           | `tools/scene-icons/sources/cctv.png`                         |
| cordon_node                | `png/cordon_node.png` (`@2x`)                | `svg/cordon_node.svg`                | 12           | `tools/scene-icons/sources/checkpoint_cordon_node.png`        |
| route_start                | `png/route_start.png` (`@2x`)                | `svg/route_start.svg`                | 13           | `tools/scene-icons/sources/route_flag.png`                   |
| route_finish               | `png/route_finish.png` (`@2x`)               | `svg/route_finish.svg`               | 14           | `tools/scene-icons/sources/route_flag.png` (mirrored)        |
| generic                    | `png/generic.png` (`@2x`)                    | `svg/generic.svg`                    | 15           | `generated:generic`                                          |
| vehicle_police_car         | `png/vehicle_police_car.png` (`@2x`)         | `svg/vehicle_police_car.svg`         | 16           | `tools/scene-icons/sources/police_patrol_car.png`             |
| vehicle_ambulance          | `png/vehicle_ambulance.png` (`@2x`)          | `svg/vehicle_ambulance.svg`          | 17           | `tools/scene-icons/sources/ambulance_medical_point.png`       |
| vehicle_fire_engine        | `png/vehicle_fire_engine.png` (`@2x`)        | `svg/vehicle_fire_engine.svg`        | 18           | `tools/scene-icons/sources/vehicle_fire_engine.png`          |
| vehicle_civilian_sedan     | `png/vehicle_civilian_sedan.png` (`@2x`)     | `svg/vehicle_civilian_sedan.svg`     | 19           | `tools/scene-icons/sources/civilian_sedan.png`               |
| aircraft_helicopter        | `png/aircraft_helicopter.png` (`@2x`)        | `svg/aircraft_helicopter.svg`        | 20           | `tools/scene-icons/sources/aircraft_helicopter.png`          |
| aircraft_fixed_wing        | `png/aircraft_fixed_wing.png` (`@2x`)        | `svg/aircraft_fixed_wing.svg`        | 21           | `tools/scene-icons/sources/aircraft_fixed_wing.png`          |
| person_runner              | `png/person_runner.png` (`@2x`)              | `svg/person_runner.svg`              | 22           | `tools/scene-icons/sources/person_runner.png`                |
| person_police_officer      | `png/person_police_officer.png` (`@2x`)      | `svg/person_police_officer.svg`      | 23           | `tools/scene-icons/sources/foot_patrol_officer.png`          |
| signage_road_closed        | `png/signage_road_closed.png` (`@2x`)        | `svg/signage_road_closed.svg`        | 24           | `tools/scene-icons/sources/road_closed_barricade.png`        |
| effect_smoke_fire          | `png/effect_smoke_fire.png` (`@2x`)          | `svg/effect_smoke_fire.svg`          | 25           | `tools/scene-icons/sources/effect_smoke_fire.png`            |
| alert_state_1              | `png/alert_state_1.png` (`@2x`)              | `svg/alert_state_1.svg`              | 26           | `tools/scene-icons/sources/alert_states_sheet.png` (quad 0)  |
| alert_state_2              | `png/alert_state_2.png` (`@2x`)              | `svg/alert_state_2.svg`              | 27           | `tools/scene-icons/sources/alert_states_sheet.png` (quad 1)  |
| alert_state_3              | `png/alert_state_3.png` (`@2x`)              | `svg/alert_state_3.svg`              | 28           | `tools/scene-icons/sources/alert_states_sheet.png` (quad 2)  |
| alert_state_4              | `png/alert_state_4.png` (`@2x`)              | `svg/alert_state_4.svg`              | 29           | `tools/scene-icons/sources/alert_states_sheet.png` (quad 3)  |
| barrier_crowd              | `png/barrier_crowd.png` (`@2x`)              | `svg/barrier_crowd.svg`              | 30           | `tools/scene-icons/sources/crowd_control_barrier.png`        |
| cone_cluster               | `png/cone_cluster.png` (`@2x`)               | `svg/cone_cluster.svg`               | 31           | `tools/scene-icons/sources/cone_cluster.png`                 |
| crowd_spectators           | `png/crowd_spectators.png` (`@2x`)           | `svg/crowd_spectators.svg`           | 32           | `tools/scene-icons/sources/spectator_crowd_cluster.png`      |
| person_responder           | `png/person_responder.png` (`@2x`)           | `svg/person_responder.svg`           | 33           | `tools/scene-icons/sources/person_responder.png`             |
| vehicle_city_bus           | `png/vehicle_city_bus.png` (`@2x`)           | `svg/vehicle_city_bus.svg`           | 34           | `tools/scene-icons/sources/vehicle_city_bus.png`             |
| vehicle_police_motorcycle  | `png/vehicle_police_motorcycle.png` (`@2x`)  | `svg/vehicle_police_motorcycle.svg`  | 35           | `tools/scene-icons/sources/vehicle_police_motorcycle.png`    |
| sensor_cctv_feed           | `png/sensor_cctv_feed.png` (`@2x`)           | `svg/sensor_cctv_feed.svg`           | 36           | `tools/scene-icons/sources/sensor_cctv_feed.png`             |
| evidence_pin_verified      | `png/evidence_pin_verified.png` (`@2x`)      | `svg/evidence_pin_verified.svg`      | 37           | `tools/scene-icons/sources/evidence_pin_verified.png`        |
| marker_air_raid_impact_sim | `png/marker_air_raid_impact_sim.png` (`@2x`) | `svg/marker_air_raid_impact_sim.svg` | 38           | `tools/scene-icons/sources/marker_air_raid_impact_sim.png`   |
| vessel_marine_patrol       | `png/vessel_marine_patrol.png` (`@2x`)       | `svg/vessel_marine_patrol.svg`       | 39           | `tools/scene-icons/sources/vessel_marine_patrol.png`         |
| medical_point              | `png/medical_point.png` (`@2x`)              | `svg/medical_point.svg`              | 40           | `tools/scene-icons/sources/ambulance_medical_point.png`       |
| marine_patrol              | `png/marine_patrol.png` (`@2x`)              | `svg/marine_patrol.svg`              | 41           | alias of `vessel_marine_patrol`                              |
| vehicle_checkpoint         | `png/vehicle_checkpoint.png` (`@2x`)         | `svg/vehicle_checkpoint.svg`         | 42           | alias of `checkpoint`                                        |
| screening_lane             | `png/screening_lane.png` (`@2x`)             | `svg/screening_lane.svg`             | 43           | `tools/scene-icons/sources/crowd_control_barrier.png`        |
| road_closed                | `png/road_closed.png` (`@2x`)                | `svg/road_closed.svg`                | 44           | alias of `signage_road_closed`                               |
| civilian_sedan             | `png/civilian_sedan.png` (`@2x`)             | `svg/civilian_sedan.svg`             | 45           | alias of `vehicle_civilian_sedan`                            |

## 7. Caching

- **Spec cache** — none (prompt revisions must re-classify).
- **OSM cache** — `server/scene-plans/osm.js`: memory LRU keyed by
  `round(lat,4),round(lon,4),radius` for Overpass footprints/roads and by the
  rounded waypoint pair for OSRM; TTL 24 h; persisted to
  `/tmp/gev-scene-osm-cache.json` best-effort (serverless `/tmp` is per-instance
  and not shared — a cold instance refetches).
- **Research cache** — unchanged (`research.js`, revision-aware).

## 8. Guarantees preserved

Build only on click / Ctrl-Cmd+Enter, recording-window recolour without a new
request, scene saving (the `staging` block is persisted and validated on load),
voice draft ownership, Snapchat discovery, scene chat, ElevenLabs narration,
27 camera URL-hash keys, submission/cancel/retry states.
