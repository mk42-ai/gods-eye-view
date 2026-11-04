# Agent 3 Verification Results — Scenarios E & F, Plugin Lifecycle Probes & Session Isolation

**Target Base URL**: `https://sb-72vtzc1c6cf8.vercel.run`  
**Execution Context**: Verification Agent 3 of five-agent swarm (sandbox verify 2026-10-21)  
**Output Directory**: `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/`  
**Run Mode**: Headless Chromium (SwiftShader / ANGLE GL), Process-Group hardKill guard  

---

## 1. Scenario Execution Matrix (Scenarios E & F)

Harness: `node scripts/qa-chat-intelligent-ui.mjs --url https://sb-72vtzc1c6cf8.vercel.run --out docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/ef --viewports 1440x900,390x844 --scenarios E,F --format png`

| Scenario | Viewport | Status | Duration (ms) | Screenshot Path | Run At (ISO-8601 UTC) | Evidence / Key Detail |
|---|---|---|---|---|---|---|
| **E** (Summarization vs history / isolation) | 1440x900 | **PASS** | 7,314 | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/ef/E-1440x900.png` | `2026-10-21T08:03:38.512Z` | Found 2 prior messages in transcript; Isolated transcript: `containsEarthquake=false`, `msgs=0` |
| **F** (Settings, caps & plugin states) | 1440x900 | **PASS** | 401 | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/ef/F-1440x900.png` | `2026-10-21T08:03:47.291Z` | `activePlugins=10/10`, `validPluginIds=33/33`; plugin panel present with 32 badges, `allValid=true`; probe 200 OK |
| **E** (Summarization vs history / isolation) | 390x844 | **PASS** | 3,978 | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/ef/E-390x844.png` | `2026-10-21T08:03:52.517Z` | Found 4 prior messages in transcript; Isolated transcript: `containsEarthquake=false`, `msgs=0` |
| **F** (Settings, caps & plugin states) | 390x844 | **PASS** | 79 | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/ef/F-390x844.png` | `2026-10-21T08:03:57.204Z` | `activePlugins=10/10`, `validPluginIds=33/33`; plugin panel present with 32 badges, `allValid=true`; probe 200 OK |

**Artifact Confirmations**:
- `E-1440x900.png` (1.2 MB, non-zero)
- `E-390x844.png` (358 KB, non-zero)
- `F-1440x900.png` (1.5 MB, non-zero)
- `F-390x844.png` (358 KB, non-zero)
- `chat-intelligent-ui.json` (7.6 KB)

---

## 2. Plugin Lifecycle API Probes

All raw HTTP responses and JSON payloads are saved in `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/api/`.

| Probe | Request / Endpoint | Headers / Payload | HTTP Status | Observed State & Details | Timestamp (UTC) |
|---|---|---|---|---|---|
| **2.a: Initial Snapshot** | `GET /api/ondemand/v2/plugins` | None | `200 OK` | 32 total plugins returned: 11 `ondemand-plugin`, 21 `ondemand-tool`. All 32 in initial state `discovered`, `verifiedAt: null`. None cached from earlier verify in the last 10 min. Saved: `plugins-before.json`. | `2026-10-21T08:06:05.434Z` |
| **2.b: Verify Active Plugin** | `POST /api/ondemand/v2/plugins/verify` | `X-Workstation-User: agent3-probe`<br>`{"externalUserId":"agent3-probe","names":["internet_web_search"]}` | `200 OK` | State transitioned to `ready`. `verifiedAt: "2026-10-21T08:07:04.013Z"`, `latencyMs: 6075`, `error: null`, `answerPreview: "READY"`. Saved: `verify-websearch.json`. | `2026-10-21T08:07:04.013Z` |
| **2.c: Verify Inactive Plugin** | `POST /api/ondemand/v2/plugins/verify` | `X-Workstation-User: agent3-probe`<br>`{"externalUserId":"agent3-probe","names":["x_mcp_connector"]}` | `200 OK` | State transitioned to `failed`. `error.code: "inactive_on_account"`, `httpStatus: 400`, `retryable: false`, `message: "This research source is currently inactive on the OnDemand account."`. Saved: `verify-xmcp.json`. | `2026-10-21T08:07:45.796Z` |
| **2.d: Verify All (empty names)** | `POST /api/ondemand/v2/plugins/verify` | `X-Workstation-User: agent3-probe`<br>`{"externalUserId":"agent3-probe","names":[]}` | `200 OK` | Verifies all 10 active `ondemand-plugin`s with bounded concurrency. State counts: `{'ready': 10}`. Kind counts: `{'ondemand-plugin': 10}`. Failed: 0 among active plugins. Latencies ranged from 4712 ms to 11391 ms. Saved: `verify-all.json`. | `2026-10-21T08:08:20.030Z` |
| **2.e: State Diff After** | `GET /api/ondemand/v2/plugins` | None | `200 OK` | 32 total plugins. 10 active plugins transitioned `discovered` → `ready` (`verifiedAt` populated); 1 inactive plugin (`x_mcp_connector`) transitioned `discovered` → `failed` (`inactive_on_account`); 21 `ondemand-tool`s remained `discovered` (gateway route-level tools). Saved: `plugins-after.json`. | `2026-10-21T08:08:35.000Z` |
| **2.f: Principal Binding Mismatch** | `POST /api/ondemand/v2/plugins/verify` | `X-Workstation-User: someone-else`<br>`{"externalUserId":"agent3-probe","names":["internet_web_search"]}` | `403 Forbidden` | Returned `{"error":"user_mismatch"}`. Phase G principal binding verified strictly enforced. Saved: `auth-probe-mismatch.json`. | `2026-10-21T08:11:07.000Z` |
| **Health Probe** | `GET /api/ondemand/v2/health` | None | `200 OK` | `ok: true`, `configured: true`, `conversationBackend: "memory"`, `contracts: 33`, `activePlugins: 10`, `keySource: "server"`. Saved: `health.json`. | `2026-10-21T08:11:55.000Z` |
| **Contracts Probe** | `GET /api/ondemand/v2/contracts` | None | `200 OK` | 33 contracts total: 11 `ondemand-plugin`, 21 `ondemand-tool`, 1 `ondemand-workflow`. `activePlugins: 10`. Every non-null `pluginId` matches `/^plugin-\d+$/` (11/11 valid, 0 invalid). Saved: `contracts.json`. | `2026-10-21T08:11:56.000Z` |

---

## 3. Browser Plugin Badge Transitions

Browser Driver: `/tmp/agent3-plugins.mjs` executed under Node.js + Puppeteer (SwiftShader) with 8-minute global timeout and process-group `hardKill` handlers.

### 1440x900 Viewport
- **Initial Badges**: Recorded 32 initial rows in `#ondemand-plugin-panel` (`li.od-plugin__row`). Reflected in-memory cache from step 2 (10 READY, 1 FAILED, 21 DISCOVERED). Screenshot: `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/check-plugins-initial-1440x900.png`.
- **`internet_web_search` Verification**:
  - Button `button.od-plugin__verify[data-plugin-name="internet_web_search"]` clicked.
  - Button immediately disabled with text `VERIFYING…`.
  - Reached state `ready` with badge text `READY`, timing `14m ago`, latency `6075ms`.
  - Server-side transitions documented in unit test `server/ondemand/foundation/plugin-lifecycle.test.mjs` ('happy path transitions in order'): audit sequence `discovered` → `installing` → `authenticating` → `ready`.
  - Screenshot: `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/check-plugins-ready-1440x900.png`.
- **`x_mcp_connector` Verification**:
  - Button `button.od-plugin__verify[data-plugin-name="x_mcp_connector"]` clicked.
  - Reached state `failed` with badge text `FAILED`.
  - Error message `.od-plugin__error`: `"This research source is currently inactive on the OnDemand account."`.
  - Screenshot: `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/check-plugins-failed-1440x900.png`.
- **Summary Count**: `.od-plugins__summary-count` displays `"10 ready"`.

### 390x844 Viewport
- **Initial Badges**: Recorded 32 initial rows in `#ondemand-plugin-panel`. Screenshot: `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/check-plugins-initial-390x844.png`.
- **`internet_web_search` Verification**:
  - Button clicked: transitioned to `VERIFYING…` (disabled).
  - Reached state `ready` with badge text `READY`, timing `just now`, latency `4526ms`.
  - Screenshot: `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/check-plugins-ready-390x844.png`.
- **`x_mcp_connector` Verification**:
  - Button clicked: reached state `failed` with badge text `FAILED`.
  - Error message `.od-plugin__error`: `"This research source is currently inactive on the OnDemand account."`.
  - Screenshot: `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/check-plugins-failed-390x844.png`.
- **Summary Count**: `.od-plugins__summary-count` displays `"10 ready"`.

---

## 4. Session Isolation Across Distinct Object Contexts

| Viewport | Primary Object (`earthquake`) Seeded Msgs | Second Object (`alert`) Context Key | Alert Transcript Msgs | Alert Contains Earthquake Text | Re-opened Earthquake Context Key | Earthquake Restored Msgs | Restored Contains Original Turn | Isolation Result | Screenshot Path |
|---|---|---|---|---|---|---|---|---|---|
| **1440x900** | 2 (`What is the magnitude of this earthquake?` + answer) | `alert:agent3-iso-1440x900` | 0 | `false` | `earthquake:agent3-1440x900` | 2 | `true` | **PASS** | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/check-isolation-1440x900.png` |
| **390x844** | 2 (`What is the magnitude of this earthquake?` + answer) | `alert:agent3-iso-390x844` | 0 | `false` | `earthquake:agent3-390x844` | 2 | `true` | **PASS** | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent3/check-isolation-390x844.png` |

**Session Isolation Summary**:
- Switching object context aborts in-flight turns, resets the local transcript, and isolates the session by `objectType:objectId`.
- Distinct object keys (`alert:agent3-iso-*`) load zero messages and never bleed conversation text from other entities.
- Re-opening previously visited entities seamlessly restores full historical conversation turns via `/api/ondemand/v2/messages`.

---

GENERATED_UTC: 2026-10-21T08:24:45.000Z
