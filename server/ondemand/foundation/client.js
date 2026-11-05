/**
 * OnDemand foundation — typed, server-side-only client.
 *
 * SECURITY CONTRACT
 *   • The apikey is read from `config.apiKey` (server/ondemand/config.js →
 *     process.env.ONDEMAND_API_KEY) ONLY inside `createOnDemandClient()`.
 *     It is never logged, never returned, never placed on a response.
 *   • This module must never be imported from `src/` (browser bundle). The
 *     boundary gate (scripts/check-import-directions.mjs) already forbids
 *     src/ → server/ edges; `src/ondemand/noKeyInBundle.test.mjs` proves no
 *     key literal ships in the bundle.
 *   • There is NO per-request key override here. The legacy
 *     browser-held-key header pattern (docs/ENTITY_CHAT.md "Key override")
 *     stays available only through the OLD handlers when
 *     `ONDEMAND_ALLOW_CLIENT_KEY=1` (dev flag, see docs/agent-execution/
 *     MASTER_STATE.md "Key handling"); the new proxy route
 *     (api/ondemand/v2/[...path].js) ignores that header entirely.
 *
 * FEATURES (task §7): session lifecycle (create / reuse / close), pagination
 * helpers, SSE streaming with abort propagation + heartbeats, retries with
 * exponential backoff + jitter, 429 Retry-After handling, per-call timeouts,
 * typed schemas (./types.js).
 *
 * Every endpoint path below is the live-documented one (2026-10-20):
 *   POST /chat/v1/sessions · GET /chat/v1/sessions · GET /chat/v1/sessions/{id}
 *   GET  /chat/v1/sessions/{id}/messages · POST /chat/v1/sessions/{id}/query
 *   GET/POST /media/v1/public/file · DELETE /media/v1/public/file/{fileId}
 *   GET  /automation/api/workflow/{id} · POST /automation/api/workflow/{id}/execute
 *   GET  /automation/api/execution/{executionID}[/logs|/node/outputs] · GET /automation/api/execution/list
 */

import { config, baseUrls, isConfigured, requestTimeoutMs } from '../config.js';
import {
  validateCreateSession,
  validateSubmitQuery,
  validateObjectId,
  validateExternalUserId,
} from './types.js';

export const DEFAULT_RETRY = Object.freeze({
  retries: 3,
  baseDelayMs: 300,
  maxDelayMs: 4000,
  retryOn: Object.freeze([408, 425, 429, 500, 502, 503, 504, 524]),
});

/** Thrown when the upstream answers with a non-2xx status. */
export class OnDemandHttpError extends Error {
  /**
   * @param {number} status
   * @param {object|string|null} upstream  capped/parsed upstream body (never carries the key)
   * @param {{url:string, method:string, attempt:number, retryAfterMs?:number, traceId?:string}} meta
   */
  constructor(status, upstream, meta) {
    super(`ondemand_http_${status}`);
    this.name = 'OnDemandHttpError';
    this.status = status;
    this.upstream = upstream;
    this.meta = meta;
    this.retryable = DEFAULT_RETRY.retryOn.includes(status);
    this.rateLimited = status === 429;
  }
}

/** Thrown when the client is not configured (no server key). */
export class OnDemandNotConfiguredError extends Error {
  constructor() {
    super('ONDEMAND_API_KEY is not set on the server');
    this.name = 'OnDemandNotConfiguredError';
    this.status = 503;
  }
}

/** Thrown when a call exceeds its timeout or is aborted by the caller. */
export class OnDemandAbortError extends Error {
  /** @param {'timeout'|'aborted'} reason */
  constructor(reason) {
    super(`ondemand_${reason}`);
    this.name = 'OnDemandAbortError';
    this.reason = reason;
    this.status = reason === 'timeout' ? 504 : 499;
  }
}

const MAX_UPSTREAM_TEXT = 2048;

/** Redact anything that looks like the configured key or a long token. */
export function redact(text, apiKey) {
  let out = String(text ?? '');
  if (apiKey && apiKey.length >= 8) out = out.split(apiKey).join('<redacted>');
  return out.replace(/[A-Za-z0-9_-]{40,}/g, '<redacted-long-token>');
}

async function readUpstreamEnvelope(res, apiKey) {
  let raw = '';
  try {
    raw = await res.text();
  } catch {
    raw = '';
  }
  const capped = redact(raw.slice(0, MAX_UPSTREAM_TEXT), apiKey);
  try {
    const parsed = JSON.parse(capped);
    return parsed && typeof parsed === 'object' ? parsed : capped;
  } catch {
    return capped;
  }
}

function parseRetryAfterMs(header) {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

function backoffDelay(attempt, retry, retryAfterMs) {
  if (retryAfterMs !== undefined)
    return Math.min(retryAfterMs, retry.maxDelayMs * 4);
  const exp = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** attempt);
  return Math.round(exp / 2 + Math.random() * (exp / 2)); // full-jitter-ish
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new OnDemandAbortError('aborted'));
    const t = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(new OnDemandAbortError('aborted'));
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/**
 * Combine a caller signal with a timeout into one AbortSignal.
 * @returns {{signal: AbortSignal, cleanup: () => void, timedOut: () => boolean}}
 */
export function linkedSignal(callerSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : undefined;
  const onAbort = () => controller.abort();
  callerSignal?.addEventListener?.('abort', onAbort, { once: true });
  if (callerSignal?.aborted) controller.abort();
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup() {
      if (timer) clearTimeout(timer);
      callerSignal?.removeEventListener?.('abort', onAbort);
    },
  };
}

/**
 * Parse an SSE byte stream into events. Yields `{event, data, answer}`.
 * `data` is JSON-parsed when possible; the `[DONE]` sentinel is kept as the
 * string '[DONE]' with `event: 'done'`.
 * @param {ReadableStream<Uint8Array>} body
 * @param {AbortSignal} [signal]
 */
export async function* parseSse(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      if (signal?.aborted) throw new OnDemandAbortError('aborted');
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const evt = parseSseBlock(block);
        if (evt) yield evt;
      }
    }
    if (buffer.trim()) {
      const evt = parseSseBlock(buffer);
      if (evt) yield evt;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

/** @param {string} block */
export function parseSseBlock(block) {
  let event = 'message';
  const dataLines = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue; // comment / keepalive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value.trim();
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0 && event === 'message') return null;
  const rawData = dataLines.join('\n');
  if (rawData.trim() === '[DONE]') return { event: 'done', data: '[DONE]' };
  let data = rawData;
  try {
    data = JSON.parse(rawData);
  } catch {
    /* keep raw string */
  }
  const answer =
    data && typeof data === 'object' && typeof data.answer === 'string'
      ? data.answer
      : undefined;
  return { event, data, ...(answer !== undefined ? { answer } : {}) };
}

/**
 * @typedef {object} ClientOptions
 * @property {typeof fetch} [fetchImpl]        injectable for tests
 * @property {Partial<typeof DEFAULT_RETRY>} [retry]
 * @property {number} [timeoutMs]              default ONDEMAND_REQUEST_TIMEOUT_MS
 * @property {(line: string) => void} [log]    receives ALREADY-REDACTED lines only
 */

/**
 * Create the client. Reads the server key once from config; throws
 * OnDemandNotConfiguredError lazily on the first call if the key is absent.
 * @param {ClientOptions} [options]
 */
export function createOnDemandClient(options = {}) {
  const fetchImpl = options.fetchImpl || ((...a) => globalThis.fetch(...a));
  const retry = { ...DEFAULT_RETRY, ...(options.retry || {}) };
  const log = options.log || (() => {});
  const defaultTimeout = () => options.timeoutMs ?? requestTimeoutMs();

  function apiKey() {
    if (!isConfigured()) throw new OnDemandNotConfiguredError();
    return config.apiKey;
  }

  /**
   * Core request with retries/backoff/429/timeout. Returns the raw Response
   * for 2xx. Never retries a streaming request after bytes started flowing.
   * @param {string} url
   * @param {{method?:string, body?:object, signal?:AbortSignal, timeoutMs?:number, stream?:boolean, headers?:Record<string,string>}} [init]
   */
  async function request(url, init = {}) {
    const key = apiKey();
    const method = init.method || 'GET';
    const attempts = init.stream ? 1 : retry.retries + 1;
    let lastErr;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const link = linkedSignal(
        init.signal,
        init.timeoutMs ?? defaultTimeout(),
      );
      const started = Date.now();
      let res;
      try {
        res = await fetchImpl(url, {
          method,
          headers: {
            accept: init.stream ? 'text/event-stream' : 'application/json',
            ...(init.body !== undefined
              ? { 'content-type': 'application/json' }
              : {}),
            ...(init.headers || {}),
            apikey: key,
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: link.signal,
        });
      } catch (err) {
        link.cleanup();
        try {
          init.onResponse?.({
            method,
            path: new URL(url).pathname.replace(
              /\/sessions\/[^/]+\//,
              '/sessions/:sessionId/',
            ),
            status: init.signal?.aborted ? 499 : 504,
            ms: Date.now() - started,
            attempt: attempt + 1,
            utc: new Date().toISOString(),
          });
        } catch {
          /* transport diagnostics only */
        }
        if (init.signal?.aborted) throw new OnDemandAbortError('aborted');
        if (link.timedOut()) {
          lastErr = new OnDemandAbortError('timeout');
        } else {
          lastErr = err;
        }
        log(
          `[ondemand] ${method} ${redactUrl(url)} attempt ${attempt + 1} network/timeout error: ${lastErr?.name || 'error'}`,
        );
        if (attempt < attempts - 1) {
          await sleep(backoffDelay(attempt, retry), init.signal);
          continue;
        }
        throw lastErr;
      }
      if (!init.stream) link.cleanup();
      else {
        // streaming: keep the timeout off; abort only via the caller signal
        link.cleanup();
      }
      const ms = Date.now() - started;
      // Transport-only correlation for scene verification, never request bodies or auth.
      try {
        init.onResponse?.({
          method,
          path: new URL(url).pathname.replace(
            /\/sessions\/[^/]+\//,
            '/sessions/:sessionId/',
          ),
          status: res.status,
          ms,
          attempt: attempt + 1,
          utc: new Date().toISOString(),
        });
      } catch {
        /* observability cannot fail the request */
      }
      if (res.ok) {
        log(`[ondemand] ${method} ${redactUrl(url)} ${res.status} ${ms}ms`);
        return res;
      }
      const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
      const envelope = await readUpstreamEnvelope(res, key);
      lastErr = new OnDemandHttpError(res.status, envelope, {
        url: redactUrl(url),
        method,
        attempt: attempt + 1,
        retryAfterMs,
        traceId: res.headers.get('x-trace-id') || undefined,
      });
      log(
        `[ondemand] ${method} ${redactUrl(url)} ${res.status} ${ms}ms attempt ${attempt + 1}${res.status === 429 ? ` rate-limited retryAfter=${retryAfterMs ?? 'n/a'}` : ''}`,
      );
      if (lastErr.retryable && attempt < attempts - 1 && method !== 'DELETE') {
        await sleep(backoffDelay(attempt, retry, retryAfterMs), init.signal);
        continue;
      }
      throw lastErr;
    }
    throw lastErr;
  }

  async function json(url, init) {
    const res = await request(url, init);
    try {
      return await res.json();
    } catch {
      throw new OnDemandHttpError(502, 'non-JSON upstream body', {
        url: redactUrl(url),
        method: init?.method || 'GET',
        attempt: 1,
      });
    }
  }

  const urls = () => baseUrls();

  // ---------- sessions ----------
  const sessions = {
    /** @param {import('./types.js').CreateSessionRequest} input */
    async create(input, opts = {}) {
      const body = validateCreateSession(input);
      const out = await json(`${urls().chat}/sessions`, {
        method: 'POST',
        body,
        ...opts,
      });
      return /** @type {import('./types.js').ChatSession} */ (out?.data);
    },
    /** @param {{externalUserId?:string, cursor?:string, limit?:number, sort?:'asc'|'desc'}} [q] */
    async list(q = {}, opts = {}) {
      const u = new URL(`${urls().chat}/sessions`);
      if (q.externalUserId)
        u.searchParams.set(
          'externalUserId',
          validateExternalUserId(q.externalUserId),
        );
      if (q.cursor) u.searchParams.set('cursor', q.cursor);
      if (q.limit) u.searchParams.set('limit', String(q.limit));
      if (q.sort) u.searchParams.set('sort', q.sort);
      const out = await json(u.toString(), opts);
      return { data: out?.data ?? [], pagination: out?.pagination ?? null };
    },
    /** Iterate every page (async generator) — bounded by `maxPages`. */
    async *iterate(q = {}, opts = {}, maxPages = 20) {
      let cursor = q.cursor;
      for (let i = 0; i < maxPages; i += 1) {
        const page = await sessions.list({ ...q, cursor }, opts);
        for (const s of page.data) yield s;
        cursor =
          page.pagination?.next ||
          page.pagination?.nextCursor ||
          page.pagination?.cursor;
        if (!cursor || page.data.length === 0) break;
      }
    },
    async get(sessionId, opts = {}) {
      validateObjectId(sessionId, 'sessionId');
      const out = await json(`${urls().chat}/sessions/${sessionId}`, opts);
      return out?.data;
    },
    /** Documented single-message status polling; no query is re-submitted. */
    async message(sessionId, messageId, opts = {}) {
      validateObjectId(sessionId, 'sessionId');
      validateObjectId(messageId, 'messageId');
      const out = await json(
        `${urls().chat}/sessions/${sessionId}/messages/${messageId}`,
        opts,
      );
      return out?.data;
    },
    /** @param {{limit?:number, cursor?:string, sort?:'asc'|'desc'}} [q] */
    async messages(sessionId, q = {}, opts = {}) {
      validateObjectId(sessionId, 'sessionId');
      const u = new URL(`${urls().chat}/sessions/${sessionId}/messages`);
      if (q.limit) u.searchParams.set('limit', String(q.limit));
      if (q.cursor) u.searchParams.set('cursor', q.cursor);
      if (q.sort) u.searchParams.set('sort', q.sort);
      const out = await json(u.toString(), opts);
      return { data: out?.data ?? [], pagination: out?.pagination ?? null };
    },
  };

  // ---------- query ----------
  const query = {
    /** @param {string} sessionId @param {import('./types.js').SubmitQueryRequest} input */
    async sync(sessionId, input, opts = {}) {
      validateObjectId(sessionId, 'sessionId');
      const body = validateSubmitQuery({ ...input, responseMode: 'sync' });
      const out = await json(`${urls().chat}/sessions/${sessionId}/query`, {
        method: 'POST',
        body,
        timeoutMs: opts.timeoutMs ?? Math.max(defaultTimeout(), 120_000),
        ...opts,
      });
      return /** @type {import('./types.js').SubmitQuerySyncResponse} */ (out);
    },
    /**
     * Streaming query. Returns an async iterable of StreamEvent plus the
     * raw Response (for byte-level pass-through). Abort via `opts.signal`.
     * @param {string} sessionId @param {import('./types.js').SubmitQueryRequest} input
     */
    async stream(sessionId, input, opts = {}) {
      validateObjectId(sessionId, 'sessionId');
      const body = validateSubmitQuery({ ...input, responseMode: 'stream' });
      const res = await request(`${urls().chat}/sessions/${sessionId}/query`, {
        method: 'POST',
        body,
        stream: true,
        timeoutMs: opts.connectTimeoutMs ?? defaultTimeout(),
        signal: opts.signal,
      });
      return {
        response: res,
        events: parseSse(res.body, opts.signal),
      };
    },
  };

  // ---------- media ----------
  const media = {
    async list(q = {}, opts = {}) {
      const u = new URL(urls().media);
      for (const k of [
        'sort',
        'page',
        'limit',
        'plugins',
        'externalUserId',
        'source',
      ])
        if (q[k] !== undefined) u.searchParams.set(k, String(q[k]));
      const out = await json(u.toString(), opts);
      return { data: out?.data ?? [], pagination: out?.pagination ?? null };
    },
    /** @param {{url:string, plugins:string[], responseMode:'sync'|'webhook', name?:string, sessionId?:string, externalUserId?:string}} input */
    async createFromUrl(input, opts = {}) {
      if (!input?.url) throw new Error('media.createFromUrl: url required');
      const body = { responseMode: 'sync', plugins: [], ...input };
      const out = await json(urls().media, {
        method: 'POST',
        body,
        timeoutMs: opts.timeoutMs ?? 120_000,
        ...opts,
      });
      return out?.data;
    },
    async remove(fileId, opts = {}) {
      validateObjectId(fileId, 'fileId');
      return json(`${urls().media}/${fileId}`, { method: 'DELETE', ...opts });
    },
  };

  // ---------- workflows (Agents Flow Builder) ----------
  const workflows = {
    async get(id, opts = {}) {
      validateObjectId(id, 'workflowId');
      const out = await json(`${urls().automation}/workflow/${id}`, opts);
      return out?.data ?? out;
    },
    async execute(id, opts = {}) {
      validateObjectId(id, 'workflowId');
      const out = await json(`${urls().automation}/workflow/${id}/execute`, {
        method: 'POST',
        body: {},
        ...opts,
      });
      const executionID = out?.executionID || out?.data?.executionID;
      if (!executionID)
        throw new OnDemandHttpError(502, out, {
          url: 'workflow/execute',
          method: 'POST',
          attempt: 1,
        });
      return { executionID };
    },
    async execution(executionID, opts = {}) {
      validateObjectId(executionID, 'executionID');
      const out = await json(
        `${urls().automation}/execution/${executionID}`,
        opts,
      );
      return /** @type {import('./types.js').WorkflowExecution} */ (
        out?.data ?? out
      );
    },
    async logs(executionID, opts = {}) {
      validateObjectId(executionID, 'executionID');
      const out = await json(
        `${urls().automation}/execution/${executionID}/logs`,
        opts,
      );
      return /** @type {import('./types.js').ExecutionLog[]} */ (
        out?.data ?? []
      );
    },
    async nodeOutputs(executionID, opts = {}) {
      validateObjectId(executionID, 'executionID');
      const out = await json(
        `${urls().automation}/execution/${executionID}/node/outputs`,
        opts,
      );
      return out?.data ?? out;
    },
    async listExecutions(workflowID, q = {}, opts = {}) {
      const u = new URL(`${urls().automation}/execution/list`);
      if (workflowID)
        u.searchParams.set(
          'workflowID',
          validateObjectId(workflowID, 'workflowID'),
        );
      if (q.limit) u.searchParams.set('limit', String(q.limit));
      if (q.afterId) u.searchParams.set('afterId', q.afterId);
      const out = await json(u.toString(), opts);
      return { data: out?.data ?? [], pagination: out?.pagination ?? null };
    },
    /**
     * Poll an execution to a terminal state (the platform exposes NO SSE log
     * stream — verified 2026-10-20, /logs/stream and /stream → 404). Yields
     * `{status, newLogs}` snapshots so a route can relay them as SSE.
     */
    async *follow(
      executionID,
      { intervalMs = 3000, maxMs = 180_000, signal } = {},
    ) {
      const started = Date.now();
      let seen = 0;
      for (;;) {
        if (signal?.aborted) throw new OnDemandAbortError('aborted');
        const [exec, logs] = await Promise.all([
          workflows.execution(executionID, { signal }),
          workflows.logs(executionID, { signal }),
        ]);
        const newLogs = logs.slice(seen);
        seen = logs.length;
        const terminal = [
          'success',
          'completed',
          'failed',
          'error',
          'cancelled',
        ].includes(String(exec?.status));
        yield { status: exec?.status, newLogs, terminal };
        if (terminal || Date.now() - started > maxMs) return;
        await sleep(intervalMs, signal);
      }
    },
  };

  // ---------- services (Services API: STT / TTS) ----------
  const services = {
    /** @param {{ audioUrl: string }} input */
    async speechToText({ audioUrl }, opts = {}) {
      if (!audioUrl)
        throw new Error('services.speechToText: audioUrl required');
      const out = await json(`${urls().services}/execute/speech_to_text`, {
        method: 'POST',
        body: { audioUrl },
        timeoutMs: opts.timeoutMs ?? 45_000,
        ...opts,
      });
      return out?.data ?? out;
    },
    /** @param {{ input: string, model?: string, voice?: string }} input */
    async textToSpeech({ input, model = 'tts-1', voice = 'alloy' }, opts = {}) {
      if (!input) throw new Error('services.textToSpeech: input required');
      const out = await json(`${urls().services}/execute/text_to_speech`, {
        method: 'POST',
        body: { input, model, voice },
        timeoutMs: opts.timeoutMs ?? 30_000,
        ...opts,
      });
      return out?.data ?? out;
    },
  };

  return Object.freeze({
    sessions,
    query,
    media,
    workflows,
    services,
    /** Low-level escape hatch (still key-injecting, still retrying). */
    request,
    isConfigured,
  });
}

function redactUrl(url) {
  try {
    const u = new URL(url);
    u.search = '';
    return u.toString();
  } catch {
    return String(url);
  }
}

let singleton;
/** Lazily-created process-wide client (per serverless instance). */
export function getOnDemandClient() {
  if (!singleton) singleton = createOnDemandClient();
  return singleton;
}
export function __resetClientForTests() {
  singleton = undefined;
}
