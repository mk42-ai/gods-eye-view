import { randomUUID } from 'node:crypto';

const MAX_SESSIONS = 20;
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * In-memory ring buffer of emitted events per request ID for resume.
 * Key: requestId -> { createdAt, seq, events: [...], closed: boolean }
 */
const sessionRing = new Map();

function pruneSessionRing() {
  const now = Date.now();
  for (const [id, session] of sessionRing.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessionRing.delete(id);
    }
  }
  while (sessionRing.size > MAX_SESSIONS) {
    const oldestKey = sessionRing.keys().next().value;
    sessionRing.delete(oldestKey);
  }
}

export function resetSessionRing() {
  sessionRing.clear();
}

export function getSessionRingSize() {
  return sessionRing.size;
}

/**
 * Split narration text into word-ish chunks of ~2–6 chars for typewriter streaming.
 */
export function tokenizeNarration(text) {
  if (!text || typeof text !== 'string') return [];
  const words = text.match(/\S+\s*/g) || [text];
  const chunks = [];
  for (const word of words) {
    if (word.length <= 6) {
      chunks.push(word);
    } else {
      for (let i = 0; i < word.length; i += 4) {
        chunks.push(word.slice(i, i + 4));
      }
    }
  }
  return chunks;
}

/**
 * Formats an SSE frame.
 */
export function formatSse({ id, event, data }) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `id: ${id}\nevent: ${event}\ndata: ${payload}\n\n`;
}

/**
 * Create an SSE event stream for scene construction.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {object} options
 * @param {number} [options.heartbeatMs=15000]
 * @param {string} [options.requestId]
 * @param {string} [options.lastEventId]
 * @param {AbortSignal} [options.signal]
 * @returns {{ emit: (event: string, data: any) => void, close: () => void, id: () => string, resumed?: boolean, unavailable?: boolean }}
 */
export function createSceneEventStream(res, options = {}) {
  const heartbeatMs = options.heartbeatMs ?? 15000;
  const requestId = options.requestId || randomUUID();
  const lastEventId = options.lastEventId || null;
  const signal = options.signal || null;
  const startTime = Date.now();

  pruneSessionRing();

  function writeHeaders() {
    if (res.headersSent) return;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
  }

  writeHeaders();
  try {
    res.write('retry: 3000\n\n');
  } catch {
    /* gone */
  }

  // Handle Last-Event-ID reconnection if provided
  if (lastEventId) {
    const match = String(lastEventId).match(/^([^:]+):(\d+)$/);
    if (match) {
      const [, resumeReqId, seqStr] = match;
      const lastSeq = parseInt(seqStr, 10);
      const existing = sessionRing.get(resumeReqId);

      if (existing && resumeReqId === requestId) {
        for (const evt of existing.events) {
          if (evt.seq > lastSeq) {
            try {
              res.write(evt.chunk);
            } catch {
              /* connection lost */
            }
          }
        }
        if (existing.closed) {
          try {
            res.end();
          } catch {
            /* gone */
          }
          return {
            emit() {},
            close() {},
            id: () => requestId,
            resumed: true,
          };
        }
      } else if (!existing) {
        const unavailableData = {
          reason: 'unknown_session_or_cold_instance',
          requestId,
          t: new Date().toISOString(),
          elapsedMs: Date.now() - startTime,
        };
        const chunk = formatSse({
          id: `${requestId}:1`,
          event: 'resume_unavailable',
          data: unavailableData,
        });
        try {
          res.write(chunk);
          res.end();
        } catch {
          /* gone */
        }
        return {
          emit() {},
          close() {},
          id: () => requestId,
          resumed: false,
          unavailable: true,
        };
      }
    }
  }

  let sessionRecord = sessionRing.get(requestId);
  if (!sessionRecord) {
    sessionRecord = {
      createdAt: Date.now(),
      seq: 0,
      events: [],
      closed: false,
    };
    sessionRing.set(requestId, sessionRecord);
  }

  let heartbeatTimer = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeatTimer);
    }
  }, heartbeatMs);

  if (signal) {
    signal.addEventListener?.(
      'abort',
      () => {
        clearInterval(heartbeatTimer);
      },
      { once: true },
    );
  }

  let closed = false;

  function emit(event, data) {
    if (closed || signal?.aborted) return;
    sessionRecord.seq += 1;
    const seq = sessionRecord.seq;
    const eventId = `${requestId}:${seq}`;
    const elapsedMs = Date.now() - startTime;
    const t = new Date().toISOString();

    const payload =
      data && typeof data === 'object' && !Array.isArray(data)
        ? { ...data, t: data.t || t, elapsedMs: data.elapsedMs ?? elapsedMs }
        : { value: data, t, elapsedMs };

    const chunk = formatSse({ id: eventId, event, data: payload });
    try {
      res.write(chunk);
    } catch {
      /* gone */
    }

    sessionRecord.events.push({
      id: eventId,
      seq,
      event,
      data: payload,
      chunk,
    });
  }

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeatTimer);
    sessionRecord.closed = true;
    try {
      res.end();
    } catch {
      /* gone */
    }
  }

  return {
    emit,
    close,
    id: () => requestId,
  };
}

export default createSceneEventStream;
