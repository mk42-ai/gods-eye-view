import test from 'node:test';
import assert from 'node:assert/strict';

import { plugin, tools, createCctvTools } from './cctv.js';

test('cctv plugin descriptor', () => {
  assert.equal(plugin.id, 'cctv');
  assert.equal(typeof plugin.name, 'string');
  assert.equal(plugin.category, 'Research');
  assert.ok(Array.isArray(plugin.conversationStarters));
  assert.ok(plugin.conversationStarters.length >= 3);
});

test('cameras_in_bbox tool spec', () => {
  const tool = tools.find((t) => t.name === 'cameras_in_bbox');
  assert.ok(tool);
  assert.equal(tool.cacheSeconds, 300);
  assert.ok(tool.params.lamin.required);
  assert.ok(tool.params.lomin.required);
  assert.ok(tool.params.lamax.required);
  assert.ok(tool.params.lomax.required);
  assert.equal(tool.params.limit.default, 50);
});

test('cameras_in_bbox validation: rejects inverted bbox', async () => {
  const [tool] = createCctvTools();
  const res = await tool.handler({
    lamin: 40,
    lamax: 30, // inverted
    lomin: -100,
    lomax: -90,
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.equal(res.error.code, 'invalid_param');
});

test('cameras_in_bbox happy path with mock catalog', async () => {
  const mockCameras = [
    {
      id: 'cam-austin-1',
      label: 'Congress & 6th St',
      city: 'Austin',
      sourceKind: 'austin',
      latitude: 30.267,
      longitude: -97.743,
      feedType: 'image',
    },
    {
      id: 'cam-dallas-1',
      label: 'Main & Elm',
      city: 'Dallas',
      sourceKind: 'txdot',
      latitude: 32.78,
      longitude: -96.80,
      feedType: 'image',
    },
  ];

  const [tool] = createCctvTools({
    getCatalog: async () => mockCameras,
  });

  const res = await tool.handler({
    lamin: 30.2,
    lomin: -97.8,
    lamax: 30.3,
    lomax: -97.7,
    limit: 10,
  });

  assert.equal(res.ok, true);
  assert.equal(res.provider.status, 'live');
  assert.equal(res.data.count, 1);
  assert.equal(res.data.cameras[0].id, 'cam-austin-1');
  assert.equal(res.data.cameras[0].city, 'Austin');
  assert.ok(res.provenance.license);
});
