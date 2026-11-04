# OnDemand Spatial Plugin Registry

Catalogue of all OnDemand-callable REST tools served by `GET /api/tools/<name>` from the catch-all serverless function. Every tool returns a structured envelope:

```json
{
  "ok": true,
  "tool": "<tool_name>",
  "params": { ... },
  "data": { ... },
  "provider": { "status": "live|degraded|unavailable", "source": "...", "fetchedAt": "...", "ageSec": 0, "count": 10 },
  "provenance": { "provider": "...", "source_url": "...", "license": { ... }, "completeness": { ... } },
  "generatedAtUtc": "2026-10-21T03:16:16.000Z"
}
```

Unknown query parameters strictly return HTTP 400 `unknown_param`. Missing or invalid parameters return HTTP 400 `missing_param` or `invalid_param`. Upstream credentials stay strictly server-side and are never echoed.

---

## Tool Catalogue

| Plugin ID | Tool Name | Route | Upstream Provider | Auth Needed (Env Name) | Live Check (2026-10-21 UTC) | Result / Status | OpenAPI Path |
|---|---|---|---|---|---|---|---|
| `satellites` | `list_satellites_in_scene` | `/api/tools/list_satellites_in_scene` | CelesTrak / Space-Track | None | HTTP 200 (ok: true) | Live | `docs/plugins/satellites/openapi.json` |
| `satellites` | `satellite_passes` | `/api/tools/satellite_passes` | CelesTrak | None | HTTP 200 (ok: true) | Live | `docs/plugins/satellites/openapi.json` |
| `flights` | `flights_in_bbox` | `/api/tools/flights_in_bbox` | OpenSky Network / adsb.lol | None | HTTP 200 (ok: true) | Live | `docs/plugins/flights/openapi.json` |
| `flights` | `flight_by_icao24` | `/api/tools/flight_by_icao24` | adsb.lol / OpenSky Network | None | HTTP 404 (ok: false) | `not_found` (expected for synthetic/untracked ICAO) | `docs/plugins/flights/openapi.json` |
| `military` | `military_flights_in_bbox` | `/api/tools/military_flights_in_bbox` | adsb.lol / adsb.fi | None | HTTP 200 (ok: true) | Live | `docs/plugins/military/openapi.json` |
| `vessels` | `vessels_in_bbox` | `/api/tools/vessels_in_bbox` | aisstream.io / Demo replay | `AISSTREAM_API_KEY` (optional demo replay) | HTTP 200 (ok: true) | Live (Demo replay fallback) | `docs/plugins/vessels/openapi.json` |
| `vessels` | `vessel_by_mmsi` | `/api/tools/vessel_by_mmsi` | aisstream.io / Demo replay | `AISSTREAM_API_KEY` (optional demo replay) | HTTP 404 (ok: false) | `not_found` (untracked MMSI in scene) | `docs/plugins/vessels/openapi.json` |
| `traffic` | `traffic_flow_at_point` | `/api/tools/traffic_flow_at_point` | TomTom Flow Segment Data | `TOMTOM_API_KEY` | HTTP 503 (ok: false) | `not_configured` ("set in Vercel to enable live traffic") | `docs/plugins/traffic/openapi.json` |
| `traffic` | `road_network_status` | `/api/tools/road_network_status` | road-network:overpass | None (optional `OVERPASS_ENDPOINTS`) | HTTP 200 (ok: true) | Live | `docs/plugins/traffic/openapi.json` |
| `earthquakes` | `earthquake_search` | `/api/tools/earthquake_search` | USGS FDSN Event Web Service | None | HTTP 200 (ok: true) | Live | `docs/plugins/earthquakes/openapi.json` |
| `fires` | `fire_detection_search` | `/api/tools/fire_detection_search` | NASA FIRMS (LANCE NRT) | `NASA_FIRMS_MAP_KEY` | HTTP 503 (ok: false) | `not_configured` (free MAP_KEY required) | `docs/plugins/fires/openapi.json` |
| `overpass` | `osm_features_near` | `/api/tools/osm_features_near` | OpenStreetMap (Overpass API) | None (optional `OVERPASS_ENDPOINTS`) | HTTP 503 (ok: false) | `upstream_unavailable` (public mirrors throttle cloud egress) | `docs/plugins/overpass/openapi.json` |
| `places` | `geocode_place` | `/api/tools/geocode_place` | OpenStreetMap Nominatim | None | HTTP 200 (ok: true) | Live | `docs/plugins/places/openapi.json` |
| `gbfs` | `bike_share_status_near` | `/api/tools/bike_share_status_near` | GBFS (Citi Bike, Divvy, Bay Wheels, BCycle) | None | HTTP 200 (ok: true) | Live | `docs/plugins/gbfs/openapi.json` |
| `transit` | `transit_vehicles_in_bbox` | `/api/tools/transit_vehicles_in_bbox` | GTFS-RT (MBTA, CapMetro, HSL, OVapi, Entur) | None | HTTP 200 (ok: true) | Live | `docs/plugins/transit/openapi.json` |
| `regional` | `regional_brief` | `/api/tools/regional_brief` | Regional Composite (Open-Meteo, Nominatim, News) | None | HTTP 200 (ok: true) | Live | `docs/plugins/regional/openapi.json` |
| `terrain` | `terrain_height_at` | `/api/tools/terrain_height_at` | Re:Earth Global Terrain (`heights.json`) | None | HTTP 200 (ok: true) | Live | `docs/plugins/terrain/openapi.json` |
| `cctv` | `cameras_in_bbox` | `/api/tools/cameras_in_bbox` | Municipal Open Data (Austin, Caltrans, TfL, TxDOT) | None | HTTP 200 (ok: true) | Live (Metadata only) | `docs/plugins/cctv/openapi.json` |
| `military_installations` | `military_installations_in_bbox` | `/api/tools/military_installations_in_bbox` | OpenStreetMap (ODbL) via Overpass | None (optional `OVERPASS_ENDPOINTS`) | HTTP 503 (ok: false) | `upstream_unavailable` (public mirrors throttle cloud egress) | `docs/plugins/military_installations/openapi.json` |
| `radio` | `radio_stations_near` | `/api/tools/radio_stations_near` | Community Radio Browser Directory | None | HTTP 200 (ok: true) | Live | `docs/plugins/radio/openapi.json` |
| `space` | `rocket_launches_recent` | `/api/tools/rocket_launches_recent` | The Space Devs / Launch Library 2 | None (optional `LL2_API_TOKEN`) | HTTP 200 (ok: true) | Live | `docs/plugins/space/openapi.json` |

---

## Skipped Capabilities

| Capability | Associated Route | Reason Skipped | Alternative / Guidance |
|---|---|---|---|
| AIS Live Relay | `/api/ais-live` | Persistent duplex WebSocket stream connected to aisstream.io with rolling memory cache; cannot be represented as a stateless HTTP GET tool call. | Use `vessels_in_scene` or `vessels_in_bbox`, which query the cached vessel table and provide fallback demo replay for keyless sessions. |
| Google Places / Text Search | `/api/places/*` | Requires server/browser Google Maps API keys (`GOOGLE_MAPS_API_KEY`, `GOOGLE_SERVER_API_KEY`). | Keyless forward geocoding is implemented server-side via OpenStreetMap Nominatim (`geocode_place` in `places.js`). |
| CCTV Media / Live Video | `/api/cctv/media/:id`, `/api/cctv/frame/:id` | Serves binary image/video streams (MJPEG/HLS/JPEG/MP4) requiring media player capabilities, outside the OnDemand JSON data envelope standard. | Camera catalogue metadata (name, operator, city, coordinates, stream type) is fully exposed via `cameras_in_bbox` in `cctv.js`. |
| Demo Timezone Adapter | `/api/sources/demo/timezone` | Synthetic nautical timezone test adapter (`server/sources/demo-timezone.js`) designed exclusively for dynamic capability-loop verification, not an authentic external direct provider. | Retained under `/api/sources/demo/timezone` for internal capability loop tests without cluttering the public plugin registry. |

---

## OpenAPI Regeneration

OpenAPI 3.0.3 documents are generated deterministically from `server/tools/registry.js` using `scripts/generate-tool-openapi.mjs`:

```bash
# Generate all OpenAPI specs with target preview/production domain:
node scripts/generate-tool-openapi.mjs --server https://ondemand-eand-spatial-opal.vercel.app

# Check for schema drift:
node scripts/generate-tool-openapi.mjs --server https://ondemand-eand-spatial-opal.vercel.app --check
```

---

## OnDemand Plugin Registration Note

OnDemand plugin creation from an OpenAPI schema is currently dashboard-only (see [docs.on-demand.io/docs/rest-based-plugins](https://docs.on-demand.io/docs/rest-based-plugins)). The programmatic API create surface returned no plugin today.

Operators can register each plugin by navigating to the OnDemand Dashboard > **Plugins** > **New REST Plugin**, and pasting the contents of the respective OpenAPI specification:

- `satellites`: `docs/plugins/satellites/openapi.json`
- `flights`: `docs/plugins/flights/openapi.json`
- `military`: `docs/plugins/military/openapi.json`
- `vessels`: `docs/plugins/vessels/openapi.json`
- `traffic`: `docs/plugins/traffic/openapi.json`
- `earthquakes`: `docs/plugins/earthquakes/openapi.json`
- `fires`: `docs/plugins/fires/openapi.json`
- `overpass`: `docs/plugins/overpass/openapi.json`
- `places`: `docs/plugins/places/openapi.json`
- `gbfs`: `docs/plugins/gbfs/openapi.json`
- `transit`: `docs/plugins/transit/openapi.json`
- `regional`: `docs/plugins/regional/openapi.json`
- `terrain`: `docs/plugins/terrain/openapi.json`
- `cctv`: `docs/plugins/cctv/openapi.json`
- `military_installations`: `docs/plugins/military_installations/openapi.json`
- `radio`: `docs/plugins/radio/openapi.json`
- `space`: `docs/plugins/space/openapi.json`

GENERATED_UTC: 2026-10-21T03:16:16Z
