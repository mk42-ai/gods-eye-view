/**
 * Route planning client with caching and fallback.
 * Browser ES module — no DOM, no Node builtins.
 */

import { fallbackRoute } from './fallback.js';

export function routeChipText(route) {
  if (!route || route.fallback) {
    return 'ROUTE: FALLBACK';
  }
  const conf = typeof route.confidence === 'number' ? route.confidence : 1;
  return `ROUTE: ${Math.round(conf * 100)}%`;
}

export async function planRoute({
  origin,
  target,
  aoiId,
  tRef,
  preset,
  pins = [],
  fetch: customFetch,
  signal,
  timeoutMs = 4000,
  cache,
  base = '/footage',
  now = () => Date.now(),
} = {}) {
  const cacheKey = cache?.keyFor
    ? cache.keyFor({ origin, target, aoiId })
    : undefined;
  if (cache) {
    const cached = cache.get(cacheKey ?? { origin, target, aoiId });
    if (cached) return cached;
  }

  const ac = new AbortController();
  let timedOut = false;
  let timer = null;

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      ac.abort(new Error('timeout'));
    }, timeoutMs);
  }

  const onCallerAbort = () => {
    ac.abort(signal?.reason || new Error('aborted'));
  };

  if (signal) {
    if (signal.aborted) {
      ac.abort(signal.reason);
    } else {
      signal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }

  let plan = null;
  let failureReason = null;
  const _fetch = customFetch || globalThis.fetch;

  try {
    const res = await _fetch(`${base}/route/plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ origin, target, aoiId, tRef, preset, pins }),
      signal: ac.signal,
    });

    if (!res.ok) {
      failureReason = `great-circle-fallback: HTTP ${res.status}`;
    } else {
      const data = await res.json();
      if (
        data &&
        Array.isArray(data.scenePath) &&
        data.scenePath.length >= 5 &&
        typeof data.approachBearing === 'number'
      ) {
        plan = {
          ...data,
          fallback: Boolean(data.fallback),
        };
      } else {
        failureReason = 'great-circle-fallback: invalid shape';
      }
    }
  } catch (err) {
    if (timedOut) {
      failureReason = 'great-circle-fallback: timeout';
    } else if (signal?.aborted) {
      failureReason = 'great-circle-fallback: aborted';
    } else {
      failureReason = `great-circle-fallback: ${err?.message || 'network error'}`;
    }
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener?.('abort', onCallerAbort);
  }

  if (!plan) {
    plan = fallbackRoute({
      origin,
      target,
      preset,
      aoiId,
      basis: failureReason || 'great-circle-fallback',
      now,
    });
  }

  if (cache) {
    cache.set(cacheKey ?? { origin, target, aoiId }, plan);
  }

  return plan;
}
