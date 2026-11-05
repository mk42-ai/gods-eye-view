import { fileURLToPath } from 'node:url';
import { applicationHtmlPlugin } from './application-html.js';
import { productNamePlugin } from './product-name.js';
import cesium from 'vite-plugin-cesium';

/**
 * Two HTML entries ship from one Vite build: the Gods Eye View console
 * (index.html, Cesium/Esri globe, Scenes/Layers/CCTV/Context, tactical HUD,
 * command bar with Build scene + Hyper-real Render) and the Blender-only
 * Scene Workstation (workstation.html, served at /workstation).
 */
export const BROWSER_PAGES = Object.freeze({
  index: 'index.html',
  workstation: 'workstation.html',
});
export function browserPageInputs(root = new URL('../', import.meta.url)) {
  const base = root instanceof URL ? fileURLToPath(root) : String(root);
  return Object.fromEntries(
    Object.entries(BROWSER_PAGES).map(([name, file]) => [
      name,
      `${base.replace(/\/+$/, '')}/${file}`,
    ]),
  );
}

/**
 * The Scene Workstation page (index.html, body.ws-body) renders Blender frames
 * only: strip the Cesium script tag vite-plugin-cesium injects so no WebGL
 * globe (and no 'RangeError: Array buffer allocation failed') can start there.
 */
function workstationNoCesiumPlugin() {
  return {
    name: 'workstation-no-cesium',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!html.includes('ws-body')) return html;
        return html
          .replace(/<script[^>]*src="[^"]*Cesium\.js"[^>]*><\/script>\s*/g, '')
          .replace(/<link[^>]*cesium[^>]*widgets\.css"[^>]*>\s*/gi, '');
      },
    },
  };
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
      cesium(),
      applicationHtmlPlugin(),
      productNamePlugin(),
      workstationNoCesiumPlugin(),
      ...plugins,
    ],
    ...(publicDir === undefined ? {} : { publicDir }),
    server: {
      headers: {
        'Content-Security-Policy':
          "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://www.tiktok.com https://www.instagram.com https://platform.twitter.com https://syndication.twitter.com; frame-ancestors 'self' https://on-demand.io https://*.on-demand.io",
      },
      hmr: false,
      host: host || 'localhost',
      port: parseInt(port, 10) || 4173,
      allowedHosts: true,
      fs: {
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/ENVIRONMENT'],
      },
    },
    define: {
      'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify(googleApiKey),
      'import.meta.env.VITE_CESIUM_ION_TOKEN': JSON.stringify(cesiumToken),
    },
    build: {
      chunkSizeWarningLimit: 1500,
      rollupOptions: { input: browserPageInputs() },
    },
  };
}
