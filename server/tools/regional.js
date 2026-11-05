/**
 * server/tools/regional.js — OnDemand-callable regional situational briefing
 * backed by the composite regional briefing proxy (server/providers/regional/briefing.js).
 *
 * Runs completely server-side, combining:
 *   - Nominatim reverse geocoding for administrative context (city, county, country)
 *   - Open-Meteo for live weather and atmospheric conditions
 *   - Local news headlines related to the detected location
 */
import { regionalBriefProxy } from '../providers/regional/briefing.js';
import { createPluginInvoker } from './_invoke.js';

const defaultInvoke = createPluginInvoker(() => regionalBriefProxy());

const isoUtc = (date = new Date()) =>
  (date instanceof Date ? date : new Date(date)).toISOString();

export const plugin = Object.freeze({
  id: 'regional',
  name: 'OnDemand Spatial Regional Briefing (Weather, Place, News)',
  description:
    'Computes a unified situational brief for any geographic coordinate: ' +
    'administrative place context from OpenStreetMap Nominatim reverse geocoding ' +
    '(city, region, country, hierarchy), live meteorological conditions and forecast ' +
    'from Open-Meteo (temperature, wind, weather code, precipitation), and localized ' +
    'news headlines. 5-minute server cache with stale fallback. Completely keyless.',
  category: 'Research',
  conversationStarters: [
    'Give me a regional situational brief for Austin, Texas (lat 30.27, lon -97.74)',
    'What is the current weather and local context for Tokyo (lat 35.68, lon 139.76)?',
    'Get regional briefing for Cairo, Egypt (lat 30.04, lon 31.24)',
    'What is happening in Reykjavik, Iceland (lat 64.15, lon -21.94)?',
  ],
});

export function createRegionalTools({ invoke = defaultInvoke } = {}) {
  const regionalBrief = {
    name: 'regional_brief',
    summary:
      'Situational regional brief at coordinates (place context, weather, local news)',
    description:
      'Computes a unified situational brief for lat/lon: administrative place hierarchy ' +
      'from Nominatim, live weather from Open-Meteo, and local news articles. ' +
      'Answers with structured status (ready, partial, cached, stale). Keyless open data.',
    cacheSeconds: 300,
    params: {
      lat: {
        type: 'number',
        required: true,
        min: -90,
        max: 90,
        description: 'Latitude in decimal degrees (WGS84).',
      },
      lon: {
        type: 'number',
        required: true,
        min: -180,
        max: 180,
        description: 'Longitude in decimal degrees (WGS84).',
      },
    },
    async handler(params, ctx = {}) {
      const nowFn = typeof ctx.now === 'function' ? ctx.now : () => new Date();
      const query = new URLSearchParams({
        latitude: String(params.lat),
        longitude: String(params.lon),
      });

      try {
        const answer = await invoke(`/api/regional-brief?${query}`, {
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
                `Regional briefing route answered HTTP ${answer.status}`,
            },
            provider: {
              status: 'unavailable',
              source: 'Regional Brief',
              fetchedAt: null,
              ageSec: null,
              error: answer.json?.error || 'Regional briefing unavailable',
              count: 0,
            },
          };
        }

        const brief = answer.json;
        const isReady = brief.status === 'ready' || brief.status === 'cached';

        return {
          ok: true,
          data: brief,
          provider: {
            status: isReady ? 'live' : 'degraded',
            source: 'Regional Briefing Composite (Open-Meteo, Nominatim, News)',
            fetchedAt: brief.retrievedAt || isoUtc(nowFn()),
            ageSec: answer.headers?.['x-regional-brief'] === 'HIT' ? 60 : 0,
            error: null,
            count: (brief.articles?.length || 0) + (brief.weather ? 1 : 0),
          },
          provenance: {
            provider:
              'Regional Briefing (Composite: Open-Meteo / Nominatim / RSS)',
            source_url: 'https://open-meteo.com/',
            license: {
              name: 'Open Data Licenses (ODbL, CC-BY 4.0)',
              url: 'https://open-meteo.com/en/terms',
              attribution:
                'Open-Meteo weather, © OpenStreetMap contributors, Regional news sources',
            },
            completeness: {
              status: 'estimated',
              note: 'Composite regional synthesis; news and reverse geocoding may have variable regional coverage.',
            },
          },
        };
      } catch (err) {
        return {
          ok: false,
          status: 502,
          error: {
            code: 'tool_failed',
            message: `regional_brief failed: ${String(err?.message || err).slice(0, 160)}`,
          },
        };
      }
    },
  };

  return [regionalBrief];
}

export const tools = createRegionalTools();
