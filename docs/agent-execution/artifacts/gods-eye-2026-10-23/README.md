# Gods-Eye scene engine — evidence (2026-10-23, `feature/live-footage-dock`)

Preview used for every check: `https://sb-6qy737x1zlks.vercel.run` (Vercel sandbox; Vite build served
by `server/serverless/dev-server.mjs`, `api/footage` uvicorn proxied at `/footage/*`).
Suite: `tests/e2e/*.spec.mjs` (Playwright 1.56, system Chromium, SwiftShader WebGL), run with
`PREVIEW_URL=… ./tests/e2e/run-live.sh`. Fixtures (`?fixtures=1` + `page.route`) replay
`tests/fixtures/*.json`; live endpoint samples are in `endpoint-samples/`.

## Acceptance matrix (spec §14)

| # | check | result | evidence |
|---|---|---|---|
| 1 | load with no prompt → 0 media requests, 0 `<video>`, rail hidden, camera idle | **pass** (28.5 s) | `screenshots/01-…`, `network-01.json` (`[]`) |
| 2 | Burj Khalifa → in-AOI, route agent scenePath, S0–S4 altitudes ±15 %, VIIRS S0/S1, pins S2, player only at S4, ≥5 items with distance + Δt | **pass** (52.5 s) | `screenshots/02-…` |
| 3 | "rebuild the car crash reported in Umm Suqeim" → 25.147/55.199, banner `REBUILT FROM ARCHIVAL FOOTAGE — originally reported 2026-09-26`, Δt vs tRef, dubaipolicehq / gulfnews / gulftoday handles, SZR + Al Wasl + Jumeirah routes with status | **pass** (1.8 m) | `screenshots/03-…`, `endpoint-samples/*umm-suqeim*`, `tests/fixtures/step1-fixtures.json` |
| 4 | outside the register → modal; decline = 0 requests; accept registers + builds | **pass** (41 s) | `screenshots/04-…` |
| 5 | route agent mocked 500 → great-circle fallback, `ROUTE: FALLBACK` chip, scene completes | **pass** (44 s) | `screenshots/05-…` |
| 6 | Instagram toggle off removes pins/cards, on restores | **pass** (50 s) | `screenshots/06-…` |
| 7 | save → reload → Open: identical S4 camera, pins, routes, cards, 0 media requests | **pass** (46 s) | `screenshots/07-…`, `network-07.json` (`[]`) |
| 8 | Recreate → fly-in from S0, route re-called, `+N new · M removed · K unchanged` | **pass** (1.8 m) | `screenshots/08-…` |
| 9 | build A then B → no A artefacts in B, A stream aborted | **pass** (1.3 m) | `screenshots/09-…`, `network-09.json` (A's embed `net::ERR_ABORTED`) |
| 10 | timeline scrub 15-min window, Play chronological, mocked alert marker | **pass** (1.4 m) | `screenshots/10-…` |
| 11 | START/NEXT three saved scenes → time order, dwells 4.2 s + 11 s ±200 ms, STOP | **pass** (1.8 m) | `screenshots/11-…` |
| 12 | clock-mocked lifecycle NEW +1 h, gone +25 h, Archive tab +73 h | **pass** (53 s) | `screenshots/12-…` |
| 13 | `sc=` share URL on a fresh profile + stripped state-fallback URL, 0 refetch | **pass** (1.5 m) | `screenshots/13-…` |
| 14 | 390×844: sidebar collapses, rail/timeline stack, no overflow, fly-in runs | **pass** (45 s) | `screenshots/14-…` |
| 15 | prefers-reduced-motion → `setView` cuts, same stage order, 0 `flyTo` | **pass** (33 s) | `screenshots/15-…` |
| 16 | ≥55 fps while 30 items stream S2–S4 | **BLOCKED** — 1.7 fps measured on SwiftShader (`ANGLE … SwiftShader Device (Subzero)`); the harness asserts ≥55 only on a GPU renderer and records the trace either way | `perf-16.json` |
| 17 | visual regression header / rail / timeline / player / Scenes / sidebar / route at 1440×900, 1024×768, 390×844 | **pass** after re-baseline (run 1 failed on stale crops: rail 58→56 px, scenes 390→404 px, player poster art — the designed posters and the Sources sidebar intentionally changed them) | `visual-baselines/`, `visual-diff-run1/`, `playwright-results-run2-spec17-rebaselined.json` |
| 18 | no key strings in the bundle, 0 console / page errors | **pass** (48 s) — `bundle-scan-18.json` `matchedSecrets: []`, `console-18.json` 0/0; `check-no-secrets --dist` clean; `grep` of the server key over `dist/` = 0 | `bundle-scan-18.json`, `console-18.json` |

Totals: run 1 `16 passed · 3 failed (spec 17 ×3 projects) · 35 skipped (project filters + spec 16 BLOCKED)`
in 21.7 min; run 2 (spec 17 only) `3 passed` in 5.9 min. Machine-readable: `acceptance-matrix.json`.

## Unit / integration

`npm test` → 4 396 node:test (4 395 pass, 1 allocation microbenchmark skipped on Node 22);
`node --test src/gods-eye/**/*.test.mjs` → 94 pass (normalisers, ranker, haversine, state machine,
reducer/store, share codec, ladder/path interpolation, SSE merge + abort, route fallback, posters,
register modal); `pytest api/footage/tests` → 20 pass; `npm run check:boundaries` clean.

## Results tables — see `results-tables.json`

Footage (fixture replay the acceptance tests ran against; live samples alongside):

| scene | platform | count | nearest km | closest Δt | status | cache on Recreate |
|---|---|---|---|---|---|---|
| Burj Khalifa (live, tRef = build time) | youtube | 3 | 0.157 | −10 min | ok | miss → re-fetched, diff vs cached |
|  | instagram | 2 | 0.000 | −15 min | ok |  |
|  | reddit | 1 | 0.919 | −30 min | ok |  |
|  | web | 1 | 0.919 | −60 min | ok |  |
|  | tiktok / x | 0 / 0 | — | — | quota / inactive |  |
| Umm Suqeim rebuild (tRef 2026-09-26T07:00Z) | instagram | 3 | 0.167 | +2 h 12 min | ok | miss → re-fetched, diff vs cached |
|  | web | 3 | — (article, inferred) | +1 h 30 min | ok |  |
|  | reddit | 1 | — | +48 min | ok |  |
|  | youtube | 1 (placeholder) | — | +7 h 05 min | ok |  |
|  | tiktok / x | 0 / 0 | — | — | quota / inactive |  |

Live `/footage/search?…mode=rebuild` (13.8 s): instagram **ok 5** (DdyBfSdl-zh, Ddv9evCDLQp, DXgVj3djDAR,
DW8khmCg4CY, DWqtTHDgSdN — all ARCHIVE), youtube ok 20 fetched / 0 within the Umm Suqeim relevance gate,
x `unavailable` (agent inactive), tiktok `unavailable` (not subscribed), reddit / web / instagram-plugin
timeout at the 13 s search budget (the 28 s SSE budget usually lands them).

Routes:

| scene | route | kind | status | source | alerts |
|---|---|---|---|---|---|
| Burj Khalifa | Sheikh Zayed Road (E11) | motorway | open | FIXTURE route table | — |
| Burj Khalifa | Financial Centre Road (D71) | arterial | open | FIXTURE route table | — |
| Umm Suqeim | Sheikh Zayed Road (E11) | motorway | open | FIXTURE (RTA status mocked) | — |
| Umm Suqeim | Al Wasl Road (D92) | arterial | restricted | FIXTURE (lane closure mocked) | lane closure near Umm Suqeim St (07:20Z) |
| Umm Suqeim | Jumeirah Street (D94) | arterial | unknown | FIXTURE | — |
| Umm Suqeim (LIVE `/footage/route/plan`) | E11 / D92 / D94 | motorway / arterial / arterial | unknown | curated-table (no live status) — agent `plugin-1750847932` **not subscribed** → `fallback:true`, confidence 0.3 | — |

## Ranking formula (Web Worker, `src/gods-eye/footage/ranker.js`)

`rankScore = 0.35·exp(−distanceKm/3) + 0.30·exp(−|Δt|/τ) + 0.25·relevance + 0.10·geoConf`,
τ = 6 h (live/incident) · 30 d (rebuild); geoConf exact 1.0 / inferred 0.6 / unknown 0.2;
recency LIVE < 15 min · RECENT < 24 h · ARCHIVE (rebuild scenes always ARCHIVE).

## Stage ladder actually used (`src/gods-eye/camera/ladder.js`)

S0 8 000 km / −90° / 1.2 s + hold 1.5 s → S1 1 200 km / −70° / 2.2 s + 1.5 s → S2 18 km (preset) / −60° /
2.6 s + dwell 4.2 s → S3 2 km / −45° / 2.2 s + 1.5 s → S4 300 m on approach bearing / −30° / 2.3 s +
dwell 11 s → idle orbit. Travel 10.5 s; reduced-motion = `setView` cuts with 150 ms fades.

## Blockers (what is needed to pass on production)

| item | needed to unblock |
|---|---|
| Test 16 ≥55 fps | a GPU-backed Chromium (the pod has only SwiftShader → 1.7 fps); the trace + harness are in place |
| Route Monitoring Agent live routes | subscribe `plugin-1750847932` on the OnDemand account (`/footage/route/plan` → `agent.status: inactive`, fallback used) |
| TikTok | RapidAPI plan upgrade on the OnDemand TikTok plugin (`not subscribed` / monthly quota on BASIC) |
| X | activate the X Search agent on this key (`inactive or missing configuration`) |
| YouTube timestamps | `YOUTUBE_API_KEY` (Data API v3) — today public-page scraping, `~approx` published_at |
| Exact incident hour (Umm Suqeim) | not reported by Gulf Today / Khaleej Times (published 14:51–14:52Z 2026-09-26); Dubai Police dispatch data would be needed — `tRef` is the reported date, labelled as such |
| Reddit / Instagram verification | Reddit 403 unauthenticated; Instagram serves a login shell — plugin credentials or Graph API access |
| Posters `state-route-fallback.png`, `state-outside-aoi.png` | upstream image generation failed (HTTP 400); both were rendered locally (PIL, same monochrome green/amber HUD style, no text, 1280×720) |
| Production (`ondemand-agent` Vercel project) | project is Git-linked to another repo; promote by merging PR #3 and redeploying, or by linking the project to `mk42-ai/gods-eye-view` |
