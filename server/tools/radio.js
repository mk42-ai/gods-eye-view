/**
 * server/tools/radio.js — OnDemand-callable internet radio station query
 * backed by the Community Radio Browser proxy (server/providers/radio.js).
 *
 * Queries geocoded public internet radio stations nearest to lat/lon within
 * radius_km, filterable by tag/genre (news, classical, jazz, ambient, rock, etc.).
 */
import { radioBrowserProxy } from '../providers/radio.js';
import { haversineKm } from '../providers/common/geo.js';
import { createPluginInvoker } from './_invoke.js';

const defaultInvoke = createPluginInvoker(() => radioBrowserProxy());

const isoUtc = (date = new Date()) =>
  (date instanceof Date ? date : new Date(date)).toISOString();

export const plugin = Object.freeze({
  id: 'radio',
  name: 'OnDemand Spatial Radio Stations (Radio Browser)',
  description:
    'Discovers geocoded public internet radio stations nearest to a geographic coordinate ' +
    'from the community-maintained Radio Browser directory. Filterable by tag/genre ' +
    '(news, jazz, classical, ambient, rock, electronic, pop). Returns station metadata, ' +
    'stream URL, country, language, bitrate/codec, homepage, and distance in kilometres. ' +
    'Keyless open community data.',
  category: 'Research',
  conversationStarters: [
    'Find local radio stations near Austin, Texas (lat 30.27, lon -97.74)',
    'List news radio stations within 500 km of London (lat 51.51, lon -0.13)',
    'Search classical and ambient radio stations near Vienna (lat 48.21, lon 16.37)',
    'What public radio streams are broadcasting near Sydney, Australia (lat -33.87, lon 151.21)?',
  ],
});

export function createRadioTools({ invoke = defaultInvoke } = {}) {
  const radioStationsNear = {
    name: 'radio_stations_near',
    summary:
      'Geocoded public internet radio stations near a coordinate (Radio Browser)',
    description:
      'Queries geocoded public internet radio stations from the community Radio Browser ' +
      'directory nearest to lat/lon within radius_km. Optional `tag` filters by genre ' +
      'or broadcast category (e.g. "news", "jazz", "classical", "rock", "ambient"). ' +
      'Returns station ID, name, stream URL, country, language, tags, and distance.',
    cacheSeconds: 300,
    params: {
      lat: {
        type: 'number',
        required: true,
        min: -90,
        max: 90,
        description: 'Latitude of search point in decimal degrees (WGS84).',
      },
      lon: {
        type: 'number',
        required: true,
        min: -180,
        max: 180,
        description: 'Longitude of search point in decimal degrees (WGS84).',
      },
      radius_km: {
        type: 'number',
        min: 1,
        max: 2000,
        default: 300,
        description:
          'Search radius in kilometres around lat/lon (1 to 2000). Default 300 km.',
      },
      tag: {
        type: 'string',
        maxLength: 50,
        description:
          'Optional genre or topic tag filter (e.g. "news", "jazz", "classical", "ambient").',
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
      const nowFn = typeof ctx.now === 'function' ? ctx.now : () => new Date();

      try {
        const answer = await invoke('/api/radio/stations', {
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
                `Radio directory answered HTTP ${answer.status}`,
            },
            provider: {
              status: 'degraded',
              source: 'Radio Browser Directory',
              fetchedAt: null,
              ageSec: null,
              error: answer.json?.error || 'Radio directory unavailable',
              count: 0,
            },
          };
        }

        const rawStations = Array.isArray(answer.json.stations)
          ? answer.json.stations
          : [];

        const tagFilter = params.tag
          ? String(params.tag).trim().toLowerCase()
          : null;

        const filtered = [];
        for (const st of rawStations) {
          const lat = Number(st.lat ?? st.latitude);
          const lon = Number(st.lon ?? st.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

          const dist = haversineKm(params.lat, params.lon, lat, lon);
          if (dist > params.radius_km) continue;

          if (tagFilter) {
            const tags = Array.isArray(st.tags)
              ? st.tags.map((t) => String(t).toLowerCase())
              : typeof st.tags === 'string'
                ? st.tags.toLowerCase().split(',')
                : [];
            const matches = tags.some(
              (t) => t === tagFilter || t.includes(tagFilter),
            );
            if (!matches) continue;
          }

          filtered.push({
            id: st.id || st.stationuuid,
            name: st.name,
            url: st.url || st.url_resolved,
            homepage: st.homepage || null,
            country: st.country || st.countrycode || null,
            language: st.language || null,
            tags: Array.isArray(st.tags)
              ? st.tags
              : typeof st.tags === 'string'
                ? st.tags.split(',').map((t) => t.trim())
                : [],
            codec: st.codec || null,
            bitrate: st.bitrate ?? null,
            lat,
            lon,
            distanceKm: Math.round(dist * 10) / 10,
          });
        }

        filtered.sort((a, b) => a.distanceKm - b.distanceKm);
        const stations = filtered.slice(0, params.limit);

        return {
          ok: true,
          data: {
            scene: {
              lat: params.lat,
              lon: params.lon,
              radiusKm: params.radius_km,
              tag: tagFilter,
            },
            count: stations.length,
            totalInRange: filtered.length,
            totalInDirectory: rawStations.length,
            stations,
          },
          provider: {
            status: 'live',
            source: 'Radio Browser Community Directory',
            fetchedAt: answer.json.updatedAt || isoUtc(nowFn()),
            ageSec: answer.json.stale ? 120 : 0,
            error: null,
            count: stations.length,
          },
          provenance: {
            provider: 'Radio Browser (Community-Driven Radio Directory)',
            source_url: 'https://www.radio-browser.info/',
            license: {
              name: 'Community Public Domain / Open Database',
              url: 'https://www.radio-browser.info/',
              attribution: '© Radio Browser contributors',
            },
            completeness: {
              status: 'sampled',
              note: `Radio stations within ${params.radius_km} km of ${params.lat},${params.lon}.`,
            },
          },
        };
      } catch (err) {
        return {
          ok: false,
          status: 502,
          error: {
            code: 'tool_failed',
            message: `radio_stations_near failed: ${String(err?.message || err).slice(0, 160)}`,
          },
        };
      }
    },
  };

  return [radioStationsNear];
}

export const tools = createRadioTools();
