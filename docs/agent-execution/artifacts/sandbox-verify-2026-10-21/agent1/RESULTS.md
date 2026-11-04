# Verification Results — Agent 1 (Scenarios A, B & Desktop/Mobile Parity)

- **Target Sandbox**: `https://sb-72vtzc1c6cf8.vercel.run`
- **Sandbox ID**: `sbx_pZgfovEYwxtQu48zPwIg0rVujhWO`
- **Head Commit**: `aa3eb8d`
- **Execution Date**: 2026-10-21

## Verification Table

| Scenario | Viewport | Status | Duration (ms) | Screenshot | Run At (ISO-8601) | Key Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **A** | 1440×900 | **PASS** | 1319 | `ab/A-1440x900.png` | `2026-10-21T08:01:01.357Z` | `app_boots`: "Loading screen hidden or globe canvas active"; `title_contains_product_name`: "document.title=\"OnDemand Intelligence Workstation\""; `no_legacy_brand_terms`: "No forbidden terms visible"; `brand_mark_present`: "Found 2 [data-brand-mark] element(s)"; `foundation_health_200`: "status 200, ok=true, keySource=server"; `foundation_contracts_min_13`: "status 200, 33 contracts" |
| **A** | 390×844 | **PASS** | 194 | `ab/A-390x844.png` | `2026-10-21T08:01:13.963Z` | `app_boots`: "Loading screen hidden or globe canvas active"; `title_contains_product_name`: "document.title=\"OnDemand Intelligence Workstation\""; `no_legacy_brand_terms`: "No forbidden terms visible"; `brand_mark_present`: "Found 2 [data-brand-mark] element(s)"; `foundation_health_200`: "status 200, ok=true, keySource=server"; `foundation_contracts_min_13`: "status 200, 33 contracts" |
| **B** | 1440×900 | **PASS** | 5992 | `ab/B-1440x900.png` | `2026-10-21T08:01:03.173Z` | `mini_chat_opens_earthquake`: "Mini chat opened with data-open=\"true\""; `status_streaming_and_stop_visible`: "streamingStatusSeen=true, stopButtonSeen=true"; `assistant_message_and_settle`: "settled within 90s, assistant message chars: 83"; `key_source_server_header`: "x-ondemand-key-source header: \"server\""; `no_client_api_key_in_localstorage`: "localStorage ondemand.apiKey is null" |
| **B** | 390×844 | **PASS** | 6022 | `ab/B-390x844.png` | `2026-10-21T08:01:16.419Z` | `mini_chat_opens_earthquake`: "Mini chat opened with data-open=\"true\""; `status_streaming_and_stop_visible`: "streamingStatusSeen=true, stopButtonSeen=true"; `assistant_message_and_settle`: "settled within 90s, assistant message chars: 164"; `key_source_server_header`: "x-ondemand-key-source header: \"server\""; `no_client_api_key_in_localstorage`: "localStorage ondemand.apiKey is null" |
| **parity-streaming** | 1440×900 & 390×844 | **PASS** | 24960 | `check-streaming-1440x900.png`<br>`check-streaming-390x844.png` | `2026-10-21T08:08:00.204Z` | `sameKeySource`: true (both header `x-ondemand-key-source: server`); `bothStreamed`: true (stop button seen on both, TTFT desktop 3332ms, mobile 4417ms, \|diff\|: 1085ms); `localStorageApiKeyIsNull`: true on both; final status: "READY · inferred"; assistant chars: desktop 96, mobile 147 |
| **parity-hud** | 1440×900 & 390×844 | **PASS** | 1388 | `check-hud-summary-1440x900.png`<br>`check-hud-summary-390x844.png` | `2026-10-21T08:08:12.606Z` | `hudSummaryPopulated`: true (active telemetry "NORMAL STREET NEAR UT TOWER (AUSTIN) 2KM \| NORTH AMERICA \| ALT 627M \| ...", not awaiting telemetry); `bothHudOpenable`: true (clicking `#hud-ask-ondemand` opened mini-chat with `objectType="hudSummary"` and `kind="HUD SUMMARY · global"`); Mobile layout: bounding box `[left:0, right:390, top:453, bottom:844]` fits 390×844 viewport, `scrollWidth: 390 <= innerWidth: 390` (zero horizontal overflow) |

---

## Detailed Check Evidence from `chat-intelligent-ui.json`

### Scenario A — Deliverables (1440×900)
- `app_boots`: PASS — Loading screen hidden or globe canvas active
- `title_contains_product_name`: PASS — `document.title="OnDemand Intelligence Workstation"`
- `no_legacy_brand_terms`: PASS — No forbidden terms visible (0 matches for "God's Eye", "GEV MIC", "OpenAI")
- `brand_mark_present`: PASS — Found 2 `[data-brand-mark]` element(s)
- `foundation_health_200`: PASS — `status 200, ok=true, keySource=server`
- `foundation_contracts_min_13`: PASS — `status 200, 33 contracts`

### Scenario A — Deliverables (390×844)
- `app_boots`: PASS — Loading screen hidden or globe canvas active
- `title_contains_product_name`: PASS — `document.title="OnDemand Intelligence Workstation"`
- `no_legacy_brand_terms`: PASS — No forbidden terms visible
- `brand_mark_present`: PASS — Found 2 `[data-brand-mark]` element(s)
- `foundation_health_200`: PASS — `status 200, ok=true, keySource=server`
- `foundation_contracts_min_13`: PASS — `status 200, 33 contracts`

### Scenario B — Pipeline & Waiting (1440×900)
- `mini_chat_opens_earthquake`: PASS — Mini chat opened with `data-open="true"`
- `status_streaming_and_stop_visible`: PASS — `streamingStatusSeen=true, stopButtonSeen=true`
- `assistant_message_and_settle`: PASS — Settled within 90s, assistant message chars: 83
- `key_source_server_header`: PASS — `x-ondemand-key-source header: "server"`
- `no_client_api_key_in_localstorage`: PASS — `localStorage ondemand.apiKey is null`

### Scenario B — Pipeline & Waiting (390×844)
- `mini_chat_opens_earthquake`: PASS — Mini chat opened with `data-open="true"`
- `status_streaming_and_stop_visible`: PASS — `streamingStatusSeen=true, stopButtonSeen=true`
- `assistant_message_and_settle`: PASS — Settled within 90s, assistant message chars: 164
- `key_source_server_header`: PASS — `x-ondemand-key-source header: "server"`
- `no_client_api_key_in_localstorage`: PASS — `localStorage ondemand.apiKey is null`

---

## Parity Evidence from `parity.json`

### Desktop (1440×900)
- **Time to First Token (TTFT)**: 3332 ms
- **Stop Button Observed**: `true`
- **Key Source Header**: `"server"`
- **Final Status**: `"READY · inferred"`
- **Assistant Length**: 96 characters (`"Parity Earthquake is an earthquake object, but no location, time, or other details are provided."`)
- **Local Storage API Key**: `null` (server-held credentials only)
- **HUD Summary Text**: `"NORMAL STREET NEAR UT TOWER (AUSTIN) 2KM | NORTH AMERICA | ALT 627M | WINDOW 2x1KM | SUN -60° | ONA 50° | UTC-7"` (active telemetry)
- **HUD Ask Mini-Chat**: Opened successfully (`objectType="hudSummary"`, `kind="HUD SUMMARY · global"`)

### Mobile (390×844)
- **Time to First Token (TTFT)**: 4417 ms
- **Stop Button Observed**: `true`
- **Key Source Header**: `"server"`
- **Final Status**: `"READY · inferred"`
- **Assistant Length**: 147 characters (`"Confirmed: This object is labeled “Parity Earthquake” and identified as an earthquake, but no locati..."`)
- **Local Storage API Key**: `null` (server-held credentials only)
- **HUD Summary Text**: `"NORMAL STREET NEAR UT TOWER (AUSTIN) 2KM | NORTH AMERICA | ALT 627M | WINDOW 2x3KM | SUN -60° | ONA 50° | UTC-7"` (active telemetry)
- **HUD Ask Mini-Chat**: Opened successfully (`objectType="hudSummary"`, `kind="HUD SUMMARY · global"`)
- **Bounding Box**: `x: 0, y: 453, width: 390, height: 391, left: 0, right: 390, top: 453, bottom: 844`
- **Fits Viewport**: `true`
- **No Horizontal Overflow**: `scrollWidth: 390 <= innerWidth: 390` (`true`)

### Parity Comparison
- `sameKeySource`: `true` (both `"server"`)
- `bothStreamed`: `true` (both displayed stop button and streamed tokens)
- `bothHudOpenable`: `true` (both cleanly opened HUD summary contextual mini chat)
- `ttftDifferenceMs`: 1085 ms
- `overallParityPass`: `true`

---

## Console Errors and Network Exceptions

### Console Errors
1. `Failed to load resource: the server responded with a status of 404 ()` (at `2026-10-21T08:01:00.514Z`)
2. `Failed to load resource: the server responded with a status of 404 ()` (at `2026-10-21T08:01:03.201Z`)
3. `Failed to load resource: the server responded with a status of 404 ()` (at `2026-10-21T08:01:11.794Z`)

### Failed Requests Analysis
1. `GET /api/setup/status` (status 404 & net::ERR_ABORTED):
   - **Assessment**: **Known-benign**. This endpoint is probed during initial client bootstrap to check for local setup wizard state when self-hosted. In deployed workstation mode, this route returns 404 and is ignored by the runtime.
2. `GET /api/ondemand/v2/messages?externalUserId=ws-default-mvhtox7u-e6b35550&objectContextKey=earthquake%3Aearthquakes-global&limit=20&sort=asc` (status 404):
   - **Assessment**: **Known-benign**. The mini-chat queries historical session messages for this context key on initial open. When no previous session exists for this object context, the backend responds with 404, prompting the UI to display the clean starter empty-state as designed (`showEmptyState('no-sessions', ...)`).

---

GENERATED_UTC: 2026-10-21T08:10:00Z
