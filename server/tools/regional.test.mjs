import test from 'node:test';
import assert from 'node:assert/strict';

import { plugin, tools, createRegionalTools } from './regional.js';

test('regional plugin descriptor', () => {
  assert.equal(plugin.id, 'regional');
  assert.equal(typeof plugin.name, 'string');
  assert.equal(plugin.category, 'Research');
  assert.ok(Array.isArray(plugin.conversationStarters));
  assert.ok(plugin.conversationStarters.length >= 3);
});

test('regional_brief tool spec', () => {
  const tool = tools.find((t) => t.name === 'regional_brief');
  assert.ok(tool);
  assert.equal(tool.cacheSeconds, 300);
  assert.ok(tool.params.lat.required);
  assert.ok(tool.params.lon.required);
});

test('regional_brief upstream failure mapping', async () => {
  const [tool] = createRegionalTools({
    invoke: async () => ({
      status: 503,
      headers: {},
      json: { error: 'Regional briefing is temporarily unavailable' },
    }),
  });

  const res = await tool.handler({ lat: 30.27, lon: -97.74 });
  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
  assert.equal(res.error.code, 'upstream_unavailable');
  assert.equal(res.provider.status, 'unavailable');
});

test('regional_brief happy path with mock brief', async () => {
  const mockBrief = {
    status: 'ready',
    retrievedAt: '2026-10-21T00:00:00.000Z',
    coordinates: { latitude: 30.27, longitude: -97.74 },
    place: {
      name: 'Austin',
      region: 'Texas',
      country: 'United States',
    },
    weather: {
      temperatureC: 24.5,
      weatherText: 'Clear',
      windSpeedKmh: 12,
    },
    newsStatus: 'ready',
    articles: [
      {
        title: 'Austin Tech Ecosystem Expands',
        url: 'https://example.com/news/1',
      },
    ],
  };

  const [tool] = createRegionalTools({
    invoke: async (path) => {
      assert.ok(path.includes('/api/regional-brief?latitude=30.27&longitude=-97.74'));
      return {
        status: 200,
        headers: { 'x-regional-brief': 'HIT' },
        json: mockBrief,
      };
    },
  });

  const res = await tool.handler({ lat: 30.27, lon: -97.74 });
  assert.equal(res.ok, true);
  assert.equal(res.provider.status, 'live');
  assert.equal(res.data.status, 'ready');
  assert.equal(res.data.place.name, 'Austin');
  assert.equal(res.data.weather.temperatureC, 24.5);
  assert.ok(res.provenance.license);
});
