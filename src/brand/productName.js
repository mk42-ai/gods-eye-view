/**
 * Product identity (browser side) — the single source of truth for every
 * user-facing product name in the bundle. Env-driven so an operator can
 * rebrand a deployment without a code change:
 *
 *   VITE_PRODUCT_NAME         default 'OnDemand Intelligence Workstation'
 *   VITE_PRODUCT_SHORT_NAME   default 'Workstation'  (PWA short_name, ≤ 12 chars)
 *   VITE_PRODUCT_TAGLINE      default 'Spatial intelligence console'
 *   VITE_PRODUCT_DESCRIPTION  default (see below)
 *
 * The server mirror is server/brand/productName.js (reads PRODUCT_* without
 * the VITE_ prefix); build/product-name.js stamps the same values into
 * index.html / site.webmanifest at build time. Internal identifiers
 * (storage keys, env aliases, client ids — BRANDING_AUDIT.md §3) are NOT
 * derived from this module and must never be.
 */

export const PRODUCT_NAME_DEFAULT = 'OnDemand Intelligence Workstation';
export const PRODUCT_SHORT_NAME_DEFAULT = 'Workstation';
export const PRODUCT_TAGLINE_DEFAULT = 'Spatial intelligence console';
export const PRODUCT_DESCRIPTION_DEFAULT =
  'real-time spatial intelligence console: photorealistic 3D globe with live aircraft, ships, satellites, earthquakes, fires and CCTV, powered by OnDemand.';

function env(name) {
  try {
    const value = import.meta.env?.[name];
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  } catch {
    return '';
  }
}

export const PRODUCT_NAME = env('VITE_PRODUCT_NAME') || PRODUCT_NAME_DEFAULT;
export const PRODUCT_SHORT_NAME =
  env('VITE_PRODUCT_SHORT_NAME') || PRODUCT_SHORT_NAME_DEFAULT;
export const PRODUCT_TAGLINE =
  env('VITE_PRODUCT_TAGLINE') || PRODUCT_TAGLINE_DEFAULT;
export const PRODUCT_DESCRIPTION =
  env('VITE_PRODUCT_DESCRIPTION') || PRODUCT_DESCRIPTION_DEFAULT;

/**
 * Split a product name into {lead, accent}: the last word is the accent
 * rendered in `.title-accent` (header + loading screen), e.g.
 * "OnDemand Intelligence Workstation" → lead "OnDemand Intelligence", accent "Workstation".
 * A single-word name has an empty lead.
 */
export function splitProductName(name = PRODUCT_NAME) {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= 1) return { lead: '', accent: words[0] || '' };
  return { lead: words.slice(0, -1).join(' '), accent: words.at(-1) };
}

/** Apply the product name to the two wordmarks that are static markup. */
export function applyProductWordmarks(doc = globalThis.document) {
  if (!doc?.querySelectorAll) return 0;
  const { lead, accent } = splitProductName();
  let applied = 0;
  for (const node of doc.querySelectorAll('[data-product-wordmark]')) {
    node.replaceChildren();
    if (lead) node.append(doc.createTextNode(`${lead} `));
    const span = doc.createElement('span');
    span.className = 'title-accent';
    span.textContent = accent;
    node.append(span);
    applied += 1;
  }
  for (const node of doc.querySelectorAll('[data-product-tagline]')) {
    node.textContent = PRODUCT_TAGLINE;
    applied += 1;
  }
  return applied;
}
