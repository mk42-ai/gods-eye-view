/**
 * server/tools/places.js — OnDemand-callable place geocoding backed by the
 * server-side OpenStreetMap Nominatim search queue (server/providers/regional/place.js).
 *
 * Runs completely server-side without browser-held keys, observing the
 * upstream Nominatim 1-req/sec policy, application User-Agent header,
 * in-memory cache, and single-flight inflight coalescing.
 */
import { createNominatimSearchProvider } from '../providers/regional/place.js';

const defaultSearch = createNominatimSearchProvider();

const isoUtc = (date = new Date()) =>
  (date instanceof Date ? date : new Date(date)).toISOString();

export const plugin = Object.freeze({
  id: 'places',
  name: 'OnDemand Spatial Place Search & Geocoding (Nominatim)',
  description:
    'Forward geocoding of place names, addresses, cities, and landmarks to geographic ' +
    'coordinates using OpenStreetMap Nominatim. Paced by a server-side queue to observe ' +
    'the Nominatim usage policy (1 request per second max, application User-Agent, ' +
    '5-minute caching). Returns normalized coordinate candidates with bounding box, ' +
    'display name, place type, and importance score. Keyless open data.',
  category: 'Research',
  conversationStarters: [
    'What are the coordinates of the Eiffel Tower in Paris?',
    'Geocode "Brandenburg Gate, Berlin"',
    'Find the location of "Burj Khalifa, Dubai"',
    'Search coordinates for "Mount Fuji, Japan"',
  ],
});

export function createPlacesTools({ searchImpl = defaultSearch } = {}) {
  const geocodePlace = {
    name: 'geocode_place',
    summary:
      'Forward geocoding of place names and addresses to geographic coordinates (Nominatim)',
    description:
      'Resolves a text place query (city, street, landmark, country) to geographic ' +
      'coordinates (latitude, longitude, bounding box, place type, and display name) ' +
      'using OpenStreetMap Nominatim. Paced by an internal queue to comply with public ' +
      'Nominatim rate limits (1 req/sec). An optional `bounds` string ("swLat,swLon|neLat,neLon") ' +
      'biases the search to a rectangular geographic area.',
    cacheSeconds: 300,
    params: {
      q: {
        type: 'string',
        required: true,
        maxLength: 200,
        description:
          'Place name, address, or landmark query (1–200 characters).',
      },
      bounds: {
        type: 'string',
        maxLength: 80,
        description:
          'Optional geographic bounding box bias in "minlat,minlon|maxlat,maxlon" format.',
      },
    },
    async handler(params, ctx = {}) {
      const query = String(params.q || '').trim();
      if (!query) {
        return {
          ok: false,
          status: 400,
          error: {
            code: 'invalid_param',
            message: 'Query parameter "q" must not be empty',
            param: 'q',
          },
        };
      }

      const nowFn = typeof ctx.now === 'function' ? ctx.now : () => new Date();

      try {
        const payload = await searchImpl(query, params.bounds, {
          signal: ctx.signal,
        });

        if (!payload || typeof payload !== 'object') {
          return {
            ok: false,
            status: 502,
            error: {
              code: 'malformed_upstream',
              message: 'Nominatim search returned an empty or invalid response',
            },
          };
        }

        const results = Array.isArray(payload.results) ? payload.results : [];

        return {
          ok: true,
          data: {
            status: payload.status || (results.length ? 'OK' : 'ZERO_RESULTS'),
            query,
            bounds: params.bounds || null,
            count: results.length,
            candidates: results,
          },
          provider: {
            status: 'live',
            source: 'OpenStreetMap Nominatim',
            fetchedAt: isoUtc(nowFn()),
            ageSec: payload.cached ? 60 : 0,
            error: null,
            count: results.length,
          },
          provenance: {
            provider: 'OpenStreetMap Nominatim',
            source_url: 'https://nominatim.openstreetmap.org/search',
            license: {
              name: 'Open Database License (ODbL)',
              url: 'https://opendatacommons.org/licenses/odbl/',
              attribution: '© OpenStreetMap contributors',
            },
            completeness: {
              status: 'sampled',
              note: 'Top matching geocoded candidate from OpenStreetMap Nominatim.',
            },
          },
        };
      } catch (err) {
        return {
          ok: false,
          status: 502,
          error: {
            code: 'upstream_unavailable',
            message: `Nominatim geocoding failed: ${String(err?.message || err).slice(0, 160)}`,
          },
        };
      }
    },
  };

  return [geocodePlace];
}

export const tools = createPlacesTools();
