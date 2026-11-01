/**
 * OnDemand Session Manager — maintains sessions with purpose keys,
 * reference counts (preventing mid-stream eviction), TTL/LRU cleanup,
 * and strict separation of session IDs from model/endpoint IDs.
 *
 * Contract: src/cinematic/CONTRACT.md §A
 */
import { randomUUID } from 'node:crypto';
import { ondemandFetch } from '../client.js';
import { config } from '../config.js';

export const DEFAULT_SESSION_TTL_MS = 1500000; // 25 minutes
export const DEFAULT_MAX_SESSIONS = 200;

export function createDefaultSessionTransport({
  fetchImpl = ondemandFetch,
  getSettings = () => config,
} = {}) {
  return {
    async createSession(pluginIds = [], { signal } = {}) {
      const settings = getSettings();
      if (!settings?.apiKey) {
        throw new Error(
          'Server-side OnDemand authentication is not configured.',
        );
      }
      const externalUserId = `cinematic-${randomUUID()}`;
      const baseUrl = (settings.baseUrl || 'https://api.on-demand.io').replace(
        /\/$/,
        '',
      );
      const res = await fetchImpl(`${baseUrl}/chat/v1/sessions`, {
        method: 'POST',
        body: { externalUserId, pluginIds },
        signal,
        timeoutMs: 15000,
      });
      if (!res.ok) {
        throw new Error(`Failed to create session: HTTP ${res.status}`);
      }
      const body = await res.json();
      const id = body?.data?.id;
      if (!id || typeof id !== 'string') {
        throw new Error('OnDemand provider returned an invalid session ID.');
      }
      return { id, externalUserId, pluginIds };
    },
  };
}

export function createSessionManager({
  transport = createDefaultSessionTransport(),
  ttlMs = DEFAULT_SESSION_TTL_MS,
  maxSessions = DEFAULT_MAX_SESSIONS,
  now = () => Date.now(),
} = {}) {
  // Map of id -> sessionRecord
  const sessions = new Map();

  async function acquire({
    purpose = 'default',
    pluginIds = [],
    reuse = true,
    signal,
  } = {}) {
    const currentNow = now();

    // Check for an existing session to reuse for this purpose
    if (reuse) {
      for (const sess of sessions.values()) {
        if (sess.purpose === purpose) {
          // Verify matching pluginIds
          const samePlugins =
            sess.pluginIds.length === pluginIds.length &&
            sess.pluginIds.every((p, i) => p === pluginIds[i]);
          if (samePlugins) {
            sess.refs += 1;
            sess.lastUsedAt = currentNow;
            return sess;
          }
        }
      }
    }

    // Create a new session via transport
    const created = await transport.createSession(pluginIds, { signal });
    const record = {
      id: created.id,
      externalUserId: created.externalUserId,
      pluginIds: Array.isArray(pluginIds) ? [...pluginIds] : [],
      purpose: String(purpose || 'default'),
      createdAt: currentNow,
      lastUsedAt: currentNow,
      refs: 1,
    };

    sessions.set(record.id, record);

    // Run background cleanup if capacity reached
    if (sessions.size > maxSessions) {
      cleanup({ now: currentNow });
    }

    return record;
  }

  function release(id) {
    const sess = sessions.get(id);
    if (!sess) return null;
    sess.refs = Math.max(0, sess.refs - 1);
    sess.lastUsedAt = now();
    return sess;
  }

  function reset(purpose) {
    const targetPurpose = String(purpose || 'default');
    const toReset = [];
    for (const sess of sessions.values()) {
      if (sess.purpose === targetPurpose) {
        if (sess.refs > 0) {
          return { reset: false, reason: 'active_stream' };
        }
        toReset.push(sess.id);
      }
    }

    for (const id of toReset) {
      sessions.delete(id);
    }

    return { reset: true, count: toReset.length };
  }

  function cleanup({ now: currentNow } = {}) {
    const t = currentNow ?? now();
    let evicted = 0;

    // 1. Evict idle sessions past TTL
    for (const [id, sess] of sessions.entries()) {
      if (sess.refs === 0 && t - sess.lastUsedAt > ttlMs) {
        sessions.delete(id);
        evicted++;
      }
    }

    // 2. If still over maxSessions, evict oldest idle sessions (LRU)
    if (sessions.size > maxSessions) {
      const idleSessions = [];
      for (const sess of sessions.values()) {
        if (sess.refs === 0) {
          idleSessions.push(sess);
        }
      }
      idleSessions.sort((a, b) => a.lastUsedAt - b.lastUsedAt);

      for (const sess of idleSessions) {
        if (sessions.size <= maxSessions) break;
        sessions.delete(sess.id);
        evicted++;
      }
    }

    return { evicted };
  }

  function stats() {
    let active = 0;
    const byPurpose = {};

    for (const sess of sessions.values()) {
      const isActive = sess.refs > 0;
      if (isActive) active++;

      if (!byPurpose[sess.purpose]) {
        byPurpose[sess.purpose] = { count: 0, active: 0 };
      }
      byPurpose[sess.purpose].count++;
      if (isActive) {
        byPurpose[sess.purpose].active++;
      }
    }

    return {
      total: sessions.size,
      active,
      byPurpose,
    };
  }

  return {
    acquire,
    release,
    reset,
    cleanup,
    stats,
  };
}
