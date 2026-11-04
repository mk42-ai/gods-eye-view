# FRONTEND RECONNAISSANCE — OnDemand-actionable widget inventory

Branch: `integration/ondemand-native` · Stack: Vite vanilla-JS + Cesium 3D globe ("OnDemand Spatial").
Scope: every static / locally-interactive visualization that must receive an **Ask OnDemand** affordance opening a contextual mini-chat with a structured context payload. All paths verified with `ls` / `grep` on this checkout; line numbers are from the current tree.

Plugin ids used below (all active): `plugin-1722260873` Perplexity research · `plugin-1713924030` Internet web search · `plugin-1741871229` GPT Search · `plugin-1751872652` X Search · `plugin-1716372717` TikTok · `plugin-1716164040` / `plugin-1785987361` Instagram · `plugin-1784356219` YouTube captions · `plugin-1748003575` Reddit · `plugin-1718116202` LinkedIn. `plugin-1785777296` is inactive and is **never** suggested. "custom geo tool" = the repo's own `/api/tools/*` geo tools (e.g. `list_satellites_in_scene`, see `src/ondemand/entityChat.js:382`).

Common payload envelope (every row's "context payload" column fills `fields`; the envelope is always the same):

```json
{
  "schema": "ondemand-spatial/widget-chat/1",
  "objectType": "<aircraft|vessel|satellite|earthquake|fire|camera|layer|panel|instrument|badge|scene|...>",
  "objectId": "<stable id>",
  "label": "<human label>",
  "position": { "lat": 0, "lon": 0, "alt": 0 },
  "timeWindow": { "fromUtc": "…", "toUtc": "…" },
  "fields": { },
  "provenance": { "provider": "<feed>", "fetchedAt": "<iso>" },
  "viewport": { "camera": { "lat": 0, "lon": 0, "heightM": 0, "headingDeg": 0, "pitchDeg": 0 } }
}
```

Legend — interactivity: **static** (display only), **local-only** (toggles/sliders/playback that never leave the browser), **already OnDemand-actionable** (opens the existing `#ondemand-entity-chat` overlay).

---

## 1. Widget inventory

### 1.1 Globe layers + DATA LAYERS panel

| # | Widget | Component path(s) | Interactivity | Data displayed | Ask-OnDemand context payload (`fields`) | Starter prompts | Plugins | Pri |
|---|---|---|---|---|---|---|---|---|
| 1 | DATA LAYERS panel (layer toggle list) | tpl `src/ui/templates/layer-panels.html:3-11` (`#data-panel`, `#data-toggles`) · ctrl `src/ui/layerPanel.js:92` (`class LayerPanel`), `:186` (`_renderToggles`) · `src/ui/layers.js`, `src/ui/layerBindings.js` | local-only (toggle on/off, key-requirement tooltip `layerPanel.js:85`) | layer id, label, enabled, loading/degraded status, key requirement | `objectType:"layerPanel"`, `fields:{layers:[{id,label,enabled,status,count,degraded,provider}], viewportBounds}` | "Which enabled layers currently have data in view and which are stale?" · "Summarize what is happening in this viewport across all active layers." | custom geo tool, plugin-1722260873 | P1 |
| 2 | Flights layer (ADS-B aircraft, tactical cards/labels on globe) | layer `src/layers/flights/index.js:65`, `rendering.js`, `records.js`, `tracking.js:26` · overlay paint `src/overlays/worldOverlayDraw.js:790` (`paintTacticalCard`), `:884` (`paintCard`) · facade `src/app/layers/flights.js` | **already OnDemand-actionable** (selection → `#ask-ondemand-btn`, `context.html:65`; `entityChat.js:1570-1600` listens `gev:entity-selected`) | icao24, callsign, lat/lon/alt, heading, speed, vertical rate, squawk, origin/dest enrichment (`flights/enrichment.js`) | `objectType:"aircraft"` — existing `buildEntityContext` (`entityContext.js:760`) already emits `entity, scene, layers, nearby, tools` | "Where is this flight going and is it on a normal route?" · "Any news about this operator / tail number today?" | plugin-1713924030, plugin-1741871229, plugin-1751872652, custom geo tool | — (done) |
| 3 | Military flights layer | `src/layers/military/index.js:59`, `tracking.js`, `rendering.js` · `src/app/layers/militaryFlights.js` | **already OnDemand-actionable** (same `gev:entity-selected` lane, `kindForLayer` `entityContext.js:58`) | as #2 + military class/registry (`src/data/militaryRegistry.js`, `tr3bRegistry.js`) | `objectType:"aircraft"`, `fields.military:true` | "What is this aircraft type typically used for?" · "Has this callsign been reported on X/Reddit recently?" | plugin-1751872652, plugin-1748003575, plugin-1722260873 | — (done) |
| 4 | Vessels layer (AIS) + selected-vessel HUD card | layer `src/layers/vessels/index.js:80`, `cards.js:15` (`updateSelectedVesselHud`), `:52` (`buildVesselCard`), `:84` (`buildSelectedVesselCard`), `selection.js` | **already OnDemand-actionable** (selection lane) | MMSI, name, type, SOG/COG, destination, draught, lat/lon, last AIS fix | `objectType:"vessel"` — existing entity context | "What is this vessel's recent port history?" · "Is this ship under any sanctions or news coverage?" | plugin-1713924030, plugin-1722260873, plugin-1718116202 | — (done) |
| 5 | Satellites layer + satellite controls (catalog mode) | `src/layers/satellites/index.js:73`, `controls.js:9` (`createControls`), `:72`, `:84`, `tracking.js`, `orbits.js`, `interaction.js` | **already OnDemand-actionable** (entity lane); catalog-mode controls local-only | NORAD id, name, class (`src/data/satelliteClass.js`), altitude, inclination, orbit path, ISS pass (`src/data/issPass.js`) | `objectType:"satellite"` — existing entity context (`SATELLITE_RADIUS_KM` nearby) | "What mission does this satellite serve and who operates it?" · "When does it next pass over my viewport?" | custom geo tool (`list_satellites_in_scene`), plugin-1713924030 | — (done) |
| 6 | Earthquakes layer (USGS magnitude labels) | `src/layers/earthquakes/index.js:15` (`createEarthquakesLayer`), `model.js:19-35` (magnitude label presentation), `records.js:1`, `source.js` · `src/app/layers/earthquakes.js` | static (ambient labels, no selection lane, no card) | magnitude, place, depth, time, lat/lon, USGS id | `objectType:"earthquake"`, `fields:{usgsId,magnitude,depthKm,place,timeUtc,tsunamiFlag}`, `timeWindow:{fromUtc:eventTime}` | "Was this quake felt widely — any damage reports?" · "Is this part of a swarm / aftershock sequence?" | plugin-1713924030, plugin-1751872652, plugin-1748003575, plugin-1722260873 | **P0** |
| 7 | Fires layer (NASA FIRMS hotspots + heatmap + ambient labels) | `src/layers/firms/index.js:42`, `cards.js:8` (`createCards`), `:30` (`rebuildAmbientLabels`), `selection.js`, `model.js`, `queries.js` · `src/data/firmsHeatmap.js`, `firmsLabels.js` | local-only (hover/select, no OnDemand lane) | brightness, FRP, confidence, acq date/time, satellite (VIIRS/MODIS), lat/lon, cluster count | `objectType:"fire"`, `fields:{frp,brightnessK,confidence,sensor,acqUtc,clusterSize,nearestPlace}` | "Is this an active wildfire or agricultural burn? Any local reports?" · "Which communities are downwind of this hotspot?" | plugin-1713924030, plugin-1751872652, plugin-1784356219, plugin-1722260873 | **P0** |
| 8 | CCTV layer (camera gizmos, ambient frame cards on globe) | `src/layers/cctv/index.js:131`, `cards.js:22` (`createCards`), `:50`, `rendering.js`, `selection.js`, `hover.js` · overlay `worldOverlayDraw.js:916` (`paintThumbnail`) | local-only on globe (select → CCTV panel); panel ASK button exists (#9) | camera id/name, provider, source status, heading/FOV, latest frame thumb | reuse camera context (`cameraContext.js:188` `cameraEntityFrom`) — `objectType:"camera"` | "What is visible in this frame right now?" · "Is traffic here heavier than usual?" | custom geo tool (Overpass lanes), plugin-1713924030 | P1 (globe card → same chat as #9) |
| 9 | CCTV panel / camera viewer (frame, source badge, meta, calibration, summary) | tpl `layer-panels.html:16-69` (`#cctv-frame`, `#cctv-source-badge`, `#cctv-meta`, `#cctv-ask-btn:33`, `#cctv-cal-readout:54`, `#cctv-summary:69`) · ctrl `src/ui/cctvBindings.js:1` (`_initCctvPanel`, dispatches `gev:ask-camera` at `:15`), `src/ui/cctvPresentation.js:14` (`_renderCctvState`), `:200` (`_typeCctvSummary`), `src/ui/cctvCalibration.js:160`, `src/ui/cctvControls.js`, `cctvFrames.js` | **already OnDemand-actionable** (`entityChat.js:1613-1615` `openCamera`; frame attach `entityChat.js:808-845`) | frame image, source (live/snapshot/degraded), camera name, heading/FOV/calibration, nearby roads (`cameraContext.js:67`), traffic snapshot (`:105`) | existing camera context (`objectType:"camera"`, per-turn `fulfillmentPrompt`, `TURN_CONTEXT_BYTES` 12 KiB) | "Describe the scene and count vehicles in the attached frame." · "Which lanes are congested and why?" | custom geo tool, plugin-1713924030 | — (done) |
| 10 | Military installations layer + installations search | `src/layers/installations/index.js:43`, `controls.js:5`, `selection.js`, `rendering.js` · `src/data/militaryInstallationData.js` · tpl `context.html:61` (`#installations-search-btn`) | local-only (select/fly-to) | installation name, branch, country, type, lat/lon | `objectType:"installation"`, `fields:{name,branch,country,facilityType,sourceDataset}` | "What units are based here and what is its strategic role?" · "Any recent news or satellite imagery analyses of this base?" | plugin-1722260873, plugin-1713924030, plugin-1751872652 | P1 |
| 11 | Military awareness panel (contacts roster / subject nav) | `src/layers/awareness/panel.js:8` (`createPanel`), `:167` (`renderResults`), `subject.js`, `navigation.js`, `focus.js` · tpl `context.html:67` (`#military-awareness-panel`) | local-only (roster rows, prev/next subject) | contact list (callsign, type, distance, bearing), subject focus | `objectType:"awarenessRoster"`, `fields:{subjectId,contacts:[{id,callsign,class,distanceKm,bearingDeg}]}` | "Which of these contacts are unusual for this region?" · "Brief me on the pattern of military traffic in view." | plugin-1751872652, plugin-1748003575, plugin-1722260873 | P1 |
| 12 | Infrastructure: submarine cables overlay | `src/layers/submarineCables/index.js:53`, `overlay.js:75` (`createCableOverlayEntry`), `:120` (`createCableOverlayPublisher`), `interaction.js` · `src/data/telegeographySubmarineCables.js` | static labels / local hover | cable name, landing points, owners, RFS year | `objectType:"cable"`, `fields:{cableName,landingPoints,ownersCount,rfsYear}` | "Who owns this cable and what capacity does it carry?" · "Any recent outages or cuts reported?" | plugin-1713924030, plugin-1722260873 | P2 |
| 13 | Infrastructure: ALPR cameras overlay | `src/layers/alpr/index.js`, `overlay.js:17` (`createAlprOverlay`), `:107` (`paint`), `records.js`, `presentation.js` · `src/data/alprCameras.js` | static (keyhole paint) | ALPR camera location, operator/source record | `objectType:"alprCamera"`, `fields:{operator,sourceDataset,recordId}` | "Which agency runs this ALPR site?" · "Is there reporting on ALPR coverage in this city?" | plugin-1713924030, plugin-1748003575 | P2 |
| 14 | Traffic / roads layer + traffic controls (incl. DEGRADED provider badge) | `src/layers/traffic/index.js:63`, `controls.js:7` (`createControls`), `:132-173` (DEGRADED / providerStatus text), `flow.js`, `model.js`, `state.js` · tpl `scene-chrome.html:49-51` (`#traffic-sync-chip`) · `src/ui/shellFeedback.js:33-36` | local-only (toggle, sync chip) / static badge | flow speed/congestion per segment, provider status (`degraded`,`stale`,`providerError`), sync progress | `objectType:"trafficLayer"`, `fields:{providerStatus,providerError,degraded,stale,segmentsInView,meanSpeedKph,congestionIndex}` | "Why is this road corridor slow right now?" · "Explain the DEGRADED status — which mirror failed and what's the fallback?" | plugin-1713924030, plugin-1751872652, custom geo tool | **P0** (badge) / P1 (flow) |
| 15 | Transit layer (GTFS-RT vehicles, trails/history) | `src/layers/transit/index.js:82`, `controls.js:8`, `trails.js:27` (`createTrails`), `:236` (`update`), `selection.js`, `qaMetrics.js` · `src/data/gtfsRealtime.js`, `transitFeeds.js` | local-only (select vehicle, trail playback) | route id, trip, vehicle id, bearing, speed, delay, feed, trail history | `objectType:"transitVehicle"`, `fields:{feedId,routeId,tripId,vehicleId,delaySec,bearing,speedKph,trailPoints}` , `timeWindow:{trail}` | "Is this route delayed system-wide today?" · "What are riders saying about this line right now?" | plugin-1713924030, plugin-1751872652, plugin-1748003575 | P1 |
| 16 | Transit history timeline (trail renderer) | `src/layers/transit/trails.js:27-236` · `src/data/contactPlayback.js:47` (`createTrack`), `src/data/trailRenderer.js` | local-only (scrub/replay) | position fixes over time, lag reservoir | `objectType:"timeline"`, `fields:{subjectType:"transit",subjectId,fixes:[{t,lat,lon}],spanSec}` | "Summarize where this vehicle has been in the last 30 min." · "Does the trail show bunching or a detour?" | custom geo tool | P2 |
| 17 | Track history timeline (flights dead-reckoning history) | `src/layers/flights/tracking.js:26` (`createTracking`), `:368-386` (`_positionHistory` replay) · `src/data/contactTrailRenderer.js`, `contactPlayback.js:13-47` | local-only | historical fixes (t, lat, lon, alt), lag | `objectType:"timeline"`, `fields:{subjectType:"aircraft",subjectId,fixes,spanSec}` | "Describe this aircraft's manoeuvres over the last 10 minutes." · "Is it holding, circling, or on approach?" | custom geo tool, plugin-1713924030 | P1 |
| 18 | Bikeshare layer | `src/layers/bikeshare/index.js:50`, `controls.js:3`, `selection.js`, `rendering.js` · `src/data/gbfsSource.js` | local-only | station name, bikes/docks available, system | `objectType:"bikeshareStation"`, `fields:{systemId,stationId,bikes,docks,capacity}` | "Is this station usually empty at this hour?" · "Which nearby stations have bikes?" | custom geo tool, plugin-1713924030 | P2 |
| 19 | Radio layer + radio panel / tuner / mini-dock | `src/layers/radio/index.js:142`, `controls.js:1`, `playback.js`, `tuning.js`, `selection.js` · tpl `context.html:9-35` (`#context-radio-dock`), `:91-140` (`#radio-panel`, `#radio-station-card`, `#radio-tuner`) · `src/ui/radio.js`, `radioBindings.js`, `radioPresentation.js:4` (`renderRadioState`) · cockpit `cockpit.html:254-267` | local-only (play/stop/tune/volume) | station name, country, tags, stream URL, homepage, playback state | `objectType:"radioStation"`, `fields:{stationId,name,country,tags,homepage,playbackState}` | "What is this station known for and who owns it?" · "What is being discussed on local radio here right now?" | plugin-1713924030, plugin-1784356219, plugin-1748003575 | P2 |
| 20 | Rocket launches: space-mission panel + roster | `src/layers/launches/index.js:118`, `panel.js:8` (`createPanel`), `:183` (`renderMissionPanel`), `:277` (`renderMissionRoster`), `:347` (`updateMissionTelemetry`), `replay.js`, `overlays.js` · tpl `context.html:74-76` (`#context-missions-view`, `#space-mission-roster`) | local-only (select mission, replay) | mission name, provider, pad, NET time, status, orbit, telemetry | `objectType:"launch"`, `fields:{launchId,mission,provider,pad,netUtc,status,orbit}` , `timeWindow:{netUtc±24h}` | "What is the payload and who is the customer?" · "Any scrub / delay news in the last hours?" | plugin-1713924030, plugin-1751872652, plugin-1784356219, plugin-1748003575 | P1 |
| 21 | Directions / route layer (turn-by-turn steps, stats) | `src/layers/directions/index.js:268` (`directionsStepList`), `:326` (`directionsStats`), `:406` (`directionsStepCopy`), `:519` (`createDirectionsLayer`) · `src/data/routeSteps.js` | local-only (step markers, fly along) | mode, A/B, distance, duration, steps | `objectType:"route"`, `fields:{mode,from,to,distanceM,durationSec,steps:[{instruction,distanceM}]}` | "Are there incidents or closures along this route now?" · "Suggest a safer / scenic alternative." | custom geo tool, plugin-1713924030 | P2 |
| 22 | Regional briefing / weather (cockpit RIGHT brief: signals, news, local weather) | tpl `cockpit.html:182-228` (`#cockpit-brief-*`, `#cockpit-signal-list:207`, `#cockpit-news-list:211`, `#cockpit-local-temperature:219`, `#cockpit-brief-source:228`) · `src/ui/cockpitBriefing.js:13` (`showBriefPage`), `:105` (`maybeRefreshRegionalBrief`), `:172` (`renderRegionalBriefStatus`), `:189` (`renderRegionalBrief`) · `src/ui/cockpitSignals.js:3`, `:120` · `src/data/regionalBrief.js`, `regionalModel.js` | static (auto-rotating pages; prev/next only) | place, coordinates, temperature, wind, cloud, precipitation, signals list, news headlines, brief source | `objectType:"regionalBrief"`, `fields:{place,weather:{tempC,windDirDeg,cloudPct,precipMm},signals:[…],news:[{title,source}],briefSource}` | "Give me a 3-line situational brief for this region." · "What's driving the headlines here today?" | plugin-1722260873, plugin-1713924030, plugin-1751872652 | **P0** |

### 1.2 Cockpit, HUD, chrome

| # | Widget | Component path(s) | Interactivity | Data displayed | Context payload (`fields`) | Starter prompts | Plugins | Pri |
|---|---|---|---|---|---|---|---|---|
| 23 | Cockpit instruments (speed/altitude rims, compass tape, callsign, vision mode, route direction) | tpl `cockpit.html:2-110` (`#cockpit-hud`, `#cockpit-speed-rim:31`, `#cockpit-altitude-rim:50`, `#cockpit-callsign:72`, `#cockpit-compass-tape:106`) · `src/ui/cockpitInstruments.js:25` (`updateHud`), `:155` (`updateRoute`), `:217` (`setVisionMode`) · `src/ui/cockpitController.js:49` (`CockpitViewController`), `cockpitCoordinator.js`, `cockpitTrackingController.js` · math `src/cockpitMath.js` | static readouts (vision-mode cycle local-only) | tracked contact speed, heading, altitude, callsign/meta, route from/to, clock, position | `objectType:"instrument"`, `objectId:"cockpit"`, `fields:{trackedId,callsign,speedKt,headingDeg,altitudeFt,visionMode,route:{from,to,status}}` | "Explain what these instruments say about this flight phase." · "Is this altitude/speed normal for this aircraft type?" | plugin-1713924030, custom geo tool | P1 |
| 24 | Cockpit context strip (nearest subject, bearing/distance/uncertainty, weather toggle) | tpl `cockpit.html:112-159` (`#cockpit-context*`) · `src/ui/cockpitContext.js`, `cockpitSignals.js:120` (`updateCockpitSignals`) | local-only (prev/next, weather toggle) | nearest subject label, bearing, distance, uncertainty, weather state, updated-at | `objectType:"cockpitContext"`, `fields:{subject,bearingDeg,distanceKm,uncertainty,weatherOn,updatedAt}` | "What is the nearest point of interest and why does it matter?" · "How confident is this nearest-contact estimate?" | custom geo tool, plugin-1713924030 | P2 |
| 25 | Intel HUD summary bar + telemetry corners | `src/hud.js:86` (`class IntelHUD`), `:194-196` (`#hud-summary` markup), `:666` & `:763` (summary writes), `src/hudSummaryResponse.js`, `src/hudLocality.js` · tpl `hud-loading.html:2` (`#intel-hud`) | static (typed AI summary on 15 s cadence, `hud.js:143-156`) | semantic summary line, mode, timestamp, orbit/pass, camera lat/lon/alt, locality | `objectType:"hudSummary"`, `fields:{summaryText,mode,locality,cameraAltM,layersActive}` | "Expand this summary into a full SITREP." · "What changed in the scene since the last summary?" | plugin-1722260873, custom geo tool | **P0** |
| 26 | World overlay action mirror / status (accessible list of painted actions) | tpl `scene-chrome.html:5-7` (`#world-overlay-actions`, `#world-overlay-action-list`, `#world-overlay-status`) · `src/overlays/worldOverlay.js:30-31`, `:2359` (bounded accessible mirror), `:2473/2490` (`paintOverlayEntry`) | static (a11y mirror) | currently painted labels/cards/tracks | `objectType:"overlayScene"`, `fields:{entries:[{sourceId,label,kind}],count}` | "List the most significant entities in view." · "Which painted contacts are closest to each other?" | custom geo tool | P2 |
| 27 | Global loading status / toast / sync chips (traffic, CCTV) | tpl `scene-chrome.html:45-59` (`#global-loading-status`, `#traffic-sync-chip`, `#cctv-sync-chip`, `#toast`) · `src/loadingFeedback.js:48` (degraded), `:130` (`createGlobalStatusNotice`), `:187` (`presentGlobalLoadingStatus`), `:218` · `src/ui/shellFeedback.js:181` (`_showToast`) · `src/ui/cctvPresentation.js:222` (`_updateCctvSyncChip`) | static / transient | layer loading state, failure reason, degraded flag, sync progress | `objectType:"statusNotice"`, `fields:{layerId,status,degraded,error,progressPct}` | "Why did this layer fail and what can I do?" · "Which providers are degraded right now?" | plugin-1713924030 (provider status pages) | P1 |
| 28 | Provider DEGRADED badges (layer-level provider status: traffic, radio, live sources) | `src/layers/traffic/controls.js:132-173` · `src/layers/radio/controls.js` (degraded), `radio/state.js` · `src/sources/live/contract.js` · `src/ui/layerPanel.js:85` (tooltip) | static badge | providerStatus, providerError, mirror list, last-ok time | `objectType:"providerBadge"`, `fields:{layerId,providerStatus,providerError,lastOkUtc,fallback}` | "Explain this DEGRADED status in plain language." · "Is this an upstream outage? Check provider status/news." | plugin-1713924030, plugin-1751872652 | **P0** |
| 29 | 'GATE HELD' gate indicator | `grep -rn "GATE HELD\|gate-held" src/` → **not present** in templates or `src/ui/*.js`; only overlay/cable "sweep gate" logic (`submarineCables/overlay.js:188`) and render governor holds (`src/renderGovernor.js:20`). | n/a | n/a | If added later: `objectType:"gate"`, `fields:{gateId,heldBy,reason,sinceUtc}` | — | — | P2 (absent) |
| 30 | Frame-rate monitor readout | `src/ui/frameRateMonitor.js:2` (`createFrameRateMonitor`), `:10/:30/:38` (readout text) · mounted `src/ui/displayBindings.js:59` · `src/renderGovernor.js` | static chart/readout | FPS, render mode (continuous/idle) | `objectType:"perfMonitor"`, `fields:{fps,requestRenderMode,activeLayers,entityCount}` | "Why is the frame rate low and which layer is costing most?" · "Suggest display settings for smoother playback." | none (local knowledge) / plugin-1713924030 | P2 |
| 31 | MAP STACK chips / style indicator / location mini-status | tpl `command-dock.html:54-62`, `:77-79` · `scene-chrome.html:21-23` · `src/mapStackChips.js:36` (`mapStackChipModel`), `src/mapStackController.js:8`, `src/locationStatus.js:40` (`locationMiniStatus`) | local-only (pick basemap) | active basemap/provider, unavailable reason, mini city/POI | `objectType:"basemap"`, `fields:{stackId,provider,available,unavailableReason,city,poi}` | "What imagery date/resolution is this basemap?" · "Why is this map source unavailable?" | plugin-1713924030 | P2 |

### 1.3 Lists, search, director, settings, onboarding, voice

| # | Widget | Component path(s) | Interactivity | Data displayed | Context payload (`fields`) | Starter prompts | Plugins | Pri |
|---|---|---|---|---|---|---|---|---|
| 32 | Location search results (pills/autocomplete) | tpl `command-dock.html:68-91` (`#location-bar`, `#location-pills`, `#location-search`) · `src/ui/locationSearch.js:4` (`class LocationSearch`), `:49` (`run`) · `src/search/placeSearch.js`, `nominatim.js`, `google.js`, `presetGeocoder.js` | local-only (pick → fly-to) | query, result label/address, lat/lon, provider | `objectType:"searchResults"`, `fields:{query,results:[{label,lat,lon,provider}]}` | "Tell me about this place before I fly there." · "Which of these results is the airport / port?" | plugin-1722260873, plugin-1713924030 | P1 |
| 33 | Director scene cards (scene select, shot list, progress, runtime) | tpl `layer-panels.html:74-106` (`#scene-panel`, `#scene-shot-list:91`, `#scene-progress-fill:104`, `#scene-status:106`) · `context.html:150` (`#scene-runtime`) · `src/ui/scenePresentation.js:27` (`renderSceneOptions`), `:39` (`renderSceneShots`), `:145`, `:152` · `src/ui/sceneControls.js`, `scenes.js:1` · `src/director/document.js`, `timeline.js`, `playback.js`, `sharing/bundle.js` | local-only (capture/run/export) | scene name, shots (camera, duration, layers), progress, runtime | `objectType:"scene"`, `fields:{sceneId,name,shots:[{id,label,durationMs,camera,layers}],progress}` | "Write a narration script for this scene's shots." · "Which shots are redundant or too short?" | plugin-1722260873 | P1 |
| 34 | First-run experience / mission launcher | tpl `welcome.html:5-15` (`#first-run-launcher`, `#first-run-title`, `#first-run-description`) · `src/firstRunExperience.js:205` (`shouldShowFirstRun`), `:330` (`initFirstRunExperience`) · `src/app/startupChrome.js:1-9` | local-only (choose mission) | mission choices, environmental label, live quake/fire counts (`firstRunExperience.js:104`) | `objectType:"onboarding"`, `fields:{missions:[{id,label}],liveCounts:{earthquakes,fires}}` | "Which mission should I start with to see the most activity right now?" · "What can this console do?" | plugin-1722260873 | P2 |
| 35 | Settings drawer / provider key setup (OnDemand settings, chip) | tpl `provider-settings.html:5-18` (`#key-setup-chip`, `#key-setup`) · `src/keySetup.js:21` (`keySetupChipLabel`), `:213` (`render`), `:370` · OnDemand key row inside chat `entityChat.js:41` (`API_KEY_STORAGE_KEY` `ondemand.apiKey`), `:96-116` | local-only (enter keys) | provider key status (set/missing/keyless), OnDemand configured (`/api/ondemand/health`, `entityChat.js:386`) | `objectType:"settings"`, `fields:{providers:[{id,status}],ondemandConfigured,usingOwnKey}` (never the key value) | "Which features are limited because of missing keys?" · "How do I get an OpenSky / TomTom / OnDemand key?" | plugin-1713924030 | P2 |
| 36 | Voice mode panel (OD VOICE: transcript, answer, workflow telemetry) | tpl `command-dock.html:98-118` (`#od-voice-control`, `#od-voice-transcript:116`, `#od-voice-answer:117`, `#od-voice-workflow:118`) · `src/voice/ondemand/ui.js:55` (`createOdVoiceUi`), `:116` (`bindOdVoiceUi`), `pipeline.js`, `transport.js`, `intents.js` | already talks to OnDemand (STT → chat/workflow → TTS) but has **no persistent text mini-chat** → "partially actionable": needs 'continue in chat' affordance | last transcript, streamed answer, route (AUTO/WF/CHAT), execution id/status | `objectType:"voiceTurn"`, `fields:{transcript,answer,route,executionId,status}` | "Continue this voice answer in text with sources." · "Turn this into a scheduled workflow." | inherits voice route | P1 |
| 37 | Existing ASK ONDEMAND entity chat overlay (aircraft/vessel/satellite) | `src/ondemand/entityChat.js:483` (`createEntityChat`), `:1570` (`installEntityChat`) · button `context.html:65` · ctx `src/ondemand/entityContext.js:760` · docs `docs/ENTITY_CHAT.md` | **already OnDemand-actionable** | see §2 | — | — | — | — (reuse base) |
| 38 | Existing camera chat (CCTV ASK, frame attach) | `entityChat.js:808` (`attachFrame`), `:1256-1290` (camera per-turn context), `src/ondemand/cameraContext.js:188` · button `layer-panels.html:33` · docs `docs/ONDEMAND_CAMERA_CHAT_ADDENDUM_2026-09-21.md` | **already OnDemand-actionable** | see §2 | — | — | — | — (reuse base) |

---

## 2. Existing chat overlay implementation (reuse base) — constraints that MUST be preserved

Files: `src/ondemand/entityChat.js` (1639 LOC), `src/ondemand/entityContext.js` (928), `src/ondemand/cameraContext.js` (265). Wired in `src/app/tools.js:6,126` (`installEntityChat({ viewer, dataManager, signal })`).

### 2.1 Context building
- `buildEntityContext()` — `entityContext.js:760-795`: returns `{ schema:'ondemand-spatial/entity-chat/1' (:23), generatedAtUtc, entity: normalizeEntity() (:235), scene: describeScene() (:615, camera + MGRS via toMgrs :83), layers: describeLayers() (:428, per-layer status text :397), nearby: collectNearby() (:523, NEARBY_RADIUS_KM=250 :41, SATELLITE_RADIUS_KM=1500 :43, MAX_NEARBY=10 :24), tools:{catalogue (:690), workflow (:727)}, limits }`.
- Budget: `fitContextToBudget()` `:808`, `CONTEXT_BYTE_BUDGET = 28 KiB` `:45`; camera per-turn budget `TURN_CONTEXT_BYTES = 12 KiB` (`entityChat.js:53`, `turnPrompt` `:799-806`).
- Prompting: `entitySystemInstruction()` `:882`, `entitySystemPrompt()` `:918`, camera lines `:864`. The first turn is a **sync priming turn** (`fulfillmentOnly:true`, `entityChat.js:1064-1073`), every later turn is **stream**.
- Camera: `cameraEntityFrom()` `cameraContext.js:188` (id, provider, sourceStatus, lat/lon, headingDeg, fovDeg), Overpass lanes `:56-97` (radius 60 m, 12 roads), `trafficSnapshot()` `:105`, `frameFromDocument()` `:159`; context is **rebuilt every camera turn** (`entityChat.js:1258-1279`) and sent as `modelConfigs.fulfillmentPrompt` (`:1280`).
- Satellites-in-scene enrichment via custom geo tool `/api/tools/list_satellites_in_scene` (`entityChat.js:382`) + `/api/ondemand/health` (`:386`, `:1159`).

### 2.2 Transport / streaming
- Same-origin proxy only (header comment `:6-11`): `POST /api/ondemand/sessions {userId, reuse:false}` (`:1041`), `POST /api/ondemand/chat` sync prime (`:1073`), `POST /api/ondemand/chat {sessionId, query, responseMode:'stream'}` with `Accept: text/event-stream` (`:1301-1308`), media upload `POST /api/ondemand/media` multipart (`:837`), history `GET /api/ondemand/sessions?sessionId&limit&cursor` (`:872-888`, `HISTORY_MAX_PAGES = 3` `:51`).
- SSE is consumed with **fetch + `response.body.getReader()`** (not `EventSource`) — `:1347-1356`, decoded with a streaming `TextDecoder`, parsed by `createSseParser()` `:233-345` (handles `event:` lines, `:` keepalives, `data:[DONE]`, `data:[ERROR]:<json>`, `fulfillment` / `statusLog` / `metricsLog` payloads; `flush()` `:324`). `AbortController` per turn `:1297`.
- Optional user key: localStorage `ondemand.apiKey` (`API_KEY_STORAGE_KEY` `:41`) sent **only** as `x-ondemand-key` header (`keyHeaders()` `:550-555`), never in body/log.
- Errors: `proxyErrorMessage()` `:214` (501 not-documented, 503 not_configured, 429 rate_limit). Per-call telemetry `noteApiCall` (`:1310`), first-token latency badge `setLatency()` `:942`.

### 2.3 Rendering constraints (verified — no rAF coalescing / no virtualization exists)
- Transcript is a plain `div#ondemand-entity-chat-transcript` (`:676-685`); `appendMessage()` `:907-922` appends one node per message; streaming deltas go through `updateMessage()` `:924-929` which sets `textContent` on **every** SSE fulfillment event (`:1333-1337`). **There is no `requestAnimationFrame` coalescing anywhere in `src/ondemand/*`** (`grep -n requestAnimationFrame src/ondemand/*.js` → 0 hits), no virtualized/limited row rendering (history is bounded only by `HISTORY_MAX_PAGES`×server limit, `:872-873`), and scroll anchoring is a hard pin `scrollTop = 1e9` after every append/update (`:918-919`, `:927-928`).
- Streaming bubble is flagged `data-streaming="true"` (`:1292`); history rows `data-history="true"` + `data-message-id` (`:1188-1190`); error rows swap class to `od-chat__msg--error` (`:1379-1384`).
- Constraints to preserve in the generic panel: (a) **same selector contract** `SELECTORS` `:55-76` (test harnesses drive it headlessly); (b) injectable `document/window/fetch/storage/now/performanceNow` (`:484-500`) so it runs under `node:test` fake DOM; (c) transcript must keep bottom-pinned while streaming; (d) status line vocabulary (`BUILDING CONTEXT… / OPENING SESSION… / LOADING CONTEXT / STREAMING… / READY · … · session …`); (e) a generic panel **should add** rAF coalescing of `updateMessage` and a row cap (e.g. keep last N nodes, older collapsed) — these are improvements, not existing behaviour, and must not break (a)–(d). The Cesium side separately relies on `renderGovernor.js` request-render holds — the chat must not force continuous render.

### 2.4 Session keying
- `externalUserIdFor()` `:198` → `ondemand-spatial-entity-<yyyy-mm-dd>` (UTC day, `EXTERNAL_USER_PREFIX` `:44`).
- Entity key `entityKeyFor(kind, entity)` `:204` → `<kind>:<id>`; in-memory `sessions: Map<entityKey, {promise, sessionId, context, primedOk, error, historyRows}>` `:543-544`, one session per entity for the page lifetime; `ensureSession()` `:985`.
- **Persistent (localStorage) only for cameras**: `SESSION_STORAGE_PREFIX = 'ondemand.session.'` `:47`, `readStoredSession/writeStoredSession` `:123-157`, written after create (`:1056-1060`), reused + history reloaded on open (`:1003-1038`, drop on 404). Aircraft/vessel/satellite sessions are memory-only.
- Selection lanes feeding the ASK button: `gev:awareness-subject-selected`, `gev:entity-selected`, `*-cleared` (`:1598-1601`) and `gev:ask-camera` (`:1613-1615`, dispatched by `src/ui/cctvBindings.js:15`).

---

## 3. Proposed generic API (signatures only)

```js
// src/ondemand/askOnDemandButton.js
/** Mount an "ASK ONDEMAND" affordance next to any widget. Returns { element, update(ctx), destroy() }. */
export function createAskOnDemandButton({
  host,                 // HTMLElement to append into (or `before`/`after` sibling)
  getContext,           // () => WidgetContext  (see §3 envelope; built lazily on click)
  label = 'ASK',
  variant = 'chip' | 'icon' | 'inline',
  panel,                // MiniChatPanel instance (shared singleton) — opened on click
  starterPrompts = [],  // string[] shown as suggestion chips on first open
  plugins = [],         // pluginIds forwarded to the proxy profile
  document = globalThis.document,
} = {}) {}

/** Declarative variant: data-ask-ondemand="<objectType>" data-ask-id="<objectId>" on existing nodes. */
export function installAskOnDemandAffordances({ root, registry, panel, signal } = {}) {}

/** Context provider registry so layers/panels register builders without importing the chat. */
export function registerContextBuilder(objectType, builder /* (objectId, deps) => Promise<WidgetContext> */) {}

// src/ondemand/miniChatPanel.js  (generalisation of createEntityChat)
export function createMiniChatPanel({
  document, window, fetch, storage, now, performanceNow,   // injectable like entityChat.js:484-500
  apiBase = '', endpointId = null,
  externalUserId = externalUserIdFor,                        // (now) => string
  sessionKey = defaultSessionKey,                            // (ctx) => `${externalUserId}|${ctx.objectType}:${ctx.objectId}`
  persistSessions = (ctx) => ctx.objectType === 'camera',    // localStorage policy (ondemand.session.<key>)
  profileFor = (ctx) => ctx.objectType,                      // proxy profile → server picks endpoint/agents/plugins
  contextBudgetBytes = 28 * 1024, turnContextBytes = 12 * 1024,
  renderOptions = { coalesceWithRaf: true, maxRows: 200, pinToBottom: true },
} = {}) {
  return {
    open(ctx /* WidgetContext */, { anchorEl, starterPrompts, plugins } = {}),
    send(text, { attach = null, refreshContext = false } = {}),
    refreshContext(ctx),                                     // re-prime fulfillmentPrompt without new session
    close(), destroy(),
    getState(),                                              // same shape as entityChat getState() :1523-1546
    selectors,                                               // superset of entityChat SELECTORS :55-76
  };
}

/** Session identity helpers (shared with entityChat.js so camera/entity sessions are unchanged). */
export function sessionKeyFor({ externalUserId, objectType, objectId }) {}
export function readStoredSession(storage, sessionKey) {}   // existing entityChat.js:123
export function writeStoredSession(storage, sessionKey, record) {} // existing entityChat.js:140

// src/ondemand/widgetContext.js
export function buildWidgetContext({ objectType, objectId, label, position, timeWindow, fields, provenance, viewer, dataManager, now }) {} // → envelope in header
export function fitWidgetContextToBudget(ctx, maxBytes) {}  // delegate to entityContext.fitContextToBudget :808
```

Adoption order: wrap `createEntityChat` as `createMiniChatPanel` with `profileFor()` returning `'camera'` for cameras (keeps `CAMERA_PROFILE` `:49`) and the existing `entityContext` builder registered for `aircraft|vessel|satellite|camera`, then add builders for P0 object types (`earthquake`, `fire`, `regionalBrief`, `hudSummary`, `providerBadge`, `trafficLayer`).

---

## 4. Counts

| Metric | Count |
|---|---|
| Total widgets inventoried | **38** (incl. #29 absent gate indicator, #37/#38 reuse-base rows) |
| Already OnDemand-actionable | **7** (#2 flights, #3 military flights, #4 vessels, #5 satellites, #9 CCTV panel, #37 entity chat overlay, #38 camera chat) — #36 voice is only partially actionable and is counted under P1 |
| Needs affordance | **31** (30 present + #29 absent placeholder) |
| **P0** | **6** — #6 earthquakes, #7 fires, #14 traffic/roads layer + DEGRADED badge, #22 regional briefing/weather, #25 HUD summary, #28 provider DEGRADED badges |
| **P1** | **12** — #1 DATA LAYERS panel, #8 CCTV globe cards, #10 installations, #11 awareness roster, #15 transit, #17 track history, #20 launches, #23 cockpit instruments, #27 status/toast/sync chips, #32 search results, #33 director scene cards, #36 voice panel |
| **P2** | **13** — #12 cables, #13 ALPR, #16 transit history, #18 bikeshare, #19 radio, #21 directions, #24 cockpit context, #26 overlay mirror, #29 gate indicator (absent in code), #30 FPS monitor, #31 map stack/location status, #34 first-run, #35 settings |

(7 + 6 + 12 + 13 = 38.)

Verification commands used: `ls src/ui/templates src/ondemand src/layers/*`, `grep -nE 'id="' src/ui/templates/*.html`, `grep -n requestAnimationFrame src/ondemand/*.js` (0 hits), `grep -rn "GATE HELD" src` (0 hits in UI), function/line greps on each cited file.

GENERATED_UTC: 2026-10-20T21:40:47Z
