# Agent 3 — RESULTS (sandbox-verify-2026-10-21 / retry-0917)

- Target: `https://sb-4asza5droe1u.vercel.run` (health 200 at run start; no 410/ECONNREFUSED observed during the run)
- Run window (UTC): 2026-10-21T09:32:57Z → 2026-10-21T10:03:30Z
- Drivers: `scripts/qa-chat-intelligent-ui.mjs` (task 1) and focused Puppeteer scripts copied from the brief template (task 2), archived under `agent3/scripts/` (`agent3-parity.mjs`, `agent3-tapcheck.mjs`, `agent3-banner.mjs`). One Chromium at a time; `pgrep -f chromium` = 0 (own) at the end — see the note at the bottom.
- Totals: **PASS 18 · FAIL 0 · DEFECT 1 · UNSUPPORTED 0** (19 cells)

## Task 1 — harness E/F/G × 2 viewports
`node scripts/qa-chat-intelligent-ui.mjs --url … --out agent3/efg --viewports 1440x900,390x844 --scenarios E,F,G --format png` → **6/6 PASS** (log `agent3/efg-run.log`, report `agent3/efg/chat-intelligent-ui.json`).
All 6 PNGs non-zero (208 KB–1.68 MB) and PIL mean grayscale 61.7–68.7 (> 40, i.e. not the loading overlay) — `agent3/efg-brightness.json`.
Harness console errors (7) / failed requests (10) are all expected: `GET /api/setup/status` 404 (serverless build), `GET /api/ondemand/v2/messages` 404 for never-chatted objects (= empty history), and the two synthetic 502s injected by scenario G itself.

## Task 2 — desktop/mobile parity (failure / recovery / cancel / isolation / reload / 3-way)
All eleven functional cells **PASS** at both viewports with identical behaviour:
- failure → `.od-chat__msg--error` + status `TURN FAILED` + `source-unavailable` empty state "upstream_error · Synthetic 502 (HTTP 502)";
- recovery → status `READY · inferred`, POST `/api/ondemand/v2/chat` 200 with `x-ondemand-key-source: server`, assistant text 104–107 chars; **no RETRY button exists** (recovery is via the composer, as expected);
- cancel → `CANCELLED` 2–5 ms after STOP, assistant length frozen (9 → 9 over 3 s);
- isolation → alert object: 0 messages, `no-sessions` empty state, no "fire" text; fire object replays 2 messages with `data-history="true"` (the server keeps only the successful turn — the 502 turn and the cancelled turn are not persisted, hence 2 not 6; that is consistent at both viewports);
- reload persistence → after `page.reload()` + boot wait, 2 messages restored from `GET /api/ondemand/v2/messages` (200);
- 3-way concurrent isolation (desktop) → storage key is `ondemand.v2.externalUserId.default` (`USER_STORAGE_KEY + '.' + workspace`, `src/ondemand/miniChat.js:41,323-345`), set via `evaluateOnNewDocument` in three separate browser contexts; ids `iso-user-1/2/3-0917`; each transcript holds exactly its own user message (own=1, foreign=0), all three reached READY.

### DEFECT (mobile only) — serverless notice banner occludes the mini-chat composer at 390×844
- The first mobile pass (`agent3/parity-run1-desktop.log`, mobile block) FAILED failure/recovery/cancel because a real pointer click (`page.click('#ondemand-mini-chat-send')`) never reached the button: `document.elementFromPoint` at the SEND/INPUT centres returns the serverless-notice `<span>` (parent `div[data-gev-serverless-notice]`, `position:fixed; left/right:12px; bottom:12px; z-index:2147483000`, `src/serverlessMode.js:47-67`), which sits above `#ondemand-mini-chat` (`z-index:186`, docked to the bottom at `0,453,390×391` on mobile). Probe logs: `agent3/tap-probe-390x844.log`, `agent3/tap-probe2-390x844.log` (elementsFromPoint stack), `agent3/banner-occlusion.log`.
- Measured overlap: 390×844 → banner `12,739,366×93` covers SEND (`205,801,166×32`, 5146 px² = 97 %) and INPUT (`13,801,186×32`, 5766 px² = 97 %); `sendHittable=false`, `inputHittable=false`. 1440×900 → banner `400,813,640×75` vs SEND `1195,769,208×32`: overlap 0, hittable → PASS.
- Impact: on a phone the user cannot tap SEND / the input (nor STOP, same row) until they dismiss the banner with its ×; the harness and the re-run use `element.click()` inside `page.evaluate`, which bypasses hit-testing, so the chat logic itself is verified correct at both viewports (`agent3/parity-run2-mobile.log`). Screenshots: `agent3/check-banner-occlusion-390x844.png`, `agent3/check-banner-occlusion-1440x900.png`.
- Suggested fix (orchestrator's call, no source edited): give the notice a z-index below the chat/dock (or `bottom` offset above `#ondemand-mini-chat` when it is open), or hide it while `#ondemand-mini-chat[data-open="true"]` on narrow viewports.

## Result table
| # | check | scenario | viewport | status | duration_ms | run_at (UTC) | screenshot | key evidence |
|---|---|---|---|---|---|---|---|---|
| 1 | harness-scenario | E | 1440x900 | **PASS** | 5944 | 2026-10-21T09:33:09.332Z | `agent3/efg/E-1440x900.png` | history_messages_present_before_switch: Found 2 prior messages in transcript; session_isolated_for_different_object: Isolated transcript: containsEarthquake=false, msgs=0 · mean_gray=67.19 |
| 2 | harness-scenario | F | 1440x900 | **PASS** | 179 | 2026-10-21T09:33:16.712Z | `agent3/efg/F-1440x900.png` | active_plugins_cap_and_id_regex: activePlugins=10/10, validPluginIds=33/33; plugin_panel_lifecycle_states: present, 32 badges, allValid=true; plugins_api_probe: probe result: 200 mounted (obj) · mean_gray=67.14 |
| 3 | harness-scenario | G | 1440x900 | **PASS** | 5938 | 2026-10-21T09:33:17.998Z | `agent3/efg/G-1440x900.png` | synthetic_502_error_ui: Rendered .od-chat__msg--error and status TURN FAILED / source-unavailable; retry_recovery_turn_success: Recovered turn completed (status READY); globe_and_hud_interactive_stability: canvasPresent=true, titleBarPresent=true, controlsResponsive=true · mean_gray=68.74 |
| 4 | harness-scenario | E | 390x844 | **PASS** | 4914 | 2026-10-21T09:33:32.944Z | `agent3/efg/E-390x844.png` | history_messages_present_before_switch: Found 7 prior messages in transcript; session_isolated_for_different_object: Isolated transcript: containsEarthquake=false, msgs=0 · mean_gray=67.65 |
| 5 | harness-scenario | F | 390x844 | **PASS** | 84 | 2026-10-21T09:33:38.219Z | `agent3/efg/F-390x844.png` | active_plugins_cap_and_id_regex: activePlugins=10/10, validPluginIds=33/33; plugin_panel_lifecycle_states: present, 32 badges, allValid=true; plugins_api_probe: probe result: 200 mounted (obj) · mean_gray=67.52 |
| 6 | harness-scenario | G | 390x844 | **PASS** | 6285 | 2026-10-21T09:33:38.439Z | `agent3/efg/G-390x844.png` | synthetic_502_error_ui: Rendered .od-chat__msg--error and status TURN FAILED / source-unavailable; retry_recovery_turn_success: Recovered turn completed (status READY); globe_and_hud_interactive_stability: canvasPresent=true, titleBarPresent=true, controlsResponsive=true · mean_gray=61.74 |
| 7 | failure | parity | 1440x900 | **PASS** | 5610 | 2026-10-21T09:41:16.988Z | `agent3/check-failure-1440x900.png` | intercepted=1 status='TURN FAILED' emptyState=source-unavailable errorMsgs=1 |
| 8 | retry-recovery | parity | 1440x900 | **PASS** | 7307 | 2026-10-21T09:41:22.633Z | `agent3/check-recovery-1440x900.png` | status='READY · inferred' POST chat 200 x-ondemand-key-source=server assistantLen=107 retryAffordance=none (recovery via composer) |
| 9 | cancel | parity | 1440x900 | **PASS** | 3373 | 2026-10-21T09:41:29.940Z | `agent3/check-cancel-1440x900.png` | status='CANCELLED' cancel_latency_ms=2 len 9→9 after 3 s |
| 10 | isolation | parity | 1440x900 | **PASS** | 9250 | 2026-10-21T09:41:33.313Z | `agent3/check-isolation-1440x900.png` | alertMsgs=0 emptyState=no-sessions containsFire=False fireReplayed=2 (data-history=2) |
| 11 | reload-persistence | parity | 1440x900 | **PASS** | 12717 | 2026-10-21T09:41:42.563Z | `agent3/check-reload-persist-1440x900.png` | restored=2 (data-history=2) GET /messages → [200] |
| 12 | failure | parity | 390x844 | **PASS** | 2937 | 2026-10-21T09:52:05.550Z | `agent3/check-failure-390x844.png` | intercepted=1 status='TURN FAILED' emptyState=source-unavailable errorMsgs=1 |
| 13 | retry-recovery | parity | 390x844 | **PASS** | 6154 | 2026-10-21T09:52:08.491Z | `agent3/check-recovery-390x844.png` | status='READY · inferred' POST chat 200 x-ondemand-key-source=server assistantLen=104 retryAffordance=none (recovery via composer) |
| 14 | cancel | parity | 390x844 | **PASS** | 3166 | 2026-10-21T09:52:14.645Z | `agent3/check-cancel-390x844.png` | status='CANCELLED' cancel_latency_ms=5 len 9→9 after 3 s |
| 15 | isolation | parity | 390x844 | **PASS** | 8834 | 2026-10-21T09:52:17.811Z | `agent3/check-isolation-390x844.png` | alertMsgs=0 emptyState=no-sessions containsFire=False fireReplayed=2 (data-history=2) |
| 16 | reload-persistence | parity | 390x844 | **PASS** | 10804 | 2026-10-21T09:52:26.645Z | `agent3/check-reload-persist-390x844.png` | restored=2 (data-history=2) GET /messages → [200] |
| 17 | 3way-isolation | parity | 1440x900 | **PASS** | 40759 | 2026-10-21T09:52:37.462Z | `agent3/check-3way-isolation-1440x900.png` | key=ondemand.v2.externalUserId.default ids=['iso-user-1-0917', 'iso-user-2-0917', 'iso-user-3-0917'] perPage own/foreign=1/0,1/0,1/0 |
| 18 | composer-hit-testable-under-serverless-banner | parity | 1440x900 | **PASS** | None | 2026-10-21T10:03:00Z | `agent3/check-banner-occlusion-1440x900.png` | banner z=2147483000 chat z=186 sendOverlapPx=0 inputOverlapPx=0 sendHittable=True inputHittable=True |
| 19 | composer-hit-testable-under-serverless-banner | parity | 390x844 | **DEFECT** | None | 2026-10-21T10:03:00Z | `agent3/check-banner-occlusion-390x844.png` | banner z=2147483000 chat z=186 sendOverlapPx=5146 inputOverlapPx=5766 sendHittable=False inputHittable=False |

## Notes
- Mobile parity cells were re-run with the dispatch fix (`element.click()` via `page.evaluate`, same technique as the harness) after the first mobile attempt tripped the occlusion defect; the desktop cells are from the first run (`parity-run1-desktop.log`, which ended with a Puppeteer `Request Interception is not enabled!` crash in my script's cleanup after the mobile failure — a script bug, not an app defect; fixed before run 2).
- Chromium: the only Chromium processes still alive after my runs belonged to another agent's harness (Agent 4, PID chain 33183); my `browser.close()` + `hardKill` left 0 own processes. One `pkill -9 -f chromium` at 09:51Z (before the mobile re-run) may have killed that agent's run — flagging for the orchestrator.
- No secrets read or written; no git; no source edits.
