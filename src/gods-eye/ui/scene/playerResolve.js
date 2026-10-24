/**
 * @fileoverview Resolvers for media URLs and embed kinds.
 * @module gods-eye/ui/scene/playerResolve
 */

/**
 * Extracts YouTube video ID from various URL patterns.
 * @param {string} url
 * @returns {string|null}
 */
export function extractYoutubeId(url) {
  if (!url) return null;
  const m = String(url).match(
    /(?:shorts\/|embed\/|watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  return m ? m[1] : null;
}

/**
 * Extracts TikTok video ID from URL.
 * @param {string} url
 * @returns {string|null}
 */
export function extractTiktokId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:video\/|v2\/|embed\/v2\/)(\d+)/);
  return m ? m[1] : null;
}

/**
 * Resolves playback kind and target URL for an item.
 * @param {any} item
 * @returns {{ kind: 'youtube'|'tiktok'|'video'|'embed'|'link', src?: string }}
 */
export function resolvePlayerKind(item) {
  if (!item) return { kind: 'link' };
  const url = String(item.url || '');
  const embed = String(item.embedUrl || item.embed_url || '');
  const media = String(item.mediaUrl || item.play_url || '');

  const ytId = extractYoutubeId(embed) || extractYoutubeId(url);
  if (ytId) {
    return {
      kind: 'youtube',
      src: `https://www.youtube.com/embed/${ytId}?autoplay=1&mute=1&playsinline=1&enablejsapi=1`,
    };
  }

  const ttId = extractTiktokId(embed) || extractTiktokId(url);
  if (ttId) {
    return {
      kind: 'tiktok',
      src: `https://www.tiktok.com/embed/v2/${ttId}`,
    };
  }

  if (
    media &&
    (/\.(mp4|webm|m3u8)(\?|$)/i.test(media) ||
      /is\.gd|cdninstagram|fbcdn|\/o1\/v\//.test(media))
  ) {
    return { kind: 'video', src: media };
  }

  if (embed && (/instagram\.com/.test(embed) || /embed/.test(embed))) {
    return { kind: 'embed', src: embed };
  }

  return { kind: 'link' };
}
