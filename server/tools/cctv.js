/**
 * server/tools/cctv.js — OnDemand-callable CCTV camera catalogue query
 * backed by the multi-region camera directory (server/providers/cctv/catalog.js).
 *
 * Returns metadata for catalogued traffic and surveillance cameras inside
 * a geographic bounding box (coordinates, label, city, sourceKind, feedType).
 * Metadata only — no image or video frames.
 */
import { createCctvCatalog } from '../providers/cctv/catalog.js';

const defaultCatalog = createCctvCatalog();

const isoUtc = (date = new Date()) =>
  (date instanceof Date ? date : new Date(date)).toISOString();

export const plugin = Object.freeze({
  id: 'cctv',
  name: 'OnDemand Spatial CCTV Camera Catalogue (Open Data)',
  description:
    'Catalogued public traffic and surveillance cameras inside a geographic bounding box ' +
    'across North America, the UK, Europe, and Australia: Austin Open Data, Caltrans ' +
    '(California highways), Transport for London (TfL JamCams), Ontario 511, DriveBC, ' +
    'Fintraffic (Finland), TxDOT (Texas statewide), Tallinn, Calgary, and NSW. ' +
    'Returns camera metadata (ID, label, coordinates, city, operator source, feed type) ' +
    'without streaming media frames.',
  category: 'Research',
  conversationStarters: [
    'Find traffic cameras in downtown Austin inside bbox 30.25,-97.77 to 30.29,-97.72',
    'List public CCTV cameras along London highway corridors (bbox 51.48,-0.18 to 51.54,-0.08)',
    'Are there Caltrans highway cameras around San Francisco (bbox 37.70,-122.52 to 37.82,-122.38)?',
    'Locate surveillance and traffic cameras near Vancouver (bbox 49.20,-123.20 to 49.32,-123.00)',
  ],
});

export function createCctvTools({ getCatalog = defaultCatalog } = {}) {
  const camerasInBbox = {
    name: 'cameras_in_bbox',
    summary:
      'Traffic and surveillance cameras within a bounding box (metadata only)',
    description:
      'Returns metadata for catalogued public traffic cameras inside a bounding box ' +
      '(lamin, lomin, lamax, lomax). Sources include Austin, Caltrans, TfL JamCams, ' +
      'TxDOT, DriveBC, Fintraffic, Calgary, NSW, and Tallinn. Metadata only: camera ID, ' +
      'label/name, coordinates, city, source kind, and feed type — no media frames.',
    cacheSeconds: 300,
    params: {
      lamin: {
        type: 'number',
        required: true,
        min: -90,
        max: 90,
        description: 'Bounding-box south latitude in decimal degrees.',
      },
      lomin: {
        type: 'number',
        required: true,
        min: -180,
        max: 180,
        description: 'Bounding-box west longitude in decimal degrees.',
      },
      lamax: {
        type: 'number',
        required: true,
        min: -90,
        max: 90,
        description: 'Bounding-box north latitude in decimal degrees.',
      },
      lomax: {
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
          'Maximum number of cameras to return (1 to 200). Default 50.',
      },
    },
    async handler(params, ctx = {}) {
      if (params.lamin > params.lamax) {
        return {
          ok: false,
          status: 400,
          error: {
            code: 'invalid_param',
            message: 'lamin must be <= lamax',
            param: 'lamin',
          },
        };
      }
      if (params.lomin > params.lomax) {
        return {
          ok: false,
          status: 400,
          error: {
            code: 'invalid_param',
            message: 'lomin must be <= lomax',
            param: 'lomin',
          },
        };
      }

      const nowFn = typeof ctx.now === 'function' ? ctx.now : () => new Date();

      try {
        const allSources = await getCatalog();
        const sources = Array.isArray(allSources) ? allSources : [];

        const matching = [];
        for (const cam of sources) {
          const lat = cam.latitude ?? cam.lat;
          const lon = cam.longitude ?? cam.lon;
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

          if (
            lat >= params.lamin &&
            lat <= params.lamax &&
            lon >= params.lomin &&
            lon <= params.lomax
          ) {
            matching.push({
              id: cam.id,
              label: cam.label || cam.name || `Camera ${cam.id}`,
              city: cam.city || null,
              sourceKind: cam.sourceKind || 'cctv',
              latitude: lat,
              longitude: lon,
              feedType: cam.feedType || 'image',
            });
          }
        }

        const cameras = matching.slice(0, params.limit);

        return {
          ok: true,
          data: {
            bbox: {
              lamin: params.lamin,
              lomin: params.lomin,
              lamax: params.lamax,
              lomax: params.lomax,
            },
            count: cameras.length,
            totalInBbox: matching.length,
            totalInCatalog: sources.length,
            cameras,
          },
          provider: {
            status: 'live',
            source: 'CCTV Camera Directory (Open Data)',
            fetchedAt: isoUtc(nowFn()),
            ageSec: 0,
            error: null,
            count: cameras.length,
          },
          provenance: {
            provider: 'Municipal & Regional Open Data Camera Feeds',
            source_url: 'https://github.com/bilawalsidhu/gods-eye-view',
            license: {
              name: 'Open Government / Municipal Open Data Licenses',
              url: 'https://data.austintexas.gov/',
              attribution:
                'Austin Open Data, Caltrans, TfL, TxDOT, DriveBC, Fintraffic, etc.',
            },
            completeness: {
              status: 'bounded',
              note: `CCTV cameras bounded by box [${params.lamin}, ${params.lomin}, ${params.lamax}, ${params.lomax}]. Metadata only.`,
            },
          },
        };
      } catch (err) {
        return {
          ok: false,
          status: 502,
          error: {
            code: 'tool_failed',
            message: `cameras_in_bbox failed: ${String(err?.message || err).slice(0, 160)}`,
          },
        };
      }
    },
  };

  return [camerasInBbox];
}

export const tools = createCctvTools();
