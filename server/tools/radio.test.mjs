import test from 'node:test';
import assert from 'node:assert/strict';

import { plugin, tools, createRadioTools } from './radio.js';

test('radio plugin descriptor', () => {
  assert.equal(plugin.id, 'radio');
  assert.equal(typeof plugin.name, 'string');
  assert.equal(plugin.category, 'Research');
  assert.ok(Array.isArray(plugin.conversationStarters));
  assert.ok(plugin.conversationStarters.length >= 3);
});

test('radio_stations_near tool spec', () => {
  const tool = tools.find((t) => t.name === 'radio_stations_near');
  assert.ok(tool);
  assert.equal(tool.cacheSeconds, 300);
  assert.ok(tool.params.lat.required);
  assert.ok(tool.params.lon.required);
  assert.equal(tool.params.radius_km.default, 300);
});

test('radio_stations_near upstream failure mapping', async () => {
  const [tool] = createRadioTools({
    invoke: async () => ({
      status: 503,
      headers: {},
      json: { error: 'Radio directory unavailable' },
    }),
  });

  const res = await tool.handler({ lat: 30.27, lon: -97.74 });
  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
  assert.equal(res.error.code, 'upstream_unavailable');
  assert.equal(res.provider.status, 'degraded');
});

test('radio_stations_near happy path with distance and tag filter', async () => {
  const mockStations = [
    {
      id: 'st-austin-1',
      name: 'KUTX Austin',
      url: 'https://stream.kutx.org/live',
      lat: 30.28,
      lon: -97.74,
      country: 'United States',
      tags: ['indie', 'music', 'austin'],
    },
    {
      id: 'st-austin-2',
      name: 'KUT Austin News',
      url: 'https://stream.kut.org/live',
      lat: 30.28,
      lon: -97.74,
      country: 'United States',
      tags: ['news', 'npr', 'talk'],
    },
    {
      id: 'st-dallas-1',
      name: 'KERA Dallas News',
      url: 'https://stream.kera.org/live',
      lat: 32.78,
      lon: -96.80, // ~310 km away
      country: 'United States',
      tags: ['news', 'npr'],
    },
  ];

  const [tool] = createRadioTools({
    invoke: async () => ({
      status: 200,
      headers: {},
      json: {
        stations: mockStations,
        updatedAt: '2026-10-21T00:00:00.000Z',
        stale: false,
      },
    }),
  });

  // Query near Austin within 50 km and tag="news"
  const res = await tool.handler({
    lat: 30.27,
    lon: -97.74,
    radius_km: 50,
    tag: 'news',
    limit: 10,
  });

  assert.equal(res.ok, true);
  assert.equal(res.provider.status, 'live');
  assert.equal(res.data.count, 1);
  assert.equal(res.data.stations[0].id, 'st-austin-2');
  assert.equal(res.data.stations[0].name, 'KUT Austin News');
  assert.ok(res.provenance.license);
});
