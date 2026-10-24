# Agent 4 — PLUGIN LIFECYCLE probes — `https://sb-4asza5droe1u.vercel.run`

Run window: 2026-10-21T09:33:47Z → 09:58:30Z (UTC). Sandbox alive throughout (no 410/ECONNREFUSED).
Driver: focused Puppeteer scripts `/tmp/agent4-plugins*.mjs` (brief template verbatim: /usr/bin/chromium, SwiftShader, hardKill, 10-min cap). Browser closed after every run; no agent4-owned chromium left (the 3 chromium processes seen on the pod at the end belong to agents 1/2's running sessions).
Machine-readable: `agent4/results.json`. Raw API bodies: `agent4/api/*.raw` + `.json`, request metadata `agent4/api/_meta.jsonl`. Browser traces: `agent4/browser/browser-results*.json`.

**Totals: 17 PASS · 0 FAIL · 3 DEFECT (1 low API, 2 = same medium UI overlay defect at both viewports)**

## Part A — API (curl)

| # | Check | HTTP | Latency | Run at (UTC) | Status | Evidence |
|---|---|---|---|---|---|---|
| A1 | GET /api/ondemand/v2/health | 200 | 97 ms | 09:33:47Z | PASS | `contracts:33, activePlugins:10, keySource:"server", configured:true, conversationBackend:"memory"` |
| A1 | GET /api/health | 200 | 81 ms | 09:33:47Z | PASS | identical body (alias) |
| A2 | GET /api/ondemand/v2/contracts | 200 | 78 ms | 09:33:47Z | PASS | 33 contracts: ondemand-tool 21 · ondemand-plugin 11 · ondemand-workflow 1. 11 non-null pluginIds, all `/^plugin-\d{10}$/`. Active plugins = 10 (≤10). Inactive: `x_mcp_connector` |
| A3 | GET /plugins (before) | 200 | 86 ms | 09:33:47Z | PASS | 32 entries, all `discovered` |
| A4 | POST /plugins/verify `internet_web_search` (user agent4-probe) | 200 | 4905 ms | 09:34:07Z | PASS | `state:"ready", latencyMs:4788, verifiedAt:09:34:11.946Z, pluginId:plugin-1713924030, answerPreview:"READY"` |
| A5 | POST /plugins/verify `x_mcp_connector` | 200 | 88 ms | 09:34:11Z | PASS | `state:"failed", error:{code:"inactive_on_account", httpStatus:400, retryable:false, message:"This research source is currently inactive on the OnDemand account."}` — exact shape from plugin-lifecycle.js (200 envelope, 400 recorded inside `error`) |
| A6 | POST /plugins/verify `names:[]` | 200 | 6085 ms | 09:34:12Z | PASS | 10/10 ready: perplexity_research 5048 · internet_web_search 4788 (cache) · gpt_search 4473 · x_search 4612 · tiktok_scraper 4613 · instagram_user_info 5999 · instagram_professional 5721 · youtube_captions 5529 · reddit_posts 4529 · linkedin_search 5981 ms |
| A7 | GET /plugins (after) | 200 | 177 ms | 09:34:18Z | PASS | ready 10 · failed 1 · discovered 21. Diff vs A3: 10 discovered→ready, x_mcp_connector discovered→failed, 21 tool routes unchanged |
| A8 | POST verify, header `someone-else` / body `agent4-probe` | 403 | 113 ms | 09:34:18Z | PASS | `{"error":"user_mismatch"}` |
| A9 | POST verify `names:["does_not_exist"]` | **500** | 100 ms | 09:34:18Z | **DEFECT (low)** | `{"error":"internal_error"}` — honest (no fake ready, no `plugins` array) but `verify()` throws `Unknown plugin contract` uncaught inside `handle()`, so the router returns 500 instead of a 400/404 `unknown_plugin`. |

## Part B — Browser badge transitions (1440x900 and 390x844)

Panel: `#ondemand-plugin-panel` mounts into the floating `#ondemand-plugin-dock` (the mini chat is not in the DOM when `installPluginPanel` runs at boot). `<details>` is open by default — no toggle needed. 32 rows; summary "10 ready".

| Check | Viewport | Status | Run at | Screenshot | Evidence |
|---|---|---|---|---|---|
| B1 initial counts | 1440x900 | PASS | 09:35:08Z | browser/check-plugins-initial-1440x900.png | ready 10 · failed 1 · discovered 21 (server state was already verified by Part A; lifecycle state is process-global) boot 12198 ms |
| B1 initial counts | 390x844 | PASS | 09:36:25Z | browser/check-plugins-initial-390x844.png | same counts, boot 9719 ms |
| B2 VERIFY internet_web_search | 1440x900 | PASS | 09:58:13Z | browser/check-plugins-dock-ready-1440x900.png | mutation sequence: t0 `VERIFY/READY` → +184 ms `VERIFYING…` (button disabled) → +5413 ms `VERIFY/READY`, sub "just now 5212ms "READY"". POST 200 after cache expiry (real upstream call). |
| B2 VERIFY internet_web_search | 390x844 | PASS | 09:58:29Z | browser/check-plugins-dock-ready-390x844.png | `VERIFYING…` at +20 ms → `READY` at +40 ms (served from the 10-min ready cache, 5212 ms shown) |
| B3 VERIFY x_mcp_connector | 1440x900 | PASS | 09:58:19Z | browser/check-plugins-dock-failed-1440x900.png | `VERIFYING…` +27 ms → `FAILED` +43 ms; error row "This research source is currently inactive on the OnDemand account."; toggle disabled |
| B3 VERIFY x_mcp_connector | 390x844 | PASS | 09:58:29Z | browser/check-plugins-dock-failed-390x844.png | same, +24/+45 ms |
| B4 `__odPlugins.getSelectedPluginIds()` | both | PASS | 09:35/09:36Z | (initial PNGs) | default `[]`; after checking every enabled toggle: 10 plugin ids all `/^plugin-\d{10}$/` (x_mcp_connector toggle disabled) + 21 tool-route names (panel keys selection on `pluginId||name`; the chat slices to 4 and the orchestrator ignores unknown ids — observation only) |
| B5 pointer reachability with mini chat open | 1440x900 | **DEFECT (medium)** | 09:48Z | browser/check-plugins-overlay-1440x900.png | see below |
| B5 pointer reachability with mini chat open | 390x844 | **DEFECT (medium)** | 09:48Z | browser/check-plugins-overlay-390x844.png | see below |

### Badge state sequence actually exposed by the UI
The UI exposes only **`VERIFY` → `VERIFYING…` (button text, button disabled) → final badge** (`READY` with latency/relative time, or `FAILED` with the error message). `data-state` on the badge never shows `installing` / `authenticating`: the verify is one POST request/response (no SSE), and the row re-renders only on completion. So the UI **collapses pending→installing→authenticating into VERIFYING…**. The server-side sequence is the source of truth, proven by `server/ondemand/foundation/plugin-lifecycle.test.mjs`: active plugin audits `discovered→installing→authenticating→ready` (3 `plugin_state` events); inactive plugin `discovered→failed code inactive_on_account` (1 event, no client call). Also note: because A4/A6 had already produced `ready`, the badge was already READY before the first browser click; the 10-minute cache made the first browser-run clicks (09:35Z) no-ops server-side — the 09:58Z run (after cache expiry) shows a real 5.2 s upstream verification.

### DEFECT B5 — mini chat covers the PLUGINS panel (both viewports)
`#ondemand-plugin-dock` is `position:fixed; z-index:184`; `aside#ondemand-mini-chat` is `position:fixed; z-index:186` and, when open, occupies the same bottom-right area (desktop: chat 990–1422 × 421–812 vs dock 1038–1422 × 500–876; mobile: chat full width 453–844 vs dock 14–372 × 444–820). `elementFromPoint` at the centre of every VERIFY button, the REFRESH button, the summary toggle and the checkboxes returns a chat element (`.od-empty-state--no-sessions`, `#ondemand-mini-chat-starters`, `#ondemand-mini-chat-send`, header). Real mouse clicks (run1/run3, chat open) produced **no POST and no VERIFYING…**; `element.click()` (run3) and real clicks with the chat closed (run5) worked. Impact: a user cannot verify or (de)select plugins while the chat is open — exactly when per-turn plugin selection is meant to be used. Suggested fix: on mini-chat open, re-mount the panel into the `.od-chat__plugin-slot` the installer already anticipates, or give the dock a higher z-index / an offset outside the chat rectangle.

## Chromium hygiene
Each script ended with `browser.close(); hardKill()`. After the last run `pgrep -f 'node /tmp/agent4'` → 0; the remaining chromium processes on the pod are parented to `/tmp/agent2-checks.mjs` and `/tmp/agent1-parity-media.mjs` (other agents), none to agent4.
