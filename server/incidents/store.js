/**
 * Incident store — user+object keyed, memory with optional KV write-through.
 *
 * Reuses the existing conversation-store pattern (memory LRU memoised on
 * globalThis per serverless instance + Vercel KV / Upstash when configured)
 * so the incident ledger shares the deployment's durability story. Keys:
 *
 *   incident:<scope>:<dedupe_key>  → Incident
 *   index:<scope>                  → string[] of dedupe keys (ordered by ingest)
 *
 * `scope` is the principal the ingest ran under — 'shared' for the server
 * seed and the secret-authenticated /ingest, or the session-scoped
 * externalUserId for the composer path — so one user's typed incidents never
 * leak into another session's list while the shared ledger is visible to all.
 */

import {
  createKvStore,
  kvConfigFromEnv,
} from '../providers/vessels/kv-store.js';

const GLOBAL_KEY = '__ondemandIncidentStoreV1__';
const DEFAULT_MAX = 5000;
const DEFAULT_TTL_SEC = 60 * 60 * 24 * 14; // 14 days
export const SHARED_SCOPE = 'shared';
const SCOPE_RE = /^[\x21-\x7e]{1,128}$/;

export function normalizeScope(scope) {
  const s = String(scope || SHARED_SCOPE);
  return SCOPE_RE.test(s) ? s : SHARED_SCOPE;
}

export function createIncidentStore(options = {}) {
  const warn = options.warn || ((m) => console.warn(m));
  const maxEntries = options.maxEntries || DEFAULT_MAX;
  const ttlSec = options.ttlSec ?? DEFAULT_TTL_SEC;
  /** @type {Map<string, Map<string, object>>} scope → (dedupe_key → incident) */
  const memory = new Map();
  let durable = null;
  const wanted = options.backend || 'auto';
  if (wanted !== 'memory') {
    const kv =
      options.kv ||
      (kvConfigFromEnv()
        ? createKvStore({ prefix: 'ondemand-incidents:', warn })
        : null);
    if (kv) durable = kv;
    else if (wanted === 'kv')
      throw new Error(
        'incident store: KV backend requested but no KV credentials',
      );
  }
  const safe = async (op, fallback) => {
    try {
      return await op();
    } catch (err) {
      warn(
        `[ondemand-incidents] durable store failed (${err?.message || err})`,
      );
      return fallback;
    }
  };
  const bucket = (scope) => {
    const s = normalizeScope(scope);
    if (!memory.has(s)) memory.set(s, new Map());
    return memory.get(s);
  };
  const hydrated = new Set();
  async function hydrate(scope) {
    const s = normalizeScope(scope);
    if (!durable || hydrated.has(s)) return;
    hydrated.add(s);
    const keys = await safe(() => durable.get(`index:${s}`), null);
    if (!Array.isArray(keys)) return;
    const map = bucket(s);
    for (const key of keys.slice(-maxEntries)) {
      if (map.has(key)) continue;
      const rec = await safe(() => durable.get(`incident:${s}:${key}`), null);
      if (rec && typeof rec === 'object') map.set(key, rec);
    }
  }

  const store = {
    backend: durable ? 'kv+memory' : 'memory',
    /**
     * Insert incidents; returns {inserted, duplicates, incidents}. Duplicate
     * dedupe keys are skipped (first writer wins) unless `replace` is set.
     */
    async upsertMany(scope, incidents, { replace = false } = {}) {
      const s = normalizeScope(scope);
      await hydrate(s);
      const map = bucket(s);
      const inserted = [];
      const duplicates = [];
      const existing = [];
      for (const inc of incidents) {
        const key = inc.dedupe_key;
        if (!key) continue;
        if (map.has(key) && !replace) {
          duplicates.push(key);
          existing.push(map.get(key));
          continue;
        }
        if (map.size >= maxEntries && !map.has(key)) {
          const oldest = map.keys().next().value;
          if (oldest !== undefined) map.delete(oldest);
        }
        map.set(key, inc);
        inserted.push(inc);
        if (durable)
          await safe(
            () => durable.set(`incident:${s}:${key}`, inc, { ttlSec }),
            false,
          );
      }
      if (durable && inserted.length)
        await safe(
          () => durable.set(`index:${s}`, [...map.keys()], { ttlSec }),
          false,
        );
      return {
        inserted,
        duplicates,
        existing,
        incidents: [...map.values()],
      };
    },
    async list(scope) {
      const s = normalizeScope(scope);
      await hydrate(s);
      return [...bucket(s).values()];
    },
    /** Shared ledger + the caller's private scope, deduped by key. */
    async listVisible(scope) {
      const shared = await store.list(SHARED_SCOPE);
      const s = normalizeScope(scope);
      if (s === SHARED_SCOPE) return shared;
      const mine = await store.list(s);
      const seen = new Set(shared.map((i) => i.dedupe_key));
      return [...shared, ...mine.filter((i) => !seen.has(i.dedupe_key))];
    },
    async size(scope) {
      return (await store.list(scope)).length;
    },
    async clear(scope) {
      memory.delete(normalizeScope(scope));
    },
  };
  return store;
}

/** Process-wide store (memoised on globalThis per serverless instance). */
export function getIncidentStore() {
  if (!globalThis[GLOBAL_KEY]) globalThis[GLOBAL_KEY] = createIncidentStore();
  return globalThis[GLOBAL_KEY];
}
export function __resetIncidentStoreForTests() {
  delete globalThis[GLOBAL_KEY];
}
