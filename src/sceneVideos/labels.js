/**
 * Labels for scene video evidence — pure, shared by the rail and its tests.
 * Rule: footage is only ever called LIVE when tierFor() says so; any clip that
 * is undated or older than the RECENT window is ARCHIVAL, and an incident
 * rebuilt from older footage carries a persistent banner.
 */

export const TIER_BADGE = Object.freeze({
  LIVE: {
    text: 'LIVE',
    className: 'svr-badge--live',
    title: 'Uploaded under 6 h ago and cross-matched to a dated outlet record',
  },
  RECENT: {
    text: 'RECENT',
    className: 'svr-badge--recent',
    title:
      'Uploaded under 72 h ago and cross-matched to a dated outlet record — not live',
  },
  ARCHIVAL: {
    text: 'ARCHIVAL',
    className: 'svr-badge--archival',
    title:
      'Older than 72 h, undated, or not matched to a dated outlet record — not live',
  },
});

export const PLATFORM_LABEL = Object.freeze({
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
});
export const PLATFORM_SHORT = Object.freeze({
  youtube: 'YT',
  tiktok: 'TT',
  instagram: 'IG',
});

/** "26 Sep 2026" in UTC (stable across the test runner's timezone). */
export function formatDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const m = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ][d.getUTCMonth()];
  return `${String(d.getUTCDate()).padStart(2, '0')} ${m} ${d.getUTCFullYear()}`;
}

/** Per-clip badge + the date line shown under the title. */
export function clipLabel(clip) {
  const badge = TIER_BADGE[clip?.tier] || TIER_BADGE.ARCHIVAL;
  const day = formatDay(clip?.published_at);
  const approx =
    clip?.published_at_source && clip.published_at_source !== 'plugin'
      ? '≈'
      : '';
  const when = day ? `recorded ${approx}${day}` : 'recording date unknown';
  return {
    tier: TIER_BADGE[clip?.tier] ? clip.tier : 'ARCHIVAL',
    badge,
    platform: PLATFORM_LABEL[clip?.platform] || clip?.platform || 'video',
    dateLine: clip?.tier === 'LIVE' ? `LIVE · ${when}` : `${when} · not live`,
  };
}

/**
 * Banner shown when the scene is rebuilt from older footage. Returns null
 * when at least one LIVE clip exists and the incident itself is live.
 */
export function archivalBanner(incident, clips = []) {
  const anyLive = clips.some((c) => c.tier === 'LIVE');
  const rebuild = Boolean(incident?.rebuild) || (clips.length > 0 && !anyLive);
  if (!rebuild) return null;
  const recordedIso =
    incident?.reported_at ||
    clips
      .map((c) => c.published_at)
      .filter(Boolean)
      .sort()
      .at(-1) ||
    null;
  const day = formatDay(recordedIso);
  return {
    text: `REBUILT FROM ARCHIVAL FOOTAGE \u2013 recorded ${day || 'date unknown'}, not live`,
    recorded: recordedIso,
  };
}

/** Media proxy path for an mp4 clip (shortUrl preferred, then CDN URL). */
export function proxiedMediaSrc(clip, base = '/api/ondemand/v2/scene/media') {
  const target = clip?.playableKind === 'mp4' ? clip.playableUrl : null;
  return target ? `${base}?u=${encodeURIComponent(target)}` : null;
}

/** Iframe src with the caption start offset applied where the platform supports it. */
export function iframeSrc(clip) {
  if (clip?.playableKind !== 'iframe' || !clip.playableUrl) return null;
  const offset = Math.floor(Number(clip.captionStartOffset) || 0);
  if (clip.platform === 'youtube' && offset > 0)
    return `${clip.playableUrl}&start=${offset}`;
  return clip.playableUrl;
}

/** Object context for the per-clip OnDemand mini chat. */
export function clipChatContext(clip, incident) {
  return {
    objectType: 'newsArticle',
    objectId: clip.id,
    label: clip.title || `${PLATFORM_LABEL[clip.platform]} clip`,
    position:
      clip.geo && Number.isFinite(clip.geo.lat)
        ? { lat: clip.geo.lat, lon: clip.geo.lon }
        : null,
    timeWindow: clip.published_at
      ? { start: clip.published_at, end: clip.published_at }
      : null,
    fields: {
      platform: clip.platform,
      tier: clip.tier,
      published_at: clip.published_at,
      published_at_source: clip.published_at_source,
      fetched_at: clip.fetched_at,
      source_url: clip.sourceUrl,
      caption: clip.caption?.slice(0, 400),
      caption_start_offset_s: clip.captionStartOffset,
      geo_precision: clip.geo?.precision,
      incident: incident?.title || null,
      incident_reported_at: incident?.reported_at || null,
      label_rule: 'ARCHIVAL/RECENT footage must never be described as live',
    },
    sourceRefs: [
      { url: clip.sourceUrl, published_at: clip.published_at || null },
    ],
    provenance: `${clip.provenance?.plugin || 'OnDemand plugin'} (${clip.provenance?.pluginId || 'n/a'}) · ${clip.provenance?.operation || ''} · ${clip.provenance?.timestamp || ''}`,
  };
}
