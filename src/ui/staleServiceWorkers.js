/**
 * The workstation ships no service worker (2026-10-24). A registration left
 * behind by an older build — or a Cache Storage bucket — would keep serving a
 * pinned index.html/bundle pair after a redeploy, which is exactly the "old
 * build still served" failure. Unregister everything and clear the caches;
 * never register one. Returns a promise for tests; never throws.
 */
export function purgeStaleServiceWorkers({
  navigator: nav = globalThis.navigator,
  caches: cacheStorage = globalThis.caches,
} = {}) {
  const work = [];
  try {
    if (nav?.serviceWorker?.getRegistrations) {
      work.push(
        nav.serviceWorker
          .getRegistrations()
          .then((list) => Promise.all(list.map((r) => r.unregister())))
          .then((done) => done.length),
      );
    }
  } catch {
    /* unsupported */
  }
  try {
    if (cacheStorage?.keys) {
      work.push(
        cacheStorage
          .keys()
          .then((keys) => Promise.all(keys.map((k) => cacheStorage.delete(k))))
          .then((done) => done.length),
      );
    }
  } catch {
    /* unsupported */
  }
  return Promise.all(work)
    .then(([workers = 0, caches = 0]) => ({ workers, caches }))
    .catch(() => ({ workers: 0, caches: 0 }));
}
