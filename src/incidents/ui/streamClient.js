/**
 * streamClient.js — fetch()-based SSE reader for scene streaming.
 * Handles text/event-stream parsing, multi-line data, comments,
 * Last-Event-ID reconnect, auto-resume with capped backoff, and AbortController.
 */

/**
 * Parses an SSE block (separated by \n\n) into a structured event object.
 * Returns null if the block contains no event or data.
 */
export function parseSseBlock(block) {
  if (!block || typeof block !== 'string') return null;
  const lines = block.split(/\r?\n/);
  let event = 'message';
  let id = null;
  const dataLines = [];
  let retry = null;

  for (const line of lines) {
    if (!line || line.startsWith(':')) {
      // Empty line or comment (e.g. : heartbeat) — ignored
      continue;
    }
    if (line.startsWith('id:')) {
      id = line.slice(3).trim();
    } else if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      let d = line.slice(5);
      if (d.startsWith(' ')) d = d.slice(1);
      dataLines.push(d);
    } else if (line.startsWith('retry:')) {
      const ms = parseInt(line.slice(6).trim(), 10);
      if (Number.isFinite(ms)) retry = ms;
    }
  }

  if (dataLines.length === 0 && !id && event === 'message') {
    return null;
  }

  const rawData = dataLines.join('\n');
  let data = rawData;
  try {
    data = JSON.parse(rawData);
  } catch {
    // Keep as plain text string if not valid JSON
  }

  return { id, event, data, raw: rawData, retry };
}

async function* readChunks(body, signal) {
  if (body?.getReader) {
    const reader = body.getReader();
    const onAbort = () => {
      try {
        reader.cancel?.();
      } catch {}
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    try {
      while (true) {
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        yield value;
      }
    } finally {
      signal?.removeEventListener?.('abort', onAbort);
      reader.releaseLock?.();
    }
  } else if (body && body[Symbol.asyncIterator]) {
    for await (const chunk of body) {
      if (signal?.aborted) break;
      yield chunk;
    }
  }
}

/**
 * Create a stream client to read Server-Sent Events over fetch.
 */
export function createStreamClient({
  fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
  maxRetries = 3,
  backoffMs = 100,
  maxBackoffMs = 2000,
} = {}) {
  /**
   * Connect and consume an SSE stream.
   *
   * @param {string} url
   * @param {object} options
   * @param {string} [options.method='POST']
   * @param {object} [options.headers={}]
   * @param {any} [options.body]
   * @param {AbortSignal} [options.signal]
   * @param {(evt: { id: string|null, event: string, data: any, raw: string }) => void} [options.onEvent]
   * @param {string} [options.lastEventId]
   * @param {boolean} [options.autoResume=true]
   * @returns {Promise<any>} Resolves with the 'done' event result.
   */
  async function stream(
    url,
    {
      method = 'POST',
      headers = {},
      body = null,
      signal = null,
      onEvent = () => {},
      lastEventId = null,
      autoResume = true,
    } = {},
  ) {
    const state = {
      lastEventId: lastEventId || null,
      retryMs: 1000,
      completed: false,
    };
    let attempts = 0;
    const decoder = new TextDecoder();

    while (!state.completed) {
      if (signal?.aborted) {
        const err = new Error('Request cancelled.');
        err.name = 'AbortError';
        throw err;
      }

      const requestHeaders = {
        Accept: 'text/event-stream',
        ...headers,
      };
      if (state.lastEventId) {
        requestHeaders['Last-Event-ID'] = state.lastEventId;
      }

      let res;
      try {
        let requestBody = body;
        if (body && typeof body === 'object' && !(body instanceof Uint8Array)) {
          requestBody = JSON.stringify({
            ...body,
            ...(state.lastEventId ? { lastEventId: state.lastEventId } : {}),
          });
        }
        res = await fetchImpl(url, {
          method,
          headers: requestHeaders,
          body: requestBody,
          signal,
        });
      } catch (networkError) {
        if (signal?.aborted || networkError?.name === 'AbortError') {
          throw networkError;
        }
        if (!autoResume || attempts >= maxRetries) {
          throw networkError;
        }
        attempts += 1;
        const delay = Math.min(
          maxBackoffMs,
          state.retryMs * Math.pow(1.5, attempts - 1),
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (!res.ok) {
        let errBody = null;
        try {
          errBody = await res.json();
        } catch {
          /* not json */
        }
        const message =
          errBody?.error?.message ||
          errBody?.message ||
          `HTTP ${res.status} stream failure`;
        const err = new Error(message);
        err.status = res.status;
        err.body = errBody;
        throw err;
      }

      const contentType = res.headers?.get?.('content-type') || '';
      if (
        contentType &&
        !contentType.includes('text/event-stream') &&
        !contentType.includes('text/plain')
      ) {
        const err = new Error('Non-SSE response received from stream endpoint');
        err.code = 'non_sse_response';
        throw err;
      }

      let buffer = '';
      try {
        for await (const chunk of readChunks(res.body, signal)) {
          if (signal?.aborted) {
            const err = new Error('Request cancelled.');
            err.name = 'AbortError';
            throw err;
          }
          buffer +=
            typeof chunk === 'string'
              ? chunk
              : decoder.decode(chunk, { stream: true });
          const parts = buffer.split(/\r?\n\r?\n/);
          buffer = parts.pop() || '';

          for (const block of parts) {
            if (!block.trim()) continue;
            if (signal?.aborted) {
              const err = new Error('Request cancelled.');
              err.name = 'AbortError';
              throw err;
            }
            const parsed = parseSseBlock(block);
            if (!parsed) continue;

            if (parsed.id) state.lastEventId = parsed.id;
            if (parsed.retry) state.retryMs = parsed.retry;

            if (signal?.aborted) {
              const err = new Error('Request cancelled.');
              err.name = 'AbortError';
              throw err;
            }
            onEvent(parsed);

            if (parsed.event === 'done') {
              state.completed = true;
              return parsed.data?.result || parsed.data;
            }
            if (parsed.event === 'error') {
              state.completed = true;
              const err = new Error(
                parsed.data?.message || parsed.data?.code || 'Stream error',
              );
              err.code = parsed.data?.code || 'stream_error';
              err.details = parsed.data;
              throw err;
            }
            if (parsed.event === 'resume_unavailable') {
              state.completed = true;
              const err = new Error('Session resume unavailable');
              err.code = 'resume_unavailable';
              err.details = parsed.data;
              throw err;
            }
          }
        }

        // Process any trailing block left in buffer
        if (buffer.trim()) {
          if (signal?.aborted) {
            const err = new Error('Request cancelled.');
            err.name = 'AbortError';
            throw err;
          }
          const parsed = parseSseBlock(buffer);
          if (parsed) {
            if (parsed.id) state.lastEventId = parsed.id;
            if (signal?.aborted) {
              const err = new Error('Request cancelled.');
              err.name = 'AbortError';
              throw err;
            }
            onEvent(parsed);
            if (parsed.event === 'done') {
              state.completed = true;
              return parsed.data?.result || parsed.data;
            }
            if (parsed.event === 'error') {
              state.completed = true;
              const err = new Error(
                parsed.data?.message || parsed.data?.code || 'Stream error',
              );
              err.code = parsed.data?.code || 'stream_error';
              throw err;
            }
            if (parsed.event === 'resume_unavailable') {
              state.completed = true;
              const err = new Error('Session resume unavailable');
              err.code = 'resume_unavailable';
              throw err;
            }
          }
        }
      } catch (streamError) {
        if (
          signal?.aborted ||
          streamError?.name === 'AbortError' ||
          state.completed
        ) {
          throw streamError;
        }
        if (!autoResume || attempts >= maxRetries) {
          throw streamError;
        }
        attempts += 1;
        const delay = Math.min(
          maxBackoffMs,
          state.retryMs * Math.pow(1.5, attempts - 1),
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (signal?.aborted) {
        const err = new Error('Request cancelled.');
        err.name = 'AbortError';
        throw err;
      }

      // If the stream ended without a terminal event and was not aborted, retry if autoResume enabled
      if (!state.completed) {
        if (!autoResume || attempts >= maxRetries) {
          break;
        }
        attempts += 1;
        const delay = Math.min(
          maxBackoffMs,
          state.retryMs * Math.pow(1.5, attempts - 1),
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    return null;
  }

  return { stream };
}

export default createStreamClient;
