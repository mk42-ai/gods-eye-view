# Explicit Build scene + research-grounded map geometry — 2026-10-31 (UTC)

Repository `mk42-ai/gods-eye-view`, branch `feat/scene-video-evidence`, commit `cc93fb5` (parent `689b1a5`; `cca89df`, `f20fab6` and `5c56f4d` remain ancestors). The repo was edited in place; nothing was reset or force-pushed. The working tree was clean when work began.

Preview: https://ondemand-agent-5b0turvg0-schoolhack-web-team.vercel.app (deployment `dpl_5emGoTn3Do9cgRrRDMaT3vs9rCP9`, 12:42:44Z).

## Root causes
- **Build scene**: the button was `type=submit`, so the browser could submit the form implicitly (for example, Enter in the `datetime-local` range fields). An empty, focused composer could also be seeded by the location field. Typing and debounce no longer triggered builds, because that was removed earlier in `3046b79`.
- **Lines and dots**: the dashed line and its dots came from **camera keyframes**, not from research. Entity labels were long LLM prose drawn with an opaque `#10232d` Cesium label background. That background is the navy bar. The beat title was also written into the anchor strip. Research returned citations but no geometry.

## Changes
- One native `type=button` (with the svg icon inside it and `pointer-events:none`) handles clicks. Ctrl/Cmd+Enter is the only keyboard shortcut. The form cannot submit implicitly. Enter in a date field does nothing. A focused composer is never seeded. Cancel, Retry and snapshot behaviour are unchanged.
- `server/scene-plans/geometry.js` works in three steps. Perplexity (OnDemand session with `plugin-1722260873`) names the locations, routes and footprints and supplies citations. Model coordinates are ignored. OSM Nominatim then grounds the points and polygons, limited to ±0.6° around the anchor and 60 km from it. The OSRM car router snaps routes to roads. Features that cannot be grounded are listed as unresolved. If research fails, the result is an explicit `unavailable` state. The run is cached and time-bounded (120 s) and runs in parallel with event verification. Grounded features are passed to the staging planner as local metre points.
- `src/scenes/sceneGeometry.js` holds the validator, the pure spec→render function, the recording-window state, the signature and the description. Geometry is persisted with saved scenes and validated when they load.
- `src/incidents/ui/sceneGeometryLayer.js` draws Cesium polylines, points and polygons clamped to the ground, with outlined labels (`ILLUSTRATIVE · name [n]`). It adds hover tooltips with citations and a legend with status, window counts, unresolved places and sources. Changing the window restyles the entities in place; nothing is rebuilt.
- The camera orbit line and dots are removed, along with the beat strip and label backgrounds. Police and security markers are labelled `Suggested / illustrative – not verified deployment`. The planner prompt forbids tactical or deployment detail.

## Live results (headless Chromium via ui_validate.py, DOM events + real API)
See `test-matrix.json`. Desktop audit (13:01:35–13:05:19Z): 13 of 13 checks passed.
- Typing a multiline prompt caused 0 construct and 0 locate requests.
- One icon click plus one button click produced exactly 1 construct request.
- Dubai Marina: 2 points, 1 area, 7 citations.
- Sheikh Zayed Road: a 500-vertex road-snapped route, 3 points, 2 areas, 5 citations.
- The two scenes have different signatures (5b8ba98b vs 1ac8d7b6).
- Changing the window to 6 h made no new construct request. The geometry was not re-rendered (renders 2→2, restyles 0→1) and the scene id was preserved.

Mobile 390×844 Burj Khalifa run (13:07:21Z): paste caused 0 calls, one click caused 1 call, and the scene completed. The legend stayed inside the viewport with no horizontal overflow.

## Constraints and limitations
- The requested “GPT 6.1 ultra-fast, medium reasoning” model is not exposed. The live endpoint list offers `predefined-gpt-6.1-sol` and `predefined-gpt-6.1-terra`, with no ultra-fast variant. The app keeps its configured `predefined-claude-sonnet-5.5`. Subagents ran on the platform's subagent model.
- Geometry comes from OSM and Nominatim. It is a *researched reference*, not a surveyed event course. Undated recurring real events still return `needs_clarification`.
- The PR already exists for this branch (GitHub 422), and the API did not return its URL. The push succeeded.
- Not run this turn: physical keyboard/IME hardware, ElevenLabs audio (billing-blocked previously), and live re-runs of the 27 hash keys and save/reload.
