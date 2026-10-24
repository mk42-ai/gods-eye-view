import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackRoute, DUBAI_GROUND_ROUTES } from './fallback.js';
import { createRouteCache, cacheKeyFor } from './cache.js';
import { planRoute, routeChipText } from './client.js';
import { startRouteMonitor } from './monitor.js';

test('fallbackRoute returns curated Dubai routes when target within 15 km of Dubai', () => {
  // Umm Suqeim is ~7 km from Dubai center
  const targetNear = { lat: 25.147, lon: 55.199, name: 'Umm Suqeim' };
  const routeNear = fallbackRoute({ target: targetNear });

  assert.equal(routeNear.fallback, true);
  assert.equal(routeNear.confidence, 0.3);
  assert.equal(routeNear.basis, 'great-circle-fallback');
  assert.equal(routeNear.scenePath.length, 5);
  assert.equal(routeNear.groundRoutes.length, 3);
  assert.deepEqual(
    routeNear.groundRoutes.map((r) => r.id),
    ['szr', 'alwasl', 'jumeirah'],
  );
  assert.equal(routeNear.groundRoutes[0].status, 'unknown');
  assert.equal(
    routeNear.groundRoutes[0].source,
    'curated-table (no live status)',
  );
  assert.ok(routeNear.groundRoutes[0].lastChecked);

  // Abu Dhabi (e.g. 24.4539, 54.3773) is >120 km from Dubai
  const targetFar = { lat: 24.4539, lon: 54.3773, name: 'Abu Dhabi' };
  const routeFar = fallbackRoute({ target: targetFar });
  assert.equal(routeFar.groundRoutes.length, 0);
});

test('routeChipText formats fallback and confidence correctly', () => {
  assert.equal(routeChipText(null), 'ROUTE: FALLBACK');
  assert.equal(
    routeChipText({ fallback: true, confidence: 0.9 }),
    'ROUTE: FALLBACK',
  );
  assert.equal(
    routeChipText({ fallback: false, confidence: 0.8 }),
    'ROUTE: 80%',
  );
  assert.equal(
    routeChipText({ fallback: false, confidence: 0.954 }),
    'ROUTE: 95%',
  );
  assert.equal(
    routeChipText({ fallback: false, confidence: 1 }),
    'ROUTE: 100%',
  );
});

test('createRouteCache stores and expires entries', () => {
  let currentTime = 1000;
  const now = () => currentTime;
  const cache = createRouteCache({ now, ttlMs: 5000 });

  const origin = { lat: 25.2, lon: 55.27 };
  const target = { lat: 25.147, lon: 55.199 };
  const aoiId = 'dubai-metro';

  const routeData = { scenePath: [], fallback: false };
  cache.set({ origin, target, aoiId }, routeData);

  assert.equal(cache.has({ origin, target, aoiId }), true);
  assert.deepEqual(cache.get({ origin, target, aoiId }), routeData);

  // Advance time past TTL
  currentTime = 7000;
  assert.equal(cache.has({ origin, target, aoiId }), false);
  assert.equal(cache.get({ origin, target, aoiId }), null);
});

test('planRoute with 200 plan returns the plan', async () => {
  const origin = { lat: 25.2, lon: 55.27 };
  const target = { lat: 25.147, lon: 55.199 };

  const fakePlan = {
    scenePath: [
      { stage: 'S0' },
      { stage: 'S1' },
      { stage: 'S2' },
      { stage: 'S3' },
      { stage: 'S4' },
    ],
    approachBearing: 245.5,
    groundRoutes: [],
    alerts: [],
    confidence: 0.85,
    basis: 'route-monitoring-agent',
    fallback: false,
  };

  const fakeFetch = async (url, opts) => {
    assert.ok(url.endsWith('/route/plan'));
    assert.equal(opts.method, 'POST');
    return {
      ok: true,
      status: 200,
      json: async () => fakePlan,
    };
  };

  const plan = await planRoute({
    origin,
    target,
    fetch: fakeFetch,
  });

  assert.equal(plan.fallback, false);
  assert.equal(plan.confidence, 0.85);
  assert.equal(plan.approachBearing, 245.5);
  assert.equal(routeChipText(plan), 'ROUTE: 85%');
});

test('planRoute with 500 falls back to great-circle and chip is ROUTE: FALLBACK', async () => {
  const origin = { lat: 25.2, lon: 55.27 };
  const target = { lat: 25.147, lon: 55.199 };

  const fakeFetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: 'internal error' }),
  });

  const plan = await planRoute({
    origin,
    target,
    fetch: fakeFetch,
  });

  assert.equal(plan.fallback, true);
  assert.ok(
    plan.basis.includes('500'),
    `basis should mention 500: ${plan.basis}`,
  );
  assert.equal(routeChipText(plan), 'ROUTE: FALLBACK');
});

test('planRoute with timeout falls back to great-circle', async () => {
  const origin = { lat: 25.2, lon: 55.27 };
  const target = { lat: 25.147, lon: 55.199 };

  // Never-resolving fetch
  const fakeFetch = (_url, { signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener('abort', () =>
        reject(new Error('aborted by timeout')),
      );
    });

  const plan = await planRoute({
    origin,
    target,
    fetch: fakeFetch,
    timeoutMs: 30, // fast timeout for test
  });

  assert.equal(plan.fallback, true);
  assert.ok(plan.basis.includes('timeout') || plan.basis.includes('aborted'));
  assert.equal(routeChipText(plan), 'ROUTE: FALLBACK');
});

test('planRoute cache hit avoids second fetch', async () => {
  const origin = { lat: 25.2, lon: 55.27 };
  const target = { lat: 25.147, lon: 55.199 };
  const cache = createRouteCache();
  let fetchCount = 0;

  const fakePlan = {
    scenePath: [
      { stage: 'S0' },
      { stage: 'S1' },
      { stage: 'S2' },
      { stage: 'S3' },
      { stage: 'S4' },
    ],
    approachBearing: 245,
    fallback: false,
    confidence: 0.9,
  };

  const fakeFetch = async () => {
    fetchCount++;
    return {
      ok: true,
      status: 200,
      json: async () => fakePlan,
    };
  };

  const plan1 = await planRoute({ origin, target, cache, fetch: fakeFetch });
  assert.equal(fetchCount, 1);
  assert.equal(plan1.confidence, 0.9);

  const plan2 = await planRoute({ origin, target, cache, fetch: fakeFetch });
  assert.equal(
    fetchCount,
    1,
    'fetch should not be called second time due to cache hit',
  );
  assert.equal(plan2.confidence, 0.9);
});

test('startRouteMonitor dedupes alerts across polls', async () => {
  const received = [];
  let pollNum = 0;
  let triggerTick = null;

  const fakeFetch = async (url) => {
    pollNum++;
    if (pollNum === 1) {
      return {
        ok: true,
        json: async () => ({
          sceneId: 's_test1',
          alerts: [
            { id: 'a1', text: 'alert 1' },
            { id: 'a2', text: 'alert 2' },
          ],
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        sceneId: 's_test1',
        alerts: [
          { id: 'a1', text: 'alert 1' }, // duplicate
          { id: 'a3', text: 'alert 3' }, // new
        ],
      }),
    };
  };

  const monitor = startRouteMonitor({
    sceneId: 's_test1',
    fetch: fakeFetch,
    onAlert: (alert) => received.push(alert),
    setIntervalImpl: (fn) => {
      triggerTick = fn;
      return 999;
    },
    clearIntervalImpl: () => {},
  });

  // First poll ran immediately
  // Let microtasks flush
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(received.length, 2);
  assert.deepEqual(
    received.map((a) => a.id),
    ['a1', 'a2'],
  );

  // Trigger second poll
  await triggerTick();
  assert.equal(received.length, 3);
  assert.deepEqual(
    received.map((a) => a.id),
    ['a1', 'a2', 'a3'],
  );

  monitor.stop();
});
