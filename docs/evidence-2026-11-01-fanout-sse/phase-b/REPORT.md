# Phase B Report — Relaxing Scene Spec DSL and Wiring 9 Keyed Icons

**Date / Timestamp:** 2026-11-01T07:55:00Z  
**Agent:** Agent 2 (Phase B)  
**Repository:** `gods-eye-view`

---

## 1. What Changed (File List)

### Modified Files (Existing)
1. `src/scenes/sceneSpec.js`: Added dynamic intelligence DSL (`DYNAMIC_ELEMENT_TYPES`), permissive dynamic validation (`parseDynamicSceneSpec`), string sanitization (`sanitizeString`), citation URL validation (`isValidCitationUrl`), and open JSON schema (`SCENE_SPEC_DYNAMIC_JSON_SCHEMA`). Preserved existing closed `ELEMENT_TYPES`, `parseSceneSpec`, `validateSceneSpec`, and schemas.
2. `src/scenes/sceneSpec.test.mjs`: Added tests for dynamic types, unknown accepted element types, generic flag assignment, offset and bbox clamping, parameter caps, string sanitization, citation URL validation, and open JSON schema.
3. `src/scenes/sceneStaging.js`: Extended `ICON_KEYS` (all 16 keys), `STAGING_COLORS` (added `#F59E0B` amber), `STAGING_ROLES` (`overwatch`, `command`, `node`), `PRIORITY` declutter rankings, and `validateSceneStaging` to support `notes[]`, `timeline[]`, and dynamic properties (`confidence`, `source`, `evidenceTier`, `generic`, `relevance`, `atSec`).
4. `server/scene-plans/specModel.js`: Updated model prompt instructions to solicit dynamic intelligence elements with confidence, source, and offsets. Updated fallback classification to parse with `parseDynamicSceneSpec` first, falling back to scenario templates only when zero valid elements are returned. Documented strict schema mode preservation for direct Cerebras inference.
5. `server/scene-plans/specModel.test.mjs`: Updated unknown element test to verify that unknown types are accepted with `generic: true` rather than rejected/dropped.
6. `server/scene-plans/geometry.js`: Exported `offsetToCoordinates` utility to convert `{ eastM, northM }` meter offsets from an anchor into `[lon, lat]` coordinates.
7. `server/scene-plans/engine.js`: Implemented deterministic Turf geometry rendering for `threat_zone` (`#F59E0B` amber), `interest_zone` (`#14B8A6` teal), `crowd_density_zone` (`#A7F3D0` mint), `overwatch`, `command_post`, `cordon_node`, `cctv_pick`, `intel_note` (label-only if carrying offset, plus collection into `staging.notes[]`), `timeline_event` (collection into `staging.timeline[]`), and generic unknown markers (`icon: 'generic'`).
8. `server/scene-plans/engine.test.mjs`: Added tests for dynamic element rendering (zones, markers, notes, timeline, generic markers) and verified deterministic output (`same input -> same output`).
9. `src/incidents/ui/sceneStagingLayer.js`: Added billboard support and icon sizing for all 16 manifest keys, wired Cesium `ScreenSpaceEventHandler` `MOUSE_MOVE -> scene.pick` lightweight hover tooltip displaying element type, confidence %, source attribution, evidence tier, and relevance.
10. `src/incidents/ui/sceneStagingLayer.test.mjs`: Added test for tooltip DOM lifecycle, billboard icon keys, and updated declutter priority thresholds.
11. `src/incidents/ui/scenePanel.js`: Added element labels and icons for all dynamic intelligence types.
12. `src/incidents/ui/scenePanel.test.mjs`: Added unit tests verifying `ELEMENT_LABELS` and `ELEMENT_ICONS` coverage for dynamic types.
13. `src/ui/styles/scene-studio.css`: Added CSS styles for `#scene-staging-tooltip` hover tooltips.
14. `SCENE_ARCHITECTURE.md`: Updated Section 2 (Dynamic Intelligence DSL & open schema), Section 5 (Rendering rules, hover tooltip, declutter priorities), and Section 6 (Asset catalogue, keying pipeline, 16 icon keys, MapLibre sprite specifications).

### New Files Created
15. `tools/scene-icons/build-icons.mjs`: Reproducible Node.js / `sharp` icon keying and sprite atlas generation script.
16. `src/scenes/iconManifest.test.mjs`: Test suite verifying manifest integrity, 32px and 64px image dimensions, PNG magic signatures, MapLibre sprite sheets, and SHA-256 digests.
17. `public/scene-icons/manifest.json`: Version 2 asset manifest containing metadata, sprite rects, source mappings, and SHA-256 hashes for all 16 keys.
18. `public/scene-icons/png/**`: Exported 32px 1x and 64px 2x PNGs for all 16 keys.
19. `public/scene-icons/svg/**`: SVGs for all keys including generated `generic.svg`, `cctv.svg`, `command_post.svg`, `cordon_node.svg`, `route_start.svg`, and `route_finish.svg`.
20. `public/scene-icons/sprite.png`, `sprite@2x.png`, `sprite.json`, `sprite@2x.json`: Rebuilt MapLibre sprite atlases covering all 16 icons.
21. `docs/evidence-2026-11-01-fanout-sse/phase-b/REPORT.md`: This report.

---

## 2. Dynamic Intelligence DSL Additions

### Permissive-but-Safe Architecture
- **Dynamic Vocabulary:** Adds `threat_zone`, `interest_zone`, `approach_route`, `egress_route`, `overwatch`, `command_post`, `checkpoint`, `cordon_node`, `crowd_density_zone`, `cctv_pick`, `intel_note`, `timeline_event`, alongside existing `ELEMENT_TYPES`.
- **Accepted Unknown Elements:** Unrecognized element types emitted by fast models are accepted into the spec and marked `generic: true`. The renderer visualizes them as generic point markers with the `'generic'` sprite icon. Only structurally invalid elements (non-objects or entries missing a `type`) enter `rejected[]`.
- **Attribution & Confidence:** Every element may carry `confidence` (clamped 0–1, defaults to 0.5) and a sanitized `source` attribution string (max 120 characters).
- **Offsets & Clamping:** Elements accept optional `offset: { eastM, northM }` relative to the anchor, clamped to ±5000 m and further clamped to an optional caller-supplied AOI bounding box (`bbox`).
- **Caps & Boundaries:**
  - `radius_m`: clamped to 5–5000 m.
  - `count`: clamped to 1–200 integer.
  - `spacing_m`: clamped to 2–500 m.
  - `label`: sanitized, max 48 characters.
  - `relevance`: 0–1 for `cctv_pick`.
  - `evidenceTier`: `'sourced' | 'inferred' | 'generated'` for `intel_note`.
  - `citations`: array of `{ url, title? }` for `intel_note`, requiring valid HTTP/HTTPS URLs ≤ 2000 chars.
  - `timeline_event`: requires `atSec >= 0` and sanitized `title <= 80 chars`.
- **Sanitization:** `sanitizeString(val, maxLen)` strips ASCII control characters (`\u0000-\u001f`, `\u007f`), HTML tags (including script and style blocks), and bracketed citation tokens (`[1]`, `[1, 2]`).
- **Template Fallback Policy:** Scenario templates serve as a fallback ONLY when model output fails the permissive parse by producing zero valid elements.

---

## 3. Icon Pipeline

### Command
```bash
node tools/scene-icons/build-icons.mjs
```

### Keying & Transformation Pipeline
1. **Source Input:** 9 high-resolution (1024×1024 RGB) source images in `tools/scene-icons/sources/` with pure black `#000000` background.
2. **Soft Threshold Keying:**
   $$\alpha = \text{clamp}\left(\frac{\max(r, g, b) - 8}{40}, 0, 1\right)$$
   Anti-aliased edges transition smoothly to transparency without harsh halo artifacts.
3. **Un-premultiplication:**
   $$C_{\text{orig}} = \min\left(255, \max\left(0, \text{round}\left(\frac{C_{\text{obs}}}{\alpha}\right)\right)\right)$$
   Restores true hue values for boundary pixels blended with black.
4. **Bounding Box & Padding:** Calculates content bounding box $[x_{\min}, y_{\min}, x_{\max}, y_{\max}]$, pads by 8% of the maximum content dimension, and centers onto a square canvas.
5. **Special Cases:**
   - `route_start`: Derived from `route_flag.png` in standard orientation.
   - `route_finish`: Derived from `route_flag.png`, horizontally mirrored using `.flop()`.
   - `generic`: Programmatically generated target dot sprite with teal `#14B8A6` outer ring, navy `#0B1220` outline, and white `#FFFFFF` center.
   - Preserved existing keys (`police_unit`, `cctv_signal`, `staging_point`, `perimeter_unit`, `start_finish`): Rendered from SVG sources at 32px and 64px.
6. **Outputs:**
   - 32 px 1x PNGs to `public/scene-icons/png/<key>.png`.
   - 64 px 2x PNGs to `public/scene-icons/png/<key>@2x.png`.
   - Sprite sheet 1x: `public/scene-icons/sprite.png` (512×32) + `sprite.json`.
   - Sprite sheet 2x: `public/scene-icons/sprite@2x.png` (1024×64) + `sprite@2x.json`.
   - Manifest: `public/scene-icons/manifest.json` (version 2) with SHA-256 hashes.

### Asset Manifest (16 Keys & SHA-256 List)

| Key | 1x PNG | 2x PNG | Sprite Rect (1x) | Source File | SHA-256 (32px PNG) |
|---|---|---|---|---|---|
| `cone` | `png/cone.png` | `png/cone@2x.png` | `0, 0, 32, 32` | `tools/scene-icons/sources/cone.png` | `031956c297534f4a344dfafee41f2e0ae080f481de0725a528e53b300855e163` |
| `police_unit` | `png/police_unit.png` | `png/police_unit@2x.png` | `32, 0, 32, 32` | `public/scene-icons/svg/police_unit.svg` | `0b0f388c932b147e00448efb09fc49edf405e91e973c4e8a643cd19d471944a4` |
| `barrier` | `png/barrier.png` | `png/barrier@2x.png` | `64, 0, 32, 32` | `tools/scene-icons/sources/barrier.png` | `ca77b07126a5fea4e67521bf726b1a6ad0af74bf0f02dbad3e99e1299cb6f90e` |
| `cctv_signal` | `png/cctv_signal.png` | `png/cctv_signal@2x.png` | `96, 0, 32, 32` | `public/scene-icons/svg/cctv_signal.svg` | `527d92e66af41dfb65fe5e53d42cb3b2d0ee6b3a5a8277ead67c381df9f89731` |
| `checkpoint` | `png/checkpoint.png` | `png/checkpoint@2x.png` | `128, 0, 32, 32` | `tools/scene-icons/sources/checkpoint.png` | `e387b27c4c722447b1fe6468a5793e02a4d5620c201d408a49afc595e2133b9a` |
| `staging_point` | `png/staging_point.png` | `png/staging_point@2x.png` | `160, 0, 32, 32` | `public/scene-icons/svg/staging_point.svg` | `4ba5ecb4ed13789b3f2960888346fceaf55678e0f9b044b1afd89d5d37496767` |
| `perimeter_unit` | `png/perimeter_unit.png` | `png/perimeter_unit@2x.png` | `192, 0, 32, 32` | `public/scene-icons/svg/perimeter_unit.svg` | `1be0bae38878f5583eefa76ef0156307f1c5daa833b6ec4c9caf341569c94085` |
| `crowd_zone` | `png/crowd_zone.png` | `png/crowd_zone@2x.png` | `224, 0, 32, 32` | `tools/scene-icons/sources/crowd_zone.png` | `5ef5b5d1b6be279f43ce1a2296cd31143796905b6114a5c265cd64ba4d3a2b3e` |
| `start_finish` | `png/start_finish.png` | `png/start_finish@2x.png` | `256, 0, 32, 32` | `public/scene-icons/svg/start_finish.svg` | `063fc3a4d4fab8b2807ce6c434eea6da60f554772aae216fc99e3914a94ac49e` |
| `egress` | `png/egress.png` | `png/egress@2x.png` | `288, 0, 32, 32` | `tools/scene-icons/sources/egress.png` | `d860d61d02b61fe44ae62e82cddc69e79a43aa2d896169a42970da550cd666a3` |
| `command_post` | `png/command_post.png` | `png/command_post@2x.png` | `320, 0, 32, 32` | `tools/scene-icons/sources/command_post.png` | `25fb55e316d7ad750b585a82600a84d62316dd7d354e65a4fc360c5b02aff7a2` |
| `cctv` | `png/cctv.png` | `png/cctv@2x.png` | `352, 0, 32, 32` | `tools/scene-icons/sources/cctv.png` | `76f7cbdb0e5471829dee3d592ad96ed1c623dc80cff545d78529a42c3ef68c4b` |
| `cordon_node` | `png/cordon_node.png` | `png/cordon_node@2x.png` | `384, 0, 32, 32` | `tools/scene-icons/sources/cordon_node.png` | `033d726c6e703b3e44f80612e287ea0c3e833c5ec11d62497bed0840c73d9d0a` |
| `route_start` | `png/route_start.png` | `png/route_start@2x.png` | `416, 0, 32, 32` | `tools/scene-icons/sources/route_flag.png` | `a2fc687a4d84014728a90e62bc667af89bb324d2e36d237e825f1ff6ffee2404` |
| `route_finish` | `png/route_finish.png` | `png/route_finish@2x.png` | `448, 0, 32, 32` | `tools/scene-icons/sources/route_flag.png` (flop) | `6f469735e5b2c8d1c91f13dd51dc71a6c9c08dbec89b5b6f78b5272e3afd3632` |
| `generic` | `png/generic.png` | `png/generic@2x.png` | `480, 0, 32, 32` | `generated:generic` | `016c4296a81145f9762abcd5e05fd24f31d4f71bd7ce535f77f1a1f7c47f1b8e` |

---

## 4. Test Execution Summary

### Test Command
```bash
node --test \
  src/scenes/iconManifest.test.mjs \
  src/scenes/sceneSpec.test.mjs \
  src/scenes/sceneTemplates.test.mjs \
  src/scenes/sceneStaging.test.mjs \
  src/incidents/ui/sceneStagingLayer.test.mjs \
  src/incidents/ui/scenePanel.test.mjs \
  server/scene-plans/specModel.test.mjs \
  server/scene-plans/engine.test.mjs \
  server/scene-plans/geometry.test.mjs
```

### Execution Timestamp
`2026-11-01T07:51:37Z`

### Results
- **Suites:** 9 test files (0 suite failures)
- **Tests Total:** 108 tests
- **Passed:** 108 tests
- **Failed:** 0
- **Duration:** 45,587 ms

### Notable Assertion Updates
- In `server/scene-plans/specModel.test.mjs`: Updated test 4 (`'JSON with an unknown element is accepted as generic: true and reported'`). Previously, unknown elements like `sniper_nest` were dropped during strict repair. Under the new dynamic intelligence DSL, unknown element types are accepted, marked with `generic: true`, and retained in the spec.
- All other existing assertions remain intact and fully passing.
