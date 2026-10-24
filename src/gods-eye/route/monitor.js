/**
 * Route monitor polling for traffic/incident alerts.
 * Browser ES module — no DOM, no Node builtins.
 */

export function startRouteMonitor({
  sceneId,
  fetch: customFetch,
  intervalMs = 15000,
  signal,
  onAlert,
  base = '/footage',
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  mock = false,
} = {}) {
  const seenIds = new Set();
  let stopped = false;
  let timerId = null;
  const _fetch = customFetch || globalThis.fetch;

  async function poll() {
    if (stopped || signal?.aborted) return;
    try {
      const url = `${base}/route/alerts?sceneId=${encodeURIComponent(sceneId || '')}${mock ? '&mock=1' : ''}`;
      const res = await _fetch(url, { signal });
      if (!res.ok) return;
      const data = await res.json();
      const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
      for (const alert of alerts) {
        if (alert && alert.id && !seenIds.has(alert.id)) {
          seenIds.add(alert.id);
          if (typeof onAlert === 'function') {
            onAlert(alert);
          }
        }
      }
    } catch {
      // ignore network errors, continue polling
    }
  }

  function stop() {
    stopped = true;
    if (timerId !== null) {
      clearIntervalImpl(timerId);
      timerId = null;
    }
  }

  if (signal) {
    if (signal.aborted) {
      stop();
      return { stop };
    }
    signal.addEventListener('abort', () => stop(), { once: true });
  }

  poll();
  timerId = setIntervalImpl(poll, intervalMs);

  return { stop };
}
