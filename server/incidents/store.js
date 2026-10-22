/**
 * server/incidents/store.js — durable-ish persistence for UAE AOI incidents.
 *
 * Backends (same interface, chosen at runtime):
 *   • kv     — Vercel KV / Upstash REST when configured (durable across
 *              instances; wraps server/providers/vessels/kv-store.js, the same
 *              adapter the conversation store uses).
 *   • file   — a JSON file under the OS temp dir (`/tmp` on Vercel — the only
 *              writable path; survives warm invocations of one instance).
 *   • memory — always present as a write-through cache memoised on globalThis.
 *
 * The store is seeded from src/data/local_data/uae-aoi/uae-aoi-seed-incidents.json
 * on first read (`source: 'seed'`), after which it reports `source: 'store'`.
 * Every record is normalised by src/data/uaeIncidents.js before it is kept.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createKvStore,
  kvConfigFromEnv,
} from '../providers/vessels/kv-store.js';
import {
  seedIncidents,
  normaliseIncident,
  dedupeIncidents,
  countsByGroup,
} from '../../src/data/uaeIncidents.js';

const GLOBAL_KEY = '__uaeIncidentStoreV1__';
const KV_KEY = 'incidents';
const KV_TTL_SEC = 60 * 60 * 24 * 30;
const MAX_INCIDENTS = 2000;

/**
 * @typedef {object} IncidentDocument
 * @property {Array<object>} incidents
 * @property {string|null} lastRefreshUtc
 * @property {'seed'|'store'} source
 * @property {string} updatedAt
 */

function emptyDocument(now) {
  return {
    incidents: seedIncidents(),
    lastRefreshUtc: null,
    source: 'seed',
    updatedAt: now().toISOString(),
    seededAt: now().toISOString(),
  };
}

/**
 * @param {object} [options]
 * @param {string} [options.filePath] JSON file path (default <tmpdir>/ondemand-spatial-incidents.json)
 * @param {object|null} [options.kv]   pre-built kv store (default from env)
 * @param {() => Date} [options.now]
 * @param {(message:string) => void} [options.warn]
 */
export function createIncidentStore({
  filePath = path.join(os.tmpdir(), 'ondemand-spatial-incidents.json'),
  kv = createKvStore({
    config: kvConfigFromEnv(),
    prefix: 'uae-incidents:',
    warn: () => {},
  }),
  now = () => new Date(),
  warn = (m) => console.warn(m),
  disableFile = false,
} = {}) {
  /** @type {IncidentDocument|null} */
  let cache = null;
  let loading = null;
  let writing = Promise.resolve();
  let lock = null;

  async function readFile() {
    if (disableFile) return null;
    try {
      const text = await fs.readFile(filePath, 'utf8');
      const doc = JSON.parse(text);
      return Array.isArray(doc?.incidents) ? doc : null;
    } catch {
      return null;
    }
  }

  async function writeFile(doc) {
    if (disableFile) return false;
    try {
      const tmp = `${filePath}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(doc), 'utf8');
      await fs.rename(tmp, filePath);
      return true;
    } catch (error) {
      warn(`[incidents] file persistence failed: ${error?.message || error}`);
      return false;
    }
  }

  async function load() {
    if (cache) return cache;
    if (loading) return loading;
    loading = (async () => {
      let doc = null;
      if (kv?.enabled) doc = await kv.get(KV_KEY);
      if (!doc) doc = await readFile();
      if (!doc) doc = emptyDocument(now);
      doc.incidents = doc.incidents
        .map((incident) => {
          try {
            return normaliseIncident(incident, { now });
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      cache = doc;
      return doc;
    })();
    try {
      return await loading;
    } finally {
      loading = null;
    }
  }

  async function persist(doc) {
    cache = doc;
    const job = writing.then(async () => {
      const results = { file: false, kv: false };
      results.file = await writeFile(doc);
      if (kv?.enabled)
        results.kv = await kv.set(KV_KEY, doc, { ttlSec: KV_TTL_SEC });
      return results;
    });
    writing = job.catch(() => {});
    return job;
  }

  return {
    get backend() {
      return kv?.enabled
        ? 'kv+file+memory'
        : disableFile
          ? 'memory'
          : 'file+memory';
    },
    filePath,
    /** Current document (seeding on first use). */
    async read() {
      const doc = await load();
      return {
        incidents: [...doc.incidents],
        lastRefreshUtc: doc.lastRefreshUtc || null,
        source: doc.source,
        counts: countsByGroup(doc.incidents),
        seededAt: doc.seededAt || null,
        updatedAt: doc.updatedAt,
      };
    },
    /**
     * Ingest incidents: normalise, dedupe against the store (headline +
     * 0.1° cell + 24 h), persist, report what happened.
     * @param {Array<object>} rawIncidents already-validated or raw incident objects
     * @param {{refresh?: boolean, allowOutside?: boolean}} [options]
     */
    async ingest(rawIncidents, { refresh = false, allowOutside = true } = {}) {
      const doc = await load();
      const added = [];
      const rejected = [];
      const normalised = [];
      for (const raw of rawIncidents || []) {
        try {
          const incident = normaliseIncident(raw, { now });
          if (!allowOutside && !incident.insideAoi) {
            rejected.push({
              headline: incident.headline,
              reason: 'outside_aoi',
            });
            continue;
          }
          normalised.push({
            ...incident,
            ingested_at: incident.ingested_at || now().toISOString(),
          });
        } catch (error) {
          rejected.push({
            headline: String(raw?.headline || '').slice(0, 120),
            reason: error?.message || 'invalid',
          });
        }
      }
      const { kept, dropped } = dedupeIncidents([
        ...doc.incidents,
        ...normalised,
      ]);
      const existingIds = new Set(doc.incidents.map((i) => i.id));
      for (const incident of kept)
        if (!existingIds.has(incident.id)) added.push(incident);
      const next = {
        ...doc,
        incidents: kept.slice(-MAX_INCIDENTS),
        source: 'store',
        updatedAt: now().toISOString(),
        ...(refresh ? { lastRefreshUtc: now().toISOString() } : {}),
      };
      const persisted = await persist(next);
      return {
        added,
        duplicates: dropped.map((d) => ({
          headline: d.headline,
          duplicateOf: d.duplicateOf,
        })),
        rejected,
        total: next.incidents.length,
        counts: countsByGroup(next.incidents),
        lastRefreshUtc: next.lastRefreshUtc,
        source: next.source,
        persisted,
      };
    },
    /** Mark a refresh that added nothing (keeps lastRefreshUtc honest). */
    async touchRefresh() {
      const doc = await load();
      const next = {
        ...doc,
        source: 'store',
        lastRefreshUtc: now().toISOString(),
        updatedAt: now().toISOString(),
      };
      await persist(next);
      return next.lastRefreshUtc;
    },
    /**
     * In-flight lock so concurrent refreshes share one run instead of
     * double-ingesting. Returns `{ held:true, release }` or `{ held:false, promise }`.
     */
    acquireRefreshLock() {
      if (lock) return { held: false, promise: lock.promise };
      let release;
      const promise = new Promise((resolve) => {
        release = resolve;
      });
      lock = { promise };
      return {
        held: true,
        release: (value) => {
          lock = null;
          release(value);
        },
      };
    },
    /** Test helper: drop the cache so the next read reloads. */
    __reset() {
      cache = null;
    },
  };
}

/** Process-wide singleton memoised on globalThis (warm Vercel instances reuse it). */
export function getIncidentStore() {
  const g = /** @type {any} */ (globalThis);
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = createIncidentStore();
  return g[GLOBAL_KEY];
}

export function __resetIncidentStoreForTests() {
  delete (/** @type {any} */ (globalThis)[GLOBAL_KEY]);
}
