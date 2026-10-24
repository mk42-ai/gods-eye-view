# BUILD SCENE repair — proof (2026-10-24)

Bug report: typing `burj khalifa` (lowercase) into the AOI composer and clicking BUILD SCENE does nothing.

## Root cause

The link the user was testing (`https://ondemand-agent-k8v6snzk7-schoolhack-web-team.vercel.app`, deployment `dpl_H9yVA3kDuV8ekgs7xzj7AjDPgaSH`) serves the pre-engine build `6fa336c` from the `ondemand-agent` project, which is **not git-linked**; every later sandbox preview (`sb-7n5i0h35o7m1` for `f11b426`) is ephemeral and was already `SANDBOX_STOPPED` (HTTP 410). On that old build the composer's click handler does fire (one `submit` event, three chips `locating → verifying → building: done`, message "Scene built at Burj Khalifa … — playing") but the Gods-Eye scene engine (`window.__godsEye`) was never installed, so nothing flies, no header/rail/timeline/evidence/pins/Scenes entry appears and the button silently returns to idle — exactly "does nothing". The engine wiring landed in `41b0923`/`f11b426` on `feature/live-footage-dock` (PR #3) and builds the lowercase prompt end-to-end in ~27 s in a fresh sandbox, but was never promoted to a persistent URL. This commit additionally hardens the path so a stall can never again look like "nothing happened": explicit BUILDING… progress state on the button, a 75 s build watchdog that ends in the designed error + Retry, the camera flight forcing Cesium's render loop on (flyTo only completes on rendered frames), a bounded Overpass backoff (≤3 mirrors per request, 429 → ≥30 s park) so OSM never blocks a scene, and a served build id in the DOM so a preview is provably the revision under test.

## Evidence

| check | result | screenshot | ts (UTC) | detail |
|---|---|---|---|---|
| (A) production dpl_H9yVA3kDuV8ekgs7xzj7AjDPgaSH — "burj khalifa" + REAL pointer click | REPRODUCED (no scene) | before-production-k8v6snzk7-burj-lowercase-1440x900-2026-10-24T02-59-12-872Z.png | 2026-10-24T02:56:00.156Z | click handler fired (submit event ×1), chips locating:done verifying:done building:done, result "Scene "burj khalifa" built at Burj Khalifa, 1, Sheikh Mohamm…", engine=False, header/rail/pins = False/0/0 |
| (A) f11b426 in fresh sandbox — same real click | builds (27 s) | before-burj-lowercase-1440x900-*.png | 2026-10-24T02:35:xxZ | already fixed at f11b426; sb-7n5i0h35o7m1 itself was SANDBOX_STOPPED (HTTP 410) |
| (b) after fix — real pointer click, lowercase | PASS | after-burj-lowercase-1440x900-2026-10-24T03-48-11-990Z.png | 2026-10-24T03:47:45.451Z | S4 + playing in 27 s; BUILDING… disabled state seen=True, re-enabled=True; rail 3 cards, pins 16, Scenes entry 1; build fix-2026-10- |
| (a) no-prompt load renders globe/2D map + UI | PASS | spec21/a-load-1440x900.png | 2026-10-24T03:48:27.802Z | {"rs":"ready","canvas":true,"raster":0,"nav":7,"composer":true} |
| (b) Burj Khalifa BUILD SCENE: stages, fly-in, header/pins/rail/timeline/evidence, Scenes panel | PASS | spec21/b2-burj-khalifa-built-1440x900.png | 2026-10-24T03:49:00.902Z | {"id":"s_mvluzt09upsmx9","title":"Burj Khalifa","status":"playing","stage":"S4","target":{"name":"Burj Khalifa","lat":25.1972,"lon":55.2744, |
| (c) Enter: Umm Suqeim rebuild + archival banner | PASS | spec21/c-umm-suqeim-rebuild-1440x900.png | 2026-10-24T03:49:30.930Z | {"id":"s_mvlv0gk2j43sl9","kind":"rebuild","target":{"name":"Umm Suqeim","lat":25.147,"lon":55.199,"geocodeSource":"dictionary","confidence": |
| (d) Open saved scene from Scenes panel — zero refetch (network log) | PASS | spec21/d-open-saved-scene-1440x900.png | 2026-10-24T03:49:39.733Z | {"opened":"s_mvluzt09upsmx9","requestsDuring":107,"refetch":[],"armed":"armed"} |
| (e) layout 1440×900: no overlap/clipping, HUD controls grouped | PASS | spec21/e-layout-1440x900.png | 2026-10-24T03:50:12.879Z | {"W":1440,"H":900,"docOverflowX":false,"clipped":[],"overlaps":[],"loose":[]} |
| (e) layout 1024×768: no overlap/clipping, HUD controls grouped | PASS | spec21/e-layout-1024x768.png | 2026-10-24T03:50:16.034Z | {"W":1024,"H":768,"docOverflowX":false,"clipped":[],"overlaps":[],"loose":[]} |
| (e) layout 767×524: no overlap/clipping, HUD controls grouped | PASS | spec21/e-layout-767x524.png | 2026-10-24T03:50:17.698Z | {"W":767,"H":524,"docOverflowX":false,"clipped":[],"overlaps":[],"loose":[]} |
| (e) layout 401×511: no overlap/clipping, HUD controls grouped | PASS | spec21/e-layout-401x511.png | 2026-10-24T03:50:19.326Z | {"W":401,"H":511,"docOverflowX":false,"clipped":[],"overlaps":[],"loose":[]} |
| (e) grouped HUD controls stack (Display/CCTV/Context + BITS/LVL) at 767×524 | INFO | spec21/e-hud-stack-767x524.png | 2026-10-24T03:50:21.149Z |  |
| (e) 0 application console errors (flow + layout runs) | PASS |  | 2026-10-24T03:50:21.149Z | [] |
| (f) no-WebGL 2D fallback: map renders + scene builds S0→S4 | PASS | spec21/f-no-webgl-2d-build-767x524.png | 2026-10-24T03:50:29.365Z | {"is2d":true,"stage":"S4","tiles":9,"hash":"lat=25.194052378726962&lon=55.274400000000014","footage":3} |

## Files

- `before-production-k8v6snzk7-*` — reproduction on the user's production link (spec 22, real mouse down/up).
- `before-*`, `before-eager-*` — `f11b426` in a fresh sandbox (map ready / eager click while the map was still starting).
- `after-*` — fixed build in the sandbox (spec 22 with `REPRO_EXPECT_PASS=1`).
- `spec21/` — tests/e2e/21 (a)–(f) against the fixed preview: results.json, console-log.json, network-log.json.gz, screenshots.

All console/network logs were scanned: 0 occurrences of the API key; the 429s in the after-run are `terrain.reearth.land` terrain tiles (third-party), not application errors.
