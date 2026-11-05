import test from 'node:test';
import assert from 'node:assert/strict';

import {
  plugin,
  tools,
  createGbfsTools,
  findNearestGbfsSystem,
} from './gbfs.js';

test('gbfs plugin descriptor', () => {
  assert.equal(plugin.id, 'gbfs');
  assert.equal(typeof plugin.name, 'string');
  assert.equal(plugin.category, 'Research');
  assert.ok(Array.isArray(plugin.conversationStarters));
  assert.ok(plugin.conversationStarters.length >= 3);
});

test('bike_share_status_near tool spec', () => {
  const tool = tools.find((t) => t.name === 'bike_share_status_near');
  assert.ok(tool);
  assert.equal(tool.cacheSeconds, 60);
  assert.ok(tool.params.lat.required);
  assert.ok(tool.params.lon.required);
  assert.equal(tool.params.radius_km.default, 10);
});

test('findNearestGbfsSystem matches known coordinates', () => {
  // NYC coordinates should find NYC Citibike
  const nyc = findNearestGbfsSystem(40.75, -73.99);
  assert.ok(nyc);
  assert.equal(nyc.system.id, 'nyc-citibike');

  // Austin coordinates should find Austin CapMetro
  const austin = findNearestGbfsSystem(30.27, -97.74);
  assert.ok(austin);
  assert.equal(austin.system.id, 'austin-capmetro');

  // Middle of Atlantic Ocean should return null
  const ocean = findNearestGbfsSystem(0.0, 0.0);
  assert.equal(ocean, null);
});

test('bike_share_status_near unknown system_id rejection', async () => {
  const [tool] = createGbfsTools();
  const res = await tool.handler({
    lat: 40.75,
    lon: -73.99,
    system_id: 'nonexistent-system-xyz',
    radius_km: 10,
    limit: 10,
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(res.error.code, 'invalid_param');
});

test('bike_share_status_near happy path with mock stations', async () => {
  const mockInfo = {
    data: {
      stations: [
        {
          station_id: 'st-1',
          name: 'Central Station',
          lat: 40.75,
          lon: -73.99,
          capacity: 30,
        },
        {
          station_id: 'st-2',
          name: 'Far Station',
          lat: 41.5,
          lon: -74.5,
          capacity: 20,
        },
      ],
    },
  };

  const mockStatus = {
    data: {
      stations: [
        {
          station_id: 'st-1',
          num_bikes_available: 12,
          num_ebikes_available: 4,
          num_docks_available: 18,
          is_renting: true,
          is_returning: true,
          last_reported: 1700000000,
        },
        {
          station_id: 'st-2',
          num_bikes_available: 5,
          num_docks_available: 15,
          is_renting: true,
          is_returning: true,
          last_reported: 1700000000,
        },
      ],
    },
  };

  const [tool] = createGbfsTools({
    fetchUpstream: async (url) => {
      if (url.includes('station_information')) {
        return { status: 200, body: JSON.stringify(mockInfo) };
      }
      return { status: 200, body: JSON.stringify(mockStatus) };
    },
  });

  const res = await tool.handler({
    lat: 40.75,
    lon: -73.99,
    radius_km: 5,
    system_id: 'nyc-citibike',
    limit: 10,
  });

  assert.equal(res.ok, true);
  assert.equal(res.provider.status, 'live');
  assert.equal(res.data.count, 1); // only st-1 is within 5km
  assert.equal(res.data.stations[0].id, 'st-1');
  assert.equal(res.data.stations[0].bikesAvailable, 12);
  assert.equal(res.data.stations[0].ebikesAvailable, 4);
  assert.equal(res.data.stations[0].docksAvailable, 18);
  assert.equal(res.data.stations[0].isRenting, true);
});
