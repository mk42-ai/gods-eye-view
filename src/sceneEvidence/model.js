import { validPoint, qualifyRecording, resolveEvidenceWindow, EVIDENCE_POLICY_VERSION } from './qualification.js';
/**
 * Scene evidence — pure core shared by the server pipeline
 * (server/scene-evidence/*) and the browser panel (src/sceneEvidence/panel.js).
 *
 * No DOM, no fetch, no Cesium. Deterministic given `now` → unit-testable.
 *
 * EvidenceItem {
 *   id, kind: 'video'|'post', platform: 'youtube'|'tiktok'|'instagram'|'x',
 *   url (original public post), embedUrl (official player/embed URL or null),
 *   title, author: {name, handle, url, avatar, bio, followers, fields:[...], source},
 *   publishedAt (ISO|null), dateSource: 'api'|'id-derived'|'search-reported'|null,
 *   freshness: 'LIVE'|'RECENT'|'STALE'|'ARCHIVAL', ageHours, undated,
 *   geo: {precision: 'exact'|'place'|'text'|'none', lat, lon, label, confidence, basis},
 *   inWindow, rank, source: {id, name, via, query, at}, cachePolicy
 * }
 * Signal { id, kind: 'news'|'incident'|'official', title, url, outlet,
 *          publishedAt, freshness, geo, source }
 */

export const FRESHNESS = Object.freeze(['LIVE', 'RECENT', 'STALE', 'ARCHIVAL']);
/** LIVE < 1 h · RECENT < 72 h · STALE < 30 d · ARCHIVAL ≥ 30 d or undated. */
export const FRESHNESS_HOURS = Object.freeze({
  LIVE: 1,
  RECENT: 72,
  STALE: 720,
});
export const GEO_PRECISION = Object.freeze(['exact', 'place', 'text', 'none']);
export const GEO_LABEL = Object.freeze({
  exact: 'EXACT GEOTAG',
  place: 'PLACE TAG',
  text: 'TEXT-INFERRED',
  none: 'NO LOCATION',
});
/** Confidence that the item was recorded at the shown location. */
export const GEO_CONFIDENCE = Object.freeze({
  exact: 0.95,
  place: 0.7,
  text: 0.4,
  none: 0.1,
});
export const DATE_CONFIDENCE = Object.freeze({
  api: 0.95,
  'id-derived': 0.9,
  'search-reported': 0.6,
});
const P_RANK = { exact: 3, place: 2, text: 1, none: 0 };
const F_RANK = { LIVE: 3, RECENT: 2, STALE: 1, ARCHIVAL: 0 };
const HOUR = 3_600_000;

export function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Freshness class of a timestamp relative to `now` (exclusive bounds). */
export function classifyFreshness(publishedAt, now = new Date()) {
  const iso = toIso(publishedAt);
  if (!iso) return { freshness: 'ARCHIVAL', ageHours: null, undated: true };
  const age = (new Date(now).getTime() - new Date(iso).getTime()) / HOUR;
  // Future timestamps (> 1 h ahead) are bad metadata: never fresh.
  if (age < -1) return { freshness: 'ARCHIVAL', ageHours: null, undated: true };
  const a = Math.max(0, age);
  const freshness =
    a < FRESHNESS_HOURS.LIVE
      ? 'LIVE'
      : a < FRESHNESS_HOURS.RECENT
        ? 'RECENT'
        : a < FRESHNESS_HOURS.STALE
          ? 'STALE'
          : 'ARCHIVAL';
  return { freshness, ageHours: Math.round(a * 100) / 100, undated: false };
}

// ------------------------------------------------------------ id-derived dates
const IG_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function sane(ms) {
  return Number.isFinite(ms) &&
    ms > Date.UTC(2010, 0, 1) &&
    ms < Date.UTC(2100, 0, 1)
    ? new Date(ms).toISOString()
    : null;
}
/** TikTok video ids: top 32 bits are Unix seconds of upload. */
export function tiktokIdDate(id) {
  try {
    return sane(Number(BigInt(String(id)) >> 32n) * 1000);
  } catch {
    return null;
  }
}
/** X/Twitter snowflake: (id >> 22) + 1288834974657 ms. */
export function xIdDate(id) {
  try {
    return sane(Number((BigInt(String(id)) >> 22n) + 1288834974657n));
  } catch {
    return null;
  }
}
/** Instagram shortcode → media id → (id >> 23) + 1314220021721 ms. */
export function instagramShortcodeDate(code) {
  const s = String(code || '');
  if (!/^[A-Za-z0-9_-]{6,14}$/.test(s)) return null;
  try {
    let id = 0n;
    for (const ch of s) id = id * 64n + BigInt(IG_ALPHABET.indexOf(ch));
    return sane(Number(id >> 23n) + 1314220021721);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ URL parsing
const YT_RE =
  /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const TT_RE =
  /tiktok\.com\/(?:@([\w.-]+)\/video\/|player\/v1\/|embed\/v2\/)(\d{15,21})/;
const IG_RE =
  /instagram\.com\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})/;
const X_RE =
  /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{6,25})/;

/** Identify the platform post behind a public URL; null when not a post. */
export function parsePostUrl(url) {
  const s = String(url || '');
  let host;
  try { const u = new URL(s); if (u.protocol !== 'https:' || u.username || u.password || u.port) return null; host = u.hostname.toLowerCase(); } catch { return null; }
  let m = s.match(YT_RE);
  if (m && ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host))
    return {
      platform: 'youtube',
      id: m[1],
      url: `https://www.youtube.com/watch?v=${m[1]}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&mute=1&playsinline=1&rel=0&enablejsapi=1`,
      kind: 'video',
      idDate: null,
    };
  m = s.match(TT_RE);
  if (m && ['tiktok.com', 'www.tiktok.com'].includes(host))
    return {
      platform: 'tiktok',
      id: m[2],
      handle: m[1] || null,
      url: m[1]
        ? `https://www.tiktok.com/@${m[1]}/video/${m[2]}`
        : `https://www.tiktok.com/video/${m[2]}`,
      embedUrl: `https://www.tiktok.com/player/v1/${m[2]}?autoplay=1&muted=1&description=1`,
      kind: 'video',
      idDate: tiktokIdDate(m[2]),
    };
  m = s.match(IG_RE);
  if (m && ['instagram.com', 'www.instagram.com'].includes(host)) {
    const type = m[1] === 'reels' ? 'reel' : m[1];
    return {
      platform: 'instagram',
      id: m[2],
      url: `https://www.instagram.com/${type}/${m[2]}/`,
      embedUrl: `https://www.instagram.com/${type === 'tv' ? 'p' : type}/${m[2]}/embed/`,
      kind: type === 'p' ? 'post' : 'video',
      idDate: instagramShortcodeDate(m[2]),
    };
  }
  m = s.match(X_RE);
  if (m && ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(host))
    return {
      platform: 'x',
      id: m[2],
      handle: m[1],
      url: `https://x.com/${m[1]}/status/${m[2]}`,
      embedUrl: `https://platform.twitter.com/embed/Tweet.html?id=${m[2]}&dnt=true&theme=dark`,
      kind: 'post',
      idDate: xIdDate(m[2]),
    };
  return null;
}

// ------------------------------------------------------------ geo precision
export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
/** Does the text name the place (or one of its aliases)? */
export function mentionsPlace(text, place, aliases = []) {
  const hay = ` ${normalizeText(text)} `;
  return [place, ...aliases]
    .map(normalizeText)
    .filter((p) => p.length >= 3)
    .some((p) => hay.includes(` ${p} `));
}

/**
 * Score geo precision from what the SOURCE returned. Never upgrades:
 *  exact  — the API returned coordinates for the post (geotag)
 *  place  — the API returned a named place tag (no coordinates of the post)
 *  text   — only the title/caption/snippet names the AOI place
 *  none   — nothing ties the post to the AOI
 * Coordinates shown for place/text are the AOI anchor, flagged approximate.
 */
export function scoreGeo({
  coords,
  placeTag,
  text,
  place,
  aliases,
  anchor,
} = {}) {
  if (coords && validPoint(coords.lat, coords.lon))
    return {
      precision: 'exact',
      lat: coords.lat,
      lon: coords.lon,
      approximate: false,
      label: GEO_LABEL.exact,
      confidence: GEO_CONFIDENCE.exact,
      basis: 'coordinates returned by the platform API',
    };
  // An AOI/search centroid is never the recording location of a post.
  void anchor;
  if (placeTag)
    return {
      precision: 'place',
      lat: null,
      lon: null,
      approximate: true,
      label: GEO_LABEL.place,
      confidence: GEO_CONFIDENCE.place,
      basis: `place tag "${String(placeTag.name || '').slice(0, 80)}" (not the post's coordinates)`,
    };
  if (place && mentionsPlace(text, place, aliases))
    return {
      precision: 'text',
      lat: null,
      lon: null,
      approximate: true,
      label: GEO_LABEL.text,
      confidence: GEO_CONFIDENCE.text,
      basis: `"${String(place).slice(0, 60)}" appears in text; recording location is unknown (not pinned)`,
    };
  return {
    precision: 'none',
    lat: null,
    lon: null,
    approximate: true,
    label: GEO_LABEL.none,
    confidence: GEO_CONFIDENCE.none,
    basis: 'no location in the returned metadata',
  };
}

// ------------------------------------------------------------ build items
function clip(v, max = 300) {
  return String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
function safeHttpUrl(v) {
  try {
    const u = new URL(String(v));
    return u.protocol === 'https:' || u.protocol === 'http:'
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}

/** Public profile fields only — exactly what an official API/oEmbed returned. */
export function publicProfile(raw = {}, source = '') {
  const out = { source: clip(source, 60), fields: [] };
  const put = (k, v) => {
    if (v === null || v === undefined || v === '') return;
    out[k] = v;
    out.fields.push(k);
  };
  put('name', raw.name ? clip(raw.name, 80) : null);
  put(
    'handle',
    raw.handle ? clip(String(raw.handle).replace(/^@/, ''), 40) : null,
  );
  put('url', safeHttpUrl(raw.url));
  put('avatar', safeHttpUrl(raw.avatar));
  put('bio', raw.bio ? clip(raw.bio, 280) : null);
  put(
    'followers',
    Number.isFinite(Number(raw.followers)) &&
      raw.followers !== null &&
      raw.followers !== ''
      ? Number(raw.followers)
      : null,
  );
  put('verified', typeof raw.verified === 'boolean' ? raw.verified : null);
  return out;
}

/**
 * Normalise one raw hit into an EvidenceItem. Returns null when the URL is
 * not a recognised public post.
 */
export function buildEvidenceItem(raw, ctx = {}) {
  const parsed = parsePostUrl(raw?.url);
  if (!parsed) return null;
  const now = ctx.now || new Date();
  const qualification = qualifyRecording(raw, { ...ctx, window: ctx.window || resolveEvidenceWindow(ctx, now), now });
  const sourceBacked = raw.evidence?.kind === 'provider-record' && raw.evidence?.verified === true;
  const publishedAt = sourceBacked ? toIso(raw.publishedAt) : null;
  const dateSource = publishedAt ? 'api' : null;
  const geo = scoreGeo({
    coords: sourceBacked && qualification.measurement?.precision === 'exact'
      ? { lat: qualification.measurement.lat, lon: qualification.measurement.lon } : null,
    placeTag: sourceBacked ? raw.placeTag : null,
    text: `${raw.title || ''} ${raw.snippet || ''}`,
    place: ctx.place, aliases: ctx.aliases,
  });
  return {
    id: `${parsed.platform}:${parsed.id}`,
    kind: sourceBacked && raw.mediaType === 'video' ? 'video' : parsed.kind,
    mediaType: sourceBacked ? raw.mediaType || 'unknown' : 'unverified',
    platform: parsed.platform, url: parsed.url,
    embedUrl: qualification.eligible ? parsed.embedUrl : null,
    title: clip(raw.title || raw.snippet || parsed.url, 220),
    snippet: clip(raw.snippet, 280),
    author: publicProfile(sourceBacked ? raw.author || {} : {}, sourceBacked ? raw.author?.source || raw.authorSource || '' : ''),
    publishedAt, dateSource, dateConfidence: sourceBacked && publishedAt ? 1 : 0,
    recordedAt: qualification.recordedAt,
    retrievedAt: toIso(now),
    recordingTimeSource: qualification.recordingTimeSource,
    recordingTimePrecision: qualification.recordingTimePrecision,
    publicationClaim: sourceBacked ? null : toIso(raw.publishedAt),
    freshness: qualification.freshness,
    ageHours: qualification.recordedAt ? Math.max(0, (new Date(now) - Date.parse(qualification.recordedAt)) / 3600000) : null,
    undated: !qualification.recordedAt,
    inWindow: qualification.eligible,
    eligible: qualification.eligible, qualification,
    mediaLocation: sourceBacked ? raw.mediaLocation || null : null,
    distanceKm: qualification.measurement?.distanceKm ?? null,
    distanceMethod: qualification.measurement?.method ?? null,
    geo,
    source: {
      id: clip(raw.sourceId, 60), name: clip(raw.sourceName, 90), via: clip(raw.via, 120),
      query: clip(raw.query, 240), at: toIso(now),
      verified: sourceBacked, verification: sourceBacked ? 'provider-record' : 'discovery-only',
    },
    provenance: { kind: sourceBacked ? 'provider-record' : 'mediated-discovery-answer', policy: EVIDENCE_POLICY_VERSION, pluginId: clip(raw.pluginId, 80), operation: clip(raw.operation, 80) },
    cachePolicy: parsed.platform === 'instagram' ? 'ids-only' : 'full',
  };
}

/** Rank key: geo precision first, then freshness, then recency. */
export function compareEvidence(a, b) {
  return (
    P_RANK[b.geo?.precision || 'none'] - P_RANK[a.geo?.precision || 'none'] ||
    (F_RANK[b.freshness] || 0) - (F_RANK[a.freshness] || 0) ||
    (Date.parse(b.publishedAt || 0) || 0) -
      (Date.parse(a.publishedAt || 0) || 0) ||
    String(a.id).localeCompare(String(b.id))
  );
}
export function rankEvidence(items) {
  return [...items]
    .sort(compareEvidence)
    .map((it, i) => ({ ...it, rank: i + 1 }));
}

function titleTokens(t) {
  return new Set(
    normalizeText(t)
      .split(' ')
      .filter((w) => w.length > 2),
  );
}
/** Jaccard similarity of two titles' token sets. */
export function titleSimilarity(a, b) {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/**
 * Deterministic dedupe: same platform post id merges (keeping the richer
 * record: better geo, then dated), and near-identical titles from the same
 * author on the same platform collapse (reposts).
 */
export function dedupeEvidence(items) {
  const byId = new Map();
  const score = (x) =>
    P_RANK[x.geo?.precision || 'none'] * 10 +
    (x.publishedAt ? 2 : 0) +
    (x.author?.fields?.length || 0) / 10;
  for (const it of items) {
    if (!it) continue;
    const prev = byId.get(it.id);
    if (!prev || score(it) > score(prev))
      byId.set(
        it.id,
        prev
          ? {
              ...it,
              mergedFrom: [...(prev.mergedFrom || []), prev.source?.id].filter(
                Boolean,
              ),
            }
          : it,
      );
  }
  const out = [];
  for (const it of byId.values()) {
    const dup = out.find(
      (o) =>
        o.platform === it.platform &&
        o.author?.handle &&
        o.author.handle === it.author?.handle &&
        titleSimilarity(o.title, it.title) >= 0.8,
    );
    if (dup) dup.duplicates = [...(dup.duplicates || []), it.id];
    else out.push(it);
  }
  return out;
}

/** Filter by geo precisions and freshness classes (empty set = all). */
export function filterEvidence(
  items,
  { precisions = [], freshness = [] } = {},
) {
  const P = new Set(precisions);
  const F = new Set(freshness);
  return items.filter(
    (it) =>
      (!P.size || P.has(it.geo?.precision)) && (!F.size || F.has(it.freshness)),
  );
}

/** Re-derive freshness against a new `now` (cached scenes age honestly). */
export function refreshFreshness(items, now = new Date(), request = {}) {
  const window = resolveEvidenceWindow(request, now);
  return items.map((it) => {
    if (!it.qualification) return { ...it, ...classifyFreshness(it.publishedAt, now) };
    // A cache cannot extend an old recording's eligibility or establish live status.
    const time = Date.parse(it.recordedAt || '');
    const eligible = it.eligible === true && Number.isFinite(time) && time >= Date.parse(window.startUtc) && time < Date.parse(window.endUtc);
    return { ...it, eligible, inWindow: eligible, embedUrl: eligible ? it.embedUrl : null,
      freshness: eligible ? (window.mode === 'historical' ? 'HISTORICAL' : 'RECENT') : 'UNVERIFIED',
      qualification: { ...it.qualification, eligible, window, reasons: eligible ? [] : [...new Set([...it.qualification.reasons, 'cache_requires_revalidation'])] } };
  });
}

/**
 * Strip fields a platform's terms forbid us to persist. Meta's oEmbed terms
 * prohibit persisting Instagram metadata, so only the id/permalink/derived
 * timestamp/geo label survive in caches.
 */
export function sanitizeForCache(item) {
  if (item.cachePolicy !== 'ids-only') return item;
  return {
    ...item,
    title:
      'Instagram post (metadata not cached per Meta oEmbed terms — open the embed to view)',
    snippet: '',
    thumbnail: null,
    author: { source: item.author?.source || '', fields: [] },
  };
}

/** Diff a fresh result set against a cached one. */
export function diffEvidence(prev = [], next = []) {
  const P = new Map(prev.map((x) => [x.id, x]));
  const N = new Map(next.map((x) => [x.id, x]));
  const added = next.filter((x) => !P.has(x.id)).map((x) => x.id);
  const removed = prev.filter((x) => !N.has(x.id)).map((x) => x.id);
  const changed = [];
  for (const [id, n] of N) {
    const p = P.get(id);
    if (!p) continue;
    const fields = ['freshness', 'publishedAt'].filter((k) => p[k] !== n[k]);
    if (p.geo?.precision !== n.geo?.precision) fields.push('geo');
    if (fields.length) changed.push({ id, fields });
  }
  return {
    added,
    removed,
    changed,
    unchanged: next.length - added.length - changed.length,
  };
}

/** Stable cache key for a scene evidence request. */
export function evidenceKey({
  sceneId,
  place,
  lat,
  lon,
  radiusKm = 5,
  windowHours = 1, text, timeMode = 'recent', windowStart, windowEnd,
} = {}) {
  const loc =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? `${lat.toFixed(3)},${lon.toFixed(3)}`
      : 'nolatlon';
  const base = sceneId
    ? `scene:${sceneId}`
    : `place:${normalizeText(place).replace(/ /g, '-').slice(0, 60)}`;
  const scope = `${timeMode}|${windowStart || ''}|${windowEnd || ''}`;
  const query = normalizeText(text || place || '').replace(/ /g, '-').slice(0, 160);
  return `${base}|${loc}|r${radiusKm}|w${windowHours}|q:${query}|${scope}|${EVIDENCE_POLICY_VERSION}`;
}

/** Normalise a news/incident signal. */
export function buildSignal(raw, ctx = {}) {
  const url = safeHttpUrl(raw?.url);
  const title = clip(raw?.title, 220);
  if (!url || !title) return null;
  const publishedAt = toIso(raw.publishedAt);
  const f = classifyFreshness(publishedAt, ctx.now || new Date());
  const geo = scoreGeo({
    text: `${title} ${raw.snippet || ''}`,
    place: ctx.place,
    aliases: ctx.aliases,
    anchor: ctx.anchor,
  });
  return {
    id: `sig:${normalizeText(url).slice(-80)}`,
    kind: raw.kind || 'news',
    title,
    url,
    outlet: clip(raw.outlet, 80),
    publishedAt,
    freshness: 'CONTEXT',
    publicationFreshness: f.freshness,
    verified: raw.sourceVerified === true,
    ageHours: f.ageHours,
    geo: {
      precision: geo.precision,
      label: geo.label,
      confidence: geo.confidence,
    },
    source: {
      id: clip(raw.sourceId, 40),
      name: clip(raw.sourceName, 80),
      at: toIso(ctx.now) || null,
    },
  };
}

/** Deterministic evidence summary (the no-LLM fallback). */
export function deterministicSummary({ place, items = [], candidates = [], signals = [], sources = [] } = {}) {
  const eligible = items.filter((x) => x.eligible === true).length;
  const blocked = sources.filter((s) => !['ok', 'empty', 'running'].includes(s.state)).length;
  const lines = [
    `${eligible} source-verified video(s) for ${place || 'the AOI'}; ${candidates.length} unverified candidate(s) kept separately.`,
    eligible ? 'Only footage with source-backed recording location and time is admitted.' : 'No verified recent footage. Publication, retrieval, captions and model answers do not prove recording place or time.',
    `${signals.length} unverified context reference(s); ${blocked} unavailable/restricted source(s). No conclusion about whether an incident occurred.`,
  ];
  return { text: lines.join(' '), engine: 'deterministic-policy', lines };
}
