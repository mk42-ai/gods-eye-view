import test from 'node:test';
import assert from 'node:assert/strict';
import { createIngestion } from './ingestion.js';

test('Overpass outage stops after three attempts per viewport and resets for a new viewport', async () => {
  let requests = 0;
  const state = { _loadGeneration: 0, _retryAttempts: 0, _retryDelayMs: 1500, _enabled: true, _tileCache: new Map() };
  const parts = {
    viewport: { clampBounds: (b) => b, getBoundsCenter: (b) => ({ lat: b.south, lon: b.west }), onCameraChanged() {} },
    flow: { ensureFlowStatus: async () => {}, applyFlowThenRender: async () => true },
  };
  const ingestion = createIngestion({ state, services: {}, parts, source: {
    fetchFlowForBounds: async () => {},
    requestRoads: async () => { requests++; return new Response(JSON.stringify({ error: 'injected_unavailable', provider: { status: 'degraded', source: 'Overpass', error: 'Injected test outage' } }), { status: 503, headers: { 'Content-Type': 'application/json' } }); },
  } });
  const bounds = { south: 25.1, west: 55.1, north: 25.2, east: 55.2 };
  try {
    for (let i = 0; i < 6; i++) await ingestion.loadRoadsForBounds(bounds, 1000);
    assert.equal(requests, 3);
    assert.equal(state._fetching, false);
    assert.equal(state._retryAttempts, 3);
    assert.match(state._roadError, /Automatic retries stopped after 3 attempts/);
    assert.equal(state._retryTimer, null);
    await ingestion.loadRoadsForBounds({ ...bounds, west: 55.3, east: 55.4 }, 1000);
    assert.equal(requests, 4);
    assert.equal(state._retryAttempts, 1);
  } finally { clearTimeout(state._retryTimer); ingestion.cancelActiveFetch(); }
});
