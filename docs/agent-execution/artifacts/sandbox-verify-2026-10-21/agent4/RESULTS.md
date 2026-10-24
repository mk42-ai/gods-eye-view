# Verification Agent 4: Scenario G, Cross-App Regression & Legacy Code Audit

**Target Sandbox**: `https://sb-72vtzc1c6cf8.vercel.run`  
**Execution Agent**: Agent 4 of 5 (swarm verification)  
**Run Mode**: Read-only verification & static analysis  

---

## 1. Scenario G Verification Cells

Scenario G tests synthetic 502 injection on mini-chat turns, verifies rendering of error UI states, confirms recovery turns settle cleanly with OnDemand server keys, and validates globe/HUD interactive stability.

| Scenario | Viewport | Status | Duration (ms) | Screenshot | Run At (UTC) | Evidence Details |
|---|---|---|---|---|---|---|
| **G** | **1440x900** | **PASS** | 7,409 ms | `g/G-1440x900.png` (733 KB) | `2026-10-21T08:03:03.425Z` | 3/3 checks passed: `synthetic_502_error_ui` (Rendered `.od-chat__msg--error` and status TURN FAILED / source-unavailable); `retry_recovery_turn_success` (Recovered turn completed, status READY); `globe_and_hud_interactive_stability` (`canvasPresent=true`, `titleBarPresent=true`, `controlsResponsive=true`). |
| **G** | **390x844** | **PASS** | 6,315 ms | `g/G-390x844.png` (212 KB) | `2026-10-21T08:03:16.821Z` | 3/3 checks passed: `synthetic_502_error_ui` (Rendered `.od-chat__msg--error` and status TURN FAILED / source-unavailable); `retry_recovery_turn_success` (Recovered turn completed, status READY); `globe_and_hud_interactive_stability` (`canvasPresent=true`, `titleBarPresent=true`, `controlsResponsive=true`). |

---

## 2. Cross-App Regression & Failure/Retry Parity

Full end-to-end regression across desktop (`1440x900`) and mobile (`390x844`) viewports executing sub-checks **a** through **g**.

### Sub-Check Summary & Parity Table

| Sub-Check | Viewport | Status | Timestamp (UTC) | Screenshot Artifact | Evidence / Measured Behavior |
|---|---|---|---|---|---|
| **a. App Shell** | 1440x900 | **PASS** | `2026-10-21T08:18:26.659Z` | N/A (initial boot) | `#title-bar` present ("OnDemand Intelligence Workstation\n\nSPATIAL INTELLIGENCE CONSOLE"); `canvas` active; rail controls present (`#data-toggles`, `.panel-collapse-btn`, `#clear-selected-layers`); `window.__godsEyeView.dataManager` truthy; 0 `pageerror` events. |
| **a. App Shell** | 390x844 | **PASS** | `2026-10-21T08:18:54.179Z` | N/A (initial boot) | `#title-bar` present; `canvas` active; rail controls present (`#data-toggles`, `.panel-collapse-btn`, `#clear-selected-layers`); `window.__godsEyeView.dataManager` truthy; 0 `pageerror` events. |
| **b. Failure State (502)** | 1440x900 | **PASS** | `2026-10-21T08:18:27.838Z` | `check-failure-1440x900.png` (395 KB) | Intercepted POST `/api/ondemand/v2/chat` with synthetic 502; UI rendered `.od-chat__msg--error`, status `#ondemand-mini-chat-status` = `TURN FAILED`, and `.od-empty-state--source-unavailable`. Retry affordance check: no dedicated button matching `/retry/i` inside `#ondemand-mini-chat` (`retryAffordanceExists=false`). |
| **b. Failure State (502)** | 390x844 | **PASS** | `2026-10-21T08:18:54.959Z` | `check-failure-390x844.png` (111 KB) | Intercepted POST `/api/ondemand/v2/chat` with synthetic 502; UI rendered `.od-chat__msg--error`, status `#ondemand-mini-chat-status` = `TURN FAILED`, and `.od-empty-state--source-unavailable`. Retry affordance check: no dedicated button matching `/retry/i` inside `#ondemand-mini-chat` (`retryAffordanceExists=false`). |
| **c. Cancel State** | 1440x900 | **PASS** | `2026-10-21T08:18:32.288Z` | `check-cancel-1440x900.png` (913 KB) | Sent multi-paragraph briefing prompt; clicked `#ondemand-mini-chat-stop` immediately upon appearance; status transitioned to `"CANCELLED"` within 5s; verified 0 assistant tokens arrived over the subsequent 3s window. |
| **c. Cancel State** | 390x844 | **PASS** | `2026-10-21T08:18:58.633Z` | `check-cancel-390x844.png` (366 KB) | Sent multi-paragraph briefing prompt; clicked `#ondemand-mini-chat-stop` immediately upon appearance; status transitioned to `"CANCELLED"` within 5s; verified 0 assistant tokens arrived over the subsequent 3s window. |
| **d. Retry / Recovery** | 1440x900 | **PASS** | `2026-10-21T08:18:41.811Z` | `check-recovery-1440x900.png` (1.6 MB) | Sent "Recover from synthetic failure"; settled within 90s to status `READY` with stop hidden; response header `x-ondemand-key-source: server`; assistant completed with 327 characters. |
| **d. Retry / Recovery** | 390x844 | **PASS** | `2026-10-21T08:19:06.048Z` | `check-recovery-390x844.png` (292 KB) | Sent "Recover from synthetic failure"; settled within 90s to status `READY` with stop hidden; response header `x-ondemand-key-source: server`; assistant completed with 338 characters. |
| **e. Session Isolation** | 1440x900 | **PASS** | `2026-10-21T08:18:43.533Z` | `check-isolation-1440x900.png` (1.6 MB) | Switched to `{objectType: 'alert', objectId: 'agent4-iso-1440x900'}`: transcript showed 0 messages and empty state "No prior investigation for this object", with zero occurrences of word "fire". Switched back to fire object: 4 prior messages persisted. |
| **e. Session Isolation** | 390x844 | **PASS** | `2026-10-21T08:19:07.418Z` | `check-isolation-390x844.png` (357 KB) | Switched to `{objectType: 'alert', objectId: 'agent4-iso-390x844'}`: transcript showed 0 messages and empty state "No prior investigation for this object", with zero occurrences of word "fire". Switched back to fire object: 4 prior messages persisted. |
| **f. Hard Reload Persist** | 1440x900 | **PASS** | `2026-10-21T08:18:50.501Z` | `check-reload-persist-1440x900.png` (393 KB) | Full `page.reload()`, re-booted app, re-opened fire object; transcript successfully restored 4 messages from server conversation store (`/api/ondemand/v2/messages`). |
| **f. Hard Reload Persist** | 390x844 | **PASS** | `2026-10-21T08:19:12.800Z` | `check-reload-persist-390x844.png` (111 KB) | Full `page.reload()`, re-booted app, re-opened fire object; transcript successfully restored 4 messages from server conversation store (`/api/ondemand/v2/messages`). |
| **g. Globe Stability** | 1440x900 | **PASS** | `2026-10-21T08:18:50.502Z` | Captured in `check-reload-persist-1440x900.png` | `canvas` present; `#title-bar` present; `positionCartographic` finite numbers: lon = -1.6268 rad, lat = 0.5538 rad, alt = 6,168,657 m. Globe rendering loop fully operational. |
| **g. Globe Stability** | 390x844 | **PASS** | `2026-10-21T08:19:12.801Z` | Captured in `check-reload-persist-390x844.png` | `canvas` present; `#title-bar` present; `positionCartographic` finite numbers: lon = -1.5262 rad, lat = 0.5859 rad, alt = 8,555,409 m. Globe rendering loop fully operational. |

### Parity Evaluation Block
- **Same Failure UI Element**: **YES** (Identical: `.od-chat__msg--error` + status `TURN FAILED` + `.od-empty-state--source-unavailable` on both desktop and mobile).
- **Same Recovery Key Source**: **YES** (`server` on both viewports).
- **Both Isolated Across Contexts**: **YES** (Alert context has 0 messages, no "fire" leak; fire context preserves its messages).
- **Both Persisted After Hard Reload**: **YES** (Both viewports restored all 4 messages from the server-side conversation store).
- **Retry Affordance Exists**: **NO** (Neither desktop nor mobile renders an explicit button with text `/retry/i`; retry is conducted by sending a follow-up query in the composer).

---

## 3. Legacy Code Audit (Static, Read-Only)

A comprehensive audit was performed across all source files (`server`, `src`, `api`) searching for legacy references to `openai`, `realtime`, and `/api/realtime`.

### Raw Scan Output
Output saved to `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent4/legacy-grep.txt`. Exactly 45 non-test lines matched across 19 files.

### Hit Classification Table

| Category | Description | Hit Count | Files & Lines | Classification Assessment |
|---|---|---|---|---|
| **(1) Runtime OpenAI APIs / Realtime Transport** | Live network calls to `api.openai.com`, WebSocket realtime clients, `realtime/token` endpoints, or runtime reads of `OPENAI_API_KEY` for API requests. | **0** | *None* | **Zero runtime OpenAI calls exist in the entire codebase.** All chat and intelligence runs through OnDemand v2. |
| **(2) GTFS-Realtime Transit Feeds** | Transit vehicle position feeds, protobuf decoders, and feed registries named after the GTFS-Realtime industry standard protocol. Completely unrelated to OpenAI. | **20** | `server/tools/transit.js`: 2, 25, 262<br>`src/sources/transitService.js`: 3, 87<br>`src/sources/httpBody.js`: 58<br>`src/data/transitFeeds.js`: 3, 142, 190, 191, 203, 244, 265<br>`src/data/gtfsRealtime.js`: 2, 3, 8, 11, 13, 151<br>`src/data/transitProxy.js`: 20, 230<br>`src/data/dataCredits.js`: 188 | Open standards for public transit (MBTA, HSL, Entur, Translink) utilizing protobuf format. Harmless standard naming. |
| **(3) Historical Comments, Legacy Codes & UI Settings Metadata** | Architectural comments documenting the deprecation/replacement of OpenAI Realtime, legacy error-code constants (`OPENAI_NOT_CONFIGURED`), and provider metadata in the settings dialog. | **21** | `server/ondemand/foundation/voice-route.js`: 209, 210<br>`server/ondemand/foundation/proxy-route.js`: 30, 150, 688<br>`server/providers/common/rate-limit.js`: 5<br>`server/serverless/vercel-adapter.js`: 20<br>`src/hudSummaryResponse.js`: 1, 5, 6<br>`src/keySetupCore.mjs`: 53, 54, 56, 57<br>`src/layers/vessels/selection.js`: 185<br>`src/voice/ondemand/pipeline.js`: 8<br>`src/voice/ondemand/index.js`: 11<br>`src/voice/gevActions.js`: 1284, 1636 | Documentation comments documenting transition from legacy OpenAI bypass to OnDemand v2; backward-compatibility error constant `OPENAI_NOT_CONFIGURED`; and settings modal entry in `keySetupCore.mjs`. None invoke OpenAI runtime services. |
| **(4) Voice Toolset Symbol Identifiers** | Internal symbols and test hooks named `GEV_REALTIME_TOOLS` and `realtimeInstructions`. | **4** | `server/voice/tools.js`: 4<br>`server/voice/instructions.js`: 5, 47, 74 | Internal schema definitions used by test suites and server prompt generators; does not connect to any OpenAI WebSocket or endpoint. |

### Supplementary Verification Probes
1. **Direct runtime credential and transport check**:
   ```bash
   grep -rn -E "api\.openai\.com|realtime/token|OPENAI_API_KEY|new WebSocket\(" server src api --include='*.js' --include='*.mjs' | grep -v '\.test\.mjs'
   ```
   **Result**: 1 hit only (`src/keySetupCore.mjs:57: envVars: Object.freeze(['OPENAI_API_KEY'])`), which is metadata defining the provider input in the user settings UI. 0 instances of `api.openai.com`, `realtime/token`, or `new WebSocket(`.
2. **Provider directory removal check**:
   ```bash
   ls server/providers/openai 2>&1
   ```
   **Result**: `ls: cannot access 'server/providers/openai': No such file or directory` (removed in commit `d44264f`).
3. **Voice realtime files check**:
   ```bash
   ls src/voice | grep -i realtime
   ```
   **Result**: 0 files found.
4. **WebSocket dependency check in `package.json`**:
   `grep -n '"ws"' package.json` -> line 73: `"ws": "^8.21.0"` (present in root dependencies for mock/test harness).
5. **Git commit history**:
   - `d44264f feat(ondemand): voice turn on OnDemand (OpenAI Realtime removed), honest plugin lifecycle...`
   - `f7dff65 chore(ondemand): remove the retired OpenAI HUD-summary provider file...`
   - `132fced feat(brand): env-driven product identity, neutral brand asset set...`
6. **Production Bundle Analysis (`dist/assets/*.js`)**:
   - `grep -rn "api\.openai\.com" dist/assets/*.js`: **0 hits**
   - `realtime/token`: **0 hits**
   - `OPENAI_API_KEY`: 1 hit in `dist/assets/index-BLGPMGkc.js` for the settings UI metadata modal.
   - Forbidden brand names (`god's eye`, `gods eye`, `gev mic`): **0 hits** in `dist/index.html` and `dist/assets/*.js`.
7. **Live Deployment HTTP Probe**:
   ```bash
   curl -s https://sb-72vtzc1c6cf8.vercel.run/ | grep -o -i -E "<title>[^<]*</title>|god'?s eye|gev mic"
   ```
   **Result**: `<title>OnDemand Intelligence Workstation</title>` (0 legacy brand mentions).

### Audit Verdict
**runtime OpenAI/Realtime references: 0**

---

GENERATED_UTC: 2026-10-21T08:24:30.000Z
