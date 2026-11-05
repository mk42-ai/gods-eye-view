/**
 * Footage retrieval metrics collector.
 *
 * Populated ONLY by executed requests inside snapchat.js ladder + fanout.js.
 * Tracks attempted/succeeded/failed requests, rate-limit state (honouring 429/Retry-After),
 * the transport used (direct plugin query, one session per run), deduplication
 * numbers (raw, unique, duplicates, relevant), timestamps, and error records.
 */

export function createFootageMetrics({ now = () => Date.now() } = {}) {
  let requestsAttempted = 0;
  let requestsSucceeded = 0;
  let requestsFailed = 0;
  let results = 0;
  let unique = 0;
  let duplicates = 0;
  let relevant = 0;
  let transportState = 'direct-plugin-query';
  let sessionsPerRun = 1;
  let rateLimit = {
    state: 'ok',
    remaining: undefined,
    resetAt: null,
  };
  let startedAt = null;
  let finishedAt = null;
  const errors = [];

  const timeIso = () => {
    const val = now();
    return typeof val === 'string' ? val : new Date(val).toISOString();
  };

  return {
    start(step = 'request') {
      requestsAttempted += 1;
      const t = timeIso();
      if (!startedAt) startedAt = t;
      finishedAt = t;
      return { step, startedAt: t };
    },

    success(step = 'request', { status = 200 } = {}) {
      requestsSucceeded += 1;
      finishedAt = timeIso();
    },

    failure(step = 'request', { status = 500, code, error } = {}) {
      requestsFailed += 1;
      finishedAt = timeIso();
      const errCode =
        code ||
        (error instanceof Error ? error.message : null) ||
        (typeof error === 'string' ? error : `HTTP_${status}`);
      errors.push({
        step: String(step),
        ...(typeof status === 'number' ? { status } : {}),
        ...(errCode ? { code: String(errCode) } : {}),
      });
      if (status === 429) {
        rateLimit.state = 'throttled';
      }
    },

    rateLimit({ remaining, resetAt, state } = {}) {
      if (state) {
        rateLimit.state = state;
      } else if (remaining === 0) {
        rateLimit.state = 'throttled';
      } else if (remaining !== undefined && remaining > 0) {
        rateLimit.state = 'ok';
      }
      if (remaining !== undefined) rateLimit.remaining = remaining;
      if (resetAt !== undefined) rateLimit.resetAt = resetAt;
    },

    transport({ state, sessionsPerRun: spr } = {}) {
      if (state !== undefined && state !== null) {
        transportState = String(state);
      }
      if (Number.isFinite(spr)) sessionsPerRun = spr;
    },

    record({ raw, unique: u, duplicates: d, relevant: r } = {}) {
      if (typeof raw === 'number' && Number.isFinite(raw)) results = raw;
      if (typeof u === 'number' && Number.isFinite(u)) unique = u;
      if (typeof d === 'number' && Number.isFinite(d)) duplicates = d;
      else if (typeof raw === 'number' && typeof u === 'number') {
        duplicates = Math.max(0, raw - u);
      }
      if (typeof r === 'number' && Number.isFinite(r)) relevant = r;
    },

    snapshot() {
      return {
        requestsAttempted,
        requestsSucceeded,
        requestsFailed,
        results,
        unique,
        duplicates,
        relevant,
        transport: transportState,
        sessionsPerRun,
        rateLimit: { ...rateLimit },
        startedAt,
        finishedAt,
        errors: [...errors],
      };
    },
  };
}

/**
 * Format metrics for the panel line.
 * Formats: "Requests A attempted · S ok · F failed · R results · U unique · D duplicates · V relevant · transport: <state> · rate limit: <state>"
 * Plus when verified=0: " · unverified: <reason>"
 */
export function formatFootageMetrics(
  snapshot,
  { verified = 0, unverifiedReason } = {},
) {
  const s = snapshot || {};
  const attempted = s.requestsAttempted ?? 0;
  const ok = s.requestsSucceeded ?? 0;
  const failed = s.requestsFailed ?? 0;
  const res = s.results ?? 0;
  const u = s.unique ?? 0;
  const d = s.duplicates ?? 0;
  const r = s.relevant ?? 0;
  const tState = s.transport || 'direct-plugin-query';
  const rlState = s.rateLimit?.state || 'ok';

  let line = `Requests ${attempted} attempted · ${ok} ok · ${failed} failed · ${res} results · ${u} unique · ${d} duplicates · ${r} relevant · transport: ${tState} · rate limit: ${rlState}`;

  if (verified === 0) {
    const reason =
      unverifiedReason ||
      'no capture time / coordinates (Spotlight text matches only)';
    line += ` · unverified: ${reason}`;
  }

  return line;
}
