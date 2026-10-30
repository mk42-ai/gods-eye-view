/**
 * OnDemand foundation — conversation store.
 *
 * Keys an isolated OnDemand chat session by
 *   externalUserId + objectContextKey          (→ sessionId)
 * so every workstation object (an aircraft, a camera, a layer panel, a
 * scene card …) gets its OWN mini-chat session, isolated per user. This is
 * the server-side counterpart of the browser-side
 * `ondemand.session.<entityKey>` localStorage keys in
 * src/ondemand/entityChat.js:47 — the browser may still cache the id, but
 * the server is now the source of truth and never needs the key.
 *
 * Backends (chosen at runtime, same interface):
 *   • memory  — LRU Map memoised on globalThis (per serverless instance; the
 *               same strategy server/ondemand/sessions-store.js already uses)
 *   • kv      — Vercel KV / Upstash REST when KV_REST_API_URL+TOKEN or
 *               UPSTASH_REDIS_REST_URL+TOKEN are present (durable across
 *               instances; wraps server/providers/vessels/kv-store.js)
 * The memory backend is ALWAYS present as a write-through cache in front of
 * KV, so a KV outage degrades to per-instance behaviour instead of failing.
 */

import {
  createKvStore,
  kvConfigFromEnv,
} from '../../providers/vessels/kv-store.js';

const GLOBAL_KEY = '__ondemandConversationStoreV1__';
const DEFAULT_MAX = 2000;
const DEFAULT_TTL_SEC = 60 * 60 * 24 * 7; // 7 days
const KEY_RE = /^[\x21-\x7e]{1,128}$/;

/**
 * @typedef {object} ConversationRecord
 * @property {string} sessionId
 * @property {string} externalUserId
 * @property {string} objectContextKey
 * @property {object} [objectContext]   last context payload (small, ≤ 8 KB)
 * @property {string[]} [pluginIds]
 * @property {string} createdAt
 * @property {string} lastUsedAt
 * @property {number} turns
 */

/**
 * Stable key for an object context. Accepts either a prebuilt string or
 * `{objectType, objectId}`; sanitises to printable ASCII.
 * @param {string|{objectType:string, objectId:string}} ctx
 */
export function objectContextKey(ctx) {
  const raw =
    typeof ctx === 'string'
      ? ctx
      : ctx && ctx.objectType && ctx.objectId
        ? `${ctx.objectType}:${ctx.objectId}`
        : 'global';
  const cleaned = String(raw)
    .replace(/[^\x21-\x7e]/g, '_')
    .slice(0, 128);
  if (!KEY_RE.test(cleaned)) return 'global';
  return cleaned;
}

export function conversationKey(externalUserId, objectContextKeyValue) {
  if (!KEY_RE.test(String(externalUserId)))
    throw new Error('externalUserId: printable ASCII ≤128');
  return `${externalUserId}\u0000${objectContextKey(objectContextKeyValue)}`;
}

function createMemoryBackend(maxEntries = DEFAULT_MAX) {
  const map = new Map();
  return {
    kind: 'memory',
    async get(key) {
      const rec = map.get(key);
      if (!rec) return undefined;
      map.delete(key);
      map.set(key, rec);
      return rec;
    },
    async set(key, rec) {
      if (map.size >= maxEntries && !map.has(key)) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      map.delete(key);
      map.set(key, rec);
    },
    async delete(key) {
      return map.delete(key);
    },
    async listByUser(externalUserId) {
      const prefix = `${externalUserId}\u0000`;
      return [...map.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([, v]) => v);
    },
    size() {
      return map.size;
    },
  };
}

function createKvBackend(kv, ttlSec) {
  const k = (key) => `conv:${Buffer.from(key, 'utf8').toString('base64url')}`;
  return {
    kind: 'kv',
    async get(key) {
      const v = await kv.get(k(key));
      return v && typeof v === 'object' ? v : undefined;
    },
    async set(key, rec) {
      await kv.set(k(key), rec, { ttlSec });
    },
    async delete(key) {
      if (typeof kv.delete === 'function') return kv.delete(k(key));
      await kv.set(k(key), null, { ttlSec: 1 });
      return true;
    },
    async listByUser() {
      return []; // REST KV has no cheap prefix scan; memory layer answers this.
    },
    size() {
      return -1;
    },
  };
}

/**
 * @param {object} [options]
 * @param {'auto'|'memory'|'kv'} [options.backend='auto']
 * @param {number} [options.maxEntries]
 * @param {number} [options.ttlSec]
 * @param {object} [options.kv]  injected KV store (tests)
 * @param {(line:string)=>void} [options.warn]
 */
export function createConversationStore(options = {}) {
  const memory = createMemoryBackend(options.maxEntries);
  const warn = options.warn || ((m) => console.warn(m));
  let durable = null;
  const wanted = options.backend || 'auto';
  if (wanted !== 'memory') {
    const kv =
      options.kv ||
      (kvConfigFromEnv()
        ? createKvStore({ prefix: 'ondemand-conv:', warn })
        : null);
    if (kv) durable = createKvBackend(kv, options.ttlSec ?? DEFAULT_TTL_SEC);
    else if (wanted === 'kv')
      throw new Error(
        'conversation store: KV backend requested but no KV credentials',
      );
  }
  const now = () => new Date().toISOString();

  async function safe(op, fallback) {
    try {
      return await op();
    } catch (err) {
      warn(
        `[ondemand-conversations] durable store failed, using memory only (${err?.message || err})`,
      );
      return fallback;
    }
  }

  const store = {
    backend: durable ? 'kv+memory' : 'memory',
    /** @returns {Promise<ConversationRecord|undefined>} */
    async get(externalUserId, ctx) {
      const key = conversationKey(externalUserId, ctx);
      const hit = await memory.get(key);
      if (hit) return hit;
      if (!durable) return undefined;
      const rec = await safe(() => durable.get(key), undefined);
      if (rec) await memory.set(key, rec);
      return rec;
    },
    /** Create or replace the record for (user, ctx). */
    async put(externalUserId, ctx, partial) {
      const key = conversationKey(externalUserId, ctx);
      const existing =
        (await memory.get(key)) ||
        (durable ? await safe(() => durable.get(key), undefined) : undefined);
      const rec = {
        externalUserId,
        objectContextKey: objectContextKey(ctx),
        createdAt: existing?.createdAt || now(),
        turns: existing?.turns || 0,
        ...existing,
        ...partial,
        lastUsedAt: now(),
      };
      if (
        rec.objectContext &&
        JSON.stringify(rec.objectContext).length > 8192
      ) {
        rec.objectContext = {
          truncated: true,
          objectType: rec.objectContext.objectType,
          objectId: rec.objectContext.objectId,
        };
      }
      await memory.set(key, rec);
      if (durable) await safe(() => durable.set(key, rec), undefined);
      return rec;
    },
    /** Bump usage counters after a successful turn. */
    async touch(externalUserId, ctx) {
      const rec = await store.get(externalUserId, ctx);
      if (!rec) return undefined;
      return store.put(externalUserId, ctx, { turns: (rec.turns || 0) + 1 });
    },
    /** Close = forget the mapping (OnDemand has no documented session-close endpoint; a new session is created next time). */
    async close(externalUserId, ctx) {
      const key = conversationKey(externalUserId, ctx);
      await memory.delete(key);
      if (durable) await safe(() => durable.delete(key), undefined);
      return true;
    },
    async listByUser(externalUserId) {
      return memory.listByUser(externalUserId);
    },
    size() {
      return memory.size();
    },
  };
  return store;
}

/** Process-wide store (memoised on globalThis per serverless instance). */
export function getConversationStore() {
  if (!globalThis[GLOBAL_KEY])
    globalThis[GLOBAL_KEY] = createConversationStore();
  return globalThis[GLOBAL_KEY];
}
export function __resetConversationStoreForTests() {
  delete globalThis[GLOBAL_KEY];
}
