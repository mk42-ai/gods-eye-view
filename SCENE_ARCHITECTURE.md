# Scene architecture — two-tier Scene Spec DSL + deterministic engine

_Status: implemented on `feat/scene-video-evidence` (2026-11-01). This document is
the contract between the fast model, the deterministic engine, the renderer and
the left-panel explanation. Keep it in sync with `src/scenes/sceneSpec.js`,
`src/scenes/sceneTemplates.js`, `src/scenes/sceneStaging.js`,
`server/scene-plans/specModel.js` and `server/scene-plans/engine.js`._

## 1. Split of responsibilities

| Tier | Owner | Allowed to do | Never does |
|---|---|---|---|
| **Fast model** (tier 1) | `server/scene-plans/specModel.js` | Emit ONE Scene Spec JSON: `scenarioType`, `focalEntity`, abstract `elements[]` with scalar `params`, `confidence` | Emit coordinates, polygons, routes, labels drawn on the map, free text drawn on the map |
| **Deterministic engine** (tier 2, heavy prebuilt code) | `server/scene-plans/engine.js` (+ `osm.js`) | Resolve the anchor (existing Perplexity-first chain in `location.js`), fetch OSM footprints/roads (Overpass `around:`), route approach/egress (OSRM), compute cordons/cones/barriers/units/staging (Turf.js), de-duplicate labels, cache per location | Ask a model for geometry; invent coordinates when a data source is unavailable (it records `unavailable[]` instead) |
| **Renderer** | `src/incidents/ui/sceneStagingLayer.js` (Cesium entities) | Cased + glowing lines, dashed cordons, icon billboards from the sprite atlas, haloed labels ≥ 13 px with priority declutter, ONE fixed "ILLUSTRATIVE" badge | Repeat the illustrative warning as map labels; show `[1,2,3]` citation tokens on the map |
| **Explanation panel** | `src/incidents/ui/scenePanel.js` (mounted in `sceneStudio.js`) | Title, one-line summary, Scenario, Location + confidence badge, Elements with icon + count, numbered source chips, single caveat line, "Built with `<model>` in `<ms>`" | Stack warning banners; print raw citation tokens |

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
    { "type": "inner_cordon | outer_cordon | approach_route | egress_route | staging_point | perimeter_unit | checkpoint | cones | barriers | cctv_signal | crowd_zone | route_line | start_finish",
      "params": { "radius_m?": 10-5000, "count?": 1-200, "spacing_m?": 2-500, "direction?": "N|NE|E|SE|S|SW|W|NW" } }
  ],
  "confidence": 0-1
}
```

* Validated with **zod** (`SceneSpecSchema`, `strictObject` everywhere). The same
  schema is exported as JSON Schema (`SCENE_SPEC_JSON_SCHEMA`) and as an
  OpenAI-strict variant with `additionalProperties:false` on every object and all
  properties required/nullable (`SCENE_SPEC_STRICT_JSON_SCHEMA`).
* `parseSceneSpec(raw)` normalises provider output (nulls, numeric strings,
  case, params flattened onto the element, repeated single-instance elements
  merged into a `count`, a missing `confidence` defaulted to 0.5 — observed live
  from both OnDemand endpoints on 2026-11-01) and **rejects unknown element
  types** (`rejected[]`).
* `repairSceneSpec(raw, prompt)` (`sceneTemplates.js`) drops unknown elements,
  appends the scenario's `REQUIRED_ELEMENTS` from the template, overrides a
  non-raid classification when the prompt is unmistakably a raid, and replaces
  an unparseable spec with `templateSpec(prompt)`.

## 3. Model fallback chain (`server/scene-plans/specModel.js`)

Checked against the live OnDemand registry on 2026-11-01 (`GET /config/v1/public/endpoints`
+ live `/chat/v1/sessions/{id}/query` probes):

| Order | Provider / endpoint | Notes |
|---|---|---|
| 1 | **Cerebras direct** `https://api.cerebras.ai/v1/chat/completions`, model `qwen-3.8-27b`, `response_format:{type:'json_schema', json_schema:{strict:true}}`, `temperature:0`, `max_tokens:400`, `reasoning_effort:'none'`, **2 s timeout, 1 retry** | Only when `CEREBRAS_API_KEY` is configured server-side. Fallback model `qwen-3-235b-a22b-instruct-2507` (non-strict JSON + validation) when strict returns 400. |
| 2 | **OnDemand** `predefined-cerebras-qwen-3.8-27b` (Cerebras-hosted `qwen-3.8-27b` through the existing server key) | Measured 2.0–3.7 s per classification on the four QA prompts (all schema-valid after normalisation); `fulfillmentOnly:true`. 15 s budget. |
| 3 | **OnDemand** `predefined-gpt-6.1-sol`, `reasoningEffort:'medium'` | The brief's "GPT 6.1 sol ultra-fast" endpoint does **not** exist: `predefined-gpt-6.1-ultra-fast` and `predefined-gpt-6.1-sol-ultra-fast` are rejected with HTTP 400 `endpointId … is invalid`; the registry has `gpt-6.1-sol` and `gpt-6.1-terra` only. Measured 2.9 s. |
| 4 | **Scenario template** (`templateSpec`) | Always succeeds → a scene ALWAYS builds. |

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

| property | values |
|---|---|
| `id` | unique, `^[a-z][a-z0-9_-]*$` |
| `element` | one of the DSL element types |
| `role` | `focal`, `cordon`, `route`, `unit`, `cone`, `barrier`, `signal`, `zone`, `marker` |
| `label` | ≤ 48 chars, **no** `[n]` tokens, no "ILLUSTRATIVE" prefix |
| `priority` | integer sort key: focal 100 > cordons 90 > routes 80 > units/checkpoints/staging 60 > cctv 50 > cones/barriers 10 (higher wins the declutter) |
| `icon?` | sprite key (`cone`, `police_unit`, `barrier`, `cctv_signal`, `checkpoint`, `staging_point`, `perimeter_unit`, `crowd_zone`, `start_finish`, `egress`) |
| `lineStyle?` | `cordon_inner`, `cordon_outer` (dashed), `route_approach`, `route_egress`, `route_line` (glow) |
| `color` | `#14B8A6` teal (primary), `#A7F3D0` mint (highlight), `#FFFFFF` (accent) |
| `provenance` | `osm-footprint-buffer`, `circle-buffer`, `osrm-route`, `overpass-highway`, `turf-along`, `turf-intersect`, `camera-discovery` |
| `illustrative` | `true` |

`validateSceneStaging(raw)` (browser + Node, dependency-free) rejects anything
else: this is what the saved-scene store and the renderer trust.

## 5. Rendering rules (Cesium ⇄ MapLibre equivalence)

| Brief (MapLibre) | Cesium implementation |
|---|---|
| `text-halo-width ≥ 1.5`, `text-halo-color #0B1220` | `LabelStyle.FILL_AND_OUTLINE`, `outlineWidth: 4` (≈2 px at DPR 1), `outlineColor #0B1220` |
| `text-size 13–14`, zoom interpolation | `font: '600 13px …'` (14 px for the focal label), `scaleByDistance` 1.0 → 0.85 |
| `text-allow-overlap:false` + `symbol-sort-key` | `postRender` declutter: project every label, greedy by `priority`, hide lower-priority labels whose screen box overlaps |
| de-duplicated labels | engine emits one label per element group (`labels` layer); identical texts are merged |
| line casing + core | `PolylineOutlineMaterialProperty` (outline `#0B1220`, width 2) around teal/mint core; cordons `PolylineDashMaterialProperty`; routes `PolylineGlowMaterialProperty` |
| icon sprites + `icon-size` by zoom | billboards from `/scene-icons/png/<key>.png` with `scaleByDistance` |
| ONE watermark badge | fixed `#scene-illustrative-badge` DOM element, never a map label |

## 6. Asset catalogue (`public/scene-icons/`)

Generated PNGs (black background keyed to alpha, centred, 8 % padding) and
hand-authored SVGs in the palette (teal `#14B8A6`, mint `#A7F3D0`, white, navy
`#0B1220`). Sprite sheets `sprite.png` (48 px, 1x) and `sprite@2x.png` (96 px)
with MapLibre-format JSON atlases (`sprite.json`, `sprite@2x.json`; each entry
`{x,y,width,height,pixelRatio,sdf:false}`), usable directly as a MapLibre sprite
or as a deck.gl `iconAtlas` + `iconMapping`.

| key | PNG | SVG | sprite index |
|---|---|---|---|
| cone | `png/cone.png` | `svg/cone.svg` | 0 |
| police_unit | `png/police_unit.png` | `svg/police_unit.svg` | 1 |
| barrier | `png/barrier.png` | `svg/barrier.svg` | 2 |
| cctv_signal | `png/cctv_signal.png` | `svg/cctv_signal.svg` | 3 |
| checkpoint | `png/checkpoint.png` | `svg/checkpoint.svg` | 4 |
| staging_point | `png/staging_point.png` | `svg/staging_point.svg` | 5 |
| perimeter_unit | `png/perimeter_unit.png` | `svg/perimeter_unit.svg` | 6 |
| crowd_zone | `png/crowd_zone.png` | `svg/crowd_zone.svg` | 7 |
| start_finish | `png/start_finish.png` | `svg/start_finish.svg` | 8 |
| egress | `png/egress.png` | `svg/egress.svg` | 9 |

## 7. Caching

* **Spec cache** — none (prompt revisions must re-classify).
* **OSM cache** — `server/scene-plans/osm.js`: memory LRU keyed by
  `round(lat,4),round(lon,4),radius` for Overpass footprints/roads and by the
  rounded waypoint pair for OSRM; TTL 24 h; persisted to
  `/tmp/gev-scene-osm-cache.json` best-effort (serverless `/tmp` is per-instance
  and not shared — a cold instance refetches).
* **Research cache** — unchanged (`research.js`, revision-aware).

## 8. Guarantees preserved

Build only on click / Ctrl-Cmd+Enter, recording-window recolour without a new
request, scene saving (the `staging` block is persisted and validated on load),
voice draft ownership, Snapchat discovery, scene chat, ElevenLabs narration,
27 camera URL-hash keys, submission/cancel/retry states.
