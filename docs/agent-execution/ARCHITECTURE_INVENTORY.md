# Architecture Inventory — gods-eye-view (`integration/ondemand-native`)

Read-only, evidence-based inventory. Every claim cites `file:line` in this repository
(`gods-eye-view`, package name `ondemand-spatial`, `package.json:2`). Counts exclude `node_modules/` and `dist/`.

---

## 1. Runtime & framework

| Item | Fact | Evidence |
|---|---|---|
| Node engine | `>=24.14.0 <25 \|\| >=26 <27` | `package.json:18` |
| Module type | ESM (`"type": "module"`) | `package.json:5` |
| Vite | declared `^6.0.0`; installed `6.4.3` | `package.json:166`; `node_modules/vite/package.json:3` |
| Vite config | root `vite.config.js` re-exports `server/standalone/vite.config.js` and re-exports all provider plugins from `server/providers/local.js` | `vite.config.js:1-3` |
| Cesium plugin | `vite-plugin-cesium ^1.2.23` | `package.json:167` |
| Frontend framework | **None — vanilla JS.** No `react`, `vue`, `svelte`, `lit`, `preact` in `dependencies` or `devDependencies` | `package.json:153-169` |
| Runtime deps | `@mapbox/vector-tile`, `cesium ^1.124.0`, `egm96-universal`, `mgrs`, `pbf`, `satellite.js` | `package.json:153-160` |
| Languages | `.js`: 778 files, `.mjs`: 483 files, `.ts`: **0** (no TypeScript anywhere; no `tsconfig.json`) | `find` count; `ls tsconfig.json` → not found |
| Test runner | Node built-in `node:test`; orchestrated by `scripts/run-unit-tests.mjs` (`npm test`); plus `test:serverless` (`node --test server/serverless/*.test.mjs`) and `test:ondemand` (`node --test server/ondemand/*.test.mjs`) | `package.json:36-38`; `scripts/run-unit-tests.mjs:1-15` |
| Test files | 373 `*.test.mjs` under `src/`, `server/`, `api/`, `scripts/` | `find` count |
| Formatting | Prettier `3.9.6` via `scripts/format.mjs` (`format`, `format:check`); config `.prettierrc.json` (`singleQuote`, `tabWidth: 2`, `semi`, `lf`) | `package.json:30-31,163`; `.prettierrc.json:1-6` |
| ESLint | **NO** — no `.eslintrc*`, no `eslint.config.*`, no `eslint` dependency | `ls` → not found; `package.json:161-169` |
| Typecheck | **NO** — no `tsconfig.json`, no `tsc`/`typecheck` script | `package.json:28-48` |
| Boundary checks | `check:boundaries` = `check-import-directions.mjs && check-package-boundaries.mjs && check-brand-marks.mjs` | `package.json:45` |
| Package `exports` map | Large subpath export map (≈150 entries) used by boundary checks | `package.json:170-...` |

---

## 2. Frontend

### Entry
- `index.html:55` — `<script type="module" src="/src/main.js">` (single entry; SPA fallback rewrite in `vercel.json` rewrite #2).
- `src/main.js:1-4` imports `createStandaloneApplication` (`src/standalone/application.js`), `describeError`, `installServerlessNotice` (`src/serverlessMode.js`), and `installOndemandVoice` (`src/voice/ondemand/index.js`).
- `src/main.js:7-9` reads `import.meta.env.GOOGLE_MAPS_API_KEY`, `import.meta.env.CESIUM_ION_TOKEN`, `import.meta.env.DEV`.
- `src/standalone/application.js:4,28` composes `createApplication` from `src/app/application.js` with standalone catalog/scene/controls/data/tools (`src/standalone/application.js:1-8`).

### Top-level `src/` directories (file counts incl. tests)

| Dir | Files | Purpose (one line) |
|---|---|---|
| `src/annotations/` | 16 | Screen/scene annotation engine + rAF renderer (`annotationEngine.js`, `screenAnnotationRenderer.js`) |
| `src/app/` | 44 | Application composition: `application.js`, `viewer.js`, scene/controls/data/tools/catalog |
| `src/brand/` | 1 | Brand mark constants |
| `src/data/` | 274 | Data sources/proxies, context store, local GeoJSON, transit, regional model |
| `src/director/` | 25 | Scene playback / director |
| `src/layers/` | 267 | Per-layer modules (flights, military, vessels, earthquakes, firms, satellites, launches, installations, awareness, traffic, bikeshare, directions, cctv, alpr, radio, submarineCables, transit, aircraft) |
| `src/maps/` | 11 | Imagery/terrain/Google 3D catalog + controller |
| `src/ondemand/` | 8 | OnDemand entity/camera chat client (`entityChat.js`, `entityContext.js`, `cameraContext.js`) + tests incl. `noKeyInBundle.test.mjs` |
| `src/overlays/` | 8 | 2D world overlay canvas + allocation probe |
| `src/registry/` | 1 | Registry |
| `src/scenes/` | 21 | Scene director, camera motion |
| `src/search/` | 15 | Place search (Nominatim) |
| `src/services/` | 7 | Application services / request layer |
| `src/sources/` | 25 | Fetch adapters (overpass, nominatim, radio-browser, transit, http-body) |
| `src/standalone/` | 12 | Standalone (non-embedded) application wiring |
| `src/styles/` | 6 | Styles |
| `src/testSupport/` | 4 | Test helpers |
| `src/tooling/` | 33 | Tooling tests/harness |
| `src/ui/` | 135 | Panels, rails, HUD, cockpit, layers tray, map source, shell |
| `src/voice/` | 42 | Voice: OpenAI Realtime controller/session (`realtimeController.js`, `realtimeSession.js`) and `src/voice/ondemand/` (OnDemand STT/TTS pipeline) |

### State management
- No store library. A window-scoped singleton plain-object store: `src/data/contextStore.js:1-15` (`window.__gevContextStore` holding `entities: Map`, `selectedEntityId`, `selectedAt`).
- Per-module closures and factory functions (`createApplication`, `createStandalone*`) — `src/standalone/application.js:1-28`.

### Rendering
- Cesium `Viewer` created in `src/app/viewer.js:4-7` (`new Cesium.Viewer(container, {...})`).
- 2D canvas world overlay in `src/overlays/worldOverlay.js`; scope mask paint coalescing in `src/scopeMask.js:120-225` (`_coalescingPaint` flag; `draw()` defers to a single paint).

### Chat / voice UI modules
- `src/ondemand/entityChat.js` — entity chat client; constants `API_KEY_STORAGE_KEY = 'ondemand.apiKey'` (`:41`), `API_KEY_HEADER = 'x-ondemand-key'` (`:42`); injectable `fetch`/`localStorage` deps (`:486-491`).
- `src/ondemand/cameraContext.js`, `src/ondemand/entityContext.js` — context builders.
- `src/voice/ondemand/index.js` (installer), `audio.js`, `intents.js`, `pipeline.js`, `transport.js`, `ui.js`.
- `src/voice/ondemand/transport.js:33-37` — endpoint table: `/api/ondemand/media`, `/stt`, `/tts`, `/sessions`, `/chat`; `:8-14` documents the request shapes (chat uses `responseMode:'stream'` → SSE; workflow via `/api/ondemand/workflow/execute|status|logs|outputs`); `:28-29,76` reads `localStorage['ondemand.apiKey']` and sends `x-ondemand-key`.

### rAF coalescing / virtualized rendering / scroll anchoring
- `requestAnimationFrame` used in 35 files under `src/` (e.g. `src/scenes/cameraMotion.js`, `src/annotations/screenAnnotationRenderer.js`, `src/annotations/annotationEngine.js`, `src/layers/awareness/rendering.js`, `src/layers/cctv/projection.js`) — **none in `src/ondemand/` or `src/voice/ondemand/`** (grep returned 0 hits there).
- "coalesc": `src/scopeMask.js:120-225` (paint coalescing), `src/sources/httpBody.js`, `src/sources/transitService.js`, `src/layers/transit/rendering.js`, `src/overlays/worldOverlay.js` (request/paint coalescing), server-side `coalesceProxyRequest` in `server/providers/common/http.js` (re-exported `server/providers/local.js:72`).
- **Virtualized list rendering: NONE** — `grep -rn "virtuali[sz]" src` → 0 hits.
- **Scroll anchoring: NONE** — `grep "scrollAnchor|scroll-anchor|overflow-anchor" src` → 0 hits. The chat transcript UI has no virtualization or scroll-anchor logic.

---

## 3. Backend / serverless

### Request flow
- `api/[...route].js:18-23` — single catch-all Vercel function: `resolveRequestUrl` + `rehydrateBody` (`server/serverless/vercel-adapter.js`) → `getServerlessApi().handle(req,res)`.
- `vercel.json` rewrite `/api/:__gev_api_path*` → `/api/route` (`vercel.json:19-21`); literal files under `api/ondemand/*.js` win over the catch-all (`api/[...route].js:10-12`).
- `server/serverless/app.js:122-230` builds a Connect-compatible router (`server/serverless/router.js:109-...`): in serverless mode it `chdir`s to `os.tmpdir()` (`app.js:54-65`), mounts `aisServerlessProxy` first (`app.js:158`), stubs `/api/realtime/token` as 501 (`app.js:159-165`) and `/api/realtime/debug-log` as 204 (`app.js:174-178`), then `mountSourceRoutes` (`:183`), `mountToolsRoute` (`:186`), `mountOndemandWorkflowSubpaths` (`:193`), then every provider plugin from `server/providers/local.js:25-50` except `SKIP_ALWAYS={'gev-key-setup'}` (`app.js:87`) and `SKIP_WHEN_SERVERLESS={'ais-live-proxy'}` (`app.js:113`); finally `apiNotFoundPlugin` 404 (`app.js:206`). Router singleton memoised (`app.js:218-224`).

### Routes served by the catch-all (`api/[...route].js`)

| Path (mount prefix) | Method | Handler file:line | Upstream provider |
|---|---|---|---|
| `/api/ais-live` (+`/track`) | GET | `server/providers/vessels/ais-serverless.js:1035` | AISStream `wss://stream.aisstream.io/v0/stream` (`:67`), AISHub `https://data.aishub.net/ws.php` (`:74`), demo replay |
| `/api/realtime/token` | any → 501 | `server/serverless/app.js:159-165` | (disabled in serverless; local: OpenAI `https://api.openai.com/v1/realtime/client_secrets` `server/providers/openai/realtime.js:19`) |
| `/api/realtime/debug-log` | any → 204 | `server/serverless/app.js:174-178` | none (local: JSONL file sink `server/providers/openai/debug-log.js`) |
| `/api/sources/earthquakes` | GET | `server/serverless/sources-mounts.js:20` → `server/serverless/earthquakes-route.js` | USGS FDSN `https://earthquake.usgs.gov/fdsnws/event/1/` (`server/sources/usgs-earthquakes.js:6`) |
| `/api/sources/fires` | GET | `server/serverless/sources-mounts.js:24-28` | NASA FIRMS `https://firms.modaps.eosdis.nasa.gov/api/area/` (`server/sources/nasa-firms.js:5`) |
| `/api/sources/demo/timezone` | GET | `server/serverless/sources-mounts.js:31-35` | `server/sources/demo-timezone.js` (local computation) |
| `/api/tools` (catalogue) and `/api/tools/<name>` (invoke) | GET, HEAD | `server/serverless/tools-route.js:150` → `createToolsHandler` (`:43`) | `server/tools/registry.js`; tools: `earthquake_search` (`server/tools/earthquakes.js:226`), `flights_in_bbox` / `flight_by_icao24` (`flights.js:206,340`), `military_flights_in_bbox` (`military.js:75`), `list_satellites_in_scene` / `satellite_passes` (`satellites.js:441,581`), `traffic_flow_at_point` (`traffic.js:152`), vessels (`vessels.js`) |
| `/api/ondemand/workflow/{execute,status,logs,outputs,stream}` | POST (execute), GET (others) | `server/serverless/ondemand-workflow-mount.js:346` (`SUB_ACTIONS` `:38`; `stream` `:352` = same-origin SSE polling wrapper) | rewrites to `api/ondemand/workflow.js` `?action=` contract |
| `/api/opensky` | GET | `server/providers/aircraft/opensky.js:1184` | `https://opensky-network.org/api/states/all` (`:26`) |
| `/api/celestrak` | GET | `server/providers/space/celestrak.js:269` | `https://celestrak.org/NORAD/elements/gp.php` (`:21`) + bundled snapshot (`celestrak-snapshot.js`) |
| `/api/tomtom` | GET | `server/providers/traffic.js:502` | `https://api.tomtom.com/traffic/map/4/tile/flow/relative/` (`:20`) |
| `/api/firms` | GET | `server/providers/firms.js:171` | `https://firms.modaps.eosdis.nasa.gov/api/area/csv/` (`:8`) |
| `/api/launches` | GET | `server/providers/space/launch-library.js:92` | Launch Library 2 (`LL2_API_TOKEN`) |
| `/api/terrain/heights` | GET | `server/providers/terrain.js:159` | `https://terrain.reearth.land/heights.json` (`:14`) |
| `/api/adsbdb` | GET | `server/providers/aircraft/enrichment.js:111` | `https://api.adsbdb.com/v0/callsign/` (`:81`) |
| `/api/overpass` | GET | `server/providers/overpass.js:136` | `https://overpass.kumi.systems/api/interpreter` (`server/providers/overpass/constants.js:38`) |
| `/api/military-installations` | GET | `server/providers/military-installations.js:80` | Overpass (via `military-installations/query.js`) |
| `/api/regional-brief` | GET | `server/providers/regional/briefing.js:73` | Google News RSS (`regional/news.js:72`), Open-Meteo (`regional/weather.js:16`) |
| `/api/geocode` | GET | `server/providers/regional/place.js:214` | Nominatim/OSM |
| `/api/weather-effects` | GET | `server/providers/regional/weather-effects.js:46` | `https://api.open-meteo.com/v1/forecast` (`regional/weather.js:16`) |
| `/api/cctv` | GET | `server/providers/cctv.js:130` | Austin/TxDOT/Caltrans etc. feeds (`cctv/sources.js:151`, `cctv/media.js:328`, `cctv/constants.js:4`); Street View fallback `https://maps.googleapis.com/maps/api/streetview` (`cctv.js:93`) |
| `/api/radio` | GET | `server/providers/radio.js:12` | Radio Browser `https://de1.api.radio-browser.info` (`radio/constants.js:15`), `https://all.api.radio-browser.info/json/servers` (`radio/catalog.js:107`) |
| `/api/gbfs` | GET | `server/providers/gbfs.js:118` | GBFS feeds |
| `/api/transit` | GET | `server/providers/transit.js:8` | transit providers |
| `/api/adsblol/mil` | GET | `server/providers/aircraft/adsb-lol.js:451` | `https://api.adsb.lol/v2/mil` (`:11`) |
| `/api/opensky-track` | GET | `server/providers/aircraft/tracks.js:64` | `https://opensky-network.org/api/tracks/all` (`:82`) |
| `/api/adsblol/trace` | GET | `server/providers/aircraft/tracks.js:92` | adsb.lol traces |
| `/api/openai/hud-summary` | POST | `server/providers/openai.js:18` → `openai/hud-summary.js` | `https://api.openai.com/v1/responses` (`hud-summary.js:54`) |
| `/api/google/nearby-places` | GET | `server/providers/places/google.js:52` | `https://places.googleapis.com/v1/places` (`:103`) |
| `/api/google/text-search` | GET | `server/providers/places/google.js:163` | same |
| `/api/route` | GET | `server/providers/places/routes.js:229` | OSRM `https://routing.openstreetmap.de/routed-` (`:295`) |
| `/api/setup/status`, `/api/setup/keys` | GET/POST | `server/standalone/key-setup.js:248,256` | **never mounted in serverless** (`app.js:87`) — local dev only |
| `/api/*` fallback | any → 404 JSON | `server/standalone/api-not-found.js:4` | — |

Count: **33 distinct mount prefixes** registered via the catch-all in serverless mode (32 + 404 fallback; `/api/setup/*` excluded). Local dev additionally mounts `ais-live.js:74` (persistent AISStream relay) and `key-setup`.

### Dedicated Vercel functions — `api/ondemand/*.js` (8 files incl. `_config.js`)

All upstream URLs derive from `baseUrls()` in `server/ondemand/config.js:799-805`: `chat = ${baseUrl}/chat/v1`, `media = ${baseUrl}/media/v1/public/file`, `services = ${baseUrl}/services/v1/public/service`, `automation = ${baseUrl}/automation/api`; default `baseUrl = https://api.on-demand.io` (`config.js:37`, `api/ondemand/_config.js:36`). Transport: `ondemandFetch` in `server/ondemand/client.js:144-147` (sets `apikey` header).

| Function | Methods | Upstream OnDemand call(s) | Evidence |
|---|---|---|---|
| `api/ondemand/chat.js` | POST | `POST {chat}/sessions/{sessionId}/query` (sync or SSE stream, `text/event-stream` relay) | `chat.js:98,345-351,386-387,416` |
| `api/ondemand/sessions.js` | GET, POST, DELETE | POST → `POST {chat}/sessions` (via `server/ondemand/session-service.js`); GET `?sessionId=` → `GET {chat}/sessions/{id}/messages`; GET `?userId=` → local store lookup; DELETE → local store delete only (upstream delete not in docs) | `sessions.js:5,52,76-108,199,242` |
| `api/ondemand/media.js` | GET, POST, DELETE | `GET {media}?…`, `DELETE {media}/{id}`, `POST {media}/raw` (≤ 8 MiB), `POST {media}` (JSON ≤ 1 MiB) | `media.js:37,49-71,92-93,157-158,24-25` |
| `api/ondemand/stt.js` | POST | `POST {services}/execute/speech_to_text` | `stt.js:32,74-77` |
| `api/ondemand/tts.js` | POST | `POST {services}/execute/text_to_speech` (input ≤ 4096 chars) | `tts.js:33,84-87,27` |
| `api/ondemand/workflow.js` | GET, POST | GET `?action=status|logs|outputs|list` → `GET {automation}/execution/...`, `GET {automation}/execution/list?workflowID=`; POST `?action=execute` → `POST {automation}/workflow/{id}/execute` (no body); `activate|deactivate` → `POST {automation}/workflow/{id}/{action}`; `stream-logs` → 501 | `workflow.js:42,55-102,119-153` |
| `api/ondemand/health.js` | GET, HEAD | probes `GET {chat}/sessions?limit=1`, `GET {media}?page=1&limit=1`, `GET {automation}/workflow/?limit=1`, optional `POST {services}/execute/text_to_speech` | `health.js:260,299-312,405-408` |
| `api/ondemand/selftest.js` | GET, HEAD | contract steps (`server/ondemand/contract-steps.js:33` base `https://api.on-demand.io`); gated by `ONDEMAND_SELFTEST_TOKEN` | `selftest.js:136-137,241` |

Function count: **7 handlers + 1 catch-all = 8 Vercel functions** (`_config.js` is a shared module, not a route).

### Other server modules
- `server/ondemand/capability-loop.js:233` — hard-codes `https://api.on-demand.io/chat/v1`.
- `server/ondemand/workflow-definition.js:6` — `https://api.on-demand.io/automation/api/workflow/`.
- `server/ondemand/sse.js` — `pipeSseBody`, `wireAbortOnClose` (imported `chat.js:39`).
- `server/serverless/dev-server.mjs` — local Node server reusing the same router (`package.json:41-42`).

---

## 4. Database / storage / workers / scheduled jobs

| Concern | Fact | Evidence |
|---|---|---|
| Database | **None** (no ORM, no SQL driver in deps) | `package.json:153-169` |
| KV | Optional REST KV: `KV_REST_API_URL`+`KV_REST_API_TOKEN` (Vercel KV) or `UPSTASH_REDIS_REST_URL`+`_TOKEN`; used by AIS serverless snapshot | `server/providers/vessels/kv-store.js:15,26-33`; `ais-serverless.js:65,251-273` |
| Session store | In-memory LRU `Map`, default 500 entries, memoised on `globalThis[GLOBAL_KEY]` per function instance (userId → sessionId) — **not durable across instances/cold starts** | `server/ondemand/sessions-store.js:15,21,46-48,82-92` |
| Web Workers (browser) | **None** — `grep "new Worker"` in `src` → 0 hits. The only `*.worker.mjs` (`src/overlays/worldOverlayAllocation.worker.mjs`) is a **Node child-process allocation probe for tests**, not a browser worker | `worldOverlayAllocation.worker.mjs:83-91`; `scripts/run-unit-tests.mjs:6-9` |
| Cron / scheduled | **None** — `vercel.json` has no `crons` key | `grep -c cron vercel.json` → 0 |
| WebSocket collectors | AISStream: local dev = persistent relay with watchdog interval (`ais-live.js`, skipped in serverless `app.js:93-113`); serverless = bounded per-request collector (`AISSTREAM_COLLECT_MS_DEFAULT = 8000`), closes socket within invocation, snapshot to KV | `ais-serverless.js:12,67-68,1035`; `app.js:107-113` |
| Disk caches | `.gev-cache` under `process.cwd()` (redirected to `os.tmpdir()` in serverless): Overpass disk TTL 7 d / boundary 30 d; military installations cache | `app.js:22-65`; `server/providers/overpass/constants.js:183-202`; `military-installations/cache.js` |
| HTTP caches | Edge `s-maxage` on source/tool routes (`cacheSeconds`) | `tools-route.js:23-30`; `sources-mounts.js:26,34` |
| Request coalescing | `coalesceProxyRequest` | `server/providers/common/http.js` (re-export `local.js:72`) |
| Browser storage | `localStorage` `ondemand.apiKey` and per-camera session ids | `src/ondemand/entityChat.js:41-46`; `src/voice/ondemand/transport.js:28` |

---

## 5. Deploy config

### `vercel.json` (summary; `vercel.json:1-66`)
- `buildCommand: npm run build`, `installCommand: PUPPETEER_SKIP_DOWNLOAD=1 npm ci`, `outputDirectory: dist`, `framework: null` (`:3-6`).
- `functions`: `api/*.js` → `maxDuration 60`, `includeFiles "{config/**,data/**,src/data/local_data/cctv_ground_heights/**}"` (`:8-11`); `api/ondemand/*.js` → `maxDuration 60` (`:12-14`).
- `rewrites`: `/api/:__gev_api_path*` → `/api/route`; `/((?!api/).*)` → `/index.html` (`:17-26`).
- `headers`: `/` and `/index.html` → `X-Frame-Options: DENY`, `CSP: frame-ancestors 'none'`; `/assets/(.*)` and `/cesium/(.*)` → `Cache-Control: public, max-age=31536000, immutable` (`:28-66`).
- No `crons`, no `regions`, no `env`.

### Build / check scripts (`package.json:28-48`)
- `prebuild`: `node scripts/refresh-celestrak-snapshot.mjs --skip-if-fresh 6` (`:34`)
- `build`: `vite build` → `dist/` (`:35`; `vercel.json:5`)
- `check:boundaries`: import-directions + package-boundaries + brand-marks (`:45`)
- `test`, `test:serverless`, `test:ondemand`, `ondemand:contract` (`scripts/ondemand-contract-test.mjs`) (`:36-39`)
- `doctor`, `format`, `format:check`, `dev`, `dev:secure`, `dev:serverless`, `start:serverless`, `qa:*` (`:28-48`)

### Gates NOT present in this repo
`scripts/` here contains only `check-brand-marks.mjs`, `check-import-directions.mjs`, `check-package-boundaries.mjs` as `check-*` gates. **`check-forbidden-terms`, `check-no-secrets`, `check-contrast`, `check-remote-assets` do NOT exist in `gods-eye-view/scripts`** (`ls scripts | grep -E "forbidden|secrets|contrast|remote-assets"` → empty). They exist in the sibling repo: `../ondemand-eand-spatial/scripts/check-forbidden-terms.mjs`, `check-no-secrets.mjs`, `check-contrast.mjs`, `check-remote-assets.mjs` (verified by `ls`).

### `.env.example` variables (names only; 33 declared)
- **Browser-injected (by design, via Vite `define`)**: `GOOGLE_MAPS_API_KEY`, `CESIUM_ION_TOKEN` (`build/vite.js:32-34`; `.env.example:16-19`); `VITE_AIS_LIVE_API_URL`, `VITE_AIS_LIVE_MAX_ROWS`, `VITE_AIS_LIVE_LABEL_MAX_ROWS`, `VITE_SERVERLESS_MODE`.
- **Google server-side**: `GOOGLE_MAPS_SERVER_API_KEY`.
- **OpenAI (voice/HUD)**: `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_MODEL_MINI`, `OPENAI_REALTIME_VOICE`, `OPENAI_REALTIME_REASONING_EFFORT`, `OPENAI_REALTIME_CONTEXT_TOKENS`, `OPENAI_REALTIME_CONTEXT_RETENTION`, `OPENAI_HUD_SUMMARY_MODEL`.
- **Aircraft**: `OPENSKY_AUTH_MODE`, `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`.
- **Vessels**: `AISSTREAM_API_KEY`.
- **Traffic**: `TOMTOM_API_KEY`.
- **OnDemand**: `ONDEMAND_API_KEY`, `ONDEMAND_BASE_URL`, `ONDEMAND_SPATIAL_AGENT_ID`, `ONDEMAND_SPATIAL_TOOL_ID`, `ONDEMAND_SPATIAL_WORKFLOW_ID`, `ONDEMAND_REASONING_ENDPOINT_ID`, `ONDEMAND_FULFILLMENT_ENDPOINT_ID`, `ONDEMAND_REASONING_MODE`, `ONDEMAND_SPATIAL_FLOW_VERSION`, `ONDEMAND_REQUEST_TIMEOUT_MS`, `ONDEMAND_SELFTEST_TOKEN`.
- **Runtime**: `PORT`, `SERVERLESS_MODE`.

Server code additionally reads ~55 env names **not** in `.env.example` (e.g. `KV_REST_API_URL/TOKEN`, `UPSTASH_REDIS_REST_URL/TOKEN`, `NASA_FIRMS_MAP_KEY`, `FIRMS_MAP_KEY`, `LL2_API_TOKEN`, `TFL_APP_KEY`, `OPENSKY_USERNAME/PASSWORD`, `AISSTREAM_*`, `CCTV_*`, `OVERPASS_*_TIMEOUT_MS`, `TOMTOM_DAILY_*_BUDGET`, `GEV_RATELIMIT_*`, `ONDEMAND_API_BASE`, `ONDEMAND_ENDPOINT_ID`, `ONDEMAND_SPATIAL_FLOW_ID`, `GODS_EYE_FLOW_VERSION`, `VERCEL`) — grep of `process.env.*` across `server/` and `api/` minus `.env.example`.

### Dist output
- `vite build` → `dist/` (`package.json:35`, `vercel.json:5`); Cesium static assets served under `/cesium/` (`vercel.json:57`).

---

## 6. Security posture findings

1. **Client-side OnDemand key override.** Browser stores an optional user key in `localStorage['ondemand.apiKey']` and sends it as `x-ondemand-key` on every `/api/ondemand/*` call (`src/ondemand/entityChat.js:20-21,41-42`; `src/voice/ondemand/transport.js:17-18,28-29,76`). Server validates it in `resolveRequestKey` (`server/ondemand/client.js:29,52-69`) and threads it as `apiKeyOverride` → upstream `apikey` header (`client.js:95-97,144-147`), *instead of* the server key for that one call. Health/selftest never honour the override (`client.js:22`). Risk: a user-supplied key is proxied through the server; `localStorage` is readable by any XSS. There is no CSP beyond `frame-ancestors` (`vercel.json:36-37,48-49`) and **no `Access-Control-Allow-Origin` header is set anywhere** (`grep` → 0 hits), so the API is same-origin only.
2. **Server secret reads** are centralised in `server/ondemand/config.js` (`process.env[...]` at `:229,300-333,562,637,666`) with alias handling (`ONDEMAND_API_BASE`, etc.) and a frozen snapshot (`:121,843-876`). Handlers import only `_config.js` / `client.js` (`api/ondemand/_config.js:18`). `noKeyInBundle.test.mjs` guards that no `src/` file names `ONDEMAND_API_KEY` (`src/ondemand/noKeyInBundle.test.mjs:1-6`).
3. **`import.meta.env` in the browser bundle** (grep `src/`, `build/`): `GOOGLE_MAPS_API_KEY` (5 refs, `src/main.js:7`), `CESIUM_ION_TOKEN` (3 refs, `src/main.js:8`), `DEV` (3 refs, `src/main.js:9`), one generic `VITE_` prefix reference. The two API credentials are injected via Vite `define` (`build/vite.js:32-34`) **without the `VITE_` prefix** — intentional and documented as client-exposed (`.env.example:16-19`) — **flag: both are secret-like names; they MUST be referrer-restricted keys.** No `ONDEMAND_*`, `OPENAI_*`, `AISSTREAM_*`, `TOMTOM_*` reach the bundle.
4. **Session mapping is per-instance memory** (`sessions-store.js:15,84-87`); a userId→sessionId lookup can miss on another instance → new upstream session created (`api/ondemand/sessions.js` "create-or-reuse"). Not a leak, but a correctness/cost issue.
5. **Body limits** are enforced on OnDemand handlers (`media.js:24-25`, `stt.js:49`, `tts.js:27,44`); `allowed`-list validation returns 400 on unknown fields (`chat.js:6,174-215`).
6. **Error hygiene**: router never leaks `err.message` (`server/serverless/router.js:66-71`); tools route "never echoes an env var value" (`tools-route.js:17-18`).
7. **Dev-only key writer** `server/standalone/key-setup.js` (writes `.env`, calls `server.restart()`) is excluded from serverless (`app.js:79-87`); Vite `server.fs.deny` blocks `.env*`, certs, `.git`, `ENVIRONMENT` (`build/vite.js:24`).
8. **Voice realtime (OpenAI) disabled in serverless** → 501 (`app.js:159-165`), so no OpenAI ephemeral token path on Vercel.
9. No ESLint / no typecheck / no secret-scan gate in this repo (see §1, §5) — the `check-no-secrets` gate lives only in the sibling repo.

---

## 7. Keep / Change for an OnDemand-native foundation

**Keep**
- Single catch-all + Connect-compatible router (`api/[...route].js`, `server/serverless/{app,router}.js`) — proven, tested (`router.test.mjs`, `app.test.mjs`).
- Centralised OnDemand config/client (`server/ondemand/config.js`, `client.js`) with `baseUrls()` families and `noKeyInBundle` guard.
- Thin `api/ondemand/*.js` handlers with method gates, body caps and allow-list validation.
- `/api/tools` catalogue/invoke envelope for OnDemand REST-API agents (`tools-route.js`, `server/tools/registry.js`).
- Vanilla-JS, no-framework frontend and Prettier-only toolchain (low churn).
- `vercel.json` hardening headers and immutable asset caching.

**Change**
- Replace the per-instance `globalThis` session store with KV (reuse `kv-store.js`) so userId→sessionId survives cold starts.
- Decide on the `x-ondemand-key` browser override: either remove it for production or scope it (origin check, length/format already enforced) and document the threat model.
- Add `check-no-secrets` / `check-forbidden-terms` / `check-contrast` / `check-remote-assets` gates (port from `../ondemand-eand-spatial/scripts`) and wire into `check:boundaries` or CI.
- Add ESLint (or at least `node --check`-style lint) and a documented env-contract: `.env.example` lists 33 names but server reads ~55 more (§5).
- Retire/flag OpenAI Realtime voice (`src/voice/realtime*.js`, `server/providers/openai/*`) in favour of the OnDemand STT/TTS pipeline (`src/voice/ondemand/*`) to make OnDemand the single AI backend.
- Introduce transcript virtualization / scroll anchoring in the chat UI only if transcript size demands it — none exists today (§2).

GENERATED_UTC: 2026-10-20T21:38:13Z
