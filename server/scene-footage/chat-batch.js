/**
 * Chat Batch Client & Probe
 *
 * Implements OnDemand Chat Batch API probe & client check.
 * Live OnDemand docs lack a chat batch operation; probing POST /chat/v1/batches yields
 * HTTP 405 ("Chat batch creation is currently unavailable").
 *
 * probeChatBatch() records {available, status, body, checkedAt} and caches the probe
 * for 10 minutes so capabilities honestly reflect provider availability.
 */

const PROBE_TTL_MS = 10 * 60_000; // 10 minutes
let cachedProbe = null;

export function redactString(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(
      /(?:key|apikey|token|secret)[=:][\s"']*([A-Za-z0-9_\-.]{8,})/gi,
      (match) => match.slice(0, 10) + '...[REDACTED]',
    )
    .replace(/sig=([A-Za-z0-9%_-]+)/gi, 'sig=[REDACTED]');
}

/**
 * Probe OnDemand Chat Batch API.
 * Returns { available: boolean, status: number, body: string, checkedAt: string, endpoint: string, error?: string }
 */
export async function probeChatBatch({
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://api.on-demand.io',
  apiKeyProvider = null,
  now = () => Date.now(),
  ttlMs = PROBE_TTL_MS,
  force = false,
  signal = null,
} = {}) {
  const currentTime = typeof now === 'function' ? now() : Date.now();
  if (
    !force &&
    cachedProbe &&
    typeof cachedProbe._timestamp === 'number' &&
    currentTime - cachedProbe._timestamp < ttlMs
  ) {
    const { _timestamp, ...rest } = cachedProbe;
    return rest;
  }

  const key =
    typeof apiKeyProvider === 'function' ? apiKeyProvider() : apiKeyProvider;
  const endpoint = '/chat/v1/batches';
  const url = `${String(baseUrl || '').replace(/\/+$/, '')}${endpoint}`;
  const checkedAt = new Date(currentTime).toISOString();

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { apikey: key } : {}),
      },
      body: JSON.stringify({ items: [{ query: 'probe' }] }),
      signal,
    });

    const status = res.status;
    let body = '';
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    const cleanBody = redactString(body).slice(0, 500);
    const available = res.ok && status >= 200 && status < 300;

    cachedProbe = {
      available,
      status,
      body: cleanBody,
      checkedAt,
      endpoint,
      _timestamp: currentTime,
    };

    const { _timestamp, ...clean } = cachedProbe;
    return clean;
  } catch (err) {
    const errMsg = redactString(err?.message || String(err)).slice(0, 500);
    cachedProbe = {
      available: false,
      status: 0,
      body: errMsg,
      error: errMsg,
      checkedAt,
      endpoint,
      _timestamp: currentTime,
    };
    const { _timestamp, ...clean } = cachedProbe;
    return clean;
  }
}

export function getCachedChatBatchProbe() {
  if (!cachedProbe) return null;
  const { _timestamp, ...clean } = cachedProbe;
  return clean;
}

export function resetChatBatchProbeCache() {
  cachedProbe = null;
}

/**
 * Returns capability descriptor reflecting the latest probe result.
 */
export function getChatBatchCapability(
  probeResult = getCachedChatBatchProbe(),
) {
  if (!probeResult) {
    return {
      available: false,
      status: 405,
      body: JSON.stringify({
        message: 'Chat batch creation is currently unavailable',
        errorCode: 'method_not_allowed',
      }),
      checkedAt: null,
    };
  }
  return {
    available: Boolean(probeResult.available),
    status: probeResult.status,
    body: probeResult.body,
    checkedAt: probeResult.checkedAt,
  };
}

export function createChatBatchClient({
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://api.on-demand.io',
  apiKeyProvider = null,
  now = () => Date.now(),
} = {}) {
  let probeCache = null;

  return {
    /**
     * Submit a batch of items to /chat/v1/batches.
     * Returns { available: boolean, status?: number, body?: string, error?: string }
     */
    async submitBatch(items = [], { signal } = {}) {
      if (probeCache && !probeCache.available) {
        return probeCache;
      }

      const probe = await probeChatBatch({
        fetchImpl,
        baseUrl,
        apiKeyProvider,
        now,
        signal,
      });

      probeCache = probe;
      return probe;
    },

    getProbeResult() {
      return probeCache;
    },

    reset() {
      probeCache = null;
      resetChatBatchProbeCache();
    },
  };
}
