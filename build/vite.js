import { applicationHtmlPlugin } from './application-html.js';
import { productNamePlugin } from './product-name.js';
import cesium from 'vite-plugin-cesium';

/** Keep Cesium's assets/plugin semantics, but let the shell load its optional
 * script asynchronously with a deadline instead of blocking HTML parsing. */
function deferredCesium() {
  const plugin = cesium();
  const tags = plugin.transformIndexHtml;
  plugin.transformIndexHtml = function (...args) {
    return tags.apply(this, args).filter((tag) => !(tag.tag === 'script' && /\/Cesium\.js$/.test(tag.attrs?.src || '')));
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
} = {}) {
  return {
    plugins: [
      deferredCesium(),
      applicationHtmlPlugin(),
      productNamePlugin(),
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
    },
    build: { chunkSizeWarningLimit: 1500 },
  };
}
