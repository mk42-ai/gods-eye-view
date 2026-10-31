import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePublicationTime,
  parseSasExpiry,
  isAllowedMediaUrl,
  redactMediaUrl,
  sanitizeCaption,
  extractPluginJson,
  normalizePluginResponse,
  dedupeClips,
  rankClips,
  buildQuery,
  retrieveSnapchatFootage,
  FootageClipSchema,
  PROVIDER_CAPABILITIES,
} from './snapchat.js';
import { validateFootageRequest } from './routes.js';
import {
  buildLadder,
  placeForPoint,
  locationIdFor,
} from '../../src/sceneFootage/places.js';
import { clipTimeLines } from '../../src/sceneFootage/controller.js';

const NOW = new Date('2026-10-31T05:00:00Z');

function mockVideo(
  id,
  {
    place = 'Dubai Marina',
    desc = '#dubaimarina incident footage',
    uploadDate = 'September 9, 2026 at 5:13:12 PM',
    duration = 15000,
    host = 'airevdev.blob.core.windows.net',
    expiry = '2026-11-08T15:21:45Z',
  } = {},
) {
  return {
    storyId: id,
    description: desc,
    durationMs: duration,
    hashtags: ['#' + place.toLowerCase().replace(/\s+/g, '')],
    storageUrl: `https://${host}/agents/${id}.mp4?se=${encodeURIComponent(expiry)}&sig=mock-sig-123`,
    uploadDateMs: uploadDate,
    commentCount: 2,
    shareCount: 1,
    viewCount: 100,
  };
}

test('dedup and ranking: drops exact, URL, hash, blob and near-duplicates while ranking by proximity then recency', () => {
  const v1 = mockVideo('STORY_MARINA_01', {
    desc: 'Dubai Marina luxury yachts walking tour',
    uploadDate: 'September 10, 2026 at 10:00:00 AM',
  });
  const v2_dupStory = mockVideo('STORY_MARINA_01', {
    desc: 'Dubai Marina different text',
  });
  const v3_nearDup = mockVideo('STORY_MARINA_03', {
    desc: 'Dubai Marina luxury yachts walking tour!!!',
    uploadDate: 'September 8, 2026 at 10:00:00 AM',
  });
  const v4_older = mockVideo('STORY_MARINA_04', {
    desc: 'Dubai Marina marina promenade evening walk',
    uploadDate: 'September 1, 2026 at 08:00:00 PM',
  });

  const norm1 = normalizePluginResponse(
    {
      limit: 5,
      results: [
        {
          place: 'Dubai Marina',
          matchType: 'clip-text-match',
          videos: [v1, v2_dupStory, v3_nearDup, v4_older],
        },
      ],
    },
    {
      step: { level: 'landmark', names: ['Dubai Marina'] },
      retrievalTime: NOW.toISOString(),
      now: NOW,
    },
  );

  assert.equal(norm1.clips.length, 4);

  const { kept, dropped } = dedupeClips(norm1.clips);
  // v2 is exact storyId duplicate; v3 is near-identical duplicate (normalized caption >= 12 chars + same 1s duration)
  assert.equal(kept.length, 2);
  assert.equal(dropped.length, 2);

  // Proximity & recency ranking
  const landmarkClip = {
    ...kept[0],
    coverageLevel: 'landmark',
    publicationTime: '2026-09-01T10:00:00Z',
  };
  const districtClip = {
    ...kept[1],
    coverageLevel: 'district',
    publicationTime: '2026-09-10T10:00:00Z',
  };
  const ranked = rankClips([districtClip, landmarkClip], {
    targetLevel: 'landmark',
  });
  assert.equal(ranked[0].coverageLevel, 'landmark');
  assert.equal(ranked[1].coverageLevel, 'district');
});

test('UTC / capture-vs-upload: publication time parsed as UTC ISO; capture time strictly null and never substituted', () => {
  const parsed = parsePublicationTime('September 9, 2026 at 5:13:12 PM', NOW);
  assert.equal(parsed, '2026-09-09T17:13:12.000Z');

  const norm = normalizePluginResponse(
    {
      limit: 1,
      results: [{ place: 'Dubai Marina', videos: [mockVideo('STORY_001')] }],
    },
    {
      step: { level: 'landmark', names: ['Dubai Marina'] },
      retrievalTime: NOW.toISOString(),
      now: NOW,
      timeWindow: { strictCaptureTime: true, windowHours: 24 },
    },
  );

  assert.equal(
    norm.clips.length,
    0,
    'unknown capture time cannot satisfy strict recording bounds',
  );
  assert.equal(norm.rejected[0].reason, 'capture-time-unknown');
  const unbounded = normalizePluginResponse(
    {
      limit: 1,
      results: [{ place: 'Dubai Marina', videos: [mockVideo('STORY_001')] }],
    },
    {
      step: { level: 'landmark', names: ['Dubai Marina'] },
      retrievalTime: NOW.toISOString(),
      now: NOW,
    },
  );
  const clip = unbounded.clips[0];

  // Capture time MUST be null
  assert.strictEqual(clip.captureTime, null);
  assert.equal(clip.publicationTime, '2026-09-09T17:13:12.000Z');
  assert.equal(clip.publicationTimezoneAssumption, 'UTC');
  assert.equal(clip.temporalMatch, 'publication-time-only');
  assert.equal(
    clip.uncertainty.captureTime,
    'unknown (provider returns upload date only)',
  );

  // clipTimeLines honest representation
  const lines = clipTimeLines(clip, NOW.getTime());
  assert.match(lines.pub, /published/);
  assert.equal(lines.cap, 'capture time unknown');
  assert.equal(lines.live, 'not live');
});

test('strict bounds: radius limits and strictBounds prevent silent widening to wider levels', () => {
  const burjPoint = {
    lat: 25.1970336,
    lon: 55.2741329,
    placeName: 'Burj Khalifa',
  };

  // 1. Without strict bounds: landmark -> neighborhood -> city
  const normalLadder = buildLadder(burjPoint, { maxCoverageLevel: 'city' });
  assert.ok(normalLadder.length >= 2);
  assert.equal(normalLadder[0].level, 'landmark');
  assert.equal(normalLadder[1].level, 'neighborhood');
  assert.equal(normalLadder[0].capped, false);
  assert.equal(normalLadder[1].capped, false);

  // 2. With strictBounds: true -> only requested landmark step is uncapped; wider steps capped with strict-bounds
  const strictLadder = buildLadder(burjPoint, {
    maxCoverageLevel: 'city',
    strictBounds: true,
  });
  assert.equal(strictLadder[0].capped, false);
  assert.equal(strictLadder[1].capped, true);
  assert.equal(strictLadder[1].cappedReason, 'strict-bounds');

  // 3. With tight radiusKm: 0.5 km -> steps beyond 0.5 km (downtown dubai radius 1.6km) are capped
  const radiusLadder = buildLadder(burjPoint, {
    maxCoverageLevel: 'city',
    radiusKm: 0.5,
  });
  assert.equal(radiusLadder[0].capped, false);
  assert.equal(radiusLadder[1].capped, true);
  assert.equal(radiusLadder[1].cappedReason, 'beyond-requested-radius');
});

test('retrieveSnapchatFootage under strictBounds: returns empty if narrow step has no clips and never widens', async () => {
  const scene = {
    locationId: 'snap-dubai-marina',
    lat: 25.07864,
    lon: 55.13525,
    placeName: 'Dubai Marina',
    strictBounds: true,
  };

  const queries = [];
  const fakeClient = {
    sessions: {
      create: async () => ({ id: 'sess-test-01' }),
    },
    query: {
      sync: async (sessId, payload) => {
        queries.push(payload.query);
        // Return empty result for Dubai Marina
        return {
          data: {
            messageId: 'msg-01',
            status: 'completed',
            answer:
              '```json\n{"limit":3,"note":"No spotlight videos found.","results":[{"place":"Dubai Marina","uploaded":0,"videos":[]}]}\n```',
          },
        };
      },
    },
  };

  const res = await retrieveSnapchatFootage(scene, {
    client: fakeClient,
    cfg: {
      pluginId: 'plugin-1792945050',
      endpointId: 'predefined-openai-gpt4.1-mini',
      maxCoverageLevel: 'city',
      resultLimit: 3,
      minClips: 1,
      queryTimeoutMs: 10000,
      maxAttempts: 1,
      backoffBaseMs: 100,
    },
    now: () => NOW,
  });

  // Exactly 1 upstream query was dispatched — NO widening occurred
  assert.equal(queries.length, 1);
  assert.equal(res.status, 'empty');
  assert.equal(res.emptyReason, 'no-clips-within-strict-bounds');
  assert.equal(res.clips.length, 0);
  assert.equal(res.accounting.queriesCount, 1);
  assert.equal(res.accounting.matchingCount, 0);
  assert.equal(res.bounds.strictBounds, true);
});

test('pagination capability unavailable and query accounting are explicitly surfaced', async () => {
  assert.strictEqual(PROVIDER_CAPABILITIES.paginationSupported, false);
  assert.strictEqual(PROVIDER_CAPABILITIES.batchSupported, false);
  assert.strictEqual(PROVIDER_CAPABILITIES.geotagSupported, false);
  assert.strictEqual(PROVIDER_CAPABILITIES.captureTimeSupported, false);
  assert.strictEqual(PROVIDER_CAPABILITIES.spotlightTextSearchOnly, true);
  assert.strictEqual(PROVIDER_CAPABILITIES.undocumentedEndpointsUsed, false);

  const scene = {
    locationId: 'snap-dubai-marina',
    lat: 25.07864,
    lon: 55.13525,
    placeName: 'Dubai Marina',
  };

  const fakeClient = {
    sessions: {
      create: async () => ({ id: 'sess-test-02' }),
    },
    query: {
      sync: async () => ({
        data: {
          messageId: 'msg-02',
          status: 'completed',
          answer: JSON.stringify({
            limit: 3,
            note: 'Text matches only',
            results: [
              {
                place: 'Dubai Marina',
                uploaded: 1,
                videos: [mockVideo('STORY_ACCT_1', { place: 'Dubai Marina' })],
              },
            ],
          }),
        },
      }),
    },
  };

  const res = await retrieveSnapchatFootage(scene, {
    client: fakeClient,
    cfg: {
      pluginId: 'plugin-1792945050',
      endpointId: 'predefined-openai-gpt4.1-mini',
      maxCoverageLevel: 'district',
      resultLimit: 3,
      minClips: 1,
      queryTimeoutMs: 10000,
      maxAttempts: 1,
      backoffBaseMs: 100,
    },
    now: () => NOW,
  });

  assert.equal(res.status, 'ok');
  assert.equal(res.accounting.returnedCount, 1);
  assert.equal(res.accounting.uniqueCount, 1);
  assert.equal(res.accounting.matchingCount, 1);
  assert.equal(res.accounting.queriesCount, 1);
  assert.equal(res.accounting.pagesCount, 1);
  assert.equal(res.capabilities.paginationSupported, false);
  assert.equal(res.capabilities.batchSupported, false);
});

test('per-item failures from plugin are recorded in rejected and handled terminally if all fail', async () => {
  const norm = normalizePluginResponse(
    {
      limit: 3,
      results: [
        {
          place: 'Dubai Marina',
          videos: [
            {
              storyId: 'FAIL_STORY_01',
              error: 'Request failed with status code 500',
            },
            mockVideo('STORY_OK_01'),
          ],
        },
      ],
    },
    {
      step: { level: 'landmark', names: ['Dubai Marina'] },
      retrievalTime: NOW.toISOString(),
      now: NOW,
    },
  );

  assert.equal(norm.clips.length, 1);
  assert.equal(norm.rejected.length, 1);
  assert.equal(norm.rejected[0].reason, 'plugin-item-error');
  assert.equal(norm.rejected[0].storyId, 'FAIL_STORY_01');

  // Terminal failure when every match fails inside plugin
  const scene = {
    locationId: 'snap-dubai-marina',
    lat: 25.07864,
    lon: 55.13525,
    placeName: 'Dubai Marina',
    strictBounds: true,
  };
  const fakeClient = {
    sessions: { create: async () => ({ id: 'sess-03' }) },
    query: {
      sync: async () => ({
        data: {
          messageId: 'msg-03',
          status: 'completed',
          answer: JSON.stringify({
            limit: 1,
            results: [
              {
                place: 'Dubai Marina',
                videos: [
                  {
                    storyId: 'FAIL_ALL',
                    error: 'Request failed with status code 500',
                  },
                ],
              },
            ],
          }),
        },
      }),
    },
  };

  const res = await retrieveSnapchatFootage(scene, {
    client: fakeClient,
    cfg: {
      pluginId: 'plugin-1792945050',
      endpointId: 'predefined-openai-gpt4.1-mini',
      maxCoverageLevel: 'district',
      resultLimit: 1,
      minClips: 1,
      maxAttempts: 1,
      backoffBaseMs: 50,
    },
    now: () => NOW,
  });

  assert.equal(res.status, 'plugin_error');
  assert.equal(res.emptyReason, 'plugin-media-download-failed');
});

test('validateFootageRequest accepts radius, strictBounds, timeWindow and preserves validation', () => {
  const valid = validateFootageRequest('snap-dubai-marina', {
    lat: 25.078,
    lon: 55.135,
    placeName: 'Dubai Marina',
    radius: 3.5,
    strictBounds: true,
    timeWindow: {
      windowHours: 48,
      windowStart: '2026-10-29T00:00:00Z',
      windowEnd: '2026-10-31T00:00:00Z',
      strictCaptureTime: true,
    },
  });

  assert.ok(valid.value);
  assert.equal(valid.value.radius, 3.5);
  assert.equal(valid.value.strictBounds, true);
  assert.equal(valid.value.timeWindow.windowHours, 48);
  assert.equal(valid.value.timeWindow.strictCaptureTime, true);
});

test('strict recording or geographic boundaries reject unknown source metadata but retain real returned/unique counts', async () => {
  for (const bounds of [
    { timeWindow: { windowHours: 24, strictCaptureTime: true } },
    { radius: 1, strictBounds: true },
  ]) {
    const out = await retrieveSnapchatFootage(
      {
        locationId: 'snap-burj-khalifa',
        placeName: 'Burj Khalifa',
        lat: 25.1970336,
        lon: 55.2741329,
        ...bounds,
      },
      {
        client: {
          sessions: { create: async () => ({ id: 'fixture-session' }) },
          query: {
            sync: async () => ({
              data: {
                status: 'completed',
                answer: JSON.stringify({
                  results: [
                    {
                      place: 'Burj Khalifa',
                      videos: [
                        mockVideo('BOUNDARY_STORY_01', {
                          place: 'Burj Khalifa',
                          desc: 'Burj Khalifa view',
                        }),
                      ],
                    },
                  ],
                }),
              },
            }),
          },
        },
        cfg: {
          pluginId: 'plugin-1792945050',
          endpointId: 'fixture',
          maxCoverageLevel: 'landmark',
          resultLimit: 3,
          minClips: 1,
          maxAttempts: 1,
        },
        now: () => NOW,
      },
    );
    assert.equal(out.status, 'empty');
    assert.equal(out.clips.length, 0);
    assert.equal(out.accounting.returnedCount, 1);
    assert.equal(out.accounting.uniqueCount, 1);
    assert.equal(out.accounting.matchingCount, 0);
    assert.match(
      out.rejected[0].reason,
      /capture-time-unknown|verified-location-unknown/,
    );
  }
});

test('malformed hard bounds fail closed instead of silently widening', () => {
  const base = { lat: 25.197, lon: 55.274, placeName: 'Burj Khalifa' };
  for (const radius of [-1, 0, '3', Infinity, 1000])
    assert.equal(
      validateFootageRequest('fixture', { ...base, radius }).error,
      'invalid_radius',
    );
  for (const timeWindow of [
    {},
    [],
    { windowHours: 0 },
    { windowHours: '24' },
    { windowStart: 'bad', windowEnd: '2020-01-01T00:00:00Z' },
    { windowStart: '2020-01-01T00:00:00Z' },
  ])
    assert.equal(
      validateFootageRequest('fixture', { ...base, timeWindow }).error,
      'invalid_recording_window',
    );
});

test('processing message is polled once by identity without another query submission', async () => {
  const calls = [];
  const result = await retrieveSnapchatFootage(
    {
      locationId: 'snap-burj-khalifa',
      placeName: 'Burj Khalifa',
      lat: 25.197,
      lon: 55.274,
    },
    {
      client: {
        sessions: {
          create: async () => ({ id: 'fixture-session' }),
          message: async (sid, mid) => {
            calls.push(['GET', sid, mid]);
            return {
              id: mid,
              sessionId: sid,
              status: 'completed',
              answer: JSON.stringify({
                results: [{ place: 'Burj Khalifa', videos: [] }],
              }),
            };
          },
        },
        query: {
          sync: async () => {
            calls.push(['POST']);
            return {
              data: {
                sessionId: 'fixture-session',
                messageId: 'fixture-message',
                status: 'processing',
              },
            };
          },
        },
      },
      cfg: {
        pluginId: 'plugin-1792945050',
        endpointId: 'fixture',
        maxCoverageLevel: 'landmark',
        resultLimit: 3,
        minClips: 1,
        maxAttempts: 1,
      },
      now: () => NOW,
      sleep: async () => {},
    },
  );
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['POST', 'GET'],
  );
  assert.equal(result.accounting.queriesCount, 1);
  assert.equal(result.accounting.pollsCount, 1);
});

test('generic model prose is a source error, never empty or successful Snapchat retrieval', async () => {
  await assert.rejects(
    () =>
      retrieveSnapchatFootage(
        {
          locationId: 'snap-burj-khalifa',
          placeName: 'Burj Khalifa',
          lat: 25.197,
          lon: 55.274,
        },
        {
          client: {
            sessions: { create: async () => ({ id: 'fixture-session' }) },
            query: {
              sync: async () => ({
                data: {
                  status: 'completed',
                  answer: 'Try looking at Snap Map for nearby stories.',
                },
              }),
            },
          },
          cfg: {
            pluginId: 'plugin-1792945050',
            endpointId: 'fixture',
            maxCoverageLevel: 'landmark',
            resultLimit: 3,
            minClips: 1,
            maxAttempts: 1,
          },
          now: () => NOW,
        },
      ),
    /plugin_source_records_missing_or_invalid/,
  );
});
