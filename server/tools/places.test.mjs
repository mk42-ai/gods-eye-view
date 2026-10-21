import test from 'node:test';
import assert from 'node:assert/strict';

import { plugin, tools, createPlacesTools } from './places.js';

test('places plugin descriptor', () => {
  assert.equal(plugin.id, 'places');
  assert.equal(typeof plugin.name, 'string');
  assert.equal(plugin.category, 'Research');
  assert.ok(Array.isArray(plugin.conversationStarters));
  assert.ok(plugin.conversationStarters.length >= 3);
});

test('geocode_place tool spec', () => {
  const tool = tools.find((t) => t.name === 'geocode_place');
  assert.ok(tool);
  assert.equal(tool.cacheSeconds, 300);
  assert.ok(tool.params.q.required);
  assert.equal(tool.params.q.maxLength, 200);
});

test('geocode_place empty query rejection', async () => {
  const [tool] = createPlacesTools();
  const res = await tool.handler({ q: '   ' });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(res.error.code, 'invalid_param');
});

test('geocode_place happy path with candidate results', async () => {
  const mockCandidates = [
    {
      placeId: '12345',
      name: 'Eiffel Tower',
      formattedAddress: '5 Avenue Anatole France, 75007 Paris, France',
      lat: 48.8584,
      lng: 2.2945,
      bounds: [48.8574, 2.2935, 48.8594, 2.2955],
      types: ['attraction', 'tourism'],
    },
  ];

  const [tool] = createPlacesTools({
    searchImpl: async (query) => {
      assert.equal(query, 'Eiffel Tower');
      return {
        status: 'OK',
        results: mockCandidates,
        cached: false,
      };
    },
  });

  const res = await tool.handler({ q: 'Eiffel Tower' });
  assert.equal(res.ok, true);
  assert.equal(res.provider.status, 'live');
  assert.equal(res.data.count, 1);
  assert.equal(res.data.candidates[0].name, 'Eiffel Tower');
  assert.equal(res.data.candidates[0].lat, 48.8584);
  assert.ok(res.provenance.license);
});
