/**
 * OpenStreetMap data access for the deterministic scene engine (server only):
 *   • Overpass `around:` queries for building footprints + road network
 *   • OSRM routing (geojson geometry) for approach / egress / route lines
 *   • memory LRU + best-effort /tmp persistence (serverless instances are
 *     ephemeral; a cold instance simply refetches)
 *
 * Nothing here invents geometry: every failure is reported as `null` /
 * `{ok:false, reason}` and the engine records it under `unavailable[]`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const OVERPASS_ENDPOINTS = Object.freeze([
  // Order = reachability measured 2026-11-01 from the agent sandbox with this UA.
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]);
export const OSRM_ENDPOINTS = Object.freeze([
  'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  'https://router.project-osrm.org/route/v1/driving',
]);
const UA = {
  'User-Agent':
    'ondemand-spatial/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)',
  Referer: 'https://github.com/bilawalsidhu/gods-eye-view',
  Accept: 'application/json',
};
const MAX_BODY = 6 * 1024 * 1024;
export const ROAD_CLASSES = Object.freeze([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'service',
]);
export const MAJOR_ROAD_CLASSES = Object.freeze([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
]);

export function resolveOverpassEndpoints(env = process.env) {
  const raw = String(
    env.SCENE_OVERPASS_ENDPOINTS || env.OVERPASS_ENDPOINTS || '',
  ).trim();
  const list = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^https:\/\//.test(s));
  return list.length ? list : [...OVERPASS_ENDPOINTS];
}

export function overpassQuery({ lat, lon, buildingRadiusM, roadRadiusM }) {
  const la = lat.toFixed(6);
  const lo = lon.toFixed(6);
  const b = Math.round(buildingRadiusM);
  const r = Math.round(roadRadiusM);
  const classes = ROAD_CLASSES.join('|');
  return `[out:json][timeout:20];(way(around:${b},${la},${lo})[building];way(around:${r},${la},${lo})[highway~"^(${classes})$"];);out geom;`;
}

/** Convert Overpass `out geom` ways into plain GeoJSON features. */
export function overpassToFeatures(payload) {
  const buildings = [];
  const roads = [];
  for (const el of Array.isArray(payload?.elements) ? payload.elements : []) {
    if (
      el?.type !== 'way' ||
      !Array.isArray(el.geometry) ||
      el.geometry.length < 2
    )
      continue;
    const coords = el.geometry
      .filter((p) => Number.isFinite(p?.lon) && Number.isFinite(p?.lat))
      .map((p) => [
        Math.round(p.lon * 1e6) / 1e6,
        Math.round(p.lat * 1e6) / 1e6,
      ]);
    if (coords.length < 2) continue;
    const tags = el.tags || {};
    const name =
      typeof tags['name:en'] === 'string'
        ? tags['name:en']
        : typeof tags.name === 'string'
          ? tags.name
          : '';
    if (tags.building && coords.length >= 4) {
      const first = coords[0];
      const last = coords.at(-1);
      const ring =
        first[0] === last[0] && first[1] === last[1]
          ? coords
          : [...coords, first];
      if (ring.length >= 4)
        buildings.push({
          type: 'Feature',
          properties: {
            osmId: el.id,
            name,
            building: String(tags.building),
            levels: tags['building:levels'] || null,
          },
          geometry: { type: 'Polygon', coordinates: [ring] },
        });
    } else if (tags.highway && ROAD_CLASSES.includes(tags.highway)) {
      roads.push({
        type: 'Feature',
        properties: {
          osmId: el.id,
          name,
          highway: tags.highway,
          major: MAJOR_ROAD_CLASSES.includes(tags.highway),
          oneway: tags.oneway === 'yes',
        },
        geometry: { type: 'LineString', coordinates: coords },
      });
    }
  }
  return { buildings, roads };
}

const cacheKey = (lat, lon, b, r) =>
  `ov:${lat.toFixed(4)},${lon.toFixed(4)}:${Math.round(b)}:${Math.round(r)}`;
const routeKey = (a, b) =>
  `rt:${a[0].toFixed(4)},${a[1].toFixed(4)}>${b[0].toFixed(4)},${b[1].toFixed(4)}`;

export function createOsmClient({
  fetch: fetchImpl = (...a) => globalThis.fetch(...a),
  env = process.env,
  overpassEndpoints = resolveOverpassEndpoints(env),
  osrmEndpoints = OSRM_ENDPOINTS,
  ttlMs = 24 * 3600 * 1000,
  maxEntries = 64,
  persistPath = path.join(os.tmpdir(), 'gev-scene-osm-cache.json'),
  persist = true,
  now = () => Date.now(),
  overpassTimeoutMs = 22000,
  osrmTimeoutMs = 10000,
} = {}) {
  const cache = new Map();
  let loaded = false;
  let saving = null;

  async function load() {
    if (loaded || !persist) return;
    loaded = true;
    try {
      const data = JSON.parse(await readFile(persistPath, 'utf8'));
      if (data && typeof data === 'object')
        for (const [k, v] of Object.entries(data))
          if (v && typeof v.expires === 'number' && v.expires > now())
            cache.set(k, v);
    } catch {
      /* no persisted cache */
    }
  }
  function save() {
    if (!persist || saving) return;
    saving = (async () => {
      try {
        await writeFile(
          persistPath,
          JSON.stringify(Object.fromEntries(cache)),
          { mode: 0o600 },
        );
      } catch {
        /* best effort */
      } finally {
        saving = null;
      }
    })();
  }
  function get(key) {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (hit.expires <= now()) {
      cache.delete(key);
      return undefined;
    }
    cache.delete(key);
    cache.set(key, hit);
    return hit.value;
  }
  function set(key, value) {
    cache.set(key, { value, expires: now() + ttlMs });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    save();
  }

  async function postJson(url, body, { signal, timeoutMs }) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { ...UA, 'content-type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(body)}`,
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) {
      await res.body?.cancel?.();
      throw new Error(`upstream ${res.status}`);
    }
    const text = await res.text();
    if (text.length > MAX_BODY) throw new Error('upstream body too large');
    return JSON.parse(text);
  }
  async function getJson(url, { signal, timeoutMs }) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await fetchImpl(url, {
      headers: UA,
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) {
      await res.body?.cancel?.();
      throw new Error(`upstream ${res.status}`);
    }
    const text = await res.text();
    if (text.length > MAX_BODY) throw new Error('upstream body too large');
    return JSON.parse(text);
  }

  return {
    /** Buildings + roads around the anchor. `{ok, buildings, roads, endpoint, cacheHit, ms, reason?}` */
    async surroundings({
      lat,
      lon,
      buildingRadiusM = 150,
      roadRadiusM = 700,
      signal,
    } = {}) {
      await load();
      const key = cacheKey(lat, lon, buildingRadiusM, roadRadiusM);
      const t0 = now();
      const cached = get(key);
      if (cached) return { ...cached, cacheHit: true, ms: now() - t0 };
      const query = overpassQuery({ lat, lon, buildingRadiusM, roadRadiusM });
      const failures = [];
      for (const endpoint of overpassEndpoints) {
        if (signal?.aborted)
          throw new DOMException('Request cancelled', 'AbortError');
        try {
          const payload = await postJson(endpoint, query, {
            signal,
            timeoutMs: overpassTimeoutMs,
          });
          if (!Array.isArray(payload?.elements)) throw new Error('no elements');
          const { buildings, roads } = overpassToFeatures(payload);
          const value = { ok: true, buildings, roads, endpoint };
          set(key, value);
          return { ...value, cacheHit: false, ms: now() - t0 };
        } catch (error) {
          if (signal?.aborted) throw error;
          failures.push(
            `${new URL(endpoint).hostname}: ${String(error?.name === 'TimeoutError' ? 'timeout' : error?.message || error).slice(0, 60)}`,
          );
        }
      }
      return {
        ok: false,
        buildings: [],
        roads: [],
        endpoint: null,
        cacheHit: false,
        ms: now() - t0,
        reason: failures.join('; ').slice(0, 400) || 'no overpass endpoint',
      };
    },
    /** Road route between [lon,lat] points. `{ok, coordinates, distanceM, endpoint, cacheHit, ms, reason?}` */
    async route(from, to, { signal, alternatives = false } = {}) {
      await load();
      const key = routeKey(from, to);
      const t0 = now();
      const cached = get(key);
      if (cached) return { ...cached, cacheHit: true, ms: now() - t0 };
      const coords = `${from[0].toFixed(6)},${from[1].toFixed(6)};${to[0].toFixed(6)},${to[1].toFixed(6)}`;
      const failures = [];
      for (const endpoint of osrmEndpoints) {
        if (signal?.aborted)
          throw new DOMException('Request cancelled', 'AbortError');
        try {
          const data = await getJson(
            `${endpoint}/${coords}?overview=full&geometries=geojson&steps=false&alternatives=${alternatives ? 'true' : 'false'}`,
            { signal, timeoutMs: osrmTimeoutMs },
          );
          const route = data?.routes?.[0];
          const line = route?.geometry?.coordinates;
          if (data?.code !== 'Ok' || !Array.isArray(line) || line.length < 2)
            throw new Error(`osrm ${data?.code || 'no route'}`);
          const value = {
            ok: true,
            coordinates: line.map(([x, y]) => [
              Math.round(x * 1e6) / 1e6,
              Math.round(y * 1e6) / 1e6,
            ]),
            distanceM: Math.round(route.distance || 0),
            endpoint,
          };
          set(key, value);
          return { ...value, cacheHit: false, ms: now() - t0 };
        } catch (error) {
          if (signal?.aborted) throw error;
          failures.push(
            `${new URL(endpoint).hostname}: ${String(error?.name === 'TimeoutError' ? 'timeout' : error?.message || error).slice(0, 60)}`,
          );
        }
      }
      return {
        ok: false,
        coordinates: null,
        distanceM: 0,
        endpoint: null,
        cacheHit: false,
        ms: now() - t0,
        reason: failures.join('; ').slice(0, 400) || 'no routing endpoint',
      };
    },
    stats: () => ({ entries: cache.size }),
  };
}
