/**
 * Real plugin lifecycle state machine and verification coordinator.
 *
 * States per plugin:
 *   discovered     — contract registered, never verified
 *   installing     — being attached to a session: sessions.create({pluginIds:[id]})
 *   authenticating — session accepted; 1-shot probe query running with pluginIds:[id]
 *   ready          — probe answered; verifiedAt, latencyMs, answerPreview recorded
 *   invoking       — a user turn is currently running with this plugin
 *   failed         — any error; inactive contract maps to failed/code inactive_on_account
 *
 * Pure, injectable, no env reads.
 */

import { contractRegistry } from './contracts.js';
import { sendJson, readJsonBody } from '../http.js';

export const DEFAULT_PROBE_QUERY = 'Reply with the single word READY.';
export const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Map an upstream OnDemand error or exception to a typed lifecycle error object.
 * @param {any} err
 * @param {string} nowIso
 * @returns {{code: string, httpStatus: number, message: string, retryable: boolean, failedAt: string}}
 */
export function mapUpstreamError(err, nowIso) {
  const status = Number(err?.status || err?.httpStatus || 0);
  const upstream = err?.upstream;
  const rawMsg =
    (typeof upstream === 'object' && upstream !== null
      ? upstream.message || upstream.error
      : typeof upstream === 'string'
        ? upstream
        : '') ||
    err?.message ||
    '';

  const upstreamStr =
    typeof upstream === 'object' && upstream !== null
      ? JSON.stringify(upstream)
      : String(upstream || '');

  const hasInactiveAgent =
    err?.inactiveAgentIds ||
    upstream?.inactiveAgentIds ||
    upstreamStr.includes('inactiveAgentIds') ||
    /inactive\s+agent/i.test(rawMsg) ||
    /inactive\s+or\s+missing/i.test(rawMsg);

  const hasInvalidAgent =
    err?.invalidAgentIds ||
    upstream?.invalidAgentIds ||
    upstreamStr.includes('invalidAgentIds') ||
    /invalid\s+agent/i.test(rawMsg) ||
    /agents\s+are\s+invalid/i.test(rawMsg);

  if (status === 400 && hasInactiveAgent) {
    return {
      code: 'inactive_on_account',
      httpStatus: 400,
      message:
        rawMsg ||
        'One or more agents are inactive or missing configuration on the account',
      retryable: false,
      failedAt: nowIso,
    };
  }

  if (status === 400 && hasInvalidAgent) {
    return {
      code: 'rejected_by_session',
      httpStatus: 400,
      message: rawMsg || 'One or more agents are invalid',
      retryable: false,
      failedAt: nowIso,
    };
  }

  if (status === 401 || status === 403) {
    return {
      code: 'auth_failed',
      httpStatus: status,
      message: rawMsg || 'Authentication failed with upstream OnDemand API',
      retryable: false,
      failedAt: nowIso,
    };
  }

  if (status === 429) {
    return {
      code: 'rate_limited',
      httpStatus: 429,
      message: rawMsg || 'Rate limited by OnDemand API; retrying shortly',
      retryable: true,
      failedAt: nowIso,
    };
  }

  if (
    status >= 500 ||
    err?.name === 'OnDemandAbortError' ||
    err?.reason === 'timeout' ||
    /timeout|aborted|unavailable/i.test(rawMsg) ||
    /timeout|aborted/i.test(err?.name || '')
  ) {
    return {
      code: 'upstream_unavailable',
      httpStatus: status || 504,
      message: rawMsg || 'Upstream service unavailable or timed out',
      retryable: true,
      failedAt: nowIso,
    };
  }

  return {
    code: status ? `http_${status}` : 'unknown_error',
    httpStatus: status || 500,
    message: rawMsg || 'Verification failed',
    retryable: status >= 500,
    failedAt: nowIso,
  };
}

/**
 * Create a real plugin lifecycle manager.
 *
 * @param {object} options
 * @param {any} [options.client] OnDemand client instance
 * @param {any} [options.registry] Plugin contract registry (defaults to contractRegistry)
 * @param {() => Date|number|string} [options.now] Clock provider
 * @param {(event: string, meta: object) => void} [options.audit] Audit callback
 * @param {string} [options.probeQuery] Query to probe with (defaults to 'Reply with the single word READY.')
 * @param {string} [options.endpointId] Optional fulfillment endpoint id
 * @param {(contract: object, opts: object) => Promise<any>} [options.toolInvoker] Optional invoker for ondemand-tool
 */
export function createPluginLifecycle(options = {}) {
  const {
    client,
    registry = contractRegistry,
    now = () => new Date(),
    audit = () => {},
    probeQuery = DEFAULT_PROBE_QUERY,
    endpointId = 'predefined-gpt-6-luna',
    toolInvoker,
  } = options;

  const entries = new Map(); // key (contract.name) -> state record
  const inFlightVerifications = new Map(); // key (contract.name) -> Promise<entry>

  function getNowDate() {
    const d = now();
    return d instanceof Date ? d : new Date(d);
  }

  function getNowIso() {
    return getNowDate().toISOString();
  }

  function getContract(nameOrId) {
    if (!nameOrId) return null;
    let found = registry.get?.(nameOrId);
    if (found) return found;
    const all = registry.list ? registry.list() : [];
    found = all.find((c) => c.name === nameOrId || c.pluginId === nameOrId);
    return found || null;
  }

  function getOrCreateEntry(contract) {
    let entry = entries.get(contract.name);
    if (!entry) {
      entry = {
        name: contract.name,
        pluginId: contract.pluginId || null,
        provider: contract.provenance?.provider || contract.name,
        kind: contract.kind,
        availability: contract.availability,
        state: 'discovered',
        verifiedAt: null,
        latencyMs: null,
        error: null,
        lastInvokedAt: null,
        invocations: 0,
        answerPreview: null,
        executedAgents: null,
      };
      entries.set(contract.name, entry);
    }
    return entry;
  }

  function transition(entry, toState, { code, error, auditFn } = {}) {
    const from = entry.state;
    entry.state = toState;
    if (error !== undefined) {
      entry.error = error;
    }
    const auditHandler = auditFn || audit;
    if (typeof auditHandler === 'function') {
      const payload = {
        pluginId: entry.pluginId || entry.name,
        from,
        to: toState,
      };
      if (code) payload.code = code;
      auditHandler('plugin_state', payload);
    }
    return entry;
  }

  /**
   * Verify one plugin or tool contract.
   * Runs installing -> authenticating -> ready | failed.
   * Caches ready state for 10 minutes.
   * Deduplicates concurrent verifies for the same plugin.
   *
   * @param {string} nameOrPluginId
   * @param {{externalUserId?: string, signal?: AbortSignal, audit?: Function}} [opts]
   * @returns {Promise<object>} The updated plugin entry
   */
  async function verify(nameOrPluginId, opts = {}) {
    const contract = getContract(nameOrPluginId);
    if (!contract) {
      throw new Error(`Unknown plugin contract: "${nameOrPluginId}"`);
    }

    const entry = getOrCreateEntry(contract);
    const nowMs = getNowDate().getTime();
    const nowIso = getNowIso();

    // Cache check: ready state valid for 10 minutes
    if (
      entry.state === 'ready' &&
      entry.verifiedAt &&
      nowMs - new Date(entry.verifiedAt).getTime() < CACHE_TTL_MS
    ) {
      return entry;
    }

    // Deduplication check
    const pendingKey = contract.name;
    if (inFlightVerifications.has(pendingKey)) {
      return inFlightVerifications.get(pendingKey);
    }

    const verificationPromise = (async () => {
      // Kind: ondemand-tool
      if (contract.kind === 'ondemand-tool') {
        if (typeof toolInvoker === 'function') {
          try {
            transition(entry, 'installing', { auditFn: opts.audit });
            transition(entry, 'authenticating', { auditFn: opts.audit });
            const start = getNowDate().getTime();
            const res = await toolInvoker(contract, opts);
            const latencyMs = Math.max(0, getNowDate().getTime() - start);
            entry.verifiedAt = getNowIso();
            entry.latencyMs = latencyMs;
            entry.error = null;
            transition(entry, 'ready', { auditFn: opts.audit });
            return entry;
          } catch (err) {
            const mapped = mapUpstreamError(err, getNowIso());
            transition(entry, 'failed', {
              code: mapped.code,
              error: mapped,
              auditFn: opts.audit,
            });
            return entry;
          }
        }
        // Without toolInvoker: route-level verification is out of scope for lifecycle
        entry.state = 'discovered';
        entry.verification = 'route-level (see /api/tools)';
        return entry;
      }

      // Kind: ondemand-plugin
      // Inactive contracts fail immediately without client call
      if (contract.availability === 'inactive') {
        const error = {
          code: 'inactive_on_account',
          httpStatus: 400,
          message:
            contract.errorStates?.find((e) => e.code === 'plugin_inactive')
              ?.userMessage || 'Plugin is inactive on the account',
          retryable: false,
          failedAt: nowIso,
        };
        transition(entry, 'failed', {
          code: error.code,
          error,
          auditFn: opts.audit,
        });
        return entry;
      }

      if (!client) {
        const error = {
          code: 'not_configured',
          httpStatus: 503,
          message: 'OnDemand client is not configured',
          retryable: false,
          failedAt: nowIso,
        };
        transition(entry, 'failed', {
          code: error.code,
          error,
          auditFn: opts.audit,
        });
        return entry;
      }

      const externalUserId = opts.externalUserId || 'lifecycle-probe';
      const pluginId = contract.pluginId;
      const startMs = getNowDate().getTime();

      // Step 1: installing (attaching to session)
      transition(entry, 'installing', { auditFn: opts.audit });
      let session;
      try {
        session = await client.sessions.create(
          {
            externalUserId,
            pluginIds: [pluginId],
          },
          { signal: opts.signal },
        );
      } catch (err) {
        const mapped = mapUpstreamError(err, getNowIso());
        transition(entry, 'failed', {
          code: mapped.code,
          error: mapped,
          auditFn: opts.audit,
        });
        return entry;
      }

      // Step 2: authenticating (1-shot probe query)
      transition(entry, 'authenticating', { auditFn: opts.audit });
      let queryRes;
      try {
        queryRes = await client.query.sync(
          session.id,
          {
            query: probeQuery,
            pluginIds: [pluginId],
            responseMode: 'sync',
            ...(endpointId ? { endpointId } : {}),
          },
          { signal: opts.signal },
        );
      } catch (err) {
        const mapped = mapUpstreamError(err, getNowIso());
        transition(entry, 'failed', {
          code: mapped.code,
          error: mapped,
          auditFn: opts.audit,
        });
        return entry;
      }

      // Step 3: ready (probe answered)
      const latencyMs = Math.max(0, getNowDate().getTime() - startMs);
      const rawAnswer =
        queryRes?.data?.answer || queryRes?.answer || queryRes?.message || '';
      const answerPreview = String(rawAnswer).slice(0, 120);

      const executedAgents =
        queryRes?.data?.executedAgents ||
        queryRes?.executedAgents ||
        queryRes?.data?.metrics?.executedAgents ||
        null;

      entry.verifiedAt = getNowIso();
      entry.latencyMs = latencyMs;
      entry.answerPreview = answerPreview;
      if (executedAgents) {
        entry.executedAgents = executedAgents;
      }
      entry.error = null;
      transition(entry, 'ready', { auditFn: opts.audit });
      return entry;
    })();

    inFlightVerifications.set(pendingKey, verificationPromise);
    try {
      return await verificationPromise;
    } finally {
      inFlightVerifications.delete(pendingKey);
    }
  }

  /**
   * Verify all active plugin contracts with concurrency limit.
   *
   * @param {{externalUserId?: string, concurrency?: number, signal?: AbortSignal}} [opts]
   * @returns {Promise<object[]>}
   */
  async function verifyAll({ externalUserId, concurrency = 2, signal } = {}) {
    const activeContracts = registry.list
      ? registry.list({ kind: 'ondemand-plugin', availability: 'active' })
      : [];
    const results = [];
    const queue = [...activeContracts];
    const poolSize = Math.max(1, Math.min(concurrency, queue.length || 1));

    const workers = Array.from({ length: poolSize }, async () => {
      while (queue.length > 0) {
        if (signal?.aborted) break;
        const c = queue.shift();
        if (!c) break;
        const res = await verify(c.name, { externalUserId, signal });
        results.push(res);
      }
    });

    await Promise.all(workers);
    return results;
  }

  /**
   * Mark a plugin as actively invoking during a user turn.
   *
   * @param {string} pluginId
   * @param {string} [turnId]
   * @returns {object|null}
   */
  function markInvoking(pluginId, turnId) {
    const contract = getContract(pluginId);
    if (!contract) return null;
    const entry = getOrCreateEntry(contract);
    entry.lastInvokedAt = getNowIso();
    transition(entry, 'invoking');
    return entry;
  }

  /**
   * Mark a plugin invocation as finished.
   *
   * @param {string} pluginId
   * @param {{ok?: boolean, error?: any}} [result]
   * @returns {object|null}
   */
  function markInvoked(pluginId, { ok = true, error = null } = {}) {
    const contract = getContract(pluginId);
    if (!contract) return null;
    const entry = getOrCreateEntry(contract);
    entry.invocations = (entry.invocations || 0) + 1;

    if (ok) {
      transition(entry, 'ready');
      entry.error = null;
    } else {
      const errObj = error
        ? mapUpstreamError(error, getNowIso())
        : {
            code: 'invocation_failed',
            httpStatus: 500,
            message: 'Plugin invocation failed',
            retryable: false,
            failedAt: getNowIso(),
          };
      transition(entry, 'failed', { code: errObj.code, error: errObj });
    }
    return entry;
  }

  /**
   * Return a snapshot of all registered plugins and tools.
   */
  function snapshot() {
    const all = registry.list ? registry.list() : [];
    const relevant = all.filter(
      (c) => c.kind === 'ondemand-plugin' || c.kind === 'ondemand-tool',
    );

    return {
      generatedAt: getNowIso(),
      plugins: relevant.map((c) => {
        const entry = getOrCreateEntry(c);
        return {
          name: c.name,
          pluginId: c.pluginId || null,
          provider: c.provenance?.provider || c.name,
          kind: c.kind,
          availability: c.availability,
          state: entry.state,
          verifiedAt: entry.verifiedAt || null,
          latencyMs: entry.latencyMs ?? null,
          error: entry.error || null,
          lastInvokedAt: entry.lastInvokedAt || null,
          invocations: entry.invocations || 0,
          ...(entry.answerPreview
            ? { answerPreview: entry.answerPreview }
            : {}),
          ...(entry.executedAgents
            ? { executedAgents: entry.executedAgents }
            : {}),
          ...(c.kind === 'ondemand-tool' && !toolInvoker
            ? { verification: 'route-level (see /api/tools)' }
            : {}),
        };
      }),
    };
  }

  /**
   * Handle HTTP requests for plugin routes.
   * Serves:
   *   GET  /plugins        -> snapshot()
   *   POST /plugins/verify -> { externalUserId, names?: string[] }
   *
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {{path: string, method: string, authorize?: Function, audit?: Function}} context
   * @returns {Promise<boolean>} true if handled, false otherwise
   */
  async function handle(
    req,
    res,
    { path, method, authorize, audit: handleAudit } = {},
  ) {
    if (path === '/plugins') {
      if (method === 'GET') {
        sendJson(res, 200, snapshot());
        return true;
      }
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    if (path === '/plugins/verify') {
      if (method === 'POST') {
        let body;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          sendJson(res, err?.status || 400, {
            error: err?.message || 'invalid_body',
          });
          return true;
        }

        const externalUserId = body?.externalUserId || 'anonymous';
        if (typeof authorize === 'function') {
          const auth = authorize(externalUserId);
          if (!auth) return true; // authorize already sent 403
        }

        let namesToVerify = [];
        if (Array.isArray(body?.names) && body.names.length > 0) {
          namesToVerify = body.names;
        } else {
          namesToVerify = (
            registry.list
              ? registry.list({
                  kind: 'ondemand-plugin',
                  availability: 'active',
                })
              : []
          ).map((c) => c.name);
        }

        const updatedEntries = await Promise.all(
          namesToVerify.map((name) =>
            verify(name, { externalUserId, audit: handleAudit }),
          ),
        );

        sendJson(res, 200, {
          plugins: updatedEntries.map((e) => ({
            name: e.name,
            pluginId: e.pluginId,
            provider: e.provider,
            kind: e.kind,
            availability: e.availability,
            state: e.state,
            verifiedAt: e.verifiedAt,
            latencyMs: e.latencyMs,
            error: e.error,
            lastInvokedAt: e.lastInvokedAt,
            invocations: e.invocations,
            ...(e.answerPreview ? { answerPreview: e.answerPreview } : {}),
            ...(e.executedAgents ? { executedAgents: e.executedAgents } : {}),
          })),
        });
        return true;
      }
      sendJson(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    return false;
  }

  return {
    snapshot,
    verify,
    verifyAll,
    markInvoking,
    markInvoked,
    handle,
  };
}
