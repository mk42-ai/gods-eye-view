import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createModelRegistry,
  deriveProvider,
  parseEndpointRow,
  MODEL_TASKS,
} from './model-registry.js';

test('deriveProvider classifies providers correctly from endpoint/model IDs', () => {
  assert.equal(
    deriveProvider('predefined-cerebras-qwen-3.8-27b', 'qwen-3.8-27b'),
    'cerebras',
  );
  assert.equal(deriveProvider('predefined-openai-gpt4o', 'gpt-4o'), 'openai');
  assert.equal(
    deriveProvider('predefined-gpt-6.1-sol', 'gpt-6.1-sol'),
    'openai',
  );
  assert.equal(
    deriveProvider('predefined-claude-5-5-haiku', 'anthropic/claude-haiku-5-5'),
    'anthropic',
  );
  assert.equal(
    deriveProvider('predefined-gemini-3.8-flash', 'gemini-3.8-flash'),
    'google',
  );
  assert.equal(
    deriveProvider('predefined-deepseek-v4-flash', 'deepseek-v4-flash-fast'),
    'deepseek',
  );
  assert.equal(deriveProvider('predefined-xai-grok4.7', 'grok-4.7'), 'xai');
  assert.equal(
    deriveProvider('predefined-muse_spark_1.3', 'meta/muse-spark-1.3'),
    'meta',
  );
  assert.equal(
    deriveProvider('predefined-kimi-k3-fast', 'kimi-k3-fast'),
    'moonshot',
  );
  assert.equal(
    deriveProvider('predefined-glm-5.3-flash', 'z-ai/glm-5.3-flash'),
    'zai',
  );
  assert.equal(
    deriveProvider('predefined-qwen-3.8-max', 'qwen/qwen3.8-max'),
    'qwen',
  );
  assert.equal(
    deriveProvider('predefined-minimax-m3', 'minimax/minimax-m3'),
    'minimax',
  );
  assert.equal(
    deriveProvider('byoi-c7f50d33-4dfa-4810-bcb0-924652020a36', 'custom'),
    'byoi',
  );
  assert.equal(deriveProvider('byom-35dc9378a949493', 'custom'), 'byom');
  assert.equal(deriveProvider('custom-endpoint', 'custom-model'), 'other');
});

test('parseEndpointRow parses raw OnDemand endpoint record', () => {
  const parsed = parseEndpointRow({
    endpoint_id: 'predefined-cerebras-qwen-3.8-27b',
    endpoint_name: 'cerebras-qwen-3.8',
    model_id: 'qwen-3.8-27b',
    status: 'active',
    streaming_supported: true,
    context_length: 128000,
    reasoning_efforts: ['low', 'medium', 'max'],
    endpoint_type: 'standard',
  });

  assert.equal(parsed.endpointId, 'predefined-cerebras-qwen-3.8-27b');
  assert.equal(parsed.name, 'cerebras-qwen-3.8');
  assert.equal(parsed.modelId, 'qwen-3.8-27b');
  assert.equal(parsed.status, 'active');
  assert.equal(parsed.available, true);
  assert.equal(parsed.streaming, true);
  assert.equal(parsed.contextLength, 128000);
  assert.deepEqual(parsed.reasoningEfforts, ['low', 'medium', 'max']);
  assert.equal(parsed.provider, 'cerebras');
  assert.equal(parsed.cerebras, true);
  assert.equal(parsed.premium, undefined);
});

test('parseEndpointRow handles deployed status and premium flag', () => {
  const parsed = parseEndpointRow({
    endpoint_id: 'byom-1234',
    endpoint_name: 'Deploy',
    model_id: '',
    status: 'deployed',
    streaming_supported: false,
    context_length: null,
    reasoning_efforts: null,
    endpoint_type: 'premium',
  });
  assert.equal(parsed.available, true);
  assert.equal(parsed.streaming, false);
  assert.equal(parsed.contextLength, null);
  assert.deepEqual(parsed.reasoningEfforts, []);
  assert.equal(parsed.premium, true);
});

function makeMockFetch(modelsData, status = 200) {
  let callCount = 0;
  const fn = async () => {
    callCount++;
    if (status !== 200) {
      return { ok: false, status, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: modelsData }),
    };
  };
  fn.getCallCount = () => callCount;
  return fn;
}

const SAMPLE_ENDPOINTS = [
  {
    endpoint_id: 'predefined-cerebras-qwen-3.8-27b',
    endpoint_name: 'cerebras-qwen-3.8',
    model_id: 'qwen-3.8-27b',
    status: 'active',
    streaming_supported: true,
    context_length: 128000,
    reasoning_efforts: ['low', 'medium', 'max'],
  },
  {
    endpoint_id: 'predefined-gpt-6.1-sol',
    endpoint_name: 'gpt-6.1-sol',
    model_id: 'gpt-6.1-sol',
    status: 'active',
    streaming_supported: true,
    context_length: 1050000,
    reasoning_efforts: ['low', 'medium', 'max'],
  },
  {
    endpoint_id: 'predefined-openai-gpt4o',
    endpoint_name: 'gpt-4o',
    model_id: 'gpt-4o',
    status: 'inactive',
    streaming_supported: true,
    context_length: 128000,
    reasoning_efforts: [],
  },
  {
    endpoint_id: 'predefined-claude-5-5-haiku',
    endpoint_name: 'claude-haiku-5-5',
    model_id: 'anthropic/claude-haiku-5-5',
    status: 'active',
    streaming_supported: true,
    context_length: 1000000,
    reasoning_efforts: ['low', 'medium', 'max'],
  },
];

test('createModelRegistry list() fetches live models and caches them within TTL', async () => {
  let time = 1000;
  const mockFetch = makeMockFetch(SAMPLE_ENDPOINTS);
  const registry = createModelRegistry({
    fetchImpl: mockFetch,
    ttlMs: 5000,
    now: () => time,
  });

  const res1 = await registry.list();
  assert.equal(res1.source, 'live');
  assert.equal(res1.models.length, 4);
  assert.equal(mockFetch.getCallCount(), 1);

  // Second call within TTL -> cache
  time += 2000;
  const res2 = await registry.list();
  assert.equal(res2.source, 'cache');
  assert.equal(res2.models.length, 4);
  assert.equal(mockFetch.getCallCount(), 1);

  // Call with refresh: true -> live
  const res3 = await registry.list({ refresh: true });
  assert.equal(res3.source, 'live');
  assert.equal(mockFetch.getCallCount(), 2);

  // Call after TTL expiration -> live
  time += 6000;
  const res4 = await registry.list();
  assert.equal(res4.source, 'live');
  assert.equal(mockFetch.getCallCount(), 3);
});

test('createModelRegistry list() handles fetch failure with and without cache', async () => {
  const failFetch = makeMockFetch([], 500);
  const registry = createModelRegistry({
    fetchImpl: failFetch,
  });

  const res = await registry.list();
  assert.equal(res.source, 'unavailable');
  assert.equal(res.models.length, 0);
  assert.match(res.error, /HTTP 500/);

  // Now test with prior cached models then failure
  let shouldFail = false;
  const toggleFetch = async () => {
    if (shouldFail) {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: SAMPLE_ENDPOINTS }),
    };
  };

  const registry2 = createModelRegistry({
    fetchImpl: toggleFetch,
    ttlMs: 1000,
  });

  const okRes = await registry2.list();
  assert.equal(okRes.source, 'live');
  assert.equal(okRes.models.length, 4);

  shouldFail = true;
  const failRes = await registry2.list({ refresh: true });
  assert.equal(failRes.source, 'unavailable');
  assert.equal(failRes.models.length, 4); // returns cached list
  assert.match(failRes.error, /HTTP 503/);
});

test('createModelRegistry isAvailable() checks live status without inventing availability', async () => {
  const registry = createModelRegistry({
    fetchImpl: makeMockFetch(SAMPLE_ENDPOINTS),
  });

  assert.equal(
    await registry.isAvailable('predefined-cerebras-qwen-3.8-27b'),
    true,
  );
  assert.equal(
    await registry.isAvailable('predefined-openai-gpt4o'),
    false, // inactive
  );
  assert.equal(await registry.isAvailable('non-existent-endpoint'), false);

  // When fetch fails with no cache, never invent availability
  const failRegistry = createModelRegistry({
    fetchImpl: makeMockFetch([], 500),
  });
  assert.equal(
    await failRegistry.isAvailable('predefined-cerebras-qwen-3.8-27b'),
    false,
  );
});

test('createModelRegistry pickForTask() follows default preference order: Cerebras -> gpt-6.1-sol -> any', async () => {
  const registry = createModelRegistry({
    fetchImpl: makeMockFetch(SAMPLE_ENDPOINTS),
    env: {},
  });

  const picked = await registry.pickForTask('scene_direction');
  assert.ok(picked);
  assert.equal(picked.endpointId, 'predefined-cerebras-qwen-3.8-27b');

  // If Cerebras is inactive, picks gpt-6.1-sol
  const noCerebrasEndpoints = SAMPLE_ENDPOINTS.map((e) =>
    e.endpoint_id.includes('cerebras') ? { ...e, status: 'inactive' } : e,
  );
  const registry2 = createModelRegistry({
    fetchImpl: makeMockFetch(noCerebrasEndpoints),
    env: {},
  });
  const picked2 = await registry2.pickForTask('scene_direction');
  assert.equal(picked2.endpointId, 'predefined-gpt-6.1-sol');

  // If both Cerebras and gpt-6.1-sol inactive, picks any active streaming (haiku)
  const onlyHaikuEndpoints = noCerebrasEndpoints.map((e) =>
    e.endpoint_id === 'predefined-gpt-6.1-sol'
      ? { ...e, status: 'inactive' }
      : e,
  );
  const registry3 = createModelRegistry({
    fetchImpl: makeMockFetch(onlyHaikuEndpoints),
    env: {},
  });
  const picked3 = await registry3.pickForTask('scene_direction');
  assert.equal(picked3.endpointId, 'predefined-claude-5-5-haiku');
});

test('createModelRegistry pickForTask() honours env overrides and prefer list', async () => {
  const env = {
    SCENE_MODEL_SCENE_DIRECTION: 'predefined-gpt-6.1-sol',
    SCENE_PLAN_ENDPOINT_ID: 'predefined-claude-5-5-haiku',
  };
  const registry = createModelRegistry({
    fetchImpl: makeMockFetch(SAMPLE_ENDPOINTS),
    env,
  });

  // SCENE_MODEL_SCENE_DIRECTION wins over Cerebras
  const pickedDirection = await registry.pickForTask('scene_direction');
  assert.equal(pickedDirection.endpointId, 'predefined-gpt-6.1-sol');

  // planner prefers SCENE_PLAN_ENDPOINT_ID
  const pickedPlanner = await registry.pickForTask('planner');
  assert.equal(pickedPlanner.endpointId, 'predefined-claude-5-5-haiku');

  // prefer parameter is respected when no env override
  const pickedWithPrefer = await registry.pickForTask('qa', {
    prefer: ['predefined-claude-5-5-haiku'],
  });
  assert.equal(pickedWithPrefer.endpointId, 'predefined-claude-5-5-haiku');
});

test('createModelRegistry assignments() and health()', async () => {
  const env = {
    SCENE_MODEL_QA: 'predefined-gpt-6.1-sol',
    SCENE_PLAN_ENDPOINT_ID: 'predefined-gpt-6.1-sol',
  };
  const registry = createModelRegistry({
    fetchImpl: makeMockFetch(SAMPLE_ENDPOINTS),
    env,
  });

  // Populate cache
  await registry.list();

  const assigns = registry.assignments();
  for (const task of MODEL_TASKS) {
    assert.ok(assigns[task], `Assignment for ${task} exists`);
  }
  assert.equal(assigns.qa, 'predefined-gpt-6.1-sol');
  assert.equal(assigns.scene_direction, 'predefined-cerebras-qwen-3.8-27b');

  const h = registry.health();
  assert.equal(h.cached, true);
  assert.equal(h.count, 4);
  assert.equal(h.cerebrasAvailable, true);
});

test('createModelRegistry pickForTask() returns null when no models available', async () => {
  const emptyRegistry = createModelRegistry({
    fetchImpl: makeMockFetch([]),
    env: {},
  });
  const res = await emptyRegistry.pickForTask('scene_direction');
  assert.equal(res, null);
});

test('createModelRegistry assignments() uses defaults before cache population', () => {
  const registry = createModelRegistry({ env: {} });
  const assigns = registry.assignments();
  assert.equal(assigns.scene_direction, 'predefined-cerebras-qwen-3.8-27b');
  assert.equal(assigns.planner, 'predefined-cerebras-qwen-3.8-27b');
});
