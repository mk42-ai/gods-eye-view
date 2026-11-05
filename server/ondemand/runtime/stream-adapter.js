/**
 * OnDemand Stream Adapter — consumes streaming responses from
 * POST /chat/v1/sessions/{id}/query with responseMode: 'stream',
 * parses SSE frames incrementally, measures latency and throughput metrics,
 * and feeds complete NDJSON lines through an accumulator.
 *
 * Contract: src/cinematic/CONTRACT.md §A
 */
import { ondemandFetch } from '../client.js';
import { config } from '../config.js';

export class OnDemandStreamError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'OnDemandStreamError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Incremental SSE frame parser.
 * Handles split chunks, [DONE], and heartbeat frames.
 *
 * @param {string} chunkText
 * @param {{ buffer?: string }} [state]
 * @returns {{ events: Array<{ event: string, data: any }>, state: { buffer: string } }}
 */
export function parseOnDemandSseFrames(chunkText, state = { buffer: '' }) {
  const currentBuffer = (state?.buffer || '') + (chunkText || '');
  const events = [];

  let lastIndex = 0;
  const doubleNewlineRegex = /\r?\n\r?\n/g;
  let match;

  while ((match = doubleNewlineRegex.exec(currentBuffer)) !== null) {
    const rawFrame = currentBuffer.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;

    if (!rawFrame.trim()) continue;

    const lines = rawFrame.split(/\r?\n/);
    let event = 'message';
    const dataLines = [];

    for (const line of lines) {
      if (line.startsWith(':')) {
        // SSE comment
        continue;
      }
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length > 0) {
      const rawData = dataLines.join('\n');
      if (rawData === '[DONE]') {
        events.push({ event, data: '[DONE]' });
      } else {
        try {
          const parsed = JSON.parse(rawData);
          events.push({ event, data: parsed });
        } catch {
          events.push({ event, data: rawData });
        }
      }
    } else if (event === 'heartbeat') {
      events.push({ event: 'heartbeat', data: null });
    }
  }

  const remaining = currentBuffer.slice(lastIndex);
  return {
    events,
    state: { buffer: remaining },
  };
}

/**
 * Creates an NDJSON line accumulator that feeds deltas,
 * splits on newline, strips markdown code fences, and emits complete lines.
 *
 * @param {(line: string) => void} onLine
 * @returns {{ feed: (delta: string) => void, flush: () => void }}
 */
export function createNdjsonAccumulator(onLine) {
  let buffer = '';
  let inCodeFence = false;

  function feed(delta) {
    if (!delta || typeof delta !== 'string') return;
    buffer += delta;

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      let rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (rawLine.endsWith('\r')) {
        rawLine = rawLine.slice(0, -1);
      }

      const trimmed = rawLine.trim();

      // Check for code fence
      if (/^```(?:json|ndjson)?$/i.test(trimmed)) {
        inCodeFence = !inCodeFence;
        continue;
      }

      if (!trimmed) continue;

      onLine(trimmed);
    }
  }

  function flush() {
    if (buffer.trim()) {
      let rawLine = buffer.trim();
      if (rawLine.endsWith('\r')) rawLine = rawLine.slice(0, -1);
      if (!/^```(?:json|ndjson)?$/i.test(rawLine)) {
        onLine(rawLine);
      }
    }
    buffer = '';
  }

  return {
    feed,
    flush,
  };
}

/**
 * Stream query against OnDemand chat sessions API.
 */
export async function streamQuery({
  fetchImpl = ondemandFetch,
  getSettings = () => config,
  sessionId,
  query,
  endpointId,
  pluginIds = [],
  fulfillmentOnly = true,
  reasoningEffort,
  modelConfigs,
  signal,
  onDelta,
  onMetrics,
  onHeartbeat,
  timeoutMs = 120000,
  firstByteTimeoutMs = 30000,
  now = () => Date.now(),
} = {}) {
  const settings = getSettings();
  if (!settings?.apiKey) {
    throw new OnDemandStreamError(
      503,
      'provider_unavailable',
      'Server-side OnDemand authentication is not configured.',
    );
  }

  if (!sessionId) {
    throw new OnDemandStreamError(
      400,
      'provider_request_failed',
      'Missing sessionId for stream query.',
    );
  }

  if (!endpointId) {
    throw new OnDemandStreamError(
      503,
      'endpoint_invalid',
      'No endpointId configured for stream query.',
    );
  }

  if (signal?.aborted) {
    throw new DOMException('Request cancelled', 'AbortError');
  }

  const baseUrl = (settings.baseUrl || 'https://api.on-demand.io').replace(
    /\/$/,
    '',
  );
  const url = `${baseUrl}/chat/v1/sessions/${encodeURIComponent(sessionId)}/query`;

  const body = {
    query,
    endpointId,
    responseMode: 'stream',
    pluginIds,
    fulfillmentOnly,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(modelConfigs ? { modelConfigs } : {}),
  };

  const startTime = now();
  const abortController = new AbortController();

  let timedOut = false;
  let firstByteReceived = false;

  const firstByteTimer = setTimeout(() => {
    if (!firstByteReceived) {
      timedOut = true;
      abortController.abort();
    }
  }, firstByteTimeoutMs);

  const overallTimer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);

  const onCallerAbort = () => {
    abortController.abort();
  };
  signal?.addEventListener('abort', onCallerAbort, { once: true });

  const cleanupTimers = () => {
    clearTimeout(firstByteTimer);
    clearTimeout(overallTimer);
    signal?.removeEventListener('abort', onCallerAbort);
  };

  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      body,
      signal: abortController.signal,
      timeoutMs,
    });
  } catch (err) {
    cleanupTimers();
    if (signal?.aborted) {
      throw new DOMException('Request cancelled', 'AbortError');
    }
    if (timedOut) {
      throw new OnDemandStreamError(
        504,
        'stream_timeout',
        'Stream query timed out waiting for first byte.',
      );
    }
    throw new OnDemandStreamError(
      502,
      'provider_unavailable',
      `OnDemand request failed: ${err.message}`,
    );
  }

  if (!res.ok) {
    cleanupTimers();
    let errText = '';
    try {
      errText = await res.text();
    } catch {}

    let code = 'provider_request_failed';
    if (res.status === 429) {
      code = 'rate_limited';
    } else if (res.status === 400) {
      code = 'endpoint_invalid';
    } else if (res.status === 502 || res.status === 503 || res.status === 504) {
      code = 'provider_unavailable';
    }

    throw new OnDemandStreamError(
      res.status,
      code,
      `OnDemand stream request failed with HTTP ${res.status}: ${errText.slice(0, 300)}`,
    );
  }

  let fullAnswer = '';
  let messageId = null;
  let deltas = 0;
  let ttftMs = null;
  let firstByteMs = null;
  let publicMetrics = null;
  let doneReceived = false;
  let sseState = { buffer: '' };

  const reader = res.body?.getReader?.();
  if (!reader) {
    cleanupTimers();
    throw new OnDemandStreamError(
      502,
      'provider_unavailable',
      'Response body is not a readable stream.',
    );
  }

  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (!firstByteReceived) {
        firstByteReceived = true;
        firstByteMs = now() - startTime;
        clearTimeout(firstByteTimer);
      }

      const chunkText = decoder.decode(value, { stream: true });
      const parsed = parseOnDemandSseFrames(chunkText, sseState);
      sseState = parsed.state;

      for (const ev of parsed.events) {
        if (ev.data === '[DONE]') {
          doneReceived = true;
          break;
        }

        if (ev.event === 'heartbeat') {
          onHeartbeat?.();
          continue;
        }

        if (ev.data && typeof ev.data === 'object') {
          if (ev.data.messageId) {
            messageId = ev.data.messageId;
          }

          if (
            ev.data.eventType === 'fulfillment' &&
            typeof ev.data.answer === 'string'
          ) {
            const deltaText = ev.data.answer;
            if (deltaText) {
              if (ttftMs === null) {
                ttftMs = now() - startTime;
              }
              deltas++;
              fullAnswer += deltaText;
              onDelta?.(deltaText, {
                eventIndex: ev.data.eventIndex ?? deltas - 1,
                elapsedMs: now() - startTime,
              });
            }
          } else if (ev.data.eventType === 'metricsLog') {
            if (ev.data.publicMetrics) {
              publicMetrics = ev.data.publicMetrics;
              onMetrics?.(publicMetrics);
            }
          }
        }
      }

      if (doneReceived) break;
    }
  } catch (err) {
    if (signal?.aborted) {
      throw new DOMException('Request cancelled', 'AbortError');
    }
    if (timedOut) {
      throw new OnDemandStreamError(
        504,
        'stream_timeout',
        'Stream timed out during read.',
      );
    }
    throw new OnDemandStreamError(
      502,
      'provider_unavailable',
      `Stream read error: ${err.message}`,
    );
  } finally {
    cleanupTimers();
  }

  const totalMs = now() - startTime;

  if (signal?.aborted) {
    throw new DOMException('Request cancelled', 'AbortError');
  }

  if (deltas === 0 && !doneReceived) {
    throw new OnDemandStreamError(
      504,
      'stream_timeout',
      'Stream completed with 0 deltas and no [DONE].',
    );
  }

  const outputTokens =
    typeof publicMetrics?.outputTokens === 'number'
      ? publicMetrics.outputTokens
      : null;
  const inputTokens =
    typeof publicMetrics?.inputTokens === 'number'
      ? publicMetrics.inputTokens
      : null;

  let tokensPerSec = null;
  let estimated = false;

  const generationTimeSec = Math.max(0.001, (totalMs - (ttftMs ?? 0)) / 1000);

  if (outputTokens !== null && outputTokens > 0) {
    tokensPerSec = Number((outputTokens / generationTimeSec).toFixed(2));
  } else if (fullAnswer.length > 0) {
    const estTokens = Math.max(1, Math.round(fullAnswer.length / 4));
    tokensPerSec = Number((estTokens / generationTimeSec).toFixed(2));
    estimated = true;
  }

  // Provider `outputTokens` can include hidden reasoning tokens (observed
  // 10,873 output tokens for a 13-entity NDJSON answer on cerebras-qwen-3.8),
  // so the VISIBLE-text rate is reported alongside and never conflated.
  const visibleTokensEst = Math.max(0, Math.round(fullAnswer.length / 4));
  const visibleTokensPerSecEst =
    visibleTokensEst > 0
      ? Number((visibleTokensEst / generationTimeSec).toFixed(2))
      : null;

  return {
    answer: fullAnswer,
    messageId,
    sessionId,
    ttftMs: ttftMs ?? totalMs,
    firstByteMs: firstByteMs ?? totalMs,
    totalMs,
    deltas,
    outputTokens,
    inputTokens,
    tokensPerSec,
    visibleChars: fullAnswer.length,
    visibleTokensEst,
    visibleTokensPerSecEst,
    ...(estimated ? { estimated: true } : {}),
    publicMetrics,
    endpointId,
    aborted: false,
  };
}
