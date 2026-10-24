/**
 * server/tools/gbfs.js — OnDemand-callable bike-share station status backed
 * by allowlisted GBFS feeds (server/providers/gbfs.js and src/layers/bikeshare/registry.js).
 *
 * Discovers the registered bike-share network nearest to lat/lon (or matching
 * an explicit system_id), fetches its station_information and station_status
 * feeds via the validated proxy helper, and returns station locations with
 * live bike and dock availability.
 */
import { fetchGbfsUpstream } from '../providers/gbfs.js';
import { haversineKm } from '../providers/common/geo.js';
import {
  GBFS_CITY_REGISTRY,
  CITY_BY_ID,
} from '../../src/layers/bikeshare/registry.js';

export const plugin = Object.freeze({
  id: 'gbfs',
  name: 'OnDemand Spatial Bike Share Status (GBFS)',
  description:
    'Real-time bikeshare station locations and bike/dock availability from ' +
    'official GBFS (General Bikeshare Feed Specification) feeds across North America: ' +
    'Citi Bike NYC, Divvy Chicago, Capital Bikeshare DC, Bay Wheels SF, Bluebikes Boston, ' +
    'Indego Philadelphia, BIKETOWN Portland, Metro Bike LA, CapMetro Bikeshare Austin, ' +
    'and dozens of BCycle systems. Returns nearest stations with available mechanical bikes, ' +
    'ebikes, empty docks, and renting status.',
  category: 'Research',
  conversationStarters: [
    'Are there available bikes near Times Square NYC (lat 40.758, lon -73.985)?',
    'Find bike share docks near the Texas State Capitol in Austin (lat 30.274, lon -97.740)',
    'Check bike availability near Millennium Park Chicago (lat 41.882, lon -87.624)',
    'List bike stations within 2 km of Downtown Boston (lat 42.360, lon -71.058)',
  ],
});

const isoUtc = (date = new Date()) =>
  (date instanceof Date ? date : new Date(date)).toISOString();

export function findNearestGbfsSystem(lat, lon) {
  let nearest = null;
  let minDistance = Infinity;

  for (const system of GBFS_CITY_REGISTRY) {
    const dist = haversineKm(lat, lon, system.centerLat, system.centerLon);
    if (dist <= system.loadRadiusKm && dist < minDistance) {
      minDistance = dist;
      nearest = { system, distanceKm: Math.round(dist * 10) / 10 };
    }
  }

  return nearest;
}

export function createGbfsTools({ fetchUpstream = fetchGbfsUpstream } = {}) {
  const bikeShareStatusNear = {
    name: 'bike_share_status_near',
    summary:
      'Live bike-share stations and availability near coordinates (GBFS)',
    description:
      'Discovers the nearest registered GBFS bike-share network for a lat/lon coordinate, ' +
      'fetches its station metadata and real-time status (available bikes, e-bikes, docks), ' +
      'and returns stations within radius_km sorted by distance. An explicit system_id ' +
      '(e.g. "nyc-citibike", "chicago-divvy", "sf-bay-wheels") can be specified to select ' +
      'a specific network.',
    cacheSeconds: 60,
    params: {
      lat: {
        type: 'number',
        required: true,
        min: -90,
        max: 90,
        description: 'Target latitude in decimal degrees (WGS84).',
      },
      lon: {
        type: 'number',
        required: true,
        min: -180,
        max: 180,
        description: 'Target longitude in decimal degrees (WGS84).',
      },
      radius_km: {
        type: 'number',
        min: 0.5,
        max: 50,
        default: 10,
        description:
          'Search radius in kilometres around lat/lon (0.5 to 50). Default 10 km.',
      },
      system_id: {
        type: 'string',
        maxLength: 60,
        description:
          'Optional explicit GBFS system identifier (e.g. "nyc-citibike", "sf-bay-wheels").',
      },
      limit: {
        type: 'integer',
        min: 1,
        max: 100,
        default: 30,
        description:
          'Maximum number of stations to return (1 to 100). Default 30.',
      },
    },
    async handler(params, ctx = {}) {
      let system = null;
      let distToCenter = null;

      if (params.system_id) {
        system = CITY_BY_ID.get(params.system_id) || null;
        if (!system) {
          return {
            ok: false,
            status: 400,
            error: {
              code: 'invalid_param',
              message: `Unknown GBFS system_id "${params.system_id}"; available systems include: ${GBFS_CITY_REGISTRY.slice(
                0,
                10,
              )
                .map((s) => s.id)
                .join(', ')}...`,
              param: 'system_id',
            },
          };
        }
        distToCenter =
          Math.round(
            haversineKm(
              params.lat,
              params.lon,
              system.centerLat,
              system.centerLon,
            ) * 10,
          ) / 10;
      } else {
        const found = findNearestGbfsSystem(params.lat, params.lon);
        if (found) {
          system = found.system;
          distToCenter = found.distanceKm;
        }
      }

      if (!system) {
        return {
          ok: true,
          data: {
            system: null,
            message:
              'No registered GBFS bike-share system covers this coordinate within its service radius.',
            count: 0,
            stations: [],
            availableSystemsCount: GBFS_CITY_REGISTRY.length,
          },
          provider: {
            status: 'unavailable',
            source: 'GBFS Registry',
            fetchedAt: isoUtc(),
            ageSec: 0,
            error: 'No coverage at requested coordinates',
            count: 0,
          },
        };
      }

      const nowFn = typeof ctx.now === 'function' ? ctx.now : () => new Date();

      try {
        const [infoRes, statusRes] = await Promise.all([
          fetchUpstream(system.stationInformationUrl, { signal: ctx.signal }),
          fetchUpstream(system.stationStatusUrl, { signal: ctx.signal }),
        ]);

        const infoJson = JSON.parse(infoRes.body);
        const statusJson = JSON.parse(statusRes.body);

        const infoStations = Array.isArray(infoJson?.data?.stations)
          ? infoJson.data.stations
          : [];
        const statusStations = Array.isArray(statusJson?.data?.stations)
          ? statusJson.data.stations
          : [];

        const statusMap = new Map();
        for (const st of statusStations) {
          if (st?.station_id !== undefined)
            statusMap.set(String(st.station_id), st);
        }

        const enriched = [];
        for (const info of infoStations) {
          const lat = Number(info.lat);
          const lon = Number(info.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

          const dist = haversineKm(params.lat, params.lon, lat, lon);
          if (dist > params.radius_km) continue;

          const status = statusMap.get(String(info.station_id)) || {};
          enriched.push({
            id: info.station_id,
            name: info.name || 'Station',
            lat,
            lon,
            distanceKm: Math.round(dist * 100) / 100,
            capacity: info.capacity ?? null,
            bikesAvailable: status.num_bikes_available ?? null,
            ebikesAvailable: status.num_ebikes_available ?? null,
            docksAvailable: status.num_docks_available ?? null,
            isRenting: status.is_renting === 1 || status.is_renting === true,
            isReturning:
              status.is_returning === 1 || status.is_returning === true,
            lastReported: status.last_reported
              ? new Date(status.last_reported * 1000).toISOString()
              : null,
          });
        }

        enriched.sort((a, b) => a.distanceKm - b.distanceKm);
        const stations = enriched.slice(0, params.limit);

        return {
          ok: true,
          data: {
            system: {
              id: system.id,
              name: system.provider,
              city: system.city,
              distanceToSystemCenterKm: distToCenter,
            },
            count: stations.length,
            totalInRange: enriched.length,
            radiusKm: params.radius_km,
            stations,
          },
          provider: {
            status: 'live',
            source: system.provider,
            fetchedAt: isoUtc(nowFn()),
            ageSec: 0,
            error: null,
            count: stations.length,
          },
          provenance: {
            provider: `${system.provider} (GBFS)`,
            source_url: system.stationStatusUrl,
            license: {
              name: 'Open GBFS Data Feed',
              url: system.stationInformationUrl,
              attribution: `© ${system.provider} / Open GBFS`,
            },
            completeness: {
              status: 'sampled',
              note: `Stations within ${params.radius_km} km of ${params.lat},${params.lon} from ${system.provider}.`,
            },
          },
        };
      } catch (err) {
        return {
          ok: false,
          status: 502,
          error: {
            code: 'upstream_unavailable',
            message: `GBFS fetch failed for ${system.id}: ${String(err?.message || err).slice(0, 160)}`,
          },
        };
      }
    },
  };

  return [bikeShareStatusNear];
}

export const tools = createGbfsTools();
