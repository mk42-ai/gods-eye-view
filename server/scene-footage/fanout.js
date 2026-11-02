/**
 * Fan-out ingestion module for Snapchat scene footage.
 *
 * Expands a target scene location into ordered, deduped place-name variants
 * (primary name, ladder ancestors, hashtag forms, apostrophe/spelling variants,
 * static EN→AR transliterations, and optional nearby POI names).
 *
 * Executes bounded concurrent queries with jittered backoff, per-call timeouts,
 * deduplication by storyId and storage URL path, error isolation, and truncation accounting.
 */
import {
  buildLadder,
  normPlace,
  compactPlace,
  UAE_TRANSLITERATIONS,
} from '../../src/sceneFootage/places.js';
import { redactMediaUrl, isRetryable } from './snapchat.js';

export { UAE_TRANSLITERATIONS };

/**
 * Known operator/brand aliases for landmark venues.
 * Keyed by normalized name (normPlace).
 */
export const LANDMARK_BRAND_ALIASES = Object.freeze({
  [normPlace('Emirates Palace')]: ['Mandarin Oriental Emirates Palace'],
  [normPlace('Burj Al Arab')]: ['Jumeirah Burj Al Arab'],
  [normPlace("Kane's")]: ['Kanes Boxing Gym'],
  [normPlace("Kane's Boxing Gym")]: ['Kanes Boxing Gym'],
  [normPlace('Kanes')]: ['Kanes Boxing Gym'],
  [normPlace('Kanes Boxing Gym')]: ['Kanes Boxing Gym'],
});

/**
 * Generate plural/singular and apostrophe variations for an English name.
 * e.g. "kane's" ↔ "kanes", "Kane's Boxing Gym" ↔ "Kanes Boxing Gym"
 */
function generateSpellingVariants(name) {
  const variants = [];
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed.length < 3) return variants;

  // Apostrophe variations: Kane's ↔ Kanes
  if (/['’]s\b/i.test(trimmed)) {
    variants.push(trimmed.replace(/['’]s\b/gi, 's'));
    variants.push(trimmed.replace(/['’]s\b/gi, ''));
  } else if (/\b([a-zA-Z]+)s\b/i.test(trimmed)) {
    variants.push(trimmed.replace(/\b([a-zA-Z]+)s\b/gi, "$1's"));
  }

  // Remove trailing common terms to uncover root facility/brand name
  // e.g. "Kanes Boxing Gym Abu Dhabi" → "Kanes Boxing Gym" → "Kanes Boxing" → "Kanes"
  const strippedCity = trimmed.replace(
    /\s+(?:abu dhabi|dubai|sharjah|uae|emirates)\s*$/i,
    '',
  );
  if (strippedCity !== trimmed && strippedCity.length >= 3) {
    variants.push(strippedCity);
    if (/['’]s\b/i.test(strippedCity)) {
      variants.push(strippedCity.replace(/['’]s\b/gi, 's'));
    } else if (/\b([a-zA-Z]+)s\b/i.test(strippedCity)) {
      variants.push(strippedCity.replace(/\b([a-zA-Z]+)s\b/gi, "$1's"));
    }
  }

  const base = strippedCity || trimmed;
  const strippedSuffix = base.replace(
    /\s+(?:boxing\s+gym|boxing\s+club|boxing|gym|club|hotel|resort|tower|towers|mall|walk|beach)\s*$/i,
    '',
  );
  if (strippedSuffix !== base && strippedSuffix.length >= 3) {
    variants.push(strippedSuffix);
    if (/['’]s\b/i.test(strippedSuffix)) {
      variants.push(strippedSuffix.replace(/['’]s\b/gi, 's'));
    } else if (/\b([a-zA-Z]+)s\b/i.test(strippedSuffix)) {
      variants.push(strippedSuffix.replace(/\b([a-zA-Z]+)s\b/gi, "$1's"));
    }
  }

  return variants;
}

/**
 * Expand a place name and coordinates into an ordered, deduped list of place-name variants.
 *
 * @param {object} input
 * @param {string} [input.placeName] Primary place name
 * @param {string} [input.anchorName] Anchor label
 * @param {number} [input.lat] Latitude
 * @param {number} [input.lon] Longitude
 * @param {string[]} [input.nearbyNames] Optional nearby POI names
 * @param {string} [input.scope] 'strict' | 'balanced' | 'wide'
 * @param {number} [input.maxVariants] Max count (default 15)
 * @param {object} [input.locationResolution] Scene location resolution object
 * @param {string} [input.address] Address text
 * @param {string} [input.district] District name
 * @param {string} [input.city] City name
 * @returns {string[]} Ordered, deduped variant strings
 */
export function expandPlaceVariants({
  placeName = '',
  anchorName = '',
  lat = null,
  lon = null,
  nearbyNames = [],
  scope = 'balanced',
  maxVariants = 15,
  locationResolution = null,
  address = '',
  district = '',
  city = '',
} = {}) {
  const candidates = [];

  const add = (name, provenance) => {
    if (!name) return;
    const clean = String(name).trim();
    if (clean.length < 2) return;
    candidates.push({ name: clean, provenance });
  };

  const primary = String(placeName || '').trim();
  const anchor = String(anchorName || '').trim();

  // 1. Primary place name
  if (primary) add(primary, 'primary-placeName');
  if (anchor && anchor.toLowerCase() !== primary.toLowerCase()) {
    add(anchor, 'primary-anchorName');
  }

  // 2. Ladder hierarchy from places.js (full city search for city / district discovery)
  let ladder = [];
  if (primary || (Number.isFinite(lat) && Number.isFinite(lon))) {
    ladder = buildLadder(
      { lat, lon, placeName: primary || anchor },
      { maxCoverageLevel: 'city' },
    );
  }

  // Derive city name generically
  let resolvedCity = String(city || locationResolution?.city || '').trim();
  const fullAddress = String(address || locationResolution?.address || '');
  if (!resolvedCity && fullAddress) {
    for (const c of [
      'Abu Dhabi',
      'Dubai',
      'Sharjah',
      'Ajman',
      'Al Ain',
      'Fujairah',
      'Ras Al Khaimah',
    ]) {
      if (new RegExp(`\\b${c}\\b`, 'i').test(fullAddress)) {
        resolvedCity = c;
        break;
      }
    }
  }
  if (!resolvedCity) {
    const cityStep = ladder.find((s) => s.level === 'city');
    if (cityStep && cityStep.names?.[0]) {
      resolvedCity = cityStep.names[0];
    }
  }
  if (!resolvedCity) {
    if (/emirates palace/i.test(primary) || /emirates palace/i.test(anchor)) {
      resolvedCity = 'Abu Dhabi';
    } else if (
      /burj al arab|burj khalifa|dubai marina|the walk jbr/i.test(primary)
    ) {
      resolvedCity = 'Dubai';
    }
  }

  // Primary name + city (e.g. 'Emirates Palace Abu Dhabi')
  if (
    primary &&
    resolvedCity &&
    !new RegExp(`\\b${resolvedCity}\\b`, 'i').test(primary)
  ) {
    add(`${primary} ${resolvedCity}`, 'name-plus-city');
  } else if (
    anchor &&
    resolvedCity &&
    !new RegExp(`\\b${resolvedCity}\\b`, 'i').test(anchor)
  ) {
    add(`${anchor} ${resolvedCity}`, 'name-plus-city');
  }

  // 3. Known operator/brand aliases from LANDMARK_BRAND_ALIASES table
  for (const nameToCheck of [primary, anchor].filter(Boolean)) {
    const normKey = normPlace(nameToCheck);
    const aliases = LANDMARK_BRAND_ALIASES[normKey];
    if (aliases) {
      for (const al of aliases) {
        add(al, 'operator-brand-alias');
      }
    }
  }

  // 4. Nearest district / corniche from locationResolution / address / district / ladder
  const resolvedDistrict = String(
    district ||
      locationResolution?.district ||
      locationResolution?.corniche ||
      locationResolution?.neighborhood ||
      '',
  ).trim();

  if (resolvedDistrict) {
    add(resolvedDistrict, 'district-corniche');
  }

  if (fullAddress) {
    if (/abu dhabi corniche/i.test(fullAddress)) {
      add('Abu Dhabi Corniche', 'address-corniche');
    } else if (/corniche/i.test(fullAddress)) {
      add(
        resolvedCity ? `${resolvedCity} Corniche` : 'Corniche',
        'address-corniche',
      );
    }
  }

  // Check ladder neighborhood/district steps for corniche/district matches
  for (const step of ladder) {
    if (step.level === 'neighborhood' || step.level === 'district') {
      for (const n of step.names) {
        if (
          /corniche/i.test(n) ||
          (resolvedDistrict && normPlace(n) === normPlace(resolvedDistrict))
        ) {
          add(n, `ladder-${step.level}`);
        }
      }
    }
  }

  // Landmark vicinity corniche rule for Emirates Palace
  if (
    /emirates palace/i.test(primary) ||
    /emirates palace/i.test(anchor) ||
    (Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat - 24.4616) < 0.05 &&
      Math.abs(lon - 54.3173) < 0.05)
  ) {
    add('Abu Dhabi Corniche', 'landmark-vicinity-corniche');
  }

  // 5. Ladder names (hierarchy from places.js, respecting scope)
  const maxLevel = scope === 'wide' ? 'city' : 'district';
  for (const step of ladder) {
    if (step.capped && scope !== 'wide') continue;
    if (
      step.level === 'city' &&
      scope !== 'wide' &&
      ladder.some((s) => s.level !== 'city' && !s.capped)
    ) {
      continue;
    }
    for (const n of step.names) {
      add(n, `ladder-${step.level}`);
    }
  }

  // 3. Plural/singular and apostrophe variations
  for (const item of [...candidates]) {
    const spellings = generateSpellingVariants(item.name);
    for (const s of spellings) {
      add(s, 'spelling-variant');
    }
  }

  // 4. Hashtag forms (compact lowercase '#'-less, e.g. 'dubaimarina', 'burjalarab')
  for (const item of [...candidates]) {
    const compact = compactPlace(item.name);
    if (compact && compact.length >= 3 && compact !== item.name.toLowerCase()) {
      add(compact, 'hashtag-compact');
    }
  }

  // 5. Well-known static EN→AR transliterations for UAE places
  for (const item of [...candidates]) {
    const norm = normPlace(item.name);
    if (UAE_TRANSLITERATIONS[norm]) {
      add(UAE_TRANSLITERATIONS[norm], 'static-transliteration');
    } else {
      // Check if key is contained in norm
      for (const [enKey, arVal] of Object.entries(UAE_TRANSLITERATIONS)) {
        if (norm.includes(enKey) && enKey.length >= 4) {
          add(arVal, 'static-transliteration');
        }
      }
    }
  }

  // 6. Optional nearby POI names supplied by caller
  if (Array.isArray(nearbyNames)) {
    for (const poi of nearbyNames) {
      add(poi, 'nearby-poi');
      const compact = compactPlace(poi);
      if (compact && compact.length >= 3) {
        add(compact, 'hashtag-compact');
      }
      const norm = normPlace(poi);
      if (UAE_TRANSLITERATIONS[norm]) {
        add(UAE_TRANSLITERATIONS[norm], 'static-transliteration');
      }
    }
  }

  // Dedupe preserving priority order (case-insensitive for Latin, exact for others)
  const seen = new Set();
  const deduped = [];

  for (const c of candidates) {
    const key = normPlace(c.name) || c.name.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(c.name);
    if (deduped.length >= maxVariants) break;
  }

  return deduped;
}

/**
 * Execute fan-out search across place-name variants.
 *
 * @param {object} params
 * @param {string[]} params.variants Place-name queries
 * @param {Function} params.callOne Async (variant, { signal, limit }) => plugin response or clips
 * @param {number} [params.limit] Max results per variant (default 25)
 * @param {number} [params.concurrency] Max concurrent requests (default 4)
 * @param {number} [params.timeoutMs] Per-query timeout in ms (default 60000)
 * @param {object} [params.backoff] Retry configuration { attempts, baseMs }
 * @param {AbortSignal} [params.signal] Parent abort signal
 * @param {Function} [params.onProgress] Callback ({ variant, done, total })
 * @param {Function} [params.sleep] Optional sleep function for backoff
 * @param {Function} [params.random] Optional RNG for jitter
 * @returns {Promise<object>} { clips, counts, variants }
 */
export async function runFanout({
  variants = [],
  callOne,
  limit = 20,
  concurrency = 3,
  timeoutMs = 25_000,
  backoff = { attempts: 3, baseMs: 1000 },
  signal = null,
  onProgress = null,
  sleep = null,
  random = Math.random,
  knownStoryIds = [],
  metrics = null,
} = {}) {
  if (!Array.isArray(variants) || variants.length === 0) {
    return {
      clips: [],
      counts: {
        verified: 0,
        candidate: 0,
        raw: 0,
        unique: 0,
        variantsTried: 0,
        truncatedVariants: 0,
      },
      variants: [],
      ...(metrics ? { metrics: metrics.snapshot() } : {}),
    };
  }

  const poolConcurrency = Math.max(1, Math.min(concurrency, variants.length));
  const queue = variants.map((variant, index) => ({ variant, index }));
  const perVariantStats = new Array(variants.length);
  const allClips = [];

  // Seed with ids the caller already holds (e.g. the ladder's clips) so a
  // variant that only re-returns known stories reports unique:0 honestly.
  const seenStoryIds = new Set(knownStoryIds);
  const seenBlobPaths = new Set();

  let totalRaw = 0;
  let totalUnique = 0;
  let truncatedVariantCount = 0;
  let doneCount = 0;

  const wait =
    sleep ||
    ((ms) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener?.(
          'abort',
          () => {
            clearTimeout(t);
            reject(
              Object.assign(new Error('aborted'), {
                name: 'OnDemandAbortError',
                status: 499,
              }),
            );
          },
          { once: true },
        );
      }));

  async function executeOne(item) {
    const { variant, index } = item;
    const t0 = Date.now();
    let res = null;
    let callError = null;

    const attempts = Math.max(1, backoff?.attempts ?? 3);
    const baseMs = Math.max(0, backoff?.baseMs ?? 1000);

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (signal?.aborted) {
        callError = Object.assign(new Error('aborted'), { status: 499 });
        break;
      }

      const timeoutCtl = new AbortController();
      const timer = setTimeout(
        () =>
          timeoutCtl.abort(
            Object.assign(new Error('timeout'), {
              name: 'OnDemandAbortError',
              reason: 'timeout',
              status: 504,
            }),
          ),
        timeoutMs,
      );

      const combinedSignal = signal
        ? AbortSignal.any([signal, timeoutCtl.signal])
        : timeoutCtl.signal;

      try {
        if (metrics && !callOne?._handlesMetrics) {
          metrics.start(`fanout:${variant}`);
        }
        res = await callOne(variant, { signal: combinedSignal, limit });
        if (metrics && !callOne?._handlesMetrics) {
          metrics.success(`fanout:${variant}`);
        }
        clearTimeout(timer);
        callError = null;
        break;
      } catch (err) {
        if (metrics && !callOne?._handlesMetrics) {
          metrics.failure(`fanout:${variant}`, {
            status: err?.status,
            error: err,
          });
          if (err?.status === 429) {
            metrics.rateLimit({ state: 'throttled' });
          }
        }
        clearTimeout(timer);
        callError = err;
        if (signal?.aborted || attempt >= attempts || !isRetryable(err)) {
          break;
        }
        const delay = Math.min(
          20_000,
          Math.round(baseMs * 2 ** (attempt - 1) * (0.5 + random() / 2)),
        );
        try {
          await wait(delay);
        } catch (waitErr) {
          callError = waitErr;
          break;
        }
      }
    }

    const elapsedMs = Date.now() - t0;

    if (callError || !res) {
      perVariantStats[index] = {
        variant,
        raw: 0,
        unique: 0,
        ms: elapsedMs,
        error: callError?.message || 'unknown_error',
      };
      doneCount += 1;
      onProgress?.({ variant, done: doneCount, total: variants.length });
      return;
    }

    // Extract videos from response (handles PluginResponseSchema or array of clips)
    let videos = [];
    if (Array.isArray(res)) {
      videos = res;
    } else if (Array.isArray(res.clips)) {
      videos = res.clips;
    } else if (Array.isArray(res.results)) {
      videos = res.results.flatMap((r) =>
        Array.isArray(r.videos) ? r.videos : [],
      );
    }

    const raw = videos.length;
    totalRaw += raw;
    const isTruncated = raw >= limit;
    if (isTruncated) truncatedVariantCount += 1;

    let uniqueForVariant = 0;

    for (const v of videos) {
      const storyId =
        v.storyId ||
        (typeof v.id === 'string' ? v.id.replace(/^snap-/, '') : null);
      const mediaUrl = v.storageUrl || v.mediaUrl;
      const blobPath = mediaUrl ? redactMediaUrl(mediaUrl) : null;

      const isDup =
        (storyId && seenStoryIds.has(storyId)) ||
        (blobPath && seenBlobPaths.has(blobPath));

      if (isDup) continue;

      if (storyId) seenStoryIds.add(storyId);
      if (blobPath) seenBlobPaths.add(blobPath);

      uniqueForVariant += 1;
      totalUnique += 1;
      allClips.push(v);
    }

    perVariantStats[index] = {
      variant,
      raw,
      unique: uniqueForVariant,
      ms: elapsedMs,
      ...(isTruncated ? { truncated: true } : {}),
    };

    doneCount += 1;
    onProgress?.({ variant, done: doneCount, total: variants.length });
  }

  // Concurrency pool
  const workers = Array.from({ length: poolConcurrency }, async () => {
    while (queue.length > 0) {
      if (signal?.aborted) break;
      const item = queue.shift();
      if (!item) break;
      await executeOne(item);
    }
  });

  await Promise.all(workers);

  return {
    clips: allClips,
    counts: {
      verified: 0,
      candidate: allClips.length,
      raw: totalRaw,
      unique: totalUnique,
      variantsTried: variants.length,
      truncatedVariants: truncatedVariantCount,
    },
    variants: perVariantStats.filter(Boolean),
    ...(metrics ? { metrics: metrics.snapshot() } : {}),
  };
}
