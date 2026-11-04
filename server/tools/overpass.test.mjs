import test from 'node:test';
import assert from 'node:assert/strict';

import {
  plugin,
  tools,
  createOverpassTools,
  buildOverpassQuery,
  normalizeOverpassElement,
} from './overpass.js';

test('overpass plugin descriptor', () => {
  assert.equal(plugin.id, 'overpass');
  assert.equal(typeof plugin.name, 'string');
  assert.equal(plugin.category, 'Research');
  assert.ok(Array.isArray(plugin.conversationStarters));
  assert.ok(plugin.conversationStarters.length >= 3);
});

test('osm_features_near query building and element normalization', () => {
  const query = buildOverpassQuery({
    lat: 30.27,
    lon: -97.74,
    radius_m: 1000,
    feature_class: 'amenity',
    limit: 25,
  });
  assert.match(query, /around:1000,30\.27,-97\.74/);
  assert.match(query, /\["amenity"\]/);
  assert.match(query, /out center tags 25;/);

  const nodeEl = normalizeOverpassElement({
    id: 123,
    type: 'node',
    lat: 30.27,
    lon: -97.74,
    tags: { name: 'Test Hospital', amenity: 'hospital' },
  });
  assert.equal(nodeEl.id, 123);
  assert.equal(nodeEl.name, 'Test Hospital');
  assert.equal(nodeEl.lat, 30.27);

  const wayEl = normalizeOverpassElement({
    id: 456,
    type: 'way',
    center: { lat: 30.28, lon: -97.75 },
    tags: { name: 'Test Clinic', amenity: 'clinic' },
  });
  assert.equal(wayEl.id, 456);
  assert.equal(wayEl.name, 'Test Clinic');
  assert.equal(wayEl.lat, 30.28);
});

test('osm_features_near mirror failure maps to degraded status', async () => {
  const [tool] = createOverpassTools({
    fetchPayload: async () => ({
      status: 503,
      rateLimited: false,
      runtimeError: false,
      provider: {
        status: 'degraded',
        source: 'Overpass API',
        error: 'All mirrors failed',
        count: 0,
      },
    }),
  });

  const res = await tool.handler({
    lat: 30.27,
    lon: -97.74,
    radius_m: 500,
    feature_class: 'amenity',
    limit: 10,
  });

  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
  assert.equal(res.error.code, 'upstream_unavailable');
  assert.equal(res.provider.status, 'degraded');
});

test('osm_features_near happy path with mock payload', async () => {
  const mockElements = [
    {
      id: 101,
      type: 'node',
      lat: 30.271,
      lon: -97.741,
      tags: { name: 'Austin City Hall', amenity: 'townhall' },
    },
    {
      id: 102,
      type: 'node',
      lat: 30.272,
      lon: -97.742,
      tags: { name: 'Central Library', amenity: 'library' },
    },
  ];

  const [tool] = createOverpassTools({
    fetchPayload: async () => ({
      status: 200,
      body: JSON.stringify({ elements: mockElements }),
      endpoint: 'https://overpass-api.de/api/interpreter',
    }),
  });

  const res = await tool.handler({
    lat: 30.27,
    lon: -97.74,
    radius_m: 800,
    feature_class: 'amenity',
    limit: 5,
  });

  assert.equal(res.ok, true);
  assert.equal(res.provider.status, 'live');
  assert.equal(res.data.count, 2);
  assert.equal(res.data.features[0].name, 'Austin City Hall');
  assert.equal(res.data.features[1].name, 'Central Library');
  assert.ok(res.provenance.license);
});
