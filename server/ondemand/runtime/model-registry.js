/**
 * OnDemand Model Registry — live endpoints parsed into ModelInfo records,
 * with TTL caching, provider classification, task-based model picking,
 * and environment overrides.
 *
 * Contract: src/cinematic/CONTRACT.md §A
 */
import { ondemandFetch } from '../client.js';
import { config } from '../config.js';

/** Fast tier default (live registry 2026-11-03); Cerebras qwen-3.8-27b stays the fallback. */
export const KIMI_FAST_ENDPOINT_ID = 'predefined-kimi-k3-fast';
export const CEREBRAS_FALLBACK_ENDPOINT_ID = 'predefined-cerebras-qwen-3.8-27b';

export const MODEL_TASKS = Object.freeze([
  'scene_direction',
  'camera_direction',
  'scene_patch',
  'event_interpretation',
  'qa',
  'rapid_revision',
  'planner',
  'research',
  'narration',
]);

const DEFAULT_TTL_MS = 300000; // 5 minutes

export function deriveProvider(endpointId = '', modelId = '') {
  const e = String(endpointId).toLowerCase();
  const m = String(modelId).toLowerCase();
  if (e.includes('cerebras') || m.includes('cerebras')) return 'cerebras';
  if (
    e.includes('openai') ||
    m.includes('openai') ||
    e.includes('gpt-') ||
    m.includes('gpt-') ||
    m.startsWith('o3') ||
    m.startsWith('o4')
  )
    return 'openai';
  if (
    e.includes('anthropic') ||
    m.includes('anthropic') ||
    e.includes('claude') ||
    m.includes('claude')
  )
    return 'anthropic';
  if (
    e.includes('google') ||
    m.includes('google') ||
    e.includes('gemini') ||
    m.includes('gemini') ||
    e.includes('gemma') ||
    m.includes('gemma')
  )
    return 'google';
  if (e.includes('deepseek') || m.includes('deepseek')) return 'deepseek';
  if (
    e.includes('xai') ||
    m.includes('xai') ||
    e.includes('grok') ||
    m.includes('grok')
  )
    return 'xai';
  if (
    e.includes('meta') ||
    m.includes('meta') ||
    e.includes('llama') ||
    m.includes('llama') ||
    e.includes('muse') ||
    m.includes('muse')
  )
    return 'meta';
  if (
    e.includes('moonshot') ||
    m.includes('moonshot') ||
    e.includes('kimi') ||
    m.includes('kimi')
  )
    return 'moonshot';
  if (
    e.includes('z-ai') ||
    m.includes('z-ai') ||
    e.includes('zai') ||
    m.includes('zai') ||
    e.includes('glm') ||
    m.includes('glm')
  )
    return 'zai';
  if (e.includes('qwen') || m.includes('qwen')) return 'qwen';
  if (e.includes('minimax') || m.includes('minimax')) return 'minimax';
  if (e.startsWith('byoi')) return 'byoi';
  if (e.startsWith('byom')) return 'byom';
  return 'other';
}

export function parseEndpointRow(row) {
  if (!row || typeof row !== 'object') return null;
  const endpointId = String(row.endpoint_id || '');
  const name = String(row.endpoint_name || '');
  const modelId = String(row.model_id || '');
  const status = String(row.status || 'inactive');
  const available = status === 'active' || status === 'deployed';
  const streaming = Boolean(row.streaming_supported);
  const contextLength =
    typeof row.context_length === 'number' &&
    Number.isFinite(row.context_length)
      ? row.context_length
      : null;
  const reasoningEfforts = Array.isArray(row.reasoning_efforts)
    ? row.reasoning_efforts.map(String)
    : [];
  const provider = deriveProvider(endpointId, modelId);
  const cerebras =
    provider === 'cerebras' ||
    /cerebras/i.test(endpointId) ||
    /cerebras/i.test(modelId);

  const out = {
    endpointId,
    name,
    modelId,
    provider,
    status,
    available,
    streaming,
    contextLength,
    reasoningEfforts,
    cerebras,
  };
  if (row.endpoint_type === 'premium') {
    out.premium = true;
  }
  return out;
}

export function createModelRegistry({
  fetchImpl = ondemandFetch,
  getSettings = () => config,
  ttlMs = DEFAULT_TTL_MS,
  now = () => Date.now(),
  env = process.env,
} = {}) {
  let cache = null; // { fetchedAt, fetchedAtMs, models: ModelInfo[] }

  async function list({ refresh = false } = {}) {
    const currentMs = now();
    if (
      !refresh &&
      cache &&
      currentMs - cache.fetchedAtMs < ttlMs &&
      Array.isArray(cache.models)
    ) {
      return {
        fetchedAt: cache.fetchedAt,
        source: 'cache',
        models: cache.models,
      };
    }

    const settings = getSettings();
    const baseUrl = (settings?.baseUrl || 'https://api.on-demand.io').replace(
      /\/$/,
      '',
    );
    const url = `${baseUrl}/config/v1/public/endpoints`;

    try {
      const res = await fetchImpl(url, {
        method: 'GET',
        timeoutMs: 15000,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const body = await res.json();
      const rawRows = Array.isArray(body?.data) ? body.data : [];
      const models = rawRows.map(parseEndpointRow).filter(Boolean);
      const fetchedAt = new Date(currentMs).toISOString();

      cache = {
        fetchedAt,
        fetchedAtMs: currentMs,
        models,
      };

      return {
        fetchedAt,
        source: 'live',
        models,
      };
    } catch (err) {
      if (cache && Array.isArray(cache.models) && cache.models.length > 0) {
        return {
          fetchedAt: cache.fetchedAt,
          source: 'unavailable',
          models: cache.models,
          error: String(err?.message || err),
        };
      }
      return {
        fetchedAt: null,
        source: 'unavailable',
        models: [],
        error: String(err?.message || err),
      };
    }
  }

  async function isAvailable(endpointId) {
    if (!endpointId || typeof endpointId !== 'string') return false;
    const result = await list();
    if (!result.models || result.models.length === 0) return false;
    const match = result.models.find((m) => m.endpointId === endpointId);
    return Boolean(match?.available);
  }

  async function pickForTask(task, { prefer = [] } = {}) {
    const result = await list();
    const models = result.models || [];
    if (models.length === 0) return null;

    // Check env override first
    const taskUpper = String(task).toUpperCase();
    let overrideId = env[`SCENE_MODEL_${taskUpper}`];
    if (!overrideId && task === 'planner') {
      overrideId = env.SCENE_PLAN_ENDPOINT_ID;
    }
    if (overrideId) {
      const found = models.find(
        (m) => m.endpointId === overrideId && m.available,
      );
      if (found) return found;
    }

    // Check caller prefer list
    if (Array.isArray(prefer)) {
      for (const prefId of prefer) {
        const found = models.find(
          (m) => m.endpointId === prefId && m.available,
        );
        if (found) return found;
      }
    }

    // Default preference order:
    // 1. Kimi K3 fast (predefined-kimi-k3-fast, resolved 2026-11-03 from the
    //    live registry: model accounts/fireworks/routers/kimi-k3-fast)
    const kimiFast = models.find(
      (m) =>
        m.endpointId === KIMI_FAST_ENDPOINT_ID && m.available && m.streaming,
    );
    if (kimiFast) return kimiFast;

    // 2. Cerebras active streaming endpoints (kept as the fallback tier)
    const cerebras = models.find(
      (m) => m.cerebras && m.available && m.streaming,
    );
    if (cerebras) return cerebras;

    // 3. predefined-gpt-6.1-sol
    const gptSol = models.find(
      (m) =>
        m.endpointId === 'predefined-gpt-6.1-sol' && m.available && m.streaming,
    );
    if (gptSol) return gptSol;

    // 3. Any active streaming endpoint
    const anyStreaming = models.find((m) => m.available && m.streaming);
    if (anyStreaming) return anyStreaming;

    return null;
  }

  function assignments() {
    const result = {};
    const models = cache?.models || [];

    for (const task of MODEL_TASKS) {
      const taskUpper = task.toUpperCase();
      let overrideId = env[`SCENE_MODEL_${taskUpper}`];
      if (!overrideId && task === 'planner') {
        overrideId = env.SCENE_PLAN_ENDPOINT_ID;
      }

      if (overrideId) {
        if (models.length > 0) {
          const match = models.find(
            (m) => m.endpointId === overrideId && m.available,
          );
          if (match) {
            result[task] = match.endpointId;
            continue;
          }
        } else {
          result[task] = overrideId;
          continue;
        }
      }

      // Default order: kimi-k3-fast -> cerebras -> gpt-6.1-sol -> any
      const kimiFast = models.find(
        (m) =>
          m.endpointId === KIMI_FAST_ENDPOINT_ID && m.available && m.streaming,
      );
      if (kimiFast) {
        result[task] = kimiFast.endpointId;
        continue;
      }
      const cerebras = models.find(
        (m) => m.cerebras && m.available && m.streaming,
      );
      if (cerebras) {
        result[task] = cerebras.endpointId;
        continue;
      }

      const gptSol = models.find(
        (m) =>
          m.endpointId === 'predefined-gpt-6.1-sol' &&
          m.available &&
          m.streaming,
      );
      if (gptSol) {
        result[task] = gptSol.endpointId;
        continue;
      }

      const anyStreaming = models.find((m) => m.available && m.streaming);
      if (anyStreaming) {
        result[task] = anyStreaming.endpointId;
        continue;
      }

      // Fallback endpoint if cache not yet populated
      result[task] =
        task === 'planner' && env.SCENE_PLAN_ENDPOINT_ID
          ? env.SCENE_PLAN_ENDPOINT_ID
          : KIMI_FAST_ENDPOINT_ID;
    }

    return result;
  }

  function health() {
    return {
      cached: Boolean(cache && cache.models.length > 0),
      fetchedAt: cache?.fetchedAt || null,
      count: cache?.models?.length || 0,
      cerebrasAvailable: Boolean(
        cache?.models?.some((m) => m.cerebras && m.available),
      ),
    };
  }

  return {
    list,
    isAvailable,
    pickForTask,
    assignments,
    health,
  };
}
