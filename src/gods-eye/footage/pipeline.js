/**
 * Gods-Eye Footage Pipeline
 * Orchestrates fetching, normalising, geo-resolving, ranking, and caching of footage.
 * Browser ES module — no Node builtins, no DOM access at import time.
 */

import { parseCommand } from '../../footage/model.js';
import {
  normaliseItem,
  platformFor,
  statusFromSourceDone,
  SOURCE_PLATFORMS,
} from './normalisers.js';
import { resolveLocation } from './geoResolver.js';

function extractKeywords(prompt, placeName) {
  const parsed = parseCommand(prompt);
  if (parsed?.incident) return parsed.incident;
  let text = String(prompt || '');
  if (placeName) {
    const re = new RegExp(
      `\\b${placeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'gi',
    );
    text = text.replace(re, ' ');
  }
  const verbs =
    /^(?:please\s+)?(rebuild|replay|reconstruct|show|play|pull|find|get|fetch|watch|load)\b/i;
  return text
    .replace(verbs, ' ')
    .replace(
      /\b(?:reported|happened|occurred|in|at|near|around|from|the|a|an)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function expandPublishedAt(publishedAt, nowMs) {
  if (!publishedAt || typeof publishedAt !== 'string') return publishedAt;
  const match = publishedAt.match(/__NOW-(\d+)__/);
  return match
    ? new Date(nowMs - Number(match[1]) * 1000).toISOString()
    : publishedAt;
}

const findEarliest = (items) =>
  items
    .map((i) => i?.uploadedAt)
    .filter(Boolean)
    .sort()[0] || null;

export async function runFootagePipeline({
  scene,
  client,
  ranker,
  cache,
  signal,
  enabled = {},
  fixtures = null,
  now = () => Date.now(),
  onItem,
  onSource,
  onRanked,
  onDone,
  streamCapMs = 15000,
} = {}) {
  const nowMs = typeof now === 'function' ? now() : Number(now) || Date.now();
  const place = scene?.target?.name || null;
  const keywords = extractKeywords(scene?.prompt, place);
  const isRebuild = scene?.kind === 'rebuild';
  const query = {
    lat: scene?.target?.lat,
    lon: scene?.target?.lon,
    radiusKm: 5,
    keywords,
    since: isRebuild ? '2y' : '24h',
    mode: isRebuild ? 'rebuild' : 'live',
    limit: 30,
    place,
  };

  const sources = {};
  for (const p of SOURCE_PLATFORMS)
    sources[p] = { status: 'idle', count: 0, latencyMs: 0 };

  const abortPayload = (cacheHit = false) => ({
    items: [],
    sources,
    cacheHit,
    earliestUploadedAt: null,
    query,
    aborted: true,
  });

  if (signal?.aborted) return abortPayload();

  // 1. Cache check
  if (cache && !fixtures) {
    let allCached = true;
    const cachedByPlatform = {};
    for (const p of SOURCE_PLATFORMS) {
      if (enabled[p] === false) continue;
      const key = cache.keyFor({
        sceneId: scene?.id,
        platform: p,
        query: keywords,
        tRef: scene?.tRef,
      });
      const entry = cache.get(key);
      if (entry === null) {
        allCached = false;
        break;
      }
      cachedByPlatform[p] = entry;
    }

    if (allCached) {
      const replayedItems = [];
      for (const p of SOURCE_PLATFORMS) {
        if (enabled[p] === false) continue;
        const list = cachedByPlatform[p] || [];
        sources[p] = { status: 'ok', count: list.length, latencyMs: 0 };
        onSource?.(p, sources[p]);
        for (const it of list) {
          if (!signal?.aborted) {
            replayedItems.push(it);
            onItem?.(it);
          }
        }
      }
      if (signal?.aborted) return abortPayload(true);
      const sorted = ranker
        ? await ranker.rank(replayedItems, scene, nowMs)
        : replayedItems;
      onRanked?.(sorted);
      const summary = {
        items: sorted,
        sources,
        cacheHit: true,
        earliestUploadedAt: findEarliest(sorted),
        query,
      };
      onDone?.(summary);
      return summary;
    }
  }

  const collectedItems = [];

  // 2. Fixture replay path
  if (fixtures) {
    for (const s of fixtures.sources || [])
      onSource?.(platformFor(s.source), { status: 'pending' });

    for (const raw of fixtures.items || []) {
      if (signal?.aborted) break;
      const item = normaliseItem(
        { ...raw, published_at: expandPublishedAt(raw.published_at, nowMs) },
        { sceneId: scene?.id },
      );
      item.location = resolveLocation(item, scene);
      if (item.sceneId !== scene?.id || enabled[item.platform] === false)
        continue;
      collectedItems.push(item);
      onItem?.(item);
    }

    for (const s of fixtures.sources || []) {
      if (signal?.aborted) break;
      const p = platformFor(s.source);
      sources[p] = {
        status: statusFromSourceDone(s),
        count: s.count ?? 0,
        latencyMs: s.ms ?? 0,
      };
      if (enabled[p] !== false) onSource?.(p, sources[p]);
    }
  } else if (client) {
    // 3. Network streaming path — bounded and non-blocking: a slow or failed
    // source (Reddit 403, TikTok quota, X inactive, a 30 s web search) only
    // marks its sidebar state; the scene ranks whatever arrived.
    const streamAbort = new AbortController();
    const onOuterAbort = () => streamAbort.abort();
    signal?.addEventListener?.('abort', onOuterAbort, { once: true });
    const capTimer = setTimeout(() => streamAbort.abort(), streamCapMs);
    try {
      await client.stream(
        query,
        {
          onSourceStart: ({ source }) => {
            if (signal?.aborted) return;
            const p = platformFor(source);
            sources[p] = { ...sources[p], status: 'pending' };
            if (enabled[p] !== false) onSource?.(p, { status: 'pending' });
          },
          onItem: (raw) => {
            if (signal?.aborted) return;
            const item = normaliseItem(raw, { sceneId: scene?.id });
            item.location = resolveLocation(item, scene);
            if (item.sceneId !== scene?.id || enabled[item.platform] === false)
              return;
            collectedItems.push(item);
            onItem?.(item);
          },
          onSourceDone: (data) => {
            if (signal?.aborted) return;
            const p = platformFor(data?.source);
            sources[p] = {
              status: statusFromSourceDone(data),
              count: data?.count ?? 0,
              latencyMs: data?.ms ?? 0,
            };
            if (enabled[p] !== false) onSource?.(p, sources[p]);
          },
        },
        { signal: streamAbort.signal },
      );
    } catch (err) {
      for (const p of SOURCE_PLATFORMS)
        if (sources[p].status === 'pending' || sources[p].status === 'idle') {
          sources[p] = {
            ...sources[p],
            status: 'error',
            error: String(err?.message || err),
          };
          if (enabled[p] !== false) onSource?.(p, sources[p]);
        }
    } finally {
      clearTimeout(capTimer);
      signal?.removeEventListener?.('abort', onOuterAbort);
    }
    if (streamAbort.signal.aborted && !signal?.aborted)
      for (const p of SOURCE_PLATFORMS)
        if (sources[p].status === 'pending') {
          sources[p] = { ...sources[p], status: 'error', error: 'timeout' };
          if (enabled[p] !== false) onSource?.(p, sources[p]);
        }
  }

  if (signal?.aborted) return abortPayload();

  // 4. Ranking
  const sorted = ranker
    ? await ranker.rank(collectedItems, scene, nowMs)
    : collectedItems;
  onRanked?.(sorted);

  // 5. Caching per platform
  if (cache) {
    const byPlatform = {};
    for (const p of SOURCE_PLATFORMS) byPlatform[p] = [];
    for (const item of sorted) {
      if (byPlatform[item.platform]) byPlatform[item.platform].push(item);
    }
    const recency = isRebuild ? 'ARCHIVE' : 'RECENT';
    for (const p of SOURCE_PLATFORMS) {
      const key = cache.keyFor({
        sceneId: scene?.id,
        platform: p,
        query: keywords,
        tRef: scene?.tRef,
      });
      cache.set(key, byPlatform[p], recency);
    }
  }

  const summary = {
    items: sorted,
    sources,
    cacheHit: false,
    earliestUploadedAt: findEarliest(sorted),
    query,
  };
  onDone?.(summary);
  return summary;
}
