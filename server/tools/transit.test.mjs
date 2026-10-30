import test from 'node:test';
import assert from 'node:assert/strict';

import { plugin, tools, createTransitTools } from './transit.js';

test('transit plugin descriptor', () => {
  assert.equal(plugin.id, 'transit');
  assert.equal(typeof plugin.name, 'string');
  assert.equal(plugin.category, 'Research');
  assert.ok(Array.isArray(plugin.conversationStarters));
  assert.ok(plugin.conversationStarters.length >= 3);
});

test('transit_vehicles_in_bbox tool spec', () => {
  const tool = tools.find((t) => t.name === 'transit_vehicles_in_bbox');
  assert.ok(tool);
  assert.equal(tool.cacheSeconds, 15);
  assert.ok(tool.params.feed);
  assert.ok(tool.params.lamin);
  assert.ok(tool.params.lat);
  assert.equal(tool.params.limit.default, 100);
});

test('transit_vehicles_in_bbox upstream failure mapping', async () => {
  const [tool] = createTransitTools({
    invoke: async () => ({
      status: 503,
      headers: {},
      json: { error: 'Transit feed unavailable' },
    }),
  });

  const res = await tool.handler({ feed: 'capmetro-austin' });
  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
  assert.equal(res.error.code, 'upstream_unavailable');
  assert.equal(res.provider.status, 'degraded');
});

test('transit_vehicles_in_bbox happy path with bbox filter', async () => {
  const mockVehicles = [
    {
      id: 'veh-1',
      latitude: 30.27,
      longitude: -97.74,
      route: '801',
      label: 'Rapid 801',
      bearing: 180,
      speed: 12.5,
      timestamp: 1700000000,
    },
    {
      id: 'veh-2',
      latitude: 31.5,
      longitude: -98.0,
      route: '100',
      label: 'Airport Express',
      timestamp: 1700000000,
    },
  ];

  const [tool] = createTransitTools({
    invoke: async (path) => {
      assert.ok(path.includes('/api/transit/vehicles/capmetro-austin'));
      return {
        status: 200,
        headers: {},
        json: {
          feedId: 'capmetro-austin',
          name: 'CapMetro Austin',
          fetchedAt: '2026-10-21T00:00:00.000Z',
          vehicles: mockVehicles,
        },
      };
    },
  });

  const res = await tool.handler({
    feed: 'capmetro-austin',
    lamin: 30.2,
    lomin: -97.8,
    lamax: 30.3,
    lomax: -97.7,
    limit: 10,
  });

  assert.equal(res.ok, true);
  assert.equal(res.provider.status, 'live');
  assert.equal(res.data.count, 1); // only veh-1 in bbox
  assert.equal(res.data.vehicles[0].id, 'veh-1');
  assert.equal(res.data.vehicles[0].route, '801');
  assert.ok(res.provenance.license);
});
