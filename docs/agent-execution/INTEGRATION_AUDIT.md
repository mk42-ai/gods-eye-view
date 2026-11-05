# INTEGRATION AUDIT — gods-eye-view (`integration/ondemand-native`)

> File: `docs/agent-execution/INTEGRATION_AUDIT.md`  
> Generated UTC: `2026-10-21T02:15:18Z`  
> Machine-readable companion: `docs/agent-execution/integration-audit.json`  
> Branch: `integration/ondemand-native` · Node 22 · Vanilla JS + Vite · Serverless functions (`api/`, `server/`)  

## Method & Execution Commands

This audit inspected every network call, external integration endpoint, direct browser fetch, AI bypass, tool binding, stub/mock, and test harness across:
- `src/**` (frontend widgets, layers, voice controller, map imagery/terrain/3D)
- `api/**` (Vercel serverless functions, legacy and v2 OnDemand routes)
- `server/**` (providers, sources, tools, ondemand foundation client/orchestrator)
- `vite.config.js` and `server/standalone/vite.config.js` (local provider middlewares)
- `scripts/**` (prebuild scripts, snapshot refreshers, deploy scripts, and QA test harnesses)
- Workflow definitions (`server/ondemand/workflow-definition.js`, `docs/ondemand-workflows/*.json`)
- Capability registry (`src/registry/capabilities.json`) and contracts (`server/ondemand/foundation/contracts.js`)
- Unit and integration test suites (`*.test.mjs`)

Exclusions: `node_modules/`, `dist/`, `public/cesium/`, `data/`, and `.git/`.

Search inspection patterns executed across the codebase:
```bash
# Network call patterns & endpoints
grep -rnE 'https?://|fetch\s*\(|new\s+WebSocket|wss?://|EventSource|RTCPeerConnection' src api server scripts vite.config.js index.html

# AI providers & direct bypasses
grep -rnE 'openai|api\.openai\.com|elevenlabs|anthropic|gemini|generativelanguage' src api server

# External geodata providers
grep -rnE 'overpass|celestrak|opensky|adsb|aisstream|ais|tomtom|firms|nasa|usgs|nominatim|geocod|mapbox|google.*maps|places|gbfs|transit|cesium|ion\.cesium|tile\.openstreetmap|arcgis|maptiler' src api server

# Social & news providers
grep -rnE 'youtube|reddit|tiktok|instagram|linkedin|twitter|x\.com|news|rss' src server api

# Stubs, placeholders, simulated modes, fake citations/checkpoints, null plugin IDs
grep -rnE 'stub|mock|simulat|fake|placeholder|pending|TODO|not yet registered|registration pending|portfolio_plugin_id|=\s*null' src api server

# Test suites & QA harnesses
find . -name '*.test.mjs' -o -path 'scripts/qa-*.mjs'
```

## Summary Counts

### By Status

| Status | Description | Count |
|---|---|---|
| `ondemand-native` | Direct integration through native OnDemand endpoints (`/api/ondemand/*`, `/api/ondemand/v2/*`, `api.on-demand.io`) | **32** |
| `proxied-tool` | Repo geodata tools callable by OnDemand via `/api/tools/*` or Gate-3 `/api/sources/*` | **10** |
| `direct-provider` | Server-side external API integration not yet exposed as an OnDemand REST tool | **53** |
| `direct-browser` | Browser-initiated call directly hitting external servers without proxying | **17** |
| `bypass-ai` | Direct third-party AI/LLM model bypass (OpenAI Realtime WebRTC / secret minting) | **4** |
| `stub` | Simulated/stub providers, fake states, null plugin IDs, and unverified placeholders | **25** |
| `test-only` | Test-only suites, mock HTTP/WS stubs, and offline QA test harnesses | **20** |
| **TOTAL** | **All catalogued call sites** | **161** |

### By Kind

| Kind | Count |
|---|---|
| `data-provider` | **60** |
| `ai-model` | **34** |
| `geocoder` | **5** |
| `tiles/basemap` | **7** |
| `social/news` | **6** |
| `infra/cdn` | **4** |
| `stub/mock/placeholder` | **25** |
| `test-only` | **20** |
| **TOTAL** | **161** |

---

## Full Call Site Audit Table

Sorted by `status` then `file:line`.

| Integration | File:Line | Target (Host/API) | Kind | Reaches Browser? | Replacement | Status | Notes |
|---|---|---|---|---|---|---|---|
| ondemand-chat-sync | `api/ondemand/chat.js:350` | `POST {ONDEMAND_BASE_URL}/chat/v1/sessions/{sessionId}/query` | `ai-model` | no | `native-ondemand (/api/ondemand/chat)` | `ondemand-native` | Legacy OnDemand synchronous chat turn with model endpoint and pluginIds |
| ondemand-chat-stream | `api/ondemand/chat.js:386` | `POST {ONDEMAND_BASE_URL}/chat/v1/sessions/{sessionId}/query` | `ai-model` | no | `native-ondemand (/api/ondemand/chat)` | `ondemand-native` | Legacy OnDemand SSE streaming chat query piped verbatim to client |
| ondemand-health-chat-probe | `api/ondemand/health.js:299` | `GET {ONDEMAND_BASE_URL}/chat/v1/sessions` | `ai-model` | no | `native-ondemand (/api/ondemand/health)` | `ondemand-native` | Diagnostic probe of OnDemand chat service availability |
| ondemand-health-workflow-probe | `api/ondemand/health.js:305` | `GET {ONDEMAND_BASE_URL}/agents/v1/workflows` | `ai-model` | no | `native-ondemand (/api/ondemand/health)` | `ondemand-native` | Diagnostic probe of OnDemand workflow engine |
| ondemand-health-media-probe | `api/ondemand/health.js:311` | `GET {ONDEMAND_BASE_URL}/media/v1/models` | `ai-model` | no | `native-ondemand (/api/ondemand/health)` | `ondemand-native` | Diagnostic probe of OnDemand media generation models |
| ondemand-health-tts-probe | `api/ondemand/health.js:405` | `POST {ONDEMAND_BASE_URL}/audio/v1/tts` | `ai-model` | no | `native-ondemand (/api/ondemand/health)` | `ondemand-native` | Diagnostic probe of OnDemand speech synthesis |
| ondemand-media-generate | `api/ondemand/media.js:56` | `POST {ONDEMAND_BASE_URL}/media/v1/generate` | `ai-model` | no | `native-ondemand (/api/ondemand/media)` | `ondemand-native` | Generates synthetic media (image/audio) via OnDemand Media API |
| ondemand-media-status | `api/ondemand/media.js:69` | `GET {ONDEMAND_BASE_URL}/media/v1/status/{id}` | `ai-model` | no | `native-ondemand (/api/ondemand/media)` | `ondemand-native` | Polls generation status of media task |
| ondemand-media-models | `api/ondemand/media.js:92` | `GET {ONDEMAND_BASE_URL}/media/v1/models` | `ai-model` | no | `native-ondemand (/api/ondemand/media)` | `ondemand-native` | Lists supported media generation models |
| ondemand-media-audio-fetch | `api/ondemand/media.js:157` | `GET {data.audioUrl}` | `data-provider` | no | `native-ondemand (/api/ondemand/media)` | `ondemand-native` | Downloads generated audio bytes for client delivery |
| ondemand-sessions-list | `api/ondemand/sessions.js:242` | `GET {ONDEMAND_BASE_URL}/chat/v1/sessions` | `ai-model` | no | `native-ondemand (/api/ondemand/sessions)` | `ondemand-native` | Lists user chat sessions with cursor-based pagination |
| ondemand-stt | `api/ondemand/stt.js:74` | `POST {ONDEMAND_BASE_URL}/audio/v1/stt` | `ai-model` | no | `native-ondemand (/api/ondemand/stt)` | `ondemand-native` | Transcribes user audio via OnDemand Speech-to-Text API |
| ondemand-tts | `api/ondemand/tts.js:84` | `POST {ONDEMAND_BASE_URL}/audio/v1/tts` | `ai-model` | no | `native-ondemand (/api/ondemand/tts)` | `ondemand-native` | Synthesizes speech via OnDemand Text-to-Speech API |
| ondemand-tts-audio-fetch | `api/ondemand/tts.js:128` | `GET {data.audioUrl}` | `data-provider` | no | `native-ondemand (/api/ondemand/tts)` | `ondemand-native` | Fetches synthesized audio bytes from OnDemand media URL |
| ondemand-workflow-execute | `api/ondemand/workflow.js:161` | `POST {ONDEMAND_BASE_URL}/agents/v1/workflows/{id}/execute` | `ai-model` | no | `native-ondemand (/api/ondemand/workflow)` | `ondemand-native` | Triggers workflow execution on OnDemand Flow Builder |
| ondemand-workflow-poll | `api/ondemand/workflow.js:178` | `GET {ONDEMAND_BASE_URL}/agents/v1/workflows/{id}/executions/{execId}` | `ai-model` | no | `native-ondemand (/api/ondemand/workflow)` | `ondemand-native` | Polls execution status and node outputs of workflow |
| ondemand-workflow-script | `scripts/ondemand-workflow.mjs:92` | `POST/GET {ONDEMAND_BASE_URL}/agents/v1/workflows` | `ai-model` | no | `native-ondemand (/api/ondemand/workflow)` | `ondemand-native` | CLI script for triggering and verifying flow execution |
| ondemand-capability-loop-session | `server/ondemand/capability-loop.js:295` | `POST {ONDEMAND_BASE_URL}/chat/v1/sessions` | `ai-model` | no | `native-ondemand (/api/ondemand/v2/chat)` | `ondemand-native` | Capability loop creates session to evaluate agent intent |
| ondemand-capability-loop-query | `server/ondemand/capability-loop.js:335` | `POST {ONDEMAND_BASE_URL}/chat/v1/sessions/{id}/query` | `ai-model` | no | `native-ondemand (/api/ondemand/v2/chat)` | `ondemand-native` | Capability loop queries model to map spatial query to tool |
| ondemand-selftest-contract | `server/ondemand/contract-steps.js:33` | `POST/GET {ONDEMAND_BASE_URL}/*` | `ai-model` | no | `native-ondemand (/api/ondemand/selftest)` | `ondemand-native` | 10-step OnDemand platform contract verification harness |
| ondemand-v2-investigate-retrieval | `server/ondemand/foundation/orchestrator.js:139` | `POST {ONDEMAND_BASE_URL}/chat/v1/sessions/{id}/query` | `ai-model` | no | `native-ondemand (/api/ondemand/v2/investigate)` | `ondemand-native` | Foundation v2 parallel research retrieval across active OnDemand plugins |
| ondemand-v2-investigate-synthesis | `server/ondemand/foundation/orchestrator.js:444` | `POST {ONDEMAND_BASE_URL}/chat/v1/sessions/{id}/query` | `ai-model` | no | `native-ondemand (/api/ondemand/v2/investigate)` | `ondemand-native` | Foundation v2 intelligence synthesis query across retrieved objects |
| ondemand-v2-chat-query | `server/ondemand/foundation/proxy-route.js:283` | `POST {ONDEMAND_BASE_URL}/chat/v1/sessions/{id}/query` | `ai-model` | no | `native-ondemand (/api/ondemand/v2/chat)` | `ondemand-native` | Foundation v2 chat route handler with object-context and plugin attachments |
| ondemand-v2-hud-summary | `server/ondemand/foundation/proxy-route.js:487` | `POST {ONDEMAND_BASE_URL}/chat/v1/sessions/{id}/query` | `ai-model` | no | `native-ondemand (/api/ondemand/v2/summaries/hud)` | `ondemand-native` | Foundation v2 5-word HUD summary using predefined-gpt-6-luna fulfillment |
| ondemand-sessions-create | `server/ondemand/session-service.js:67` | `POST {ONDEMAND_BASE_URL}/chat/v1/sessions` | `ai-model` | no | `native-ondemand (/api/ondemand/sessions)` | `ondemand-native` | Creates or reuses OnDemand chat session with externalUserId and pluginIds |
| ondemand-minichat-client | `src/ondemand/miniChat.js:425` | `/api/ondemand/v2/chat` | `ai-model` | no | `native-ondemand (/api/ondemand/v2/chat)` | `ondemand-native` | UI MiniChat widget issues conversational queries via v2 proxy |
| ondemand-minichat-investigate-client | `src/ondemand/miniChat.js:520` | `/api/ondemand/v2/investigate` | `ai-model` | no | `native-ondemand (/api/ondemand/v2/investigate)` | `ondemand-native` | UI MiniChat widget initiates deep multi-plugin investigation |
| ondemand-hud-summary-client | `src/services/requests.js:24` | `/api/ondemand/v2/summaries/hud` | `ai-model` | no | `native-ondemand (/api/ondemand/v2/summaries/hud)` | `ondemand-native` | HUD periodic 15s refresh requests five-word scene summary via v2 proxy |
| ondemand-voice-stt-client | `src/voice/ondemand/transport.js:135` | `/api/ondemand/stt` | `ai-model` | no | `native-ondemand (/api/ondemand/stt)` | `ondemand-native` | Browser voice pipeline transcribes microphone audio via local OnDemand proxy |
| ondemand-voice-chat-client | `src/voice/ondemand/transport.js:175` | `/api/ondemand/v2/chat` | `ai-model` | no | `native-ondemand (/api/ondemand/v2/chat)` | `ondemand-native` | Browser voice pipeline submits user transcript to OnDemand v2 chat |
| ondemand-voice-tts-client | `src/voice/ondemand/transport.js:220` | `/api/ondemand/tts` | `ai-model` | no | `native-ondemand (/api/ondemand/tts)` | `ondemand-native` | Browser voice pipeline requests speech audio from local OnDemand TTS proxy |
| ondemand-voice-workflow-client | `src/voice/ondemand/transport.js:340` | `/api/ondemand/workflow/execute` | `ai-model` | no | `native-ondemand (/api/ondemand/workflow)` | `ondemand-native` | Browser voice pipeline triggers Spatial Advanced Workflow for complex spatial queries |
| source-demo-timezone | `server/sources/demo-timezone.js:15` | `local nautical timezone calculation` | `data-provider` | no | `/api/sources/demo/timezone` | `proxied-tool` | Dynamic capability probe mounted at /api/sources/demo/timezone |
| source-nasa-firms | `server/sources/nasa-firms.js:42` | `GET https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{bbox}/{days}` | `data-provider` | no | `/api/sources/fires (docs/ondemand-tools/fire_detection_search.json)` | `proxied-tool` | Gate 3 Row 2 active fire adapter mounted at /api/sources/fires |
| source-usgs-earthquakes-query | `server/sources/usgs-earthquakes.js:22` | `GET https://earthquake.usgs.gov/fdsnws/event/1/query` | `data-provider` | no | `/api/sources/earthquakes (TOOL_CONTRACTS: earthquake_search)` | `proxied-tool` | Gate 3 Row 1 earthquake adapter mounted at /api/sources/earthquakes |
| source-usgs-earthquakes-count | `server/sources/usgs-earthquakes.js:24` | `GET https://earthquake.usgs.gov/fdsnws/event/1/count` | `data-provider` | no | `/api/sources/earthquakes (TOOL_CONTRACTS: earthquake_search)` | `proxied-tool` | Gate 3 Row 1 earthquake count query mounted at /api/sources/earthquakes |
| tool-earthquake-search | `server/tools/earthquakes.js:80` | `/api/tools/earthquake_search` | `data-provider` | no | `/api/tools/earthquake_search (docs/plugins/earthquakes/openapi.json)` | `proxied-tool` | OnDemand REST tool for USGS FDSN seismic events by coordinate, radius, and magnitude |
| tool-flight-search | `server/tools/flights.js:28` | `/api/tools/flight_search` | `data-provider` | no | `/api/tools/flight_search (docs/plugins/flights/openapi.json)` | `proxied-tool` | OnDemand REST tool for live aircraft positions by bounding box, circle, or hex callsign |
| tool-military-installation-search | `server/tools/military.js:145` | `/api/tools/military_installation_search` | `data-provider` | no | `/api/tools/military_installation_search (docs/plugins/military/openapi.json)` | `proxied-tool` | OnDemand REST tool for global military bases, airfields, and installations |
| tool-satellite-search | `server/tools/satellites.js:370` | `/api/tools/satellite_search` | `data-provider` | no | `/api/tools/satellite_search (docs/plugins/satellites/openapi.json)` | `proxied-tool` | OnDemand REST tool for CelesTrak satellite pass search by name, catnr, or lat/lon |
| tool-traffic-flow-segment | `server/tools/traffic.js:120` | `/api/tools/traffic_flow_segment` | `data-provider` | no | `/api/tools/traffic_flow_segment (docs/plugins/traffic/openapi.json)` | `proxied-tool` | OnDemand REST tool for TomTom live traffic speed, delay, and congestion on road segments |
| tool-vessel-search | `server/tools/vessels.js:170` | `/api/tools/vessel_search` | `data-provider` | no | `/api/tools/vessel_search (docs/plugins/vessels/openapi.json)` | `proxied-tool` | OnDemand REST tool for live marine vessel AIS positions and metadata |
| sfgov-neighborhoods-socrata | `scripts/build-sf-neighborhoods.mjs:98` | `https://data.sfgov.org/resource/p5b7-5n3h.geojson` | `data-provider` | no | `UNSUPPORTED (build-time geojson polygon generator)` | `direct-provider` | Build-time script generating San Francisco neighborhood GeoJSON polygons |
| celestrak-snapshot-prebuild | `scripts/refresh-celestrak-snapshot.mjs:207` | `https://celestrak.org/NORAD/elements/gp.php` | `data-provider` | no | `/api/tools/satellite_search` | `direct-provider` | Prebuild script refreshing offline bundled satellite TLE catalog |
| vercel-deploy-rest-api | `scripts/vercel-file-deploy.mjs:99` | `https://api.vercel.com/v13/deployments` | `infra/cdn` | no | `UNSUPPORTED (build/deployment orchestration API)` | `direct-provider` | Automated deployment helper interacting with Vercel platform REST API |
| adsblol-military-feed | `server/providers/aircraft/adsb-lol.js:11` | `https://api.adsb.lol/v2/mil` | `data-provider` | no | `/api/tools/military_installation_search` | `direct-provider` | Military aircraft tracking feed from adsb.lol |
| adsbfi-military-feed | `server/providers/aircraft/adsb-lol.js:12` | `https://opendata.adsb.fi/api/v2/mil` | `data-provider` | no | `/api/tools/military_installation_search` | `direct-provider` | Military aircraft tracking feed from opendata.adsb.fi |
| airplaneslive-military-feed | `server/providers/aircraft/adsb-lol.js:13` | `https://api.airplanes.live/v2/mil` | `data-provider` | no | `/api/tools/military_installation_search` | `direct-provider` | Military aircraft tracking feed from airplanes.live |
| adsblol-point-proxy | `server/providers/aircraft/adsb-lol.js:53` | `https://api.adsb.lol/v2/point/...` | `data-provider` | no | `/api/tools/flight_search` | `direct-provider` | Point-radius ADS-B query proxy for flights layer |
| adsbdb-enrichment | `server/providers/aircraft/enrichment.js:83` | `https://api.adsbdb.com/v0/aircraft/...` | `data-provider` | no | `custom-tool:aircraft_enrichment (OpenAPI spec required)` | `direct-provider` | Aircraft registration, manufacturer, and type enrichment metadata |
| adsblol-regional-feed | `server/providers/aircraft/opensky.js:163` | `https://api.adsb.lol/v2/lat/.../lon/...` | `data-provider` | no | `/api/tools/flight_search` | `direct-provider` | Regional aircraft fallback feed from adsb.lol point query |
| adsbfi-regional-feed | `server/providers/aircraft/opensky.js:170` | `https://opendata.adsb.fi/api/v2/lat/.../lon/...` | `data-provider` | no | `/api/tools/flight_search` | `direct-provider` | Regional aircraft fallback feed from opendata.adsb.fi |
| airplaneslive-regional-feed | `server/providers/aircraft/opensky.js:178` | `https://api.airplanes.live/v2/lat/.../lon/...` | `data-provider` | no | `/api/tools/flight_search` | `direct-provider` | Regional aircraft fallback feed from airplanes.live |
| opensky-oauth-token | `server/providers/aircraft/opensky.js:246` | `https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token` | `data-provider` | no | `/api/tools/flight_search` | `direct-provider` | OpenSky Network OAuth 2.0 client credential token exchange |
| opensky-states-fetch | `server/providers/aircraft/opensky.js:860` | `https://opensky-network.org/api/states/all` | `data-provider` | no | `/api/tools/flight_search (docs/plugins/flights/openapi.json)` | `direct-provider` | OpenSky Network live aircraft state vector snapshot |
| opensky-tracks | `server/providers/aircraft/tracks.js:39` | `https://opensky-network.org/api/tracks/all` | `data-provider` | no | `custom-tool:flight_tracks (OpenAPI spec required)` | `direct-provider` | Historical flight trajectory backfill via OpenSky Network |
| adsblol-trace | `server/providers/aircraft/tracks.js:109` | `https://api.adsb.lol/v2/trace/...` | `data-provider` | no | `custom-tool:flight_trace (OpenAPI spec required)` | `direct-provider` | Historical flight path traces by ICAO hex callsign |
| google-streetview-static-fetch | `server/providers/cctv.js:112` | `https://maps.googleapis.com/maps/api/streetview` | `data-provider` | no | `UNSUPPORTED (static camera fallback imagery)` | `direct-provider` | Street View static imagery fallback for CCTV camera positions |
| cctv-tallinn-ristmikud | `server/providers/cctv/constants.js:182` | `https://ristmikud.tallinn.ee/` | `data-provider` | no | `custom-tool:cctv_catalog` | `direct-provider` | Tallinn urban intersection traffic camera live frames |
| cctv-warendorf-webcam | `server/providers/cctv/constants.js:201` | `http://webcam.warendorf.de/` | `data-provider` | no | `custom-tool:cctv_catalog` | `direct-provider` | Kreis Warendorf German regional municipal webcam |
| cctv-frame-proxy-allowlist | `server/providers/cctv/media.js:340` | `https://... (multi-origin camera frame allow-list)` | `data-provider` | no | `UNSUPPORTED (raw live frame image buffer proxy)` | `direct-provider` | Proxies live JPEG images from validated camera origins with SSRF protection |
| cctv-austin-socrata | `server/providers/cctv/sources.js:95` | `https://data.austintexas.gov/resource/b4ee-vd56.json` | `data-provider` | no | `custom-tool:cctv_catalog (OpenAPI spec required)` | `direct-provider` | Austin traffic camera inventory from City of Austin open data portal |
| cctv-caltrans-cwwp2 | `server/providers/cctv/sources.js:207` | `https://cwwp2.dot.ca.gov/data/d{district}/cctv/...` | `data-provider` | no | `custom-tool:cctv_catalog` | `direct-provider` | California highway CCTV camera status from Caltrans CWWP2 |
| cctv-tfl-jamcams | `server/providers/cctv/sources.js:322` | `https://api.tfl.gov.uk/Place/Type/JamCam` | `data-provider` | no | `custom-tool:cctv_catalog` | `direct-provider` | London traffic camera feed list from Transport for London (TfL) |
| cctv-ontario-511 | `server/providers/cctv/sources.js:466` | `https://511on.ca/api/v2/get/cameras` | `data-provider` | no | `custom-tool:cctv_catalog` | `direct-provider` | Ontario highway cameras list from Ontario 511 API |
| cctv-fintraffic-digitraffic | `server/providers/cctv/sources.js:582` | `https://tie.digitraffic.fi/api/v1/data/camera-data` | `data-provider` | no | `custom-tool:cctv_catalog` | `direct-provider` | Finland national road weather and traffic camera stations from Digitraffic |
| cctv-drivebc-webcams | `server/providers/cctv/sources.js:734` | `https://www.drivebc.ca/api/webcams/` | `data-provider` | no | `custom-tool:cctv_catalog` | `direct-provider` | British Columbia highway camera feeds from DriveBC API |
| cctv-txdot-its | `server/providers/cctv/sources.js:930` | `https://its.txdot.gov/its/cctv/status/d{district}.json` | `data-provider` | no | `custom-tool:cctv_catalog` | `direct-provider` | Texas DOT intelligent transportation system cameras catalog |
| cctv-tarktee-estonia-locations | `server/providers/cctv/sources.js:1146` | `https://tarktee.transpordiamet.ee/smart-map/webcams` | `data-provider` | no | `custom-tool:cctv_catalog` | `direct-provider` | Estonian Transport Administration (Transpordiamet) road camera locations |
| cctv-tarktee-estonia-images | `server/providers/cctv/sources.js:1150` | `https://tarktee.transpordiamet.ee/smart-map/webcam-images` | `data-provider` | no | `custom-tool:cctv_catalog` | `direct-provider` | Estonian road webcam active image URL lookup |
| cctv-nsw-livetraffic | `server/providers/cctv/sources.js:1369` | `https://api.transport.nsw.gov.au/v1/live/cameras` | `data-provider` | no | `custom-tool:cctv_catalog` | `direct-provider` | New South Wales Australia Live Traffic camera metadata |
| cctv-calgary-socrata | `server/providers/cctv/sources.js:1541` | `https://data.calgary.ca/resource/k7p9-kswdc.json` | `data-provider` | no | `custom-tool:cctv_catalog` | `direct-provider` | City of Calgary traffic camera inventory from open data portal |
| nasa-firms-legacy-proxy | `server/providers/firms.js:80` | `https://firms.modaps.eosdis.nasa.gov/api/area/csv/...` | `data-provider` | no | `/api/sources/fires (docs/ondemand-tools/fire_detection_search.json)` | `direct-provider` | Legacy NASA FIRMS active fire proxy endpoint mounted at /api/firms |
| nasa-firms-mapkey-check | `server/providers/firms.js:143` | `https://firms.modaps.eosdis.nasa.gov/mapkey_status/` | `data-provider` | no | `/api/sources/fires` | `direct-provider` | Validates NASA FIRMS MAP_KEY quota and active transaction count |
| gbfs-feed-proxy | `server/providers/gbfs.js:58` | `https://... (GBFS operators)` | `data-provider` | no | `custom-tool:bikeshare_stations (OpenAPI spec required)` | `direct-provider` | CORS proxy for multi-city GBFS bikeshare station feeds |
| overpass-osm-fetch | `server/providers/overpass/transport.js:202` | `https://overpass-api.de/api/interpreter` | `data-provider` | no | `custom-tool:overpass_features (OpenAPI spec required)` | `direct-provider` | Overpass QL query proxy for OpenStreetMap roads and military installations |
| google-places-nearby-fetch | `server/providers/places/google.js:48` | `https://places.googleapis.com/v1/places:searchNearby` | `data-provider` | no | `plugin-1713924030 (Internet web search) / custom-tool:places_search` | `direct-provider` | Google Places API (New) nearby place search around scene focal point |
| google-places-text-fetch | `server/providers/places/google.js:160` | `https://places.googleapis.com/v1/places:searchText` | `data-provider` | no | `plugin-1713924030 (Internet web search) / custom-tool:places_search` | `direct-provider` | Google Places API (New) text search for facilities and landmarks |
| osrm-routing-fetch | `server/providers/places/routes.js:220` | `https://routing.openstreetmap.de/routed-car/route/v1/` | `data-provider` | no | `custom-tool:route_directions (OpenAPI spec required)` | `direct-provider` | Turn-by-turn vehicle routing directions from OSRM demo server |
| radio-browser-servers-fetch | `server/providers/radio/catalog.js:107` | `https://all.api.radio-browser.info/json/servers` | `data-provider` | no | `custom-tool:radio_browser (OpenAPI spec required)` | `direct-provider` | Discovers active Radio Browser API server mirrors |
| radio-browser-stations-fetch | `server/providers/radio/transport.js:9` | `https://{de1|de2|nl1}.api.radio-browser.info/json/stations/...` | `data-provider` | no | `custom-tool:radio_browser (OpenAPI spec required)` | `direct-provider` | Retrieves public radio stations by country code and coordinates |
| google-news-rss-fetch | `server/providers/regional/news.js:72` | `https://news.google.com/rss/search` | `social/news` | no | `plugin-1722260873 (Perplexity investigation research)` | `direct-provider` | Regional news headlines from Google News RSS feed |
| gdelt-doc-api-fetch | `server/providers/regional/news.js:94` | `https://api.gdeltproject.org/api/v2/doc/doc` | `social/news` | no | `plugin-1722260873 (Perplexity investigation research) / custom-tool:gdelt_news` | `direct-provider` | Global event and crisis news articles from GDELT DOC 2.0 API |
| nominatim-reverse-geocode | `server/providers/regional/place.js:116` | `https://nominatim.openstreetmap.org/reverse` | `geocoder` | no | `custom-tool:reverse_geocode (OpenAPI spec required)` | `direct-provider` | Reverse geocodes coordinates to administrative locality name |
| nominatim-search-geocode | `server/providers/regional/place.js:151` | `https://nominatim.openstreetmap.org/search` | `geocoder` | no | `plugin-1713924030 (Internet web search) / custom-tool:forward_geocode` | `direct-provider` | Forward place search via OpenStreetMap Nominatim |
| open-meteo-weather | `server/providers/regional/weather.js:16` | `https://api.open-meteo.com/v1/forecast` | `data-provider` | no | `custom-tool:weather_forecast (OpenAPI spec required)` | `direct-provider` | Current weather, temperature, wind, and precipitation from Open-Meteo |
| celestrak-tle-fetch | `server/providers/space/celestrak.js:21` | `https://celestrak.org/NORAD/elements/gp.php` | `data-provider` | no | `/api/tools/satellite_search (docs/plugins/satellites/openapi.json)` | `direct-provider` | CelesTrak general perturbations two-line element (TLE) satellite catalog |
| launch-library-2-fetch | `server/providers/space/launch-library.js:72` | `https://ll.thespacedevs.com/2.3.0/launches/` | `data-provider` | no | `custom-tool:rocket_launches (OpenAPI spec required)` | `direct-provider` | Upcoming and recent orbital rocket launch schedules from The Space Devs |
| tomtom-flow-tiles-fetch | `server/providers/traffic.js:138` | `https://api.tomtom.com/traffic/map/4/tile/flow/...` | `tiles/basemap` | no | `UNSUPPORTED (raster map tileset stream)` | `direct-provider` | TomTom Traffic vector/raster flow tiles for road congestion display |
| tomtom-flow-segment-fetch | `server/providers/traffic.js:366` | `https://api.tomtom.com/traffic/services/4/flowSegmentData/...` | `data-provider` | no | `/api/tools/traffic_flow_segment (docs/plugins/traffic/openapi.json)` | `direct-provider` | Detailed speed, delay, and road segment traffic metrics from TomTom |
| aisstream-websocket-live | `server/providers/vessels/ais-live.js:17` | `wss://stream.aisstream.io/v0/stream` | `data-provider` | no | `/api/tools/vessel_search (docs/plugins/vessels/openapi.json)` | `direct-provider` | Live persistent WebSocket stream for marine vessel AIS messages (local dev) |
| aisstream-websocket-serverless | `server/providers/vessels/ais-serverless.js:67` | `wss://stream.aisstream.io/v0/stream` | `data-provider` | no | `/api/tools/vessel_search (docs/plugins/vessels/openapi.json)` | `direct-provider` | Bounded per-scene AISStream WebSocket collector in serverless function |
| aishub-fallback-fetch | `server/providers/vessels/ais-serverless.js:74` | `https://data.aishub.net/ws.php` | `data-provider` | no | `/api/tools/vessel_search` | `direct-provider` | HTTP fallback feed for global vessel positions via AISHub |
| vercel-kv-upstash | `server/providers/vessels/kv-store.js:61` | `https://...upstash.io` | `infra/cdn` | no | `UNSUPPORTED (ephemeral KV cache for serverless vessel deduplication)` | `direct-provider` | Vercel KV / Upstash Redis store for caching vessel snapshots across instances |
| transit-gtfs-rt-proxy | `src/sources/transitService.js:56` | `https://... (GTFS-RT feeds)` | `data-provider` | no | `custom-tool:transit_vehicles (OpenAPI spec required)` | `direct-provider` | Fetches and decodes GTFS-Realtime vehicle position protobuf streams |
| google-fonts-stylesheet | `index.html:29` | `https://fonts.googleapis.com` | `infra/cdn` | **yes** | `UNSUPPORTED (browser web fonts stylesheet)` | `direct-browser` | CDN stylesheet link for Google Fonts typography (Inter, JetBrains Mono) |
| google-fonts-assets | `index.html:34` | `https://fonts.gstatic.com` | `infra/cdn` | **yes** | `UNSUPPORTED (browser web font binary assets)` | `direct-browser` | Preconnect and binary font asset loader for Google Fonts CDN |
| facebook-sdk | `src/data/bhoteKoshiEmbeddedMedia.js:31` | `https://connect.facebook.net/en_US/sdk.js` | `social/news` | **yes** | `UNSUPPORTED (browser social embed script)` | `direct-browser` | Loads Facebook JavaScript SDK in browser for embedded social video post |
| youtube-iframe-api | `src/data/bhoteKoshiEmbeddedMedia.js:80` | `https://www.youtube.com/iframe_api` | `social/news` | **yes** | `plugin-1784356219 (YouTube captions)` | `direct-browser` | Loads external YouTube player runtime for embedded incident video playback |
| youtube-video-embed | `src/data/bhoteKoshiEmbeddedMedia.js:356` | `https://www.youtube-nocookie.com/embed/...` | `social/news` | **yes** | `plugin-1784356219 (YouTube captions)` | `direct-browser` | Iframe embed playing incident coverage video from YouTube |
| facebook-video-embed | `src/data/bhoteKoshiEmbeddedMedia.js:372` | `https://www.facebook.com/plugins/video.php` | `social/news` | **yes** | `UNSUPPORTED (browser social video embed)` | `direct-browser` | Iframe embed playing social media video footage of Bhote Koshi event |
| photon-geocoder-browser | `src/keylessGeocoder.js:2` | `https://photon.komoot.io/api/` | `geocoder` | **yes** | `/api/geocode / plugin-1713924030` | `direct-browser` | Browser directly issues place search queries to Komoot Photon API |
| usgs-allday-browser | `src/layers/earthquakes/source.js:3` | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson` | `data-provider` | **yes** | `/api/sources/earthquakes (/api/tools/earthquake_search)` | `direct-browser` | Browser directly polls USGS GeoJSON feed without routing through serverless proxy |
| radio-stream-audio-playback | `src/layers/radio/playback.js:169` | `<audio src="{station.streamUrl}">` | `data-provider` | **yes** | `UNSUPPORTED (live audio media stream)` | `direct-browser` | Browser HTML5 Audio element directly streams audio from external broadcaster |
| google-3d-tiles-direct | `src/maps/google3d.js:56` | `Google Photorealistic 3D Tiles API` | `tiles/basemap` | **yes** | `UNSUPPORTED (interactive 3D WebGL streaming mesh)` | `direct-browser` | Cesium native 3D tileset stream directly from Google Maps 3D Tiles API |
| cesium-ion-google-3d | `src/maps/google3d.js:71` | `Cesium ion asset 2275207` | `tiles/basemap` | **yes** | `UNSUPPORTED (interactive 3D WebGL streaming mesh)` | `direct-browser` | Cesium ion hosted asset proxy for Google Photorealistic 3D Tiles |
| osm-raster-tiles | `src/maps/imagery.js:9` | `https://tile.openstreetmap.org/` | `tiles/basemap` | **yes** | `UNSUPPORTED (slippy map raster imagery tiles)` | `direct-browser` | OpenStreetMap 2D standard raster tiles loaded directly as imagery layer |
| esri-world-imagery | `src/maps/imagery.js:16` | `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer` | `tiles/basemap` | **yes** | `UNSUPPORTED (satellite base imagery tileset)` | `direct-browser` | Esri World Imagery satellite basemap tiles streamed directly in browser |
| cesium-ion-world-terrain | `src/maps/terrain.js:9` | `Cesium ion asset 1` | `tiles/basemap` | **yes** | `UNSUPPORTED (interactive 3D terrain elevation provider)` | `direct-browser` | Global high-resolution quantized mesh terrain streamed from Cesium ion |
| reearth-terrain-mesh | `src/maps/terrain.js:25` | `https://terrain.reearth.land/cesium-mesh/ellipsoid` | `tiles/basemap` | **yes** | `UNSUPPORTED (interactive 3D terrain mesh tiles)` | `direct-browser` | Keyless open terrain mesh loaded directly into Cesium globe from Re:Earth |
| google-geocode-browser-forward | `src/search/defaults.js:49` | `https://maps.googleapis.com/maps/api/geocode/json` | `geocoder` | **yes** | `/api/geocode / custom-tool:forward_geocode` | `direct-browser` | Browser directly geocodes text queries using client-held Google Maps API key |
| google-geocode-browser-reverse | `src/search/http.js:56` | `https://maps.googleapis.com/maps/api/geocode/json` | `geocoder` | **yes** | `/api/geocode / custom-tool:reverse_geocode` | `direct-browser` | Browser directly reverse-geocodes map coordinates using Google Maps API |
| openai-realtime-token-route | `server/providers/openai.js:38` | `/api/realtime/token` | `ai-model` | no | `/api/ondemand/v2/chat` | `bypass-ai` | Local dev middleware mounting /api/realtime/token; returns 501 in serverless mode |
| openai-realtime-client-secret | `server/providers/openai/realtime.js:19` | `https://api.openai.com/v1/realtime/client_secrets` | `ai-model` | no | `/api/ondemand/stt + /api/ondemand/v2/chat + /api/ondemand/tts (native OnDemand pipeline)` | `bypass-ai` | Direct OpenAI Realtime ephemeral session token minting bypassing OnDemand |
| openai-realtime-sdp-call | `src/voice/realtimeBackend.js:6` | `https://api.openai.com/v1/realtime/calls` | `ai-model` | **yes** | `/api/ondemand/stt + /api/ondemand/v2/chat + /api/ondemand/tts` | `bypass-ai` | Browser WebRTC SDP handshake directly calling api.openai.com |
| openai-realtime-peerconnection | `src/voice/realtimeConnection.js:139` | `new RTCPeerConnection() -> api.openai.com` | `ai-model` | **yes** | `src/voice/ondemand/pipeline.js (OnDemand native voice transport)` | `bypass-ai` | Client-side WebRTC peer connection established directly to OpenAI Realtime servers |
| stub-config-spatial-agent-fallback | `server/ondemand/config.js:737` | `spatialAgentId: defaultPluginIds[0] || ''` | `stub/mock/placeholder` | no | `native-ondemand` | `stub` | Empty string fallback when ONDEMAND_SPATIAL_AGENT_ID is not configured in environment |
| stub-x-mcp-connector-inactive | `server/ondemand/foundation/contracts.js:126` | `availability: 'inactive'` | `stub/mock/placeholder` | no | `plugin-1751872652 (X Search Agent)` | `stub` | plugin-1785777296 defined as inactive because platform rejected session creation |
| stub-intelligence-object-tool-null | `server/ondemand/foundation/intelligence-object.js:262` | `pluginId: null` | `stub/mock/placeholder` | no | `native-ondemand` | `stub` | pluginId is hardcoded to null for tool intelligence objects because tools lack plugin IDs |
| stub-workflow-definition-prompt-placeholder | `server/ondemand/workflow-definition.js:33` | `{trigger} prompt template placeholder` | `stub/mock/placeholder` | no | `native-ondemand` | `stub` | Workflow definition relies on string placeholder substitution rather than typed parameters |
| stub-cctv-placeholder-svg | `server/providers/cctv/media.js:12` | `CCTV FEED PLACEHOLDER SVG` | `stub/mock/placeholder` | no | `UNSUPPORTED (media frame fallback)` | `stub` | Generates synthetic SVG billboard placeholder when CCTV camera frame cannot be fetched |
| stub-google-places-nearby-keyless | `server/providers/places/google.js:64` | `keylessGooglePlacesResponse stub` | `stub/mock/placeholder` | no | `plugin-1713924030 / custom-tool:places_search` | `stub` | Returns fake HTTP 200 payload {configured: false, error: null, places: []} when key is absent |
| stub-google-places-text-keyless | `server/providers/places/google.js:175` | `keylessGooglePlacesResponse stub` | `stub/mock/placeholder` | no | `plugin-1713924030 / custom-tool:places_search` | `stub` | Returns fake HTTP 200 payload {configured: false, error: null, places: []} for text search |
| stub-tomtom-traffic-simulation | `server/providers/traffic.js:25` | `status: 'degraded' (simulated flow)` | `stub/mock/placeholder` | no | `/api/tools/traffic_flow_segment` | `stub` | Keyless TomTom fallback emits HTTP 200 with synthetic simulated flow colors on OSM roads |
| stub-keysetup-badge | `src/keySetup.js:105` | `badge: 'configured externally'` | `stub/mock/placeholder` | **yes** | `native-ondemand` | `stub` | UI badge displays 'configured externally' based on env presence without live connectivity probe |
| stub-firms-queries-unregistered | `src/layers/firms/queries.js:118` | `getDetectableObjects unregistered seam` | `stub/mock/placeholder` | **yes** | `/api/sources/fires` | `stub` | Fire detection overlay method is not yet registered in detection/label-arbiter pipeline |
| stub-traffic-model-badge | `src/layers/traffic/model.js:17` | `SIMULATED — add TomTom key for live` | `stub/mock/placeholder` | **yes** | `/api/tools/traffic_flow_segment` | `stub` | UI badge and loading label displaying simulated status without live sensor data |
| stub-earthquake-tool-id | `src/registry/capabilities.json:14` | `ondemand_tool_id: null` | `stub/mock/placeholder` | no | `/api/tools/earthquake_search` | `stub` | Status 'registered-unverified'; tool ID is null awaiting manual dashboard registration |
| stub-timezone-tool-id | `src/registry/capabilities.json:58` | `ondemand_tool_id: null` | `stub/mock/placeholder` | no | `/api/sources/demo/timezone` | `stub` | Status 'registered-unverified'; tool ID is null awaiting dashboard registration |
| stub-fires-tool-id | `src/registry/capabilities.json:95` | `ondemand_tool_id: null` | `stub/mock/placeholder` | no | `/api/sources/fires` | `stub` | Status 'registered-unverified'; tool ID null and MAP_KEY not configured |
| stub-spatial-agent-id | `src/registry/capabilities.json:135` | `ondemand.agent.pluginId: null` | `stub/mock/placeholder` | no | `native-ondemand (plugin ID assignment)` | `stub` | Agent creation marked dashboard-only; pluginId null in checked-in capability registry |
| stub-spatial-context-reader-skill | `src/registry/capabilities.json:144` | `skillId: null` | `stub/mock/placeholder` | no | `native-ondemand` | `stub` | Placeholder skill definition with null skillId awaiting dashboard attachment |
| stub-intent-classifier-skill | `src/registry/capabilities.json:150` | `skillId: null` | `stub/mock/placeholder` | no | `native-ondemand` | `stub` | Placeholder intent classifier skill with null skillId |
| stub-capability-resolver-skill | `src/registry/capabilities.json:156` | `skillId: null` | `stub/mock/placeholder` | no | `native-ondemand` | `stub` | Placeholder capability resolver skill with null skillId |
| stub-map-action-planner-skill | `src/registry/capabilities.json:162` | `skillId: null` | `stub/mock/placeholder` | no | `native-ondemand` | `stub` | Placeholder map action planner skill with null skillId |
| stub-seismic-analyst-skill | `src/registry/capabilities.json:168` | `skillId: null` | `stub/mock/placeholder` | no | `native-ondemand` | `stub` | Placeholder seismic analyst skill with null skillId |
| stub-aviation-analyst-skill | `src/registry/capabilities.json:174` | `skillId: null` | `stub/mock/placeholder` | no | `native-ondemand` | `stub` | Placeholder aviation analyst skill with null skillId |
| stub-maritime-analyst-skill | `src/registry/capabilities.json:180` | `skillId: null` | `stub/mock/placeholder` | no | `native-ondemand` | `stub` | Placeholder maritime analyst skill with null skillId |
| stub-evidence-verifier-skill | `src/registry/capabilities.json:186` | `skillId: null` | `stub/mock/placeholder` | no | `native-ondemand` | `stub` | Placeholder evidence verifier skill with null skillId |
| stub-structured-response-writer-skill | `src/registry/capabilities.json:192` | `skillId: null` | `stub/mock/placeholder` | no | `native-ondemand` | `stub` | Placeholder response writer skill with null skillId |
| stub-cctv-source-badge | `src/ui/cctvFrames.js:92` | `badge: 'SOURCE · UNKNOWN'` | `stub/mock/placeholder` | **yes** | `UNSUPPORTED (UI state label)` | `stub` | UI badge renders static state labels regardless of upstream camera reachability |
| test-qa-cctv-v2 | `scripts/qa-cctv-v2.mjs:353` | `fetch /api/cctv CCTV QA test harness` | `test-only` | no | `N/A (test harness)` | `test-only` | QA harness testing CCTV multi-origin proxy and catalog endpoints |
| test-qa-chat-harness | `scripts/qa-chat-harness.mjs:50` | `Puppeteer browser chat QA test harness` | `test-only` | no | `N/A (test harness)` | `test-only` | Headless browser test exercising chat widget interaction |
| test-qa-firms | `scripts/qa-firms.mjs:232` | `fetch /api/firms FIRMS QA test harness` | `test-only` | no | `N/A (test harness)` | `test-only` | QA harness verifying active fire detections proxy and status |
| test-qa-firstrun | `scripts/qa-firstrun.mjs:481` | `fetch APP_URL first-run experience QA test harness` | `test-only` | no | `N/A (test harness)` | `test-only` | QA harness verifying clean startup without external credentials |
| test-qa-l9-matrix | `scripts/qa-l9-matrix.mjs:276` | `fetch /api/* L9 layer integration harness` | `test-only` | no | `N/A (test harness)` | `test-only` | QA integration matrix probing all 9 geospatial data layers |
| test-qa-traffic | `scripts/qa-traffic.mjs:115` | `fetch /api/tomtom Traffic QA test harness` | `test-only` | no | `N/A (test harness)` | `test-only` | QA harness verifying TomTom traffic flow proxy and keyless simulation |
| test-qa-transit | `scripts/qa-transit.mjs:1033` | `fetch /api/transit GTFS-RT QA test harness` | `test-only` | no | `N/A (test harness)` | `test-only` | QA harness verifying transit vehicle feed proxying and caching |
| test-qa-voice-routing | `scripts/qa-voice-routing.mjs:189` | `POST /api/realtime/token QA test harness` | `test-only` | no | `N/A (test harness)` | `test-only` | End-to-end QA harness probing voice routes and OpenAI bypass |
| test-ondemand-camera-chat | `server/ondemand/camera-chat.test.mjs:128` | `stubFetchSequence mock camera turns` | `test-only` | no | `N/A (test-only suite)` | `test-only` | Unit tests verifying camera profile SSE streaming with mocked fetch |
| test-ondemand-contract-steps | `server/ondemand/contract-steps.test.mjs:100` | `makeHappyFetchStub contract harness` | `test-only` | no | `N/A (test-only suite)` | `test-only` | Offline test stub verifying 10-step platform contract sequence |
| test-ondemand-foundation | `server/ondemand/foundation/foundation.test.mjs:2` | `mocked fetch foundation tests` | `test-only` | no | `N/A (test-only suite)` | `test-only` | Unit tests verifying typed client and contract validation offline |
| test-ondemand-phase-cdg | `server/ondemand/foundation/phase-cdg.test.mjs:217` | `fakeClient / fakeReq test harness` | `test-only` | no | `N/A (test-only suite)` | `test-only` | Phase C/D/G integration harness verifying orchestrator with fake client |
| test-ondemand-handlers-stub | `server/ondemand/handlers.test.mjs:986` | `stubFetchSequence mock chat queries` | `test-only` | no | `N/A (test-only suite)` | `test-only` | Unit tests mocking OnDemand HTTP responses for chat query handler |
| test-ondemand-key-override | `server/ondemand/key-override.test.mjs:188` | `stubFetchSequence per-request key override` | `test-only` | no | `N/A (test-only suite)` | `test-only` | Unit tests asserting request headers with client vs server API keys |
| test-serverless-guard-501 | `server/serverless/app.test.mjs:134` | `mockReq /api/realtime/token 501 test` | `test-only` | no | `N/A (test-only suite)` | `test-only` | Asserts /api/realtime/token answers 501 unavailable_in_serverless |
| test-serverless-hud-summary-410 | `server/serverless/app.test.mjs:155` | `mockReq /api/openai/hud-summary 410 test` | `test-only` | no | `N/A (test-only suite)` | `test-only` | Asserts /api/openai/hud-summary is retired and returns 410 Gone |
| test-sources-firms | `server/sources/nasa-firms.test.mjs:15` | `mock fetch NASA FIRMS tests` | `test-only` | no | `N/A (test-only suite)` | `test-only` | Offline unit tests mocking NASA FIRMS area CSV responses |
| test-sources-earthquakes | `server/sources/usgs-earthquakes.test.mjs:15` | `mock fetch USGS earthquakes tests` | `test-only` | no | `N/A (test-only suite)` | `test-only` | Offline unit tests mocking USGS FDSN Event web service |
| test-hud-summary-response | `src/hudSummaryResponse.test.mjs:20` | `hudSummaryResponse parsing unit test` | `test-only` | no | `N/A (test-only suite)` | `test-only` | Unit tests verifying five-word HUD summary parsing and formatting |
| test-voice-realtime-backend | `src/voice/realtimeBackend.test.mjs:15` | `mock fetch tokenTransport tests` | `test-only` | no | `N/A (test-only suite)` | `test-only` | Unit tests verifying realtimeBackend state machine and error handling |

---

## Stubs, Placeholders, and Fake States

The audit identified **25 stub, placeholder, simulated, and fake state sites** across configuration, server proxies, and client widgets:

1. `src/registry/capabilities.json:14` (`stub-earthquake-tool-id`): `ondemand_tool_id: null` under `earthquake.search`. Status remains `registered-unverified` because the tool ID was never provisioned from OnDemand dashboard.
2. `src/registry/capabilities.json:58` (`stub-timezone-tool-id`): `ondemand_tool_id: null` under `demo.timezone`. Status remains `registered-unverified`.
3. `src/registry/capabilities.json:95` (`stub-fires-tool-id`): `ondemand_tool_id: null` under `fires.search`. Status is `registered-unverified` and MAP_KEY is absent.
4. `src/registry/capabilities.json:135` (`stub-spatial-agent-id`): `ondemand.agent.pluginId: null`. Documented as dashboard-only with note to paste the pluginId.
5. `src/registry/capabilities.json:144` (`stub-spatial-context-reader-skill`): Skill definition has `skillId: null`.
6. `src/registry/capabilities.json:150` (`stub-intent-classifier-skill`): Skill definition has `skillId: null`.
7. `src/registry/capabilities.json:156` (`stub-capability-resolver-skill`): Skill definition has `skillId: null`.
8. `src/registry/capabilities.json:162` (`stub-map-action-planner-skill`): Skill definition has `skillId: null`.
9. `src/registry/capabilities.json:168` (`stub-seismic-analyst-skill`): Skill definition has `skillId: null`.
10. `src/registry/capabilities.json:174` (`stub-aviation-analyst-skill`): Skill definition has `skillId: null`.
11. `src/registry/capabilities.json:180` (`stub-maritime-analyst-skill`): Skill definition has `skillId: null`.
12. `src/registry/capabilities.json:186` (`stub-evidence-verifier-skill`): Skill definition has `skillId: null`.
13. `src/registry/capabilities.json:192` (`stub-structured-response-writer-skill`): Skill definition has `skillId: null`.
14. `server/ondemand/foundation/contracts.js:126` (`stub-x-mcp-connector-inactive`): `x_mcp_connector` (`plugin-1785777296`) is hardcoded to availability `'inactive'` because OnDemand rejected session creation on 2026-10-20.
15. `server/providers/traffic.js:25` (`stub-tomtom-traffic-simulation`): In keyless mode, the proxy returns HTTP 200 with `status: 'degraded'` and simulated flow colors along OSM road vectors rather than live TomTom sensor speeds.
16. `src/layers/traffic/model.js:17` (`stub-traffic-model-badge`): The UI layer panel displays `SIMULATED — add TomTom key for live` badge / loading label, displaying simulated traffic animations.
17. `server/providers/places/google.js:64` (`stub-google-places-nearby-keyless`): Intercepts requests when `GOOGLE_MAPS_SERVER_API_KEY` is missing and returns a mock HTTP 200 payload `{ configured: false, error: null, places: [] }`.
18. `server/providers/places/google.js:175` (`stub-google-places-text-keyless`): Intercepts text search requests and returns fake HTTP 200 payload `{ configured: false, error: null, places: [] }`.
19. `server/providers/cctv/media.js:12` (`stub-cctv-placeholder-svg`): Generates a synthetic SVG billboard with literal text `<text>CCTV FEED PLACEHOLDER</text>` when a CCTV camera image is unavailable or rate-limited.
20. `src/keySetup.js:105` (`stub-keysetup-badge`): Renders a badge `configured externally` solely based on whether the key name exists in environment, without performing a live connectivity check.
21. `src/ui/cctvFrames.js:92` (`stub-cctv-source-badge`): Renders static UI badges `SOURCE · UNKNOWN`, `FRAME · LOADING`, `FRAME · UNAVAILABLE` regardless of live backend health.
22. `src/layers/firms/queries.js:118` (`stub-firms-queries-unregistered`): Method `getDetectableObjects` for active fire detections notes it is 'NOT yet registered in initDetection's layer objects', leaving fire detections out of the shared detection arbiter.
23. `server/ondemand/workflow-definition.js:33` (`stub-workflow-definition-prompt-placeholder`): Prompt definitions use template placeholders (`{trigger}`, `{input}`) that are resolved via substring replacement rather than typed schema fields.
24. `server/ondemand/config.js:737` (`stub-config-spatial-agent-fallback`): Falls back to `spatialAgentId: defaultPluginIds[0] || ''`, passing an empty string if `ONDEMAND_SPATIAL_AGENT_ID` is unset.
25. `server/ondemand/foundation/intelligence-object.js:262` (`stub-intelligence-object-tool-null`): Intelligence object factory hardcodes `pluginId: null` for tool-derived objects because repo tools lack OnDemand plugin identifiers.

---

## Direct AI Bypass Analysis

The audit identified **4 active call sites** representing the OpenAI Realtime bypass:

1. `server/providers/openai/realtime.js:19`: `endpoint = 'https://api.openai.com/v1/realtime/client_secrets'`. Server-side function that requests an ephemeral client secret token directly from OpenAI using `OPENAI_API_KEY`.
2. `src/voice/realtimeBackend.js:6`: `callsEndpoint = 'https://api.openai.com/v1/realtime/calls'`. Client-side browser module that initiates a direct WebRTC SDP exchange to `api.openai.com`.
3. `src/voice/realtimeConnection.js:139`: `localPc = new RTCPeerConnection()`. Browser creates a direct WebRTC peer connection to OpenAI Realtime infrastructure.
4. `server/providers/openai.js:38`: Connect middleware mounting `/api/realtime/token`. In Vercel serverless mode, this is intercepted by `server/serverless/app.js:160` returning HTTP 501 `unavailable_in_serverless`.

### Migration Status & Sibling Work:
- A sibling agent is currently deleting this bypass and routing voice control through native OnDemand endpoints (`src/voice/ondemand/pipeline.js` -> `src/voice/ondemand/transport.js` -> `/api/ondemand/stt` + `/api/ondemand/v2/chat` + `/api/ondemand/tts`).
- Historical bypasses already resolved:
  - `server/providers/openai/hud-summary.js` was deleted on 2026-10-20 (BLOCKERS B-7); `server/providers/openai.js:20` answers HTTP 410 Gone pointing to `/api/ondemand/v2/summaries/hud`.
  - `ELEVENLABS_API_KEY` was deleted from Vercel on 2026-10-20; guarded by deny-list in `server/ondemand/config.js:400` and `api/ondemand/health.js:125`.

---

## Recommended Plugin Set (OpenAPI Specs for Direct-Provider Routes)

To eliminate `direct-provider` routes and expose them to OnDemand as REST plugins under `/api/tools`, the following OpenAPI 3.0 specifications must exist. Existing specs in `docs/plugins/*/openapi.json` are noted:

### Existing Tool OpenAPI Specs (Already Available under `docs/plugins/`)

1. **Satellites Plugin** (`docs/plugins/satellites/openapi.json`):
   - Tool: `satellite_search`
   - Fronts server route: `GET /api/celestrak` (`server/providers/space/celestrak.js`)
   - Parameters: `name`, `catnr`, `group`, `lat`, `lon`, `alt_km`, `limit`

2. **Flights Plugin** (`docs/plugins/flights/openapi.json`):
   - Tool: `flight_search`
   - Fronts server routes: `GET /api/opensky`, `GET /api/adsblol` (`server/providers/aircraft/opensky.js`, `adsb-lol.js`)
   - Parameters: `box`, `lat`, `lon`, `radius_km`, `hex`, `callsign`, `military_only`

3. **Military Plugin** (`docs/plugins/military/openapi.json`):
   - Tool: `military_installation_search`
   - Fronts server routes: `GET /api/military-installations`, `GET /api/adsblol/mil` (`server/providers/military-installations.js`)
   - Parameters: `box`, `lat`, `lon`, `radius_km`, `kind`, `limit`

4. **Vessels Plugin** (`docs/plugins/vessels/openapi.json`):
   - Tool: `vessel_search`
   - Fronts server route: `GET /api/ais-live` (`server/providers/vessels/ais-live.js`, `ais-serverless.js`)
   - Parameters: `box`, `lat`, `lon`, `radius_km`, `mmsi`, `name`, `type`, `limit`

5. **Traffic Plugin** (`docs/plugins/traffic/openapi.json`):
   - Tool: `traffic_flow_segment`
   - Fronts server route: `GET /api/tomtom` (`server/providers/traffic.js`)
   - Parameters: `lat`, `lon`, `zoom`, `unit`

6. **Earthquakes Plugin** (`docs/plugins/earthquakes/openapi.json`):
   - Tool: `earthquake_search`
   - Fronts server route: `GET /api/sources/earthquakes` (`server/sources/usgs-earthquakes.js`)
   - Parameters: `starttime`, `endtime`, `minmagnitude`, `maxmagnitude`, `latitude`, `longitude`, `maxradiuskm`, `limit`

### Recommended New Tool OpenAPI Specs (To Expose Remaining Direct Routes)

| Target Server Route | Source Provider Module | Proposed Tool Name | Proposed Plugin Path | Key Capabilities / Query Parameters |
|---|---|---|---|---|
| `GET /api/sources/fires` / `GET /api/firms` | `server/sources/nasa-firms.js`, `server/providers/firms.js` | `fire_detection_search` | `docs/plugins/fires/openapi.json` | Active fire detections by bbox, lat/lon radius, sensor source (VIIRS/MODIS), and day range (spec already drafted in `docs/ondemand-tools/fire_detection_search.json`). |
| `GET /api/launches` | `server/providers/space/launch-library.js` | `rocket_launches_search` | `docs/plugins/launches/openapi.json` | Upcoming and recent orbital launches by launch vehicle, pad location, mission type, and agency. |
| `GET /api/terrain/heights` | `server/providers/terrain.js` | `terrain_height_lookup` | `docs/plugins/terrain/openapi.json` | Ellipsoidal elevation lookups for batch coordinates (points=lon,lat;...). |
| `POST /api/overpass` | `server/providers/overpass.js` | `overpass_feature_search` | `docs/plugins/overpass/openapi.json` | Bounded OpenStreetMap infrastructure and feature query by bounding box and amenity/highway tag. |
| `POST /api/google/nearby-places`, `POST /api/google/text-search` | `server/providers/places/google.js` | `place_search` | `docs/plugins/places/openapi.json` | Nearby point-of-interest and textual place search around coordinates with category filtering. |
| `GET /api/route` | `server/providers/places/routes.js` | `route_directions` | `docs/plugins/routing/openapi.json` | Turn-by-turn road routing geometry, distance, and duration between origin and destination coordinates. |
| `GET /api/geocode` | `server/providers/regional/place.js` | `geocoding_lookup` | `docs/plugins/geocoding/openapi.json` | Forward place search and reverse coordinate-to-address geocoding via Nominatim. |
| `GET /api/regional-brief`, `GET /api/weather-effects` | `server/providers/regional/weather.js`, `news.js` | `regional_situation_brief` | `docs/plugins/regional/openapi.json` | Consolidated local weather metrics, storm alerts, and regional news headlines for a point. |
| `GET /api/radio` | `server/providers/radio.js` | `radio_station_search` | `docs/plugins/radio/openapi.json` | Public radio broadcast directory search by country, genre, language, and geographic proximity. |
| `GET /api/gbfs` | `server/providers/gbfs.js` | `bikeshare_status` | `docs/plugins/bikeshare/openapi.json` | Station locations, vehicle availability, and dock capacity across municipal bikeshare networks. |
| `GET /api/transit` | `server/providers/transit.js`, `src/sources/transitService.js` | `transit_vehicle_tracking` | `docs/plugins/transit/openapi.json` | Real-time public transit bus/rail vehicle positions and schedule adherence from GTFS-RT feeds. |
| `GET /api/cctv` | `server/providers/cctv.js`, `server/providers/cctv/sources.js` | `cctv_camera_catalog` | `docs/plugins/cctv/openapi.json` | Highway and municipal camera catalog search across 12 transit agencies with pose and location metadata. |
| `GET /api/adsbdb` | `server/providers/aircraft/enrichment.js` | `aircraft_enrichment` | `docs/plugins/aircraft-enrichment/openapi.json` | Aircraft airframe registration, operator, serial number, and aircraft model specification. |
| `GET /api/opensky-track`, `GET /api/adsblol/trace` | `server/providers/aircraft/tracks.js` | `flight_trajectory_trace` | `docs/plugins/flight-tracks/openapi.json` | Historical flight track geometry points with altitude, speed, and timestamp series by hex callsign. |

---

GENERATED_UTC: 2026-10-21T02:15:18Z
