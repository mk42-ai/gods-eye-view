/**
 * Product identity (Node / Vercel functions / Pinokio) — mirror of
 * src/brand/productName.js with the same defaults. Reads PRODUCT_* (no
 * VITE_ prefix); the browser module reads VITE_PRODUCT_*. Keep the defaults
 * identical — src/brand/productName.test.mjs asserts it.
 */
export const PRODUCT_NAME_DEFAULT = 'OnDemand Intelligence Workstation';
export const PRODUCT_SHORT_NAME_DEFAULT = 'Workstation';
export const PRODUCT_TAGLINE_DEFAULT = 'Spatial intelligence console';
export const PRODUCT_DESCRIPTION_DEFAULT =
  'real-time spatial intelligence console: photorealistic 3D globe with live aircraft, ships, satellites, earthquakes, fires and CCTV, powered by OnDemand.';

function env(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/** Resolve the identity from the process environment (call per use so tests can vary env). */
export function productIdentity(environment = process.env) {
  const read = (name) =>
    typeof environment[name] === 'string' && environment[name].trim()
      ? environment[name].trim()
      : '';
  return Object.freeze({
    name:
      read('PRODUCT_NAME') || read('VITE_PRODUCT_NAME') || PRODUCT_NAME_DEFAULT,
    shortName:
      read('PRODUCT_SHORT_NAME') ||
      read('VITE_PRODUCT_SHORT_NAME') ||
      PRODUCT_SHORT_NAME_DEFAULT,
    tagline:
      read('PRODUCT_TAGLINE') ||
      read('VITE_PRODUCT_TAGLINE') ||
      PRODUCT_TAGLINE_DEFAULT,
    description:
      read('PRODUCT_DESCRIPTION') ||
      read('VITE_PRODUCT_DESCRIPTION') ||
      PRODUCT_DESCRIPTION_DEFAULT,
  });
}

export const PRODUCT_NAME =
  env('PRODUCT_NAME') || env('VITE_PRODUCT_NAME') || PRODUCT_NAME_DEFAULT;
export const PRODUCT_SHORT_NAME =
  env('PRODUCT_SHORT_NAME') ||
  env('VITE_PRODUCT_SHORT_NAME') ||
  PRODUCT_SHORT_NAME_DEFAULT;
export const PRODUCT_TAGLINE =
  env('PRODUCT_TAGLINE') ||
  env('VITE_PRODUCT_TAGLINE') ||
  PRODUCT_TAGLINE_DEFAULT;
export const PRODUCT_DESCRIPTION =
  env('PRODUCT_DESCRIPTION') ||
  env('VITE_PRODUCT_DESCRIPTION') ||
  PRODUCT_DESCRIPTION_DEFAULT;
