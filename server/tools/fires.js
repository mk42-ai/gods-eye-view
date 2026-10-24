/**
 * server/tools/fires.js — OnDemand-callable active fire detection search backed
 * by NASA FIRMS (LANCE NRT) area CSV API (server/sources/nasa-firms.js).
 *
 * Sourced through the Gate 3 `fetchFires` adapter, reusing the same area
 * resolution (bbox or circle), CSV parsing, rate limits, and structured
 * failures:
 *   - missing key → honest 503 `not_configured`
 *   - invalid query → 400 `invalid_param` / `unknown_param`
 *   - rate limit → 429 `rate_limited`
 *   - upstream down → 502 `upstream_unavailable`
 */
import { fetchFires, PROVIDER, SOURCE_URL } from '../sources/nasa-firms.js';

export const plugin = Object.freeze({
  id: 'fires',
  name: 'OnDemand Spatial Active Fire Search (NASA FIRMS)',
  description:
    'Search near-real-time satellite active fire detections from NASA FIRMS ' +
    '(LANCE NRT) by geographic area — bounding box or circle (lat + lon + radius_km) — ' +
    'and time window (1–10 days back or specific start date). Returns observed hotspot ' +
    'detections (latitude, longitude, brightness temperature, fire radiative power MW, ' +
    'confidence, acquisition timestamp, satellite instrument, day/night) and provenance ' +
    'metadata. Sourced from VIIRS (NOAA-20, NOAA-21, Suomi-NPP) and MODIS instruments. ' +
    'Requires NASA_FIRMS_MAP_KEY (or FIRMS_MAP_KEY) on the deployment; answers honest ' +
    '503 `not_configured` when absent. Detections capped at 200 per call.',
  category: 'Research',
  conversationStarters: [
    'Are there any active fire detections near Los Angeles (lat 34.05, lon -118.25) in the last 2 days?',
    'Search active fires in the Texas Panhandle box -103,34,-100,36 for today',
    'List high-confidence fire hotspots around Athens, Greece within 100 km',
    'Show recent fire detections from NOAA-20 VIIRS in western Canada',
  ],
});

const CONFIDENCE_LEVELS = Object.freeze(['low', 'nominal', 'high']);

function matchesConfidence(recordConfidence, minConfidence) {
  if (!minConfidence) return true;
  const raw = String(recordConfidence ?? '')
    .trim()
    .toLowerCase();
  const min = String(minConfidence).trim().toLowerCase();

  // VIIRS categorical confidence: 'l'/'low', 'n'/'nominal', 'h'/'high'
  const rank = (c) => {
    if (c === 'l' || c === 'low') return 1;
    if (c === 'n' || c === 'nominal') return 2;
    if (c === 'h' || c === 'high') return 3;
    const num = Number(c);
    if (Number.isFinite(num)) {
      if (num < 30) return 1;
      if (num < 80) return 2;
      return 3;
    }
    return 1;
  };

  return rank(raw) >= rank(min);
}

export function createFiresTools({ fetchFiresImpl = fetchFires } = {}) {
  const fireDetectionSearch = {
    name: 'fire_detection_search',
    summary:
      'Search NASA FIRMS active fire hotspots by bounding box or circle and time range',
    description:
      'Queries NASA FIRMS active fire detections by bounding box (bbox="west,south,east,north") ' +
      'or circle (latitude + longitude + radius_km, all three required together). ' +
      'Supports day_range (1–10 days back, default 1), specific start date (YYYY-MM-DD), ' +
      'source satellite instrument (VIIRS_NOAA20_NRT, VIIRS_NOAA21_NRT, VIIRS_SNPP_NRT, MODIS_NRT), ' +
      'optional min_confidence filter (low, nominal, high), and limit (1–200, default 100). ' +
      'Returns normalised hotspot events with observed coordinates, brightness Kelvin, ' +
      'FRP (MW), confidence, satellite, and acquisition time. Requires server NASA_FIRMS_MAP_KEY; ' +
      'answers 503 `not_configured` without it.',
    cacheSeconds: 120,
    params: {
      bbox: {
        type: 'string',
        maxLength: 80,
        description:
          'Bounding box as "west,south,east,north" in decimal degrees (WGS84). Exclusive with circle parameters.',
      },
      latitude: {
        type: 'number',
        min: -90,
        max: 90,
        description:
          'Circle-search centre latitude in decimal degrees. Requires longitude and radius_km together.',
      },
      longitude: {
        type: 'number',
        min: -180,
        max: 180,
        description:
          'Circle-search centre longitude in decimal degrees. Requires latitude and radius_km together.',
      },
      radius_km: {
        type: 'number',
        min: 1,
        max: 1000,
        description:
          'Circle-search radius in kilometres (1–1000). Requires latitude and longitude together.',
      },
      source: {
        type: 'enum',
        values: [
          'VIIRS_NOAA20_NRT',
          'VIIRS_NOAA21_NRT',
          'VIIRS_SNPP_NRT',
          'MODIS_NRT',
        ],
        default: 'VIIRS_NOAA20_NRT',
        description:
          'FIRMS satellite sensor product. Default VIIRS_NOAA20_NRT.',
      },
      day_range: {
        type: 'integer',
        min: 1,
        max: 10,
        default: 1,
        description:
          'Number of days to search back (1–10). Default 1 (current UTC day).',
      },
      date: {
        type: 'string',
        pattern: /^\d{4}-\d{2}-\d{2}$/,
        description:
          'Optional start date in YYYY-MM-DD format (UTC). If omitted, searches backwards from now.',
      },
      min_confidence: {
        type: 'enum',
        values: CONFIDENCE_LEVELS,
        description:
          'Minimum detection confidence filter: "low", "nominal", or "high". Optional.',
      },
      limit: {
        type: 'integer',
        min: 1,
        max: 200,
        default: 100,
        description:
          'Maximum number of fire detections to return (1–200). Default 100.',
      },
    },
    async handler(params, ctx = {}) {
      // Build env overlay supporting either NASA_FIRMS_MAP_KEY or legacy FIRMS_MAP_KEY
      const mapKey =
        ctx?.env?.NASA_FIRMS_MAP_KEY ||
        ctx?.env?.FIRMS_MAP_KEY ||
        process.env.NASA_FIRMS_MAP_KEY ||
        process.env.FIRMS_MAP_KEY ||
        '';

      const queryForAdapter = {
        ...(params.bbox ? { bbox: params.bbox } : {}),
        ...(params.latitude !== undefined ? { latitude: params.latitude } : {}),
        ...(params.longitude !== undefined
          ? { longitude: params.longitude }
          : {}),
        ...(params.radius_km !== undefined
          ? { radius_km: params.radius_km }
          : {}),
        ...(params.source ? { source: params.source } : {}),
        ...(params.day_range !== undefined
          ? { day_range: params.day_range }
          : {}),
        ...(params.date ? { date: params.date } : {}),
        limit: params.limit,
      };

      const result = await fetchFiresImpl(queryForAdapter, {
        signal: ctx.signal,
        env: { ...process.env, ...ctx.env, NASA_FIRMS_MAP_KEY: mapKey },
        now: ctx.now,
      });

      if (!result.ok) {
        return {
          ok: false,
          status: result.status || 502,
          error: result.error || {
            code: 'upstream_unavailable',
            message: 'NASA FIRMS source failed',
          },
          provider: {
            status: result.status === 503 ? 'unavailable' : 'degraded',
            source: PROVIDER,
            fetchedAt: null,
            ageSec: null,
            error: result.error?.message || 'FIRMS upstream error',
            count: 0,
          },
        };
      }

      const rawItems = Array.isArray(result.data?.items)
        ? result.data.items
        : [];
      const filtered = params.min_confidence
        ? rawItems.filter((item) =>
            matchesConfidence(item.confidence, params.min_confidence),
          )
        : rawItems;
      const detections = filtered.slice(0, params.limit);

      return {
        ok: true,
        data: {
          source: result.data?.source || PROVIDER,
          count: detections.length,
          total: rawItems.length,
          area: result.data?.area,
          dateRange: result.data?.date_range,
          quota: result.data?.quota,
          detections,
        },
        provider: {
          status: 'live',
          source: PROVIDER,
          fetchedAt: result.provenance?.fetched_at || new Date().toISOString(),
          ageSec: 0,
          error: null,
          count: detections.length,
        },
        provenance: result.provenance || {
          provider: PROVIDER,
          source_url: SOURCE_URL,
          license: {
            name: 'NASA Earthdata open data (FIRMS/LANCE)',
            url: SOURCE_URL,
            attribution: 'NASA FIRMS / LANCE',
          },
          completeness: {
            status: 'sampled',
            note: 'Satellite detection passes; subject to cloud cover and orbital revisit schedules.',
          },
        },
      };
    },
  };

  return [fireDetectionSearch];
}

export const tools = createFiresTools();
