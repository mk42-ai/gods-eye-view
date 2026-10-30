/**
 * Server-side dotenv loader for the Vercel-like emulator
 * (server/serverless/dev-server.mjs) — cycle 20, 2026-10-27.
 *
 * Why: the sandbox preview used to receive ONDEMAND_API_KEY from a temp file
 * that was sourced into the launching shell and deleted before start-up, so
 * any restart (`node server/serverless/dev-server.mjs` without that shell)
 * came back with `configured:false`. The key now lives in the PERSISTENT,
 * git-ignored, mode-0600 `.env` at the app root (snapshotted by the platform
 * and re-applied on restart/share) or in the deployment's environment
 * (Vercel project env var). This loader makes the server read that file
 * itself, so a bare restart keeps the key.
 *
 * Rules
 *   • Real environment variables always win (Vercel / sandbox `--env`);
 *     a file value only fills a variable that is unset or empty.
 *   • Files: `.env.local` then `.env` (first one to define a key wins).
 *   • Values are never logged; only the COUNT of loaded keys and the file
 *     names are printed.
 *   • Server-only: lives under server/, never imported by src/.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Minimal KEY=VALUE parser (comments, `export ` prefix, single/double quotes). */
export function parseDotenv(text) {
  const out = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.lastIndexOf(q) > 0) {
      value = value.slice(1, value.lastIndexOf(q));
    } else {
      const hash = value.search(/\s#/);
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

/**
 * Fill `env` from the dotenv files under `root`. Returns
 * `{ files: string[], loaded: number }` — names and counts only.
 */
export function loadServerDotenv(root, env = process.env) {
  const files = [];
  let loaded = 0;
  for (const name of ['.env.local', '.env']) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    let parsed;
    try {
      parsed = parseDotenv(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    files.push(name);
    for (const [key, value] of Object.entries(parsed)) {
      const current = env[key];
      if (current !== undefined && String(current).trim() !== '') continue;
      if (value === '') {
        if (current === undefined) env[key] = '';
        continue;
      }
      env[key] = value;
      loaded += 1;
    }
  }
  return { files, loaded };
}
