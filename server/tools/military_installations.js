/**
 * server/tools/military_installations.js — OnDemand-callable OpenStreetMap
 * military installation query backed by the Overpass proxy (server/providers/military-installations.js).
 *
 * Queries mapped military installations (airfields, naval bases, barracks,
 * ranges, bases, and landuse=military) inside a non-dateline bounding box
 * up to 10 degrees across.
 */
import { militaryInstallationsProxy } from '../providers/military-installations.js';
import { createPluginInvoker } from './_invoke.js';

const defaultInvoke = createPluginInvoker(() => militaryInstallationsProxy());

const isoUtc = (date = new Date()) =>
  (date instanceof Date ? date : new Date(date)).toISOString();

export const plugin = Object.freeze({
  id: 'military_installations',
  name: 'OnDemand Spatial Military Installations (OSM)',
  description:
    'Mapped military installations, airfields, naval stations, training ranges, ' +
    'barracks, and restricted military landuse from OpenStreetMap inside a bounding box ' +
    '(up to 10 degrees wide). Uses the cached Overpass QL installation proxy to retrieve ' +
    'feature tags, names, geometries, and center coordinates. Keyless open data.',
  category: 'Research',
  conversationStarters: [
    'Find military installations and airfields near San Diego (box 32.5,-117.3 to 33.0,-116.8)',
    'Search for mapped naval bases and defense facilities around Norfolk, VA (box 36.8,-76.4 to 37.1,-76.0)',
    'Are there military ranges or airfields near Las Vegas (box 36.0,-115.5 to 36.7,-114.8)?',
    'List defense sites and military areas around Oahu, Hawaii',
  ],
});

export function createMilitaryInstallationTools({
  invoke = defaultInvoke,
} = {}) {
  const militaryInstallationsInBbox = {
    name: 'military_installations_in_bbox',
    summary:
      'OpenStreetMap mapped military bases, airfields, and installations in a bounding box',
    description:
      'Queries OpenStreetMap for mapped military installations (airfields, naval bases, ' +
      'barracks, ranges, and landuse=military) inside a bounding box (south, west, north, east). ' +
      'Bounding box must not cross the antimeridian and must span at most 10 degrees in latitude ' +
      'and longitude. Returns feature tags, geometry type, center coordinates, and name.',
    cacheSeconds: 600,
    params: {
      south: {
        type: 'number',
        required: true,
        min: -90,
        max: 90,
        description: 'Bounding-box south latitude in decimal degrees.',
      },
      west: {
        type: 'number',
        required: true,
        min: -180,
        max: 180,
        description: 'Bounding-box west longitude in decimal degrees.',
      },
      north: {
        type: 'number',
        required: true,
        min: -90,
        max: 90,
        description: 'Bounding-box north latitude in decimal degrees.',
      },
      east: {
        type: 'number',
        required: true,
        min: -180,
        max: 180,
        description: 'Bounding-box east longitude in decimal degrees.',
      },
      limit: {
        type: 'integer',
        min: 1,
        max: 200,
        default: 50,
        description:
          'Maximum number of installations to return (1 to 200). Default 50.',
      },
    },
    async handler(params, ctx = {}) {
      if (params.south > params.north) {
        return {
          ok: false,
          status: 400,
          error: {
            code: 'invalid_param',
            message: 'south must be <= north',
            param: 'south',
          },
        };
      }
      if (params.west > params.east) {
        return {
          ok: false,
          status: 400,
          error: {
            code: 'invalid_param',
            message: 'west must be <= east (dateline crossing not supported)',
            param: 'west',
          },
        };
      }
      if (
        Math.abs(params.north - params.south) > 10 ||
        Math.abs(params.east - params.west) > 10
      ) {
        return {
          ok: false,
          status: 400,
          error: {
            code: 'invalid_param',
            message:
              'Bounding box must not exceed 10 degrees in latitude or longitude',
            param: 'north',
          },
        };
      }

      const nowFn = typeof ctx.now === 'function' ? ctx.now : () => new Date();
      const query = new URLSearchParams({
        south: String(params.south),
        west: String(params.west),
        north: String(params.north),
        east: String(params.east),
        exact: '1',
      });

      try {
        const answer = await invoke(`/api/military-installations?${query}`, {
          signal: ctx.signal,
        });

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
                `Military installations route answered HTTP ${answer.status}`,
            },
            provider: {
              status: 'degraded',
              source: 'OpenStreetMap Military Installations',
              fetchedAt: null,
              ageSec: null,
              error: answer.json?.error || 'Upstream query error',
              count: 0,
            },
          };
        }

        const rawElements = Array.isArray(answer.json.elements)
          ? answer.json.elements
          : [];

        const normalized = rawElements.map((el) => {
          const lat =
            typeof el.lat === 'number'
              ? el.lat
              : typeof el.center?.lat === 'number'
                ? el.center.lat
                : null;
          const lon =
            typeof el.lon === 'number'
              ? el.lon
              : typeof el.center?.lon === 'number'
                ? el.center.lon
                : null;
          return {
            id: el.id,
            type: el.type,
            name: el.tags?.name || null,
            militaryType: el.tags?.military || el.tags?.landuse || 'military',
            lat,
            lon,
            tags: el.tags || {},
          };
        });

        const installations = normalized.slice(0, params.limit);

        return {
          ok: true,
          data: {
            bbox: {
              south: params.south,
              west: params.west,
              north: params.north,
              east: params.east,
            },
            count: installations.length,
            totalFound: rawElements.length,
            saturated: answer.json.saturated === true,
            installations,
          },
          provider: {
            status: 'live',
            source: 'OpenStreetMap Military Installations',
            fetchedAt: answer.json.retrievedAt || isoUtc(nowFn()),
            ageSec: 0,
            error: null,
            count: installations.length,
          },
          provenance: {
            provider: 'OpenStreetMap (ODbL)',
            source_url: 'https://overpass-api.de/api/interpreter',
            license: {
              name: 'Open Database License (ODbL)',
              url: 'https://opendatacommons.org/licenses/odbl/',
              attribution: '© OpenStreetMap contributors',
            },
            completeness: {
              status: 'bounded',
              note: `Military installations inside bounding box [${params.south}, ${params.west}, ${params.north}, ${params.east}].`,
            },
          },
        };
      } catch (err) {
        return {
          ok: false,
          status: 502,
          error: {
            code: 'tool_failed',
            message: `military_installations_in_bbox failed: ${String(err?.message || err).slice(0, 160)}`,
          },
        };
      }
    },
  };

  return [militaryInstallationsInBbox];
}

export const tools = createMilitaryInstallationTools();
