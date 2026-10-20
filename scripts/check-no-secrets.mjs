#!/usr/bin/env node
/**
 * Build gate — no API key material may ship in the source tree, the public
 * assets or the built bundle. Ported on 2026-10-20 from the sibling repo
 * mk42-ai/ondemand-eand-spatial (scripts/check-no-secrets.mjs, v1.3) and
 * widened for this repository's layout (server/, api/, config/, data/).
 *
 *   node scripts/check-no-secrets.mjs [--dist]
 *
 * Fails on: an ElevenLabs-style key ("sk_" + 32+ word chars), an OpenAI-style
 * key ("sk-" + 20+ chars), a literal ONDEMAND_API_KEY / ON_DEMAND_API_KEY /
 * ELEVENLABS_API_KEY / OPENAI_API_KEY / AISSTREAM_API_KEY / TOMTOM_API_KEY /
 * GOOGLE_MAPS_API_KEY / CESIUM_ION_TOKEN / KV_REST_API_TOKEN assignment WITH
 * a value in a committed file, an `apikey: "<24+ alnum>"` header literal, a
 * Bearer token literal, or a Vercel/GitHub token prefix. Patterns are
 * assembled from fragments so this file never contains a key prefix itself.
 * `.env`, `.env.*.local` are git-ignored and excluded; `.env.example` IS
 * scanned (values there must be empty or placeholders).
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.argv.includes('--dist');
const KEY_NAMES = [
  'ONDEMAND_API_KEY',
  'ON_DEMAND_API_KEY',
  'ELEVEN' + 'LABS_API_KEY',
  'OPENAI_API_KEY',
  'AISSTREAM_API_KEY',
  'TOMTOM_API_KEY',
  'GOOGLE_MAPS_API_KEY',
  'GOOGLE_MAPS_SERVER_API_KEY',
  'CESIUM_ION_TOKEN',
  'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_TOKEN',
  'ONDEMAND_SELFTEST_TOKEN',
  'NASA_FIRMS_MAP_KEY',
  'FIRMS_MAP_KEY',
  'LL2_API_TOKEN',
  'TFL_APP_KEY',
  'OPENSKY_CLIENT_SECRET',
  'VERCEL_TOKEN',
  'GITHUB_TOKEN',
];
const P = {
  elevenStyleKey: new RegExp('\\bsk' + '_[A-Za-z0-9]{32,}\\b'),
  openaiStyleKey: new RegExp('\\bsk' + '-(?:proj-)?[A-Za-z0-9_-]{20,}\\b'),
  keyAssignmentLiteral: new RegExp(
    '\\b(' + KEY_NAMES.join('|') + ')\\s*[=:]\\s*[\'"]?[A-Za-z0-9_\\-]{20,}',
  ),
  apikeyHeaderLiteral: /\bapikey['"]?\s*[:=]\s*['"][A-Za-z0-9]{24,}['"]/,
  bearerLiteral: /\bBearer\s+[A-Za-z0-9_\-.]{32,}\b/,
  vercelTokenPrefix: new RegExp('\\bvcp' + '_[A-Za-z0-9]{20,}\\b'),
  githubTokenPrefix: new RegExp(
    '\\b(?:ghp|gho|ghu|ghs|ghr|github_pat)' + '_[A-Za-z0-9_]{20,}\\b',
  ),
  privateKeyBlock: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
};
// Lines that document a pattern rather than contain a key.
const ALLOW_LINE =
  /check-no-secrets|<redacted|<YOUR_API_KEY>|placeholder|example-key|dummy|DO-NOT-LEAK|server-key-test|user-key-must-not-be-used|sentinel|fixture|unit-test|never-logged|test-should|Fake|your_[a-z_]*_here/i;
const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.html',
  '.css',
  '.svg',
  '.txt',
  '.yml',
  '.yaml',
  '.map',
  '.py',
  '.sh',
  '.env',
  '.example',
  '',
]);
const SKIP = new Set([
  'node_modules',
  '.git',
  '.ui-proof',
  '.pdf-proof',
  '__pycache__',
  '.gev-cache',
  '.gev-logs',
  '3d-models',
]);
const SKIP_FILES = new Set(['package-lock.json']);
const roots = [
  'src',
  'public',
  'api',
  'server',
  'scripts',
  'tools',
  'docs',
  'config',
  'build',
  'index.html',
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'SECURITY.md',
  'TESTING.md',
  'DATA_SOURCES.md',
  '.env.example',
  'vercel.json',
  'vite.config.js',
  ...(DIST ? ['dist'] : []),
];
const files = [];
const walk = (p) => {
  if (!existsSync(p)) return;
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) {
      if (SKIP.has(e)) continue;
      walk(join(p, e));
    }
  } else if (
    !SKIP_FILES.has(relative(root, p).split('/').pop()) &&
    TEXT_EXT.has(extname(p).toLowerCase()) &&
    st.size < 20 * 1024 * 1024
  )
    files.push(p);
};
for (const r of roots) walk(join(root, r));
const hits = [];
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\u0000')) continue; // binary
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (ALLOW_LINE.test(line)) continue;
    for (const [name, re] of Object.entries(P)) {
      const m = re.exec(line);
      if (m)
        hits.push(
          `${relative(root, f)}:${i + 1} — ${name} near "${line.slice(Math.max(0, m.index - 20), m.index + 14).replace(/\s+/g, ' ')}…"`,
        );
    }
  }
}
console.log(
  `check-no-secrets: scanned ${files.length} text files under ${roots.filter((r) => existsSync(join(root, r))).join(', ')}`,
);
if (hits.length) {
  for (const h of hits) console.error(`  ✗ ${h}`);
  console.error(
    'check-no-secrets: key material found — remove it (keys live only in .env / the Vercel environment)',
  );
  process.exit(1);
}
console.log(
  `✓ no key material in the ${DIST ? 'source tree + dist/' : 'source tree'}`,
);
