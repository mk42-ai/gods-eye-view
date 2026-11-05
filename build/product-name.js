import { readFileSync } from 'node:fs';
import { productIdentity } from '../server/brand/productName.js';

/**
 * Build-time product-name stamping for files that cannot import a module:
 * index.html (`{{PRODUCT_NAME}}`, `{{PRODUCT_DESCRIPTION}}`, `{{PRODUCT_TAGLINE}}`
 * tokens) and public/brand/site.webmanifest (`name` / `short_name`), from the
 * same env-driven identity the runtime uses (server/brand/productName.js).
 */
export const PRODUCT_TOKENS = Object.freeze([
  'PRODUCT_NAME',
  'PRODUCT_SHORT_NAME',
  'PRODUCT_TAGLINE',
  'PRODUCT_DESCRIPTION',
]);

function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Replace every `{{PRODUCT_*}}` token; unknown tokens are left untouched. */
export function stampProductTokens(html, identity = productIdentity()) {
  const values = {
    PRODUCT_NAME: identity.name,
    PRODUCT_SHORT_NAME: identity.shortName,
    PRODUCT_TAGLINE: identity.tagline,
    PRODUCT_DESCRIPTION: identity.description,
  };
  return html.replace(/\{\{(PRODUCT_[A-Z_]+)\}\}/g, (match, token) =>
    token in values ? escapeHtmlAttr(values[token]) : match,
  );
}

/** Rewrite the web manifest's display names from the identity. */
export function stampManifest(manifestJson, identity = productIdentity()) {
  const manifest = JSON.parse(manifestJson);
  manifest.name = identity.name;
  manifest.short_name = identity.shortName;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Vite plugin: stamp index.html tokens (runs AFTER the template expansion)
 * and emit a stamped `brand/site.webmanifest` that overrides the static
 * copy from public/ in the build output.
 */
export function productNamePlugin({ manifestPath } = {}) {
  const manifestUrl =
    manifestPath || new URL('../public/brand/site.webmanifest', import.meta.url);
  return {
    name: 'product-name-tokens',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => stampProductTokens(html),
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'brand/site.webmanifest',
        source: stampManifest(readFileSync(manifestUrl, 'utf8')),
      });
    },
    // Dev server: serve the stamped manifest too.
    configureServer(server) {
      server.middlewares.use('/brand/site.webmanifest', (req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(stampManifest(readFileSync(manifestUrl, 'utf8')));
      });
    },
  };
}
