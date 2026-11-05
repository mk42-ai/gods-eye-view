/**
 * Source-verified site resolver for the Blender workstation.
 *
 * A saved coordinate, city name, or arbitrary first geocoder hit is NOT a site.
 * Known records below identify actual OSM features, not hardcoded coordinates.
 * Their geometry and names are revalidated before use. Missing/ambiguous sites
 * return null, requiring an explicit operator map selection. No city fallback.
 */

export const VERIFIED_SITES = Object.freeze([
  {
    id: 'yas-mall',
    name: 'Yas Mall',
    aliases: ['yas mall', 'yasmall'],
    osmType: 'way',
    osmId: 312812656,
    expectedNames: ['yas mall'],
    precision: 'mapped-building-footprint',
    radiusM: 750,
    reviewedUtc: '2026-11-05T05:22:30Z',
  },
  {
    id: 'kanes-fotouh',
    name: "Kane's Boxing Academy · Fotouh Al Khair Centre",
    aliases: ['kanes boxing', 'kane boxing'],
    osmType: 'way',
    osmId: 27374404,
    expectedNames: ['foutouh al khair centre', 'fotouh al khair centre'],
    precision: 'official-address-mapped-building',
    radiusM: 420,
    officialSource: 'https://kanesboxingacademy.com/contact-us',
    officialAddress:
      'Fotouh Al Khair Centre - Abu Dhabi - United Arab Emirates',
    reviewedUtc: '2026-11-05T05:22:06.683Z',
    limitation:
      'Official contact address identifies the shopping centre, not the gym unit, entrance, interior, or a measured building height.',
  },
]);
// Kept as a public name for existing importers. No approximate coordinate table.
export const KNOWN_PLACES = VERIFIED_SITES;
const SCENARIO_WORDS =
  /\b(police|raid|crash|car|cars|outside|near|at|in|on|the|a|an|crowd|concert|staging|event|night|dusk|midday|scene|of|with|and|checkpoint|accident|fire|riot)\b/g;
export function cleanPlaceQuery(prompt) {
  return String(prompt || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(SCENARIO_WORDS, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
/** Retained utility; resolution deliberately does not shorten to city-only terms. */
export function queryLadder(query, maxQueries = 6) {
  const words = query.split(' ').filter(Boolean);
  const out = [];
  for (let n = words.length; n >= 1 && out.length < maxQueries; n -= 1) {
    for (let i = 0; i + n <= words.length && out.length < maxQueries; i += 1) {
      const q = words.slice(i, i + n).join(' ');
      if (q.length >= 3 && !out.includes(q)) out.push(q);
    }
  }
  return out;
}
function norm(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function validCoordinate(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}
export function polygonCentre(points) {
  if (!Array.isArray(points) || points.length < 4) return null;
  const [ox, oy] = points[0];
  let area2 = 0,
    cx = 0,
    cy = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x, y] = [points[i][0] - ox, points[i][1] - oy];
    const [xx, yy] = [points[i + 1][0] - ox, points[i + 1][1] - oy];
    const cross = x * yy - xx * y;
    area2 += cross;
    cx += (x + xx) * cross;
    cy += (y + yy) * cross;
  }
  if (Math.abs(area2) < 1e-14) return null;
  return { lng: ox + cx / (3 * area2), lat: oy + cy / (3 * area2) };
}
export function locationFromOsm(
  document,
  site,
  now = new Date().toISOString(),
) {
  const els = Array.isArray(document?.elements) ? document.elements : [];
  const way = els.find((e) => e.type === site.osmType && e.id === site.osmId);
  if (!way || !way.tags?.building) return null;
  const names = ['name', 'name:en', 'official_name', 'alt_name']
    .flatMap((k) => String(way.tags[k] || '').split(';'))
    .map(norm);
  if (!site.expectedNames.some((n) => names.includes(norm(n)))) return null;
  const nodes = new Map(
    els.filter((e) => e.type === 'node').map((e) => [e.id, e]),
  );
  if (!way.nodes?.length || way.nodes[0] !== way.nodes.at(-1)) return null;
  const pts = way.nodes.map((id) => nodes.get(id));
  if (pts.some((p) => !p || !validCoordinate(p.lat, p.lon))) return null;
  const geometry = pts.map((p) => [p.lon, p.lat]);
  const center = polygonCentre(geometry);
  if (!center || !validCoordinate(center.lat, center.lng)) return null;
  const bounds = [
    Math.min(...pts.map((p) => p.lon)),
    Math.min(...pts.map((p) => p.lat)),
    Math.max(...pts.map((p) => p.lon)),
    Math.max(...pts.map((p) => p.lat)),
  ];
  const sourceUrl = `https://www.openstreetmap.org/${site.osmType}/${site.osmId}`;
  const apiUrl = `https://api.openstreetmap.org/api/0.6/${site.osmType}/${site.osmId}/full.json`;
  return {
    name: site.name,
    ...center,
    source: 'verified-osm-feature',
    verification: 'verified',
    approximate: false,
    precision: site.precision,
    siteId: site.id,
    osmType: site.osmType,
    osmId: site.osmId,
    sourceFeatureId: `${site.osmType}/${site.osmId}`,
    featureVersion: way.version,
    featureTimestamp: way.timestamp,
    bounds,
    radiusM: site.radiusM,
    verifiedUtc: now,
    reviewedUtc: site.reviewedUtc,
    sourceUrl,
    apiUrl,
    limitation:
      site.limitation ||
      'Mapped footprint centroid, not a surveyed entrance or evidence of an incident.',
    provenance: [
      {
        source: 'OpenStreetMap contributors',
        url: sourceUrl,
        apiUrl,
        license: 'ODbL-1.0',
        attribution: '© OpenStreetMap contributors',
        retrievedUtc: now,
        featureId: `${site.osmType}/${site.osmId}`,
        version: way.version,
        sourceModifiedUtc: way.timestamp,
      },
      ...(site.officialSource
        ? [
            {
              source: "Kane's Boxing Academy official contact page",
              url: site.officialSource,
              fact: site.officialAddress,
              reviewedUtc: site.reviewedUtc,
              precision: 'venue-address-not-gym-unit',
            },
          ]
        : []),
    ],
  };
}

// Per-fetch-client cache avoids test leakage; bounded process-local cache only.
const caches = new WeakMap();
function clientCache(fetchImpl) {
  if (!caches.has(fetchImpl)) caches.set(fetchImpl, new Map());
  return caches.get(fetchImpl);
}
export async function resolvePromptLocation(
  prompt,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = 9000,
    log = () => {},
    now = Date.now,
  } = {},
) {
  const query = cleanPlaceQuery(prompt);
  if (
    !query ||
    /\{\{[^}]*\}\}|<[^>]+>|\[(?:location|place|insert)[^\]]*\]/i.test(
      String(prompt),
    )
  )
    return null;
  const site = VERIFIED_SITES.find((p) =>
    p.aliases.some((a) => norm(prompt).includes(a)),
  );
  const cache = clientCache(fetchImpl),
    key = site ? `osm:${site.osmType}/${site.osmId}:v2` : `query:${query}`;
  const hit = cache.get(key);
  if (hit && hit.until > now()) return hit.promise;
  const promise = (async () => {
    try {
      if (site) {
        const url = `https://api.openstreetmap.org/api/0.6/${site.osmType}/${site.osmId}/full.json`;
        const r = await fetchImpl(url, {
          headers: {
            'user-agent': 'OnDemand-Scene-Workstation/1.0 (site verification)',
            accept: 'application/json',
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!r.ok) {
          log('site_source_http', { status: r.status, site: site.id });
          return null;
        }
        return locationFromOsm(
          await r.json(),
          site,
          new Date(now()).toISOString(),
        );
      }
      const url =
        'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=ae&q=' +
        encodeURIComponent(query);
      const r = await fetchImpl(url, {
        headers: {
          'user-agent': 'OnDemand-Scene-Workstation/1.0 (site verification)',
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) return null;
      const rows = await r.json();
      if (!Array.isArray(rows)) return null;
      const candidates = rows.filter((row) => {
        const name = norm(row.name);
        const asked = norm(query);
        const tokens = name.split(' ').filter(Boolean);
        return (
          tokens.length >= 2 &&
          (asked === name ||
            asked.startsWith(name + ' ') ||
            asked.endsWith(' ' + name)) &&
          !['city', 'town', 'village', 'state', 'country'].includes(row.type) &&
          row.osm_type &&
          row.osm_id &&
          validCoordinate(Number(row.lat), Number(row.lon))
        );
      });
      if (candidates.length !== 1) return null;
      const row = candidates[0];
      return {
        name: row.name,
        lat: Number(row.lat),
        lng: Number(row.lon),
        source: 'nominatim-exact-name',
        verification: 'verified',
        approximate: false,
        precision: row.type,
        sourceFeatureId: `${row.osm_type}/${row.osm_id}`,
        verifiedUtc: new Date(now()).toISOString(),
        sourceUrl: `https://www.openstreetmap.org/${row.osm_type}/${row.osm_id}`,
        radiusM: 500,
        limitation:
          'Single exact-name mapped feature; map data is not a survey or incident evidence.',
        provenance: [
          {
            source: 'OpenStreetMap contributors / Nominatim',
            url: `https://www.openstreetmap.org/${row.osm_type}/${row.osm_id}`,
            apiUrl: url,
            license: 'ODbL-1.0',
            attribution: '© OpenStreetMap contributors',
            retrievedUtc: new Date(now()).toISOString(),
          },
        ],
      };
    } catch (error) {
      log('site_lookup_failed', { kind: error?.name || 'Error' });
      return null;
    }
  })();
  cache.set(key, { until: now() + 3600000, promise });
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  const result = await promise;
  if (!result) cache.delete(key);
  return result;
}
