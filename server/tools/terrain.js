/**
 * server/tools/terrain.js — OnDemand-callable terrain elevation lookup
 * backed by the Re:Earth global terrain heights proxy (server/providers/terrain.js).
 *
 * Looks up ellipsoidal heights in metres (WGS84) for single or batched coordinates
 * (up to 50 points) with long-term disk and memory caching.
 */
import { terrainHeightsProxy } from '../providers/terrain.js';
import { createPluginInvoker } from './_invoke.js';

const defaultInvoke = createPluginInvoker(() => terrainHeightsProxy());

const isoUtc = (date = new Date()) =>
  (date instanceof Date ? date : new Date(date)).toISOString();

export const plugin = Object.freeze({
  id: 'terrain',
  name: 'OnDemand Spatial Terrain Elevation (Re:Earth)',
  description:
    'Batched ellipsoidal terrain elevation (height in metres above the WGS84 ellipsoid) ' +
    'at geographic coordinates for single points or batched lists (up to 50 points per query). ' +
    'Powered by Re:Earth global terrain with 30-day disk caching and sequential chunking. ' +
    'Keyless open data.',
  category: 'Research',
  conversationStarters: [
    'What is the terrain height at Mount Everest summit (lat 27.9881, lon 86.9250)?',
    'Get elevation for Death Valley Badwater Basin (lat 36.2503, lon -116.8258)',
    'Look up terrain height at central Zurich (lat 47.3769, lon 8.5417)',
    'Query elevation along a transect between Denver and Aspen',
  ],
});

export function createTerrainTools({ invoke = defaultInvoke } = {}) {
  const terrainHeightAt = {
    name: 'terrain_height_at',
    summary:
      'Ellipsoidal terrain height in metres at geographic coordinates (up to 50 points)',
    description:
      'Looks up ellipsoidal terrain height in metres (WGS84) for a point (lat, lon) ' +
      'or a batched list of coordinates (up to 50 points formatted as "lon,lat;lon,lat;..."). ' +
      'Powered by Re:Earth heights API with long-term caching. Keyless.',
    cacheSeconds: 3600,
    params: {
      lat: {
        type: 'number',
        min: -90,
        max: 90,
        description:
          'Latitude of single point in decimal degrees. Required if `points` is omitted.',
      },
      lon: {
        type: 'number',
        min: -180,
        max: 180,
        description:
          'Longitude of single point in decimal degrees. Required if `points` is omitted.',
      },
      points: {
        type: 'string',
        maxLength: 2000,
        description:
          'Batched coordinate string in "lon,lat;lon,lat;..." format (up to 50 points). Takes precedence over lat/lon.',
      },
    },
    async handler(params, ctx = {}) {
      let pointsString = '';

      if (params.points) {
        const pairs = String(params.points)
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean);
        if (pairs.length === 0) {
          return {
            ok: false,
            status: 400,
            error: {
              code: 'invalid_param',
              message: 'parameter "points" cannot be empty',
              param: 'points',
            },
          };
        }
        if (pairs.length > 50) {
          return {
            ok: false,
            status: 400,
            error: {
              code: 'invalid_param',
              message:
                'parameter "points" accepts at most 50 coordinates per request',
              param: 'points',
            },
          };
        }
        pointsString = pairs.join(';');
      } else if (params.lat !== undefined && params.lon !== undefined) {
        pointsString = `${params.lon},${params.lat}`;
      } else {
        return {
          ok: false,
          status: 400,
          error: {
            code: 'missing_param',
            message:
              'Either "points" (lon,lat;...) or both "lat" and "lon" must be supplied',
            param: 'points',
          },
        };
      }

      const nowFn = typeof ctx.now === 'function' ? ctx.now : () => new Date();

      try {
        const answer = await invoke(
          `/api/terrain/heights?points=${encodeURIComponent(pointsString)}`,
          { signal: ctx.signal },
        );

        if (answer.status !== 200 || !answer.json) {
          return {
            ok: false,
            status: answer.status === 500 ? 502 : answer.status || 502,
            error: {
              code: 'upstream_unavailable',
              message:
                answer.json?.error ||
                `Terrain heights service answered HTTP ${answer.status}`,
            },
            provider: {
              status: 'unavailable',
              source: 'Re:Earth Terrain Heights',
              fetchedAt: null,
              ageSec: null,
              error: answer.json?.error || 'Terrain service unavailable',
              count: 0,
            },
          };
        }

        const rawResults = Array.isArray(answer.json.results)
          ? answer.json.results
          : [];

        return {
          ok: true,
          data: {
            count: rawResults.length,
            requestedPoints: pointsString.split(';').length,
            results: rawResults,
          },
          provider: {
            status: 'live',
            source: 'Re:Earth Terrain Heights',
            fetchedAt: isoUtc(nowFn()),
            ageSec: 0,
            error: null,
            count: rawResults.length,
          },
          provenance: {
            provider: 'Re:Earth Global Terrain (heights.json)',
            source_url: 'https://terrain.reearth.land/heights.json',
            license: {
              name: 'Re:Earth Terrain Open License',
              url: 'https://reearth.io/',
              attribution: '© Re:Earth contributors',
            },
            completeness: {
              status: 'sampled',
              note: 'Point heights sampled from global digital elevation models (ellipsoidal height).',
            },
          },
        };
      } catch (err) {
        return {
          ok: false,
          status: 502,
          error: {
            code: 'tool_failed',
            message: `terrain_height_at failed: ${String(err?.message || err).slice(0, 160)}`,
          },
        };
      }
    },
  };

  return [terrainHeightAt];
}

export const tools = createTerrainTools();
