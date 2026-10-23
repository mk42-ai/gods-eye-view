/**
 * @fileoverview Designed state posters — the ONE place that knows where the
 * poster artwork lives. Components (player, rail, register modal, scenes
 * panel) import `POSTERS` / `posterForState`; none of them carries a path.
 *
 * Artwork: `public/assets/states/state-*.png` (1280×720, monochrome
 * green/amber tactical HUD, no text). The same URLs are exported to CSS as
 * `--ge-poster-*` custom properties by `applyPosterTokens()` so stylesheets
 * can use them as backgrounds without a second copy of the paths.
 *
 * @module gods-eye/ui/scene/posters
 */

/** Base directory of the designed state posters (design token). */
export const POSTER_BASE = '/assets/states';

/**
 * Poster-state → artwork file (design tokens; see docs/gods-eye/DESIGN_TOKENS.md).
 * @type {Readonly<Record<string, string>>}
 */
export const POSTER_FILES = Object.freeze({
  idle: 'state-live-acquiring.png',
  loading: 'state-flyin-building.png',
  flying: 'state-flyin-building.png',
  fetching: 'state-live-acquiring.png',
  empty: 'state-no-footage.png',
  archive: 'state-archive-rebuild.png',
  quota: 'state-source-quota.png',
  error: 'state-source-inactive-error.png',
  routeFallback: 'state-route-fallback.png',
  outsideRegister: 'state-outside-aoi.png',
  recreateDiff: 'state-saved-recreate-diff.png',
});

/**
 * Resolved poster URL map.
 * @type {Readonly<Record<keyof typeof POSTER_FILES, string>>}
 */
export const POSTERS = Object.freeze(
  Object.fromEntries(
    Object.entries(POSTER_FILES).map(([k, f]) => [k, `${POSTER_BASE}/${f}`]),
  ),
);

/** Human labels shown under the poster (player label slot). */
export const POSTER_LABELS = Object.freeze({
  idle: 'AWAITING PROMPT',
  loading: 'BUILDING SCENE',
  flying: 'FLY-IN',
  fetching: 'ACQUIRING FOOTAGE',
  empty: 'NO FOOTAGE',
  archive: 'ARCHIVAL REBUILD',
  quota: 'SOURCE QUOTA',
  error: 'SOURCE ERROR',
  routeFallback: 'ROUTE: FALLBACK',
  outsideRegister: 'OUTSIDE REGISTER',
  recreateDiff: 'RECREATE · DIFF',
});

/**
 * Publish the poster URLs as CSS custom properties (`--ge-poster-<key>`,
 * camelCase → kebab-case) on the given root so stylesheets read the same
 * tokens. Safe to call repeatedly; no-op without a DOM.
 *
 * @param {HTMLElement|null|undefined} [root]
 * @returns {Record<string, string>} the properties that were set
 */
export function applyPosterTokens(root = globalThis.document?.documentElement) {
  const set = {};
  if (!root?.style?.setProperty) return set;
  for (const [key, url] of Object.entries(POSTERS)) {
    const prop = `--ge-poster-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    root.style.setProperty(prop, `url("${url}")`);
    set[prop] = url;
  }
  return set;
}

/**
 * Resolves the appropriate poster key for a given scene state and context flags.
 *
 * @param {import('../../scenes/models.js').Scene|null|undefined} scene
 * @param {object} [flags]
 * @param {boolean} [flags.routeFallback]
 * @param {boolean} [flags.outsideRegister]
 * @param {boolean} [flags.recreateDiff]
 * @returns {keyof typeof POSTERS}
 */
export function posterForState(scene, flags = {}) {
  const {
    routeFallback = false,
    outsideRegister = false,
    recreateDiff = false,
  } = flags || {};

  if (recreateDiff) return 'recreateDiff';
  if (outsideRegister) return 'outsideRegister';
  if (routeFallback || Boolean(scene?.route?.fallback)) return 'routeFallback';

  if (!scene || scene.status === 'idle') return 'idle';

  if (scene.status === 'error' || scene.error) {
    const errText =
      `${scene.error?.code || ''} ${scene.error?.message || ''}`.toLowerCase();
    if (errText.includes('quota')) return 'quota';
    return 'error';
  }

  // Quota check across sources if no footage resolved
  const sources = scene.sources
    ? Array.isArray(scene.sources)
      ? scene.sources
      : Object.values(scene.sources)
    : [];
  const hasQuota = sources.some((s) => s && s.status === 'quota');
  const clipCount = Array.isArray(scene.footage) ? scene.footage.length : 0;
  if (hasQuota && clipCount === 0) return 'quota';

  if (
    scene.status === 'parsing' ||
    scene.status === 'geocoded' ||
    scene.status === 'routing' ||
    scene.status === 'flying' ||
    scene.status === 'fetching'
  ) {
    return 'loading';
  }

  if (scene.kind === 'rebuild') return 'archive';

  if (clipCount === 0) return 'empty';

  return 'idle';
}
