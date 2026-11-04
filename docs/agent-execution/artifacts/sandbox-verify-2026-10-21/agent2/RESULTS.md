# Verification Report: Agent 2 (Scenarios C, D & Brand / Asset Checks)

**Target URL:** `https://sb-72vtzc1c6cf8.vercel.run`  
**Execution Timestamp:** 2026-10-21T08:02:08Z – 2026-10-21T08:18:17Z  
**Agent Role:** Verification Agent 2 of 5  
**Harnesses Used:**
1. `scripts/qa-chat-intelligent-ui.mjs` (Scenarios C, D on 1440×900 and 390×844)
2. `ui-validator` / `ui_validate.py` (DOM & branding assertions)
3. `/tmp/agent2-empty.mjs` (Dynamic empty-state and asset-interception verification)
4. Python 3 (HTTP checks, SHA-256 verification, Tesseract OCR, Pillow/numpy color analysis, OpenCV eye-motif heuristics)

---

## 1. Scenario Results (Scenarios C and D)

Harness run executed at `2026-10-21T08:02:08.763Z`. All 4 cells passed successfully.

| Scenario | Viewport | Status | Duration (ms) | Run At (ISO 8601 UTC) | Evidence & Checks | Screenshot |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **C** | 1440×900 | **PASS** | 8,699 ms | 2026-10-21T08:02:15.521Z | `citations_query_completed`: Turn completed within 90s.<br>`citations_or_honest_state`: links=0, sourcesVisible=false, confidenceAttr=inferred, emptyState=null. | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/cd/C-1440x900.png` |
| **D** | 1440×900 | **PASS** | 98 ms | 2026-10-21T08:02:27.088Z | `earthquake_history_available`: transcript messages=2.<br>`desktop_no_hud_brand_mark_overlap`: overlap=false against 2 brand mark(s).<br>`close_button_sets_closed`: Mini chat closed (data-open="false").<br>`reopen_restores_transcript`: Transcript replayed 2 messages upon reopen. | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/cd/D-1440x900.png` |
| **C** | 390×844 | **PASS** | 7,039 ms | 2026-10-21T08:02:36.371Z | `citations_query_completed`: Turn completed within 90s.<br>`citations_or_honest_state`: links=0, sourcesVisible=false, confidenceAttr=inferred, emptyState=null. | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/cd/C-390x844.png` |
| **D** | 390×844 | **PASS** | 161 ms | 2026-10-21T08:02:46.022Z | `earthquake_history_available`: transcript messages=4.<br>`mobile_viewport_fit_and_input_visible`: fitsViewport=true, inputVisible=true, noHScroll=true.<br>`close_button_sets_closed`: Mini chat closed (data-open="false").<br>`reopen_restores_transcript`: Transcript replayed 4 messages upon reopen. | `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/cd/D-390x844.png` |

---

## 2. Branding Verification

Validated via `ui_validate.py` (`a2-brand`) and `/tmp/agent2-empty.mjs`.

| Check / Requirement | Viewport 1440×900 | Viewport 390×844 | Status | Evidence / Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Document Title** | "OnDemand Intelligence Workstation" | "OnDemand Intelligence Workstation" | **PASS** | `document.title === 'OnDemand Intelligence Workstation'` evaluates true. |
| **Expected Product Text** | "OnDemand Intelligence" present | "OnDemand Intelligence" present | **PASS** | Found in `#title-bar [data-product-wordmark]`. |
| **Forbidden Terms** | Absent | Absent | **PASS** | Case-insensitive absence of "God's Eye", "GEV MIC", "Gods Eye", and "OpenAI" in `document.body.innerText`. |
| **Favicon Head Link** | Present (`/assets/brand/favicon.ico`) | Present (`/assets/brand/favicon.ico`) | **PASS** | `<link rel="icon" href="/assets/brand/favicon.ico" sizes="any">` confirmed in DOM. |
| **Brand Mark Render** | Rendered, tag: `svg`, 52×34.88px at (x:49, y:43) | Rendered, tag: `svg`, 36×24.14px at (x:29, y:25) | **PASS** | Non-zero bounding rect within title-bar header surface. |
| **No Eye Motif in DOM** | No eye motif in paths or attributes | No eye motif in paths or attributes | **PASS** | Evaluated `!/eye/i.test(...)` across all `img`, `svg`, and `style*=background-image` elements. |
| **Loading Backdrop Style** | Contains `/assets/brand/backdrop-network.png` | Contains `/assets/brand/backdrop-network.png` | **PASS** | `linear-gradient(rgba(11, 21, 38, 0.72), rgba(11, 21, 38, 0.82)), url("https://sb-72vtzc1c6cf8.vercel.run/assets/brand/backdrop-network.png")`. |

**Screenshots:**
- Full UI Desktop: `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/ui/a2-brand-1440x900.png`
- Full UI Mobile: `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/ui/a2-brand-390x844.png`
- Backdrop Desktop: `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/check-backdrop-1440x900.png`
- Backdrop Mobile: `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/check-backdrop-390x844.png`

---

## 3. Brand Assets HTTP, SHA-256 & Visual Inspection

Tested all 12 brand asset paths via HTTP `curl -s -D - -o /tmp/a2-<name>`. Compared SHA-256 against `docs/agent-execution/BRAND_ASSETS.md` catalog and attached media originals at `.media/{8dxSOsnbYr.png, QUKWX8jhhC.png, p2UMfLtxCv.png}`.

### Brand Asset Table

| Asset Path | HTTP Status | Content-Type | Bytes | SHA-256 Match (Catalog / Original) | Rendered Desktop | Rendered Mobile | OCR Noise String (psm 11 / psm 6) | No-Text / No-Eye Verdict | Screenshot |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/assets/brand/backdrop-network.png` | 200 | `image/png` | 1,243,829 | Catalog: **MATCH** (`cba96745...`)<br>Original: N/A | **YES** (`#loading-screen` background-image) | **YES** (`#loading-screen` background-image) | psm 11: 10 alnum (`Ta me ke < ax > eo`)<br>psm 6: 0 alnum (`""`) | **FAIL** on strict automated OCR threshold (10 alnum chars noise from graph nodes/lines); **PASS** on visual inspection (abstract network constellation graph; no text; no eye motif) | `check-backdrop-1440x900.png`<br>`check-backdrop-390x844.png` |
| `/assets/brand/empty-no-results.png` | 200 | `image/png` | 854,662 | Catalog: **MATCH** (`91c63a81...`)<br>Original: N/A | **YES** (`.od-empty-state--no-results::before`) | **YES** (`.od-empty-state--no-results::before`) | psm 11: 0 alnum (`""`)<br>psm 6: 2 alnum (`ee =`) | **PASS** (noise ≤ 3 chars; 0 concentric circles) | `check-empty-no-results-1440x900.png`<br>`check-empty-no-results-390x844.png` |
| `/assets/brand/empty-no-sessions.png` | 200 | `image/png` | 833,892 | Catalog: **MATCH** (`99986406...`)<br>Original: **MATCH** (`p2UMfLtxCv.png`) | **YES** (`.od-empty-state--no-sessions::before`) | **YES** (`.od-empty-state--no-sessions::before`) | psm 11: 2 alnum (`an`)<br>psm 6: 2 alnum (`(og`) | **PASS** (noise ≤ 3 chars; 0 concentric circles; palette verified) | `check-empty-no-sessions-1440x900.png`<br>`check-empty-no-sessions-390x844.png` |
| `/assets/brand/empty-source-unavailable.png` | 200 | `image/png` | 851,438 | Catalog: **MATCH** (`9722bbf3...`)<br>Original: N/A | **YES** (`.od-empty-state--source-unavailable::before`) | **YES** (`.od-empty-state--source-unavailable::before`) | psm 11: 0 alnum (`-----`)<br>psm 6: 3 alnum (`Sre`) | **PASS** (noise ≤ 3 chars; 0 concentric circles) | `check-empty-source-unavailable-1440x900.png`<br>`check-empty-source-unavailable-390x844.png` |
| `/assets/brand/mark-primary.png` | 200 | `image/png` | 828,607 | Catalog: **MATCH** (`43abf5cc...`)<br>Original: N/A | **Not rendered directly in UI** (feeds `og-image.png` composite for social preview; UI uses `/brand/mark-light.svg`) | **Not rendered directly in UI** | psm 11: 0 alnum (`<>`)<br>psm 6: 0 alnum (`""`) | **PASS** (noise ≤ 3 chars; 0 concentric circles) | N/A (asset file verified) |
| `/assets/brand/mark-mono.png` | 200 | `image/png` | 882,285 | Catalog: **MATCH** (`e38da23a...`)<br>Original: N/A | **Not rendered directly in UI** (source asset used to generate `favicon.ico`, `favicon-*.png`, `apple-touch-icon.png`) | **Not rendered directly in UI** | psm 11: 0 alnum (`""`)<br>psm 6: 2 alnum (`Bi`) | **PASS** (noise ≤ 3 chars; 0 concentric circles) | N/A (asset file verified) |
| `/assets/brand/mark-variant-a.png` | 200 | `image/png` | 770,292 | Catalog: **MATCH** (`0556ca19...`)<br>Original: **MATCH** (`8dxSOsnbYr.png`) | **Not rendered in UI** (alternate candidate mark asset in static brand library) | **Not rendered in UI** | psm 11: 0 alnum (`""`)<br>psm 6: 2 alnum (`cs`) | **PASS** (noise ≤ 3 chars; 0 concentric circles) | N/A (asset file verified) |
| `/assets/brand/mark-variant-b.png` | 200 | `image/png` | 848,084 | Catalog: **MATCH** (`f7ea09b7...`)<br>Original: **MATCH** (`QUKWX8jhhC.png`) | **Not rendered in UI** (alternate candidate mark asset in static brand library) | **Not rendered in UI** | psm 11: 0 alnum (`""`)<br>psm 6: 2 alnum (`cs`) | **PASS** (noise ≤ 3 chars; 0 concentric circles) | N/A (asset file verified) |
| `/assets/brand/favicon.ico` | 200 | `image/x-icon` | 655 | Catalog: **MATCH** (`fdd1dc86...`)<br>Original: N/A | **YES** (browser tab / bookmark icon via `<link rel="icon">`) | **YES** | N/A (derived icon) | **PASS** | N/A |
| `/assets/brand/favicon-32.png` | 200 | `image/png` | 1,714 | Catalog: **MATCH** (`c6666d54...`)<br>Original: N/A | **YES** (head link `sizes="32x32"`) | **YES** | psm 11: 0, psm 6: 1 (`&`) | **PASS** | N/A |
| `/assets/brand/apple-touch-icon.png` | 200 | `image/png` | 30,314 | Catalog: **MATCH** (`ca5a07dc...`)<br>Original: N/A | **YES** (head link `<link rel="apple-touch-icon">`) | **YES** (iOS bookmark/home screen icon) | psm 11: 0, psm 6: 2 (`Ss`) | **PASS** | N/A |
| `/brand/mark-light.svg` | 200 | `image/svg+xml` | 653 | Source: **MATCH** (`ee640260...`)<br>Catalog: N/A | **YES** (renders inside `#title-bar` and `#loading-screen`) | **YES** (renders inside `#title-bar`) | SVG vector markup (no text nodes) | **PASS** | `a2-brand-1440x900.png`<br>`a2-brand-390x844.png` |

---

## 4. In-Depth Image & Heuristic Analysis

### A. Palette & Color Quantization (Pillow + numpy)
- **`empty-no-sessions.png`**:
  - Image size: 1024×1024
  - Mode background color: `#071226` (RGB `[7, 18, 38]`).
  - Target background: `#0B1526` (RGB `[11, 21, 38]`). Channel difference: `[4, 3, 0]` (within tolerance ±20: **PASS**).
  - Slate stroke pixels (near `#8A94A6` ±40): **16,097 pixels** (present: **PASS**).
  - Emerald accent pixels (near `#0AC985` ±40): **1,042 pixels** (present: **PASS**).
  - Distinct colors (16-level quant): 90 levels.
- **Other PNG Mode Backgrounds**:
  - `backdrop-network.png`: `#071123` (80 quant levels)
  - `empty-no-results.png`: `#071124` (94 quant levels)
  - `empty-source-unavailable.png`: `#081226` (164 quant levels)
  - `mark-primary.png`: `#071025` (67 quant levels)
  - `mark-mono.png`: `#071226` (68 quant levels)
  - `mark-variant-a.png`: `#FEFEFE` (148 quant levels)
  - `mark-variant-b.png`: `#070A11` (73 quant levels)

### B. Eye-Motif Heuristic (OpenCV HoughCircles & Concentric Circles)
- All 8 generated PNGs downscaled to 256px, converted to grayscale, Gaussian blurred (9×9, σ=2), and evaluated via `cv2.HoughCircles` (param1=50, param2=30, minRadius=10, maxRadius=120).
- Any circle pairs with concentric centers (center distance < 8px, radius difference > 15px) were checked.
- **Result:** **0 concentric pairs found across all 8 assets**. None of the assets contain an eye or iris/pupil central disc structure.

---

## 5. Empty States In-Browser Verification (`empty-states.json`)

Verified live inside Chromium using dynamic dispatch and route interception at both viewports:
1. **`no-sessions` Empty State**:
   - Dispatched `gev:ask-object` for a fresh alert object (`a2-fresh-...`).
   - `.od-empty-state[data-empty-state="no-sessions"]` appeared.
   - Text: `"No prior investigation for this object"`.
   - Element `::before` computed `backgroundImage`: `url("https://sb-72vtzc1c6cf8.vercel.run/assets/brand/empty-no-sessions.png")`.
   - Dimensions & Viewport:
     - 1440×900: 406×155px at (1003, 562), inside viewport (**PASS**).
     - 390×844: 364×155px at (13, 594), inside viewport (**PASS**).
2. **`no-results` Empty State**:
   - Intercepted `POST /api/ondemand/v2/chat` returning 200 with empty SSE body (`event: session\ndata: ...\n\nevent: done\ndata: {}\n\n`).
   - Sent message; `.od-empty-state[data-empty-state="no-results"]` appeared.
   - Text: `"No results from the selected sources"`.
   - Element `::before` computed `backgroundImage`: `url("https://sb-72vtzc1c6cf8.vercel.run/assets/brand/empty-no-results.png")`.
   - Dimensions & Viewport:
     - 1440×900: 406×155px at (1003, 562), inside viewport (**PASS**).
     - 390×844: 364×155px at (13, 594), inside viewport (**PASS**).
3. **`source-unavailable` Empty State**:
   - Intercepted `POST /api/ondemand/v2/chat` returning 502 with JSON `{"error":"upstream_unavailable"}`.
   - Sent message; error message rendered with `.od-chat__msg--error` and empty state `.od-empty-state[data-empty-state="source-unavailable"]`.
   - Text: `"upstream_unavailable (HTTP 502)"`.
   - Element `::before` computed `backgroundImage`: `url("https://sb-72vtzc1c6cf8.vercel.run/assets/brand/empty-source-unavailable.png")`.
   - Both viewports rendered and confirmed.

---

## 6. Summary of Artifacts Created

All artifacts reside under `docs/agent-execution/artifacts/sandbox-verify-2026-10-21/agent2/`:
- `cd/C-1440x900.png` (Scenario C desktop screenshot)
- `cd/C-390x844.png` (Scenario C mobile screenshot)
- `cd/D-1440x900.png` (Scenario D desktop screenshot)
- `cd/D-390x844.png` (Scenario D mobile screenshot)
- `cd/chat-intelligent-ui.json` (Scenario C & D test run report)
- `cd-run.log` (Harness execution log)
- `ui/a2-brand-1440x900.png` (`ui_validate.py` desktop proof)
- `ui/a2-brand-390x844.png` (`ui_validate.py` mobile proof)
- `check-backdrop-1440x900.png` (Loading screen backdrop desktop proof)
- `check-backdrop-390x844.png` (Loading screen backdrop mobile proof)
- `check-empty-no-sessions-1440x900.png` (no-sessions empty state desktop proof)
- `check-empty-no-sessions-390x844.png` (no-sessions empty state mobile proof)
- `check-empty-no-results-1440x900.png` (no-results empty state desktop proof)
- `check-empty-no-results-390x844.png` (no-results empty state mobile proof)
- `check-empty-source-unavailable-1440x900.png` (source-unavailable empty state desktop proof)
- `check-empty-source-unavailable-390x844.png` (source-unavailable empty state mobile proof)
- `empty-states.json` (Empty states test run report)
- `RESULTS.md` (This report)

GENERATED_UTC: 2026-10-21T08:26:00Z
