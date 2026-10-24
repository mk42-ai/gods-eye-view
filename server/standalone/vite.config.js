import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { defineConfig, loadEnv } from 'vite';
import { createBrowserViteConfig } from '../../build/vite.js';
import { localProviderPlugins } from '../providers/local.js';
import { apiNotFoundPlugin } from './api-not-found.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** BUILD_COMMIT / VERCEL_GIT_COMMIT_SHA, else the checkout's short HEAD, else ''. */
function resolveBuildId() {
  const fromEnv = process.env.BUILD_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromEnv) return String(fromEnv).slice(0, 12);
  try {
    return execFileSync('git', ['rev-parse', '--short=9', 'HEAD'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

/** Load this checkout's configuration and attach its local provider middleware. */
export default defineConfig(({ mode }) => {
  const loaded = loadEnv(mode, root, '');
  for (const [key, value] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const config = createBrowserViteConfig({
    plugins: [...localProviderPlugins(), apiNotFoundPlugin()],
    googleApiKey: process.env.GOOGLE_MAPS_API_KEY,
    cesiumToken: process.env.CESIUM_ION_TOKEN,
    host: process.env.HOST,
    port: process.env.PORT,
    buildId: resolveBuildId(),
  });
  config.server.allowedHosts = true;
  // LIVE FOOTAGE service (api/footage/index.py, Python) — in local dev it runs
  // as a separate uvicorn; FOOTAGE_UPSTREAM points Vite's proxy at it.
  const footageUpstream = (process.env.FOOTAGE_UPSTREAM || '').replace(
    /\/$/,
    '',
  );
  if (footageUpstream) {
    config.server.proxy = {
      ...(config.server.proxy || {}),
      '/footage': { target: footageUpstream, changeOrigin: true },
      '/api/footage': { target: footageUpstream, changeOrigin: true },
    };
  }
  return config;
});
