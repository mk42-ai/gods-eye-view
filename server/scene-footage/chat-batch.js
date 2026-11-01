/**
 * Chat Batch Client (probe & fallback)
 *
 * Implements OnDemand Chat Batch API client check.
 * Live OnDemand docs lack a chat batch operation; probing POST /chat/v1/batches yields
 * HTTP 405 ("Chat batch creation is currently unavailable").
 *
 * This client probes once, records the exact status and body in capabilities,
 * and allows the caller (runFanout) to fall back to bounded concurrent direct sessions.
 */

export function createChatBatchClient({
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://api.on-demand.io',
  apiKeyProvider = null,
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

      const key =
        typeof apiKeyProvider === 'function'
          ? apiKeyProvider()
          : apiKeyProvider;
      const url = `${String(baseUrl || '').replace(/\/+$/, '')}/chat/v1/batches`;

      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(key ? { apikey: key } : {}),
          },
          body: JSON.stringify({ items }),
          signal,
        });

        const status = res.status;
        let body = '';
        try {
          body = await res.text();
        } catch {
          /* unreadable body */
        }

        // On 404, 405, 401, 403, 5xx: batch API is unavailable
        if (
          status === 404 ||
          status === 405 ||
          status === 401 ||
          status === 403 ||
          status >= 500
        ) {
          probeCache = {
            available: false,
            status,
            body,
            endpoint: '/chat/v1/batches',
          };
          return probeCache;
        }

        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = body;
        }

        probeCache = {
          available: res.ok,
          status,
          data: parsed,
          endpoint: '/chat/v1/batches',
        };
        return probeCache;
      } catch (err) {
        probeCache = {
          available: false,
          error: err.message || String(err),
          endpoint: '/chat/v1/batches',
        };
        return probeCache;
      }
    },

    getProbeResult() {
      return probeCache;
    },

    reset() {
      probeCache = null;
    },
  };
}
