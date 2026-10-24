import { applicationHtmlPlugin } from './application-html.js';
import { productNamePlugin } from './product-name.js';
import cesium from 'vite-plugin-cesium';

/**
 * Stamp the served revision into the document itself (2026-10-24):
 * `<meta name="build-id">` + `data-build` on <html>, so a verifier can read
 * the build id from the raw HTML before any script runs — the JS define
 * (`GEV_BUILD_ID`) alone cannot prove which index.html a host is serving.
 */
export function buildIdHtmlPlugin(buildId = '') {
  const id = String(buildId || '');
  return {
    name: 'gev-build-id',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html
          .replace(/<html(\s[^>]*)?>/, (m) =>
            /data-build=/.test(m) ? m : m.replace(/>$/, ` data-build="${id}">`),
          )
          .replace(
            /<meta charset="UTF-8" \/>/,
            `<meta charset="UTF-8" />\n  <meta name="build-id" content="${id}" />`,
          ),
    },
  };
}

/** Keep Cesium's assets/plugin semantics, but let the shell load its optional
 * script asynchronously with a deadline instead of blocking HTML parsing. */
function deferredCesium() {
  const plugin = cesium();
  const tags = plugin.transformIndexHtml;
  plugin.transformIndexHtml = function (...args) {
    return tags
      .apply(this, args)
      .filter(
        (tag) =>
          !(tag.tag === 'script' && /\/Cesium\.js$/.test(tag.attrs?.src || '')),
      );
  };
  return plugin;
}

/** Build browser assets with explicit inputs; never load environment or providers. */
export function createBrowserViteConfig({
  plugins = [],
  publicDir,
  googleApiKey,
  cesiumToken,
  host = 'localhost',
  port = 4173,
  buildId = '',
} = {}) {
  return {
    plugins: [
      deferredCesium(),
      applicationHtmlPlugin(),
      productNamePlugin(),
      buildIdHtmlPlugin(buildId),
      ...plugins,
    ],
    ...(publicDir === undefined ? {} : { publicDir }),
    server: {
      host: host || 'localhost',
      port: parseInt(port, 10) || 4173,
      allowedHosts:
        host === '0.0.0.0' || host === '::'
          ? true
          : ['localhost', '127.0.0.1', '.local'],
      hmr: false,
      fs: {
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/ENVIRONMENT'],
      },
    },
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(googleApiKey),
      'import.meta.env.CESIUM_ION_TOKEN': JSON.stringify(cesiumToken),
      // Short commit / build label the shell exposes as
      // documentElement.dataset.geBuild so a live preview is provably the
      // deployed revision (never a secret; empty when unknown).
      'import.meta.env.GEV_BUILD_ID': JSON.stringify(String(buildId || '')),
    },
    build: {
      chunkSizeWarningLimit: 1500,
      // Always start from an empty dist/ so a deploy can never ship a stale
      // bundle next to the new index.html; every JS/CSS/asset filename is
      // content-hashed (Vite default, pinned here explicitly) so only
      // index.html needs `Cache-Control: no-store`.
      emptyOutDir: true,
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
}
