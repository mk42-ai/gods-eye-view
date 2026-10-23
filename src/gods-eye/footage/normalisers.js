/**
 * Gods-Eye Footage Normalisers
 * Normalises raw social media and web items into standard FootageItem records.
 * Browser ES module — no Node builtins, no DOM access at import time.
 */

export const SOURCE_PLATFORMS = Object.freeze([
  'tiktok',
  'instagram',
  'youtube',
  'x',
  'reddit',
  'web',
]);

const PLATFORM_RULES = [
  [/^tiktok/i, 'tiktok'],
  [/^instagram/i, 'instagram'],
  [/^youtube/i, 'youtube'],
  [/^(?:x|twitter)/i, 'x'],
  [/^reddit/i, 'reddit'],
  [/^facebook/i, 'web'],
];

/**
 * Maps a raw backend or plugin source name to a canonical platform.
 * @param {string} source
 * @returns {'tiktok'|'instagram'|'youtube'|'x'|'reddit'|'web'}
 */
export function platformFor(source) {
  const s = String(source || '').trim();
  for (const [re, p] of PLATFORM_RULES) {
    if (re.test(s)) return p;
  }
  return 'web';
}

/**
 * Returns the SVG icon asset path for a canonical platform.
 */
export function platformIcon(platform) {
  return `/icons/platforms/${platformFor(platform)}.svg`;
}

/**
 * Normalises source done status into 'ok' | 'quota' | 'inactive' | 'error'.
 */
export function statusFromSourceDone({ status, error } = {}) {
  const s = String(status || '').toLowerCase();
  const e = String(error || '').toLowerCase();
  if (s.includes('quota') || e.includes('quota')) return 'quota';
  if (
    s === 'inactive' ||
    ((s === 'unavailable' || s === 'error' || !s) &&
      (e.includes('not subscribed') || e.includes('inactive')))
  ) {
    return 'inactive';
  }
  return s === 'ok' ? 'ok' : 'error';
}

/**
 * Deterministic string hash producing a short stable string.
 */
function shortHash(str) {
  let h1 = 0x811c9dc5,
    h2 = 0x27d4eb2f;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ ch, 0x5bd1e995);
  }
  return (
    (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36).padStart(6, '0')
  ).slice(0, 10);
}

/**
 * Extracts `#word` hashtags from caption or text.
 */
export function extractHashtags(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(/#[\p{L}\p{N}_]+/gu) || [];
  return Array.from(new Set(matches.map((m) => m.toLowerCase())));
}

/**
 * Creates a plain FootageItem object conforming to §1.
 */
export function createFootageItem(partial = {}) {
  const caption = String(partial.caption ?? partial.title ?? '');
  return {
    id: partial.id || '',
    sceneId: partial.sceneId || '',
    platform: partial.platform || 'web',
    mediaUrl: partial.mediaUrl ?? null,
    embedUrl: partial.embedUrl ?? null,
    thumbUrl: partial.thumbUrl ?? null,
    authorHandle: partial.authorHandle ?? '',
    authorAvatar: partial.authorAvatar ?? null,
    caption,
    title: String(partial.title ?? caption),
    hashtags: Array.isArray(partial.hashtags) ? [...partial.hashtags] : [],
    uploadedAt: partial.uploadedAt || '',
    capturedAt: partial.capturedAt ?? null,
    location: partial.location
      ? { ...partial.location }
      : { lat: null, lon: null, confidence: 'unknown', basis: 'none' },
    distanceKm: partial.distanceKm ?? null,
    timeDelta: partial.timeDelta ?? null,
    recency: partial.recency || 'ARCHIVE',
    rankScore: partial.rankScore ?? 0,
    sourceUrl: partial.sourceUrl ?? '',
    relevance: partial.relevance ?? 0.5,
    pluginMeta: partial.pluginMeta
      ? { ...partial.pluginMeta }
      : { icon: '', rawPayloadRef: '' },
  };
}

export function normaliseYouTube(raw, base) {
  const item = { ...base };
  const rawUrl = raw.url || raw.source_url || '';
  const match = String(raw.embed_url || rawUrl).match(
    /(?:shorts\/|watch\?v=|embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  );
  if (match) {
    const videoId = match[1];
    item.embedUrl = raw.embed_url || `https://www.youtube.com/embed/${videoId}`;
    if (!item.thumbUrl)
      item.thumbUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }
  return item;
}

export function normaliseTikTok(raw, base) {
  const item = { ...base };
  const rawUrl = raw.url || raw.source_url || '';
  const match = String(raw.embed_url || rawUrl).match(
    /(?:\/video\/|\/embed\/v2\/|\/embed\/)(\d+)/,
  );
  if (match && !item.embedUrl) {
    item.embedUrl = `https://www.tiktok.com/embed/v2/${match[1]}`;
  }
  return item;
}

export function normaliseInstagram(raw, base) {
  const item = { ...base };
  const url = raw.url || raw.source_url || '';
  if (url && !item.embedUrl) {
    item.embedUrl = url.endsWith('/') ? `${url}embed/` : `${url}/embed/`;
  }
  return item;
}

export const normaliseX = (raw, base) => ({ ...base });
export const normaliseReddit = (raw, base) => ({ ...base });
export const normaliseWeb = (raw, base) => ({ ...base });

const TWEAKERS = {
  youtube: normaliseYouTube,
  tiktok: normaliseTikTok,
  instagram: normaliseInstagram,
  x: normaliseX,
  reddit: normaliseReddit,
  web: normaliseWeb,
};

/**
 * Normalises a raw backend/service item into a FootageItem per §1.
 */
export function normaliseItem(raw, { sceneId = '' } = {}) {
  if (!raw) return createFootageItem({ sceneId });
  const platform = platformFor(raw.source || raw.platform);
  const ref = raw.canonical || raw.url || raw.source_url || '';
  const id = shortHash(`${platform}:${ref}`);

  const rawLat =
    raw.lat !== null && raw.lat !== undefined ? Number(raw.lat) : null;
  const rawLon =
    raw.lon !== null && raw.lon !== undefined ? Number(raw.lon) : null;
  const hasGeotag = Number.isFinite(rawLat) && Number.isFinite(rawLon);

  const location = hasGeotag
    ? { lat: rawLat, lon: rawLon, confidence: 'exact', basis: 'geotag' }
    : { lat: null, lon: null, confidence: 'unknown', basis: 'none' };

  // News/web payloads sometimes carry a non-string title (null, number,
  // {text}); coerce before any string method runs.
  const textOf = (v) =>
    v && typeof v === 'object' ? String(v.text ?? v.title ?? '') : String(v ?? '');
  const caption = textOf(raw.caption) || textOf(raw.title) || '';
  raw = { ...raw, title: textOf(raw.title) || caption, caption };
  const extractedHashes = extractHashtags(caption);
  const rawHashtags = Array.isArray(raw.hashtags)
    ? raw.hashtags.map((h) =>
        String(h).startsWith('#')
          ? String(h).toLowerCase()
          : `#${String(h).toLowerCase()}`,
      )
    : [];
  const hashtags = Array.from(new Set([...extractedHashes, ...rawHashtags]));

  const base = createFootageItem({
    id,
    sceneId,
    platform,
    mediaUrl: raw.play_url || raw.media_url || null,
    embedUrl: raw.embed_url || null,
    thumbUrl: raw.thumb || raw.thumb_url || null,
    authorHandle: raw.author_handle || raw.author || '',
    authorAvatar: raw.author_avatar || null,
    caption,
    hashtags,
    uploadedAt: raw.published_at || '',
    capturedAt: raw.captured_at || null,
    location,
    distanceKm: null,
    timeDelta: null,
    recency: raw.freshness || 'ARCHIVE',
    rankScore:
      typeof raw.score === 'number'
        ? raw.score
        : typeof raw.relevance === 'number'
          ? raw.relevance
          : 0,
    sourceUrl: raw.url || raw.source_url || '',
    relevance: typeof raw.relevance === 'number' ? raw.relevance : 0.5,
    pluginMeta: { icon: platformIcon(platform), rawPayloadRef: ref },
  });

  const tweaker = TWEAKERS[platform] || normaliseWeb;
  return tweaker(raw, base);
}
