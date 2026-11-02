import test from 'node:test';
import assert from 'node:assert/strict';
import { expandPlaceVariants, runFanout } from './fanout.js';

test('expandPlaceVariants generates primary, ladder, hashtags, spelling variants, and UAE transliterations', () => {
  const variants = expandPlaceVariants({
    placeName: 'Dubai Marina',
    lat: 25.0805,
    lon: 55.1403,
    maxVariants: 15,
  });

  assert.ok(variants.length > 1);
  assert.equal(variants[0], 'Dubai Marina');
  // Contains hashtag compact form
  assert.ok(variants.includes('dubaimarina'));
  // Contains Arabic transliteration
  assert.ok(variants.includes('مرسى دبي'));
});

test('expandPlaceVariants handles apostrophes and gym variations', () => {
  const variants = expandPlaceVariants({
    placeName: 'Kanes Boxing Gym Abu Dhabi',
    lat: 24.495,
    lon: 54.378,
    maxVariants: 15,
  });

  // Should have generated apostrophe variant
  assert.ok(
    variants.some(
      (v) =>
        v.toLowerCase().includes("kane's") || v.toLowerCase().includes('kanes'),
    ),
  );
  // Should include Abu Dhabi or transliteration
  assert.ok(
    variants.some(
      (v) => v.toLowerCase().includes('abu dhabi') || v.includes('أبوظبي'),
    ),
  );
});

test('expandPlaceVariants includes caller-supplied nearby POI names', () => {
  const variants = expandPlaceVariants({
    placeName: 'Burj Khalifa',
    lat: 25.1972,
    lon: 55.2744,
    nearbyNames: ['Dubai Mall', 'Souk Al Bahar'],
    maxVariants: 15,
  });

  assert.ok(variants.includes('Burj Khalifa'));
  assert.ok(variants.includes('برج خليفة'));
  assert.ok(variants.includes('Dubai Mall'));
});

test('expandPlaceVariants generates venue-specific variants for landmark venues including Emirates Palace', () => {
  const variants = expandPlaceVariants({
    placeName: 'Emirates Palace',
    maxVariants: 15,
  });

  assert.ok(variants.includes('Emirates Palace'));
  assert.ok(variants.includes('Emirates Palace Abu Dhabi'));
  assert.ok(variants.includes('Mandarin Oriental Emirates Palace'));
  assert.ok(variants.includes('Abu Dhabi Corniche'));

  // Burj Al Arab brand alias
  const burj = expandPlaceVariants({
    placeName: 'Burj Al Arab',
    maxVariants: 15,
  });
  assert.ok(burj.includes('Jumeirah Burj Al Arab'));

  // Kane's alias
  const kanes = expandPlaceVariants({
    placeName: "Kane's",
    maxVariants: 15,
  });
  assert.ok(kanes.includes('Kanes Boxing Gym'));
});

test('runFanout: dedupe drops duplicate storyIds across variants and counts them accurately', async () => {
  const callOne = async (variant) => {
    if (variant === 'Dubai Marina') {
      return {
        results: [
          {
            place: 'Dubai Marina',
            videos: [
              {
                storyId: 'STORY_COMMON_01',
                storageUrl:
                  'https://airevdev.blob.core.windows.net/test/v1.mp4?se=2026-11-02&sig=abc',
              },
              {
                storyId: 'STORY_MARINA_ONLY',
                storageUrl:
                  'https://airevdev.blob.core.windows.net/test/v2.mp4?se=2026-11-02&sig=abc',
              },
            ],
          },
        ],
      };
    }
    if (variant === 'dubaimarina') {
      return {
        results: [
          {
            place: 'dubaimarina',
            videos: [
              // Same storyId as above
              {
                storyId: 'STORY_COMMON_01',
                storageUrl:
                  'https://airevdev.blob.core.windows.net/test/v1.mp4?se=2026-11-02&sig=abc',
              },
              {
                storyId: 'STORY_TAG_ONLY',
                storageUrl:
                  'https://airevdev.blob.core.windows.net/test/v3.mp4?se=2026-11-02&sig=abc',
              },
            ],
          },
        ],
      };
    }
    return { results: [] };
  };

  const res = await runFanout({
    variants: ['Dubai Marina', 'dubaimarina'],
    callOne,
    limit: 25,
    concurrency: 1, // sequential for predictable order
  });

  assert.equal(res.counts.raw, 4); // 2 + 2
  assert.equal(res.counts.unique, 3); // STORY_COMMON_01, STORY_MARINA_ONLY, STORY_TAG_ONLY
  assert.equal(res.clips.length, 3);

  // Variant 1 had 2 raw, 2 unique
  assert.equal(res.variants[0].raw, 2);
  assert.equal(res.variants[0].unique, 2);

  // Variant 2 had 2 raw, 1 unique (since COMMON_01 was already seen)
  assert.equal(res.variants[1].raw, 2);
  assert.equal(res.variants[1].unique, 1);
});

test('runFanout: truncation detection flags truncated: true when raw === limit', async () => {
  const callOne = async (variant) => {
    // Return 3 items when limit is 3
    return {
      results: [
        {
          place: variant,
          videos: [
            {
              storyId: `${variant}_1`,
              storageUrl: `https://airevdev.blob.core.windows.net/test/${variant}_1.mp4?se=1&sig=1`,
            },
            {
              storyId: `${variant}_2`,
              storageUrl: `https://airevdev.blob.core.windows.net/test/${variant}_2.mp4?se=1&sig=1`,
            },
            {
              storyId: `${variant}_3`,
              storageUrl: `https://airevdev.blob.core.windows.net/test/${variant}_3.mp4?se=1&sig=1`,
            },
          ],
        },
      ],
    };
  };

  const res = await runFanout({
    variants: ['Burj Khalifa'],
    callOne,
    limit: 3,
  });

  assert.equal(res.counts.raw, 3);
  assert.equal(res.counts.truncatedVariants, 1);
  assert.equal(res.variants[0].truncated, true);
});

test('runFanout: error isolation ensures one failed variant does not fail the batch', async () => {
  const callOne = async (variant) => {
    if (variant === 'broken') {
      throw new Error('upstream_500_internal_error');
    }
    return {
      results: [
        {
          place: variant,
          videos: [
            {
              storyId: 'STORY_OK',
              storageUrl:
                'https://airevdev.blob.core.windows.net/test/ok.mp4?se=1&sig=1',
            },
          ],
        },
      ],
    };
  };

  const res = await runFanout({
    variants: ['broken', 'healthy'],
    callOne,
    backoff: { attempts: 1 },
  });

  assert.equal(res.counts.variantsTried, 2);
  assert.equal(res.counts.raw, 1);
  assert.equal(res.counts.unique, 1);

  // Broken variant recorded with error
  const brokenStat = res.variants.find((v) => v.variant === 'broken');
  assert.ok(brokenStat.error.includes('upstream_500_internal_error'));
  assert.equal(brokenStat.raw, 0);

  // Healthy variant succeeded
  const healthyStat = res.variants.find((v) => v.variant === 'healthy');
  assert.equal(healthyStat.raw, 1);
  assert.equal(healthyStat.unique, 1);
});

test('runFanout: concurrency bound respects the configured limit', async () => {
  let active = 0;
  let maxActive = 0;

  const callOne = async (variant) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return { results: [] };
  };

  await runFanout({
    variants: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    callOne,
    concurrency: 3,
  });

  assert.ok(maxActive <= 3, `Expected maxActive <= 3, got ${maxActive}`);
  assert.ok(maxActive >= 2, `Expected concurrent calls, got ${maxActive}`);
});
