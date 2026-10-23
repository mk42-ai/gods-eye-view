/**
 * Unit & Integration Test Suite for Gods-Eye Footage subsystem.
 * Run with: node --test src/gods-eye/footage/*.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SOURCE_PLATFORMS,
  platformFor,
  platformIcon,
  statusFromSourceDone,
  extractHashtags,
  createFootageItem,
  normaliseItem,
  normaliseTikTok,
  normaliseInstagram,
  normaliseYouTube,
  normaliseX,
  normaliseReddit,
  normaliseWeb,
  resolveLocation,
  LANDMARKS,
  haversineKm,
  distanceScore,
  timeDeltaSec,
  timeScore,
  geoConfScore,
  recencyOf,
  rankScore,
  rankItems,
  clusterItems,
  formatDistance,
  formatDelta,
  createRanker,
  createFootageCache,
  runFootagePipeline,
} from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../../');

describe('Normalisers & Platform Helpers', () => {
  it('normaliser mapping for each platform', () => {
    assert.equal(platformFor('tiktok'), 'tiktok');
    assert.equal(platformFor('instagram'), 'instagram');
    assert.equal(platformFor('instagram+web'), 'instagram');
    assert.equal(platformFor('instagram-plugin'), 'instagram');
    assert.equal(platformFor('youtube'), 'youtube');
    assert.equal(platformFor('x'), 'x');
    assert.equal(platformFor('twitter'), 'x');
    assert.equal(platformFor('x-plugin'), 'x');
    assert.equal(platformFor('reddit'), 'reddit');
    assert.equal(platformFor('facebook'), 'web');
    assert.equal(platformFor('web'), 'web');
    assert.equal(platformFor('unknown-source'), 'web');
    assert.equal(platformFor(null), 'web');

    for (const p of SOURCE_PLATFORMS) {
      assert.equal(platformIcon(p), `/icons/platforms/${p}.svg`);
    }
  });

  it('statusFromSourceDone (quota text, not subscribed text, ok)', () => {
    assert.equal(statusFromSourceDone({ status: 'ok' }), 'ok');
    assert.equal(statusFromSourceDone({ status: 'quota' }), 'quota');
    assert.equal(
      statusFromSourceDone({
        status: 'error',
        error: 'You have exceeded the MONTHLY quota for Scraping API',
      }),
      'quota',
    );
    assert.equal(
      statusFromSourceDone({
        status: 'unavailable',
        error: 'One or more agents are not subscribed',
      }),
      'inactive',
    );
    assert.equal(
      statusFromSourceDone({
        status: 'unavailable',
        error: 'One or more agents are inactive or missing configuration',
      }),
      'inactive',
    );
    assert.equal(
      statusFromSourceDone({
        status: 'error',
        error: 'Connection timeout',
      }),
      'error',
    );
    assert.equal(statusFromSourceDone(), 'error');
  });

  it('per-platform tweak functions: YouTube, TikTok, Instagram, X, Reddit, Web', () => {
    const base = createFootageItem({ id: 'test' });

    const ytShorts = normaliseYouTube(
      { url: 'https://www.youtube.com/shorts/pu6shIJmb5s' },
      base,
    );
    assert.equal(
      ytShorts.embedUrl,
      'https://www.youtube.com/embed/pu6shIJmb5s',
    );
    assert.equal(
      ytShorts.thumbUrl,
      'https://i.ytimg.com/vi/pu6shIJmb5s/hqdefault.jpg',
    );

    const tt = normaliseTikTok(
      { url: 'https://www.tiktok.com/@user/video/7123456789' },
      base,
    );
    assert.equal(tt.embedUrl, 'https://www.tiktok.com/embed/v2/7123456789');

    const ig = normaliseInstagram(
      { url: 'https://www.instagram.com/p/DXgVj3djDAR' },
      base,
    );
    assert.equal(ig.embedUrl, 'https://www.instagram.com/p/DXgVj3djDAR/embed/');

    const xItem = normaliseX({ url: 'https://x.com/post' }, base);
    assert.ok(xItem);

    const rdItem = normaliseReddit({ url: 'https://reddit.com/r/post' }, base);
    assert.ok(rdItem);

    const webItem = normaliseWeb({ url: 'https://news.com/article' }, base);
    assert.ok(webItem);
  });

  it('normaliseItem sets stable id, hashtags from caption, authorAvatar, location', () => {
    const raw = {
      source: 'instagram+web',
      title: 'Crash on highway #ummsuqeim #accident',
      url: 'https://instagram.com/p/1234',
      canonical: 'ig:1234',
      author: 'dxbpolice',
      published_at: '2026-09-26T09:00:00Z',
      lat: 25.1478,
      lon: 55.2004,
      author_avatar: 'https://avatar.png',
    };

    const item = normaliseItem(raw, { sceneId: 's_test' });
    assert.equal(item.sceneId, 's_test');
    assert.equal(item.platform, 'instagram');
    assert.ok(typeof item.id === 'string' && item.id.length > 0);
    assert.deepEqual(item.hashtags.sort(), ['#accident', '#ummsuqeim']);
    assert.equal(item.authorAvatar, 'https://avatar.png');
    assert.equal(item.uploadedAt, '2026-09-26T09:00:00Z');
    assert.equal(item.location.confidence, 'exact');
    assert.equal(item.location.basis, 'geotag');
    assert.equal(item.location.lat, 25.1478);
    assert.equal(item.location.lon, 55.2004);
    assert.equal(item.pluginMeta.icon, '/icons/platforms/instagram.svg');
    assert.equal(item.pluginMeta.rawPayloadRef, 'ig:1234');

    // Without geotag
    const itemNoGeo = normaliseItem({ source: 'web', title: 'News' });
    assert.equal(itemNoGeo.location.confidence, 'unknown');
    assert.equal(itemNoGeo.location.basis, 'none');
    assert.equal(itemNoGeo.location.lat, null);
    assert.equal(itemNoGeo.authorAvatar, null);
  });
});

describe('Geo Resolver', () => {
  const scene = {
    id: 's_test',
    target: { name: 'Scene Center', lat: 25.2048, lon: 55.2708 },
  };

  it('never returns exact without geotag + place-tag inference for حادث أم سقيم and #ummsuqeim', () => {
    // 1. Exact geotag is preserved
    const exactItem = createFootageItem({
      location: {
        lat: 25.12,
        lon: 55.19,
        confidence: 'exact',
        basis: 'geotag',
      },
    });
    const locExact = resolveLocation(exactItem, scene);
    assert.equal(locExact.confidence, 'exact');
    assert.equal(locExact.basis, 'geotag');

    // 2. Arabic place inference
    const arabicItem = createFootageItem({
      caption: 'فيديو يوضح تفاصيل حادث أم سقيم اليوم',
    });
    const locArabic = resolveLocation(arabicItem, scene);
    assert.equal(locArabic.confidence, 'inferred');
    assert.equal(locArabic.basis, 'place-tag:Umm Suqeim');
    assert.equal(locArabic.lat, 25.147);
    assert.equal(locArabic.lon, 55.199);

    // 3. Hashtag place inference
    const hashtagItem = createFootageItem({
      caption: 'Scene near the coast #ummsuqeim',
      hashtags: ['#ummsuqeim'],
    });
    const locHashtag = resolveLocation(hashtagItem, scene);
    assert.equal(locHashtag.confidence, 'inferred');
    assert.equal(locHashtag.basis, 'place-tag:Umm Suqeim');
    assert.equal(locHashtag.lat, 25.147);
    assert.equal(locHashtag.lon, 55.199);

    // 4. Landmark inference
    const landmarkItem = createFootageItem({
      title: 'Crowds gathering at Burj Khalifa tonight',
    });
    const locLandmark = resolveLocation(landmarkItem, scene);
    assert.equal(locLandmark.confidence, 'inferred');
    assert.equal(locLandmark.basis, 'place-tag:Burj Khalifa');
    assert.equal(locLandmark.lat, 25.1972);
    assert.equal(locLandmark.lon, 55.2744);

    // 5. Fallback to scene target (must be 'unknown', NEVER 'exact')
    const genericItem = createFootageItem({
      title: 'Random clip without places',
    });
    const locFallback = resolveLocation(genericItem, scene);
    assert.equal(locFallback.confidence, 'unknown');
    assert.equal(locFallback.basis, 'scene-target');
    assert.equal(locFallback.lat, 25.2048);
    assert.equal(locFallback.lon, 55.2708);
  });
});

describe('Ranker & Formatting', () => {
  it('ranker formula numeric check (hand-computed example)', () => {
    // rankScore = 0.35 * distanceScore + 0.30 * timeScore + 0.25 * relevance + 0.10 * geoConfScore
    // Example 1:
    // distanceKm: 0 -> distanceScore = 1.0
    // timeDelta: 0 -> timeScore = 1.0
    // relevance: 0.8
    // geo confidence: 'exact' -> 1.0
    // Score = 0.35 * 1.0 + 0.30 * 1.0 + 0.25 * 0.8 + 0.10 * 1.0 = 0.35 + 0.30 + 0.20 + 0.10 = 0.95
    const scene = { kind: 'live', tRef: '2026-10-23T12:00:00Z' };
    const item1 = {
      distanceKm: 0,
      timeDelta: 0,
      relevance: 0.8,
      location: { confidence: 'exact' },
    };
    const score1 = rankScore(item1, scene);
    assert.ok(Math.abs(score1 - 0.95) < 1e-6, `Expected ~0.95, got ${score1}`);

    // Example 2 with decay:
    // distanceKm: 3 -> distanceScore = exp(-1) ≈ 0.3678794
    // timeDelta: 21600 (6h in live) -> timeScore = exp(-1) ≈ 0.3678794
    // relevance: 1.0
    // geo confidence: 'inferred' -> 0.6
    // Expected: 0.35 * exp(-1) + 0.30 * exp(-1) + 0.25 * 1.0 + 0.10 * 0.6
    //         = 0.65 * 0.367879441 + 0.25 + 0.06 = 0.239121637 + 0.31 = 0.5491216
    const item2 = {
      distanceKm: 3,
      timeDelta: 21600,
      relevance: 1.0,
      location: { confidence: 'inferred' },
    };
    const score2 = rankScore(item2, scene);
    const expected2 = 0.65 * Math.exp(-1) + 0.31;
    assert.ok(
      Math.abs(score2 - expected2) < 1e-4,
      `Expected ~${expected2}, got ${score2}`,
    );
  });

  it('recency rules incl. rebuild→ARCHIVE', () => {
    const nowMs = 1_700_000_000_000;
    const tenMinAgo = new Date(nowMs - 10 * 60_000).toISOString();
    const twoHoursAgo = new Date(nowMs - 2 * 3600_000).toISOString();
    const twoDaysAgo = new Date(nowMs - 48 * 3600_000).toISOString();

    assert.equal(recencyOf(tenMinAgo, nowMs, 'live'), 'LIVE');
    assert.equal(recencyOf(twoHoursAgo, nowMs, 'live'), 'RECENT');
    assert.equal(recencyOf(twoDaysAgo, nowMs, 'live'), 'ARCHIVE');

    // In rebuild mode, ALL items are ARCHIVE regardless of time
    assert.equal(recencyOf(tenMinAgo, nowMs, 'rebuild'), 'ARCHIVE');
    assert.equal(recencyOf(twoHoursAgo, nowMs, 'rebuild'), 'ARCHIVE');
    assert.equal(recencyOf(twoDaysAgo, nowMs, 'rebuild'), 'ARCHIVE');
  });

  it('rankItems ordering and non-mutation', () => {
    const scene = {
      kind: 'live',
      target: { lat: 25.0, lon: 55.0 },
      tRef: '2026-10-23T12:00:00Z',
    };
    const nowMs = Date.parse('2026-10-23T12:00:00Z');

    const itemA = createFootageItem({
      id: 'A',
      location: { lat: 25.0, lon: 55.0, confidence: 'exact' },
      uploadedAt: '2026-10-23T12:00:00Z',
      relevance: 0.9,
    });
    const itemB = createFootageItem({
      id: 'B',
      location: { lat: 25.05, lon: 55.05, confidence: 'inferred' },
      uploadedAt: '2026-10-23T11:00:00Z',
      relevance: 0.6,
    });
    const itemC = createFootageItem({
      id: 'C',
      location: { lat: 25.5, lon: 55.5, confidence: 'unknown' },
      uploadedAt: '2026-10-23T06:00:00Z',
      relevance: 0.3,
    });

    const original = [itemC, itemA, itemB];
    const ranked = rankItems(original, scene, nowMs);

    assert.notEqual(ranked, original, 'Must return a NEW array');
    assert.equal(ranked[0].id, 'A');
    assert.equal(ranked[1].id, 'B');
    assert.equal(ranked[2].id, 'C');

    assert.equal(ranked[0].distanceKm, 0);
    assert.equal(ranked[0].timeDelta, 0);
    assert.equal(ranked[0].recency, 'LIVE');
    assert.ok(ranked[0].rankScore > ranked[1].rankScore);
    assert.ok(ranked[1].rankScore > ranked[2].rankScore);

    // Item with no location and no target
    const itemNoLoc = createFootageItem({
      id: 'D',
      location: { lat: null, lon: null },
    });
    const rankedNoLoc = rankItems([itemNoLoc], { kind: 'live' }, nowMs);
    assert.equal(rankedNoLoc[0].distanceKm, null);
  });

  it('formatDistance and formatDelta helpers', () => {
    assert.equal(formatDistance(0.8), '0.8 km from target');
    assert.equal(formatDistance(0.32), '320 m from target');
    assert.equal(formatDistance(0), '0 m from target');
    assert.equal(formatDistance(12.4), '12 km from target');
    assert.equal(formatDistance(null), '—');

    assert.equal(formatDelta(840, 'incident'), '+14 min after incident');
    assert.equal(formatDelta(-7200, 'rebuild'), '−2 h before incident');
    assert.equal(formatDelta(-7200, 'live'), 'posted 2 h ago');
    assert.equal(formatDelta(-30, 'live'), 'posted just now');
    assert.equal(formatDelta(-120, 'live'), 'posted 2 min ago');
    assert.equal(formatDelta(-172800, 'live'), 'posted 2 d ago');
    assert.equal(formatDelta(null), '—');
  });

  it('clusterItems simple grid-bucket clustering', () => {
    const items = [];
    // 10 items in same 100px cell
    for (let i = 0; i < 10; i++) {
      items.push(
        createFootageItem({
          id: `item_${i}`,
          location: { lat: 25.0 + i * 0.0001, lon: 55.0 + i * 0.0001 },
        }),
      );
    }
    const project = (lat, lon) => ({ x: 50, y: 50 });
    const clusters = clusterItems(items, project, 100, 8);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].items.length, 10);
    assert.equal(clusters[0].x, 50);
    assert.equal(clusters[0].y, 50);

    // Less than min
    const smallClusters = clusterItems(items.slice(0, 5), project, 100, 8);
    assert.equal(smallClusters.length, 0);
  });
});

describe('Ranker Client & Worker fallback', () => {
  it('createRanker falls back to sync ranking when Worker is absent', async () => {
    const ranker = createRanker({ Worker: null });
    const scene = { kind: 'live' };
    const items = [
      createFootageItem({ id: '1', uploadedAt: '2026-10-23T10:00:00Z' }),
    ];
    const ranked = await ranker.rank(items, scene);
    assert.equal(ranked.length, 1);
    ranker.destroy();
  });

  it('createRanker uses Worker with correlation ids when available', async () => {
    class MockWorker {
      constructor() {
        this.onmessage = null;
      }
      postMessage(msg) {
        setTimeout(() => {
          if (this.onmessage) {
            this.onmessage({ data: { id: msg.id, items: msg.items } });
          }
        }, 5);
      }
      terminate() {}
    }

    const ranker = createRanker({ Worker: MockWorker });
    const scene = { kind: 'live' };
    const items = [
      createFootageItem({ id: 'w1' }),
      createFootageItem({ id: 'w2' }),
    ];
    const ranked = await ranker.rank(items, scene);
    assert.equal(ranked.length, 2);
    ranker.destroy();
  });
});

describe('Cache TTL & LRU', () => {
  it('cache TTL expiry via injected now', () => {
    let mockNow = 100_000;
    const cache = createFootageCache({ now: () => mockNow, maxEntries: 2 });

    const key1 = cache.keyFor({
      sceneId: 's1',
      platform: 'tiktok',
      query: 'crash',
      tRef: '2026-10-23',
    });
    cache.set(key1, [{ id: 'item1' }], 'LIVE'); // 60s TTL

    // Immediately available
    const res1 = cache.get(key1);
    assert.ok(res1);
    assert.equal(res1.length, 1);
    assert.equal(cache.stats().hits, 1);

    // 59 seconds later: still valid
    mockNow += 59_000;
    const res2 = cache.get(key1);
    assert.ok(res2);
    assert.equal(cache.stats().hits, 2);

    // 61 seconds later: expired
    mockNow += 2_000;
    const resExpired = cache.get(key1);
    assert.equal(resExpired, null);
    assert.equal(cache.stats().misses, 1);
  });

  it('cache LRU eviction when exceeding maxEntries', () => {
    let mockNow = 100_000;
    const cache = createFootageCache({ now: () => mockNow, maxEntries: 2 });

    cache.set('k1', [{ id: '1' }], 'RECENT');
    cache.set('k2', [{ id: '2' }], 'RECENT');
    assert.equal(cache.stats().size, 2);

    // Adding third key evicts k1
    cache.set('k3', [{ id: '3' }], 'RECENT');
    assert.equal(cache.get('k1'), null);
    assert.ok(cache.get('k2'));
    assert.ok(cache.get('k3'));

    cache.clear();
    assert.equal(cache.stats().size, 0);
  });
});

describe('Pipeline & Streaming', () => {
  it('pipeline with a fake client -> onItem count, onSource statuses, onRanked sorted, cache hit on second run, abort mid-stream', async () => {
    let streamCount = 0;
    const fakeClient = {
      stream: async (params, handlers, { signal }) => {
        streamCount += 1;
        handlers.onSourceStart?.({ source: 'youtube' });
        handlers.onItem?.({
          source: 'youtube',
          title: 'YouTube Clip 1',
          published_at: '2026-10-23T10:00:00Z',
          canonical: 'yt:1',
          lat: 25.147,
          lon: 55.199,
          relevance: 0.9,
        });
        handlers.onItem?.({
          source: 'youtube',
          title: 'YouTube Clip 2',
          published_at: '2026-10-23T11:00:00Z',
          canonical: 'yt:2',
          relevance: 0.8,
        });
        handlers.onSourceDone?.({
          source: 'youtube',
          status: 'ok',
          count: 2,
          ms: 120,
        });

        handlers.onSourceStart?.({ source: 'instagram' });
        handlers.onItem?.({
          source: 'instagram',
          title: 'Instagram Post 1 #ummsuqeim',
          published_at: '2026-10-23T10:30:00Z',
          canonical: 'ig:1',
          relevance: 0.85,
        });
        handlers.onSourceDone?.({
          source: 'instagram',
          status: 'ok',
          count: 1,
          ms: 200,
        });
        handlers.onDone?.({ status: 'done' });
      },
    };

    const scene = {
      id: 's_pipeline',
      prompt: 'rebuild the car crash reported in Umm Suqeim',
      target: { name: 'Umm Suqeim', lat: 25.147, lon: 55.199 },
      tRef: '2026-10-23T10:00:00Z',
      kind: 'live',
    };

    const cache = createFootageCache();
    const ranker = createRanker();

    const receivedItems = [];
    const sourceStatuses = {};
    let rankedItems = null;

    const summary1 = await runFootagePipeline({
      scene,
      client: fakeClient,
      ranker,
      cache,
      onItem: (item) => receivedItems.push(item),
      onSource: (platform, data) => {
        sourceStatuses[platform] = data;
      },
      onRanked: (items) => {
        rankedItems = items;
      },
    });

    assert.equal(streamCount, 1);
    assert.equal(receivedItems.length, 3, 'onItem received 3 items');
    assert.equal(sourceStatuses.youtube.status, 'ok');
    assert.equal(sourceStatuses.instagram.status, 'ok');
    assert.equal(rankedItems.length, 3);
    assert.equal(summary1.cacheHit, false);
    assert.equal(summary1.items.length, 3);

    // Second run: must hit cache with 0 client calls
    let secondOnRankedCalled = false;
    const summary2 = await runFootagePipeline({
      scene,
      client: fakeClient,
      ranker,
      cache,
      onRanked: () => {
        secondOnRankedCalled = true;
      },
    });

    assert.equal(streamCount, 1, 'Cache hit prevents client calls');
    assert.equal(summary2.cacheHit, true);
    assert.equal(summary2.items.length, 3);
    assert.ok(secondOnRankedCalled);

    // Abort mid-stream stops callbacks
    const abortController = new AbortController();
    const abortClient = {
      stream: async (params, handlers, { signal }) => {
        handlers.onSourceStart?.({ source: 'youtube' });
        abortController.abort();
        handlers.onItem?.({ source: 'youtube', title: 'Post-abort item' });
      },
    };

    let postAbortItemReceived = false;
    const summaryAbort = await runFootagePipeline({
      scene: { ...scene, id: 's_abort' },
      client: abortClient,
      ranker,
      cache,
      signal: abortController.signal,
      onItem: () => {
        postAbortItemReceived = true;
      },
    });

    assert.equal(postAbortItemReceived, false, 'No callbacks after abort');
    assert.equal(summaryAbort.aborted, true);
  });

  it('fixture replay path with the real file tests/fixtures/umm-suqeim-rebuild.json', async () => {
    const fixturePath = path.resolve(
      ROOT_DIR,
      'tests/fixtures/umm-suqeim-rebuild.json',
    );
    const fixtureData = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    const scene = {
      id: 's_rebuild_fixture',
      prompt: fixtureData.prompt,
      target: fixtureData.target,
      tRef: fixtureData.tRef,
      kind: 'rebuild',
    };

    const ranker = createRanker();
    const summary = await runFootagePipeline({
      scene,
      fixtures: fixtureData,
      ranker,
    });

    assert.equal(summary.items.length, 8, 'Yields 8 items');
    for (const item of summary.items) {
      assert.equal(
        item.recency,
        'ARCHIVE',
        `Item ${item.id} must have recency ARCHIVE in rebuild mode`,
      );
      assert.equal(
        typeof item.distanceKm,
        'number',
        `Item ${item.id} must have numeric distanceKm`,
      );
      assert.ok(
        Number.isFinite(item.distanceKm),
        `Item ${item.id} distanceKm must be finite`,
      );
    }

    assert.equal(
      summary.earliestUploadedAt,
      '2026-09-26T07:48:00Z',
      'Earliest uploadedAt must match 2026-09-26T07:48:00Z',
    );
  });
});
