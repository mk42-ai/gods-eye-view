import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const STARTED_AT = new Date().toISOString();

/**
 * Served-revision helpers (2026-10-24, "old build served" incident).
 *
 * Resolution order for the build id: BUILD_COMMIT / VERCEL_GIT_COMMIT_SHA
 * env, the id stamped into dist/index.html (`<meta name="build-id">`, written
 * by build/vite.js from the checkout's HEAD), then `git rev-parse` of this
 * checkout. Reading the stamped document FIRST means /api/version can never
 * disagree with the HTML the host serves — the exact mismatch the endpoint
 * exists to expose. Never a secret.
 */
export function resolveServedBuildId({
  env = process.env,
  distDir = path.join(repoRoot, 'dist'),
  root = repoRoot,
  indexFile = path.join(distDir, 'index.html'),
} = {}) {
  const fromEnv = env.BUILD_COMMIT || env.VERCEL_GIT_COMMIT_SHA;
  if (fromEnv) return String(fromEnv).slice(0, 12);
  try {
    const html = readFileSync(indexFile, 'utf8');
    const m = html.match(/<meta name="build-id" content="([^"]*)"/);
    if (m && m[1]) return m[1];
  } catch {
    /* no dist yet */
  }
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

/** Body of GET /api/version — build id, process start time, runtime. */
export function versionPayload(buildId) {
  return {
    ok: true,
    build: String(buildId || ''),
    startedAt: STARTED_AT,
    node: process.version,
    service: 'gods-eye-view',
  };
}

/**
 * Cache policy: the document is never cacheable — every load re-reads
 * index.html, which references the current content-hashed bundles; those
 * hashed files under /assets and /cesium are immutable. Mirrors the
 * `headers` block in vercel.json.
 */
export function cacheControlFor(urlPath) {
  const p = String(urlPath || '');
  if (/^\/(assets|cesium)\/.+-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/i.test(p))
    return 'public, max-age=31536000, immutable';
  if (/^\/(assets|cesium)\//.test(p)) return 'public, max-age=3600';
  return 'no-store';
}

/** Connect-style middleware: GET/HEAD /api/version (mounted root-level in app.js). */
export function versionRoute(getBuildId = () => resolveServedBuildId()) {
  return (req, res, next) => {
    const method = req.method || 'GET';
    if (
      (method !== 'GET' && method !== 'HEAD') ||
      !/^\/api\/version(?:\?|$)/.test(req.url || '')
    ) {
      next();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      method === 'HEAD' ? '' : JSON.stringify(versionPayload(getBuildId())),
    );
  };
}
