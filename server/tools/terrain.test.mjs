import test from 'node:test';
import assert from 'node:assert/strict';

import { plugin, tools, createTerrainTools } from './terrain.js';

test('terrain plugin descriptor', () => {
  assert.equal(plugin.id, 'terrain');
  assert.equal(typeof plugin.name, 'string');
  assert.equal(plugin.category, 'Research');
  assert.ok(Array.isArray(plugin.conversationStarters));
  assert.ok(plugin.conversationStarters.length >= 3);
});

test('terrain_height_at tool spec', () => {
  const tool = tools.find((t) => t.name === 'terrain_height_at');
  assert.ok(tool);
  assert.equal(tool.cacheSeconds, 3600);
  assert.ok(tool.params.lat);
  assert.ok(tool.params.lon);
  assert.ok(tool.params.points);
});

test('terrain_height_at validation: rejects missing parameters and >50 points', async () => {
  const [tool] = createTerrainTools();

  // Missing both points and lat/lon
  const res1 = await tool.handler({});
  assert.equal(res1.ok, false);
  assert.equal(res1.status, 400);
  assert.equal(res1.error.code, 'missing_param');

  // > 50 points
  const manyPoints = Array.from({ length: 55 }, (_, i) => `${-97 + i * 0.01},${30 + i * 0.01}`).join(';');
  const res2 = await tool.handler({ points: manyPoints });
  assert.equal(res2.ok, false);
  assert.equal(res2.status, 400);
  assert.equal(res2.error.code, 'invalid_param');
});

test('terrain_height_at happy path with mock heights', async () => {
  const mockResults = [
    { height: 8848.86, latitude: 27.9881, longitude: 86.925 },
  ];

  const [tool] = createTerrainTools({
    invoke: async (path) => {
      assert.ok(path.includes('/api/terrain/heights?points='));
      return {
        status: 200,
        headers: {},
        json: { results: mockResults },
      };
    },
  });

  const res = await tool.handler({ lat: 27.9881, lon: 86.925 });
  assert.equal(res.ok, true);
  assert.equal(res.provider.status, 'live');
  assert.equal(res.data.count, 1);
  assert.equal(res.data.results[0].height, 8848.86);
  assert.ok(res.provenance.license);
});
