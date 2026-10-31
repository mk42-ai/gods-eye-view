import test from 'node:test';
import assert from 'node:assert/strict';
import { runSceneEvidence } from './pipeline.js';

test('prompt platform policy never invokes X or Snapchat providers', async () => {
  const invoked = [];
  const sources = ['youtube', 'tiktok', 'instagram', 'x', 'snapchat'].map(
    (platform) => ({
      id: platform,
      name: platform,
      platforms: [platform],
      credentials: [],
      budgetMs: 100,
      configured: () => true,
      async run() {
        invoked.push(platform);
        return {};
      },
    }),
  );
  const result = await runSceneEvidence(
    {
      text: 'fixture location',
      place: 'fixture',
      lat: 25.2,
      lon: 55.3,
      windowHours: 1,
      allowedPlatforms: ['youtube', 'tiktok', 'instagram'],
    },
    {
      sources,
      emit() {},
      now: new Date('2026-10-31T00:00:00Z'),
    },
  );
  assert.deepEqual(invoked.sort(), ['instagram', 'tiktok', 'youtube']);
  assert.deepEqual(result.sources.map((s) => s.id).sort(), [
    'instagram',
    'tiktok',
    'youtube',
  ]);
});

test('aborted prompt evidence cannot publish a late result', async () => {
  const controller = new AbortController(),
    events = [];
  controller.abort();
  await assert.rejects(() =>
    runSceneEvidence(
      { text: 'fixture', lat: 25.2, lon: 55.3, windowHours: 1 },
      { sources: [], signal: controller.signal, emit: (e) => events.push(e) },
    ),
  );
  assert.deepEqual(events, []);
});
