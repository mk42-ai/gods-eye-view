import { applicationHtmlPlugin } from './application-html.js';
import { productNamePlugin } from './product-name.js';
import cesium from 'vite-plugin-cesium';

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
      ...plugins,
    ],
    ...(publicDir === undefined ? {} : { publicDir }),
    server: {
      headers: { 'Content-Security-Policy': "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://www.tiktok.com https://www.instagram.com https://platform.twitter.com https://syndication.twitter.com; frame-ancestors 'self' https://on-demand.io https://*.on-demand.io" },
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
    build: { chunkSizeWarningLimit: 1500 },
  };
}
