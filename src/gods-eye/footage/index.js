/**
 * Gods-Eye Footage Subsystem Public API
 * Re-exports normalisers, geo-resolver, ranker, worker client, cache, and pipeline.
 */

export {
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
} from './normalisers.js';

export { LANDMARKS, resolveLocation } from './geoResolver.js';

export {
  haversineKm,
  RANK_WEIGHTS,
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
} from './ranker.js';

export { createRanker } from './rankClient.js';

export { FOOTAGE_CACHE_TTL, createFootageCache } from './cache.js';

export { runFootagePipeline } from './pipeline.js';
