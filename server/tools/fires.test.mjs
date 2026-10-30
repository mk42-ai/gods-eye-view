import test from 'node:test';
import assert from 'node:assert/strict';

import { plugin, tools, createFiresTools } from './fires.js';

test('fires plugin descriptor', () => {
  assert.equal(plugin.id, 'fires');
  assert.equal(typeof plugin.name, 'string');
  assert.equal(plugin.category, 'Research');
  assert.ok(Array.isArray(plugin.conversationStarters));
  assert.ok(plugin.conversationStarters.length >= 3);
});

test('fire_detection_search tool spec and validation', () => {
  const tool = tools.find((t) => t.name === 'fire_detection_search');
  assert.ok(tool);
  assert.equal(tool.cacheSeconds, 120);
  assert.ok(tool.params.bbox);
  assert.ok(tool.params.latitude);
  assert.ok(tool.params.longitude);
  assert.ok(tool.params.radius_km);
  assert.ok(tool.params.min_confidence);
  assert.ok(tool.params.limit);
});

test('fire_detection_search missing auth: returns 503 not_configured', async () => {
  const [tool] = createFiresTools({
    fetchFiresImpl: async () => ({
      ok: false,
      status: 503,
      error: {
        code: 'not_configured',
        message: 'NASA_FIRMS_MAP_KEY is not configured on the server',
      },
    }),
  });

  const res = await tool.handler(
    { bbox: '-98,30,-97,31', limit: 50 },
    { env: {} },
  );
  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
  assert.equal(res.error.code, 'not_configured');
  assert.equal(res.provider.status, 'unavailable');
});

test('fire_detection_search happy path with confidence filter', async () => {
  const mockDetections = [
    {
      id: 'firms-1',
      latitude: 30.2,
      longitude: -97.7,
      confidence: 'low',
      brightness_k: 310,
      frp_mw: 5.2,
    },
    {
      id: 'firms-2',
      latitude: 30.3,
      longitude: -97.8,
      confidence: 'nominal',
      brightness_k: 330,
      frp_mw: 15.0,
    },
    {
      id: 'firms-3',
      latitude: 30.4,
      longitude: -97.9,
      confidence: 'high',
      brightness_k: 360,
      frp_mw: 45.0,
    },
  ];

  const [tool] = createFiresTools({
    fetchFiresImpl: async () => ({
      ok: true,
      status: 200,
      data: {
        source: 'NASA FIRMS',
        count: mockDetections.length,
        items: mockDetections,
        area: { bbox: '-98,30,-97,31' },
      },
      provenance: {
        provider: 'NASA FIRMS',
        source_url: 'https://firms.modaps.eosdis.nasa.gov/api/area/',
        license: {
          name: 'NASA Earthdata open data',
          url: 'https://firms.modaps.eosdis.nasa.gov/',
          attribution: 'NASA FIRMS',
        },
        completeness: { status: 'sampled' },
      },
    }),
  });

  const res = await tool.handler(
    { bbox: '-98,30,-97,31', min_confidence: 'nominal', limit: 10 },
    { env: { NASA_FIRMS_MAP_KEY: 'test-key' } },
  );

  assert.equal(res.ok, true);
  assert.equal(res.provider.status, 'live');
  assert.equal(res.data.count, 2); // nominal and high
  assert.equal(res.data.detections[0].id, 'firms-2');
  assert.equal(res.data.detections[1].id, 'firms-3');
});
