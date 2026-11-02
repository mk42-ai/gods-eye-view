/**
 * src/scenes/spriteAtlas.js
 *
 * Browser sprite atlas cache for Scene Spec icons.
 *
 * Loads /scene-icons/manifest.json + sprite@2x.png once, slices each key into
 * ONE cached HTMLCanvasElement per key+scale, and bakes a 2 px #0B1220 contrast halo
 * behind the icon via canvas shadowBlur/shadowColor.
 *
 * Contrast halo rationale:
 * Rendering a second slightly larger billboard in Cesium for halo/outline doubles
 * the billboard count and causes texture thrashing. Slicing with shadowBlur directly
 * into the cached canvas gives an identical high-contrast halo on any terrain or 3D
 * tiles background at zero runtime entity cost.
 *
 * Cesium dedupes billboard textures by image identity; caching one canvas per
 * key+scale ensures the TextureAtlas never grows per entity.
 *
 * Before load() resolves (or in headless Node environments without canvas support),
 * imageFor() returns the static PNG URL so callers never block.
 */

export const DEFAULT_BASE_URL = '/scene-icons/';

/**
 * Creates a sprite atlas loader and cache.
 *
 * @param {object} [options]
 * @param {Document} [options.document] - DOM document
 * @param {string} [options.baseUrl] - Base path to scene icons directory
 * @returns {{
 *   load: () => Promise<void>,
 *   imageFor: (key: string, options?: { scale?: number }) => { id: string, image: HTMLCanvasElement|string, width: number, height: number },
 *   has: (key: string) => boolean,
 *   keys: () => string[],
 *   isLoaded: () => boolean,
 * }}
 */
export function createSpriteAtlas({
  document: doc = globalThis.document,
  baseUrl = DEFAULT_BASE_URL,
} = {}) {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  let manifest = null;
  let spriteImage = null;
  let loadPromise = null;
  let isReady = false;

  const keyMap = new Map();
  const canvasCache = new Map();

  function has(key) {
    if (!manifest) return false;
    return keyMap.has(key);
  }

  function keys() {
    if (!manifest) return [];
    return Array.from(keyMap.keys());
  }

  function isLoaded() {
    return isReady;
  }

  function getFallbackEntry(key, scale) {
    const safeKey = manifest && !keyMap.has(key) ? 'generic' : key;
    const suffix = scale >= 2 ? '@2x' : '';
    const url = `${normalizedBaseUrl}png/${safeKey}${suffix}.png`;
    const dim = scale >= 2 ? 128 : 64;
    return {
      id: `gev-sprite:${safeKey}@${scale}`,
      image: url,
      width: dim,
      height: dim,
    };
  }

  async function load() {
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      // 1. Fetch manifest.json
      const manifestUrl = `${normalizedBaseUrl}manifest.json`;
      const res = await fetch(manifestUrl);
      if (!res.ok) {
        throw new Error(
          `Failed to fetch sprite manifest from ${manifestUrl}: ${res.status}`,
        );
      }
      manifest = await res.json();
      keyMap.clear();
      for (const item of manifest.keys || []) {
        keyMap.set(item.key, item);
      }

      // Check for canvas support
      const canCreateCanvas =
        doc &&
        typeof doc.createElement === 'function' &&
        (() => {
          try {
            const testCanvas = doc.createElement('canvas');
            return typeof testCanvas?.getContext === 'function';
          } catch {
            return false;
          }
        })();

      if (!canCreateCanvas) {
        // In headless or environments without canvas, mark ready with URL fallbacks
        isReady = true;
        return;
      }

      // 2. Load sprite@2x.png image
      const spriteUrl = `${normalizedBaseUrl}sprite@2x.png`;
      spriteImage = await new Promise((resolve, reject) => {
        let img;
        if (typeof globalThis.Image === 'function') {
          img = new globalThis.Image();
        } else if (doc && typeof doc.createElement === 'function') {
          img = doc.createElement('img');
        } else {
          return resolve(null);
        }

        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = (err) =>
          reject(
            new Error(
              `Failed to load sprite image from ${spriteUrl}: ${err?.message || err}`,
            ),
          );
        img.src = spriteUrl;

        // If already complete (cached / data url)
        if (img.complete && img.naturalWidth) {
          resolve(img);
        }
      });

      isReady = true;
    })();

    return loadPromise;
  }

  function imageFor(key, { scale = 2 } = {}) {
    const s = scale >= 2 ? 2 : 1;
    const safeKey = isReady && manifest && !keyMap.has(key) ? 'generic' : key;
    const cacheKey = `${safeKey}@${s}`;

    // Return cached canvas if already sliced
    if (canvasCache.has(cacheKey)) {
      return canvasCache.get(cacheKey);
    }

    // Before load resolves, or if sprite image is not available, return PNG URL
    if (!isReady || !spriteImage || !manifest) {
      return getFallbackEntry(safeKey, s);
    }

    const item = keyMap.get(safeKey) || keyMap.get('generic');
    if (!item) {
      return getFallbackEntry(safeKey, s);
    }

    const canCreateCanvas =
      doc &&
      typeof doc.createElement === 'function' &&
      (() => {
        try {
          const testCanvas = doc.createElement('canvas');
          return typeof testCanvas?.getContext === 'function';
        } catch {
          return false;
        }
      })();

    if (!canCreateCanvas) {
      return getFallbackEntry(safeKey, s);
    }

    // Slice canvas
    const targetDim = s === 2 ? 128 : 64;
    const canvas = doc.createElement('canvas');
    canvas.width = targetDim;
    canvas.height = targetDim;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return getFallbackEntry(safeKey, s);
    }

    // sprite coordinates in manifest are 1x (64px cells), so in sprite@2x (128px cells) they are doubled
    const sx = (item.sprite?.x ?? 0) * 2;
    const sy = (item.sprite?.y ?? 0) * 2;
    const sw = (item.sprite?.width ?? 64) * 2;
    const sh = (item.sprite?.height ?? 64) * 2;

    // Contrast halo: paint a 2 px #0B1220 outline/shadow behind the sprite
    // using shadowBlur/shadowColor directly onto the canvas.
    ctx.save();
    ctx.shadowColor = '#0B1220';
    ctx.shadowBlur = Math.round(2 * s);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.drawImage(spriteImage, sx, sy, sw, sh, 0, 0, targetDim, targetDim);
    ctx.restore();

    // Re-draw crisp foreground sprite on top
    ctx.drawImage(spriteImage, sx, sy, sw, sh, 0, 0, targetDim, targetDim);

    const result = {
      id: `gev-sprite:${safeKey}@${s}`,
      image: canvas,
      width: targetDim,
      height: targetDim,
    };

    canvasCache.set(cacheKey, result);
    return result;
  }

  return {
    load,
    imageFor,
    has,
    keys,
    isLoaded,
  };
}
