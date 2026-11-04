/**
 * Server-only OnDemand API key loader (cycle 20, 2026-10-27).
 *
 * PERSISTENT KEY SOURCE — the only supported way the key reaches this
 * process is the process environment, populated by a PERSISTENT store:
 *   • Vercel: the project Environment Variable `ONDEMAND_API_KEY`
 *     (encrypted; targets production + preview + development) — survives
 *     cold starts and redeploys.
 *   • Sandbox preview / local: the git-ignored, 0600 `.env` at the app root,
 *     loaded server-side by server/serverless/load-dotenv.js before any
 *     module reads config. The platform snapshots that file with the code
 *     and re-applies it on restart/share, so the key survives restarts.
 *
 * The earlier transient-file path (a temp secret file sourced into the
 * server shell and deleted before start-up) is REMOVED: it lost the key on
 * every restart. Nothing in this repository reads a key file any more.
 *
 * SECURITY CONTRACT
 *   • Never import from src/ (browser) — scripts/check-import-directions.mjs
 *     rejects src/ → server/ edges and this module throws if evaluated in a
 *     browser-like global scope.
 *   • The VALUE never leaves this module except through `serverKeyValue()`,
 *     which only server/ondemand/config.js calls. `serverKeyStatus()` is the
 *     public, serialisable view: configured flag, source class and env NAME —
 *     never the value, a prefix, a suffix or a hash.
 *   • Fail closed: an unset, empty or placeholder value resolves to
 *     `configured:false`; every OnDemand route then answers
 *     `credentials_required` (503) without an upstream call.
 */

if (typeof window !== 'undefined' || typeof document !== 'undefined') {
  throw new Error('server/ondemand/server-key.js is server-only');
}

/** Canonical name first, then the accepted alias (see config.js table). */
export const SERVER_KEY_ENV_NAMES = Object.freeze([
  'ONDEMAND_API_KEY',
  'ON_DEMAND_API_KEY',
]);

/** Source class reported by /health when the key came from the environment. */
export const PERSISTENT_KEY_SOURCE = 'env:persistent';

const PLACEHOLDER =
  /^(?:your[-_ ]?.*key.*|changeme|change-me|todo|xxx+|<.*>|placeholder|none|null|undefined|''|"")$/i;

function clean(raw) {
  if (typeof raw !== 'string') return '';
  let v = raw.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  if (!v || PLACEHOLDER.test(v) || /\s/.test(v)) return '';
  return v;
}

/**
 * Resolve the key from an env object. Returns the VALUE — server-internal
 * use only (config.js). `{ value, envName, source }`.
 */
export function resolveServerKey(env = process.env) {
  for (const name of SERVER_KEY_ENV_NAMES) {
    const value = clean(env[name]);
    if (value) return { value, envName: name, source: PERSISTENT_KEY_SOURCE };
  }
  return { value: '', envName: 'unset', source: 'unset' };
}

/** Serialisable status — safe for /health. Never contains the value. */
export function serverKeyStatus(env = process.env) {
  const { value, envName, source } = resolveServerKey(env);
  return {
    configured: value.length > 0,
    keySource: value ? source : 'unset',
    envName,
  };
}
