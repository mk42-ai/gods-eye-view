/**
 * Optional fast inference for scene evidence (server-only).
 *
 * Cerebras is used ONLY as an inference/latency aid — never as a data source:
 *   1. parseIntent  — place / intent / time window from the AOI text
 *   2. summarize    — short evidence summary over items the sources returned
 * Every call has a hard budget and a deterministic fallback, so the pipeline
 * works identically (just slower/plainer) with no Cerebras access.
 *
 * Engines, in order of preference:
 *   'cerebras-direct'   CEREBRAS_API_KEY set → https://api.cerebras.ai/v1/chat/completions
 *   'cerebras-ondemand' OnDemand endpoint predefined-cerebras-qwen-3.8-27b
 *                       (Cerebras-hosted model served through the existing
 *                       OnDemand key; enabled unless SCENE_EVIDENCE_CEREBRAS=off)
 *   'deterministic'     regex parser + template summary
 */
import { parseIncidentQuery } from '../../src/incidents/query.js';
import { deterministicSummary } from '../../src/sceneEvidence/model.js';

export const CEREBRAS_URL = 'https://api.cerebras.ai/v1/chat/completions';
export const CEREBRAS_DIRECT_MODEL = 'gpt-oss-120b';
export const CEREBRAS_ONDEMAND_ENDPOINT = 'predefined-cerebras-qwen-3.8-27b';

export function inferenceEngine(
  env = process.env,
  { hasOnDemand = false } = {},
) {
  const mode = String(env.SCENE_EVIDENCE_CEREBRAS || 'auto').toLowerCase();
  if (mode === 'off') return 'deterministic';
  if (String(env.CEREBRAS_API_KEY || '').trim()) return 'cerebras-direct';
  if (hasOnDemand) return 'cerebras-ondemand';
  return 'deterministic';
}

function firstJson(text) {
  const s = String(text || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch {
    return null;
  }
}

/** Deterministic intent parse (the fallback and the reference). */
export function deterministicIntent(text) {
  const p = parseIncidentQuery(String(text || ''), {
    defaultIntent: 'build_scene',
  });
  return {
    place: p.place,
    intent: p.intent,
    windowHours: p.windowHours,
    aliases: [],
    engine: 'deterministic',
  };
}

async function callDirect({
  env,
  fetchImpl,
  messages,
  signal,
  timeoutMs,
  maxTokens,
}) {
  const t = AbortSignal.timeout(timeoutMs);
  const res = await fetchImpl(CEREBRAS_URL, {
    method: 'POST',
    signal: signal ? AbortSignal.any([signal, t]) : t,
    headers: {
      authorization: `Bearer ${env.CEREBRAS_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.CEREBRAS_MODEL || CEREBRAS_DIRECT_MODEL,
      messages,
      max_completion_tokens: maxTokens,
      temperature: 0,
      reasoning_effort: 'low',
    }),
  });
  if (!res.ok) throw new Error(`cerebras_http_${res.status}`);
  const j = await res.json();
  return String(j?.choices?.[0]?.message?.content || '');
}

async function callOnDemand({ client, messages, signal, timeoutMs }) {
  const session = await client.sessions.create({
    externalUserId: `scene-evidence-inf-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    pluginIds: [],
  });
  const out = await client.query.sync(
    session.id,
    {
      query: messages
        .map((m) =>
          m.role === 'system' ? `INSTRUCTIONS: ${m.content}` : m.content,
        )
        .join('\n\n'),
      endpointId: CEREBRAS_ONDEMAND_ENDPOINT,
      responseMode: 'sync',
      pluginIds: [],
      reasoningEffort: 'low',
    },
    { signal, timeoutMs },
  );
  return String(out?.data?.answer || '');
}

export function createInference({
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  client = null,
  engine,
} = {}) {
  const chosen =
    engine || inferenceEngine(env, { hasOnDemand: Boolean(client) });
  const call = (messages, opts) =>
    chosen === 'cerebras-direct'
      ? callDirect({ env, fetchImpl, messages, ...opts })
      : callOnDemand({ client, messages, ...opts });

  return {
    engine: chosen,
    async parseIntent(text, { signal, timeoutMs = 3500 } = {}) {
      const base = deterministicIntent(text);
      if (chosen === 'deterministic') return { ...base, ms: 0 };
      const t0 = Date.now();
      try {
        const answer = await call(
          [
            {
              role: 'system',
              content:
                'Extract the UAE place a user wants a scene for. Reply with ONLY JSON {"place":"<proper place name, no verbs>","aliases":["<up to 3 alternative spellings or Arabic name>"],"intent":"build_scene|incident_search","windowHours":<1-168, default 72>}. Never invent coordinates.',
            },
            { role: 'user', content: String(text).slice(0, 300) },
          ],
          { signal, timeoutMs, maxTokens: 160 },
        );
        const j = firstJson(answer);
        if (!j || typeof j.place !== 'string' || !j.place.trim())
          throw new Error('unparseable');
        return {
          place: j.place.trim().slice(0, 80),
          aliases: Array.isArray(j.aliases)
            ? j.aliases
                .filter((a) => typeof a === 'string')
                .map((a) => a.slice(0, 60))
                .slice(0, 3)
            : [],
          intent:
            j.intent === 'incident_search' ? 'incident_search' : base.intent,
          windowHours: Number.isFinite(Number(j.windowHours))
            ? Math.max(1, Math.min(168, Number(j.windowHours)))
            : base.windowHours,
          engine: chosen,
          ms: Date.now() - t0,
        };
      } catch (err) {
        return {
          ...base,
          ms: Date.now() - t0,
          fallback: String(err?.message || err).slice(0, 80),
        };
      }
    },
    async summarize(input, { signal, timeoutMs = 6000 } = {}) {
      const base = deterministicSummary(input);
      if (
        chosen === 'deterministic' ||
        (!input.items?.length && !input.signals?.length)
      )
        return { ...base, ms: 0 };
      const t0 = Date.now();
      try {
        const facts = {
          place: input.place,
          items: (input.items || []).slice(0, 12).map((x) => ({
            platform: x.platform,
            title: x.title,
            freshness: x.freshness,
            publishedAt: x.publishedAt,
            geo: x.geo?.precision,
          })),
          signals: (input.signals || []).slice(0, 10).map((s) => ({
            title: s.title,
            outlet: s.outlet,
            publishedAt: s.publishedAt,
            freshness: s.freshness,
          })),
          sources: (input.sources || []).map((s) => ({
            id: s.id,
            state: s.state,
          })),
        };
        const answer = await call(
          [
            {
              role: 'system',
              content:
                'You summarise situational-awareness evidence for an operator. Use ONLY the JSON facts given. 3 short sentences max. State freshness and location precision honestly (text-inferred is NOT a confirmed location). If nothing is LIVE/RECENT say so. No speculation, no names of private individuals.',
            },
            { role: 'user', content: JSON.stringify(facts) },
          ],
          { signal, timeoutMs, maxTokens: 220 },
        );
        const text = String(answer).replace(/\s+/g, ' ').trim().slice(0, 700);
        if (!text) throw new Error('empty');
        return { text, engine: chosen, lines: base.lines, ms: Date.now() - t0 };
      } catch (err) {
        return {
          ...base,
          ms: Date.now() - t0,
          fallback: String(err?.message || err).slice(0, 80),
        };
      }
    },
  };
}
