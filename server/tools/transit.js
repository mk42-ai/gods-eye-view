/**
 * server/tools/transit.js — OnDemand-callable GTFS-Realtime transit vehicle
 * tracker backed by the registered transit feeds (server/providers/transit.js).
 *
 * Sourced through the cached transit proxy service (src/sources/transitService.js)
 * covering registered feeds (MBTA Boston, CapMetro Austin, Metro Transit MSP,
 * HSL Helsinki, OVapi Netherlands, Entur Norway, Translink SEQ).
 */
import { transitProxy } from '../providers/transit.js';
import { publicTransitCatalog } from '../../src/data/transitFeeds.js';
import { haversineKm } from '../providers/common/geo.js';
import { createPluginInvoker } from './_invoke.js';

const defaultInvoke = createPluginInvoker(() => transitProxy());

const ENABLED_FEED_IDS = Object.freeze(
  publicTransitCatalog().map((feed) => feed.id),
);

export const plugin = Object.freeze({
  id: 'transit',
  name: 'OnDemand Spatial Transit Vehicles (GTFS-RT)',
  description:
    'Live public transit vehicle positions (buses, trains, light rail, ferries) ' +
    'from official GTFS-Realtime feeds across North America, Europe, and Australia: ' +
    'MBTA (Boston), CapMetro (Austin), Metro Transit (Minneapolis-St. Paul), ' +
    'HSL (Helsinki), OVapi (Netherlands national), Entur (Norway national), and ' +
    'Translink (SE Queensland). Supports spatial bounding-box filtering, proximity search, ' +
    'or direct feed selection with vehicle IDs, route labels, bearings, and freshness.',
  category: 'Research',
  conversationStarters: [
    'How many CapMetro transit vehicles are operating in Austin right now?',
    'Show live MBTA transit vehicles in Boston inside bbox 42.25,-71.20 to 42.42,-70.95',
    'List active HSL trams and buses currently running in Helsinki',
    'Which public transit vehicles are active in the Minneapolis-St. Paul area?',
  ],
});

const isoUtc = (date = new Date()) =>
  (date instanceof Date ? date : new Date(date)).toISOString();

function findBestFeed(lat, lon, preferredFeed) {
  const catalog = publicTransitCatalog();
  if (preferredFeed) {
    const match = catalog.find((f) => f.id === preferredFeed);
    if (match) return match;
  }
  if (lat !== undefined && lon !== undefined) {
    let nearest = null;
    let minDistance = Infinity;
    for (const feed of catalog) {
      const dist = haversineKm(lat, lon, feed.center.lat, feed.center.lon);
      if (dist < minDistance) {
        minDistance = dist;
        nearest = feed;
      }
    }
    return nearest;
  }
  return catalog[0] || null;
}

export function createTransitTools({ invoke = defaultInvoke } = {}) {
  const transitVehiclesInBbox = {
    name: 'transit_vehicles_in_bbox',
    summary:
      'Live transit vehicle positions inside a bounding box or near a point (GTFS-RT)',
    description:
      'Queries real-time transit vehicle positions (buses, trains, rail, ferries) from ' +
      'open GTFS-RT feeds inside a bounding box (lamin, lomin, lamax, lomax) or within ' +
      'radius_km of lat/lon. If `feed` is omitted, the feed closest to the coordinates ' +
      'is automatically selected. Available feeds: mbta, capmetro-austin, metrotransit-msp, ' +
      'hsl-helsinki, ovapi-nl, entur-norway, translink-seq.',
    cacheSeconds: 15,
    params: {
      feed: {
        type: 'enum',
        values: ENABLED_FEED_IDS,
        description:
          'GTFS-RT feed ID to query (mbta, capmetro-austin, metrotransit-msp, hsl-helsinki, ovapi-nl, entur-norway, translink-seq). Optional.',
      },
      lat: {
        type: 'number',
        min: -90,
        max: 90,
        description:
          'Centre latitude in decimal degrees. Used for proximity filtering or feed auto-selection.',
      },
      lon: {
        type: 'number',
        min: -180,
        max: 180,
        description:
          'Centre longitude in decimal degrees. Used for proximity filtering or feed auto-selection.',
      },
      radius_km: {
        type: 'number',
        min: 1,
        max: 300,
        default: 50,
        description:
          'Radius around lat/lon in kilometres (when bbox is not supplied). Default 50 km.',
      },
      lamin: {
        type: 'number',
        min: -90,
        max: 90,
        description:
          'Bounding-box south latitude. Requires lomin, lamax, lomax.',
      },
      lomin: {
        type: 'number',
        min: -180,
        max: 180,
        description:
          'Bounding-box west longitude. Requires lamin, lamax, lomax.',
      },
      lamax: {
        type: 'number',
        min: -90,
        max: 90,
        description:
          'Bounding-box north latitude. Requires lamin, lomin, lomax.',
      },
      lomax: {
        type: 'number',
        min: -180,
        max: 180,
        description:
          'Bounding-box east longitude. Requires lamin, lomin, lamax.',
      },
      limit: {
        type: 'integer',
        min: 1,
        max: 500,
        default: 100,
        description:
          'Maximum number of transit vehicles to return (1 to 500). Default 100.',
      },
    },
    async handler(params, ctx = {}) {
      const hasBbox =
        params.lamin !== undefined &&
        params.lomin !== undefined &&
        params.lamax !== undefined &&
        params.lomax !== undefined;

      const centreLat = hasBbox
        ? (params.lamin + params.lamax) / 2
        : params.lat;
      const centreLon = hasBbox
        ? (params.lomin + params.lomax) / 2
        : params.lon;

      const selectedFeed = findBestFeed(centreLat, centreLon, params.feed);
      if (!selectedFeed) {
        return {
          ok: false,
          status: 400,
          error: {
            code: 'invalid_param',
            message:
              'Could not determine transit feed. Supply a valid `feed` parameter or coordinates near a supported transit region.',
          },
        };
      }

      const nowFn = typeof ctx.now === 'function' ? ctx.now : () => new Date();

      try {
        const answer = await invoke(
          `/api/transit/vehicles/${encodeURIComponent(selectedFeed.id)}`,
          { signal: ctx.signal },
        );

        if (answer.status !== 200 || !answer.json) {
          return {
            ok: false,
            status: answer.status === 503 ? 503 : 502,
            error: {
              code:
                answer.status === 503
                  ? 'upstream_unavailable'
                  : 'malformed_upstream',
              message:
                answer.json?.error ||
                `Transit feed "${selectedFeed.id}" answered HTTP ${answer.status}`,
            },
            provider: {
              status: 'degraded',
              source: selectedFeed.name,
              fetchedAt: null,
              ageSec: null,
              error: answer.json?.error || 'Transit upstream error',
              count: 0,
            },
          };
        }

        const rawVehicles = Array.isArray(answer.json.vehicles)
          ? answer.json.vehicles
          : [];

        const filtered = [];
        for (const v of rawVehicles) {
          const lat = v.lat ?? v.latitude;
          const lon = v.lon ?? v.longitude;
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

          if (hasBbox) {
            if (
              lat < params.lamin ||
              lat > params.lamax ||
              lon < params.lomin ||
              lon > params.lomax
            ) {
              continue;
            }
          } else if (params.lat !== undefined && params.lon !== undefined) {
            const dist = haversineKm(params.lat, params.lon, lat, lon);
            if (dist > params.radius_km) continue;
          }

          filtered.push({
            id: v.id,
            route: v.route || v.routeId || null,
            label: v.label || null,
            lat,
            lon,
            bearing: v.bearing ?? null,
            speed: v.speed ?? null,
            updatedAt: v.timestamp
              ? new Date(v.timestamp * 1000).toISOString()
              : answer.json.fetchedAt || null,
          });
        }

        const vehicles = filtered.slice(0, params.limit);

        return {
          ok: true,
          data: {
            feed: {
              id: selectedFeed.id,
              name: selectedFeed.name,
              operator: selectedFeed.operator,
              region: selectedFeed.region,
            },
            count: vehicles.length,
            totalInFeed: rawVehicles.length,
            vehicles,
          },
          provider: {
            status: 'live',
            source: `${selectedFeed.name} GTFS-RT`,
            fetchedAt: answer.json.fetchedAt || isoUtc(nowFn()),
            ageSec: 0,
            error: null,
            count: vehicles.length,
          },
          provenance: {
            provider: `${selectedFeed.operator} GTFS-Realtime`,
            source_url: selectedFeed.licenseUrl || null,
            license: {
              name: selectedFeed.license || 'Open Transit Data License',
              url: selectedFeed.licenseUrl || 'https://gtfs.org/',
              attribution: selectedFeed.attribution || selectedFeed.operator,
            },
            completeness: {
              status: 'sampled',
              note: `Live GTFS-RT vehicles from ${selectedFeed.name}; transponder coverage depends on operating vehicles.`,
            },
          },
        };
      } catch (err) {
        return {
          ok: false,
          status: 502,
          error: {
            code: 'tool_failed',
            message: `transit_vehicles_in_bbox failed: ${String(err?.message || err).slice(0, 160)}`,
          },
        };
      }
    },
  };

  return [transitVehiclesInBbox];
}

export const tools = createTransitTools();
