/**
 * @fileoverview Evidence strip displaying status chips for footage platforms.
 * @module gods-eye/ui/scene/evidence
 */

export const DEFAULT_PLATFORMS = Object.freeze([
  'tiktok',
  'instagram',
  'youtube',
  'x',
  'reddit',
  'web',
]);

/**
 * Creates the evidence strip component.
 *
 * @param {object} params
 * @param {Document} params.document
 * @returns {{ element: HTMLElement, update: (scene: any) => void }}
 */
export function createEvidenceStrip({ document }) {
  const root = document.createElement('div');
  root.id = 'ge-evidence';
  root.className = 'ge-evidence';

  /**
   * Updates platform chips based on scene source statuses.
   * @param {any} scene
   */
  function update(scene) {
    root.innerHTML = '';
    if (!scene) return;

    let sourceMap = {};
    if (scene.sources) {
      if (Array.isArray(scene.sources)) {
        for (const s of scene.sources) {
          if (s?.source) sourceMap[s.source] = s;
        }
      } else if (typeof scene.sources === 'object') {
        sourceMap = scene.sources;
      }
    }

    const platforms =
      Object.keys(sourceMap).length > 0
        ? Array.from(new Set([...DEFAULT_PLATFORMS, ...Object.keys(sourceMap)]))
        : DEFAULT_PLATFORMS;

    for (const platform of platforms) {
      const info = sourceMap[platform] || {};
      const status = (info.status || 'idle').toLowerCase();
      const count = typeof info.count === 'number' ? info.count : 0;

      const chip = document.createElement('span');
      chip.className = 'ge-ev';
      chip.dataset.platform = platform;
      chip.dataset.status = status;

      const countPart = count > 0 ? ` ${count}` : '';
      chip.textContent = `${platform.toUpperCase()} ${status.toUpperCase()}${countPart}`;

      root.appendChild(chip);
    }
  }

  return {
    element: root,
    update,
  };
}
