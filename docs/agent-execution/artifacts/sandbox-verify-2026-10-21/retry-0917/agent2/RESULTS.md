# Agent 2 — sandbox-verify-2026-10-21 / retry-0917

- Target: `https://sb-4asza5droe1u.vercel.run` (sandbox `sbx_C7YcHpK0v9hb018cNsHaEObsAyvi`); `GET /` → 200 at 2026-10-21T09:32Z. No `SANDBOX_EXPIRED` during the run (09:32:28Z → 09:41:40Z).
- Drivers: `scripts/qa-chat-intelligent-ui.mjs` (task 1) and two focused Puppeteer scripts copied from the brief template (`agent2-checks.script.mjs`, `agent2-hittest.script.mjs`, copies kept here; run from the repo root with `/tmp/node_modules → repo node_modules` symlink). One Chromium at a time; every script ends with `browser.close()` + `hardKill()`. Chromium processes still alive at the end belong to sibling agents (parent = other agents' node scripts); none descend from agent2 scripts.
- Boot wait as per brief (loader hidden + `__godsEyeView.dataManager`): 10.0–10.5 s desktop, 9.7–10.5 s mobile.

## Summary: 15 PASS · 0 FAIL · 1 DEFECT (16 cells)

| # | Check | Scenario | Viewport | Status | Duration | Run at (UTC) | Screenshot | Evidence |
|---|-------|----------|----------|--------|----------|--------------|------------|----------|
| 1 | harness-scenario | C | 1440x900 | PASS | 9035 ms | 09:32:40.377Z | cd/C-1440x900.png (1,719,234 B, mean gray 69.42) | 2/2 checks; links=0, confidenceAttr=inferred, no empty state |
| 2 | harness-scenario | D | 1440x900 | PASS | 11 ms | 09:32:50.502Z | cd/D-1440x900.png (1,718,661 B, 69.40) | 4/4 checks; transcript messages=2 |
| 3 | harness-scenario | C | 390x844 | PASS | 8843 ms | 09:32:59.326Z | cd/C-390x844.png (325,585 B, 73.52) | 2/2 checks |
| 4 | harness-scenario | D | 390x844 | PASS | 25 ms | 09:33:08.509Z | cd/D-390x844.png (325,088 B, 73.50) | 4/4 checks; transcript messages=4 |
| 5 | loading-screen-backdrop | extra | 1440x900 | PASS | 2511 ms | 09:35:57.261Z | — | read while `#loading-screen` still visible: `linear-gradient(…), url("…/assets/brand/backdrop-network.png")` |
| 6 | citations-deep-check | extra | 1440x900 | PASS | 13910 ms | 09:36:07.395Z | check-citations-1440x900.png | status `READY · inferred` after 7.4 s; `a.od-chat__cite`=0; `#ondemand-mini-chat-sources` hidden, text `SOURCES · 0`; `data-confidence="inferred"`; no `.od-empty-state`; answer honestly states no sources/URLs available → honest state, no fabricated link |
| 7 | empty-state-no-sessions | extra | 1440x900 | PASS | 3748 ms | 09:36:21.305Z | check-empty-no-sessions-1440x900.png | `.od-empty-state--no-sessions` 406×155, text "No prior investigation for this object", `::before` bg = `url(…/assets/brand/empty-no-sessions.png)` |
| 8 | empty-state-source-unavailable | extra | 1440x900 | PASS | 2489 ms | 09:36:25.053Z | check-empty-source-unavailable-1440x900.png | POST /api/ondemand/v2/chat intercepted → 504 `{"error":"upstream_timeout"}`; `.od-chat__msg--error` "upstream_timeout (HTTP 504)", status `TURN FAILED`, `.od-empty-state--source-unavailable` present, `::before` bg = `url(…/empty-source-unavailable.png)` |
| 9 | root-first-responsive | extra | 1440x900 | PASS | 2502 ms | 09:36:27.542Z | check-rootfirst-1440x900.png | mini panel (990,449.5 432×362.5) does not intersect visible `[data-brand-mark]` (title-logo at 49,43 52×35); loader logo hidden |
| 10 | loading-screen-backdrop | extra | 390x844 | PASS | 2762 ms | 09:39:49.260Z | — | same `backdrop-network.png` reference while loader visible |
| 11 | citations-deep-check | extra | 390x844 | PASS | 10203 ms | 09:39:59.724Z | check-citations-390x844.png | `READY · inferred` after 7.0 s; cites=0; sources hidden `SOURCES · 0`; `data-confidence="inferred"`; no empty state; honest "can't reliably cite" answer |
| 12 | empty-state-no-sessions | extra | 390x844 | PASS | 1979 ms | 09:40:09.927Z | check-empty-no-sessions-390x844.png | 364×155, correct text, `::before` = `empty-no-sessions.png` |
| 13 | empty-state-source-unavailable | extra | 390x844 | PASS | 1148 ms | 09:40:11.907Z | check-empty-source-unavailable-390x844.png | 504 intercept → `TURN FAILED`, `.od-chat__msg--error` + `.od-empty-state--source-unavailable`, `::before` = `empty-source-unavailable.png` |
| 14 | root-first-responsive | extra | 390x844 | PASS | 1943 ms | 09:40:13.056Z | check-rootfirst-390x844.png | `scrollWidth`=390; `#ondemand-mini-chat-input` 13,800.7 186×32 inside viewport; mini panel 0,481.5 390×362.5 fits 390×844 |
| 15 | composer-pointer-hit-test | extra | 1440x900 | PASS | — | 09:41:26.185Z | check-send-hittest-1440x900.png | `elementFromPoint` at SEND/input centre returns the button/input; real `page.mouse.click` on SEND sends the message (msgs 0→2, status STREAMING…) |
| 16 | composer-pointer-hit-test | extra | 390x844 | **DEFECT** | — | 09:41:26.185Z | check-send-hittest-390x844.png | `elementFromPoint` at SEND centre (288,817) and input centre (106,817) returns the **serverless notice banner** (`div[data-gev-serverless-notice]`, `position:fixed; bottom:12px; z-index:2147483000`, text "OnDemand Intelligence Workstation is running as a serverless deployment…"); real `touchscreen.tap` on SEND does nothing (input keeps "hit test", status READY, no new message) |

## Defect D-A2-1 — serverless notice banner occludes the mini-chat composer at 390x844

- Where: `src/serverlessMode.js` `installServerlessNotice()` appends a fixed banner (`left/right:12px; bottom:12px; z-index:2147483000`) to `<body>`. On a 390×844 viewport the banner (~65 px tall, bottom 12 px) covers y≈767–832, exactly the mini-chat composer row (input + SEND at y 800.7–833). The panel's own stacking order is below the banner, so a real pointer/touch on SEND or the input hits the banner.
- Impact: on mobile the user cannot tap the input or SEND until the notice is dismissed (×). Programmatic `button.click()` (what the harness and the brief's open/send helper use) bypasses hit-testing, which is why scenarios C/D and checks 11–14 pass: the geometry checks of task 4 (input inside viewport, panel fits, no horizontal scroll) are all true, but the input is not *interactable*. Desktop is unaffected because the mini panel sits at x≥990, outside the banner's `max-width:640px` centred box.
- Evidence: `send-hittest.json` / `send-hittest.log`, `check-send-hittest-390x844.png` (banner visible over the composer). Dismissing the banner stores `sessionStorage` key and removes it, so a second-page-load repro needs a fresh context.
- Suggested fix (orchestrator): on narrow viewports place the notice at the top, or give it `bottom` = mini-chat height + gap while the mini chat is open, or lower its z-index below `#ondemand-mini-chat`, or auto-hide when `#ondemand-mini-chat[data-open="true"]`.

## Harness run notes (task 1)
- `cd-run.log`: 4/4 PASS; 4 non-zero PNGs; all mean grayscale 69–74 (> 40, not the loading overlay).
- Console errors (3) / failed requests (5) in the harness report are all `GET /api/setup/status` 404 (+ aborted retry) and one `GET /api/ondemand/v2/messages?…objectContextKey=earthquake:earthquakes-global` 404 — pre-existing, not part of the C/D assertions; not counted as defects here (reported for completeness).

## Script iterations (transparency)
- Run 1 (`checks-run.log`) and run 2 (`checks-run-2.log`) reported a false DEFECT/FAIL at 390x844 for citations/source-unavailable: my first script used `page.click('#ondemand-mini-chat-send')` (real pointer), which was swallowed by the banner (see D-A2-1), so the status matcher saw the pre-existing `READY`. Run 3 (`checks-run-3-mobile.log`, `checks-390x844.json`) switched to the brief's programmatic `send.click()` and a "new message appeared" guard; those are the mobile rows above. The discrepancy is what led to the hit-test check (rows 15–16).

Files: `results.json`, `RESULTS.md`, `cd/` (harness PNGs + `chat-intelligent-ui.json`), `check-*.png`, `checks.json`, `checks-390x844.json`, `send-hittest.json`, `*.log`, `agent2-*.script.mjs`.
