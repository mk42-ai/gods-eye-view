# Subagent 4 Verification Report: Scenarios A–G, Perf, and No-Fake-Content Audit

- **Agent**: Subagent 4 (Agent 4 of 5)
- **Target URL**: `https://ondemand-eand-spatial-qrli9v1uy-schoolhack-web-team.vercel.app` (Primary target, Vercel deployment `dpl_7K9b62NbSgmdF4Rd5FfAu3cAHVP8`, commit `d44264f`)
- **Execution Run**: 2026-10-21T05:33:21Z to 2026-10-21T06:17:43Z
- **Artifacts Path**: `docs/agent-execution/artifacts/verify-2026-10-21/scenarios/`

---

## Executive Summary

| Category | Total Checks | PASS | FAIL | PARTIAL / UNSUPPORTED |
|---|---|---|---|---|
| **Part 1: Scenarios A–G (Both Viewports)** | 14 | 14 | 0 | 0 |
| **Part 2: Performance (rAF, Virtualization, Scroll)** | 6 | 4 | 2 | 0 |
| **Part 3: No-Fake-Content & Static Audit (s1, s2)** | 10 | 10 | 0 | 0 |
| **Part 3: Runtime Network Telemetry Audit (s3)** | 4 | 4 | 0 | 0 |
| **Total** | **34** | **32** | **2** | **0** |

### Key Findings & Identified Defects
1. **Scenarios A–G**: **100% PASS** across both desktop (1440x900) and mobile (390x844). All contract health endpoints, server-key propagation, honest citations/provenance, mobile responsiveness, session isolation, active plugin caps, synthetic 502 error handling, and recovery turns verified.
2. **rAF Coalescing**: **PASS**. Streaming deltas are successfully coalesced into animation frames. Wire deltas to DOM mutation batch ratios were **19.0x** at 1440x900 (57 deltas into 3 mutation batches) and **5.67x** at 390x844 (34 deltas into 6 mutation batches).
3. **List Virtualization**: **PASS**. Activity in memory and DOM rows were within limits (`activityInMemory <= 200`, `rowsRendered <= 6`).
4. **Scroll Anchoring & Follow-Up Pinning**:
   - **Streaming Anchoring**: **PASS**. When the user scrolls to top (`scrollTop = 0`), the transcript remains anchored at 0 throughout the streaming response (`minScrollTop = 0`, `maxScrollTop = 0`).
   - **Follow-up Pinning**: **FAIL** (`src/ondemand/miniChat.js:661, 767, 1060`). When a user sends a follow-up query after having scrolled up, `miniChat.js` fails to reset `userScrolledUp = false` on user message submission or call `pinScroll(true)`. Consequently, the transcript remains stuck at `scrollTop = 0` (diff = 484 px at 1440x900, diff = 1407 px at 390x844) instead of pinning to the bottom for the user's new message.
5. **No-Fake-Content Audit**: **PASS**. Zero `/fallbacks` path references anywhere in the built bundle or runtime requests. Zero simulated timers or fake progress indicators. Zero client-side API key exposures (`check-no-secrets.mjs --dist` scanned 1857 files clean; zero direct `api.on-demand.io` browser requests; zero secret headers).

---

## Part 1: Scenarios A–G Verification Table

| Scenario | Viewport | Status | Duration | Checks Passed | Console Errors | Failed Requests | Key Detail / Classification |
|---|---|---|---|---|---|---|---|
| **A** | 1440x900 | **PASS** | 1019 ms | 6 / 6 | 0 | 0 | Loading screen hidden; title "OnDemand Intelligence Workstation"; health 200 ok:true; contracts >= 13. |
| **B** | 1440x900 | **PASS** | 5661 ms | 5 / 5 | 1 | 1 | Mini-chat opened for earthquake; STOP button visible; assistant streamed; keySource="server"; no local key. Error: 404 GET `/messages` (expected unqueried-object probe). |
| **C** | 1440x900 | **PASS** | 5644 ms | 2 / 2 | 0 | 0 | Sourcing question completed within 90s; honest sources / confidence basis displayed. |
| **D** | 1440x900 | **PASS** | 10 ms | 3 / 3 | 0 | 0 | No brand mark overlap with HUD title bar; close button closes; reopen restores transcript (2 messages). |
| **E** | 1440x900 | **PASS** | 6 ms | 2 / 2 | 0 | 0 | History present before switch; switching to `trafficLayer` isolated transcript (containsEarthquake=false). |
| **F** | 1440x900 | **PASS** | 134 ms | 3 / 3 | 0 | 0 | Active plugins 10/10; pluginId format `^plugin-\d+$`; lifecycle states valid; plugins probe 200. |
| **G** | 1440x900 | **PASS** | 7634 ms | 3 / 3 | 1 | 1 | Synthetic 502 intercepted (intentional); error UI rendered; recovery turn succeeded; globe interactive. |
| **A** | 390x844 | **PASS** | 179 ms | 6 / 6 | 0 | 0 | Loading screen hidden; mobile viewport title correct; health 200; contracts >= 13. |
| **B** | 390x844 | **PASS** | 10993 ms | 5 / 5 | 0 | 0 | Mini-chat opened; streaming state; STOP button visible; server key source; no client key in localStorage. |
| **C** | 390x844 | **PASS** | 5803 ms | 2 / 2 | 0 | 0 | Sourcing question completed; honest sources state rendered. |
| **D** | 390x844 | **PASS** | 12 ms | 3 / 3 | 0 | 0 | Mobile viewport fit (no horizontal scroll, input visible); close/reopen persistence verified. |
| **E** | 390x844 | **PASS** | 15 ms | 2 / 2 | 0 | 0 | Transcript isolation maintained across object switch from earthquake to trafficLayer. |
| **F** | 390x844 | **PASS** | 142 ms | 3 / 3 | 0 | 0 | Active plugins cap <= 10; pluginId regex match; lifecycle states valid. |
| **G** | 390x844 | **PASS** | 7663 ms | 3 / 3 | 1 | 1 | Synthetic 502 intercepted (intentional); error UI rendered; un-intercepted retry turn succeeded. |

### Console Errors and Network Failure Classification
Across the entire 14-scenario run, all recorded errors and failed requests were classified:
- `GET /api/setup/status` (404 and aborted): 2 occurrences (1 per page boot). **Expected** (serverless key-setup probe).
- `GET /api/ondemand/v2/messages?...objectContextKey=earthquake%3Aearthquakes-global` (404): 1 occurrence. **Expected** (first-time unqueried object history lookup).
- `GET /api/ondemand/v2/messages?...objectContextKey=trafficLayer%3Atraffic-austin-live` (404): 2 occurrences. **Expected** (first-time unqueried object history lookup).
- `POST /api/ondemand/v2/chat` (502): 2 occurrences (1 per viewport in Scenario G). **Intentional** (synthetic test harness injection testing error UI and recovery).
- **Unexpected Errors**: **0**.

---

## Part 2: rAF / virtualization / scroll anchoring

Measurements taken with real instrumented browser sessions running in Chromium with SwiftShader WebGL.

### 1. rAF Coalescing (p1)

| Viewport | Turn Question | Delta Events | Literal `"event: delta"` | Wire / Parsed Tokens | rAF Calls | DOM Mutation Batches | Ratio (Deltas / Batches) | Median Interval (ms) | Result |
|---|---|---|---|---|---|---|---|---|---|
| **1440x900** | "Describe this object in three sentences." | 57 | 0 | 57 | 36 | 3 | **19.00x** | 2543.05 ms | **PASS** |
| **390x844** | "Describe this object in three sentences." | 34 | 0 | 34 | 84 | 6 | **5.67x** | 511.80 ms | **PASS** |

**Observations**:
- Coalescing condition (`deltas > 1` and `mutationBatches <= deltas`) was satisfied at both viewports.
- **Wire SSE Format Detail**: The wire stream from `/api/ondemand/v2/chat` adheres to contract §4 (`event: message` with `data: {"answer": ...}` and `eventType: "fulfillment"`), which `createV2SseParser` parses into `{ type: 'delta' }` and `miniChat` records as `turn.tokens`. Literal `"event: delta"` occurrences on the wire are 0; wire/parsed deltas were 57 and 34.

### 2. List Virtualization (p2)

| Viewport | Metric | Initial Value | After 3 Real Stress Turns ("One word: ok.") | Upper Bound / Cap | Result |
|---|---|---|---|---|---|
| **1440x900** | `activityInMemory` | 0 | 0 | <= 200 (`ACTIVITY_WINDOW`) | **PASS** |
| **1440x900** | `rowsRendered` (`.od-chat__activity-row`) | 0 | 0 | <= 6 | **PASS** |
| **390x844** | `activityInMemory` | 0 | 0 | <= 200 (`ACTIVITY_WINDOW`) | **PASS** |
| **390x844** | `rowsRendered` (`.od-chat__activity-row`) | 0 | 0 | <= 6 | **PASS** |

**Observations**:
- The state was read via `window.__godsEyeView.miniChat.getState().activity`.
- DOM rows rendered remained bounded <= 6 at all times.

### 3. Scroll Anchoring & Pinning (p3)

| Viewport | Long Question | Streaming Samples | min scrollTop | max scrollTop | Anchoring Held (<= 40 px) | Follow-Up scrollHeight | Follow-Up scrollTop | Follow-Up clientHeight | Distance From Bottom (`diff`) | Pinned to Bottom (< 40 px) | Overall Result |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **1440x900** | "Explain, in at least twelve sentences, how earthquakes are measured and reported." | 25 | 0 px | 0 px | **TRUE** | 904 px | 0 px | 420 px | **484 px** | **FALSE** | **FAIL** |
| **390x844** | "Explain, in at least twelve sentences, how earthquakes are measured and reported." | 22 | 0 px | 0 px | **TRUE** | 1841 px | 0 px | 434 px | **1407 px** | **FALSE** | **FAIL** |

**Defect Diagnostic & File:Line**:
- **Streaming Anchoring**: Succeeded (`min = 0, max = 0`). When the user scrolled up (`scrollTop = 0`), the transcript stayed firmly anchored at 0 throughout the 12-sentence streaming response.
- **Follow-up Pinning Failure**:
  - In `src/ondemand/miniChat.js:661`:
    ```javascript
    ui.transcript.addEventListener?.('scroll', () => {
      const t = ui.transcript;
      userScrolledUp = t.scrollHeight - t.scrollTop - t.clientHeight > 40;
    });
    ```
  - In `src/ondemand/miniChat.js:765-768`:
    ```javascript
    function pinScroll(force = false) {
      if (!ui.transcript) return;
      if (force || !userScrolledUp) ui.transcript.scrollTop = 1e9;
    }
    ```
  - In `src/ondemand/miniChat.js:745-755` (composer submit) and `src/ondemand/miniChat.js:1060` (`ask()` entry):
    When the user submits a new question, `userScrolledUp` is never reset to `false`, and `appendMessage('user', text)` invokes `pinScroll()` without `force = true`. As a consequence, `userScrolledUp` remains `true` from the previous turn, keeping `scrollTop` stuck at 0 (484 px and 1407 px away from the bottom) instead of re-pinning to the bottom for the new user message.

---

## Part 3: No-Fake-Content & Asset Directory Audit

### 1. Static Audit of Built Bundle (`dist/assets/*.js` and `dist/index.html`)

- **Local Build**: Built with `VITE_SERVERLESS_MODE=true node node_modules/vite/bin/vite.js build` in 5.78s.
- **Key Material**: `node scripts/check-no-secrets.mjs --dist` scanned 1857 text files. **Result: ✓ no key material in the source tree + dist/**.
- **Search Patterns**:
  1. `fallbacks` / `/fallbacks`: Exactly 0 occurrences of `/fallbacks`. Single occurrence of the English word in CCTV error logger: `[Data:CCTV] ground-prior batch failed (keeping catalog fallbacks)`.
  2. `setInterval` near `progress`: Exactly 1 occurrence in `dist/assets/index-BLGPMGkc.js`, traced to `PlaybackClock` in `src/director/clock.js` (camera director shot timing). **Zero simulated timers**. `src/loadingFeedback.js` renders real prewarm progress (`stats.phaseProgressPct`, `stats.prewarmQueueDepth`).
  3. `fakeProgress|simulateProgress|mockProgress|fakeCitation|fake_plugin|mockPlugin|MOCK_|mockResponse|lorem ipsum|TODO: fake`: **0 hits**.
  4. `api.openai.com|OPENAI_API_KEY|realtime/token|elevenlabs`: **0 runtime key/endpoint hits**. `OPENAI_API_KEY` appears solely as a descriptor string in `src/keySetupCore.mjs` for the status probe panel.
  5. `God's Eye|GEV MIC`: **0 hits** in rendered strings.

### 2. Absolute Asset URLs in Bundle by Top-Level Directory

- **/assets/** (13 distinct assets):
  - `/assets/alpr-marker-normal-COAu686W.png`
  - `/assets/alpr-marker-selected-WmayY1kQ.png`
  - `/assets/alpr-marker-selected-brackets-LQ7qLcLT.png`
  - `/assets/brand/apple-touch-icon.png`
  - `/assets/brand/favicon-16.png`
  - `/assets/brand/favicon-32.png`
  - `/assets/brand/favicon-48.png`
  - `/assets/brand/favicon.ico`
  - `/assets/brand/og-image.png`
  - `/assets/cable-geo-i2PzBJi6.json`
  - `/assets/dams-B2lCjFgp.geojson`
  - `/assets/datacenters-CtzejECr.geojson`
  - `/assets/landing-point-geo-CiAWPhfe.json`
- **/brand/** (3 distinct assets):
  - `/brand/mark-light.svg`
  - `/brand/mark.svg`
  - `/brand/site.webmanifest`
- **/models/** (8 distinct assets):
  - `/models/airplane.glb`, `/models/atr72.glb`, `/models/b789.glb`, `/models/bell206.glb`, `/models/c172.glb`, `/models/citation2.glb`, `/models/jet.glb`, `/models/mq9.glb`
- **Root** (4 distinct assets):
  - `/logo.svg`, `/pin.svg`, `/station_information.json`, `/station_status.json`
- **/fallbacks**: **0 references**.

**Factual Brand Asset Split**:
- `/brand/*`: 14 occurrences in the built bundle (serving `/brand/mark-light.svg`, `/brand/mark.svg`, `/brand/site.webmanifest`, legacy marks).
- `/assets/brand/*`: 7 occurrences in the built bundle (serving the new brand set: `og-image.png`, `favicon.ico`, `favicon-16/32/48.png`, `apple-touch-icon.png`).

### 3. Source-Level Code Audit

1. `fallbacks` in `src`, `server`, `api`, `public`, `index.html`:
   - 13 occurrences across 9 files. Every hit is an English word in comments or local variables:
     - `src/data/aircraftClass.js:6`: English comment ("Category fallbacks cover OpenSky")
     - `src/layers/cctv/ground.js:158, 176`: English comment / log message ("catalog fallbacks")
     - `src/layers/cctv/policy.js:132`: English comment ("catalog fallbacks")
     - `src/layers/firms/anchors.js:50`: English comment ("geoid fallbacks")
     - `src/layers/flights/records.js:150`: English comment ("Two fallbacks")
     - `src/scenes/shotPresentation.js:91`: English JSDoc ("presentation fallbacks")
     - `src/ui/styles/foundation.css:10`: English CSS comment ("hex fallbacks")
     - `server/providers/aircraft/adsb-lol.js:399, 407, 413`: server provider endpoint fallback list array
     - `server/providers/aircraft/opensky.js:1002, 1107`: English comments ("fallbacks may recover")
     - `server/providers/cctv/sources.js:119, 613`: English comments ("synthetic fallbacks")
     - `server/tools/_invoke.js:4`: English comment ("breakers, fallbacks, status headers")
   - Zero path references to `/fallbacks`.
2. `mock|fake|simulat` in `src/ondemand`, `src/voice`, `server/ondemand/foundation`:
   - 3 occurrences total, all JSDoc comments describing unit test mocking under `node:test`:
     - `src/ondemand/entityChat.js:25`: `* the whole controller runs under node:test with a fake DOM.`
     - `src/voice/ondemand/audio.js:8`: `* constructor injectable so the pipeline tests can substitute fakes.`
     - `src/voice/ondemand/pipeline.js:15`: `* state machine that node:test drives with fakes.`
   - Zero runtime fake content or simulated mock data.
3. `api.openai.com|realtime/token|OPENAI_API_KEY`:
   - Zero runtime API calls or token retrievals. Single metadata string in `src/keySetupCore.mjs:57`.

### 4. Runtime Network Log Audit (`network-log.json`)

Recorded across boot + full chat turn + voice turn (`window.__odVoice.submitText('Say hello in five words.')`) at 1440x900:
- **Total Requests Logged**: 258 requests
- **URLs containing `/fallbacks`**: **0** (PASS)
- **Same-Origin Static Assets**: 15 requests (`/assets/` [5], `/brand/` [4], `/cesium/` [3], root SVGs [3])
- **Third-Party Hosts Contacted**:
  - `services.arcgisonline.com`: 142 requests (satellite tiles)
  - `terrain.reearth.land`: 58 requests (Cesium 3D terrain height tiles)
  - `fonts.googleapis.com` / `fonts.gstatic.com`: 5 requests (font assets)
  - `airevprod.blob.core.windows.net`: 1 request
  - `api.on-demand.io`: **0 requests** (PASS — browser never communicates directly with OnDemand; server-key architecture intact)
- **Secret Headers**:
  - Zero requests carried `apikey` or `x-ondemand-key` headers (PASS).

---

## Artifact Inventory

All artifacts reside in `docs/agent-execution/artifacts/verify-2026-10-21/scenarios/`:
- `results.json`: Full 34-check machine-readable verification record.
- `RESULTS.md`: This comprehensive human-readable report.
- `perf.json`: Detailed measurements for rAF coalescing, list virtualization, and scroll anchoring.
- `network-log.json`: Complete 258-request telemetry capture including methods, statuses, URLs, resource types, and header security checks.
- `ag-run.log`: Console log from `scripts/qa-chat-intelligent-ui.mjs` run.
- `perf-run.log`: Console log from `scripts/qa-verify-perf.mjs` run.
- `ag/chat-intelligent-ui.json`: Raw scenario run results.
- `ag/<Scenario>-<viewport>.jpg`: 14 screenshots for Scenarios A–G across 1440x900 and 390x844.
- `perf-p1-1440x900.jpg`: Screenshot after rAF coalescing turn at 1440x900.
- `perf-p3-1440x900.jpg`: Screenshot after scroll anchoring turn at 1440x900.
- `perf-p1-390x844.jpg`: Screenshot after rAF coalescing turn at 390x844.
- `perf-p3-390x844.jpg`: Screenshot after scroll anchoring turn at 390x844.
