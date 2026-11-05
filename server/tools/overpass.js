/**
 * server/tools/overpass.js — OnDemand-callable OpenStreetMap feature search
 * backed by the Overpass QL proxy rotation (server/providers/overpass/transport.js).
 *
 * Builds a strictly bounded Overpass QL query:
 *   [out:json][timeout:25];(nwr["<class>"](around:<radius>,<lat>,<lon>););out center tags <limit>;
 *
 * Mirrors are rotated across OVERPASS_UPSTREAMS (or OVERPASS_ENDPOINTS override).
 * Honest degraded status and provider details are surfaced when public mirrors
 * refuse cloud-egress traffic.
 */
import { fetchOverpassPayload } from '../providers/overpass/transport.js';
import {
  OVERPASS_UPSTREAMS,
  ROAD_NETWORK_BLOCKER,
} from '../providers/overpass/constants.js';

export const plugin = Object.freeze({
  id: 'overpass',
  name: 'OnDemand Spatial OpenStreetMap Features (Overpass)',
  description:
    'Query mapped OpenStreetMap features (nodes, ways, and relations) within radius ' +
    'of a coordinate by feature class: amenity, building, highway, power, military, ' +
    'aeroway, leisure, natural. Backed by the OnDemand Spatial Overpass mirror rotation ' +
    '(caches, bounded QL, and multi-mirror failover). Reports live mirror answers or ' +
    'structured degraded status when public mirrors refuse cloud-egress traffic.',
  category: 'Research',
  conversationStarters: [
    'Find hospitals and clinics (amenity) within 1500m of central Austin (lat 30.27, lon -97.74)',
    'List power infrastructure features within 2000m of lat 51.5074, lon -0.1278 in London',
    'What aeroway or aviation features exist within 3000m of Dubai International Airport (lat 25.25, lon 55.36)?',
    'Search for military features near lat 36.95, lon -76.30 (Norfolk)',
  ],
});

export const FEATURE_CLASSES = Object.freeze([
  'amenity',
  'building',
  'highway',
  'power',
  'military',
  'aeroway',
  'leisure',
  'natural',
]);

const isoUtc = (date = new Date()) =>
  (date instanceof Date ? date : new Date(date)).toISOString();

export function buildOverpassQuery({
  lat,
  lon,
  radius_m = 500,
  feature_class = 'amenity',
  limit = 50,
}) {
  return `[out:json][timeout:25];(nwr["${feature_class}"](around:${radius_m},${lat},${lon}););out center tags ${limit};`;
}

export function normalizeOverpassElement(element) {
  if (!element || typeof element !== 'object') return null;
  const lat =
    typeof element.lat === 'number'
      ? element.lat
      : typeof element.center?.lat === 'number'
        ? element.center.lat
        : null;
  const lon =
    typeof element.lon === 'number'
      ? element.lon
      : typeof element.center?.lon === 'number'
        ? element.center.lon
        : null;
  return {
    id: element.id,
    type: element.type,
    lat,
    lon,
    name: element.tags?.name || null,
    tags: element.tags || {},
  };
}

export function createOverpassTools({
  fetchPayload = fetchOverpassPayload,
  endpoints = OVERPASS_UPSTREAMS,
} = {}) {
  const osmFeaturesNear = {
    name: 'osm_features_near',
    summary:
      'Query OpenStreetMap features near a coordinate by radius and feature class (Overpass QL)',
    description:
      'Queries OpenStreetMap features (nodes, ways, and relations) within radius_m (10 to 3000 m) ' +
      'of lat/lon for a given feature_class (amenity, building, highway, power, military, aeroway, ' +
      'leisure, natural). Returns normalised OSM features with tags, centre coordinates, type, ' +
      'and id. Uses the bounded Overpass QL proxy rotation across configured Overpass mirrors ' +
      '(OVERPASS_ENDPOINTS/OVERPASS_UPSTREAMS); reports mirror status as live or degraded with ' +
      'the known cloud-egress blocker note when public mirrors time out.',
    cacheSeconds: 180,
    params: {
      lat: {
        type: 'number',
        required: true,
        min: -90,
        max: 90,
        description: 'Centre latitude in decimal degrees (WGS84).',
      },
      lon: {
        type: 'number',
        required: true,
        min: -180,
        max: 180,
        description: 'Centre longitude in decimal degrees (WGS84).',
      },
      radius_m: {
        type: 'number',
        min: 10,
        max: 3000,
        default: 500,
        description:
          'Search radius in metres (10 to 3000). Default 500 metres.',
      },
      feature_class: {
        type: 'enum',
        values: FEATURE_CLASSES,
        default: 'amenity',
        description:
          'OSM top-level feature class key to filter. Default amenity.',
      },
      limit: {
        type: 'integer',
        min: 1,
        max: 200,
        default: 50,
        description:
          'Maximum number of features to return (1 to 200). Default 50.',
      },
    },
    async handler(params, ctx = {}) {
      const ql = buildOverpassQuery(params);
      const body = `data=${encodeURIComponent(ql)}`;
      const nowFn = typeof ctx.now === 'function' ? ctx.now : () => new Date();

      try {
        const payload = await fetchPayload(body, {
          endpoints,
          timeoutMs: 15000,
          totalTimeoutMs: 25000,
          signal: ctx.signal,
          fetchImpl: globalThis.fetch,
        });

        if (
          !payload ||
          payload.status >= 400 ||
          payload.rateLimited ||
          payload.runtimeError
        ) {
          const providerInfo = payload?.provider || {
            status: 'degraded',
            source: 'Overpass API',
            error: ROAD_NETWORK_BLOCKER,
            count: 0,
            fetchedAt: isoUtc(nowFn()),
          };
          return {
            ok: false,
            status:
              payload?.status && payload.status >= 400 ? payload.status : 503,
            error: {
              code: payload?.rateLimited
                ? 'rate_limited'
                : payload?.runtimeError
                  ? 'query_failed'
                  : 'upstream_unavailable',
              message:
                providerInfo.error ||
                'Overpass mirror rotation failed; public mirrors may reject cloud egress',
            },
            provider: providerInfo,
          };
        }

        let parsed = null;
        try {
          parsed = JSON.parse(payload.body);
        } catch {
          return {
            ok: false,
            status: 502,
            error: {
              code: 'malformed_upstream',
              message: 'Overpass response body was not valid JSON',
            },
          };
        }

        const rawElements = Array.isArray(parsed?.elements)
          ? parsed.elements
          : [];
        const features = rawElements
          .map(normalizeOverpassElement)
          .filter(Boolean)
          .slice(0, params.limit);

        return {
          ok: true,
          data: {
            point: { lat: params.lat, lon: params.lon },
            radius_m: params.radius_m,
            feature_class: params.feature_class,
            count: features.length,
            features,
          },
          provider: {
            status: 'live',
            source: payload.endpoint || 'Overpass API',
            fetchedAt: isoUtc(nowFn()),
            ageSec: 0,
            error: null,
            count: features.length,
          },
          provenance: {
            provider: 'OpenStreetMap (Overpass API)',
            source_url:
              payload.endpoint || 'https://overpass-api.de/api/interpreter',
            license: {
              name: 'Open Database License (ODbL)',
              url: 'https://opendatacommons.org/licenses/odbl/',
              attribution: '© OpenStreetMap contributors',
            },
            completeness: {
              status: 'bounded',
              note: `Sampled up to ${params.limit} ${params.feature_class} features within ${params.radius_m}m.`,
            },
          },
        };
      } catch (err) {
        return {
          ok: false,
          status: 502,
          error: {
            code: 'upstream_unavailable',
            message: `Overpass feature search failed: ${String(err?.message || err).slice(0, 160)}`,
          },
        };
      }
    },
  };

  return [osmFeaturesNear];
}

export const tools = createOverpassTools();
