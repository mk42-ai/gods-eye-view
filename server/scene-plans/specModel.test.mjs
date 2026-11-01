import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSpecModel,
  specModelConfig,
  specInstructions,
  CEREBRAS_URL,
  CREDENTIAL_REQUEST,
} from './specModel.js';

const RAID_PROMPT = 'police raid at Burj Al Arab';

const validSpec = (overrides = {}) => ({
  scenarioType: 'police_raid',
  focalEntity: { name: 'Burj Al Arab', kind: 'building' },
  elements: [
    { type: 'inner_cordon', params: { radius_m: 80 } },
    { type: 'outer_cordon', params: { radius_m: 220 } },
    { type: 'approach_route', params: { count: 3 } },
    { type: 'egress_route', params: { count: 1, direction: 'NE' } },
    { type: 'staging_point', params: { direction: 'N' } },
    { type: 'perimeter_unit', params: { count: 6 } },
  ],
  confidence: 0.9,
  ...overrides,
});

const unconfiguredTransport = { configured: () => false };
const configuredTransport = { configured: () => true };

function harness({
  tiers,
  env = {},
  transport = unconfiguredTransport,
  fetch,
} = {}) {
  const logs = [];
  let clock = 1000;
  const model = createSpecModel({
    transport,
    env,
    fetch,
    log: (entry) => logs.push(entry),
    now: () => (clock += 5),
    tiers,
  });
  return { model, logs };
}

const tier = (provider, id, run, retries = 0, extra = {}) => ({
  provider,
  id,
  retries,
  run,
  ...extra,
});

test('first tier returning valid JSON is recorded with provider, id, latency and attempts', async () => {
  const calls = [];
  const { model, logs } = harness({
    tiers: () => [
      tier(
        'cerebras-direct',
        'qwen-3.8-27b',
        async (prompt, focalName, { signal }) => {
          calls.push({ prompt, focalName, hasSignal: 'signal' in { signal } });
          return JSON.stringify(validSpec());
        },
        1,
      ),
      tier('ondemand', 'never', async () => {
        throw new Error('must not be called');
      }),
    ],
  });
  const result = await model.classify(RAID_PROMPT);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, RAID_PROMPT);
  assert.equal(calls[0].focalName, 'Burj Al Arab');
  assert.deepEqual(result.spec, validSpec());
  assert.equal(result.model.provider, 'cerebras-direct');
  assert.equal(result.model.id, 'qwen-3.8-27b');
  assert.equal(typeof result.model.latencyMs, 'number');
  assert.ok(result.model.latencyMs > 0);
  assert.equal(result.model.repaired, false);
  assert.deepEqual(result.model.reasons, []);
  assert.equal(result.model.fallback, null);
  assert.equal(result.model.attempts.length, 1);
  assert.equal(result.model.attempts[0].ok, true);
  assert.equal(result.model.attempts[0].provider, 'cerebras-direct');
  assert.equal(typeof result.model.attempts[0].ms, 'number');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].event, 'spec');
  assert.equal(logs[0].scenarioType, 'police_raid');
  assert.equal(logs[0].provider, 'cerebras-direct');
});

test('a timeout on a tier with retries:1 records two attempts then uses the second tier', async () => {
  let first = 0;
  const { model } = harness({
    tiers: () => [
      tier(
        'cerebras-direct',
        'qwen-3.8-27b',
        async () => {
          first++;
          throw new DOMException(
            'The operation was aborted due to timeout',
            'TimeoutError',
          );
        },
        1,
      ),
      tier(
        'ondemand',
        'predefined-cerebras-qwen-3.8-27b',
        async () => JSON.stringify(validSpec()),
        0,
        {
          endpointId: 'predefined-cerebras-qwen-3.8-27b',
        },
      ),
    ],
  });
  const result = await model.classify(RAID_PROMPT);
  assert.equal(first, 2);
  assert.equal(result.model.provider, 'ondemand');
  assert.equal(result.model.id, 'predefined-cerebras-qwen-3.8-27b');
  assert.equal(result.model.endpointId, 'predefined-cerebras-qwen-3.8-27b');
  assert.equal(result.model.attempts.length, 3);
  assert.deepEqual(
    result.model.attempts.slice(0, 2).map((a) => [a.provider, a.ok, a.error]),
    [
      ['cerebras-direct', false, 'timeout'],
      ['cerebras-direct', false, 'timeout'],
    ],
  );
  assert.equal(result.model.attempts[2].ok, true);
  assert.equal(result.model.fallback, null);
});

test('prose with an embedded JSON object is parsed', async () => {
  const { model } = harness({
    tiers: () => [
      tier(
        'ondemand',
        'predefined-gpt-6.1-sol',
        async () =>
          `Sure, here is the spec:\n${JSON.stringify(validSpec())}\nLet me know.`,
      ),
    ],
  });
  const result = await model.classify(RAID_PROMPT);
  assert.equal(result.model.provider, 'ondemand');
  assert.equal(result.model.repaired, false);
  assert.deepEqual(result.spec, validSpec());
});

test('JSON with an unknown element is accepted as generic: true and reported', async () => {
  const raw = validSpec();
  raw.elements.push({ type: 'sniper_nest', params: { count: 1 } });
  const { model } = harness({
    tiers: () => [
      tier('cerebras-direct', 'qwen-3.8-27b', async () => JSON.stringify(raw)),
    ],
  });
  const result = await model.classify(RAID_PROMPT);
  assert.equal(result.model.attempts.length, 1);
  assert.equal(result.model.attempts[0].ok, true);
  const sniper = result.spec.elements.find((e) => e.type === 'sniper_nest');
  assert.ok(sniper, 'unknown element sniper_nest is accepted');
  assert.equal(sniper.generic, true, 'unknown element has generic: true');
  assert.equal(result.model.fallback, null);
});

test('all tiers failing yields the scenario template with every failure recorded', async () => {
  const { model, logs } = harness({
    tiers: () => [
      tier('cerebras-direct', 'qwen-3.8-27b', async () => {
        throw new Error('cerebras_http_500');
      }),
      tier(
        'ondemand',
        'predefined-cerebras-qwen-3.8-27b',
        async () => 'no json here',
      ),
      tier('ondemand', 'predefined-gpt-6.1-sol', async () =>
        JSON.stringify({ scenarioType: 'police_raid' }),
      ),
    ],
  });
  const result = await model.classify('Dubai Run on Sheikh Zayed Road');
  assert.equal(result.model.provider, 'template');
  assert.equal(result.model.fallback, 'template');
  assert.equal(result.model.repaired, true);
  assert.equal(result.spec.scenarioType, 'crowd_event');
  assert.equal(result.model.id, 'scenario-template:crowd_event');
  assert.equal(result.model.attempts.length, 3);
  for (const attempt of result.model.attempts) {
    assert.equal(attempt.ok, false);
    assert.equal(typeof attempt.error, 'string');
    assert.ok(attempt.error.length > 0);
  }
  assert.equal(result.model.attempts[0].error, 'cerebras_http_500');
  assert.equal(result.model.attempts[1].error, 'no_json');
  assert.ok(result.model.attempts[2].error.startsWith('invalid spec'));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].fallback, 'template');
});

test('an already-aborted signal rejects with AbortError and never falls back to the template', async () => {
  let ran = 0;
  const { model, logs } = harness({
    tiers: () => [
      tier('cerebras-direct', 'qwen-3.8-27b', async () => {
        ran++;
        return JSON.stringify(validSpec());
      }),
    ],
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    model.classify(RAID_PROMPT, { signal: controller.signal }),
    (err) => {
      assert.equal(err.name, 'AbortError');
      return true;
    },
  );
  assert.equal(ran, 0);
  assert.equal(logs.length, 0);
});

test('specModelConfig exposes the Cerebras credential request only without a key', () => {
  const without = specModelConfig({});
  assert.equal(without.cerebrasDirect, false);
  assert.equal(without.credentialRequest.service, 'Cerebras');
  assert.deepEqual(without.credentialRequest.fields, ['CEREBRAS_API_KEY']);
  assert.equal(without.credentialRequest.optional, true);
  assert.equal(without.credentialRequest, CREDENTIAL_REQUEST);
  const withKey = specModelConfig({ CEREBRAS_API_KEY: 'test-key' });
  assert.equal(withKey.cerebrasDirect, true);
  assert.equal(withKey.credentialRequest, null);
  assert.equal(withKey.cerebrasPrimary, 'qwen-3.8-27b');
  assert.equal(withKey.cerebrasFallback, 'qwen-3-235b-a22b-instruct-2507');
});

test('default tiers with a configured transport and no key are the two OnDemand endpoints then template', () => {
  const { model } = harness({ transport: configuredTransport });
  assert.deepEqual(model.config().tiers, [
    'ondemand:predefined-cerebras-qwen-3.8-27b',
    'ondemand:predefined-gpt-6.1-sol',
    'template',
  ]);
  assert.equal(model.config().cerebrasDirect, false);
  assert.equal(model.config().ultraFastEndpointExists, false);
});

test('default tiers with a Cerebras key start with the direct primary then fallback model', () => {
  const { model } = harness({
    transport: configuredTransport,
    env: { CEREBRAS_API_KEY: 'test-key' },
  });
  assert.deepEqual(model.config().tiers, [
    'cerebras-direct:qwen-3.8-27b',
    'cerebras-direct:qwen-3-235b-a22b-instruct-2507',
    'ondemand:predefined-cerebras-qwen-3.8-27b',
    'ondemand:predefined-gpt-6.1-sol',
    'template',
  ]);
  assert.equal(model.config().credentialRequest, null);
  const noTransport = harness({ env: { CEREBRAS_API_KEY: 'test-key' } }).model;
  assert.deepEqual(noTransport.config().tiers, [
    'cerebras-direct:qwen-3.8-27b',
    'cerebras-direct:qwen-3-235b-a22b-instruct-2507',
    'template',
  ]);
});

test('specInstructions forbids coordinates and embeds the prompt', () => {
  const text = specInstructions('raid at <Place> & "quotes"', 'Place');
  assert.ok(text.includes('NEVER output coordinates'));
  assert.ok(text.includes(JSON.stringify('raid at <Place> & "quotes"')));
  assert.ok(text.includes('Focal entity hint'));
  assert.ok(text.includes(JSON.stringify('Place')));
  const lines = text.split('\n');
  for (const line of lines)
    if (/coordinate/i.test(line))
      assert.match(line, /NEVER output coordinates/);
  assert.ok(specInstructions('x'.repeat(5000), 'x').length < 5000 + 1500);
});

function fakeCerebrasFetch(responder) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, init, body });
    return responder(body, requests.length);
  };
  return { requests, fetchImpl };
}

const jsonResponse = (content, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({ choices: [{ message: { content } }] }),
});

test('cerebras-direct sends a strict json_schema request and parses the reply', async () => {
  const { requests, fetchImpl } = fakeCerebrasFetch(() =>
    jsonResponse(JSON.stringify(validSpec())),
  );
  const { model } = harness({
    env: { CEREBRAS_API_KEY: 'test-key' },
    fetch: fetchImpl,
  });
  const result = await model.classify(RAID_PROMPT);
  assert.equal(requests.length, 1);
  const [{ url, init, body }] = requests;
  assert.equal(url, CEREBRAS_URL);
  assert.equal(url, 'https://api.cerebras.ai/v1/chat/completions');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, 'Bearer test-key');
  assert.equal(init.headers['content-type'], 'application/json');
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(body.model, 'qwen-3.8-27b');
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 400);
  assert.equal(body.reasoning_effort, 'none');
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.name, 'scene_spec');
  assert.equal(
    body.response_format.json_schema.schema.additionalProperties,
    false,
  );
  assert.equal(body.messages.length, 2);
  assert.ok(body.messages[1].content.includes(JSON.stringify(RAID_PROMPT)));
  assert.ok(
    !JSON.stringify(body).includes('test-key'),
    'key never leaks into the body',
  );
  assert.equal(result.model.provider, 'cerebras-direct');
  assert.equal(result.model.id, 'qwen-3.8-27b');
  assert.deepEqual(result.spec, validSpec());
});

test('a 400 on the strict call falls to the non-strict fallback model', async () => {
  const { requests, fetchImpl } = fakeCerebrasFetch((body) =>
    body.response_format.type === 'json_schema'
      ? jsonResponse('', 400)
      : jsonResponse(JSON.stringify(validSpec())),
  );
  const { model } = harness({
    env: { CEREBRAS_API_KEY: 'test-key' },
    fetch: fetchImpl,
  });
  const result = await model.classify(RAID_PROMPT);
  assert.equal(
    requests.length,
    3,
    'strict call, one retry, then fallback model',
  );
  assert.equal(requests[0].body.model, 'qwen-3.8-27b');
  assert.equal(requests[1].body.model, 'qwen-3.8-27b');
  assert.equal(requests[2].body.model, 'qwen-3-235b-a22b-instruct-2507');
  assert.deepEqual(requests[2].body.response_format, { type: 'json_object' });
  assert.equal(requests[2].body.temperature, 0);
  assert.equal(result.model.provider, 'cerebras-direct');
  assert.equal(result.model.id, 'qwen-3-235b-a22b-instruct-2507');
  assert.equal(result.model.fallback, null);
  assert.deepEqual(
    result.model.attempts.map((a) => [a.id, a.ok, a.error]),
    [
      ['qwen-3.8-27b', false, 'cerebras_http_400'],
      ['qwen-3.8-27b', false, 'cerebras_http_400'],
      ['qwen-3-235b-a22b-instruct-2507', true, undefined],
    ],
  );
});

test('a sparse dynamic spec is topped up with the scenario REQUIRED_ELEMENTS (live defect 2026-11-01: observation → zero markers)', async () => {
  const answer = JSON.stringify({
    scenarioType: 'observation',
    focalEntity: { name: "Kane's Boxing Academy", kind: 'venue' },
    elements: [{ type: 'interest_zone', params: { radius_m: 120 } }],
    confidence: 0.6,
  });
  const model = createSpecModel({
    env: {},
    tiers: () => [
      {
        provider: 'test',
        id: 'fake',
        retries: 0,
        run: async () => answer,
      },
    ],
    log: () => {},
  });
  const { spec, model: info } = await model.classify(
    'kanes boxing gym abu dhabi',
  );
  const types = spec.elements.map((e) => e.type);
  assert.equal(types[0], 'interest_zone', 'model elements keep their order');
  assert.ok(types.includes('cctv_signal'), 'required observation element added');
  assert.ok(info.reasons.some((r) => /added missing cctv_signal/.test(r)));
  assert.equal(info.repaired, true);
  assert.equal(info.fallback, null, 'still the model, not the template');
});
