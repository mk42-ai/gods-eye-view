# CHECKPOINTS — tagged recovery points on `integration/ondemand-native`

| tag | base commit | created (UTC) | purpose |
|---|---|---|---|
| `recovery/pre-ondemand-rebuild-20261020` | `1c9558c` | 2026-10-20T21:26:36Z | pre-rebuild protection point (never move) |
| `checkpoint-2026-10-21-preview-retry` | cycle-6 checkpoint commit (on top of the cycle-6 fix/feat/test commits; deploy source of the retry sandbox was `712a552`) | 2026-10-21T10:3xZ (see `git tag -n`) | preview retry: fresh sandbox `sb-4asza5droe1u` health-gated, A–G 14/14 pre- and post-fix, 4 defects fixed (B-21…B-24) with before/after evidence, 4,688 units |
| `checkpoint-2026-10-21-post-sandbox-verification` | `712a552` (cycle-5 checkpoint commit on top of `7b669a3` artefacts + `eb4ec15` legacy cleanup) | 2026-10-21T09:0xZ (see `git tag -n`) | post-verification baseline: 14/14 A–G on the live sandbox with PNG proof, parity/plugin/branding/asset checks green, 4,674/4,675 units — taken BEFORE any further Signal Engine chat-UI change |
| `checkpoint-2026-10-21-verify-cycle4` | `226217f` (cycle-3 checkpoint docs) | 2026-10-21T04:12:28Z | cycle-4 baseline before the five-agent verification swarm and the sandbox resume |
| `checkpoint-2026-10-21-pre-integration-audit` | `f89d3ca` (cycle-2 checkpoint) + this file | 2026-10-21T01:22:13Z | cycle-3 baseline before the integration audit, voice re-routing and UI upgrades |

Rules: tags are never moved or deleted; a checkpoint tag is created BEFORE any chat-UI change of a cycle and its SHA is recorded in MASTER_STATE §1.

GENERATED_UTC: 2026-10-22T06:35:00Z
| `checkpoint-2026-10-22-cycle8-preview` | cycle-8 docs commit (on top of `6b49fe9` + the embeddability unit) | 2026-10-22T06:35Z | emergency preview redeploy: fresh sandbox `sbx_EdkizkMGv6ASKOnpEmUWOAlaQrRc` → `sb-1ek30lyxzsd3.vercel.run`, health 200 `configured:true` `keySource:server`, embeddings proven by iframe render at both viewports (TEST_RESULTS §13) |
| `checkpoint-2026-10-23-scene-video` (local; push blocked B-25) | cycle-10 docs commit on `feat/scene-video-evidence` (baseline `f20fab6` = approved deployment source) | 2026-10-23T04:3xZ | scene video evidence: SSE orchestrator + rail, 10/10 headless proof on `sb-5c67af3inbu0.vercel.run` |


## Cycle 13 — AOI query submission repair — 2026-10-24T01:38:42.714629+00:00

Continued `feat/scene-video-evidence` from `ffe6d3505f734335df4d6bfca77094df0b65d4d7` in place. Prior preview returned HTTP 410. Original keyboard/click baseline at both viewports reproduced the cause: questions were ingested as unverified operator incidents instead of being searched; the form controls and original OnDemand coordinate extraction themselves worked.

Implemented shared intent/place extraction, registered-geocoder-first lookup and same-origin `/api/ondemand/v2/incidents/search` through existing research contracts. Queries now expose scope, dated sources and distinct partial/unavailable states; they are not ingested. Publication time remains distinct from incident time. Video queries receive the resolved anchor; existing freshness rules unchanged.

Current preview: https://sb-2nei6kyp3xva.vercel.run (`sbx_gvBKmP4qburZYYp7g3EAD8wBWtxw`, port 5173). Final health/root at 01:28:34Z: HTTP 200, configured true/server key, expected title, no framing headers. Runtime-only OnDemand secret transported and removed; no key in source/dist/evidence.

Final source tests: 4,308 pass / 0 fail / 1 skip of 4,309; two additional Node-24 allocation files not run under Node 22. Server suites: 434 pass / 0 fail. Focused sandbox AOI regressions: 60 pass / 0 fail. Build and source/dist secret gates pass. Full sandbox suite did not produce a final summary within the tool cap; not counted as passed.

Final browser matrix 2026-10-24T01:28:34.721Z–2026-10-24T01:34:38.750Z: 94/96 assertions, 6/8 UI cases pass. All 8 submit, locate Burj Khalifa (25.19703,55.27413), search a 5 km / 72 h scope and show an honest unavailable state. TWO MOBILE FAILURES REMAIN: natural query + button, bare place + Enter; `od-plugin__row` overlaps the input/button for long diagnostic results despite measured-height spacing. Three post-change matrices performed; no fourth repair loop. All final live research coverage blocked (409, 499 or provider-reported unavailable), so no no-incident claim is warranted.

Video smoke: mobile muted MP4 readyState 4 advances 4.577753→5.153424 s; desktop sampled an ended clip and advancing playback is unproven. Observed label checks pass. TikTok primary scraper quota-blocked; fallback observed; YouTube still searching at smoke snapshots. ui_validate.py before/after exited 2 with TimeoutError; real Chromium/Puppeteer proof used.

Detailed deliverables at workspace root: `aoi-query-repair-test-report.md`, `aoi-query-repair-sanitized-evidence.json`, selected `aoi-*.png` proof. No remote push/PR/tag claimed. The next fix should investigate plugin-dock descendant overflow/min-size; do not treat this checkpoint as fully passing.


## Cycle 14 — Dubai Marina scene / clean sidebar — 2026-10-24T02:01:41.592632+00:00

Continued the existing `feat/scene-video-evidence` working tree at `ffe6d3505f734335df4d6bfca77094df0b65d4d7`, preserving all 17 pre-existing modified/untracked source paths in an external pre-edit tar/patch. No rollback or scaffold. Original preview remained live and is being updated in place.

### Geographic scene and gate contract
- `config/aoi/scene-aois.json` is the editable **scene allowlist**, separate from the historical broad external-interest catalog. AOIs carry id/name/group/kind, circle center + radius or bbox, source/license/observed timestamp. UAE, Iran and Oman OSM masks enforce geography; only explicit UAE border planning zones may cross into Oman. The generous fallback bbox `[51.3,22.5,56.65,26.25]` is intersected with UAE geography, never treated as an unrestricted rectangle. These are planning boundaries, not legal boundaries.
- Pure `resolveIncidentGate(text, coords)` fails closed for invalid coordinates or external geography and returns allowed/aoiId/reason/code. Iran, Yemen and Somalia are external context; there is no playable override in the composer. Existing foreign historical scenes are retained in storage/diagnostics, not played.
- Live original `/locate` returned generic Dubai for Dubai Marina. Independent OSM/Nominatim validation resolved **25.0786415, 55.1352524**, relation **11912728**, observed 2026-10-24T01:49:10.669805Z. Generic city substrings no longer suppress more specific geocoding. Registered `geocode_place` remains server-mediated; a verified OSM cache is explicitly labelled if live geocoding is unavailable.
- `GeographicScene` is a versioned JSDoc model with stable id, geographic flag, anchor, AOI, four keyframes/steps, authored timing, separate location confidence/provenance, and no incident evidence claims. The four views are Basin overview, Marina Walk waterfront, Inlet/JBR waterfront, Orbit closure; intermediate points are illustrative camera views, not independently verified POIs.
- Browser storage helper validates and read-back checks named geographic scene saves. The existing SceneDirector performs playback and stores compatible shots. Refreshing optional incident feeds must not remove geographic plans. Reopening saved scenes uses the cached id without a new geocode.

### Prompt, UI and data integrity
Native form Enter and visible submit share one path; generation/AbortController guards prevent stale results. Cancel/Retry are explicit. Geographic-only requests do not ingest fabricated incidents and do not auto-query footage. Scenes/Layers use distinct tabs; secondary authoring and verbose OUT_OF_AOI diagnostics are collapsed. Mobile drawer, plugin descendant clipping, safe-area composer and bounded playback are implemented; browser verification is recorded separately below, not assumed from CSS. AIS is not labelled live merely because a toggle is enabled.

### Live API documentation
Fetched authenticated categories, `createchatsession` and `submitquery` OpenAPI docs (HTTP 200) on this run. Documented session body requires externalUserId and supports pluginIds; query requires query/endpointId/responseMode (sync/stream/webhook) and supports pluginIds/modelConfigs. No undocumented claim about 409 semantics was made. Local deadline/cancellation is distinguished from real upstream HTTP errors; refresh no longer treats normal IncomingMessage close as cancellation.

### Baseline evidence and provider observations
ui-validator first failed with `TimeoutError: timed out`; a minimal CDP socket deadline fix in a temporary helper produced actual `before-1440x900.png` and `before-375x739.png`. Existing scene save selector was absent. Agent15 made one real video request (01:52:21.074–01:54:37.301 UTC): HTTP 200 SSE with explicit done; 10 ARCHIVAL clips (5 YouTube, 3 TikTok, 2 Instagram); TikTok quota/captions configuration failures and two real Perplexity 409s remained visible. Video playback is not claimed until final browser evidence.

20 actual specialist runs were launched in dependency-aware waves (tool cap: 5 simultaneous). Roles, tool task ids, UTC timestamps, owned files, outcomes, integration changes and incomplete capped reviews are included in the final evidence manifest. No credentials are included.


### Cycle 14 final browser/recording evidence — 2026-10-24T02:32:08.800483+00:00

Final live build reference: **marina-20261024-d6b3cceb0593**, same sandbox/URL as baseline. The save-confirmation reentrancy bug and the mobile sticky-header hit-test obstruction discovered during actual UI testing were fixed, not dismissed. Test-harness-only issues (combined Puppeteer Control+A, textContent paragraph-boundary assertion and Chrome viewport-triggered reload) were corrected separately.

- Latest selected real-browser lanes: **50/50 assertions pass**: desktop8, mobile18, equivalent iframe18, cancellation/retry/external4, existing video2. No page errors in selected suites. Real 375×739 touch input, safe hit targets, drawer tabs, playback containment, save/reload and control-driven camera change passed.
- Host chat was inaccessible; the iframe test is the existing same-origin `embed-harness.html`, not proof of the host chat itself.
- Continuous final recording: **16/16 checks pass**, started before typing at2026-10-24T02:29:30.862Z; actual typing began02:29:32.467Z; recording ended02:30:33.190Z. Source viewport375×739; H264 MP4 padded1px right/bottom to376×740,20fps,61.2s,9,716,594bytes. Full local AND published-URL decode passed. No fabricated frames, mocked network or internal-state injection.
- Exact entered request: `Create a waterfront orbit scene around Dubai Marina`. The scene was named/saved `Dubai Marina — Waterfront Orbit` using visible controls. Browser-local persistence survived a real reload and native selection. This is not a multi-user cloud library.
- Live incident query retried through actual services: partial coverage, one factual HTTP409 and a second no-results source. No no-incident conclusion was emitted. Video regression latest9clips, allARCHIVAL (YouTube5/TikTok3/Instagram1). An actual proxied Instagram MP4 played muted at readyState4, currentTime22.357901→22.759926. Counts differ from the earlier10clip API probe; no fixed13–14 count assumed.
- Latest source suite **4435total/4434pass/0fail/1skip**; server451/451pass. Combined4886total/4885pass/0fail/1skip. Two additional Node24 allocation files not run underNode22.
- Source/dist secret gates pass after documentation:1768/2037textfiles scanned. Every published evidence file returnedHTTP200 and matched its local SHA256; videoContent-Type video/mp4.
- Published video: https://sb-2nei6kyp3xva.vercel.run/proof/dubai-marina-waterfront-orbit.mp4
- Published manifest: https://sb-2nei6kyp3xva.vercel.run/proof/dubai-marina-evidence.json

20 actual specialist tasks ran under a five-concurrent-task cap. Eighteen wrote reports; two action-capped read-only tasks did not. Missing start/end timestamps are recorded as null rather than invented. Per-agent task IDs, ownership, partial outcomes and coordinator integration are in the manifest. Existing uncommitted work was preserved; no branch reset, remote push or production deployment was performed.


## Cycle 15 — Exact AOI BUILD SCENE repair — 2026-10-24T02:59:34.798087+00:00

Preserved the existing `feat/scene-video-evidence` tree at `ffe6d3505f734335df4d6bfca77094df0b65d4d7`; 71 pre-existing changed/untracked files were hash-manifested and checkpointed before editing. No recovery archive, reset, scaffold or architecture migration. Twenty actual read-only specialist tasks ran; the integration owner alone edited.

Fresh direct-preview baseline: original URL returned HTTP 410. Unchanged source was rebuilt in `sbx_bx0AMF9m7fhl1rahb8TIlEtxtfw2` at `https://sb-2b4qpbcnpg5o.vercel.run`. Native `Dubai Marina` typing and click/touch/Enter reached `/locate` at both 1440x900 and 375x739, with verified geocode 25.0786415,55.1352524. The form wrongly inherited the general parser `incident_search` default, then called unavailable research instead of building any scene. Explicit geographic generation during running Abu Dhabi playback produced a Marina label/anchor but left the camera over Abu Dhabi; LOAD was rejected while playback owned the camera. The original embedded host was not accessible; no host focus/pointer claim is made.

Minimal repair: parser accepts a caller-specific default, and this BUILD SCENE form uses `build_scene` while preserving explicit incident searches and general parser behavior. Pending requests accept replacement AOIs, coalesce duplicates, bound all asynchronous stages, reject stale responses and restore retry controls on timeouts. Invalid JSON becomes an actionable request error. Scene activation stops and awaits prior playback ownership before applying the new AOI. No new provider calls or credentials in client code.

Focused regression result so far: 73 passed / 0 failed. Final full-suite, build, source/dist secret-gate and deployed-browser results are appended below only after those runs. Evidence log: `aoi-rebuild-evidence.json` in this turn. Browser screenshots and traces carry `aoi-before-*` / `aoi-after-*` labels; recordings are direct compositor streams, not image slideshows.

Cycle 15 target-framing refinement: the real browser exposed that the original geographic adapter put an oblique camera directly above its ground target, leaving the anchor offscreen. `src/scenes/incidentScenes.js` now applies a spherical backward camera offset only for geographic scenes; original target/keyframes, scene IDs, stored scene schema and ordinary incident camera semantics stay intact. The direct-preview DOM/scene assertion now also requires the real rendered ground center, a ready imagery tile covering the target, six real Cesium overlay entities and a visible anchor.

### Cycle 15 final direct-preview verification — 2026-10-24T03:12:18.451926+00:00

- Core native browser suite: **20/20 passed**, 2026-10-24T03:05:56.933Z to 2026-10-24T03:08:42.955Z, at **1440×900 and 375×739**. Each viewport typed exact `Dubai Marina`, submitted by Enter and real BUILD SCENE click/touch, built Abu Dhabi between Marina builds, rebuilt during active playback, injected a separately labelled HTTP503, and recovered through a real `/locate` request. No successful response was mocked and no input value was set through JavaScript.
- Additional clear-map suite: **20/20 passed**, 2026-10-24T03:09:39.266Z to 2026-10-24T03:12:01.386Z. Side panels were collapsed through their own native controls. The actual anchor foreground hit-test was CANVAS at both viewports, and ready rendered imagery tiles covered the real geocode. Final Marina ground centers were approximately 17.7m from 25.0786415,55.1352524. This is ground geometry and actual raster imagery, not just a toast or label.
- Continuous compositor recordings: core 48.6s and clear-map 52.4s, source viewport375×739, encoded376×740 (one-pixel padding for H264). Both full-stream ffmpeg decodes passed. PNGs and Chrome traces are under workspace `.ui-proof/`; all download links, UTC events, source hashes, and twenty actual read-only task IDs are in `aoi-rebuild-evidence.json`.
- Original URL returned410; unchanged source was restored before edits. Native typing itself worked, but BUILD SCENE routed bare locations to research and active playback could retain the old camera. The stock ui-validator final attempt returned `TimeoutError: timed out` after HTTP200 and provided no final screenshots; it is not counted as passing. The independent real Chromium suites provide the proof. Actual embedded-host focus/iframe/pointer behavior and on-device virtual keyboards remain untested.
- Current preview: https://sb-2b4qpbcnpg5o.vercel.run; sandbox sbx_bx0AMF9m7fhl1rahb8TIlEtxtfw2; port5173; buildReference `aoi-rebuild-20261024-2ad171fc8c42`. Health was200 with configured:true/keySource:server. Server temporary key file was removed before start; no credentials are in deliverables.

## Cycle 16 — Embedded chat-canvas AOI repair — 2026-10-24T05:47:49Z
- Pre-change checkpoint: `659119c` (chore(checkpoint): preserve uncommitted work before embedded-host AOI fix).
- Changed: src/incidents/{query.js,ui/composer.js,ui/index.js,client.js}, server/incidents/routes.js, config/aoi/uae-interest.json, src/voice/ondemand/{pipeline.js,ui.js}, src/ui/styles/incidents.css; tests in query/composer/routes; new public/embed-canvas-harness.html and scripts/qa-embed-aoi.mjs.
- Evidence: TEST_RESULTS.md "Cycle 16"; screenshots before-embed-*/after-embed-*/before-uiv-*/after-uiv-* (1440×900, 375×739); continuous recording embedded-aoi-build-scene-recording.mp4.


## Cycle 18 — Strict recording evidence and visible AOI repair — 2026-10-24T10:20:56.699Z

**This section supersedes Cycle 17's live-footage interpretation.** Prior counts and playback demonstrations are historical, not evidence from this run.

- Continuity: existing `mk42-ai/gods-eye-view`, branch `feat/scene-video-evidence`, base `f3093e81a927ed39c32e5788438505aff0cdb5d9` (remote branch checked live). Working tree started clean. Prior previews `sb-7gcltu6u15nc`, `sb-2b4qpbcnpg5o`, `sb-2nei6kyp3xva`, and `sb-2n7tqzp6l1g2` all returned HTTP 410. Existing app, map, timeline, scene library, plugin architecture, deployment server and historical docs retained.
- Visible AOI: Enter/click/touch continue through the existing composer. Greetings return local guidance without network. The production BUILD action also constructs a geographic scene for research wording (e.g. Burj Khalifa incident question), without inventing an incident. Explicit UTC recording-window selector defaults to one hour; 24-hour and historical inputs are separate from the camera plan. Edits, rebuilds, time changes and cancellation invalidate previous generations.
- Evidence contract: `src/sceneEvidence/qualification.js` admits a video only with an authenticated provider-record contract, explicit recording-location geometry/basis, explicit recording-time source/precision, exact selected UTC interval, contained AOI geometry and authorized official embed. `publishedAt`, `recordedAt`, `retrievedAt` are distinct. Unknown remains unknown. Haversine is used for points; area-to-AOI tests use polygon edges and maximum vertex distance, never a place centroid. Broad/uncertain overlap is rejected. No LIVE label is inferred from a publication timestamp.
- OnDemand integration: server configuration now accepts runtime `ON_DEMAND_API_KEY` as an alias of canonical `ONDEMAND_API_KEY`. Six mediated discovery/provider attempts run concurrently (Instagram prioritized in the list, TikTok, YouTube, X); each has an 18-second deadline, overall deadline 24 seconds. Child aborts close source acceptance; late callbacks cannot emit. Session creation also receives the abort signal. Transport events carry request/generation identity, plugin ID, operation, UTC timestamp, endpoint, HTTP code and duration only. Public API docs were fetched live: `pluginIds`, `apikey` header, session id, `answer/status` response. The documented response does NOT expose raw social-source execution records. Therefore its answer text is unverified discovery only, NOT authenticated social metadata.
- Truthful UI: `items` means eligible verified footage; `candidates` means excluded discovery leads. Only eligible items can have Play or map pins. Candidates are in a separately labelled disclosure with reasons; authors are shown only from source metadata. No verified footage was found in this run. All actual playback-time values are unavailable, not zero/success. Camera motion was tested separately and is not video playback.
- Security: removed the legacy social downloader/fixture request graph; `/scene/videos` and `/scene/media` return explicit HTTP 410 with no outgoing request, for all URL/redirect/Range inputs. Official embeds only. No arbitrary returned embed HTML. Player messages require exact origin and the selected iframe's source window. Historical incident seeds are now explicit test injection only; model research answers cannot be promoted/geocoded into the live incident ledger. Added credential-name coverage and non-value-printing secret errors. Framing permits self and OnDemand HTTPS parents, limits child frames to supported official players, with no X-Frame-Options and no `frame-ancestors 'none'`.
- Gates (current): unit suite **4,517 pass / 0 fail / 1 skipped**; two Node-24-only allocation benchmark files additionally skipped on Node 22 (explicit runner warning). Server regression suites **462 pass / 0 fail / 0 skipped**. Targeted post-repair regression **162 pass / 0 fail**, overlapping the full suites. Production build passed locally and in sandbox; source/dist secret gates and module/brand boundary gates passed. Existing large-bundle and Node-engine warnings remain, not build errors.
- Final live browser run **92 pass / 0 fail**, 2026-10-24T10:14:08.721Z → 2026-10-24T10:20:56.699Z, using the existing Puppeteer/Chromium tooling at 1440×900 and 375×739. Every primary build used trusted visible input/Enter or click/touch. Covered greeting, Dubai Marina, same-AOI rebuild, 24-hour control, exact Burj research text, Abu Dhabi, in-flight replacement, external Iran marker, isolated microphone failure and no idle social requests. Eight measured submit-to-first-feedback values were 28.5–51.5 ms. Camera scene motion verified separately. Raw provider HTTP beneath OnDemand, real footage playback, real author popup, real device keyboards and the actual authenticated OnDemand host were NOT verified.
- Built-in `ui_validate.py` was explicitly run twice (normal and viewport-only); both returned exit 2, `TimeoutError: timed out`, after HTTP 200, no screenshots. They are not counted as passes. Initial custom harness had 78 passes and two mis-targeted voice-selector checks; a corrected focused pass was 12/0, then the final full pass was 92/0.
- Public host `https://app.on-demand.io/` returned HTTP 200 but no authenticated host session was supplied. No mirrored harness is represented as a real-host test in this cycle.
- Preview: **https://sb-2q4q1hsrtxg0.vercel.run**, sandbox `sbx_60sLmxqxzlcvmWWSqkEMxHEHpqSS`, port 5173, buildReference `strict-evidence-20261024`. Health and root returned 200, app title `OnDemand Intelligence Workstation`, `configured:true`, `keySource:server`. A transient OnDemand credential file was deleted before server startup; no value is in source, dist, reports, or committed `.env`. Restart/Share needs the platform to reinject the runtime credential; absent it the app runs with truthful unavailable source states.
- Deliverables in workspace root: `gods-eye-view-repair-verification.md`, `gods-eye-view-verification-evidence.json`, `gods-eye-view-repair-demo.mp4` (48-second continuous, real-browser excerpt, not staged playback); full modified source is the platform-generated ZIP. Screenshots: current `strict-*` PNGs at both viewports under `.ui-proof/`. Authoritative per-provider/AOI/window counts and HTTP transport records are in the JSON evidence.


### Cycle 18 final publication addendum — 2026-10-24T10:22:02Z

- Code committed and pushed: `dfa77399534968af545fcf7a0e095a5817d40a21` on `feat/scene-video-evidence`. Existing PR #4 is retained; the PR helper returned HTTP 422 “A pull request already exists for mk42-ai:feat/scene-video-evidence.” No duplicate PR was created; its branch diff was updated by the successful push.
- Runtime identity updated to `buildReference:dfa7739`. Current health/root verification at `2026-10-24T10:22:02.569432+00:00`: HTTP 200, configured true, server key source, correct application title, no X-Frame-Options, restrictive non-none frame-ancestors. Subsequent post-commit browser smoke: 8 passed / 0 failed at 1440×900 and 375×739.
- Final full live browser run: 92/0, `2026-10-24T10:14:08.721Z` → `2026-10-24T10:20:56.699Z`. Its twelve completed AOI/window observations returned 247 unverified candidate occurrences (69 distinct post IDs): Instagram 27, TikTok 70, YouTube 60, X 90. These are mediated-answer URL leads, NOT verified source footage. Eligible videos 0; playback-verified videos 0. Source transport: 72 session-create HTTP 201 responses, 65 query HTTP 200 responses. Ultimate provider HTTP/raw metadata is unavailable from the documented response; no assertion of underlying provider success is made.
- Genuine final browser recording `gods-eye-view-repair-demo.mp4`: 48.000s, 1440×900 H.264, continuous excerpt, full ffmpeg decode passed. No archival clip or fabricated successful video playback.

## Cycle 19 — Snapchat scene footage — 2026-10-27
- `77b8066` checkpoint (empty, clean tree) before changes; feature commit follows on `feat/scene-video-evidence` (PR #4). Baseline `baseline/approved-k8v6snzk7` @ `f20fab6` untouched.
- Route `POST /api/scenes/:locationId/footage/snapchat` → OnDemand session + query with `pluginIds:["plugin-1792945050"]` (`fetchSnapchatVideosByPlace`). See MASTER_STATE / TEST_RESULTS "Cycle 19" and `docs/SNAPCHAT_PLUGIN.md`.
- Preview https://sb-5nqbbabiczlf.vercel.run (`sbx_YKsxkm8145nAnFcN6LKwlb7TK6so`).

### Cycle 20 (2026-10-27)
- `9f00c28` checkpoint (empty, clean tree) → `de82db2` permanent server-side key (env:persistent, transient key-file path removed) → fix commit for media retry / near-dup dedupe / plugin-text-match + 3-location QA (see MASTER_STATE "Cycle 20"). Baseline `baseline/approved-k8v6snzk7` @ `f20fab6` untouched.
- Preview https://sb-5kdyj18ew55x.vercel.run (`sbx_3IkaIWI9k9vOQfGJWtt74Yny6My8`).

## Checkpoint — cycle 21 pre-UI-cleanup (2026-10-30)
- Clean tree at `b0c8a4d` on `feat/scene-video-evidence` (PR #4) before the UI/UX cleanup (single accent, decluttered first screen, Driver.js walkthrough, Lucide icon dock).
