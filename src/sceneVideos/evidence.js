/**
 * Scene video evidence — the pure core shared by the server orchestrator
 * (server/scene-videos/*) and the browser player rail (src/sceneVideos/rail.js).
 *
 * No DOM, no Cesium, no fetch. Everything here is deterministic given `now`,
 * so ranking / tiering / labelling are unit-testable (evidence.test.mjs).
 *
 * VideoEvidence {
 *   id, platform: 'youtube'|'tiktok'|'instagram',
 *   sourceUrl, playableUrl, playableKind: 'mp4'|'iframe'|'link',
 *   title, caption, author,
 *   published_at (ISO|null), published_at_source, fetched_at (ISO),
 *   tier: 'LIVE'|'RECENT'|'ARCHIVAL', ageHours,
 *   captionStartOffset (seconds), captionOffsetSource,
 *   geo: {lat, lon, precision: 'reported'|'incident-anchor'|'unknown'},
 *   score, scoreParts {recency, geo, keyword},
 *   provenance: {pluginId, plugin, operation, query, timestamp, via}
 * }
 */

export const PLATFORMS = Object.freeze(['youtube', 'tiktok', 'instagram']);

/**
 * Tier thresholds (cycle 11, 2026-10-23). Footage is only LIVE when it is
 * provably fresh AND its source cross-matches a dated outlet record:
 *   LIVE     — platform create/upload time strictly under 6 h before the run
 *   RECENT   — strictly under 72 h
 *   ARCHIVAL — everything else: older, undated, future-dated, or unmatched.
 * The age tier alone never grants LIVE/RECENT (see labelEvidence()).
 */
export const TIER_THRESHOLDS_HOURS = Object.freeze({
  LIVE: 6,
  RECENT: 72,
});
export const TIERS = Object.freeze(['LIVE', 'RECENT', 'ARCHIVAL']);

const HOUR = 3_600_000;

function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * Age tier only: classify footage by its create/upload time relative to `now`.
 * Boundaries are exclusive ("under 6 h", "under 72 h").
 */
export function tierFor(publishedAt, now = new Date()) {
  const iso = toIso(publishedAt);
  if (!iso) return { tier: 'ARCHIVAL', ageHours: null, undated: true };
  const ageHours = (new Date(now).getTime() - new Date(iso).getTime()) / HOUR;
  // A timestamp in the future is a bad clock or bad metadata: do not trust it.
  if (ageHours < -1) return { tier: 'ARCHIVAL', ageHours: null, undated: true };
  const age = Math.max(0, ageHours);
  if (age < TIER_THRESHOLDS_HOURS.LIVE)
    return { tier: 'LIVE', ageHours: age, undated: false };
  if (age < TIER_THRESHOLDS_HOURS.RECENT)
    return { tier: 'RECENT', ageHours: age, undated: false };
  return { tier: 'ARCHIVAL', ageHours: age, undated: false };
}

function normHandle(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[\s_.-]+/g, '');
}

/** Stable key for URL cross-matching (platform id for video URLs, else host+path). */
export function urlKey(url) {
  const parsed = parseVideoUrl(url);
  if (parsed) return `${parsed.platform}:${parsed.id}`;
  try {
    const u = new URL(String(url));
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Source handle of a clip: TikTok @author from the URL, else the plugin author. */
export function sourceHandleOf(clip) {
  const tt = String(clip?.sourceUrl || '').match(/tiktok\.com\/@([\w.-]+)\//);
  if (tt) return tt[1];
  return clip?.author ? String(clip.author) : null;
}

/**
 * Cross-match a clip against DATED outlet records
 * [{outlet, url, handles:[...], published_at}] (step-1 incident records).
 * Undated records never match.
 */
export function matchOutletRecord(clip, records = []) {
  const key = urlKey(clip?.sourceUrl);
  const handle = normHandle(sourceHandleOf(clip));
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || !toIso(r.published_at)) continue;
    if (key && r.url && urlKey(r.url) === key)
      return {
        matched: true,
        by: 'url',
        record: r.url,
        outlet: r.outlet || null,
        recordPublishedAt: toIso(r.published_at),
      };
    const handles = (r.handles || []).map(normHandle).filter(Boolean);
    if (handle && handles.includes(handle))
      return {
        matched: true,
        by: 'handle',
        record: r.url || null,
        outlet: r.outlet || null,
        handle: sourceHandleOf(clip),
        recordPublishedAt: toIso(r.published_at),
      };
  }
  return {
    matched: false,
    by: null,
    record: null,
    outlet: null,
    recordPublishedAt: null,
  };
}

/**
 * Final label = age tier AND outlet cross-match. LIVE/RECENT require both;
 * anything else is ARCHIVAL with an explicit reason.
 */
export function labelEvidence(
  clip,
  { now = new Date(), outletRecords = [] } = {},
) {
  const age = tierFor(clip?.published_at, now);
  const verification = matchOutletRecord(clip, outletRecords);
  let tier = age.tier;
  let reason;
  if (age.undated) {
    tier = 'ARCHIVAL';
    reason = 'missing or untrusted create/upload timestamp';
  } else if (age.tier === 'ARCHIVAL') {
    reason = `older than ${TIER_THRESHOLDS_HOURS.RECENT} h`;
  } else if (!verification.matched) {
    tier = 'ARCHIVAL';
    reason = `fresh (${age.tier} by age) but source does not cross-match a dated outlet record`;
  } else {
    reason = `${age.tier}: under ${TIER_THRESHOLDS_HOURS[age.tier]} h and matched by ${verification.by}`;
  }
  return {
    tier,
    ageTier: age.tier,
    ageHours: age.ageHours,
    undated: age.undated,
    verification,
    reason,
  };
}

// ---------------------------------------------------------------- URL parsing
const YT_RE =
  /(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const TT_RE =
  /tiktok\.com\/(?:@[\w.-]+\/video\/|player\/v1\/|embed\/v2\/|v\/)(\d{15,21})/;
const IG_RE =
  /instagram\.com\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})/;

/** Identify a platform + stable id from any URL a plugin returned. */
export function parseVideoUrl(url) {
  const s = String(url || '');
  let m = s.match(YT_RE);
  if (m)
    return {
      platform: 'youtube',
      id: m[1],
      isShort: /\/shorts\//.test(s),
      canonical: `https://www.youtube.com/watch?v=${m[1]}`,
    };
  m = s.match(TT_RE);
  if (m) {
    const author = (s.match(/tiktok\.com\/(@[\w.-]+)\//) || [])[1];
    return {
      platform: 'tiktok',
      id: m[1],
      canonical: author
        ? `https://www.tiktok.com/${author}/video/${m[1]}`
        : `https://www.tiktok.com/video/${m[1]}`,
    };
  }
  m = s.match(IG_RE);
  if (m)
    return {
      platform: 'instagram',
      id: m[1],
      canonical: `https://www.instagram.com/p/${m[1]}/`,
    };
  return null;
}

/**
 * TikTok video ids are snowflakes: the top 32 bits are the upload time in
 * Unix seconds. This lets us date a TikTok clip without another provider call.
 */
export function tiktokIdToDate(id) {
  try {
    const seconds = Number(BigInt(String(id)) >> 32n);
    if (!Number.isFinite(seconds) || seconds < 1.4e9 || seconds > 4e9)
      return null;
    return new Date(seconds * 1000).toISOString();
  } catch {
    return null;
  }
}

/**
 * Instagram CDN URLs carry a base64 `efg` blob with `asset_age_days` and
 * `duration_s` (what the download plugin returned for the Umm Suqeim reels).
 */
export function instagramCdnMeta(url) {
  const m = String(url || '').match(/[?&]efg=([^&]+)/);
  if (!m) return null;
  try {
    const b64 = decodeURIComponent(m[1]).replace(/-/g, '+').replace(/_/g, '/');
    const json =
      typeof atob === 'function'
        ? atob(b64)
        : Buffer.from(b64, 'base64').toString('utf8');
    const meta = JSON.parse(json);
    const oe = String(url).match(/[?&]oe=([0-9A-Fa-f]{8})/);
    return {
      assetAgeDays: Number.isFinite(Number(meta.asset_age_days))
        ? Number(meta.asset_age_days)
        : null,
      durationS: Number.isFinite(Number(meta.duration_s))
        ? Number(meta.duration_s)
        : null,
      expiresAt: oe ? new Date(parseInt(oe[1], 16) * 1000).toISOString() : null,
    };
  } catch {
    return null;
  }
}

/** Playable target per platform. Instagram: shortUrl first (plugin contract). */
export function playableFor(parsed, { shortUrl, mediaUrl } = {}) {
  if (!parsed) return { playableUrl: null, playableKind: 'link' };
  if (parsed.platform === 'instagram') {
    const direct = shortUrl || mediaUrl || null;
    return direct
      ? { playableUrl: direct, playableKind: 'mp4' }
      : { playableUrl: parsed.canonical, playableKind: 'link' };
  }
  if (parsed.platform === 'youtube')
    return {
      playableUrl: `https://www.youtube-nocookie.com/embed/${parsed.id}?autoplay=1&mute=1&playsinline=1&rel=0`,
      playableKind: 'iframe',
    };
  if (parsed.platform === 'tiktok')
    return {
      playableUrl: `https://www.tiktok.com/player/v1/${parsed.id}?autoplay=1&muted=1&loop=0&description=1`,
      playableKind: 'iframe',
    };
  return { playableUrl: null, playableKind: 'link' };
}

// ---------------------------------------------------------------- normalise
function clip(value, max = 500) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Normalise one raw plugin hit into VideoEvidence. Returns null when the URL
 * is not a recognised short-video URL.
 */
export function normalizeEvidence(
  raw,
  { now = new Date(), anchor = null, outletRecords = [] } = {},
) {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = parseVideoUrl(raw.sourceUrl || raw.url);
  if (!parsed) return null;
  const fetched_at = toIso(raw.fetched_at) || new Date(now).toISOString();
  let published_at = toIso(raw.published_at || raw.published);
  let published_at_source = published_at
    ? raw.published_at_source || 'plugin'
    : null;
  if (!published_at && parsed.platform === 'tiktok') {
    published_at = tiktokIdToDate(parsed.id);
    if (published_at) published_at_source = 'tiktok-id-snowflake';
  }
  const igMeta =
    parsed.platform === 'instagram' ? instagramCdnMeta(raw.mediaUrl) : null;
  if (
    !published_at &&
    igMeta?.assetAgeDays !== null &&
    igMeta?.assetAgeDays !== undefined
  ) {
    published_at = new Date(
      new Date(fetched_at).getTime() - igMeta.assetAgeDays * 24 * HOUR,
    ).toISOString();
    published_at_source = 'instagram-asset-age-days';
  }
  const { playableUrl, playableKind } = playableFor(parsed, raw);
  const labelled = labelEvidence(
    { published_at, sourceUrl: parsed.canonical, author: raw.author },
    { now, outletRecords },
  );
  const { tier, ageHours, undated } = labelled;
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  const geo =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? { lat, lon, precision: 'reported' }
      : anchor
        ? { lat: anchor.lat, lon: anchor.lon, precision: 'incident-anchor' }
        : { lat: null, lon: null, precision: 'unknown' };
  const offset = Number(raw.captionStartOffset);
  return {
    id: `${parsed.platform}:${parsed.id}`,
    platform: parsed.platform,
    platformId: parsed.id,
    isShort: Boolean(parsed.isShort),
    sourceUrl: parsed.canonical,
    playableUrl,
    playableKind,
    title: clip(raw.title, 300),
    caption: clip(raw.caption || raw.snippet, 800),
    author: clip(raw.author, 120),
    durationS: igMeta?.durationS ?? (Number(raw.durationS) || null),
    mediaExpiresAt: igMeta?.expiresAt || null,
    published_at,
    published_at_source,
    undated,
    fetched_at,
    tier,
    ageTier: labelled.ageTier,
    tierReason: labelled.reason,
    verification: labelled.verification,
    sourceHandle: sourceHandleOf({
      sourceUrl: parsed.canonical,
      author: raw.author,
    }),
    ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
    captionStartOffset: Number.isFinite(offset) && offset > 0 ? offset : 0,
    captionOffsetSource:
      Number.isFinite(offset) && offset > 0
        ? raw.captionOffsetSource || 'plugin'
        : 'none',
    geo,
    provenance: {
      pluginId: raw.provenance?.pluginId || null,
      plugin: raw.provenance?.plugin || null,
      operation: raw.provenance?.operation || null,
      query: clip(raw.provenance?.query, 400),
      timestamp: toIso(raw.provenance?.timestamp) || fetched_at,
      via: raw.provenance?.via || 'ondemand-plugin',
    },
  };
}

// ---------------------------------------------------------------- dedupe
/**
 * Dedupe by platform id; the copy with the richest playable target wins
 * (mp4 > iframe > link), then the one with a known date, then provenance
 * from a direct platform plugin over a search plugin.
 */
export function dedupeEvidence(list) {
  const rank = (e) =>
    (e.playableKind === 'mp4' ? 4 : e.playableKind === 'iframe' ? 2 : 0) +
    (e.undated ? 0 : 1) +
    (e.provenance?.via === 'platform-plugin' ? 0.5 : 0);
  const byId = new Map();
  for (const e of list) {
    if (!e) continue;
    const prev = byId.get(e.id);
    if (!prev || rank(e) > rank(prev)) {
      // keep the longer caption / title if the winner lacks one
      byId.set(e.id, {
        ...e,
        title: e.title || prev?.title || '',
        caption: e.caption || prev?.caption || '',
      });
    } else if (prev && !prev.caption && e.caption) {
      byId.set(e.id, { ...prev, caption: e.caption });
    }
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------- ranking
function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const INCIDENT_WORDS =
  /(crash|accident|collision|collid|pile-?up|wreck|veer|injur|حادث|تصادم|اصطدام|fire|حريق|explosion|انفجار)/i;
/** "Dubai real-estate crash", villa tours, drama channels — not incident footage. */
const OFF_TOPIC =
  /(real estate|property|properties|villa|apartment|market crash|stock|price|mortgage|drama|episode|trailer|tour\b|عقار)/i;

function normText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u064B-\u0652]/g, '') // Arabic diacritics
    .replace(/[أإآ]/g, 'ا');
}

/**
 * Score = (0.45·recency + 0.35·geo + 0.20·keyword) × offTopicPenalty (each 0..1).
 *   recency: max(exp(-ageDays / 30), exp(-|published − incidentTime| / 3 d));
 *            undated → 0.05 (a clip posted the day of the incident ranks as
 *            "recent to the event" even when the event itself is weeks old)
 *   geo:     reported coords inside bbox → 1, ≤25 km of anchor → 0.8;
 *            text names a scene place → 0.9; names the city/emirate → 0.5;
 *            otherwise 0.1
 *   keyword: share of EN+AR keywords present in title+caption (capped at 1)
 */
export function scoreEvidence(e, plan = {}, { now = new Date() } = {}) {
  const ageDays =
    e.published_at && !e.undated
      ? Math.max(0, (new Date(now) - new Date(e.published_at)) / (24 * HOUR))
      : null;
  let recency = ageDays === null ? 0.05 : Math.exp(-ageDays / 30);
  if (ageDays !== null && plan.incidentTime) {
    const gapDays =
      Math.abs(new Date(e.published_at) - new Date(plan.incidentTime)) /
      (24 * HOUR);
    if (Number.isFinite(gapDays))
      recency = Math.max(recency, Math.exp(-gapDays / 3));
  }
  const text = normText(`${e.title} ${e.caption} ${e.author}`);
  let geo = 0.1;
  if (e.geo?.precision === 'reported' && plan.bbox) {
    const [w, s, east, n] = plan.bbox;
    if (e.geo.lon >= w && e.geo.lon <= east && e.geo.lat >= s && e.geo.lat <= n)
      geo = 1;
    else if (plan.anchor && haversineKm(e.geo, plan.anchor) <= 25) geo = 0.8;
  }
  const places = (plan.places || []).map(normText).filter(Boolean);
  if (geo < 0.9 && places.some((p) => p.length >= 3 && text.includes(p)))
    geo = 0.9;
  const regions = (plan.regions || []).map(normText).filter(Boolean);
  if (geo < 0.5 && regions.some((r) => r.length >= 3 && text.includes(r)))
    geo = 0.5;
  const kws = [...(plan.keywordsEn || []), ...(plan.keywordsAr || [])]
    .map(normText)
    .filter((k) => k.length >= 2);
  const hits = kws.filter((k) => text.includes(k)).length;
  let keyword = kws.length ? Math.min(1, hits / Math.min(kws.length, 4)) : 0;
  // A place-name hit without the incident vocabulary is weak evidence.
  if (!INCIDENT_WORDS.test(text)) keyword *= 0.3;
  const offTopic = OFF_TOPIC.test(text);
  const score =
    (0.45 * recency + 0.35 * geo + 0.2 * keyword) * (offTopic ? 0.4 : 1);
  return {
    score: Math.round(score * 1000) / 1000,
    scoreParts: {
      recency: Math.round(recency * 1000) / 1000,
      geo,
      keyword: Math.round(keyword * 1000) / 1000,
      offTopic,
    },
  };
}

/** Score + sort (desc), stable on id for ties. Playable clips break ties first. */
export function rankEvidence(list, plan = {}, opts = {}) {
  return list
    .map((e) => ({ ...e, ...scoreEvidence(e, plan, opts) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.playableKind === 'mp4') - (a.playableKind === 'mp4') ||
        a.id.localeCompare(b.id),
    );
}

/** Per-platform counts for the done event / docs. */
export function countByPlatform(list) {
  const out = Object.fromEntries(PLATFORMS.map((p) => [p, 0]));
  for (const e of list) out[e.platform] = (out[e.platform] || 0) + 1;
  return out;
}
