# Agent 1 — sandbox-verify-2026-10-21 / retry-0917 — RESULTS

**Target:** `https://sb-4asza5droe1u.vercel.run` (sandbox `sbx_C7YcHpK0v9hb018cNsHaEObsAyvi`) · **Run window:** 2026-10-21T09:32:07Z → 2026-10-21T09:41:56Z (UTC) · **Drivers:** `scripts/qa-chat-intelligent-ui.mjs` (harness) and two focused Puppeteer scripts (`/tmp/agent1-parity-media.mjs`, `/tmp/agent1-occluder.mjs`) using the brief's sanctioned launch/hardKill/global-timeout block. Sandbox answered 200 throughout; no `SANDBOX_EXPIRED`.

**Summary — 11 cells: 8 PASS · 0 FAIL · 3 DEFECT · 0 UNSUPPORTED.** The harness passed scenarios A and B at both viewports (4/4, 22/22 checks) and all four PNGs are real app frames (mean grayscale 62–74, well above the ≈20 of the old loading-overlay capture). Streaming parity and HUD-summary parity PASS on desktop and mobile (server-held key, STOP visible during stream, READY status, no `ondemand.apiKey` in localStorage, `hudSummary` chat opens from `#hud-ask-ondemand`, no horizontal overflow at 390px). Two findings are reported as DEFECT with evidence and no fix attempted: (1) **deliverable media rendering** — the new requirement for document previews / image thumbnails + lightbox / video poster + side pane is **not implemented**: `renderAnswer()` in `src/ondemand/miniChat.js` emits plain `.od-chat__cite` anchors for every URL (verified live through the real SSE render path: 3 `<a>`, 0 `<img>`, 0 `<video>`, 0 lightbox at both viewports). The positive safety property holds — 0 `<video autoplay>` anywhere. (2) **mobile composer occlusion** — at 390x844 the serverless-notice banner (`src/serverlessMode.js`, `position:fixed; bottom:12px; z-index:2147483000`) sits on top of the mini-chat input and send button; a real touch tap on Send delivers nothing until the banner is dismissed (the streaming-parity PASS on mobile used a programmatic `.click()`, which bypasses hit-testing).

## 1. Harness — scenarios A, B × 1440x900, 390x844 (`ab/`, log `ab-run.log`, report `ab/chat-intelligent-ui.json`)

| Scenario | Viewport | Status | Started (UTC) | Duration | Screenshot | Evidence |
|---|---|---|---|---|---|---|
| A | 1440x900 | PASS | 2026-10-21T09:32:18.301Z | 400 ms | `agent1/ab/A-1440x900.png` (398,517 B, mean gray 62.33) | 6/6: app_boots, title "OnDemand Intelligence Workstation", no legacy brand terms, 2 `[data-brand-mark]`, `/api/health` 200 keySource=server, 33 contracts |
| B | 1440x900 | PASS | 2026-10-21T09:32:19.381Z | 5,308 ms | `agent1/ab/B-1440x900.png` (1,708,539 B, mean gray 68.62) | 5/5: mini chat opened `data-open="true"`, POST `/api/ondemand/v2/chat` 200 keySource=server |
| A | 390x844 | PASS | 2026-10-21T09:32:35.469Z | 195 ms | `agent1/ab/A-390x844.png` (350,192 B, mean gray 69.69) | 6/6 as above |
| B | 390x844 | PASS | 2026-10-21T09:32:36.946Z | 4,927 ms | `agent1/ab/B-390x844.png` (371,814 B, mean gray 74.01) | 5/5 as above |

Boot: loader hidden after 5,718 ms (desktop) / 6,010 ms (mobile). All four PNGs exist, are non-zero, and the A frames are not the loading overlay (mean > 40). Harness console errors (3) / failed requests (7) are the known benign ones: `GET /api/setup/status` 404 (serverless build), `POST /api/ondemand/v2/summaries/hud` aborted on viewport switch, `GET /api/ondemand/v2/messages?...` 404 for a fresh context key.

## 2. Parity checks (`/tmp/agent1-parity-media.mjs`, log `checks-run.log`, raw `checks.json`)

Same browser, one new page per viewport, boot wait on `#loading-screen.hidden` + `window.__godsEyeView.dataManager`. Chat opened via `gev:ask-object {objectType:'earthquake', objectId:'parity-eq-0917-<vp>-<tag>', label:'Parity Earthquake'}` (unique id per cell so history does not pre-populate the transcript).

| Check | Viewport | Status | Run at (UTC) | Duration | Screenshot | Evidence |
|---|---|---|---|---|---|---|
| streaming-parity | 1440x900 | PASS | 2026-10-21T09:40:49.439Z | 8,232 ms | `agent1/check-streaming-1440x900.png` | TTFT **3,693 ms**; STOP `#ondemand-mini-chat-stop` visible during stream = true (true at first token); POST `/api/ondemand/v2/chat` 200, `x-ondemand-key-source: server`; final status `READY · inferred`; `localStorage['ondemand.apiKey']` = null; assistant chars = 102; send/input hit-test clean (elementFromPoint hits the button/input) |
| hud-summary-parity | 1440x900 | PASS | 2026-10-21T09:40:50.934Z | 1,495 ms | `agent1/check-hud-summary-1440x900.png` | `#hud-summary` = "NORMAL STREET NEAR UT TOWER (AUSTIN) 2KM \| NORTH AMERICA \| ALT 627M \| …" (not "Awaiting telemetry…"); `#hud-ask-ondemand` present; chat opened with `data-object-type="hudSummary"`, kind label "HUD SUMMARY · global"; scrollWidth 1440 = innerWidth 1440 |
| streaming-parity | 390x844 | PASS (see occlusion DEFECT) | 2026-10-21T09:41:12.025Z | 7,956 ms | `agent1/check-streaming-390x844.png` | TTFT **3,350 ms**; STOP visible during stream = true; POST 200 `x-ondemand-key-source: server`; final status `READY · inferred`; `ondemand.apiKey` = null; assistant chars = 138. **Note:** elementFromPoint at the send button and input centre returned the serverless banner `<span>` (hitsButton=false, inputHit=false) — the message was sent via programmatic `.click()`, so the streaming pipeline itself is at parity but the real tap path is blocked (row 2.b below) |
| hud-summary-parity | 390x844 | PASS | 2026-10-21T09:41:13.369Z | 1,344 ms | `agent1/check-hud-summary-390x844.png` | `#hud-summary` populated ("NORMAL STREET NEAR UT TOWER (AUSTIN) 2KM \| …"); `#hud-ask-ondemand` present; chat opened `data-object-type="hudSummary"`, kind "HUD SUMMARY · global"; `documentElement.scrollWidth` 390 ≤ `innerWidth` 390 (no horizontal overflow) |

### 2.b Extra finding — mobile composer occluded by the serverless notice banner (`/tmp/agent1-occluder.mjs`, log `occluder-run.log`)

| Check | Viewport | Status | Run at (UTC) | Screenshot | Evidence |
|---|---|---|---|---|---|
| mobile-composer-occlusion | 390x844 | **DEFECT** | 2026-10-21T09:41:56Z | `agent1/check-mobile-send-occlusion-390x844.png` | With the mini chat open (panel rect 0,484,390×360), `document.elementsFromPoint` at the centre of `#ondemand-mini-chat-send` (205,801,166×32) and `#ondemand-mini-chat-input` (13,801,186×32) returns, top-down: `span` → `div[data-gev-serverless-notice]` (position:fixed; left/right 12px; bottom 12px; z-index 2147483000; rect 26,749,315×73) → then the button/input. Source: `src/serverlessMode.js` `installServerlessNotice()` (style list at L49–66). A real `page.touchscreen.tap` on the send button's centre delivered **no** message (user messages before=0, after=0). On desktop 1440x900 the banner (max-width 640px, centred) does not overlap the composer (x ≥ 1003), hit-test is clean. The earlier two runs of the parity script (09:35Z and 09:37Z) failed the mobile streaming/media cells for exactly this reason when using `page.click()`/`page.type()` (Puppeteer refuses or misses the obscured elements); switching to the harness's programmatic send made the pipeline checks pass, which is why the defect is reported separately. |

## 3. Scenario A deliverable media rendering audit (NEW requirement)

**Static read (read-only):** `src/ondemand/miniChat.js` `renderAnswer(node, text, document)` (≈L475–497) is the only answer renderer (called at L799/816/825/1155/1184/1274/1297). It splits text on markdown links / bare `https?://` URLs and, for every URL, creates `<a class="od-chat__cite" target="_blank" rel="noopener noreferrer">` with the host+path truncated to 60 chars; all other text becomes text nodes. There is no branch keyed on file extension or content type, no `<img>`, `<video>`, `<picture>`, `<dialog>`, lightbox, poster, or side-pane creation anywhere in `miniChat.js` (grep for `createElement('img'|'video'|'dialog')`, `lightbox`, `autoplay`, `poster`, `thumbnail`, `deliverable` → 0 hits). `src/ui/styles/ondemand-chat.css` contains only `.od-chat__cite` / `.od-chat__cite:hover` (L440–448) for links and no media/lightbox/thumbnail/pane rules.

**Live check through the real render path:** `page.setRequestInterception(true)` answered POST `/api/ondemand/v2/chat` with a synthetic `text/event-stream` (`event: session` → `event: message` fulfillment with the three deliverable URLs → `event: done`; headers `content-type: text/event-stream`, `x-ondemand-key-source: server`, `access-control-allow-origin: *`), then inspected the rendered `.od-chat__msg--assistant` node.

| Check | Scenario | Viewport | Status | Run at (UTC) | Duration | Screenshot | Evidence |
|---|---|---|---|---|---|---|---|
| media-rendering-audit | A | 1440x900 | **DEFECT** | 2026-10-21T09:40:54.763Z | 3,829 ms | `agent1/check-media-rendering-1440x900.png` (DOM dump `check-media-rendering-1440x900.html.txt`) | intercepted POST = 1; assistant node `od-chat__msg od-chat__msg--assistant`; `<a>` = 3 (all `.od-chat__cite`, `target=_blank`: `https://example.com/brief.pdf`, `https://example.com/figure.png`, `https://example.com/clip.mp4`), `<img>` = 0, `<video>` = 0, `<picture>` = 0, `<iframe>` = 0; lightbox/dialog inside node = 0; `[role=dialog]` in document = 1 (the chat panel `#ondemand-mini-chat` itself, not a lightbox); `[autoplay]` in node = 0, `video[autoplay]` in document = 0, `<video>` in document = 0; status `READY · inferred`. **media deliverables render as plain `.od-chat__cite` anchors; no thumbnail/lightbox/poster/side-pane implementation exists** — `src/ondemand/miniChat.js` `renderAnswer()`; `src/ui/styles/ondemand-chat.css` `.od-chat__cite`. Positive safety property holds: 0 `<video autoplay>` in the transcript. |
| media-rendering-audit | A | 390x844 | **DEFECT** | 2026-10-21T09:41:17.230Z | 3,861 ms | `agent1/check-media-rendering-390x844.png` (DOM dump `check-media-rendering-390x844.html.txt`) | Identical result: 3 `.od-chat__cite` anchors, 0 `<img>` / `<video>` / lightbox, 0 autoplay; same root cause and file pointers. |

Classification against the brief's three requirements: (i) document previews side by side — **absent** (PDF is a text anchor); (ii) images as inline thumbnails opening a lightbox — **absent** (PNG is a text anchor; no lightbox element exists); (iii) videos with a poster playing in a side pane, no autoplay in the transcript — **player/poster/side-pane absent**, but the "no autoplay" property is trivially satisfied (0 `<video>` elements). Nothing was modified.

## Totals

| Status | Count | Cells |
|---|---|---|
| PASS | 8 | harness A/B × 2 viewports, streaming-parity × 2, hud-summary-parity × 2 |
| FAIL | 0 | — |
| DEFECT | 3 | media-rendering-audit × 2 viewports, mobile-composer-occlusion (390x844) |
| UNSUPPORTED | 0 | — |

Machine-readable: `agent1/results.json` (11 entries; fields `check, scenario, viewport, status, duration_ms, run_at_iso8601, screenshot, evidence, url`).

Browser hygiene: every script ended with `browser.close()` + `hardKill()`; no Chromium owned by agent 1 remained after 09:41:56Z (`pgrep -f chromium` still lists processes, but they are children of `/tmp/agent3-parity.mjs`, another agent's run).
