/**
 * LIVE FOOTAGE service client — same-origin `/footage/*` (vercel.json
 * rewrites to api/footage/index.py; the dev servers proxy to uvicorn).
 *
 * `streamFootage` consumes the Server-Sent Events stream with fetch() +
 * ReadableStream (not EventSource) so it can be aborted and so it works
 * through proxies that buffer EventSource poorly. Every callback is
 * optional; the promise resolves with the aggregate once `done` arrives.
 */
export const FOOTAGE_BASE = '/footage';

export function footageQueryString({
  lat,
  lon,
  radiusKm = 5,
  keywords = '',
  since = null,
  mode = 'live',
  limit = 12,
  place = null,
} = {}) {
  const p = new URLSearchParams();
  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) {
    p.set('lat', Number(lat).toFixed(4));
    p.set('lon', Number(lon).toFixed(4));
  }
  p.set(
    'radius_km',
    String(Math.max(0.1, Math.min(500, Number(radiusKm) || 5))),
  );
  if (keywords) p.set('keywords', String(keywords).slice(0, 200));
  if (since) p.set('since', String(since).slice(0, 40));
  p.set('mode', mode === 'rebuild' ? 'rebuild' : 'live');
  p.set('limit', String(Math.max(1, Math.min(40, Number(limit) || 12))));
  if (place) p.set('place', String(place).slice(0, 120));
  return p.toString();
}

/** Parse one SSE frame block ("event: x\ndata: {...}") → {event, data} or null. */
export function parseSseBlock(block) {
  let event = 'message';
  const dataLines = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (!dataLines.length) return null;
  const raw = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: raw };
  }
}

export function createFootageClient({
  fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
  base = FOOTAGE_BASE,
} = {}) {
  async function health({ signal } = {}) {
    const res = await fetchImpl(`${base}/health`, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`footage health HTTP ${res.status}`);
    return res.json();
  }

  async function search(params, { signal } = {}) {
    const res = await fetchImpl(
      `${base}/search?${footageQueryString(params)}`,
      { signal, headers: { Accept: 'application/json' } },
    );
    if (!res.ok) throw new Error(`footage search HTTP ${res.status}`);
    return res.json();
  }

  /**
   * Stream items as they arrive. Handlers: onQuery, onSourceStart, onItem,
   * onSourceDone, onDone, onError. Returns a promise of the `done` payload
   * (null when aborted). Falls back to /search when the stream endpoint is
   * unavailable (e.g. a proxy that refuses text/event-stream).
   */
  async function stream(params, handlers = {}, { signal } = {}) {
    const url = `${base}/stream?${footageQueryString(params)}`;
    let res;
    try {
      res = await fetchImpl(url, {
        signal,
        headers: { Accept: 'text/event-stream' },
      });
    } catch (err) {
      if (signal?.aborted) return null;
      throw err;
    }
    if (!res.ok || !res.body) {
      // graceful degradation: one-shot search then synthesize the events
      const payload = await search(params, { signal });
      handlers.onQuery?.(payload.query);
      for (const s of payload.sources || [])
        handlers.onSourceStart?.({ source: s.source });
      for (const it of payload.items || []) handlers.onItem?.(it);
      for (const s of payload.sources || []) handlers.onSourceDone?.(s);
      handlers.onDone?.(payload);
      return payload;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = null;
    try {
      for (;;) {
        const { value, done: eof } = await reader.read();
        if (eof) break;
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const frame = parseSseBlock(block);
          if (!frame) continue;
          dispatch(frame, handlers);
          if (frame.event === 'done') done = frame.data;
        }
      }
      if (buffer.trim()) {
        const frame = parseSseBlock(buffer);
        if (frame) {
          dispatch(frame, handlers);
          if (frame.event === 'done') done = frame.data;
        }
      }
    } catch (err) {
      if (!signal?.aborted) {
        handlers.onError?.(err);
        throw err;
      }
      return null;
    }
    return done;
  }

  return { health, search, stream };
}

function dispatch(frame, handlers) {
  switch (frame.event) {
    case 'query':
      handlers.onQuery?.(frame.data);
      break;
    case 'source_start':
      handlers.onSourceStart?.(frame.data);
      break;
    case 'item':
      handlers.onItem?.(frame.data);
      break;
    case 'source_done':
      handlers.onSourceDone?.(frame.data);
      break;
    case 'done':
      handlers.onDone?.(frame.data);
      break;
    case 'error':
      handlers.onError?.(
        new Error(frame.data?.error || 'footage stream error'),
      );
      break;
    default:
      break;
  }
}
