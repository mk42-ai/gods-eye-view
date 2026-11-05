import test from 'node:test';
import assert from 'node:assert/strict';

import {
  plugin,
  tools,
  createMilitaryInstallationTools,
} from './military_installations.js';

test('military_installations plugin descriptor', () => {
  assert.equal(plugin.id, 'military_installations');
  assert.equal(typeof plugin.name, 'string');
  assert.equal(plugin.category, 'Research');
  assert.ok(Array.isArray(plugin.conversationStarters));
  assert.ok(plugin.conversationStarters.length >= 3);
});

test('military_installations_in_bbox tool spec', () => {
  const tool = tools.find((t) => t.name === 'military_installations_in_bbox');
  assert.ok(tool);
  assert.equal(tool.cacheSeconds, 600);
  assert.ok(tool.params.south.required);
  assert.ok(tool.params.west.required);
  assert.ok(tool.params.north.required);
  assert.ok(tool.params.east.required);
});

test('military_installations_in_bbox validation: rejects bbox > 10 deg or inverted', async () => {
  const [tool] = createMilitaryInstallationTools();

  // Inverted south/north
  const res1 = await tool.handler({
    south: 40,
    north: 30,
    west: -100,
    east: -90,
  });
  assert.equal(res1.ok, false);
  assert.equal(res1.status, 400);
  assert.equal(res1.error.code, 'invalid_param');

  // > 10 deg span
  const res2 = await tool.handler({
    south: 20,
    north: 35, // 15 deg
    west: -100,
    east: -95,
  });
  assert.equal(res2.ok, false);
  assert.equal(res2.status, 400);
  assert.equal(res2.error.code, 'invalid_param');
});

test('military_installations_in_bbox happy path with mock data', async () => {
  const mockElements = [
    {
      id: 501,
      type: 'way',
      center: { lat: 32.7, lon: -117.2 },
      tags: {
        name: 'Naval Base San Diego',
        military: 'naval_base',
      },
    },
    {
      id: 502,
      type: 'way',
      center: { lat: 32.8, lon: -117.1 },
      tags: {
        name: 'MCAS Miramar',
        military: 'airfield',
      },
    },
  ];

  const [tool] = createMilitaryInstallationTools({
    invoke: async (path) => {
      assert.ok(path.includes('/api/military-installations?'));
      return {
        status: 200,
        headers: {},
        json: {
          elements: mockElements,
          saturated: false,
          retrievedAt: '2026-10-21T00:00:00.000Z',
        },
      };
    },
  });

  const res = await tool.handler({
    south: 32.5,
    north: 33.0,
    west: -117.5,
    east: -117.0,
    limit: 10,
  });

  assert.equal(res.ok, true);
  assert.equal(res.provider.status, 'live');
  assert.equal(res.data.count, 2);
  assert.equal(res.data.installations[0].name, 'Naval Base San Diego');
  assert.equal(res.data.installations[0].militaryType, 'naval_base');
  assert.ok(res.provenance.license);
});
