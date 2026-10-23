/**
 * @fileoverview Formatting utilities for footage rail cards.
 * @module gods-eye/ui/scene/railFormat
 */

/**
 * Format distance string per spec: '0.8 km from target' / '320 m from target' / '— km'
 * @param {number|null|undefined} km
 * @returns {string}
 */
export function formatDistanceText(km) {
  if (km == null || Number.isNaN(Number(km))) return '— km';
  const val = Number(km);
  if (val < 1) {
    return `${Math.round(val * 1000)} m from target`;
  }
  return `${val.toFixed(1)} km from target`;
}

/**
 * Format delta string per spec: '+14 min after incident' / 'posted 2 h ago'
 * @param {number|null|undefined} timeDelta
 * @param {string} [sceneKind]
 * @param {string} [uploadedAt]
 * @returns {string}
 */
export function formatDeltaText(
  timeDelta,
  sceneKind = 'live',
  uploadedAt = null,
) {
  let seconds = timeDelta;
  if (seconds == null && uploadedAt) {
    const parsed = Date.parse(uploadedAt);
    if (Number.isFinite(parsed)) {
      seconds = Math.round((Date.now() - parsed) / 1000);
    }
  }
  if (seconds == null || Number.isNaN(Number(seconds))) return '—';

  const absSec = Math.abs(seconds);
  const mins = Math.round(absSec / 60);
  const hours = Math.round(absSec / 3600);
  const days = Math.round(absSec / 86400);

  let durationText = `${mins} min`;
  if (absSec >= 86400 * 1.5) {
    durationText = `${days} d`;
  } else if (absSec >= 3600) {
    durationText = `${hours} h`;
  }

  if (sceneKind === 'incident' || sceneKind === 'rebuild') {
    if (seconds === 0) return 'at incident time';
    return seconds > 0
      ? `+${durationText} after incident`
      : `-${durationText} before incident`;
  }

  return `posted ${durationText} ago`;
}
