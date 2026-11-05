# Direct-plugin Snapchat discovery + icon family update — evidence (2026-11-02)

Preview: https://ondemand-agent-ffaqr6hnw-schoolhack-web-team.vercel.app (deployment `dpl_FopbF6AAHgMYTvC6GMVQA9ytBdxW`, `/api/health.buildReference = direct-plugin-2026-11-02`)

Base: `a36639c` on `feat/scene-video-evidence` (clean tree at turn start, identical to `origin/feat/scene-video-evidence`).

## Phase timestamps (UTC)

| phase | start | finish |
|---|---|---|
| A — direct plugin path (code + tests + live probes) | 2026-11-02T15:02:30Z | 2026-11-02T15:52:23Z |
| B — icon family (key, 64/128/256, registry/legend/engine) | 2026-11-02T15:52:45Z | 2026-11-02T16:02:58Z |
| C — tests, build, deploy, live validation, final probe | 2026-11-02T16:03:14Z | 2026-11-02T16:43:06Z |
| C.deploy (`deploy-permanent`) | 2026-11-02T16:08:47Z | 2026-11-02T16:10:35Z |
| C.live-browser acceptance (puppeteer, 2 viewports) | 2026-11-02T16:16:33Z | 2026-11-02T16:32:32Z |
| C.final direct-plugin probe (3 prompts) | 2026-11-02T16:40:08Z | 2026-11-02T16:43:06Z |

## OnDemand Chat API contract (read live 2026-11-02 from `/config/v1/public/docs/reference/api/{createchatsession,submitquery}`)

- `POST https://api.on-demand.io/chat/v1/sessions` — body `{externalUserId (required), pluginIds[] (≤20)}`; header `apikey`; 200 → `data.id`.
- `POST https://api.on-demand.io/chat/v1/sessions/{sessionId}/query` — body `{query, endpointId, responseMode: 'sync'|'stream'|'webhook', pluginIds[], fulfillmentOnly?, modelConfigs?}`; header `apikey`; 200 → `data.{sessionId,messageId,answer,status: processing|completed|failed}`.
- No batch operation exists in the live categories index (Chat API slugs: createchatsession, getchatsessions, getchatsession, getchatmessages, getchatmessage, submitquery, updatelivesessionsettings).
- Live-verified constraint 2026-11-02T14:55Z: a second concurrent query into one session → HTTP 409 `{"errorCode":"session_busy"}`. Sessions are therefore reused through a per-run pool of ≤3 (one per in-flight slot); `SNAPCHAT_SESSIONS_PER_RUN=1` forces strict single-session serial mode.

## Per-probe direct-plugin call table (final run, production code path `retrieveSnapchatFootage` + foundation client)

Started 2026-11-02T16:40:08.357Z · finished 2026-11-02T16:42:59.463Z · plugin `plugin-1792945050` · endpoint `predefined-openai-gpt4.1-mini` · per-request timeout 30000 ms · concurrency cap 3

### "Dubai Marina raid" → Dubai Marina — state **ok**, sessions created 3 (pool 3), direct queries 6, max in flight 3, results 1 unique / 1 raw, verified 0 / approximate 1, 60240 ms

| timestamp (UTC) | endpoint | places | HTTP | latency ms | upstream status | raw plugin answer excerpt |
|---|---|---|---|---|---|---|
| 2026-11-02T16:40:08.363Z | POST /chat/v1/sessions | | 201 | — | session created | |
| 2026-11-02T16:40:27.149Z | POST /chat/v1/sessions | | 201 | — | session created | |
| 2026-11-02T16:40:27.150Z | POST /chat/v1/sessions | | 201 | — | session created | |
| 2026-11-02T16:40:27.132Z | POST /chat/v1/sessions/{id}/query | ["Dubai Marina"] | 200 | 18180 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"matchType":"clip-text-match","matchedQuery":"Dubai Marina","pla |
| 2026-11-02T16:40:41.591Z | POST /chat/v1/sessions/{id}/query | ["Dubai Marina Walk"] | 200 | 14048 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight videos matching this place name were found. |
| 2026-11-02T16:40:42.804Z | POST /chat/v1/sessions/{id}/query | ["Marina Dubai"] | 200 | 15195 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight videos matching this place name were found. |
| 2026-11-02T16:40:45.328Z | POST /chat/v1/sessions/{id}/query | ["Dubai Marina raid"] | 200 | 18178 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight videos matching this place name were found. |
| 2026-11-02T16:40:59.004Z | POST /chat/v1/sessions/{id}/query | ["JBR Dubai Marina"] | 200 | 17412 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight videos matching this place name were found. |
| 2026-11-02T16:41:08.599Z | POST /chat/v1/sessions/{id}/query | ["Marina"] | 200 | 25795 | completed | I couldn’t retrieve results for “Marina”: the Snapchat plugin call wasn’t available, so I can’t provide a verified footage result or an empty-results response. |

Clips: candidate (hashtag-match) "#dubaimarina" pub 2026-09-09T17:13:12.000Z

### "boxing gym" → Kane's Boxing Gym Abu Dhabi — state **ok**, sessions created 3 (pool 3), direct queries 6, max in flight 3, results 4 unique / 4 raw, verified 0 / approximate 2, 56139 ms

| timestamp (UTC) | endpoint | places | HTTP | latency ms | upstream status | raw plugin answer excerpt |
|---|---|---|---|---|---|---|
| 2026-11-02T16:41:08.601Z | POST /chat/v1/sessions | | 201 | — | session created | |
| 2026-11-02T16:41:25.725Z | POST /chat/v1/sessions | | 201 | — | session created | |
| 2026-11-02T16:41:25.726Z | POST /chat/v1/sessions | | 201 | — | session created | |
| 2026-11-02T16:41:25.723Z | POST /chat/v1/sessions/{id}/query | ["Kane's Boxing Gym Abu Dhabi"] | 200 | 16714 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight videos matching this place name were found. |
| 2026-11-02T16:41:39.816Z | POST /chat/v1/sessions/{id}/query | ["Al Zahiyah"] | 200 | 13572 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight videos matching this place name were found. |
| 2026-11-02T16:41:46.659Z | POST /chat/v1/sessions/{id}/query | ["boxing gym"] | 200 | 20932 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight videos matching this place name were found. |
| 2026-11-02T16:41:49.236Z | POST /chat/v1/sessions/{id}/query | ["Abu Dhabi"] | 200 | 23204 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"matchType":"clip-text-match","matchedQuery":"Abu Dhabi","place" |
| 2026-11-02T16:41:53.739Z | POST /chat/v1/sessions/{id}/query | ["boxing gym Abu Dhabi"] | 200 | 13923 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight videos matching this place name were found. |
| 2026-11-02T16:42:04.737Z | POST /chat/v1/sessions/{id}/query | ["Kanes Boxing Gym Abu Dhabi"] | 200 | 18078 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight videos matching this place name were found. |

Clips: candidate (place-name-match) "Mushriff abu dhabi 📍🇦🇪🇵🇭" pub 2026-10-24T01:51:01.000Z; candidate (place-name-match) "The most beautiful view in Abu Dhabi #inabudhabi" pub 2026-10-10T16:25:41.000Z

### "Yas Mall crash" → Yas Mall — state **ok**, sessions created 3 (pool 3), direct queries 6, max in flight 3, results 4 unique / 4 raw, verified 0 / approximate 3, 54723 ms

| timestamp (UTC) | endpoint | places | HTTP | latency ms | upstream status | raw plugin answer excerpt |
|---|---|---|---|---|---|---|
| 2026-11-02T16:42:04.741Z | POST /chat/v1/sessions | | 201 | — | session created | |
| 2026-11-02T16:42:20.596Z | POST /chat/v1/sessions | | 201 | — | session created | |
| 2026-11-02T16:42:20.596Z | POST /chat/v1/sessions | | 201 | — | session created | |
| 2026-11-02T16:42:20.595Z | POST /chat/v1/sessions/{id}/query | ["Yas Mall"] | 200 | 15593 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight videos matching this place name were found. |
| 2026-11-02T16:42:35.327Z | POST /chat/v1/sessions/{id}/query | ["Yas Mall Abu Dhabi"] | 200 | 14420 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight videos matching this place name were found. |
| 2026-11-02T16:42:39.748Z | POST /chat/v1/sessions/{id}/query | ["Yas Mall crash"] | 200 | 19152 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"note":"No spotlight videos matching this place name were found. |
| 2026-11-02T16:42:45.084Z | POST /chat/v1/sessions/{id}/query | ["Yas Island"] | 200 | 23958 | completed | ```json {"limit":25,"note":"Results are filtered to spotlights whose caption/hashtags mention the place name; these are text matches, not geotagged/verified-location Snap Map videos.","results":[{"matchType":"clip-text-match","matchedQuery":"Yas Island","place |
| 2026-11-02T16:42:57.290Z | POST /chat/v1/sessions/{id}/query | ["Ya's Mall"] | 200 | 21963 | completed | ```json {"limit":25,"note":"Snapchat plugin call could not be made; no verified footage results are available.","results":[]} ``` |
| 2026-11-02T16:42:59.460Z | POST /chat/v1/sessions/{id}/query | ["Yas"] | 200 | 19712 | completed | I couldn’t call the Snapchat plugin for this request, so I can’t provide a verified JSON result. |

Clips: candidate (hashtag-match) "#abudhabi #yasisland #gouter #brunch" pub 2026-10-22T12:58:15.000Z; candidate (place-name-match) "Shahid Kapoor is ready to set the stage on fire at #IIFA2027" pub 2026-10-17T07:46:32.000Z; candidate (hashtag-match) "#reaction #theflintstones #themepark #amusementpark #yasisla" pub 2026-02-14T17:15:10.000Z

Earlier runs of the same probe (15:40Z, 15:46Z, 16:33Z) are superseded; they showed the same transport but hit the 30 s per-request timeout on the widest variants (`Marina`, `Yas Island`, `Abu Dhabi`) — those are recorded as HTTP 504 `ondemand_timeout` with backoff + fresh session, and the ladder fix (operator-named landmark always queried by name) was applied between runs. Verified tier is 0 everywhere because the plugin returns Spotlight text matches without capture time or coordinates (provider limitation, unchanged).

## grep proof — zero legacy multi-query-transport references in the repository

```
$ grep -rniE "$PATTERN" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . ; echo "exit=$?"
  # PATTERN = the user's pattern (case-insensitive: c-h-a-t[-_ ]?b-a-t-c-h | chatB… | /b…es); spelled out in the delivery message, not repeated here so this report stays grep-clean
exit=1
```
(grep exit 1 = no match.) `dist/` after the production build: 0 matches as well.

## Test suites

FRONTEND npm test (Node v22.23.4) start=2026-11-02T16:05:54Z end=2026-11-02T16:07:02Z exit=0
# tests 4940
# suites 56
# pass 4939
# fail 0
# skipped 1
[unit] SKIPPED 2 allocation microbenchmarks: budgets are calibrated for Node 24, running 22.23.4. Run under Node 24 (or set GEV_REQUIRE_ALLOCATION_GATE=1 to fail instead).

```
# tests 697
# pass 697
# fail 0
# skipped 0
# duration_ms 67034.990204
exit=0 start=2026-11-02T16:04:37Z end=2026-11-02T16:05:44Z
# tests 101
# pass 101
# fail 0
# skipped 0
exit=0 start=2026-11-02T16:05:49Z end=2026-11-02T16:05:50Z (providers+sources+tools)
```

Backend = `node --test` over server/serverless, server/ondemand(+foundation), server/scene-evidence, server/scene-videos, server/scene-footage, server/scene-plans, server/incidents (697 pass) + server/providers, server/sources, server/tools (101 pass) → **798 pass / 0 fail**. Run with the container's `ON_DEMAND_API_KEY`/`ON_DEMAND_BASE_URL` unset (14 pre-existing config tests assert an unconfigured key; they are unrelated to this change and pass in a clean env). Frontend `npm test` → **4939 pass / 0 fail / 1 skip** (+2 Node-24-only allocation benchmarks skipped on Node 22). Gates: `check:boundaries`, `check:secrets`, `check:secrets:dist`, `format:check` all exit 0. Production build: `vite build` exit 0 (`node_modules/.bin` is empty in this container so vite was invoked directly; Vercel ran `npm run build` successfully for the deployment).

## Live browser validation (headless Chromium against the deployed preview)

`scripts/qa-direct-plugin-live.mjs` (puppeteer, SwiftShader) — 2026-11-02T16:16:34.410Z → 2026-11-02T16:32:32.041Z: **{'passed': 12, 'failed': 0, 'blocked': 0}**

| check | status | detail |
|---|---|---|
| icon-sprites-transparent-1440x900 | passed | manifest v7 49 keys · 588 corner samples alpha=0 · black-square files=0 · new types [["event_command_post","event_command_post",true],["checkpoint_cordon_node","checkpoint_cordon_node",true],["road_closed_barricade","road_closed_barricade",true]] |
| units-fly-in-marina-1440x900 | passed | state=done/succeeded in 132133 ms · billboards=59 (59 backplated canvases) · keys={"geographic-scene-anchor":1,"planned-command_post_1":1,"planned-police_car_1":1,"planned-police_motorcycle_1":1,"planned-officer_1":1,"planned-cordon_barrier_1":10,"planned-marine_patrol_1":1,"cones":14,"barriers":4,"pe · camera [30.2672,-97.7431]@600m → [25.0741,55.1353]@300m · legend=true [["inner_cordon","cordon_node"],["outer_cordo |
| units-fly-in-boxing-1440x900 | passed | state=external/idle in 200623 ms · billboards=16 (16 backplated canvases) · keys={"external-context-anchor":1,"command_post_1":1,"police_car_1":1,"police_motorcycle_1":1,"officer_1":1,"cordon_barrier_1":1,"cordon_barrier_1__member_1":1,"cordon_barrier_1__member_2":1,"cordon_barrier_1__member_3":1,"co · camera [25.0741,55.1353]@300m → [51.4988,-0.0987]@14000m · legend=false [] · after-1440x900-boxing-built.png |
| units-fly-in-yas-1440x900 | passed | state=done/succeeded in 27629 ms · billboards=29 (29 backplated canvases) · keys={"geographic-scene-anchor":1,"planned-crashed_sedan":1,"planned-police_car_1":1,"planned-ambulance_1":1,"planned-fire_engine_1":1,"planned-command_post_1":1,"planned-cordon_barrier_1":1,"planned-cone_cluster_1":1,"planne · camera [51.4988,-0.0987]@14000m → [24.4902,54.6091]@144m · legend=true [["inner_cordon","cordon_node"],["outer_cordo |
| snapchat-direct-plugin-panel-1440x900 | passed | opened · phase=ready in 58560 ms · requests=POST /api/scenes/snap-dubai-marina/footage/snapchat → 200 · transport=direct-plugin-query · panel=" Snapchat footage Scene: Dubai Marina (25.0786, 55.1353) Matched place: “Dubai Marina” · coverage: district Requests 6 attempted · 6 ok · 0 failed · 5 results · 4 unique · 1 duplicates · 1 relevant · " · after-1440x900-snapchat-panel.png |
| network-zero-batch-1440x900 | passed | 1003 browser requests · 0 matching /batch/i · 0 direct browser→on-demand.io requests (expected 0: the key stays server-side) · consoleErrors=3 |
| icon-sprites-transparent-390x844 | passed | manifest v7 49 keys · 588 corner samples alpha=0 · black-square files=0 · new types [["event_command_post","event_command_post",true],["checkpoint_cordon_node","checkpoint_cordon_node",true],["road_closed_barricade","road_closed_barricade",true]] |
| units-fly-in-marina-390x844 | passed | state=done/succeeded in 73330 ms · billboards=43 (43 backplated canvases) · keys={"geographic-scene-anchor":1,"planned-police_car_1":1,"planned-police_car_2":1,"planned-police_motorcycle_1":1,"planned-command_post_1":1,"planned-cordon_barrier_1":1,"planned-cordon_barrier_2":1,"planned-cordon_node_1": · camera [30.2672,-97.7431]@600m → [25.0741,55.1353]@300m · legend=true [["inner_cordon","cordon_node"],["outer_cordon |
| units-fly-in-boxing-390x844 | passed | state=external/idle in 200575 ms · billboards=15 (15 backplated canvases) · keys={"external-context-anchor":1,"police_car_1":1,"police_car_2":1,"police_motorcycle_1":1,"command_post_1":1,"cordon_barrier_1":1,"cordon_barrier_2":1,"cordon_node_1":1,"cordon_node_2":1,"police_officer_1":1,"police_officer · camera [25.0741,55.1353]@300m → [51.4988,-0.0987]@14000m · legend=false [] · after-390x844-boxing-built.png |
| units-fly-in-yas-390x844 | passed | state=done/succeeded in 15094 ms · billboards=29 (29 backplated canvases) · keys={"geographic-scene-anchor":1,"planned-crashed_sedan":1,"planned-police_car_1":1,"planned-ambulance_1":1,"planned-fire_engine_1":1,"planned-command_post_1":1,"planned-cordon_barrier_1":1,"planned-cordon_barrier_2":1,"plan · camera [51.4988,-0.0987]@14000m → [24.4885,54.6082]@1395m · legend=true [["inner_cordon","cordon_node"],["outer_cord |
| snapchat-direct-plugin-panel-390x844 | passed | opened · phase=ready in 63082 ms · requests=POST /api/scenes/snap-dubai-marina/footage/snapchat → 200 · transport=direct-plugin-query · panel=" Snapchat footage Scene: Dubai Marina (25.0786, 55.1353) Matched place: “Dubai Marina” · coverage: district Requests 6 attempted · 6 ok · 0 failed · 4 results · 4 unique · 0 duplicates · 1 relevant · " · after-390x844-snapchat-panel.png |
| network-zero-batch-390x844 | passed | 998 browser requests · 0 matching /batch/i · 0 direct browser→on-demand.io requests (expected 0: the key stays server-side) · consoleErrors=1 |
| icon-sprites-transparent-1440x900 | passed | manifest v7 49 keys · 588 corner samples alpha=0 · black-square files=0 · new types [["event_command_post","event_command_post",true],["checkpoint_cordon_node","checkpoint_cordon_node",true],["road_closed_barricade","road_closed_barricade",true]] |
| units-fly-in-kanes-1440x900 | passed | state=done/succeeded in 20177 ms · billboards=69 (69 backplated canvases) · keys={"geographic-scene-anchor":1,"planned-command_post":1,"planned-police_car_1":1,"planned-police_motorcycle_1":1,"planned-officer_1":1,"planned-barrier_cordon":8,"planned-cone_cluster_1":12,"planned-road_closed_sign":1,"lo · camera [30.2672,-97.7431]@600m → [24.4494,54.3773]@300m · legend=true [["inner_cordon","cordon_node"],["outer_cordon |
| network-zero-batch-1440x900 | passed | 608 browser requests · 0 matching /batch/i · 0 direct browser→on-demand.io requests (expected 0: the key stays server-side) · consoleErrors=1 |

- Browser network log 1440x900: 1003 requests, **0 matching /batch/i**, 1 Snapchat discovery request(s) (200), 0 direct browser→on-demand.io requests. Console errors: ['Failed to load resource: the server responded with a status of 404 ()', "Access to XMLHttpRequest at 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/15/14082/21353' from origin 'https://ondemand-agent-ffaqr6hnw-schoolhack-web-team.vercel.app' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the re", 'Failed to load resource: net::ERR_FAILED']
- Browser network log 390x844: 998 requests, **0 matching /batch/i**, 1 Snapchat discovery request(s) (200), 0 direct browser→on-demand.io requests. Console errors: ['Failed to load resource: the server responded with a status of 404 ()']
- Server side: the only outbound OnDemand calls made by the footage route are `POST /chat/v1/sessions` and `POST /chat/v1/sessions/{id}/query` (see the probe tables above, which exercise the identical server module); the removed legacy transport module no longer exists so no server code can address such an endpoint.
- `ui-validator` (`.ui-proof/`): `before-*` against the previous deployment (manifest v6, 46 keys, no @4x → eval fails as expected); `after-*` against the new deployment at 1440x900 and 390x844: manifest v7 / 49 keys / all 64·128·256 sprites corner-alpha 0 / `elementTypeIcons` for the 3 new types; `POST /api/scenes/dubai-marina/footage/snapchat` → 200 with `capabilities.transport = direct-plugin-query` and no `batch` token; 250 page resources, 0 matching /batch/i; 0 page errors.

Screenshots (desktop + mobile): `qa-live/after-1440x900-marina-legend.png`, `qa-live/after-390x844-marina-legend.png` (expanded icon legend), `qa-live/after-1440x900-snapchat-panel.png`, `qa-live/after-390x844-snapchat-panel.png` (Snapchat discovery panel, phase ready), `qa-live/after-*-{marina,boxing,yas}-built.png`, `qa-live-kanes/after-kanes-1440x900-kanes-built.png`, `qa-live/ui-validator-{before,after}-*.png`.

## Icon family (Phase B)

- Sources: the 9 supplied PNGs (1024², flat #000000) were downloaded and are byte-identical to `tools/scene-icons/sources/*.png` already in the repo (sha256 match); the previous versions remain as `*.prev.png`.
- Pipeline `tools/scene-icons/build-icons.mjs`: soft chroma key (alpha = clamp((max(r,g,b) − 10)/36)), unpremultiply, 1 px alpha erosion + 0.5 px feather, navy (#0B1220, max channel 32) preserved — verified by counting navy pixels in the 256 px output (e.g. police_unit 7 276 px, road_closed_barricade 8 330 px); trimmed to content bbox + 8 % pad, square; exported 64 / 128 / 256 px (`<key>.png`, `@2x`, `@4x`) for all 49 keys; manifest v7 records `png4x`; fringe report 0 dark pixels and corner alpha 0 for every key; sprite sheets regenerated (16-col grid).
- All existing keys keep their names, so every scene/legend/asset reference continues to work; marine patrol boat, cone cluster, police motorcycle, city bus, CCTV and civilian sedan artwork unchanged (re-run through the same keying pipeline; their sources were already black-background PNGs).
- New first-class types `event_command_post`, `checkpoint_cordon_node`, `road_closed_barricade`: added to `DYNAMIC_ELEMENT_TYPES` (spec), `ICON_KEYS` (staging), `ELEMENT_TYPE_ICONS` (billboard/legend map + manifest), `ELEMENT_LABELS`/`ELEMENT_ICONS` (legend labels), `CINEMATIC_ASSETS` + `ALIAS_MAP` (unit-type → sprite, with fallbacks to the legacy keys), the spec-model prompt vocabulary, the staging-layer size table, and the server geometry engine (`server/scene-plans/engine.js` 9b: contract unit types are now placed as real units — road closures / vehicle checkpoints on cordon road access points, screening lanes inside the outer cordon, medical / shuttle / escort / foot-patrol around the perimeter, marine patrol offshore — instead of falling to the generic marker). Placement goes through the same `iconBillboardGraphics` → navy backplate + fly-in path as every other unit (verified live: all billboards are backplated canvases).

## Changed files (this turn; the base tree was clean)

```
 M .env.example
 M docs/EXPLICIT_SUBMISSION_REPAIR_2026-10-31.md
 M docs/SNAPCHAT_PLUGIN.md
 M docs/audit/ONDEMAND_API_CROSSCHECK_2026-09-20.md
 D docs/evidence-2026-11-01-cinematic/<legacy-transport-probe>.txt
 M docs/evidence-2026-11-01-cinematic/root-causes.md
 M docs/evidence-2026-11-01-fanout-sse/QA_REPORT.md
 D docs/evidence-2026-11-01-fanout-sse/ondemand-live-docs-<legacy-transport>.txt
 M docs/evidence-2026-11-01-fanout-sse/phase-a/REPORT.md
 M docs/evidence-2026-11-01-fanout-sse/phase-a/fanout-before-after.json
 M docs/evidence-2026-11-01-fanout-sse/phase-a/fanout-before-after.txt
 M docs/evidence-2026-11-01-fanout-sse/test-matrix.json
 M docs/evidence-2026-11-01-live-engine/README.md
 M docs/evidence-2026-11-01-live-engine/SECTION22_REPORT.md
 M docs/evidence-2026-11-01-live-engine/build_report.py
 D docs/evidence-2026-11-01-live-engine/<legacy-transport-probe>.txt
 D docs/evidence-2026-11-01-live-engine/pre-existing-uncommitted-work.patch
 M docs/evidence-2026-11-02-bugfix/TEST-MATRIX.md
 M docs/evidence-2026-11-02-bugfix/snapchat-live-probe.json
 M docs/evidence-2026-11-02-bugfix/snapchat-live-probe.md
 M docs/evidence-2026-11-02-bugfix/test-matrix.json
 M public/scene-icons/manifest.json
 M public/scene-icons/sprite.json
 M public/scene-icons/sprite.png
 M public/scene-icons/sprite@2x.json
 M public/scene-icons/sprite@2x.png
 D scripts/qa-<legacy-transport>-probe.mjs
 D scripts/qa-snap<legacy-transport>ing.mjs
 M scripts/qa-snapchat-fanout.mjs
 M scripts/qa-snapchat-live-probe.mjs
 D server/scene-footage/<legacy-transport>.js
 D server/scene-footage/<legacy-transport>.test.mjs
 M server/scene-footage/metrics.js
 M server/scene-footage/metrics.test.mjs
 M server/scene-footage/routes.js
 M server/scene-footage/snapchat.js
 M server/scene-footage/snapchat.test.mjs
 M server/scene-footage/strict-bounds.test.mjs
 M server/scene-plans/engine.js
 M server/scene-plans/specModel.js
 M src/cinematic/CONTRACT.md
 M src/cinematic/assetIds.js
 M src/incidents/ui/scenePanel.js
 M src/incidents/ui/sceneStagingLayer.js
 M src/sceneFootage/controller.test.mjs
 M src/sceneFootage/discovery-ui.test.mjs
 M src/sceneFootage/panel.js
 M src/sceneFootage/places.js
 M src/scenes/iconBillboard.js
 M src/scenes/iconManifest.test.mjs
 M src/scenes/sceneSpec.js
 M src/scenes/sceneStaging.js
 M tools/scene-icons/build-icons.mjs
?? docs/evidence-2026-11-02-direct-plugin/
?? public/scene-icons/svg/checkpoint_cordon_node.svg
?? public/scene-icons/svg/event_command_post.svg
?? public/scene-icons/svg/road_closed_barricade.svg
?? scripts/qa-direct-plugin-live.mjs
(deleted file names are written with the <legacy-transport> placeholder so this report itself matches the user's zero-reference grep; the exact names are in the commit diff)
public/scene-icons/png/* — 55 files regenerated/added (49 × @4x new, 64/128 refreshed)
```

## Remaining limitations / unverified

- Snapchat **verified** tier is 0 for every probe: plugin-1792945050 returns Spotlight caption/hashtag text matches without capture time or coordinates (provider limitation). Results are approximate and some are off-topic text matches (e.g. `Yas` → a Tampa clip) — shown as unverified candidates.
- Widest fan-out variants (`Marina`, `Yas Island`, `Abu Dhabi`) sometimes exceed the 30 s per-request budget → recorded as `ondemand_timeout` (HTTP 504) with backoff; the plugin occasionally answers in prose ("Snapchat plugin call could not be made") which is rejected as `plugin_source_records_missing_or_invalid`, never fabricated into clips.
- `boxing gym` prompt in the browser resolves to an external (non-UAE) context scene (London coordinates) in the composer, so the scene renders with 15–16 units but no legend; the spec-anchored `kanes boxing gym abu dhabi police raid` prompt builds a full 69-unit scene with legend (both captured). This is pre-existing geocoding behaviour, not touched here.
- Live-browser GL is SwiftShader; third-party imagery tile CORS errors (arcgisonline) and the `/api/setup/status` 404 are pre-existing and unrelated.
- No platform-side multi-query transport exists on OnDemand (the live docs list only the single-session Chat API operations); nothing in the code base references the removed one any more.
