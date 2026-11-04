/**
 * Server-side, never-blocking geocoder for the Blender render proxy.
 *
 * The GPU render service raises `geocode_failed` (and the job dies before any
 * Blender frame) when Nominatim has no hit for the raw prompt — e.g.
 * "kanes boxing gym abu dhabi" or "concert crowd at etihad arena". Perplexity
 * ("Not enough credits") and the verified-geocoder gate ("A verified,
 * attributed geocoder candidate is required") used to block Build the same way.
 *
 * resolvePromptLocation() therefore always returns coordinates:
 *   1. known-places table (same landmarks the render service knows),
 *   2. Nominatim (UAE-scoped) on the prompt with scenario words stripped,
 *      then progressively shorter word windows,
 *   3. city fallback (Abu Dhabi / Dubai / Sharjah mentioned in the prompt),
 *   4. prompt-only fallback: Abu Dhabi city centre, flagged approximate.
 * The result travels with the job so the UI can say how the place was found.
 */

export const KNOWN_PLACES = Object.freeze([
  {
    name: 'Yas Mall',
    lat: 24.4886,
    lng: 54.6085,
    aliases: ['yas mall', 'yasmall'],
  },
  {
    name: 'Etihad Arena',
    lat: 24.46036,
    lng: 54.60422,
    aliases: ['etihad arena'],
  },
  {
    name: 'Emirates Palace',
    lat: 24.4617,
    lng: 54.3173,
    aliases: ['emirates palace'],
  },
  {
    name: 'Dubai Marina',
    lat: 25.0805,
    lng: 55.1403,
    aliases: ['dubai marina', 'marina dubai'],
  },
  {
    name: 'Burj Khalifa',
    lat: 25.1972,
    lng: 55.2744,
    aliases: ['burj khalifa', 'burjkhalifa'],
  },
  {
    name: 'Umm Suqeim',
    lat: 25.1556,
    lng: 55.2122,
    aliases: ['umm suqeim', 'um suqeim'],
  },
]);

const CITIES = Object.freeze([
  { name: 'Abu Dhabi', lat: 24.4539, lng: 54.3773, re: /abu\s*dhabi/i },
  { name: 'Dubai', lat: 25.2048, lng: 55.2708, re: /dubai/i },
  { name: 'Sharjah', lat: 25.3463, lng: 55.4209, re: /sharjah/i },
]);

const DEFAULT_CITY = CITIES[0];

const SCENARIO_WORDS =
  /\b(police|raid|crash|car|cars|outside|near|at|in|on|the|a|an|crowd|concert|staging|event|world|protection|night|dusk|midday|im|i'm|doing|scene|of|with|and|checkpoint|accident|fire|riot)\b/g;

export function cleanPlaceQuery(prompt) {
  return String(prompt || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(SCENARIO_WORDS, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Word windows from longest to shortest, keeping order: "a b c" -> ["a b c","a b","b c","a","b","c"]. */
export function queryLadder(query, maxQueries = 6) {
  const words = query.split(' ').filter(Boolean);
  const out = [];
  for (let len = words.length; len >= 1 && out.length < maxQueries; len -= 1) {
    for (
      let i = 0;
      i + len <= words.length && out.length < maxQueries;
      i += 1
    ) {
      const q = words.slice(i, i + len).join(' ');
      if (q.length >= 3 && !out.includes(q)) out.push(q);
    }
  }
  return out;
}

export async function resolvePromptLocation(
  prompt,
  { fetchImpl = globalThis.fetch, timeoutMs = 4000, log = () => {} } = {},
) {
  const p = String(prompt || '').toLowerCase();
  for (const kp of KNOWN_PLACES) {
    if (kp.aliases.some((a) => p.includes(a)))
      return {
        name: kp.name,
        lat: kp.lat,
        lng: kp.lng,
        source: 'known-place-table',
        approximate: true,
        query: null,
      };
  }
  const ladder = queryLadder(cleanPlaceQuery(prompt), 4);
  for (const q of ladder) {
    if (CITIES.some((c) => c.re.test(q) && q.replace(c.re, '').trim() === ''))
      continue; // city-only: handled below
    try {
      const url =
        'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ae&q=' +
        encodeURIComponent(q);
      const r = await fetchImpl(url, {
        headers: {
          'user-agent': 'gods-eye-view-render-proxy/1.0 (scene builder)',
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) {
        log('nominatim_http', { q, status: r.status });
        continue;
      }
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) {
        const lat = Number(rows[0].lat);
        const lng = Number(rows[0].lon);
        if (Number.isFinite(lat) && Number.isFinite(lng))
          return {
            name: String(rows[0].name || rows[0].display_name || q).slice(
              0,
              80,
            ),
            lat,
            lng,
            source: 'nominatim',
            approximate: true,
            query: q,
          };
      }
    } catch (error) {
      log('nominatim_error', {
        q,
        error: String(error?.message || error).slice(0, 120),
      });
      break; // network trouble: do not burn the budget on more lookups
    }
  }
  const city = CITIES.find((c) => c.re.test(p));
  if (city)
    return {
      name: city.name,
      lat: city.lat,
      lng: city.lng,
      source: 'city-fallback',
      approximate: true,
      query: null,
    };
  return {
    name: DEFAULT_CITY.name,
    lat: DEFAULT_CITY.lat,
    lng: DEFAULT_CITY.lng,
    source: 'prompt-only-fallback',
    approximate: true,
    query: null,
  };
}
