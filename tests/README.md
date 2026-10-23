# Gods-Eye View — E2E Acceptance Test Suite

This test suite contains the 18 Playwright acceptance specifications, visual regression, performance benchmarks, and secret scanning tests for the Gods-Eye scene engine feature.

## Test Suite Architecture & Contracts

All tests adhere strictly to the DOM identifiers, data attributes, `window.__godsEye` public orchestrator APIs, and custom events specified in `docs/gods-eye/CONTRACTS.md` (sections 5 and 6).

### Environment & Execution

Playwright is installed outside the repository at `/tmp/pwtest/node_modules/@playwright/test`. The test suite is executed using `NODE_PATH` and the Playwright CLI:

```bash
cd gods-eye-view
export PREVIEW_URL="https://your-preview-url.vercel.run"
export NODE_PATH="/tmp/pwtest/node_modules"
node /tmp/pwtest/node_modules/@playwright/test/cli.js test -c tests/playwright.config.mjs
```

Or using the automated runner script:

```bash
PREVIEW_URL="https://your-preview-url.vercel.run" ./tests/e2e/run-live.sh
```

The runner:
1. Executes all specs against `$PREVIEW_URL`.
2. Prints a matrix summary (`test NN: pass|fail`).
3. Copies reports and screenshots to `docs/agent-execution/artifacts/gods-eye-<date>/`.

### Browser Configuration

- **Browser**: System Chromium at `/usr/bin/chromium`
- **Chromium Flags**: `--no-sandbox`, `--use-gl=swiftshader`, `--enable-unsafe-swiftshader`, `--ignore-gpu-blocklist`
- **Navigation Timeout**: 60 seconds (for CesiumJS WebGL globe and asset loading)
- **Ready Gate**: Tests wait for `#loading-screen` to hide and `window.__godsEye` to initialize
- **Projects**:
  - `desktop` (1440x900 viewport) — runs specs 01–13, 15, 16, 18
  - `tablet` (1024x768 viewport, touch) — runs spec 17
  - `mobile` (390x844 viewport, mobile & touch) — runs specs 14, 17

---

## Fixtures & Network Interception Policy

The suite employs a dual-layer ("belt-and-braces") interception strategy:
1. **URL parameter `?fixtures=1`**: Signals the client app to replay offline fixtures (`tests/fixtures/burj-khalifa-live.json`, `tests/fixtures/umm-suqeim-rebuild.json`).
2. **Playwright `page.route` intercepts** in `tests/e2e/_helpers.mjs`:
   - `**/footage/stream**`: Emits SSE streaming events matching the target place (`event: query`, `event: source_start`, `event: item`, `event: source_done`, `event: done`).
   - `**/footage/route/plan**`: Returns a deterministic 5-waypoint scene path (S0 8,000,000 m, S1 1,200,000 m, S2 18,000 m, S3 2,000 m, S4 300 m; durations 1200/2200/2600/2200/2300 ms; approachBearing 135; confidence 0.8) or status 500 when testing fallback.
   - `**/footage/route/alerts**`: Returns route warning alerts.
   - **Third-party media hosts** (`youtube`, `tiktok`, `instagram`, `googlevideo`, `cdninstagram`, `gibs.earthdata`): Fulfilled locally with 1x1 transparent PNGs or empty HTML shells. Third-party network calls are blocked, while media requests remain tracked and countable.

---

## Performance Threshold Policy (Spec 16)

CesiumJS 3D globe rendering under headless Linux uses the SwiftShader CPU software rasterizer.
- **Target Frame Rate**: $\ge 55$ FPS average from stage S2 to S4.
- **SwiftShader Fallback Threshold**: When running without hardware GPU acceleration, if average FPS falls below 55 FPS but remains $\ge 30$ FPS, the test logs an annotation (`{ type: 'perf', description: '...' }`) and passes.
- **Failure Threshold**: The test fails if frame rate drops below **30 FPS**.
- Metrics are logged to `tests/report/perf-16.json`.

---

## Visual Regression Policy (Spec 17)

- Uses Playwright's `expect(locator).toHaveScreenshot(name, { maxDiffPixelRatio: 0.02, animations: 'disabled' })`.
- Baselines are stored in `tests/e2e/__screenshots__/`.
- `updateSnapshots: 'missing'` automatically creates missing baseline images on initial execution.
- Evaluated across desktop, tablet, and mobile viewports.
- Visual diff reports are written to `tests/report/html/`.

---

## Test Specifications

| Spec | Name | Primary Assertions |
|------|------|--------------------|
| **01** | `01-load-no-prompt` | Loads share URL hash without prompt; after 8s dwell & canvas pan, asserts 0 media/footage requests, 0 `<video>`, `#ge-rail` hidden/absent, `geStage` is `''`; writes `report/network-01.json`. |
| **02** | `02-burj-khalifa-build` | Builds Burj Khalifa live scene; collects `gev:scene-stage` events; verifies S0..S4 ladder order; verifies altitudes within $\pm 15\%$ of 8e6 / 1.2e6 / 18,000 / 2,000 / 300 m; VIIRS layer present at S0/S1 and absent after S2; pins appear at S2; `#ge-player[data-playing=1]` only after S4; $\ge 5$ cards with distance and delta text. |
| **03** | `03-umm-suqeim-rebuild` | Builds crash rebuild scene; asserts location hash resolves to lat $\approx 25.147 \pm 0.02$, lon $\approx 55.199 \pm 0.02$; `#ge-banner` displays archival warning; all cards have `[data-recency=ARCHIVE]`; cards include handles `dubaipolicehq`, `gulfnews`, `gulftoday`; 3 ground routes with `open` and `restricted` statuses. |
| **04** | `04-outside-register` | Prompts for place outside register ("Lisbon"); `#ge-register-modal` opens; decline verifies 0 network requests and no scene created; accept verifies scene builds and `aoi.inRegister === true`. |
| **05** | `05-route-agent-500` | Simulates HTTP 500 from route agent; header `.ge-h-route` displays `ROUTE: FALLBACK` and `data-route-fallback=1`; scene completes S0..S4 camera ladder. |
| **06** | `06-instagram-toggle` | Builds scene to S4; toggles Instagram source checkbox in `#ge-sources-toggle`; asserts Instagram cards and map pins are removed, then restored upon re-checking. |
| **07** | `07-save-reload-open` | Builds scene to S4; records camera, pin IDs, route IDs, and card IDs; reloads page; calls `window.__godsEye.openScene(id)`; asserts identical camera ($\pm 1\%$), matching ID sets, and 0 network/media requests; writes `report/network-07.json`. |
| **08** | `08-recreate-diff` | Calls `window.__godsEye.recreateScene(id)`; verifies S0..S4 re-traversal, route re-planning call, and `.ge-scene-diff` badge showing `+N new · M removed · K unchanged`. |
| **09** | `09-scene-switch-abort` | Builds Scene A; switches to Scene B at S2; asserts Scene A entities are cleared, Scene A cards are not rendered, and Scene A in-flight stream is aborted; writes `report/network-09.json`. |
| **10** | `10-timeline-scrub` | Scrubs `#ge-timeline-scrub` range input; verifies visible cards are filtered; clicks `#ge-timeline-play`; collects `gev:scene-playing` events in chronological order; asserts `.ge-tl-alert` count $\ge 1$. |
| **11** | `11-start-next-three` | Queues 3 scenes; clicks `#scene-start-btn`; validates time order in `playback.queue`; verifies S2 dwell ($4200 \pm 200$ ms) and S4 dwell ($11000 \pm 200$ ms); verifies `#scene-next-btn` advances and `#scene-stop-btn` stops playback. |
| **12** | `12-lifecycle-clock` | Simulates mock clock progression: at $+1$h `.ge-sc-new` badge is visible (`data-new=1`); at $+25$h badge is absent (`data-new=0`); at $+73$h card moves to `#ge-scenes-tab-archive` (`data-archived=1`). |
| **13** | `13-share-url` | Builds scene; reads share hash with `sc=s_...`; restores in fresh browser context with 0 media requests; strips `sc=` and verifies fallback reconstruction with 0 media requests. |
| **14** | `14-mobile-390` | Mobile project (390x844); asserts `#ge-scene-root` bounding box width $\le 390$ and bottom $\le 844$; asserts no horizontal scroll overflow; verifies S4 stage arrival and composer usability. |
| **15** | `15-reduced-motion` | Emulates `prefers-reduced-motion: reduce`; verifies ladder cuts complete in $< 4$ s; patches camera to assert `flyTo` count is 0 and `setView` count $> 0$. |
| **16** | `16-perf-55fps` | Ingests 30-item stream; measures rAF frame rate from S2 to S4; asserts $\ge 55$ FPS (target) or $\ge 30$ FPS under SwiftShader with annotation; writes `report/perf-16.json`. |
| **17** | `17-visual-regression` | Evaluates desktop, tablet, and mobile; takes pixel-level screenshots of `#ge-scene-header`, `#ge-rail`, `#ge-timeline`, `#ge-player`, `#ge-scenes`, `#ge-sources-panel`, and full-page view. |
| **18** | `18-bundle-secret-scan` | Scans all loaded `<script src>` and `<link rel=modulepreload>` bundles against regex for leaked OnDemand/API keys/tokens; records console & page errors throughout build to assert zero unexpected errors; writes `report/console-18.json` and `report/bundle-scan-18.json`. |

---

## Artifacts & Screenshots

Every test execution automatically:
1. Attaches a full-page screenshot named `NN-<slug>-<viewport>.png` to the Playwright test report.
2. Writes the screenshot to `tests/report/screenshots/NN-<slug>-<viewport>.png`.
3. Emits JSON logs to `tests/report/*.json`.
4. Writes HTML report output to `tests/report/html/`.
