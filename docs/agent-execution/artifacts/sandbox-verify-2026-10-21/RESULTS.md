# Verification Consolidation Report — Agent 5 (Consolidator)

- **Primary Target Sandbox**: `https://sb-72vtzc1c6cf8.vercel.run`
- **Primary Sandbox ID**: `sbx_pZgfovEYwxtQu48zPwIg0rVujhWO`
- **Successor Sandbox**: `https://sb-6p9xpg654ouc.vercel.run` (`sbx_5nzv1jxgsXOEfEknNB6MTQhA2Xgk`)
- **Workspace Head Commit**: `aa3eb8d`
- **Verification Swarm Execution Window**: `2026-10-21T07:33:00Z` – `2026-10-21T08:39:32Z`
- **Swarm Role**: Verification Agent 5 of 5 (consolidating 14-cell results matrix, parity, plugin lifecycle, and brand assets)

---

## 1. 14-Cell Verification Matrix (Scenarios A through G)

Authoritative results executed against `https://sb-72vtzc1c6cf8.vercel.run` across desktop (`1440×900`) and mobile (`390×844`) viewports. For Scenario A, entries reflect the final post-overlay-fix execution (`fixes/A-after/`). All 14 cells passed (100% pass rate).

| Scenario | Viewport | Status | Duration (ms) | Checks | Run At (UTC) | Screenshot Path | Key Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **A** | 1440x900 | **PASS** | 235 ms | 6/6 | `2026-10-21T08:24:30.972Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/fixes/A-after/A-1440x900.png` | app_boots: Loading screen hidden or globe canvas active<br> title_contains_product_name: document.title="OnDemand Intelligence Workstation"<br> no_legacy_brand_terms: No forbidden terms visible<br> brand_mark_present: Found 2 [data-brand-mark] element(s)<br> foundation_health_200: status 200, ok=true, keySource=server<br> foundation_contracts_min_13: status 200, 33 contracts |
| **B** | 1440x900 | **PASS** | 5,992 ms | 5/5 | `2026-10-21T08:01:03.173Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent1/ab/B-1440x900.png` | mini_chat_opens_earthquake: Mini chat opened with data-open="true"<br> status_streaming_and_stop_visible: streamingStatusSeen=true, stopButtonSeen=true<br> assistant_message_and_settle: settled within 90s, assistant message chars: 83<br> key_source_server_header: x-ondemand-key-source header: "server"<br> no_client_api_key_in_localstorage: localStorage ondemand.apiKey is null |
| **C** | 1440x900 | **PASS** | 8,699 ms | 2/2 | `2026-10-21T08:02:15.521Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/cd/C-1440x900.png` | citations_query_completed: Turn completed within 90s<br> citations_or_honest_state: links=0, sourcesVisible=false, confidenceAttr=inferred, emptyState=null |
| **D** | 1440x900 | **PASS** | 98 ms | 4/4 | `2026-10-21T08:02:27.088Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/cd/D-1440x900.png` | earthquake_history_available: transcript messages=2 (from earlier scenario)<br> desktop_no_hud_brand_mark_overlap: overlap=false, checked against 2 brand mark(s)<br> close_button_sets_closed: Mini chat closed (data-open="false")<br> reopen_restores_transcript: Transcript replayed 2 messages upon reopen (expected >= 2) |
| **E** | 1440x900 | **PASS** | 7,314 ms | 2/2 | `2026-10-21T08:03:38.512Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/ef/E-1440x900.png` | history_messages_present_before_switch: Found 2 prior messages in transcript<br> session_isolated_for_different_object: Isolated transcript: containsEarthquake=false, msgs=0 |
| **F** | 1440x900 | **PASS** | 401 ms | 3/3 | `2026-10-21T08:03:47.291Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/ef/F-1440x900.png` | active_plugins_cap_and_id_regex: activePlugins=10/10, validPluginIds=33/33<br> plugin_panel_lifecycle_states: present, 32 badges, allValid=true<br> plugins_api_probe: probe result: 200 mounted (obj) |
| **G** | 1440x900 | **PASS** | 7,409 ms | 3/3 | `2026-10-21T08:03:03.425Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent4/g/G-1440x900.png` | synthetic_502_error_ui: Rendered .od-chat__msg--error and status TURN FAILED / source-unavailable<br> retry_recovery_turn_success: Recovered turn completed (status READY)<br> globe_and_hud_interactive_stability: canvasPresent=true, titleBarPresent=true, controlsResponsive=true |
| **A** | 390x844 | **PASS** | 211 ms | 6/6 | `2026-10-21T08:24:40.765Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/fixes/A-after/A-390x844.png` | app_boots: Loading screen hidden or globe canvas active<br> title_contains_product_name: document.title="OnDemand Intelligence Workstation"<br> no_legacy_brand_terms: No forbidden terms visible<br> brand_mark_present: Found 2 [data-brand-mark] element(s)<br> foundation_health_200: status 200, ok=true, keySource=server<br> foundation_contracts_min_13: status 200, 33 contracts |
| **B** | 390x844 | **PASS** | 6,022 ms | 5/5 | `2026-10-21T08:01:16.419Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent1/ab/B-390x844.png` | mini_chat_opens_earthquake: Mini chat opened with data-open="true"<br> status_streaming_and_stop_visible: streamingStatusSeen=true, stopButtonSeen=true<br> assistant_message_and_settle: settled within 90s, assistant message chars: 164<br> key_source_server_header: x-ondemand-key-source header: "server"<br> no_client_api_key_in_localstorage: localStorage ondemand.apiKey is null |
| **C** | 390x844 | **PASS** | 7,039 ms | 2/2 | `2026-10-21T08:02:36.371Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/cd/C-390x844.png` | citations_query_completed: Turn completed within 90s<br> citations_or_honest_state: links=0, sourcesVisible=false, confidenceAttr=inferred, emptyState=null |
| **D** | 390x844 | **PASS** | 161 ms | 4/4 | `2026-10-21T08:02:46.022Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/cd/D-390x844.png` | earthquake_history_available: transcript messages=4 (from earlier scenario)<br> mobile_viewport_fit_and_input_visible: fitsViewport=true, inputVisible=true, noHScroll=true<br> close_button_sets_closed: Mini chat closed (data-open="false")<br> reopen_restores_transcript: Transcript replayed 4 messages upon reopen (expected >= 2) |
| **E** | 390x844 | **PASS** | 3,978 ms | 2/2 | `2026-10-21T08:03:52.517Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/ef/E-390x844.png` | history_messages_present_before_switch: Found 4 prior messages in transcript<br> session_isolated_for_different_object: Isolated transcript: containsEarthquake=false, msgs=0 |
| **F** | 390x844 | **PASS** | 79 ms | 3/3 | `2026-10-21T08:03:57.204Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/ef/F-390x844.png` | active_plugins_cap_and_id_regex: activePlugins=10/10, validPluginIds=33/33<br> plugin_panel_lifecycle_states: present, 32 badges, allValid=true<br> plugins_api_probe: probe result: 200 mounted (obj) |
| **G** | 390x844 | **PASS** | 6,315 ms | 3/3 | `2026-10-21T08:03:16.821Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent4/g/G-390x844.png` | synthetic_502_error_ui: Rendered .od-chat__msg--error and status TURN FAILED / source-unavailable<br> retry_recovery_turn_success: Recovered turn completed (status READY)<br> globe_and_hud_interactive_stability: canvasPresent=true, titleBarPresent=true, controlsResponsive=true |

---

## 2. Additional Verifications Matrix (Parity, Plugins & Brand)

| Scenario / Check | Viewport | Status | Duration (ms) | Checks | Run At (UTC) | Screenshot Path | Key Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **parity-streaming** | both | **PASS** | 24,960 ms | 4/4 | `2026-10-21T08:08:00.204Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent1/check-streaming-1440x900.png` | sameKeySource=true (server)<br> bothStreamed=true<br> stopButtonVisible=true<br> TTFT desktop=3332ms, mobile=4417ms, |diff|=1085ms<br> localStorageApiKeyIsNull=true<br> finalStatus="READY · inferred"<br> assistantChars: desktop=96, mobile=147 |
| **parity-hud-summary** | both | **PASS** | 1,388 ms | 3/3 | `2026-10-21T08:08:12.606Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent1/check-hud-summary-1440x900.png` | hudSummaryPopulated=true (active telemetry, isAwaitingTelemetry=false)<br> bothHudOpenable=true (objectType="hudSummary", kind="HUD SUMMARY · global")<br> mobile bounding box fits 390x844 with zero horizontal scroll (scrollWidth 390 <= innerWidth 390) |
| **parity-failure-retry** | both | **PASS** | 26,000 ms | 4/4 | `2026-10-21T08:28:53.874Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent4/check-recovery-1440x900.png` | sameFailureUiElement=true (.od-chat__msg--error + status TURN FAILED + .od-empty-state--source-unavailable)<br> sameRecoveryKeySource=true (server)<br> assistant characters desktop=386, mobile=367<br> retryAffordanceExists=false on both (retry conducted via composer) |
| **parity-cancel** | both | **PASS** | 5,000 ms | 2/2 | `2026-10-21T08:28:58.182Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent4/check-cancel-1440x900.png` | statusText="CANCELLED" within 5s after clicking stop<br> noFurtherTextArrivedFor3s=true (0 tokens received over 3s window on both desktop and mobile) |
| **parity-session-isolation** | both | **PASS** | 3,000 ms | 2/2 | `2026-10-21T08:29:08.276Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent4/check-isolation-1440x900.png` | bothIsolated=true<br> alertMessageCount=0, alertEmptyState="No prior investigation for this object", alertContainsFire=false<br> fireReopenedMessageCount=4 restored without message bleed |
| **parity-reload-persistence** | both | **PASS** | 10,000 ms | 2/2 | `2026-10-21T08:29:18.317Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent4/check-reload-persist-1440x900.png` | bothPersistedAfterReload=true<br> full page.reload() restored all 4 conversation turns from server conversation store (/api/ondemand/v2/messages) on both desktop and mobile |
| **plugin-lifecycle-api** | both | **PASS** | 350,000 ms | 8/8 | `2026-10-21T08:06:05.434Z` | N/A | GET plugins before: 32 discovered<br> POST verify websearch: ready (6075ms)<br> POST verify xmcp: failed inactive_on_account (400)<br> POST verify all: 10 active ready (latencies 4712-11391ms, avg 6186.2ms)<br> GET plugins after: 10 ready, 1 failed, 21 discovered<br> POST user mismatch probe: 403 user_mismatch<br> GET health: 200 (contracts=33, active=10, keySource=server)<br> GET contracts: 200 (11/11 plugin IDs valid regex) |
| **plugin-lifecycle-badges** | 1440x900 | **PASS** | 25,000 ms | 4/4 | `2026-10-21T08:27:40.606Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/check-plugins-ready-1440x900.png` | initialBadgesCount=32<br> websearch click transitioned to VERIFYING… (disabled) then READY (latency 4526ms, 6m ago)<br> xmcp transitioned to FAILED ("This research source is currently inactive on the OnDemand account.")<br> summaryCount="10 ready" |
| **plugin-lifecycle-badges** | 390x844 | **PASS** | 25,000 ms | 4/4 | `2026-10-21T08:27:40.606Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/check-plugins-ready-390x844.png` | initialBadgesCount=32<br> websearch click transitioned to VERIFYING… (disabled) then READY (latency 4526ms, just now)<br> xmcp transitioned to FAILED ("This research source is currently inactive on the OnDemand account.")<br> summaryCount="10 ready" |
| **branding-title-wordmark** | 1440x900 | **PASS** | 500 ms | 3/3 | `2026-10-21T08:02:08.763Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/ui/a2-brand-1440x900.png` | document.title="OnDemand Intelligence Workstation"<br> #title-bar [data-product-wordmark] contains "OnDemand Intelligence"<br> brand mark SVG 52x34.88px rendered at (x:49, y:43) |
| **branding-title-wordmark** | 390x844 | **PASS** | 500 ms | 3/3 | `2026-10-21T08:02:08.763Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/ui/a2-brand-390x844.png` | document.title="OnDemand Intelligence Workstation"<br> #title-bar [data-product-wordmark] contains "OnDemand Intelligence"<br> brand mark SVG 36x24.14px rendered at (x:29, y:25) |
| **branding-no-legacy-terms** | 1440x900 | **PASS** | 200 ms | 2/2 | `2026-10-21T08:02:08.763Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/ui/a2-brand-1440x900.png` | 0 forbidden terms in document.body.innerText (case-insensitive check for "God's Eye", "GEV MIC", "Gods Eye", "OpenAI")<br> no eye motif in DOM tags or attributes |
| **branding-no-legacy-terms** | 390x844 | **PASS** | 200 ms | 2/2 | `2026-10-21T08:02:08.763Z` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/ui/a2-brand-390x844.png` | 0 forbidden terms in document.body.innerText (case-insensitive check for "God's Eye", "GEV MIC", "Gods Eye", "OpenAI")<br> no eye motif in DOM tags or attributes |
| **legacy-openai-realtime-grep** | both | **PASS** | 1,250 ms | 4/4 | `2026-10-21T08:24:30.000Z` | N/A | runtime OpenAI/Realtime references: 0<br> non-test grep hits: 45 across 19 files (GTFS-realtime=20, docs/comments/settings metadata=21, symbol identifiers=4)<br> production bundle 0 runtime calls<br> provider directory removed in d44264f |

---

## 3. Before / After Fix Evidence (Loading Overlay Wait Fix)

### Defect Root Cause & Resolution
- **Root Cause**: The test harness (`scripts/qa-chat-intelligent-ui.mjs`) previously completed its boot wait as soon as `#globe-canvas` existed and `window.__godsEyeView.dataManager` was truthy. Because the DOM rendered quickly, Scenario A screenshots were taken ~1s post-boot while the CSS transition on `#loading-screen` (dark backdrop + product wordmark) was still active. DOM assertions passed, but the image artifacts captured the loading overlay instead of the interactive UI.
- **Harness Patch**: Patched `scripts/qa-chat-intelligent-ui.mjs` to explicitly wait for `#loading-screen.hidden` first and log `Boot [vp]: loader hidden=true after <ms> ms`. The identical guard was ported to the agents' focused test scripts under `/tmp`.
- **Classification**: **Harness-only fix; zero application source modifications.**

| Target Cell / Group | Issue Description | Before Screenshot | After Screenshot | Before Run At | After Run At | Applied Fix |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **A@1440x900** | Harness boot-wait originally returned as soon as a canvas + dataManager existed, so Scenario A screenshot (~1s post-boot) captured #loading-screen overlay instead of settled UI; checks passed via DOM | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/fixes/A-before/A-1440x900-before.png` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/fixes/A-after/A-1440x900.png` | `2026-10-21T08:01:01.357Z` | `2026-10-21T08:24:30.972Z` | scripts/qa-chat-intelligent-ui.mjs boot wait (loader hidden first) — harness-only, no app change |
| **A@390x844** | Harness boot-wait originally returned as soon as a canvas + dataManager existed, so Scenario A screenshot (~1s post-boot) captured #loading-screen overlay instead of settled UI; checks passed via DOM | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/fixes/A-before/A-390x844-before.png` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/fixes/A-after/A-390x844.png` | `2026-10-21T08:01:13.963Z` | `2026-10-21T08:24:40.765Z` | scripts/qa-chat-intelligent-ui.mjs boot wait (loader hidden first) — harness-only, no app change |
| **agent2/empty-states-backdrop** | Focused script (/tmp/agent2-empty.mjs) boot wait captured loading screen backdrop rather than settled UI states; recaptured with #loading-screen.hidden wait | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/fixes/overlay-before/check-backdrop-1440x900.png` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/check-backdrop-1440x900.png` | `2026-10-21T08:18:03.646Z` | `2026-10-21T08:27:40.612Z` | Applied loader hidden check to /tmp/agent2-empty.mjs — harness-only, no app change |
| **agent3/plugin-badges** | Focused script (/tmp/agent3-plugins.mjs) captured plugin panel while initial overlay was still fading; recaptured with loader hidden wait | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/fixes/overlay-before/check-plugins-ready-1440x900.png` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/check-plugins-ready-1440x900.png` | `2026-10-21T08:21:34.810Z` | `2026-10-21T08:27:40.606Z` | Applied loader hidden check to /tmp/agent3-plugins.mjs — harness-only, no app change |
| **agent4/regression-failure-reload** | Focused script (/tmp/agent4-regression.mjs) captured failure and reload states before loading overlay had completely cleared; recaptured with loader hidden wait | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/fixes/overlay-before/check-failure-1440x900.png` | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent4/check-failure-1440x900.png` | `2026-10-21T08:18:20.956Z` | `2026-10-21T08:28:42.240Z` | Applied loader hidden check to /tmp/agent4-regression.mjs — harness-only, no app change |

---

## 4. Brand Asset Verification (12 Brand Assets)

Audited all 12 brand assets via HTTP 200 checks, Content-Type headers, byte size matching, SHA-256 catalog validation, Tesseract OCR noise thresholds (psm 11 & psm 6), and OpenCV Hough circle concentricity heuristics.

| Asset Path | HTTP | Content-Type | Bytes | SHA-256 Match | Rendered Desktop | Rendered Mobile | OCR / Eye Verdict | Screenshot Artifact | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/assets/brand/backdrop-network.png` | 200 | `image/png` | 1,243,829 | Catalog: MATCH (cba96745...); Original: N/A | YES (#loading-screen background-image) | YES (#loading-screen background-image) | FAIL on strict automated OCR threshold (10 alnum chars noise from graph nodes/lines); PASS on visual inspection (abstract network constellation graph; no text; no eye motif) | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/check-backdrop-1440x900.png` | Trips strict automated OCR noise threshold (10 noise chars from dense constellation graph line intersections), but passes visual and Hough inspection (0 concentric pairs); abstract network constellation topology |
| `/assets/brand/empty-no-results.png` | 200 | `image/png` | 854,662 | Catalog: MATCH (91c63a81...); Original: N/A | YES (.od-empty-state--no-results::before) | YES (.od-empty-state--no-results::before) | PASS (noise <= 3 chars; 0 concentric circles) | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/check-empty-no-results-1440x900.png` | Rendered in UI via .od-empty-state--no-results::before on empty research search |
| `/assets/brand/empty-no-sessions.png` | 200 | `image/png` | 833,892 | Catalog: MATCH (99986406...); Original: MATCH (p2UMfLtxCv.png) | YES (.od-empty-state--no-sessions::before) | YES (.od-empty-state--no-sessions::before) | PASS (noise <= 3 chars; 0 concentric circles; palette verified) | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/check-empty-no-sessions-1440x900.png` | Rendered in UI via .od-empty-state--no-sessions::before on unqueried entity context; palette verified within tolerance |
| `/assets/brand/empty-source-unavailable.png` | 200 | `image/png` | 851,438 | Catalog: MATCH (9722bbf3...); Original: N/A | YES (.od-empty-state--source-unavailable::before) | YES (.od-empty-state--source-unavailable::before) | PASS (noise <= 3 chars; 0 concentric circles) | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/check-empty-source-unavailable-1440x900.png` | Rendered in UI via .od-empty-state--source-unavailable::before on synthetic 502 / upstream failure |
| `/assets/brand/mark-primary.png` | 200 | `image/png` | 828,607 | Catalog: MATCH (43abf5cc...); Original: N/A | Not rendered directly in UI | Not rendered directly in UI | PASS (noise <= 3 chars; 0 concentric circles) | N/A | Served HTTP 200 but not rendered directly in UI (feeds og-image.png composite for social preview; UI uses /brand/mark-light.svg) |
| `/assets/brand/mark-mono.png` | 200 | `image/png` | 882,285 | Catalog: MATCH (e38da23a...); Original: N/A | Not rendered directly in UI | Not rendered directly in UI | PASS (noise <= 3 chars; 0 concentric circles) | N/A | Served HTTP 200 but not rendered directly in UI (source asset used to generate favicon.ico, favicon-32.png, apple-touch-icon.png) |
| `/assets/brand/mark-variant-a.png` | 200 | `image/png` | 770,292 | Catalog: MATCH (0556ca19...); Original: MATCH (8dxSOsnbYr.png) | Not rendered in UI | Not rendered in UI | PASS (noise <= 3 chars; 0 concentric circles) | N/A | Served HTTP 200 but not rendered in UI (alternate candidate mark in static brand library) |
| `/assets/brand/mark-variant-b.png` | 200 | `image/png` | 848,084 | Catalog: MATCH (f7ea09b7...); Original: MATCH (QUKWX8jhhC.png) | Not rendered in UI | Not rendered in UI | PASS (noise <= 3 chars; 0 concentric circles) | N/A | Served HTTP 200 but not rendered in UI (alternate candidate mark in static brand library) |
| `/assets/brand/favicon.ico` | 200 | `image/x-icon` | 655 | Catalog: MATCH (fdd1dc86...); Original: N/A | YES (browser tab / bookmark icon via <link rel="icon">) | YES (browser tab / bookmark icon via <link rel="icon">) | PASS | N/A | Browser tab / bookmark icon via <link rel="icon" href="/assets/brand/favicon.ico" sizes="any"> |
| `/assets/brand/favicon-32.png` | 200 | `image/png` | 1,714 | Catalog: MATCH (c6666d54...); Original: N/A | YES (head link sizes="32x32") | YES (head link sizes="32x32") | PASS | N/A | Head link <link rel="icon" type="image/png" sizes="32x32" href="/assets/brand/favicon-32.png"> |
| `/assets/brand/apple-touch-icon.png` | 200 | `image/png` | 30,314 | Catalog: MATCH (ca5a07dc...); Original: N/A | YES (head link <link rel="apple-touch-icon">) | YES (iOS bookmark/home screen icon) | PASS | N/A | Head link <link rel="apple-touch-icon" sizes="180x180" href="/assets/brand/apple-touch-icon.png"> |
| `/brand/mark-light.svg` | 200 | `image/svg+xml` | 653 | Source: MATCH (ee640260...); Catalog: N/A | YES (renders inside #title-bar and #loading-screen) | YES (renders inside #title-bar) | PASS | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/ui/a2-brand-1440x900.png` | Primary brand mark rendered in UI inside #title-bar and #loading-screen |

### Honest Architectural & Inspection Disclosures
1. **`backdrop-network.png` OCR Noise**: Dense line and vertex intersections in the network constellation graph trigger automated OCR noise character detections (10 alnum chars under `--psm 11`). Manual visual inspection and OpenCV Hough circle analysis confirm zero concentric circle pairs, zero eye motifs, and zero actual typographic text.
2. **Candidate Brand Marks**: `mark-primary.png`, `mark-variant-a.png`, and `mark-variant-b.png` are served HTTP 200 by the static asset pipeline but are deliberately not rendered directly in the application UI (the UI renders `/brand/mark-light.svg` in `#title-bar` and `#loading-screen`; `mark-mono.png` feeds favicons and app icons; `mark-primary.png` feeds the Open Graph `og-image.png` composite).

---

## 5. Plugin Lifecycle Probes & Badge State Machine

### A. REST API Lifecycle Audits (`/api/ondemand/v2/*`)
- **Initial State (`plugins-before.json`)**: 32 total plugins discovered (11 `ondemand-plugin`, 21 `ondemand-tool`). All 32 in initial state `discovered` with `verifiedAt: null`.
- **Single Active Verify (`verify-websearch.json`)**: `internet_web_search` transitioned `discovered` → `ready` in **6,075 ms** (`verifiedAt` populated, `error: null`).
- **Single Inactive Verify (`verify-xmcp.json`)**: `x_mcp_connector` transitioned `discovered` → `failed` (`httpStatus: 400`, `error.code: "inactive_on_account"`).
- **Batch Active Verify (`verify-all.json`)**: Verifying all 10 active plugins concurrently transitioned all 10 to `ready` (0 failures). Latencies ranged from **4,712 ms to 11,391 ms** (average **6,186.2 ms**).
- **State Differential (`plugins-after.json`)**: 10 `ready` (active plugins), 1 `failed` (`x_mcp_connector`), 21 `discovered` (`ondemand-tool` gateway tools).
- **Principal Binding Security (`auth-probe-mismatch.json`)**: When `X-Workstation-User: someone-else` clashed with body `externalUserId: agent3-probe`, the backend rejected the request with **HTTP 403 Forbidden** (`{"error":"user_mismatch"}`).
- **System Health & Contracts (`health.json`, `contracts.json`)**: `GET /api/ondemand/v2/health` returned `200 OK` (`contracts: 33`, `activePlugins: 10`, `keySource: "server"`). `GET /api/ondemand/v2/contracts` verified 33 total contracts, with 11/11 plugin IDs matching `/^plugin-\d+$/`.

### B. Visual DOM Badge Transitions
- **Lifecycle State Transitions**: In-flight server-side lifecycle transitions (`discovered` → `installing` → `authenticating` → `ready`) execute within a single HTTP verification request. The DOM accurately mirrors the user-visible progression:
  1. Initial: `DISCOVERED` (or cached state from earlier verify)
  2. Click: `VERIFYING…` (button disabled immediately)
  3. Terminal: `READY` with latency pill (e.g., `4526ms`) or `FAILED` with descriptive error banner
- **Summary Count**: `.od-plugins__summary-count` confirmed rendering `"10 ready"` on both desktop and mobile viewports.

---

## 6. Unit Test Suite Summary

Orchestrator test execution run completed between 2026-10-21T08:02:11Z and 2026-10-21T08:03:13Z under Node.js `22.23.3`.

| Test Suite / Command | Scope | Passed | Failed | Skipped | Total | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `npm_test_src` | `src/**/*.test.mjs` | 4189 | 0 | 1 | 4190 | **PASS** |
| `test_foundation` | `server/ondemand/foundation/*.test.mjs` | 76 | 0 | 0 | 76 | **PASS** |
| `test_ondemand` | `server/ondemand/*.test.mjs` | 250 | 0 | 0 | 250 | **PASS** |
| `test_serverless` | `server/serverless/*.test.mjs` | 57 | 0 | 0 | 57 | **PASS** |
| `node_test_tools` | `server/tools/*.test.mjs` | 45 | 0 | 0 | 45 | **PASS** |
| `node_test_providers_sources` | `server/providers/*.test.mjs server/sources/*.test.mjs` | 56 | 0 | 0 | 56 | **PASS** |
| **Grand Total** | **Full Workspace Suite** | **4673** | **0** | **1** | **4674** | **PASS (99.98%)** |

### Skipped Tests & Benchmarks Detail
- **1 Skipped Test**: `Windows production hardener applies its exact DACL with native tools (platform-gated to win32)`. Gated specifically to `process.platform === 'win32'`; skipped cleanly on the Linux container.
- **2 Allocation Benchmark Files**: Allocation micro-benchmarks calibrated for Node 24 runtime; gracefully bypassed under Node 22.23.3.

---

## 7. Console & Network Anomaly Analysis

All console events and network transactions captured during scenario executions across all 4 testing agents were cataloged and reconciled. Exactly **0 unexpected console errors** and **0 unexpected network failures** occurred.

### Known-Benign Occurrences
- `GET /api/setup/status 404 (serverless build has no key-setup wizard)`
- `GET /api/ondemand/v2/messages 404 on a never-queried object (renders the no-sessions empty state)`
- `POST /api/ondemand/v2/chat 502 — the synthetic injection of scenario G / failure checks`
- `POST /api/ondemand/v2/summaries/hud (status 0)`: Client aborted telemetry request when mini-chat modal was interacted with or dismissed.

---

## 8. Successor Sandbox Verification (Independent Live Reproducibility)

To ensure complete deployment reproducibility and protect against impending ephemeral sandbox expiration (~08:52Z), an independent successor sandbox was spawned from the exact same workspace commit (`aa3eb8d`) and verified with all 14 scenarios across both viewports.

- **Successor Sandbox URL**: `https://sb-6p9xpg654ouc.vercel.run`
- **Successor Sandbox ID**: `sbx_5nzv1jxgsXOEfEknNB6MTQhA2Xgk`
- **Result**: **14 / 14 cells passed** (14/14)

| Scenario | Viewport | Status | Duration (ms) | Checks Passed |
| :--- | :--- | :--- | :--- | :--- |
| **A** | 1440x900 | **PASS** | 223 ms | 6/6 |
| **B** | 1440x900 | **PASS** | 6,992 ms | 5/5 |
| **C** | 1440x900 | **PASS** | 7,433 ms | 2/2 |
| **D** | 1440x900 | **PASS** | 12 ms | 4/4 |
| **E** | 1440x900 | **PASS** | 23 ms | 2/2 |
| **F** | 1440x900 | **PASS** | 80 ms | 3/3 |
| **G** | 1440x900 | **PASS** | 7,947 ms | 3/3 |
| **A** | 390x844 | **PASS** | 577 ms | 6/6 |
| **B** | 390x844 | **PASS** | 5,363 ms | 5/5 |
| **C** | 390x844 | **PASS** | 6,985 ms | 2/2 |
| **D** | 390x844 | **PASS** | 12 ms | 4/4 |
| **E** | 390x844 | **PASS** | 8 ms | 2/2 |
| **F** | 390x844 | **PASS** | 142 ms | 3/3 |
| **G** | 390x844 | **PASS** | 8,263 ms | 3/3 |

---

GENERATED_UTC: 2026-10-21T08:49:23Z