import test from 'node:test';
import assert from 'node:assert/strict';

import { plugin, tools, createSpaceTools } from './space.js';

test('space plugin descriptor', () => {
  assert.equal(plugin.id, 'space');
  assert.equal(typeof plugin.name, 'string');
  assert.equal(plugin.category, 'Research');
  assert.ok(Array.isArray(plugin.conversationStarters));
  assert.ok(plugin.conversationStarters.length >= 3);
});

test('rocket_launches_recent tool spec', () => {
  const tool = tools.find((t) => t.name === 'rocket_launches_recent');
  assert.ok(tool);
  assert.equal(tool.cacheSeconds, 900);
  assert.equal(tool.params.status.default, 'all');
  assert.equal(tool.params.limit.default, 20);
});

test('rocket_launches_recent upstream failure mapping', async () => {
  const [tool] = createSpaceTools({
    invoke: async () => ({
      status: 503,
      headers: {},
      json: { error: 'Launch Library 2 unavailable' },
    }),
  });

  const res = await tool.handler({ status: 'all', limit: 10 });
  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
  assert.equal(res.error.code, 'upstream_unavailable');
  assert.equal(res.provider.status, 'unavailable');
});

test('rocket_launches_recent status filtering with mock launches', async () => {
  const mockLaunches = [
    {
      id: 'launch-1',
      name: 'Falcon 9 Block 5 | Starlink Group 7-1',
      status: { id: 3, name: 'Launch Successful' },
      net: '2026-10-15T12:00:00Z',
      launch_service_provider: { name: 'SpaceX' },
      rocket: { configuration: { name: 'Falcon 9' } },
      pad: {
        name: 'SLC-4E',
        location: { name: 'Vandenberg SFB, CA, USA' },
        latitude: '34.632',
        longitude: '-120.611',
        country_code: 'USA',
      },
    },
    {
      id: 'launch-2',
      name: 'Electron | Test Flight Failed',
      status: { id: 4, name: 'Launch Failure' },
      net: '2026-10-16T14:00:00Z',
      launch_service_provider: { name: 'Rocket Lab' },
    },
    {
      id: 'launch-3',
      name: 'Ariane 6 | Upcoming Commercial',
      status: { id: 1, name: 'Go for Launch' },
      net: '2026-10-25T18:00:00Z',
      launch_service_provider: { name: 'Arianespace' },
    },
  ];

  const [tool] = createSpaceTools({
    invoke: async () => ({
      status: 200,
      headers: {},
      json: { results: mockLaunches },
    }),
  });

  // Filter success only
  const successRes = await tool.handler({ status: 'success', limit: 10 });
  assert.equal(successRes.ok, true);
  assert.equal(successRes.data.count, 1);
  assert.equal(successRes.data.launches[0].id, 'launch-1');
  assert.equal(successRes.data.launches[0].provider, 'SpaceX');
  assert.ok(successRes.provenance.license);

  // Filter failure only
  const failureRes = await tool.handler({ status: 'failure', limit: 10 });
  assert.equal(failureRes.ok, true);
  assert.equal(failureRes.data.count, 1);
  assert.equal(failureRes.data.launches[0].id, 'launch-2');

  // Filter upcoming only
  const upcomingRes = await tool.handler({ status: 'upcoming', limit: 10 });
  assert.equal(upcomingRes.ok, true);
  assert.equal(upcomingRes.data.count, 1);
  assert.equal(upcomingRes.data.launches[0].id, 'launch-3');
});
