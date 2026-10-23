# Gods-Eye scene engine — module contracts (2026-10-23)

Everything new lives under `src/gods-eye/` (browser ES modules, no Node builtins, no
framework; Vite build). One owner per folder; folders never import *into* each other
except through the public entry files named below. Nothing in `src/gods-eye/` may
touch `window` at import time (unit tests run under `node --test`); DOM/Cesium are
injected at install time.

```
src/gods-eye/
  scenes/        store, reducer, models, persistence, share, prompt parser, AOI register   (Agent 1)
  footage/       normalisers, geo-resolver, ranker (+worker), TTL cache, pipeline          (Agent 2)
  route/         route-agent client, great-circle fallback, 5-min cache, dwell monitor     (Agent 3)
  camera/        S0..S4 ladder, controller (Cesium), VIIRS layer                           (Agent 3)
  ui/tokens.css  design tokens (written by the orchestrator, read-only for agents)
  ui/scene/      header, rail, timeline, player, map layers, evidence strip, posters      (Agent 4)
  ui/scenes-panel/  scene cards + START/NEXT/STOP wiring                                   (Agent 5)
  ui/sidebar/    sources sidebar + "Add site to register?" modal                           (Agent 5)
  orchestrator.js  wires everything (orchestrator — do not edit)
api/footage/route.py   POST /footage/route/plan, /footage/scenes CRUD (Agent 3)
tests/e2e/*.spec.ts    Playwright acceptance tests 1..18, tests/fixtures/*.json (Agent 6)
```

Existing modules you MAY import (read-only):
- `src/footage/model.js` — `PLACES` (offline Dubai place table), `parseCommand(text)` →
  `{verb, incident, place:{name,lat,lon}|null, raw}` or null, `freshnessOf`, `formatUtc`, `formatDate`.
- `src/footage/client.js` — `createFootageClient({fetch, base='/footage'})` →
  `{health, search, stream(params, handlers, {signal})}`; handlers `onQuery, onSourceStart({source}),
  onItem(item), onSourceDone({source,status,count,error,ms}), onDone(payload), onError(err)`.
  Backend item schema: `{source, title, url, embed_url, play_url, thumb, published_at (ISO UTC),
  published_precision, freshness LIVE|RECENT|ARCHIVE, relevance 0..1, score, author, canonical}`.
  Backend `source_done.status` ∈ `ok|error|unavailable|quota|timeout`; `error` text may contain
  "not subscribed"/"inactive" (→ `inactive`) or "quota" (→ `quota`).
- `src/aoi/membership.js` — `haversineKm(lat1,lon1,lat2,lon2)`.

## 1. Data models (`src/gods-eye/scenes/models.js`, Agent 1) — EXACT shapes

```js
Scene = {
  id: 's_<base36 time><rand>', title, prompt, label: 'UAE Interest Watch',
  kind: 'live'|'incident'|'rebuild',
  aoi: { id, name, country, category: 'home'|'active-presence'|'claim'|'border-protection', inRegister: bool },
  target: { name, lat, lon, geocodeSource: 'dictionary'|'register'|'nominatim'|'prompt', confidence: 0..1 },
  tRef: ISO-8601 UTC string,            // live: now; incident: estimated time; rebuild: reported date
  tRefLabel: string,                    // 'estimated 14:32 GST ±10 min' | 'reported 2026-09-26'
  preset: { alt: 18000, heading: number, pitch: 60, dwell: [4.2, 11] },
  route: { scenePath: Waypoint[], approachBearing, groundRoutes: GroundRoute[], alerts: Alert[],
           confidence: 0..1, basis: string, fallback: bool },
  camera: { lat, lon, alt, heading, pitch, roll, stage: 'S0'|'S1'|'S2'|'S3'|'S4' },
  sources: { tiktok|instagram|youtube|x|reddit|web: { enabled: bool, status: 'idle'|'pending'|'ok'|'quota'|'inactive'|'error', count: n, latencyMs: n } },
  footage: FootageItem[],
  timeline: { start: ISO, end: ISO, markers: [{ at: ISO, kind: 'clip'|'alert'|'tRef', label, refId }] },
  lifecycle: { createdAt: ISO, lastBuiltAt: ISO, buildCount: n, isNew: bool /* <24h */, archivedAt: ISO /* createdAt+72h */ },
  status: 'idle'|'parsing'|'geocoded'|'routing'|'flying'|'fetching'|'ranked'|'playing'|'saved'|'error',
  error: null | { code, message },
}
Waypoint   = { lat, lon, alt, heading, pitch, durationMs, easing: 'quadInOut', stage: 'S0'..'S4', revealLayers: string[] }
GroundRoute= { id, name, kind: 'motorway'|'arterial'|'street'|'sea-lane', geometry: [[lat,lon],...],
               status: 'open'|'restricted'|'closed'|'unknown', lastChecked: ISO, source: string }
Alert      = { id, at: ISO, severity: 'info'|'warn'|'critical', text, routeId|null, lat|null, lon|null }
FootageItem = {
  id, sceneId, platform: 'tiktok'|'instagram'|'youtube'|'x'|'reddit'|'web',
  mediaUrl, embedUrl, thumbUrl, authorHandle, authorAvatar, caption, hashtags: string[],
  uploadedAt: ISO, capturedAt: ISO|null,
  location: { lat, lon, confidence: 'exact'|'inferred'|'unknown', basis: string },
  distanceKm: number|null, timeDelta: seconds (signed, uploadedAt - tRef) | null,
  recency: 'LIVE'|'RECENT'|'ARCHIVE', rankScore: 0..1, sourceUrl,
  pluginMeta: { icon: string /* /posters or platform icon path */, rawPayloadRef: string },
}
```
Factories: `createScene(partial)`, `createFootageItem(partial)`, `sceneLifecycle(scene, nowMs)`
(recomputes isNew/archivedAt), `SCENE_STATES` (ordered array), `SOURCE_PLATFORMS`
(`['tiktok','instagram','youtube','x','reddit','web']`), `STAGES` (`['S0','S1','S2','S3','S4']`).

## 2. Store (`src/gods-eye/scenes/store.js`, Agent 1)

`createSceneStore({ persistence, now = () => Date.now() })` →
```
getState() → { scenes: {[id]: Scene}, order: string[], activeId: string|null, playback: {running, queue:[], index, phase:'idle'|'travel'|'dwell-s2'|'dwell-s4'}, ui:{} }
dispatch(action) ; subscribe(fn) → unsubscribe ; select(fn)
beginScene(id) → AbortSignal   // aborts the previous active scene's signal; artefacts tagged by sceneId
abortScene(id) ; signalFor(id)
upsertScene(scene) ; patchScene(id, partial) ; setActive(id) ; removeScene(id)
mergeFootage(id, items[])        // dedupe by item.id, keep rankScore order; ignored when id !== activeId unless {force}
setSourceStatus(id, platform, {status,count,latencyMs})
setStatus(id, status, error?)     // validates transition via reducer
```
Reducer (`reducer.js`): `reduce(state, action)`; actions `SCENE_UPSERT, SCENE_PATCH, SCENE_REMOVE,
SCENE_ACTIVE, SCENE_STATUS, FOOTAGE_MERGE, SOURCE_STATUS, PLAYBACK_SET, RESET`. Transition table:
idle→parsing→geocoded→routing→flying→fetching→ranked→playing→saved; any→error; error→parsing;
saved→routing (Recreate) ; saved→playing (Open). Illegal transitions throw `SceneStateError`.

Persistence (`persistence.js`): `createPersistence({ indexedDB, name='gods-eye', fetch })` →
`{ save(scene), load(id), list(), remove(id), clear() }` IndexedDB with in-memory fallback, PLUS
best-effort mirror to `/footage/scenes` (PUT/GET/DELETE; failures ignored).

Share (`share.js`): `encodeSceneShare(params: URLSearchParams, scene)` writes
`sc=<sceneId>` + fallback `fv=1 fk=<keywords> fm=<live|rebuild> fs=<tRef> gr=<approachBearing>` and
camera `lat lon alt heading pitch roll`; `decodeSceneShare(hashOrParams)` → `{ sceneId|null, fallback:{...}|null }`.
NOTE: legacy `sc=0|1` is the scope toggle — a scene id always starts with `s_`; decoder treats
other values as legacy scope.

AOI register (`aoiRegister.js` + `aoiRegister.seed.json`): seed entries
`{id,name,country,lat,lon,category,radiusKm}` for UAE (7 emirates + Burj Khalifa 25.1972/55.2744,
Umm Suqeim 25.147/55.199), Iran claim islands (Abu Musa 25.8733/55.0322, Greater Tunb 26.2658/55.3064,
Lesser Tunb 26.2403/55.1458), Yemen presence (Hodeidah 14.7978/42.9545, Aden 12.7855/45.0187,
Mukalla 14.5425/49.1242, Socotra 12.4634/53.8237, Perim/Mayun 12.6567/43.4147), Somalia presence
(Berbera 10.4396/45.0143, Bosaso 11.2842/49.1816, Mogadishu 2.0469/45.3182), border-protection
(Al Ghuwaifat 24.1167/51.5833, Hatta 24.8033/56.1200, Khor Fakkan 25.3390/56.3480, Fujairah 25.1288/56.3265,
Hormuz approaches 26.3000/56.4000). API: `loadRegister({storage})`, `findAoi(lat,lon)` → entry+`distanceKm`
or null (inside when distance ≤ radiusKm), `addAoi(entry,{storage})`, `listAoi()`.

Prompt (`prompt.js`): `parsePrompt(text)` → `{ kind, verb, incident, placeName, raw }` (uses
`parseCommand` from `src/footage/model.js` + extra patterns: bare place → kind 'live';
"<verb> the <incident> reported in <place>" → 'rebuild'; "<incident> in <place>" → 'incident').
`geocodePlace(name, { fetch, register })` → `{name, lat, lon, geocodeSource, confidence}` or null:
dictionary (`PLACES`) → register → Nominatim `https://nominatim.openstreetmap.org/search?format=jsonv2&q=`.
`deriveTRef({kind, text, now})` → `{tRef, tRefLabel}`; rebuild of the Umm Suqeim crash → `2026-09-26T00:00:00Z`,
`'reported 2026-09-26'` (known-incident table: `{ 'umm suqeim|car crash': '2026-09-26' }`).

## 3. Footage pipeline (`src/gods-eye/footage/`, Agent 2)

- `normalisers.js`: `normaliseItem(raw, { sceneId })` → FootageItem (platform from `raw.source`:
  `instagram+web|instagram-plugin→instagram`, `facebook→web`); `platformIcon(platform)` → `/icons/platforms/<p>.svg`
  (Agent 2 writes 6 small SVGs to `public/icons/platforms/`). `statusFromSourceDone({status,error})` →
  `'ok'|'quota'|'inactive'|'error'`.
- `geoResolver.js`: `resolveLocation(item, scene, { places = PLACES, register })` → `location` (geotag →
  place tag → caption/hashtag dictionary hit (inferred) → landmark → scene target (unknown, basis 'scene-target')).
  Never `exact` unless `raw.lat/lon` present.
- `ranker.js` (pure): `haversineKm`, `timeDeltaSec(uploadedAt, tRef)`, `recencyOf(uploadedAt, nowMs, kind)`
  (ARCHIVE only when `kind==='rebuild'` OR age>24h), and the documented formula
  `rankScore = 0.35*distanceScore + 0.30*timeScore + 0.25*relevance + 0.10*geoConfScore` with
  `distanceScore = exp(-distanceKm/3)`, `timeScore = exp(-|timeDelta|/(6h))` (rebuild: `/(30d)`),
  `geoConfScore = exact 1 / inferred 0.6 / unknown 0.2`. `rankItems(items, scene, nowMs)` returns a NEW
  sorted array with distanceKm/timeDelta/recency/rankScore filled. `clusterItems(items, project, px=100, min=8)`.
- `rank.worker.js` + `rankClient.js`: `createRanker({ Worker })` → `{ rank(items, scene) → Promise }`,
  falling back to sync `rankItems` when `Worker` is undefined.
- `cache.js`: `createFootageCache({ now })` → `get(key)`, `set(key, items, recency)`, `keyFor({sceneId, platform, query, tRef})`;
  TTL live 60 s / recent 10 min / archive 24 h; `stats()` → `{hits, misses}`.
- `pipeline.js`: `runFootagePipeline({ scene, client, ranker, cache, signal, enabled: {platform:bool},
  onItem(item), onSource(platform, status), onRanked(items), onDone(summary) })` → Promise<summary>
  `{ items, sources: {platform:{status,count,latencyMs}}, cacheHit: bool, earliestUploadedAt }`.
  Query params to `client.stream`: `{lat, lon, radiusKm: 5, keywords: scene.prompt incident words,
  since: kind==='rebuild' ? '2y' : '24h', mode: kind==='rebuild' ? 'rebuild' : 'live', limit: 30, place: target.name}`.
  Respects `signal` (abort → stop, no further callbacks). Items from a stale scene are dropped
  (`item.sceneId !== scene.id`).

## 4. Route + camera (Agent 3)

`route/client.js`: `planRoute({ origin:{lat,lon,alt}, target:{lat,lon,name}, aoiId, tRef, preset, pins, fetch,
signal, timeoutMs = 4000, cache })` → `Scene.route`. POST `/footage/route/plan` JSON body, expects the same
shape back; on timeout / non-2xx / network error → `fallbackRoute(...)` with `fallback:true, basis:'great-circle-fallback', confidence:0.3`.
`route/fallback.js`: `fallbackRoute({origin, target, preset})` builds the default ladder path through
`camera/ladder.js` + curated Dubai ground routes when target within 15 km of Dubai (Sheikh Zayed Rd,
Al Wasl Rd, Jumeirah St with `status:'unknown'`, `source:'curated-table'`).
`route/cache.js`: 5-min TTL keyed `(round(origin,2), round(target,3), aoiId)`.
`route/monitor.js`: `startRouteMonitor({ sceneId, fetch, intervalMs=15000, signal, onAlert })` polls
`/footage/route/alerts?sceneId=` and emits new alerts.

`camera/ladder.js`: `LADDER = [S0 8_000_000 m pitch -90 hold 1500, S1 1_200_000 m pitch -70 hold 1500,
S2 18_000 m pitch -60 hold 4200, S3 2_000 m pitch -45 hold 1500, S4 300 m pitch -30 hold 11000]`
(pitch values are Cesium pitch in degrees, negative = looking down; spec's "pitch 60°" at S2 = -60).
`buildScenePath({origin, target, preset, approachBearing})` → Waypoint[] with travel durations summing
9–12 s; `stageForAltitude(alt)`; `interpolate(a, b, t)`; `totalTravelMs(path)`.
`camera/controller.js`: `createCameraController({ viewer, Cesium, reducedMotion, dispatch })` →
`{ flyScenePath(path, {signal, sceneId}) → Promise<'arrived'|'aborted'>, setStage(stage, path), cancel(),
stageForCurrentAltitude() }`. Each waypoint → `camera.flyTo({destination, orientation, duration,
easingFunction: QUADRATIC_IN_OUT, complete, cancel})`; on `complete` dispatch
`window.dispatchEvent(new CustomEvent('gev:scene-stage', {detail:{sceneId, stage, revealLayers}}))` via the injected
`dispatch(stage, waypoint)`. S3→S4: `sampleTerrainMostDetailed`/`scene.clampToHeight` guard (min 60 m AGL).
Reduced motion: `camera.setView` + `document.documentElement.dataset.geFade='1'` for 150 ms, same stage order.
`camera/viirs.js`: `createViirsLayer({viewer, Cesium})` → `{show(), hide(), isShown()}` using
`WebMapTileServiceImageryProvider` url `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi`,
layer `VIIRS_CityLights_2012`, tileMatrixSetID `500m`, format `image/jpeg`, `GeographicTilingScheme`,
maximumLevel 8.

Python (`api/footage/route.py`, mounted from `index.py`): `POST /footage/route/plan` → tries OnDemand
Route Monitoring Agent `plugin-1750847932` (4 s budget) through `ondemand_client.py`; the account is NOT
subscribed → returns the deterministic great-circle plan with `fallback:true, basis:'great-circle-fallback',
agent:{status:'inactive'}`. `GET /footage/route/alerts?sceneId=` → `{alerts:[]}` (+ `?mock=1` returns one alert).
`/footage/scenes` CRUD (GET list, GET /:id, PUT /:id, DELETE /:id) in-memory per instance. `GET /footage/health`
adds `route_agent:{plugin:'plugin-1750847932', status}`.

## 5. UI (Agents 4 + 5) — DOM ids and data attributes (tests depend on these)

Tokens: `src/gods-eye/ui/tokens.css` (`--ge-*`), 8-pt grid (`--ge-space-1..6` = 4/8/16/24/32/48 px),
type scale (`--ge-fs-xs 10px, -sm 11px, -md 12px, -lg 14px, -xl 18px`), colours
(`--ge-bg #070f16`, `--ge-ink #f3f3f3`, `--ge-teal #3bb795`, `--ge-amber #f5a623`, `--ge-red #ff5a4e`,
`--ge-grey #8a9a99`, `--ge-live #35d07f`, `--ge-recent #f5a623`, `--ge-archive #8a9a99`), motion
`--ge-motion 180ms`. Focus ring `outline: 2px solid var(--ge-teal); outline-offset: 2px`.

`ui/scene/index.js`: `installSceneUi({ document, window, store, viewer, Cesium, host, onSelectItem, onScrub })`
→ `{ destroy, elements }`. Renders only when `store.activeId` is set; nothing in the DOM before that
except an empty hidden root `#ge-scene-root[hidden]`.
- Header `#ge-scene-header` (data: `data-kind`, `data-stage`, `data-route-fallback 0|1`, `data-live-status`);
  children `.ge-h-name`, `.ge-h-coords`, `.ge-h-kind`, `.ge-h-label` ('UAE Interest Watch'), `.ge-h-tref`,
  `.ge-h-aoi`, `.ge-h-route` (text `ROUTE: <conf%>` or `ROUTE: FALLBACK`), `.ge-h-sources`, `.ge-h-nearest`.
- Rail `#ge-rail` (virtualised `<ol>`; cards `li.ge-card[data-item-id][data-platform][data-recency][data-confidence]`
  with `.ge-card-thumb img`, `.ge-card-platform img`, `.ge-card-avatar`, `.ge-card-handle`,
  `.ge-card-distance` ('0.8 km from target'), `.ge-card-delta` ('+14 min after incident' / 'posted 2 h ago'),
  `.ge-card-confidence`, `a.ge-card-source`). Hidden (`hidden` attr) until stage ≥ S2.
- Timeline `#ge-timeline` (`input[type=range]#ge-timeline-scrub`, `.ge-tl-tick[data-item-id]`,
  `.ge-tl-alert[data-alert-id]`, `.ge-tl-band[data-recency]`, button `#ge-timeline-play`).
- Player `#ge-player` (`data-playing 0|1`, `data-kind poster|youtube|tiktok|video|embed`; `img.ge-player-poster`;
  `.ge-player-overlay` with distance/time; `#ge-banner` text `REBUILT FROM ARCHIVAL FOOTAGE — originally reported <YYYY-MM-DD>`
  for rebuild scenes; `#ge-player-pip` button). Autoplay only when `playNow(item)` is called (orchestrator calls
  it on S4 arrival). NO `<video>`/iframe in the DOM before that.
- Evidence strip `#ge-evidence` (live source chips).
- Map layers `ui/scene/mapLayers.js`: `createMapLayers({viewer, Cesium})` → `{ setScene(scene), setStage(stage),
  setItems(items), setFilter(predicate), setRoutes(groundRoutes), setAoi(aoi), pulse(itemId), clear(sceneId),
  destroy }` — every entity id prefixed `ge:<sceneId>:` so `clear(sceneId)` removes exactly that scene;
  pins coloured by recency, confidence ring solid/dashed/greyed, leader lines, 0.5/1/2 km rings at S2+,
  ground routes coloured by status, AOI ring, cluster >8 within 100 px.
- Posters `ui/scene/posters.js`: `POSTERS = { idle:'/assets/states/state-live-acquiring.png', loading:'/assets/states/state-flyin-building.png',
  empty:'/assets/states/state-no-footage.png', archive:'/assets/states/state-archive-rebuild.png', quota:'/assets/states/state-source-quota.png',
  error:'/assets/states/state-source-inactive-error.png', routeFallback:'/assets/states/state-route-fallback.png',
  outsideRegister:'/assets/states/state-outside-aoi.png', recreateDiff:'/assets/states/state-saved-recreate-diff.png' }`.

`ui/scenes-panel/index.js`: `installScenesPanel({ document, window, store, host /* #scene-panel .scene-panel-inner */,
actions: { open(id), recreate(id), rename(id,title), duplicate(id), remove(id), share(id) → url, start(ids), next(), stop() } })`.
Root `#ge-scenes` with tabs `#ge-scenes-tab-active` / `#ge-scenes-tab-archive`, cards
`article.ge-scene-card[data-scene-id][data-kind][data-new 0|1][data-archived 0|1]` showing title, kind badge,
target, tRef, clip count, nearest distance, 3 thumbnails `.ge-scene-thumbs img`, top platform icon, route status;
buttons `.ge-sc-open .ge-sc-recreate .ge-sc-rename .ge-sc-duplicate .ge-sc-delete .ge-sc-share`;
diff line `.ge-scene-diff` ('+N new · M removed · K unchanged'); START/NEXT/STOP use the EXISTING
`#scene-start-btn #scene-next-btn #scene-stop-btn` (panel passes clicks to `actions`) when the Gods-Eye tab is active.

`ui/sidebar/index.js`: `installSourcesSidebar({ document, window, store, host, routeAgent: {status, latencyMs}, onToggle(platform, enabled) })`
→ root `#ge-sources` (collapsible, top-right, button `#ge-sources-toggle`), rows
`li.ge-source[data-platform][data-status]` for tiktok, instagram, youtube, x, reddit, web, route-agent with
`input[type=checkbox].ge-source-enabled`, `.ge-source-status` (OK/QUOTA/INACTIVE/ERROR/IDLE), `.ge-source-count`,
`.ge-source-latency`. `ui/sidebar/registerModal.js`: `showRegisterModal({document, place, onAccept(entry), onDecline})`
→ `#ge-register-modal[role=dialog]` with inputs `#ge-reg-name #ge-reg-lat #ge-reg-lon #ge-reg-country
select#ge-reg-category` (active-presence|claim|border-protection) and buttons `#ge-reg-accept` / `#ge-reg-decline`; Esc = decline.

## 6. Orchestrator public API (`window.__godsEye`, used by Playwright)

```
buildFromPrompt(text) → Promise<Scene|null>     // full pipeline; null when declined / failed
openScene(id)        → Promise<Scene>           // zero-network restore straight to S4 (no fetch, no route call)
recreateScene(id)    → Promise<{scene, diff:{added,removed,unchanged}}>
startPlayback(ids?) / nextScene() / stopPlayback()
setSourceEnabled(platform, bool) ; getState() ; listScenes() ; store
setNow(fn|null)      // clock mock for lifecycle tests
events: 'gev:scene-stage' {sceneId, stage}, 'gev:scene-status' {sceneId, status}, 'gev:scene-built', 'gev:scene-playing' {sceneId,itemId}
document.documentElement.dataset: geStage (S0..S4|''), geState (scene status), geScene (id)
```
Hard rule §0: at app load, share-URL load and panning there are 0 media requests, 0 `<video>`,
no `/footage/*` fetch; everything starts from `buildFromPrompt` or `openScene` (zero-network).
