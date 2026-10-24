/**
 * Gods-Eye Footage TTL Cache
 * LRU cache with TTL determined by item recency (LIVE: 60s, RECENT: 10m, ARCHIVE: 24h).
 */

export const FOOTAGE_CACHE_TTL = Object.freeze({
  LIVE: 60_000,
  RECENT: 600_000,
  ARCHIVE: 86_400_000,
});

/**
 * Creates an in-memory LRU footage cache.
 * @param {{ now?: () => number, maxEntries?: number }} options
 */
export function createFootageCache({
  now = () => Date.now(),
  maxEntries = 200,
} = {}) {
  const map = new Map();
  let hits = 0;
  let misses = 0;

  function keyFor({ sceneId, platform, query, tRef } = {}) {
    const qStr =
      typeof query === 'object' && query !== null
        ? JSON.stringify(query)
        : String(query || '');
    return `${sceneId || ''}:${platform || ''}:${qStr}:${tRef || ''}`;
  }

  function get(key) {
    if (!map.has(key)) {
      misses += 1;
      return null;
    }
    const entry = map.get(key);
    const currentTime = now();
    if (currentTime > entry.expiresAt) {
      map.delete(key);
      misses += 1;
      return null;
    }
    // Refresh LRU position
    map.delete(key);
    map.set(key, entry);
    hits += 1;
    return entry.items.map((it) => ({ ...it }));
  }

  function set(key, items, recency = 'RECENT') {
    const rec = String(recency || '').toUpperCase();
    const ttl = FOOTAGE_CACHE_TTL[rec] || FOOTAGE_CACHE_TTL.RECENT;
    const currentTime = now();
    const expiresAt = currentTime + ttl;

    if (map.has(key)) {
      map.delete(key);
    } else if (map.size >= maxEntries) {
      const oldestKey = map.keys().next().value;
      if (oldestKey !== undefined) {
        map.delete(oldestKey);
      }
    }

    map.set(key, {
      items: Array.isArray(items) ? items.map((it) => ({ ...it })) : [],
      recency: rec,
      expiresAt,
      createdAt: currentTime,
    });
  }

  function stats() {
    return {
      hits,
      misses,
      size: map.size,
    };
  }

  function clear() {
    map.clear();
    hits = 0;
    misses = 0;
  }

  return {
    keyFor,
    get,
    set,
    stats,
    clear,
  };
}
