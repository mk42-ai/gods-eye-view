/**
 * 5-minute route plan TTL cache.
 * Keyed ${origin.lat.toFixed(2)},${origin.lon.toFixed(2)}|${target.lat.toFixed(3)},${target.lon.toFixed(3)}|${aoiId}
 */

export function cacheKeyFor({ origin, target, aoiId } = {}) {
  const oLat =
    origin && typeof origin.lat === 'number' ? origin.lat.toFixed(2) : 'null';
  const oLon =
    origin && typeof origin.lon === 'number' ? origin.lon.toFixed(2) : 'null';
  const tLat =
    target && typeof target.lat === 'number' ? target.lat.toFixed(3) : 'null';
  const tLon =
    target && typeof target.lon === 'number' ? target.lon.toFixed(3) : 'null';
  const aoi = aoiId ?? 'none';
  return `${oLat},${oLon}|${tLat},${tLon}|${aoi}`;
}

export function createRouteCache({
  now = () => Date.now(),
  ttlMs = 300_000,
} = {}) {
  const store = new Map();

  function get(keyOrParams) {
    const key =
      typeof keyOrParams === 'string' ? keyOrParams : cacheKeyFor(keyOrParams);
    const entry = store.get(key);
    if (!entry) return null;
    const nowMs = typeof now === 'function' ? now() : Date.now();
    if (nowMs >= entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.value;
  }

  function set(keyOrParams, value, customTtlMs) {
    const key =
      typeof keyOrParams === 'string' ? keyOrParams : cacheKeyFor(keyOrParams);
    const nowMs = typeof now === 'function' ? now() : Date.now();
    const effectiveTtl = customTtlMs ?? ttlMs;
    store.set(key, { value, expiresAt: nowMs + effectiveTtl });
    return value;
  }

  function has(keyOrParams) {
    return get(keyOrParams) !== null;
  }

  function del(keyOrParams) {
    const key =
      typeof keyOrParams === 'string' ? keyOrParams : cacheKeyFor(keyOrParams);
    return store.delete(key);
  }

  function clear() {
    store.clear();
  }

  function size() {
    return store.size;
  }

  return {
    get,
    set,
    has,
    delete: del,
    clear,
    size,
    keyFor: cacheKeyFor,
  };
}
