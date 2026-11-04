# Branding audit — legacy "God's Eye" residue, "GEV", and the current "OnDemand Spatial" brand strings

Branch: `integration/ondemand-native` · Tool: ripgrep 14.1.1 (case-insensitive, excluding `node_modules/`, `dist/`, `build/`, `package-lock.json`, `.git/`) · Fresh counts (the 2026-09-18 report in `docs/audit/rebrand-grep-report-2026-09-18.md` was read for category prior art only; every number below is from this run).

Mission target: a **neutral, configurable product name** — `PRODUCT_NAME` defaulting to **`OnDemand Intelligence Workstation`** — with **no user-facing "God's Eye" residue**. The replacement plan therefore covers BOTH the legacy marks and the hard-coded current brand (`OnDemand Spatial`), because the current brand is the string the token must replace on every user-visible surface.

---

## 1. Summary counts

### 1.1 Three sweeps (lines matched; one line may contain several marks)

| Sweep | Patterns | Line hits | Files |
|---|---|---|---|
| A — legacy marks | `God's Eye` / `God’s Eye` / `Gods Eye` / `gods-eye` / `godseye` (covers `GodsEye`, `godsEyeView`) / `gods_eye` (covers `GODS_EYE`) | **1,610** | **160** |
| B — `GEV` (word-boundary, upper-case, case-sensitive) | `\bGEV\b` | **111** | **40** |
| C — current brand | `OnDemand Spatial` / `ondemand-spatial` / `ondemand_spatial` / `OD Spatial` | **1,181** | **168** |
| **Union (A ∪ B ∪ C)** | | **2,902 lines (2,784 unique)** | **286 unique files** |

Per-pattern counts (case-insensitive `-F`, line hits): `God's Eye` 74 · `God’s Eye` (curly) 0 · `Gods Eye` 3 · `gods-eye` 161 · `godseye` 1,283 (of which `godsEyeView` 1,213, `GodsEye` 58) · `gods_eye` 128 (of which `GODS_EYE_FLOW_VERSION` 122). Lower-case `gev*` identifiers (`gevActions`, `gevRealtime`, `GevRealtimeController`, `gevLabelModel`, `gevTrackedId`, `GEV_RATELIMIT_*`, `GEV_ACTION_SCHEMAS`, `__gev_api_path`, `gev:*` storage keys …) total **2,133 lines / 304 files** and are **all internal identifiers** — they are listed in §3 and excluded from the user-facing table.

### 1.2 Sweep A (legacy) by category

| Category | Lines | Files | Verdict |
|---|---|---|---|
| Persisted / internal identifiers — `godsEyeView.*` localStorage keys, `window.__godsEyeView` debug handle, `godsEyeView_*` Cesium post-process stage names (mostly in `scripts/qa-*.mjs` and tests) | 1,210 | 90 | **KEEP** (storage compatibility, QA contract) |
| Env alias `GODS_EYE_FLOW_VERSION` | 122 | 29 | **KEEP as alias** (resolved alias-first; provisioned on the Vercel project) |
| Docs — history / evidence / rename notes | 119 | 24 | P1 docs (leave evidence verbatim; fix prose) |
| Frozen v1 workflow definition — `"God's Eye pipeline"` node prompts, `WORKFLOW_CREATED_AS = 'GodsEye Advanced Spatial Workflow'` | 73 | 23 | **KEEP byte-identical** (live workflow `6aace534859f7b0abb53d99a`; a prompt edit = v2 definition) — operator-only, never rendered |
| Registered client ids / User-Agents (`gods-eye-view-*-proxy/1.0`, `GodsEyeView/1.0`, `GodsEyeView/0.1`, `gods-eye-view-transit`, `Digitraffic-User: gods-eye-view`) | 32 | 19 | **KEEP** (operator-registered; renaming can break upstream allow-lists) |
| Docs — upstream repository references | 23 | 14 | P1 docs |
| Upstream repo refs in code / package metadata (`package.json` homepage/repository/bugs, UA `+https://github.com/bilawalsidhu/gods-eye-view`, licence URLs, README/CONTRIBUTING/SECURITY) | 20 | 10 | P1 — keep as *provenance*, but `package.json` + README should point at the fork once one exists |
| Tests / QA scripts (other) | 8 | 6 | internal |
| Rename-note comments (`server/ondemand/config.js:100`, `CHANGELOG.md:133`) | 2 | 2 | internal / docs |
| **User-facing UI text** | **1** | **1** | **P0** — `src/ui/templates/welcome.html:52` credit line "Built on **God's Eye View** by Bilawal Sidhu" |

### 1.3 Sweep B (`GEV`) by category

| Category | Lines | Verdict |
|---|---|---|
| User-facing UI text (`welcome.html:55` "Tip: the **GEV MIC** button…") | 1 | **P0** |
| Voice-model prompts / tool descriptions the end-user hears echoed (`server/providers/openai/instructions.js` ×4, `toolDescriptions.js` ×3, `src/voice/realtimeProtocol.js` ×4) | 11 | **P0** (the assistant may say "GEV" aloud) |
| Error strings that can surface in the UI/console (`'GEV voice is not connected'`, `'GEV command failed'`, `Unknown GEV tool`) | 3 | P0/P2 (console-level; low exposure) |
| Console log prefixes `[GEV Voice]`, `[GEV Realtime]`, `[GEV voice]` | 8 | P2 cosmetic |
| HTTP headers `X-GEV-Cache`, `X-GEV-Voice-Tier`, `X-GEV-Voice-Model`, `X-GEV-Voice-Tier-Fallback` | 10 | **KEEP** (API contract between proxy and client/tests) |
| Code comments (`// GEV addition …`, CSS comments) | 11 | P2 |
| Docs (README 3, TESTING 4, SECURITY 3, DATA_SOURCES 2, docs/* 23) | 35 | P1 |
| Tests (`*.test.mjs`) | 32 | internal |

### 1.4 Sweep C (current brand) by surface

| Surface | Lines | Files | Verdict |
|---|---|---|---|
| `docs/**` | 790 | ~120 | P1 (handover / registration / audit docs; evidence left verbatim) |
| `server/**` (incl. 181 lines in `*.test.mjs` across server+src) | 192 | — | mostly internal; **18** non-test prompt / name strings (see §2) |
| `src/**` | 107 | — | 7 user-facing (see §2), rest identifiers (`ondemand-spatial-entity-`, skill slugs, schema ids) |
| root (`README`, `CHANGELOG`, `package.json`, `.env.example`, `index.html`, `CONTRIBUTING`, `TESTING`, `SECURITY`, `DATA_SOURCES`) | 46 | 9 | 9 HTML-meta (P0), 3 package metadata (P0-adjacent), rest docs |
| `api/**` | 20 | 4 | comments / env names — internal |
| `scripts/**` | 13 | — | internal |
| `public/**` | 10 | 3 | 3 user-facing (`site.webmanifest` name/short_name, `logo.svg` `<title>`); 7 are `public/models/README.md` |
| `pinokio/**` | 3 | 2 | user-facing launcher title/button (P0) |

**Totals used in the plan:** **total occurrences (union) 2,902 lines in 286 files; user-facing occurrences 45 lines in 17 files** (table in §2).

---

## 2. Every user-facing occurrence

Proposed mechanism (single source of truth):

```js
// src/brand/productName.js  (browser)
export const PRODUCT_NAME =
  import.meta.env.VITE_PRODUCT_NAME || 'OnDemand Intelligence Workstation';
export const PRODUCT_SHORT_NAME =
  import.meta.env.VITE_PRODUCT_SHORT_NAME || 'OD Workstation';
export const PRODUCT_TAGLINE =
  import.meta.env.VITE_PRODUCT_TAGLINE || 'Spatial intelligence console';

// server/brand/productName.js  (Node / Vercel functions — mirror, same defaults)
export const PRODUCT_NAME =
  process.env.PRODUCT_NAME || 'OnDemand Intelligence Workstation';
```

Static files that cannot import a module (`index.html` `<title>`/meta, `public/brand/site.webmanifest`, `public/logo.svg`, `pinokio/pinokio.js`) are filled at **build time** by a tiny Vite `transformIndexHtml` plugin / `scripts/apply-product-name.mjs` that substitutes the `{{PRODUCT_NAME}}` token (or, for the manifest, writes it from the same default). Templates under `src/ui/templates/*.html` are already string-assembled at runtime, so `{{PRODUCT_NAME}}` can be substituted when they are injected.

| # | file:line | surface | matched text | user-facing | proposed replacement |
|---|---|---|---|---|---|
| 1 | `src/ui/templates/welcome.html:52` | first-run launcher — credit line | `Built on <a href="…bilawalsidhu/gods-eye-view">God's Eye View</a> by Bilawal Sidhu` | **Y** (legacy residue) | Move attribution out of the first-run screen into **About / Licences** panel and `NOTICE`: "Includes code from the God's Eye View project (MIT, © Bilawal Sidhu)". The first-run screen shows no legacy brand. |
| 2 | `src/ui/templates/welcome.html:55` | first-run status note (`role="status"`, `aria-live`) | `Tip: the GEV MIC button in the dock lets you talk to the map.` | **Y** (legacy) | `Tip: the MIC button in the dock lets you talk to the map.` |
| 3 | `index.html:6` | `<title>` | `OnDemand Spatial` | **Y** | `{{PRODUCT_NAME}}` |
| 4 | `index.html:7` | `<meta name="description">` | `OnDemand Spatial — real-time spatial intelligence console: …` | **Y** | `{{PRODUCT_NAME}} — real-time spatial intelligence console: …` |
| 5 | `index.html:8` | `<meta name="application-name">` | `OnDemand Spatial` | **Y** | `{{PRODUCT_NAME}}` |
| 6 | `index.html:11` | `og:site_name` | `OnDemand Spatial` | **Y** | `{{PRODUCT_NAME}}` |
| 7 | `index.html:12` | `og:title` | `OnDemand Spatial` | **Y** | `{{PRODUCT_NAME}}` |
| 8 | `index.html:13` | `og:description` | `OnDemand Spatial — real-time …` | **Y** | `{{PRODUCT_NAME}} — real-time …` |
| 9 | `index.html:16` | `twitter:title` | `OnDemand Spatial` | **Y** | `{{PRODUCT_NAME}}` |
| 10 | `index.html:17` | `twitter:description` | `OnDemand Spatial — real-time …` | **Y** | `{{PRODUCT_NAME}} — real-time …` |
| 11 | `src/ui/templates/scene-chrome.html:16` | header `<h1>` wordmark (`.brand-product`) | `OnDemand <span class="title-accent">Spatial</span>` | **Y** | `{{PRODUCT_NAME_HTML}}` — render `PRODUCT_NAME` with the last word in `.title-accent` (helper `splitProductName()`), so "OnDemand Intelligence **Workstation**" |
| 12 | `src/ui/templates/scene-chrome.html:17` | header subtitle | `SPATIAL INTELLIGENCE CONSOLE` | **Y** (tagline, not a mark) | `{{PRODUCT_TAGLINE}}` upper-cased via CSS (optional; neutral already) |
| 13 | `src/ui/templates/hud-loading.html:9` | loading screen `<h2>` | `OnDemand <span class="title-accent">Spatial</span>` | **Y** | `{{PRODUCT_NAME_HTML}}` (same helper as #11) |
| 14 | `public/brand/site.webmanifest:2` | PWA install name | `"name": "OnDemand Spatial"` | **Y** | generated from `PRODUCT_NAME` at build (`scripts/apply-product-name.mjs`) |
| 15 | `public/brand/site.webmanifest:3` | PWA short name | `"short_name": "OD Spatial"` | **Y** | `PRODUCT_SHORT_NAME` (default `OD Workstation`, ≤ 12 chars recommended → consider `Workstation`) |
| 16 | `public/logo.svg:2` | SVG `<title>` (accessible name of the legacy fallback mark; still referenced by `src/logoGaze.js:114` as default `data-logo-src`) | `OnDemand Spatial Intelligence (legacy mark)` | **Y** (only if the fallback renders) | `{{PRODUCT_NAME}}` — or delete `public/logo.svg` and change the fallback in `logoGaze.js` to `/brand/mark-light.svg` (see §4) |
| 17 | `src/serverlessMode.js:71` | in-app banner (serverless build) | `OnDemand Spatial is running as a serverless deployment: …` | **Y** | `` `${PRODUCT_NAME} is running as a serverless deployment: …` `` |
| 18 | `src/main.js:13` | boot-failure console error (visible in the error overlay) | `OnDemand Spatial initialization failed:` | Y (console) | `` `${PRODUCT_NAME} initialization failed:` `` |
| 19 | `src/voice/ondemand/pipeline.js:119` | OD VOICE system prompt (shapes what the user hears) | `You are the spoken assistant of the OnDemand Spatial globe.` | **Y** (spoken) | `` `You are the spoken assistant of the ${PRODUCT_NAME} globe.` `` |
| 20 | `src/voice/realtimeViewport.js:240` | Realtime viewport message (model input; echoed in replies) | `Current OnDemand Spatial viewport screenshot.` | Y (indirect) | `` `Current ${PRODUCT_NAME} viewport screenshot.` `` |
| 21 | `src/ondemand/entityContext.js:898` | entity-chat system preamble (OnDemand agent; may be quoted back) | `You are the OnDemand Spatial analyst embedded in a live 3D globe console.` | Y (indirect) | `` `You are the ${PRODUCT_NAME} analyst …` `` (and update the matching `startsWith` guard at `src/ondemand/entityChat.js:182`) |
| 22 | `server/providers/openai/instructions.js:8` | Realtime voice system prompt | `You are GEV Voice Control, a concise voice controller for a Cesium geospatial app called OnDemand Spatial.` | **Y** (spoken; both marks) | `` `You are the voice control for ${PRODUCT_NAME}, a Cesium geospatial app.` `` |
| 23 | `server/providers/openai/instructions.js:10` | voice prompt | `…as GEV control requests.` | Y (spoken) | `…as app control requests.` |
| 24 | `server/providers/openai/instructions.js:12` | voice prompt | `Call tools only for clear GEV control, navigation, …` | Y (spoken) | `…clear app control, navigation, …` |
| 25 | `server/providers/openai/instructions.js:60` | voice prompt (×2 on the line) | `…omit rangeM so GEV frames the whole country … so GEV chooses a close landmark view.` | Y (spoken) | `…so the app frames … so the app chooses …` |
| 26 | `server/providers/openai/toolDescriptions.js:4` | tool description (model-facing, echoed) | `Fly the OnDemand Spatial camera to …` | Y (indirect) | `` `Fly the ${PRODUCT_NAME} camera to …` `` |
| 27 | `server/providers/openai/toolDescriptions.js:20` | tool description | `GEV infers whole-place framing …` | Y (indirect) | `the app infers …` |
| 28 | `server/providers/openai/toolDescriptions.js:80` | tool description | `Enable or disable one registered OnDemand Spatial data layer.` | Y (indirect) | `` `…one registered ${PRODUCT_NAME} data layer.` `` |
| 29 | `server/providers/openai/toolDescriptions.js:106` | tool description | `Open or close a GEV UI panel/dropdown.` | Y (indirect) | `Open or close an app UI panel/dropdown.` |
| 30 | `server/providers/openai/toolDescriptions.js:147` | tool description | `Set the active OnDemand Spatial visual filter/style.` | Y (indirect) | `` `…active ${PRODUCT_NAME} visual filter/style.` `` |
| 31 | `server/providers/openai/toolDescriptions.js:152` | tool description | `Get current GEV scene context, …` | Y (indirect) | `Get current scene context, …` |
| 32 | `server/providers/openai/hud-summary.js:65` | HUD summary prompt (output rendered in the Intelligence HUD) | `Write one concise intelligence-HUD summary for OnDemand Spatial.` | **Y** (rendered) | `` `…summary for ${PRODUCT_NAME}.` `` |
| 33 | `src/voice/realtimeProtocol.js:113` | Realtime follow-up instruction (spoken) | `Briefly confirm any other completed GEV actions, then say "Turning on the radio."` | Y (spoken) | `…completed actions…` |
| 34 | `src/voice/realtimeProtocol.js:150` | Realtime instruction | `Answer the user naturally using the returned GEV entity context.` | Y (spoken) | `…the returned entity context.` |
| 35 | `src/voice/realtimeProtocol.js:158` | Realtime instruction | `Briefly summarize the current GEV camera, active style, …` | Y (spoken) | `…the current camera, …` |
| 36 | `src/voice/realtimeProtocol.js:202` | Realtime instruction | `Briefly confirm the completed GEV action once.` | Y (spoken) | `…the completed action once.` |
| 37 | `src/voice/realtimeTurns.js:88` | thrown error → voice status pill | `GEV voice is not connected` | Y (status text) | `Voice is not connected` |
| 38 | `src/voice/realtimeTurns.js:489` | tool-result error payload (model reads it back) | `GEV command failed` | Y (indirect) | `Command failed` |
| 39 | `src/voice/gevActions.js:1134` | thrown error | `Unknown GEV tool: ${name}` | Y (console / tool result) | `Unknown voice tool: ${name}` |
| 40 | `server/ondemand/capability-loop.js:209` | OnDemand gateway router prompt | `You are the capability router of the OnDemand Spatial intelligence gateway.` | Y (indirect) | `` `…of the ${PRODUCT_NAME} intelligence gateway.` `` |
| 41 | `server/ondemand/capability-loop.js:220` | OnDemand gateway analyst prompt (answer rendered in chat) | `You are the OnDemand Spatial intelligence analyst.` | **Y** (rendered) | `` `You are the ${PRODUCT_NAME} intelligence analyst.` `` |
| 42 | `pinokio/pinokio.js:3` | Pinokio launcher title | `title: "OnDemand Spatial"` | **Y** | `title: process.env.PRODUCT_NAME \|\| "OnDemand Intelligence Workstation"` (or build-time token) |
| 43 | `pinokio/pinokio.js:26` | Pinokio launcher button | `text: 'Open OnDemand Spatial'` | **Y** | `` `Open ${PRODUCT_NAME}` `` |
| 44 | `pinokio/_ENVIRONMENT:1` | Pinokio env file header comment (shown in Pinokio's env editor) | `# OnDemand Spatial works without any API keys.` | Y (low) | `# This app works without any API keys.` |
| 45 | `src/registry/capabilities.json:79` | attribution string rendered on the credit line for the demo timezone capability | `OnDemand Spatial demo.timezone (nautical zone estimate)` | Y (credit line) | `Demo timezone (nautical zone estimate)` — brand-free attribution |

**Not user-facing but brand-adjacent (package metadata, P0-adjacent):** `package.json:2` `"name": "ondemand-spatial"` (npm name — keep lowercase slug but neutralise: `ondemand-intelligence-workstation`), `package.json:5` description "OnDemand Spatial — …" → `OnDemand Intelligence Workstation — …`, `package.json:9/12/15` homepage/repository/bugs → `bilawalsidhu/gods-eye-view` (upstream; repoint to the fork). `vercel.json` carries **no brand string** (only the internal rewrite param `:__gev_api_path*` — keep). `scripts/check-brand-marks.mjs` checks *marks*, not names — no change needed, but add a sibling `scripts/check-product-name.mjs` that fails CI on literal `OnDemand Spatial` / `God's Eye` / `GEV MIC` in `index.html`, `src/ui/templates/**`, `public/brand/site.webmanifest`, `pinokio/**`.

Already brand-neutral (no action): `src/ui/templates/command-dock.html:101,107` (`aria-label="OnDemand voice…"` — company, not product), `src/ui/templates/layer-panels.html:33` (`Ask OnDemand about…`), `src/voice/ondemand/ui.js:36` kicker `OD VOICE` (company abbreviation; optional rename to `VOICE`).

---

## 3. Identifiers that must NOT be renamed

| Identifier family | Example(s) | Count (lines) | Reason |
|---|---|---|---|
| `godsEyeView.*` localStorage keys | `godsEyeView.sceneProject.v2`, `godsEyeView.sceneProject.checkpoint.v1` (`src/scenes/director.js:64-65`), `godsEyeView.v6.panelPos.*` / `panelCollapsed.*` (`src/ui/panelPositionControls.js:51-98`), `godsEyeView.cctv.calibration.v1/v2` (`src/layers/cctv/policy.js:77-82`), `godsEyeView.voiceCost.tier/limits` (`src/voice/realtimePreferences.js:11-13`), `godsEyeView.cockpitWeatherEffects.enabled` (`src/cockpitCloudEffects.js:13`) | 1,210 (incl. QA scripts) | **Storage compatibility** — renaming wipes saved scenes, layouts, calibrations and preferences. If ever migrated, do it with a read-old/write-new shim, never a rename. |
| `gev:*` localStorage / sessionStorage keys | `gev:first-run-mission:v1`, `gev:first-run-mission-session:v1` (`src/firstRunExperience.js:25-27`), `gev:layer-state:v2`, `gev:detection-allocation:v1` | part of 2,133 `gev*` lines | Storage compatibility (first-run gating, layer state). |
| `window.__godsEyeView` debug/QA handle | `src/app/tools.js:104-125`, `src/voice/ondemand/index.js:35`, `src/voice/realtimeViewport.js:15`, `src/voice/gevActions.js:3381,3446`, all `scripts/qa-*.mjs` | ~1,100 of the 1,210 | QA harness contract (dozens of Puppeteer scripts drive it). Cosmetic alias `window.__workstation` could be *added*, not swapped. |
| `godsEyeView_*` Cesium post-process stage names | `src/ui/visualEffects.js:64,102`, `src/layers/transit/selection.js:130` | 3 + QA | Stage names are looked up by QA scripts and by `removeStage` paths. |
| Registered client ids / User-Agents | `gods-eye-view-cctv-proxy/1.0` (`server/providers/cctv.js`, `cctv/sources.js`, `cctv/media.js`), `gods-eye-view-gbfs-proxy/1.0` (`server/providers/gbfs.js:62`), `gods-eye-view-transit` `ET-Client-Name` (`src/data/transitFeeds.js:245`), `gods-eye-view-transit-proxy/1.0` (`src/data/transitProxy.js:116`), `DIGITRAFFIC_USER = 'gods-eye-view'` (`server/providers/cctv/constants.js:145`), `GodsEyeView/1.0` Radio Browser UA (`server/providers/radio/constants.js:12`), `GodsEyeView/0.1` (`server/providers/regional/news.js:74,96`) | 32 | **Registered client id / upstream etiquette** — Entur, Digitraffic, Radio Browser allow-list or rate-limit by these names. Change only after re-registering with each operator. |
| Env alias `GODS_EYE_FLOW_VERSION` | `server/ondemand/config.js:357-359` (`FLOW_VERSION_ENV.alias`, resolved FIRST), `api/ondemand/health.js:117` allow-list regex, `api/ondemand/_config.js`, `.env.example:401-409` | 122 | **Already provisioned on the Vercel project** (env id `usC3wgbut65gTkaR`); canonical name is `ONDEMAND_SPATIAL_FLOW_VERSION`. Keep as alias; do not drop. |
| Env names `ONDEMAND_SPATIAL_FLOW_ID / WORKFLOW_ID / FLOW_VERSION / AGENT_ID / TOOL_ID` | `server/ondemand/config.js`, `api/ondemand/*`, `.env.example` | 174 (non-docs) | **Deployment contract** — set on the live Vercel project. If a neutral name is wanted later, add `WORKSTATION_*` as new canonical names with these kept as aliases (same alias-first pattern). |
| `WORKFLOW_CREATED_AS = 'GodsEye Advanced Spatial Workflow'` and the `"God's Eye pipeline"` node prompts | `server/ondemand/workflow-definition.js:66,361-433`, `docs/ondemand-workflows/ondemand-spatial-advanced-v1.json` | 73 | **Frozen v1 definition** of live workflow `6aace534859f7b0abb53d99a` (contract digest tested). Operator-only; never shown to end users. A neutral prompt set = v2 + live update. |
| `WORKFLOW_NAME = 'OnDemand Spatial Advanced Workflow'`, agent `OnDemand Spatial Intelligence Agent` | `server/ondemand/workflow-definition.js:48`, `src/registry/capabilities.json:125,134` | ~6 | Display names of **registered OnDemand platform objects**; renaming is a dashboard action, not a code change. |
| `ondemand-spatial-entity-<date>` / `ondemand-spatial-voice-<date>` externalUserId prefixes, `ondemand-spatial/entity-chat/1` schema id, `ondemand-spatial-*` skill slugs | `src/ondemand/entityChat.js:44`, `src/voice/ondemand/transport.js:90`, `src/ondemand/entityContext.js:23`, `src/registry/capabilities.json:143-194` | ~30 | API contract / session continuity with the OnDemand platform; slugs registered. |
| HTTP headers `X-GEV-Cache`, `X-GEV-Voice-Tier`, `X-GEV-Voice-Model`, `X-GEV-Voice-Tier-Fallback` | `server/providers/openai/realtime.js:143-146`, `src/voice/realtimeBackend.js:69-72`, `src/sources/transitService.js`, `src/data/transitProxy.js:300`, `server/providers/space/launch-library.js:64` | 10 | Proxy ↔ client contract, asserted by tests. |
| `__gev_api_path` rewrite param | `vercel.json` rewrites, `api/route.js` | internal | Vercel routing contract. |
| `gev*` code identifiers | `gevActions`, `gevRealtime`, `GevRealtimeController`, `gevLabelModel`, `gevTrackedId`, `gevDisplayPosition`, `GEV_RATELIMIT_OPENAI_PER_MIN`, `GEV_RATELIMIT_GOOGLE_PER_MIN` (env names!), `GEV_ACTION_SCHEMAS`, `GEV_REALTIME_TOOLS` | 2,133 | Internal symbols; `GEV_RATELIMIT_*` are **env var names** possibly set on the project — keep (alias if ever renamed). |
| Upstream URLs `https://github.com/bilawalsidhu/gods-eye-view` in UA strings & licence links | `server/providers/common/upstream.js:59`, `server/providers/regional/place.js:17-18`, `server/sources/demo-timezone.js:17`, `src/registry/capabilities.json:76` | 6 | Provenance / MIT attribution; keep until the fork has its own public URL, then update the `(+url)` part only. |

---

## 4. Asset inventory (`public/`)

All brand rasters/vectors are the **OnDemand company** lockup / mark (no "God's Eye" iconography, no product wordmark text) — they are **brand-agnostic with respect to the product name** and can be kept under a neutral product name.

| File | Dimensions / type | Bytes | Keep / replace |
|---|---|---|---|
| `public/brand/mark.svg` | 512-tile SVG icon (favicon svg) | 748 | **Keep** |
| `public/brand/mark-light.svg` / `mark-dark.svg` | 82.52² viewBox, bare mark | 653 / 653 | **Keep** (header + loading screen mark) |
| `public/brand/logo-light.svg` / `logo-dark.svg` / `logo-black.svg` | 272.8×82.5 viewBox lockup ("ON/DEMAND" wordmark — company, not product) | 3,888 each | **Keep** (unused in header since 2026-09-20; still valid for docs/OG) |
| `public/brand/logo-light.png` / `logo-dark.png` | 1200×363 RGBA | 45,495 / 43,223 | Keep |
| `public/brand/mark.png` | 512×512 RGBA | 20,872 | Keep |
| `public/brand/og-image.png` | 1200×630 RGB, lockup only, **no text** | 22,688 | Keep (no product name baked in → survives rename) |
| `public/brand/favicon.ico` | 3 icons 16/32/48 | 15,086 | Keep |
| `public/brand/favicon-16/32/48.png` | 16² / 32² / 48² RGBA | 579 / 1,150 / 1,759 | Keep |
| `public/brand/apple-touch-icon.png` | 180×180 RGBA | 6,791 | Keep |
| `public/brand/android-chrome-192.png` / `-512.png` | 192² / 512² RGBA | 7,290 / 20,872 | Keep |
| `public/brand/site.webmanifest` | JSON — `name: "OnDemand Spatial"`, `short_name: "OD Spatial"` | 410 | **Replace text** (generate from `PRODUCT_NAME` / `PRODUCT_SHORT_NAME`) |
| `public/brand/icons/*.svg` (66) + `icons.json`, `LICENSE`, `LICENSE-icons.md` | UI glyphs (Lucide) | — | Keep (not brand marks) |
| `public/logo.svg` | legacy fallback mark, `<title>OnDemand Spatial Intelligence (legacy mark)</title>`; only referenced as the default in `src/logoGaze.js:114` | 8,463 | **Replace/remove** — change the `logoGaze` fallback to `/brand/mark-light.svg` and delete, or retitle to `{{PRODUCT_NAME}}` |
| `public/location.svg`, `mic.svg`, `pin.svg`, `visual-presets.svg` | UI glyphs | 325–498 | Keep (no brand text) |
| `public/models/*.glb` + `README.md` | 3-D models; README mentions "OnDemand Spatial" ×7 in licence table | — | Keep assets; P1 docs text |

---

## 5. Vercel display names / public config (out-of-repo surfaces)

These names are not in source but are visible to anyone with the deployment URL or the Vercel dashboard; they are documented in `docs/audit/deployment-verification.md`, `docs/handover/ONDEMAND_SPATIAL_HANDOVER_2026-09-18.md`, `docs/registration/*` and `.env.example:268`:

| Surface | Value seen | Action |
|---|---|---|
| Vercel project name | `ondemand-eand-spatial` (team `schoolhack-web-team`) | Rename in dashboard to the neutral slug (e.g. `ondemand-intelligence-workstation`); project id is unchanged by rename |
| Second Vercel project | `ondemand-eand-spatial-jyxd` | Same — or delete if it is the stale duplicate the handover notes describe |
| Production alias domain | `ondemand-eand-spatial-opal.vercel.app` | Add a neutral alias; keep the old one redirecting |
| Other aliases seen in docs | `ondemand-eand-spatial.vercel.app`, `ondemand-eand-spatial-git-main-schoolhack-web-team.vercel.app`, per-deployment `ondemand-eand-spatial-<hash>-schoolhack-web-team.vercel.app` | Auto-derived from the project name; follow the rename |
| Vercel env | `GODS_EYE_FLOW_VERSION` (present), `ONDEMAND_SPATIAL_*` (present) | Keep; add `PRODUCT_NAME` / `VITE_PRODUCT_NAME` (optional — defaults cover it) |
| OnDemand platform objects | workflow `6aace534859f7b0abb53d99a` display name "OnDemand Spatial Advanced Workflow" (created as "GodsEye Advanced Spatial Workflow"), agent "OnDemand Spatial Intelligence Agent" | Dashboard display-name change only; ids unchanged |
| Pinokio directory listing | `pinokio.co/apps/github-com-bilawalsidhu-gods-eye-view` (upstream's listing) | Out of our control; README should stop pointing users at the upstream listing once the fork is published |

---

## 6. Prioritised replacement plan

| Priority | Scope | Lines | Files | Work |
|---|---|---|---|---|
| **P0 — user-visible** | §2 rows 1–45: first-run credit + "GEV MIC" tip (2 legacy), `index.html` title/meta ×8, header + loading wordmark ×2 (+ subtitle), `site.webmanifest` ×2, `public/logo.svg` title, serverless banner, boot error, voice/agent prompts & tool descriptions ×22, voice error strings ×3, Pinokio launcher ×3, credit-line attribution ×1 | **45** | **17** | Add `src/brand/productName.js` + `server/brand/productName.js`; Vite `transformIndexHtml` + manifest generation; `{{PRODUCT_NAME}}` in templates; `${PRODUCT_NAME}` in prompts; move credit to About/NOTICE; add `scripts/check-product-name.mjs` to `check:boundaries`. Update the snapshot tests that pin these strings (`src/firstRunExperience.test.mjs`, `src/ondemand/entityContext.test.mjs`, `src/voice/*.test.mjs`, `server/providers/openai/*.test.mjs`). |
| **P0-adjacent — package metadata** | `package.json` name/description/homepage/repository/bugs | 5 | 1 | `ondemand-intelligence-workstation` slug + neutral description; repoint URLs to the fork |
| **P1 — docs** | root docs (`README.md` 13 current + 5 legacy + 3 GEV, `CHANGELOG.md` 13 + 8, `TESTING.md` 1 + 4 GEV, `CONTRIBUTING.md` 4 + 2, `SECURITY.md` 1 + 1 + 3, `DATA_SOURCES.md` 2 + 1 + 2), `docs/**` (790 current + 142 legacy + 23 GEV), `public/models/README.md` 7, `.env.example` header | **≈ 1,030** | **≈ 135** | Rewrite prose in README/TESTING/CONTRIBUTING/SECURITY/DATA_SOURCES/`docs/BRANDING.md`/`docs/APPLICATION.md`/`docs/VOICE_MODE.md`; "GEV MIC" → "MIC" (TESTING ×4, README ×2). **Leave evidence files verbatim** (`docs/audit/*`, `docs/registration/*`, `docs/handover/*`, `docs/ondemand-workflows/*.json`) — they record live values; add a one-line "formerly OnDemand Spatial / God's Eye View" note in `docs/BRANDING.md`. |
| **P2 — internal cosmetic** | console prefixes `[GEV Voice]`/`[GEV Realtime]` ×8, code comments `// GEV addition` / CSS comments ×11, `OD VOICE` kicker (optional), `src/ui/applicationShell.js:33` docblock, `src/ui/styles/foundation.css:2` header, `WORKFLOW_CREATED_AS` rename-note comments ×2 | **≈ 25** | **≈ 14** | Optional; batch with the next refactor. Never touch §3 items. |
| **KEEP (no change)** | `godsEyeView.*` / `gev:*` storage keys, `__godsEyeView`, `godsEyeView_*` stages, client ids/UAs, `GODS_EYE_FLOW_VERSION` alias, `ONDEMAND_SPATIAL_*` env names, `GEV_RATELIMIT_*`, `X-GEV-*` headers, `__gev_api_path`, frozen v1 workflow prompts, platform object names, `ondemand-spatial-*` slugs/prefixes, `gev*` symbols | ≈ 1,800 (legacy/current) + 2,133 (`gev*`) | — | Documented in §3 |

Sequencing: P0 is one PR (config module + token substitution + test updates + CI guard, ~17 source files); P1 follows as a docs-only PR; P2 is opportunistic.

---

## Appendix — commands used

```sh
# ripgrep 14.1.1 (downloaded static binary; `rg` was not on PATH)
G='-g !node_modules -g !dist -g !package-lock.json -g !.git -g !build'

# A — legacy marks (case-insensitive; godseye covers GodsEye/godsEyeView, gods_eye covers GODS_EYE)
rg -i -n --no-heading $G -e "God['’]s Eye" -e "Gods Eye" -e "gods-eye" -e "godseye" -e "gods_eye" > legacy.txt
# B — GEV, word boundary, case-sensitive
rg -n --no-heading $G -w "GEV" > gev.txt
# B' — all gev* identifiers (classified internal)
rg -n --no-heading -i $G "\bgev" > gev_ci.txt
rg -i -o --no-heading $G '\bgev[A-Za-z_]*' | cut -d: -f2- | sort | uniq -c | sort -rn
# C — current brand
rg -i -n --no-heading $G -e "OnDemand Spatial" -e "ondemand-spatial" -e "ondemand_spatial" -e "OD Spatial" > current.txt
# per-pattern counts
for p in "God's Eye" "God’s Eye" "Gods Eye" "gods-eye" "godseye" "gods_eye"; do rg -i -c $G -F "$p" | awk -F: '{s+=$NF} END{print s+0}'; done
rg -c $G 'GodsEye'; rg -c $G 'GODS_EYE'; rg -c $G 'godsEyeView'; rg -c $G 'GODS_EYE_FLOW_VERSION'
# surfaces checked explicitly
rg -n -i -e 'OnDemand Spatial' -e 'OD Spatial' -e 'God' -e 'GEV' index.html src/ui/templates src/firstRunExperience*.js src/ui/*.js public/brand/site.webmanifest public/logo.svg pinokio vercel.json scripts/check-brand-marks.mjs server/providers/openai .env.example
rg -o $G 'ondemand-eand-spatial[a-z0-9.-]*' | cut -d: -f2- | sort | uniq -c | sort -rn
rg -o $G '\bONDEMAND_SPATIAL_[A-Z_]+' -g '!docs' | cut -d: -f2- | sort | uniq -c
# assets
cd public && for f in brand/*.png brand/*.ico brand/*.svg *.svg; do printf "%s | %s | %s\n" "$f" "$(stat -c%s "$f")" "$(file -b "$f")"; done
# union
cat legacy.txt gev.txt current.txt | wc -l; cat legacy.txt gev.txt current.txt | sort -u | wc -l; cat … | cut -d: -f1 | sort -u | wc -l
```

Raw sweep results (per-file counts) for Sweep A, top files: `scripts/qa-radio.mjs` 155, `scripts/track-regression.mjs` 117, `scripts/qa-cctv-v2.mjs` 61, `scripts/qa-map-source-tray.mjs` 50, `scripts/qa-cockpit-utility.mjs` 50, `scripts/qa-transit.mjs` 49, `scripts/qa-heading-b3.mjs` 36, `docs/audit/gate0-snapshot.md` 30, `scripts/qa-director-sharing.mjs` 29, `docs/audit/provider-hits.txt` 29 — all `__godsEyeView` / `godsEyeView.*` QA-contract identifiers (KEEP). By top-level directory: `scripts/` 1,115 · `docs/` 322 · `src/` 84 · `server/` 61 · root 20 · `api/` 8.

GENERATED_UTC: 2026-10-20T21:39:41Z
