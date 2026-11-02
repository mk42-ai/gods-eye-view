/**
 * src/scenes/iconBillboard.js
 *
 * Billboard graphics helper and backplate renderer for scene icons.
 *
 * Provides:
 * - iconBillboardGraphics(Cesium, options): BillboardGraphics options object with
 *   clamping, distance scaling, infinite depth test distance, and center origin.
 * - iconWithBackplate(doc, image, options): circular navy (#0B1220) backplate with teal ring
 *   baked onto a canvas behind the icon (cached per key+size).
 * - INLINE_SVG_GLYPHS: inline SVG data-URLs for offline/fallback rendering.
 * - iconFor(key, options): key resolution pipeline (atlas canvas -> PNG URL -> inline SVG).
 * - iconSizeFor(key): recommended size (28-44 px, 36 px default).
 */

const TEAL = '#14B8A6';
const MINT = '#A7F3D0';
const NAVY = '#0B1220';
const WHITE = '#FFFFFF';

export const ELEMENT_TYPE_ICONS = Object.freeze({
  inner_cordon: 'cordon_node',
  outer_cordon: 'cordon_node',
  approach_route: 'vehicle_police_car',
  egress_route: 'egress',
  staging_point: 'staging_point',
  perimeter_unit: 'perimeter_unit',
  checkpoint: 'checkpoint',
  vehicle_checkpoint: 'checkpoint',
  cones: 'cone_cluster',
  barriers: 'barrier',
  cctv_signal: 'cctv',
  cctv_pick: 'sensor_cctv_feed',
  crowd_zone: 'crowd_spectators',
  crowd_density_zone: 'crowd_spectators',
  route_line: 'route_start',
  start_finish: 'start_finish',
  command_post: 'command_post',
  overwatch: 'aircraft_helicopter',
  cordon_node: 'cordon_node',
  medical_point: 'medical_point',
  marine_patrol: 'vessel_marine_patrol',
  foot_patrol: 'perimeter_unit',
  escort_motorcycle: 'vehicle_police_motorcycle',
  shuttle_bus: 'vehicle_city_bus',
  road_closed: 'signage_road_closed',
  screening_lane: 'barrier_crowd',
  threat_zone: 'alert_state_3',
  interest_zone: 'generic',
  intel_note: 'generic',
  timeline_event: 'generic',
  person: 'perimeter_unit',
  runner: 'person_runner',
  police: 'person_police_officer',
  organizer: 'command_post',
  vehicle: 'vehicle_civilian_sedan',
  police_vehicle: 'vehicle_police_car',
  barrier: 'barrier_crowd',
  start_line: 'start_finish',
  finish_line: 'start_finish',
});

function svgDataUrl(svgString) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgString.trim())}`;
}

export const INLINE_SVG_GLYPHS = Object.freeze({
  generic: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="24" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <circle cx="32" cy="32" r="10" fill="${WHITE}"/>
    </svg>
  `),
  police_unit: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <path d="M18 38 L22 26 L42 26 L46 38 Z" fill="${MINT}"/>
      <rect x="16" y="36" width="32" height="12" rx="4" fill="${WHITE}"/>
      <circle x="22" cy="48" r="4" fill="${TEAL}"/>
      <circle x="42" cy="48" r="4" fill="${TEAL}"/>
      <rect x="28" y="20" width="8" height="6" rx="2" fill="#EF4444"/>
    </svg>
  `),
  vehicle_police_car: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <path d="M18 38 L22 26 L42 26 L46 38 Z" fill="${MINT}"/>
      <rect x="16" y="36" width="32" height="12" rx="4" fill="${WHITE}"/>
      <circle cx="22" cy="48" r="4" fill="${TEAL}"/>
      <circle cx="42" cy="48" r="4" fill="${TEAL}"/>
      <rect x="28" y="20" width="8" height="6" rx="2" fill="#EF4444"/>
    </svg>
  `),
  perimeter_unit: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <circle cx="32" cy="22" r="8" fill="${MINT}"/>
      <path d="M20 48 C20 36, 44 36, 44 48 Z" fill="${WHITE}"/>
      <polygon points="32,12 36,18 42,18 38,22 40,28 32,24 24,28 26,22 22,18 28,18" fill="${TEAL}"/>
    </svg>
  `),
  person_police_officer: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <circle cx="32" cy="22" r="8" fill="${MINT}"/>
      <path d="M20 48 C20 36, 44 36, 44 48 Z" fill="${WHITE}"/>
      <polygon points="32,12 36,18 42,18 38,22 40,28 32,24 24,28 26,22 22,18 28,18" fill="${TEAL}"/>
    </svg>
  `),
  barrier: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <rect x="14" y="24" width="36" height="8" rx="2" fill="#F59E0B"/>
      <rect x="14" y="36" width="36" height="8" rx="2" fill="${WHITE}"/>
      <rect x="18" y="20" width="4" height="28" fill="${MINT}"/>
      <rect x="42" y="20" width="4" height="28" fill="${MINT}"/>
    </svg>
  `),
  barrier_crowd: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <rect x="14" y="24" width="36" height="8" rx="2" fill="#F59E0B"/>
      <rect x="14" y="36" width="36" height="8" rx="2" fill="${WHITE}"/>
      <rect x="18" y="20" width="4" height="28" fill="${MINT}"/>
      <rect x="42" y="20" width="4" height="28" fill="${MINT}"/>
    </svg>
  `),
  screening_lane: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <rect x="14" y="24" width="36" height="8" rx="2" fill="#F59E0B"/>
      <rect x="14" y="36" width="36" height="8" rx="2" fill="${WHITE}"/>
    </svg>
  `),
  vehicle_ambulance: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <rect x="14" y="22" width="36" height="24" rx="4" fill="${WHITE}"/>
      <rect x="29" y="28" width="6" height="12" fill="#EF4444"/>
      <rect x="26" y="31" width="12" height="6" fill="#EF4444"/>
    </svg>
  `),
  medical_point: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <rect x="16" y="16" width="32" height="32" rx="6" fill="${WHITE}"/>
      <rect x="28" y="22" width="8" height="20" fill="#EF4444"/>
      <rect x="22" y="28" width="20" height="8" fill="#EF4444"/>
    </svg>
  `),
  vehicle_civilian_sedan: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <path d="M18 36 L24 26 L40 26 L46 36 Z" fill="${TEAL}"/>
      <rect x="14" y="34" width="36" height="12" rx="3" fill="${WHITE}"/>
      <circle cx="22" cy="46" r="4" fill="${NAVY}"/>
      <circle cx="42" cy="46" r="4" fill="${NAVY}"/>
    </svg>
  `),
  civilian_sedan: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <path d="M18 36 L24 26 L40 26 L46 36 Z" fill="${TEAL}"/>
      <rect x="14" y="34" width="36" height="12" rx="3" fill="${WHITE}"/>
      <circle cx="22" cy="46" r="4" fill="${NAVY}"/>
      <circle cx="42" cy="46" r="4" fill="${NAVY}"/>
    </svg>
  `),
  command_post: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <polygon points="32,16 48,44 16,44" fill="${MINT}"/>
      <rect x="28" y="32" width="8" height="12" fill="${NAVY}"/>
      <circle cx="32" cy="24" r="3" fill="${WHITE}"/>
    </svg>
  `),
  staging_point: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <polygon points="32,16 48,44 16,44" fill="${MINT}"/>
      <rect x="28" y="32" width="8" height="12" fill="${NAVY}"/>
    </svg>
  `),
  checkpoint: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <polygon points="32,16 44,22 48,34 44,46 32,48 20,46 16,34 20,22" fill="#EF4444"/>
      <rect x="24" y="30" width="16" height="4" fill="${WHITE}"/>
    </svg>
  `),
  cordon_node: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <circle cx="32" cy="32" r="16" fill="#F59E0B" stroke="${WHITE}" stroke-width="3"/>
    </svg>
  `),
  vehicle_checkpoint: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <polygon points="32,16 44,22 48,34 44,46 32,48 20,46 16,34 20,22" fill="#EF4444"/>
      <rect x="24" y="30" width="16" height="4" fill="${WHITE}"/>
    </svg>
  `),
  crowd_zone: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <circle cx="22" cy="26" r="6" fill="${WHITE}"/>
      <circle cx="42" cy="26" r="6" fill="${WHITE}"/>
      <circle cx="32" cy="20" r="7" fill="${MINT}"/>
      <path d="M14 46 C14 36, 30 36, 30 46 Z" fill="${WHITE}"/>
      <path d="M34 46 C34 36, 50 36, 50 46 Z" fill="${WHITE}"/>
      <path d="M22 48 C22 36, 42 36, 42 48 Z" fill="${MINT}"/>
    </svg>
  `),
  crowd_spectators: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <circle cx="22" cy="26" r="6" fill="${WHITE}"/>
      <circle cx="42" cy="26" r="6" fill="${WHITE}"/>
      <circle cx="32" cy="20" r="7" fill="${MINT}"/>
      <path d="M22 48 C22 36, 42 36, 42 48 Z" fill="${MINT}"/>
    </svg>
  `),
  start_finish: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <rect x="18" y="18" width="28" height="16" fill="${WHITE}"/>
      <rect x="18" y="18" width="7" height="8" fill="${NAVY}"/>
      <rect x="32" y="18" width="7" height="8" fill="${NAVY}"/>
      <rect x="25" y="26" width="7" height="8" fill="${NAVY}"/>
      <rect x="39" y="26" width="7" height="8" fill="${NAVY}"/>
      <rect x="16" y="16" width="4" height="32" fill="${MINT}"/>
      <rect x="44" y="16" width="4" height="32" fill="${MINT}"/>
    </svg>
  `),
  signage_road_closed: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <circle cx="32" cy="32" r="18" fill="#EF4444"/>
      <rect x="20" y="29" width="24" height="6" fill="${WHITE}"/>
    </svg>
  `),
  road_closed: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <circle cx="32" cy="32" r="18" fill="#EF4444"/>
      <rect x="20" y="29" width="24" height="6" fill="${WHITE}"/>
    </svg>
  `),
  cctv: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <path d="M20 28 L40 22 L44 32 L24 38 Z" fill="${WHITE}"/>
      <polygon points="40,22 48,18 48,34 44,32" fill="${TEAL}"/>
      <rect x="20" y="36" width="4" height="12" fill="${MINT}"/>
    </svg>
  `),
  cctv_signal: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <path d="M20 28 L40 22 L44 32 L24 38 Z" fill="${WHITE}"/>
      <polygon points="40,22 48,18 48,34 44,32" fill="${TEAL}"/>
    </svg>
  `),
  vessel_marine_patrol: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <path d="M16 40 L48 40 L44 48 L20 48 Z" fill="${WHITE}"/>
      <rect x="24" y="28" width="16" height="12" fill="${TEAL}"/>
      <line x1="32" y1="20" x2="32" y2="28" stroke="${MINT}" stroke-width="3"/>
    </svg>
  `),
  marine_patrol: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <path d="M16 40 L48 40 L44 48 L20 48 Z" fill="${WHITE}"/>
      <rect x="24" y="28" width="16" height="12" fill="${TEAL}"/>
    </svg>
  `),
  cone: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <polygon points="32,16 42,46 22,46" fill="#F97316"/>
      <polygon points="30,28 34,28 36,34 28,34" fill="${WHITE}"/>
      <rect x="18" y="44" width="28" height="4" rx="2" fill="${WHITE}"/>
    </svg>
  `),
  cone_cluster: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <polygon points="32,16 42,46 22,46" fill="#F97316"/>
      <polygon points="30,28 34,28 36,34 28,34" fill="${WHITE}"/>
      <rect x="18" y="44" width="28" height="4" rx="2" fill="${WHITE}"/>
    </svg>
  `),
  vehicle_police_motorcycle: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <circle cx="22" cy="42" r="8" fill="${WHITE}" stroke="${NAVY}" stroke-width="3"/>
      <circle cx="42" cy="42" r="8" fill="${WHITE}" stroke="${NAVY}" stroke-width="3"/>
      <path d="M22 42 L32 26 L42 42 Z" fill="${TEAL}"/>
      <rect x="30" y="22" width="6" height="6" fill="#EF4444"/>
    </svg>
  `),
  vehicle_city_bus: svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="28" fill="${NAVY}" stroke="${TEAL}" stroke-width="3"/>
      <rect x="18" y="20" width="28" height="26" rx="4" fill="${WHITE}"/>
      <rect x="22" y="24" width="20" height="10" fill="${TEAL}"/>
      <circle cx="24" cy="46" r="3" fill="${NAVY}"/>
      <circle cx="40" cy="46" r="3" fill="${NAVY}"/>
    </svg>
  `),
});

const backplateCache = new Map();
let sharedAtlas = null;

export function setSharedAtlas(atlas) {
  sharedAtlas = atlas;
}

export function getSharedAtlas() {
  return sharedAtlas;
}

/**
 * Returns recommended on-screen pixel size for an icon key.
 *
 * Target: 32–64 px (36 px default, 44 px for command/start_finish/medical, 28 px for cones).
 */
export function iconSizeFor(key) {
  switch (key) {
    case 'command_post':
    case 'staging_point':
    case 'start_finish':
    case 'start_finish_gate':
    case 'medical_point':
    case 'vehicle_ambulance':
      return 44;
    case 'cone':
    case 'cones':
    case 'cone_cluster':
      return 28;
    default:
      return 36;
  }
}

/**
 * Bakes a navy circular backplate/halo (≈1.25x icon) with a thin teal ring
 * behind the icon onto a canvas.
 *
 * Cached one canvas per key+size. If image is a URL string and no canvas is
 * available (or document is headless), returns image unchanged.
 *
 * @param {Document} doc
 * @param {HTMLCanvasElement|string|object} image
 * @param {object} [options]
 * @param {number} [options.sizePx=36]
 * @param {string} [options.key='']
 * @param {string} [options.backplate='#0B1220']
 * @param {string} [options.ring='#14B8A6']
 * @returns {HTMLCanvasElement|string}
 */
export function iconWithBackplate(
  doc = globalThis.document,
  image,
  { sizePx = 36, key = '', backplate = NAVY, ring = TEAL } = {},
) {
  if (!doc || typeof doc.createElement !== 'function') {
    return image;
  }

  const cacheKey = `${key || image?.id || (typeof image === 'string' ? image : 'icon')}:${sizePx}:${backplate}:${ring}`;
  if (backplateCache.has(cacheKey)) {
    return backplateCache.get(cacheKey);
  }

  let canvas;
  try {
    canvas = doc.createElement('canvas');
  } catch {
    return image;
  }

  if (!canvas || typeof canvas.getContext !== 'function') {
    return image;
  }

  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return image;
  }

  const cx = sizePx / 2;
  const cy = sizePx / 2;
  const radius = Math.max(1, sizePx / 2 - 1.5);

  ctx.save?.();
  ctx.beginPath?.();
  ctx.arc?.(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = backplate;
  ctx.fill?.();

  ctx.lineWidth = Math.max(1, Math.round(sizePx * 0.04));
  ctx.strokeStyle = ring;
  ctx.stroke?.();
  ctx.restore?.();

  // Draw foreground icon centered (icon is 1 / 1.25 = 0.8x of canvas)
  if (
    image &&
    typeof image === 'object' &&
    (image.tagName === 'CANVAS' || image.width > 0)
  ) {
    const iconDim = Math.round(sizePx / 1.25);
    const ox = Math.round((sizePx - iconDim) / 2);
    const oy = Math.round((sizePx - iconDim) / 2);
    try {
      ctx.drawImage(image, ox, oy, iconDim, iconDim);
    } catch {
      // Ignore drawImage errors in synthetic test environments
    }
  } else if (typeof image === 'string') {
    // When image is a URL string, optionally load and draw onto the canvas asynchronously
    if (
      typeof globalThis.Image === 'function' ||
      typeof doc.createElement === 'function'
    ) {
      try {
        const img =
          typeof globalThis.Image === 'function'
            ? new globalThis.Image()
            : doc.createElement('img');
        if (img) {
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            const iconDim = Math.round(sizePx / 1.25);
            const ox = Math.round((sizePx - iconDim) / 2);
            const oy = Math.round((sizePx - iconDim) / 2);
            try {
              ctx.drawImage(img, ox, oy, iconDim, iconDim);
            } catch {}
          };
          img.src = image;
        }
      } catch {}
    }
  }

  backplateCache.set(cacheKey, canvas);
  return canvas;
}

/**
 * Resolves an icon key to an image:
 * atlas canvas (when loaded) -> PNG URL -> inline SVG glyph.
 *
 * @param {string} key
 * @param {object} [options]
 * @param {object} [options.atlas]
 * @param {number} [options.scale=2]
 * @param {number} [options.sizePx=36]
 * @param {boolean} [options.backplate=true]
 * @param {Document} [options.doc]
 * @returns {HTMLCanvasElement|string}
 */
export function iconFor(
  key,
  {
    atlas = sharedAtlas,
    scale = 2,
    sizePx = 36,
    backplate = true,
    doc = globalThis.document,
  } = {},
) {
  const safeKey = key || 'generic';

  // 1. Try atlas canvas
  if (atlas && typeof atlas.isLoaded === 'function' && atlas.isLoaded()) {
    try {
      const entry = atlas.imageFor(safeKey, { scale });
      if (entry?.image) {
        if (backplate && typeof entry.image === 'object') {
          return iconWithBackplate(doc, entry.image, {
            sizePx,
            key: safeKey,
          });
        }
        return entry.image;
      }
    } catch {
      // Fall through to PNG / SVG
    }
  }

  // 2. Try PNG URL
  const pngUrl = `/scene-icons/png/${safeKey}@2x.png`;

  // 3. Fallback inline SVG if requested or available
  const svgGlyph = INLINE_SVG_GLYPHS[safeKey] || INLINE_SVG_GLYPHS.generic;

  return pngUrl || svgGlyph;
}

/**
 * Constructs Cesium BillboardGraphics options per contract:
 * - scaleByDistance: NearFarScalar(500, 1.0, 50000, 0.45)
 * - disableDepthTestDistance: Number.POSITIVE_INFINITY
 * - verticalOrigin: Cesium.VerticalOrigin.CENTER
 * - heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
 * - width / height = sizePx
 *
 * @param {object} Cesium
 * @param {object} options
 * @param {string} [options.key]
 * @param {HTMLCanvasElement|string} [options.image]
 * @param {number} [options.sizePx=36]
 * @param {number} [options.heading=0]
 * @param {boolean} [options.rotate=false]
 * @returns {object}
 */
export function iconBillboardGraphics(
  Cesium,
  { key, image, sizePx = 36, heading = 0, rotate = false } = {},
) {
  const resolvedImage = image || (key ? iconFor(key, { sizePx }) : undefined);

  const scaleByDistance =
    Cesium?.NearFarScalar && typeof Cesium.NearFarScalar === 'function'
      ? new Cesium.NearFarScalar(500, 1.0, 50000, 0.45)
      : { near: 500, nearValue: 1.0, far: 50000, farValue: 0.45 };

  const heightReference =
    Cesium?.HeightReference?.CLAMP_TO_GROUND ?? 'CLAMP_TO_GROUND';
  const verticalOrigin = Cesium?.VerticalOrigin?.CENTER ?? 'CENTER';

  const billboard = {
    image: resolvedImage,
    width: sizePx,
    height: sizePx,
    scaleByDistance,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
    verticalOrigin,
    heightReference,
  };

  if (rotate && typeof heading === 'number') {
    const rad = Cesium?.Math?.toRadians
      ? Cesium.Math.toRadians(heading)
      : (heading * Math.PI) / 180;
    billboard.rotation = rad;
  }

  return billboard;
}
