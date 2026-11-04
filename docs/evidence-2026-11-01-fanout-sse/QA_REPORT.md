# Gods-Eye View — Fan-out Snapchat discovery, dynamic Scene Spec DSL, SSE streaming builds

**QA & delivery report — 2026-11-01 (all times UTC)**

| | |
|---|---|
| Repository / branch | `mk42-ai/gods-eye-view` · `feat/scene-video-evidence` (edited in place) |
| Base at start | `ca98807` = origin tip (07:06:30Z); ancestors preserved: `b698032`, `cca89df`, `f20fab6`, `5c56f4d`, `948b962` |
| Commits | `8c6f3a7` code (pushed 11:12Z) · `b57de0a` evidence incl. this report (pushed 11:27Z) |
| Pull request | GitHub answered `422 "A pull request already exists for mk42-ai:feat/scene-video-evidence."` → existing PR #4 (https://github.com/mk42-ai/gods-eye-view/pull/4) now carries these commits; no new PR URL exists |
| Live preview (final) | https://ondemand-agent-4nv1jlmuy-schoolhack-web-team.vercel.app (`dpl_FwuDoiN3vit4m8iVjXbocf1h5Cdd`, deployed 10:46:09Z) |
| Earlier preview this turn | https://ondemand-agent-hgrybwgt6-schoolhack-web-team.vercel.app (`dpl_6isgdz7F3A6apmUMwciiYzU2A8hM`, 09:57:16Z) |
| Model actually used (live) | tier-1 Scene Spec: OnDemand `predefined-cerebras-qwen-3.8-27b` (2.4–3.9 s); planner: `predefined-gpt-6.1-sol` medium. `CEREBRAS_API_KEY` is not configured, so the Cerebras-direct tier is inactive (credentialRequest surfaced, optional). Snapchat agent: `predefined-openai-gpt4.1-mini` + `plugin-1792945050`. |
| Tests (final tree) | Frontend `npm test` 4,790 tests → **4,789 pass / 0 fail / 1 skipped** (pre-existing Node-24 allocation gate skip); backend **739 pass / 0 fail**; boundaries, secrets (source + dist), formatting: pass |

Evidence directory (committed): `docs/evidence-2026-11-01-fanout-sse/` — `baseline-git.txt`, `ondemand-live-docs-legacy multi-query transport.txt`, `env-reconciliation.txt`, `frontend-tests.txt`, `backend-tests.txt`, `checks.txt`, `build.txt`, `deploy-output.txt`, `phase-a/`, `phase-b/`, `phase-c/`, `sse-local-smoke/`, `after/` (preview #1), `after2/` + `after2-kanes/` (preview #2, final).

---

## 1. Snapchat call-site audit (file:line, params) — 07:15Z

| File : line | What | Parameters / behaviour (before → after) |
|---|---|---|
| `server/scene-footage/snapchat.js:28-29` | plugin + operation constants | `plugin-1792945050`, `fetchSnapchatVideosByPlace({places, limit})` (unchanged) |
| `server/scene-footage/snapchat.js:73` | `footageConfig().resultLimit` | `SNAPCHAT_RESULT_LIMIT` default **3, cap 10 → default 25, cap 50**; new `SNAPCHAT_FANOUT_MAX_VARIANTS` (6, 1–15), `SNAPCHAT_FANOUT_CONCURRENCY` (4, 1–6). The deployed `.env` still pins `SNAPCHAT_RESULT_LIMIT=3` (pre-existing value, left as-is: the request body never set it and raising it is a cost decision for the owner). |
| `server/scene-footage/snapchat.js:744` `buildQuery()` | agent prompt | one plugin call per step: `places: step.names`, `limit: cfg.resultLimit` |
| `server/scene-footage/snapchat.js:935` `executeStep()` | transport | `sessions.create({pluginIds:[plugin]})` → `query.sync(…, {endpointId, responseMode:'sync', pluginIds})`, `withBackoff` (attempts `SNAPCHAT_MAX_ATTEMPTS`=3, base 1 s, retry on 408/409/425/429/5xx/timeout), per-query timeout `SNAPCHAT_QUERY_TIMEOUT_MS`=120 s |
| `server/scene-footage/snapchat.js:1159-1208` | coverage ladder | sequential: narrowest level first, then ONE batched wider call; **new step 3 (balanced/wide only):** `expandPlaceVariants` → `runFanout` under bounded concurrency, de-duplicated against the ladder's clips (`knownStoryIds`) |
| `server/scene-footage/snapchat.js:575-600` `normalizePluginResponse()` | strict filter | `scope === 'strict'` (or legacy `strictLocation`/`strictCaptureTime`) rejects every clip with `capture-time-unknown` / `verified-location-unknown` — this is where the old "0 verified · 18 unverified" numbers came from. Balanced/wide keep the clip as `tier:'candidate'`. |
| `server/scene-footage/routes.js:145-160` | request validation | new `scope: 'strict'\|'balanced'\|'wide'` (default **balanced**; legacy `mode:'place-mentions'` → balanced); wide → radius 5 km |
| `server/scene-footage/routes.js:295` | cache key | `locationId\|place\|maxLevel\|radius\|strict\|timeWindow\|scope` (TTL `SNAPCHAT_CACHE_TTL_MS`, in-flight coalescing) |
| `server/scene-footage/routes.js:386-399` | response | adds `counts{verified,candidate,raw,unique,variantsTried,truncatedVariants}`, `variants[]`, `fanout`, `scope` |
| `src/sceneFootage/controller.js:221-240` | browser body | sends `scope` from the controls; explicit trigger only |
| `src/incidents/ui/sceneFootageControls.js` | UI | `#scene-snapchat-scope`: Balanced (default) / Strict / Wide (+ legacy place-mentions value); `Discover Snapchat` is still the ONLY trigger — Build scene never searches |

## 2. Assumed-vs-actual plugin schema

| Field | App assumed (ca98807) | Actual (live probe 07:09Z, session `6ae6e5339ca6426bb280e6f3`) | Fix |
|---|---|---|---|
| `uploadDateMs` | string or number | human-readable `"September 9, 2026 at 5:13:12 PM"` | `parsePublicationTime` also accepts `Sept`, missing seconds, ISO strings, epoch strings; TZ assumption UTC stays documented |
| `durationMs`, `viewCount`, `commentCount`, `shareCount` | numbers / null | numeric **strings** (`"16100"`, `"1"`) and `null` | `z.preprocess` coercion; empty → null |
| `hashtags` | `string[]` | array, but sometimes a stringified list | preprocess JSON-list / comma / space forms |
| coordinates, capture time | partly assumed geotag | **absent** (plugin note: text matches, not Snap Map) | missing geo = unknown, never rejected; `tier:'candidate'`; `PROVIDER_CAPABILITIES` updated |
| `storyId`, `storageUrl` | id + SAS mp4 | same | unchanged; SAS redacted in traces/evidence |

## 3. Before/after result counts (live, `scripts/qa-snapchat-fanout.mjs`, 07:37:57Z–07:40:03Z)

| Scene | Before: single name, limit 5 | After: fan-out, limit 25, concurrency 4 | Variants tried (raw/unique) |
|---|---|---|---|
| Dubai Marina (25.0805, 55.1403) | 1 raw / 1 unique (18.7 s) | 2 raw / **1 unique** (22.6 s) | `Dubai Marina` 1/1 · `dubaimarina` 1/0 (same storyId) · `مرسى دبي` 0/0 |
| Burj Al Arab (25.1412, 55.1853) | 2 / 2 (21.3 s) | 3 / **3** (18.8 s) | `Burj Al Arab` 2/2 · `burjalarab` 1/1 (new) · `برج العرب` 0/0 |
| kanes boxing gym abu dhabi (24.495, 54.378 approx.) | 0 / 0 (12.7 s) | 3 / **3** (30.9 s) | `kanes boxing gym abu dhabi` 0 · `kane's boxing gym abu dhabi` 0 · `kanes boxing gym` 0 · `kane's boxing gym` 0 · `kanes` 1/1 · `kane's` 2/2 — the 3 hits are **Harry Kane football clips**, i.e. keyword collisions, shown honestly as unverified candidates |

Through the deployed route (preview #2, browser, balanced scope): Dubai Marina `0 verified · 1 unverified candidate · 3 variants` (10:48:53Z); Kane's scene (anchor Abu Dhabi Corniche) `0 verified · 4 unverified candidates · 5 variants` (11:09Z). Verified stays **0** by construction: this provider exposes no capture time or coordinates.

## 4. legacy multi-query transport verification

Live docs index (`GET https://api.on-demand.io/config/v1/public/docs/categories`, 07:07:18Z): Chat API slugs are `createchatsession, getchatsessions, getchatsession, getchatmessages, getchatmessage, submitquery, updatelivesessionsettings` — **no batch operation is documented**. Probe (07:07:18Z and again 07:37:58Z):

```
POST https://api.on-demand.iothe removed legacy multi-query transport   apikey: <redacted>   {"items":[{"query":"probe"}]}
HTTP/1.1 405 Method Not Allowed
{"message":"legacy multi-query transport creation is currently unavailable","errorCode":"method_not_allowed"}
```
`/chat/v1/sessions/batch`, `/chat/v1/batch`, `/chat/v1/sessions/query/batch` → `404 {"message":"Route not found"}`. `server/scene-footage/legacy multi-query transport.js` records exactly this (`capabilities.legacy multi-query transport = {available:false, status:405, body}`) and the fan-out falls back to bounded concurrent direct sessions. `PROVIDER_CAPABILITIES.legacy multi-query transportApiVerified` carries the probe string.

## 5. Dynamic Scene Spec DSL + icons (Phase B)

* `parseDynamicSceneSpec(raw,{bbox})` accepts `threat_zone, interest_zone, approach_route, egress_route, overwatch, command_post, checkpoint, cordon_node, crowd_density_zone, cctv_pick(relevance), intel_note(evidenceTier, citations[]), timeline_event(atSec,title)`; every element may carry `confidence` (0–1) and `source`; offsets clamped to ±5 km and the AOI bbox; radius 5–5000 m, count 1–200, labels ≤ 48 chars, strings sanitised (control chars, HTML, `[n]` tokens); **unknown types are accepted as `generic:true`** and drawn with the `generic` sprite; templates are fallback only when zero elements parse. Live defect found on preview #1 and fixed in commit `8c6f3a7`: the fast model answered an "observation" with a single `interest_zone` → zero markers; sparse specs are now topped up with the scenario's `REQUIRED_ELEMENTS` (model elements first, `source:'scenario-template'`, `reasons[]` records it).
* Engine renders zones as Turf circles (threat amber `#F59E0B`, interest teal, crowd mint), point elements as billboards (`command_post, checkpoint, cordon_node, cctv, route_start, route_finish, generic`), `intel_note` → `staging.notes[]`, `timeline_event` → `staging.timeline[]`; `validateSceneStaging` accepts the new keys; ONE illustrative badge rule unchanged (verified live: `badgeCount 1, visible true` on every run).
* Icons: `node tools/scene-icons/build-icons.mjs` keys the 9 supplied 1024² RGB PNGs (α = clamp((max(r,g,b)−8)/40,0,1), un-premultiplied, 8 % padding) → 32 px + 64 px `@2x` PNGs for 16 keys, rebuilt `sprite.png`/`sprite@2x.png` + MapLibre JSON, `manifest.json` v2 with sha256 per key (`src/scenes/iconManifest.test.mjs` checks signatures, sizes, rects, hashes). Live: billboards drawn from `cone, barrier, police_unit, perimeter_unit, staging_point, egress, crowd_zone` (the raid/observation scenarios the fast model chose); hover tooltip element `#scene-staging-tooltip` present.

## 6. SSE streaming (Phase C)

Contract and limitations: `phase-c/REPORT.md`. Route `POST /api/ondemand/v2/scene-plans/construct/stream`; events `status → thinking → plan → element_added×N → snap_batch_progress → narration_token×N → usage → done` (`error` / `resume_unavailable`), ids `<requestId>:<n>`, `retry: 3000`, heartbeat comment every 15 s, abort propagates to the model calls, per-instance Last-Event-ID replay ring, `api/[...route].js` `config.supportsResponseStreaming = true`. Client: typewriter buffer paced per animation frame (`clamp(backlog/8, 1, 12)` chars/frame), live chip `model · ~N tok/s (est.) · M.M s`, progressive `scene-stream-preview` Cesium layer, retry pill `⟳ Retry · <reason>` (142×28 px) replacing the banner, Cancel aborts the stream, JSON fallback only on transport failures.

**Honest caveat:** `narration_token` events are synthetic chunks of the finished plan (the planner returns one JSON document), so tokens/s (~121) is a pacing figure; the early feedback is the `plan` event at 2.4–3.9 s and the stage/thinking events. First `element_added` is gated by Perplexity location research + Overpass/OSRM (60–115 s on the live key).

### Measured SSE timings (browser, preview #2 — ms after the Build click)

| run | prompt | viewport | plan | 1st element_added | TTFT (1st narration_token) | done | tokens | tok/s est. | elements |
|---|---|---|---|---|---|---|---|---|---|
| after2 | im doing a raid in the dubai marina | 1440×900 | 3,709 | 78,538 | 91,288 | 93,058 | 214 | 122 | 265 |
| after2 | Burj Al Arab police raid | 1440×900 | 3,513 | 63,794 | 75,121 | 76,615 | 180 | 121 | 167 |
| after2 | kanes boxing gym abu dhabi | 1440×900 | 2,908 | 114,679 | 125,418 | 126,980 | 189 | 121 | 4 |
| after2 | Kanes Boxing Gym Abu Dhabi | 1440×900 | 7,546 | 60,832 | 72,364 | 73,815 | 176 | 121 | 4 |
| after2 | im doing a raid in the dubai marina | 390×844 | 2,529 | 101,564 | 117,028 | 119,293 | 271 | 121 | 265 |
| after2 | Burj Al Arab police raid | 390×844 | 2,453 | 85,639 | 85,652 | 87,953 | 278 | 121 | 25 |
| after2-kanes | kanes boxing gym abu dhabi (rerun) | 1440×900 | 10,273 | 99,117 | 113,223 | 115,471 | 273 | 121 | 4 |

curl against the preview (09:57:37Z, Burj Al Arab): plan +2.9 s, first element +103 s, first token +116 s, done +118 s, 134 element_added, 284 narration_token. Local dev-server smoke (09:48:43Z): 261 element_added, 226 narration_token, 8 heartbeats, done at +120 s.

## 7. Browser validation checklist (headless Chromium via `scripts/qa-fanout-sse.mjs` + `ui-validator`)

| # | Check | Result | Proof (file under `docs/evidence-2026-11-01-fanout-sse/`) |
|---|---|---|---|
| 1 | `im doing a raid in the dubai marina` builds (desktop + mobile) without the geocoder failure | PASS (1440: 10:47:59Z, 390: 11:03Z) — `Verified · 95% confidence`, 250 billboards, 265 elements | `after2/after-im-doing-a-raid-in-the-dubai-marina-{1440x900,390x844}.png` |
| 2 | `Burj Al Arab police raid` builds (desktop + mobile) | PASS (10:50:40Z / 11:06Z) — exact anchor OSM way/12700546, 152 / 10 billboards | `after2/after-burj-al-arab-police-raid-*.png` |
| 3 | `kanes boxing gym abu dhabi` (lowercase) builds with approximate badge instead of the old failure | PASS on rerun 11:08:29Z — `Approximate · 78% confidence`, anchor "Kane's Boxing Academy (AD City)" (OSM way/27374404), 8 staging entities, 1 billboard, legend cctv_signal/perimeter_unit/crowd_zone. The first after2 pass (10:56:20Z) built fine (`done`, approximate badge) but the fast model answered `cctv_signal` only, which the engine never invents → 0 billboards; the QA assertion was tightened to "entities drawn" for observation scenes (markers come only from verified camera discovery). | `after2-kanes/after-kanes-boxing-gym-abu-dhabi-1440x900.png`, `after2/after-kanes-…png` |
| 4 | `Kanes Boxing Gym Abu Dhabi` (exact case) | PASS 11:02:00Z (template fallback this run: both OnDemand tiers timed out at 7.5 s; location city-level 12 %) | `after2/after-kanes-boxing-gym-abu-dhabi-1440x900.png` (later run overwrote the same slug) |
| 5 | 0 construct requests while typing; exactly 1 `/construct/stream` per Build; 0 JSON fallbacks | PASS on all 7 runs (`callsAfterTyping=0`, `stream=1`, `json=0`) | `after2/qa-fanout-sse.json` |
| 6 | SSE progressive rendering visible mid-stream | PASS — screenshot taken when the stream view was in `streaming` state with ≥ 5 preview entities (19 at capture) | `after2/mid-stream-*.png` (4 files, 10:47:44Z, 10:50:26Z, 11:03:51Z, 11:06:07Z) |
| 7 | Icons render at map positions from the new manifest | PASS — billboards use `/scene-icons/png/<key>.png`, on-screen counts 42/151/131/2/1 | `after2/qa-fanout-sse.json → inspect.billboardImages` |
| 8 | Snapchat discovery shows increased counts (balanced) | PASS — Dubai Marina `0 verified · 1 unverified candidate · 3 variants` (preview #1 showed `1 variant`); Kane's `0 verified · 4 unverified candidates · 5 variants`; exactly 1 `/footage/snapchat` request per click | `after2/after-snapchat-*.png`, `after2-kanes/after-snapchat-*.png` |
| 9 | Changing the recording window triggers no new research request | PASS — `networkAfterChange.stream=0, constructJson=0, locate=0, snapchat=0`, same scene id | `after2/after-time-window-{1440x900,390x844}.png` |
| 10 | Retry / cancel flow | PASS — Cancel visible while busy, state `cancelled`, retry pill `⟳ Retry · Cancelled` (142×28 px) with the identical snapshot text, notice one line | `after2/after-cancel-retry-1440x900.png` |
| 11 | Voice module idle/ready | PASS — `#od-voice-status` = `Idle` on every run | all `after-*.png` (OD Voice module bottom-left) |
| 12 | Saved-scene restore | PASS — `Scene saved.` → reload → select → `sceneStaging.status: staged`, badge visible, same scene id; storage notice "Saved in this browser only…" | `after2/after-restore-1440x900.png` (preview #1 FAILED with "Could not save" — fixed: telemetry is now non-enumerable) |
| 13 | Mobile layout 390×844 | PASS — both raids built and inspected at 390×844; smoke screenshot shows composer + Build scene | `after2/*-390x844.png`, `.ui-proof/after-smoke-390x844.png` |
| 14 | ui-validator smoke (both viewports) | PASS 10:53Z — HTTP 200, `#incident-composer-submit/-window/-input` visible, "Build scene" text, old failure text absent, `#scene-snapchat-scope` default `balanced`, `/scene-icons/manifest.json` fetches OK, 0 page errors | `.ui-proof/after-smoke-1440x900.png`, `.ui-proof/after-smoke-390x844.png`, baseline `.ui-proof/before-1440x900.png` (07:12Z, previous deployment) |
| 15 | Console / network failures | 0 console errors on all runs; only `/api/setup/status` 404 (pre-existing, unrelated probe) | `qa-fanout-sse.json → consoleErrors/networkFailures` |

## 8. Test totals

| Suite | Before (ca98807, 06:19Z) | After (10:42–10:44Z) | Added |
|---|---|---|---|
| Frontend `npm test` | 4,762 tests · 4,761 pass · 1 skipped | **4,790 · 4,789 pass · 0 fail · 1 skipped** | +28 (streamClient 5, streamView 4, sceneStreamLayer 1, client +2, streamFallback 3, iconManifest 3, sceneSpec/scenePanel/stagingLayer/footage controls extensions) |
| Backend `node --test server/**` | 712 pass | **739 pass · 0 fail** | +27 (fanout 7, legacy multi-query transport 3, snapchat +4 incl. fan-out merge/strict-never-fans-out, stream 6, scene-plans stream order 1, specModel sparse top-up 1, engine/geometry extensions) |
| `check:boundaries`, `check:secrets`, `check:secrets:dist`, `format --check` (touched files) | pass | pass | — |
| Production build `vite build` | ok | ok (7.9 s) — note: the restored workspace had an empty `node_modules/.bin`; `PUPPETEER_SKIP_DOWNLOAD=1 npm ci --include=dev` (the repo's own installCommand) was re-run first | — |

All unit tests use injected transports/fixtures. Live-provider evidence is the puppeteer run (`after2/`), the curl SSE captures, and the fan-out probe (`phase-a/`).

## 9. Files changed (ca98807 → 8c6f3a7; 103 files, +8,838 / −428)

**New:** `server/scene-footage/fanout.js` (+test), `server/scene-footage/legacy multi-query transport.js` (+test), `server/scene-plans/stream.js` (+test), `src/incidents/ui/streamClient.js`, `streamView.js`, `sceneStreamLayer.js` (+tests), `src/incidents/streamFallback.test.mjs`, `src/scenes/iconManifest.test.mjs`, `src/ui/styles/composer-stream.css`, `tools/scene-icons/build-icons.mjs` + `sources/*.png` (9 supplied icons), `public/scene-icons/manifest.json`, new PNG/SVG/sprite assets, `scripts/qa-snapchat-fanout.mjs`, `scripts/qa-fanout-sse.mjs`.
**Modified:** `server/scene-footage/{snapchat,routes}.js`, `server/scene-plans/{index,specModel,engine,geometry}.js`, `src/incidents/{client}.js`, `src/incidents/ui/{composer,index,sceneFootageControls,scenePanel,sceneStagingLayer}.js`, `src/sceneFootage/{controller,panel,places}.js`, `src/scenes/{sceneSpec,sceneStaging}.js`, `src/ui/styles/{composer-evidence,scene-footage,scene-studio}.css`, `api/[...route].js`, `scripts/package-boundaries.json`, `SCENE_ARCHITECTURE.md`, `docs/SNAPCHAT_PLUGIN.md`, and their tests.
Pre-existing work on the branch is untouched (a repo-wide `format --write` was reverted for every file outside this change set; `style.css` stays the ≤ 42-line import shim).

## 10. Unverified / blocked (honest)

* **Verified tier stays 0** — Snapchat Spotlight text matches carry no capture time or coordinates; only another source could promote a clip. Short-name variants collide with unrelated content (Harry Kane clips for "kane's"); they are labelled unverified candidates, never facts.
* **legacy multi-query transport (removed 2026-11-02) unavailable** — `the removed legacy multi-query transport → 405 "currently unavailable", not in the live docs; concurrent direct sessions are the fallback.
* **Cerebras direct tier inactive** — `CEREBRAS_API_KEY` not configured in this environment or on the Vercel project; the chain used OnDemand `predefined-cerebras-qwen-3.8-27b` → `gpt-6.1-sol` → template. No "GPT 6.1 ultra-fast" endpoint exists (verified last turn, HTTP 400).
* **Narration tokens are synthetic** (see §6); ElevenLabs narration remains billing-blocked from earlier turns and was not re-tested.
* **SSE resume is per warm serverless instance**; a cold instance answers `resume_unavailable` and the client re-submits over JSON.
* **Graphs MCP** (`render_chart`) returned `HTTP 404 Not Found` from the viz pod twice; the live chart could not be rendered — the charts are embedded in the PDF instead.
* `SNAPCHAT_RESULT_LIMIT=3` remains in the deployed `.env` (pre-existing); the code default is now 25 but the deployment keeps the owner's value.
* Template fallback was observed once live (exact-case Kane's prompt, both OnDemand tiers > 7.5 s); the fallback banner "Built with scenario template (no model) · fallback" is shown rather than hidden.
* Storage is **browser-local only** (`localStorage` key `gev.geographic-scenes.v1`), disclosed in the UI.

## 11. Timeline (UTC)

07:01 workspace verified (`ca98807`, clean) · 07:07 live OnDemand docs + batch probes · 07:09 Snapchat baseline probe · 07:12 baseline screenshot (previous deployment) · 07:13–09:32 Agents 1–3 (Agent 3 cancelled at 133 min, wiring finished by hand) · 09:36–09:41 first suites · 09:48 local SSE smoke · 09:52 env reconciliation · 09:55 build · 09:57 deploy #1 · 10:02–10:27 QA #1 (5/6) · 10:30–10:44 fixes (sparse spec top-up, fan-out in route, non-enumerable telemetry, timer leak, CSS import shim, note wording) + suites + build · 10:46 deploy #2 · 10:46–11:09 QA #2 + Kane's rerun · 10:53 ui-validator smoke · 11:12 commit `8c6f3a7` pushed · 11:12 PR → 422 already exists.

## 12. Evidence commit

The `docs/evidence-2026-11-01-fanout-sse/` directory (reports, JSON, timestamped screenshots, this file, `QA_REPORT.pdf`, `test-matrix.json`) is commit `b57de0a`, pushed to origin at 11:27Z.
