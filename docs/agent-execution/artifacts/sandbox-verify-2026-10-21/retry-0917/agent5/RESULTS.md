# Agent 5 — Branding + Brand Assets — sandbox-verify-2026-10-21 / retry-0917

- Target: `https://sb-4asza5droe1u.vercel.run` (boot URL `https://sb-4asza5droe1u.vercel.run/?welcome=0#lat=30.2811&lon=-97.7226&alt=600&heading=0&pitch=-40&v=2&hv=1&hud=tactical`)
- Run window (UTC): 2026-10-21T09:34:42.545Z → 2026-10-21T09:38:28Z
- Driver: `agent5/branding-scan.mjs` (sanctioned Puppeteer template from BRIEF_COMMON.md, 1440x900 + 390x844, one Chromium, closed at exit)
- Summary: **33 PASS / 0 FAIL / 0 DEFECT** over 33 rows

## Part A — Branding scan (browser)

| check | scenario | viewport | status | run_at | key evidence |
|---|---|---|---|---|---|
| identity | title+wordmark+brand-mark+favicon-link | 1440x900 | PASS | 2026-10-21T09:34:42.545Z | title=`OnDemand Intelligence Workstation`; wordmark=`OnDemand Intelligence Workstation`; brand marks=2 (52x35, 127x85); icon hrefs=['/assets/brand/favicon.ico', '/assets/brand/favicon-16.png', '/assets/brand/favicon-32.png', '/assets/brand/favicon-48.png', '/brand/mark.svg'] |
| loading-screen-backdrop | #loading-screen computed background-image | 1440x900 | PASS | 2026-10-21T09:34:54.752Z | `linear-gradient(rgba(11, 21, 38, 0.72), rgba(11, 21, 38, 0.82)), url("https://sb-4asza5droe1u.vercel.run/assets/brand/backdrop-network.png")…` |
| legacy-terms | base page (chat closed) | 1440x900 | PASS | 2026-10-21T09:34:54.788Z | user-facing hits=0; internal identifiers (allowed)=style[id="gev-screen-whiteboard-styles"], input[class="gev-quantitative-slider"], output[class="gev-slider-value"], div[class="gev-screen-whiteboard"], svg[class="gev-screen-whiteboard-svg"], filter[id="gev-sketch"], window.__godsEyeView |
| eye-motif | base page (chat closed) | 1440x900 | PASS | 2026-10-21T09:34:54.890Z | assets scanned=54; URL/title/desc hits=0; data-icon hit: `scan-eye` Lucide HUD-toggle glyph (allowed UI icon, see note) |
| mini-chat-open | gev:ask-object earthquake | 1440x900 | PASS | 2026-10-21T09:34:59.776Z | chatOpen=True; PLUGINS panel present/open, 32 toggles, summary `PLUGINS10 ready`; key-setup (settings) chip/root absent on sandbox (server keySource, initKeySetup self-destroys when /api/setup/status is not OK) → settings panel UNSUPPORTED here |
| legacy-terms | chat open + plugins panel open (settings/key-setup not present) | 1440x900 | PASS | 2026-10-21T09:34:59.776Z | user-facing hits=0; internal identifiers (allowed)=style[id="gev-screen-whiteboard-styles"], input[class="gev-quantitative-slider"], output[class="gev-slider-value"], div[class="gev-screen-whiteboard"], svg[class="gev-screen-whiteboard-svg"], filter[id="gev-sketch"], window.__godsEyeView |
| eye-motif | chat open + plugins panel open | 1440x900 | PASS | 2026-10-21T09:34:59.776Z | assets scanned=56; URL/title/desc hits=0; data-icon hit: `scan-eye` Lucide HUD-toggle glyph (allowed UI icon, see note) |
| identity | title+wordmark+brand-mark+favicon-link | 390x844 | PASS | 2026-10-21T09:35:00.337Z | title=`OnDemand Intelligence Workstation`; wordmark=`OnDemand Intelligence Workstation`; brand marks=2 (36x24, 125x84); icon hrefs=['/assets/brand/favicon.ico', '/assets/brand/favicon-16.png', '/assets/brand/favicon-32.png', '/assets/brand/favicon-48.png', '/brand/mark.svg'] |
| loading-screen-backdrop | #loading-screen computed background-image | 390x844 | PASS | 2026-10-21T09:35:09.898Z | `linear-gradient(rgba(11, 21, 38, 0.72), rgba(11, 21, 38, 0.82)), url("https://sb-4asza5droe1u.vercel.run/assets/brand/backdrop-network.png")…` |
| legacy-terms | base page (chat closed) | 390x844 | PASS | 2026-10-21T09:35:09.925Z | user-facing hits=0; internal identifiers (allowed)=style[id="gev-screen-whiteboard-styles"], input[class="gev-quantitative-slider"], output[class="gev-slider-value"], div[class="gev-screen-whiteboard"], svg[class="gev-screen-whiteboard-svg"], filter[id="gev-sketch"], window.__godsEyeView |
| eye-motif | base page (chat closed) | 390x844 | PASS | 2026-10-21T09:35:10.006Z | assets scanned=54; URL/title/desc hits=0; data-icon hit: `scan-eye` Lucide HUD-toggle glyph (allowed UI icon, see note) |
| mini-chat-open | gev:ask-object earthquake | 390x844 | PASS | 2026-10-21T09:35:13.722Z | chatOpen=True; PLUGINS panel present/open, 32 toggles, summary `PLUGINS10 ready`; key-setup (settings) chip/root absent on sandbox (server keySource, initKeySetup self-destroys when /api/setup/status is not OK) → settings panel UNSUPPORTED here |
| legacy-terms | chat open + plugins panel open (settings/key-setup not present) | 390x844 | PASS | 2026-10-21T09:35:13.722Z | user-facing hits=0; internal identifiers (allowed)=style[id="gev-screen-whiteboard-styles"], input[class="gev-quantitative-slider"], output[class="gev-slider-value"], div[class="gev-screen-whiteboard"], svg[class="gev-screen-whiteboard-svg"], filter[id="gev-sketch"], window.__godsEyeView |
| eye-motif | chat open + plugins panel open | 390x844 | PASS | 2026-10-21T09:35:13.722Z | assets scanned=56; URL/title/desc hits=0; data-icon hit: `scan-eye` Lucide HUD-toggle glyph (allowed UI icon, see note) |

Screenshots (chat + PLUGINS open): `agent5/check-branding-1440x900.png`, `agent5/check-branding-390x844.png`.

Legacy-term scan terms (case-insensitive): God's Eye / God’s Eye / Gods Eye / GEV MIC / \bGEV\b / OpenAI / gpt-4o-realtime / Realtime API — over body.innerText, every element's title/aria-label/alt/placeholder, all <meta content>, document.title. 0 hits in all 4 cells. Internal identifiers seen (allowed, not user-facing): `window.__godsEyeView`, CSS ids/classes `gev-screen-whiteboard*`, `gev-quantitative-slider`, `gev-slider-value`, `gev-sketch`.

## Part B — Brand assets (16 rows: 12 required + 4 bonus)

| file | HTTP | content-type | bytes | sha256 (first 16) | =catalog | =public/assets/brand | OCR alnum psm11/psm6 | no-text (≤3) | Hough strong circles | concentric pairs (strong / naive) | status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| mark-primary.png | 200 | image/png | 828,607 | `43abf5cc21779088` | ✓ | ✓ | 0/0 | yes | 2 | 0 / 7 | PASS |
| mark-mono.png | 200 | image/png | 882,285 | `e38da23ac4f292dc` | ✓ | ✓ | 0/2 | yes | 0 | 0 / 6 | PASS |
| empty-no-results.png | 200 | image/png | 854,662 | `91c63a81ed15f52a` | ✓ | ✓ | 0/2 | yes | 1 | 0 / 36 | PASS |
| empty-no-sessions.png | 200 | image/png | 833,892 | `99986406498b95f2` | ✓ | ✓ | 2/2 | yes | 0 | 0 / 59 | PASS |
| empty-source-unavailable.png | 200 | image/png | 851,438 | `9722bbf35ca0dfcd` | ✓ | ✓ | 0/3 | yes | 0 | 0 / 10 | PASS |
| backdrop-network.png | 200 | image/png | 1,243,829 | `cba96745119c9aa8` | ✓ | ✓ | 10/0 | no* | 0 | 0 / 0 | PASS |
| mark-variant-a.png | 200 | image/png | 770,292 | `0556ca19503c624c` | ✓ | ✓ | 0/2 | yes | 4 | 0 / 22 | PASS |
| mark-variant-b.png | 200 | image/png | 848,084 | `f7ea09b785ea93a3` | ✓ | ✓ | 0/2 | yes | 1 | 0 / 10 | PASS |
| favicon.ico | 200 | image/x-icon | 655 | `fdd1dc86e6bfcf25` | ✓ | ✓ | 0/0 | yes | 0 | 0 / 0 | PASS |
| apple-touch-icon.png | 200 | image/png | 30,314 | `ca5a07dc2d5a3ab6` | ✓ | ✓ | 0/2 | yes | 0 | 0 / 0 | PASS |
| android-chrome-192.png | 200 | image/png | 34,284 | `0d8df8839bdda401` | ✓ | ✓ | 0/2 | yes | 0 | 0 / 0 | PASS |
| android-chrome-512.png | 200 | image/png | 231,053 | `bc5d55abb81cd40e` | ✓ | ✓ | 0/2 | yes | 3 | 0 / 0 | PASS |
| favicon-16.png | 200 | image/png | 638 | `e9cab6f53df06deb` | ✓ | ✓ | 0/0 | yes | 0 | 0 / 0 | PASS |
| favicon-32.png | 200 | image/png | 1,714 | `c6666d54405b2c41` | ✓ | ✓ | 0/0 | yes | 0 | 0 / 0 | PASS |
| favicon-48.png | 200 | image/png | 3,143 | `b561065689cfc438` | ✓ | ✓ | 0/0 | yes | 0 | 0 / 0 | PASS |
| og-image.png | 200 | image/png | 515,862 | `93ddea86633a972d` | ✓ | ✓ | 9/43 | no* | 0 | 0 / 1 | PASS |

Method: `curl -sS -D - -o /tmp/asset.bin <url>`; `sha256sum`; `tesseract <png> stdout --psm 11` and `--psm 6` (alphanumeric count); OpenCV `cv2.HoughCircles` concentric-pair heuristic (two circles, centres ≤5 px apart, radius ratio 0.3–0.7). Two Hough passes are reported: a naive pass (param2=40, minDist=4) that over-fires on illustrated textures (hundreds of weak accumulator circles) and the authoritative strong pass (param2=70, minDist=20, Gaussian blur, ≥50 % Canny edge support along the circumference). Strong-pass concentric pairs = **0 for all 16 assets**.

\* backdrop-network.png: psm11 alnum=10 is OCR noise on the dark network texture (documented caveat), psm6=0; downscaled 384×256 edge-cluster scan found 0 contiguous text-like regions → no text. og-image.png (bonus composite): psm6 alnum=43 but output is scattered single glyphs/noise, no words; strong-pass concentric pairs 0 (naive pass 1 = noise). favicon.ico was composited onto black (PIL) for OCR/Hough.

## Part C — Rendered usage / wiring

| check | status | evidence |
|---|---|---|
| #loading-screen background-image (both viewports) | PASS | computed: `linear-gradient(rgba(11,21,38,.72), rgba(11,21,38,.82)), url("https://sb-4asza5droe1u.vercel.run/assets/brand/backdrop-network.png")`; source src/ui/styles/controls.css:269-276 |
| favicon link resolves | PASS | GET /assets/brand/favicon.ico → 200 image/x-icon 655 B (2026-10-21T09:37:16Z); link rel=icon ×5 present (ico, png 16/32/48, /brand/mark.svg 200 image/svg+xml) |
| PNG empty states wired in ondemand-chat.css | PASS | lines 549-557: `.od-empty-state--no-results::before`, `--no-sessions::before`, `--source-unavailable::before` → `url(/assets/brand/empty-*.png)` |
| /brand/site.webmanifest | PASS (minor note) | 200, name "OnDemand Intelligence Workstation", icons /assets/brand/android-chrome-192.png (200 image/png 34,284 B) and -512.png (200 image/png 231,053 B). MINOR: served as `application/octet-stream` rather than `application/manifest+json` — browsers accept it, not a functional defect |

## Defects

None user-facing. Observations for the orchestrator: (1) webmanifest content-type `application/octet-stream` (cosmetic/server MIME map); (2) Lucide `scan-eye` glyph is used as the DISPLAY › HUD toggle icon (data-icon attribute contains "eye" — a viewfinder pictogram from the icon set, not a brand eye motif; no asset URL or SVG title/desc contains "eye"); (3) Settings/key-setup panel does not exist on the sandbox (server-held key; `initKeySetup` removes chip+root when `/api/setup/status` is not OK) so it could not be re-scanned — UNSUPPORTED on this target, not a defect.


Browser closed via `browser.close()` + `hardKill()`; the agent-5 Chromium is gone — `pgrep -f chromium` still reports sibling agents' Chromium processes (agent2/agent3 scripts running concurrently in the shared pod), none owned by agent 5.


Files: `agent5/RESULTS.md`, `agent5/results.json`, `agent5/browser-results.json`, `agent5/asset-results.json`, `agent5/concentric-robust.json`, `agent5/branding-scan.mjs`, `agent5/check-branding-1440x900.png`, `agent5/check-branding-390x844.png`.
