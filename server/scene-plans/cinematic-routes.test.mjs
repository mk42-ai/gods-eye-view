import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createCinematicMiddleware } from './cinematic-routes.js';
import { resetSessionRing } from './stream.js';

function createMockReq({
  method = 'GET',
  url = '/',
  headers = {},
  body = null,
} = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.body = body;
  return req;
}

function createMockRes() {
  const res = new EventEmitter();
  const headers = {};
  const chunks = [];
  let statusCode = 200;
  let ended = false;

  res.statusCode = statusCode;
  res.headersSent = false;
  res.setHeader = (k, v) => {
    headers[k.toLowerCase()] = v;
  };
  res.getHeader = (k) => headers[k.toLowerCase()];
  res.flushHeaders = () => {
    res.headersSent = true;
  };
  res.write = (chunk) => {
    chunks.push(chunk);
    return true;
  };
  res.end = (chunk) => {
    if (chunk) chunks.push(chunk);
    ended = true;
    res.emit('close');
  };
  res.getJson = () => {
    const raw = chunks.join('');
    return JSON.parse(raw);
  };
  res.getChunks = () => chunks;
  res.isEnded = () => ended;

  return res;
}

function createMockRegistry(models = []) {
  return {
    async list() {
      return { models, source: 'live', fetchedAt: '2026-11-01T12:00:00Z' };
    },
    async isAvailable(id) {
      return Boolean(models.find((m) => m.endpointId === id && m.available));
    },
    async pickForTask() {
      return (
        models.find((m) => m.available && m.streaming) || models[0] || null
      );
    },
    assignments() {
      return {
        scene_direction: 'predefined-cerebras-qwen-3.8-27b',
        qa: 'predefined-cerebras-qwen-3.8-27b',
      };
    },
    health() {
      return {
        cached: true,
        count: models.length,
        cerebrasAvailable: models.some((m) => m.cerebras && m.available),
      };
    },
  };
}

test('cinematic middleware rejects client credentials header with 400', async () => {
  const middleware = createCinematicMiddleware();
  const req = createMockReq({
    method: 'GET',
    url: '/models',
    headers: { 'x-ondemand-key': 'secret' },
  });
  const res = createMockRes();

  await middleware(req, res);
  assert.equal(res.statusCode, 400);
  const json = res.getJson();
  assert.equal(json.error.code, 'client_credentials_rejected');
});

test('cinematic middleware GET /models returns model list and assignments', async () => {
  const registry = createMockRegistry([
    {
      endpointId: 'predefined-cerebras-qwen-3.8-27b',
      modelId: 'qwen-3.8-27b',
      provider: 'cerebras',
      available: true,
      streaming: true,
      cerebras: true,
    },
  ]);
  const middleware = createCinematicMiddleware({ registry });
  const req = createMockReq({ method: 'GET', url: '/models' });
  const res = createMockRes();

  await middleware(req, res);
  assert.equal(res.statusCode, 200);
  const json = res.getJson();
  assert.equal(json.ok, true);
  assert.equal(json.models.length, 1);
  assert.equal(json.cerebrasAvailable, true);
  assert.equal(
    json.assignments.scene_direction,
    'predefined-cerebras-qwen-3.8-27b',
  );
});

test('cinematic middleware POST /models/check checks live availability', async () => {
  const registry = createMockRegistry([
    {
      endpointId: 'ep-active',
      available: true,
    },
    {
      endpointId: 'ep-inactive',
      available: false,
    },
  ]);
  const middleware = createCinematicMiddleware({ registry });

  // Valid active
  const req1 = createMockReq({
    method: 'POST',
    url: '/models/check',
    body: { endpointId: 'ep-active' },
  });
  const res1 = createMockRes();
  await middleware(req1, res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.getJson().available, true);

  // Valid inactive
  const req2 = createMockReq({
    method: 'POST',
    url: '/models/check',
    body: { endpointId: 'ep-inactive' },
  });
  const res2 = createMockRes();
  await middleware(req2, res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.getJson().available, false);

  // Malformed endpointId -> 400
  const req3 = createMockReq({
    method: 'POST',
    url: '/models/check',
    body: { endpointId: '' },
  });
  const res3 = createMockRes();
  await middleware(req3, res3);
  assert.equal(res3.statusCode, 400);
  assert.equal(res3.getJson().error.code, 'invalid_endpoint_id');
});

test('cinematic middleware POST /patch/validate validates patch payload with zod', async () => {
  const middleware = createCinematicMiddleware();

  // Valid patch
  const validPatch = {
    patchId: 'p-1234',
    sceneId: 'scene-1',
    baseVersion: 0,
    ops: [
      {
        op: 'add_shot',
        shot: {
          id: 'shot-1',
          type: 'aerial_establishing',
          title: 'Wide Aerial',
          startSec: 0,
          durationSec: 10,
        },
      },
    ],
    reason: 'testing',
    source: 'user',
  };
  const req1 = createMockReq({
    method: 'POST',
    url: '/patch/validate',
    body: { patch: validPatch },
  });
  const res1 = createMockRes();
  await middleware(req1, res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.getJson().ok, true);

  // Invalid patch (missing ops) -> 400
  const req2 = createMockReq({
    method: 'POST',
    url: '/patch/validate',
    body: { patch: { patchId: 'p1' } },
  });
  const res2 = createMockRes();
  await middleware(req2, res2);
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.getJson().error.code, 'patch_invalid');
});

test('cinematic middleware POST /qa handles Q&A query', async () => {
  const mockQa = {
    async ask({ question }) {
      return {
        answer: `Answer to ${question}`,
        commands: [{ command: 'wide_aerial' }],
        model: { endpointId: 'test-ep' },
      };
    },
  };
  const middleware = createCinematicMiddleware({ qa: mockQa });

  const req = createMockReq({
    method: 'POST',
    url: '/qa',
    body: { question: 'Where are the runners?', context: {} },
  });
  const res = createMockRes();
  await middleware(req, res);

  assert.equal(res.statusCode, 200);
  const json = res.getJson();
  assert.equal(json.ok, true);
  assert.equal(json.answer, 'Answer to Where are the runners?');
  assert.deepEqual(json.commands, [{ command: 'wide_aerial' }]);
});

test('cinematic middleware POST /director/stream streams SSE events with correlation envelope', async () => {
  resetSessionRing();

  const mockDirector = {
    async direct({ emit }) {
      emit('model.selected', {
        endpointId: 'ep-1',
        modelId: 'm-1',
        provider: 'cerebras',
      });
      emit('scene.planning', { title: 'Test' });
      emit('answer.delta', { text: 'chunk' });
      emit('scene.object.created', {
        entity: { id: 'e1', label: 'E1' },
      });
      return {
        scene: { sceneId: 's1', entities: [] },
        model: { endpointId: 'ep-1', ttftMs: 100 },
        invalidLines: [],
        repairs: 0,
      };
    },
  };

  const middleware = createCinematicMiddleware({ director: mockDirector });
  const req = createMockReq({
    method: 'POST',
    url: '/director/stream',
    body: {
      prompt: 'Marathon at Burj Khalifa',
      origin: { name: 'Burj Khalifa', lat: 25.1972, lon: 55.2744 },
    },
  });
  const res = createMockRes();

  await middleware(req, res);
  assert.equal(
    res.getHeader('content-type'),
    'text/event-stream; charset=utf-8',
  );

  const chunks = res.getChunks().join('');
  assert.match(chunks, /event: run\.started/);
  assert.match(chunks, /event: model\.selected/);
  assert.match(chunks, /event: scene\.planning/);
  assert.match(chunks, /event: answer\.delta/);
  assert.match(chunks, /event: scene\.object\.created/);
  assert.match(chunks, /event: run\.completed/);

  // Check correlation envelope (seq, runId, sceneId)
  assert.match(chunks, /"seq":1/);
  assert.match(chunks, /"runId":/);
  assert.match(chunks, /"sceneId":/);
});

test('cinematic middleware POST /director/stream rejects invalid prompt or origin', async () => {
  const middleware = createCinematicMiddleware();

  // Short prompt (< 3 chars)
  const req1 = createMockReq({
    method: 'POST',
    url: '/director/stream',
    body: { prompt: 'hi', origin: { name: 'P', lat: 25, lon: 55 } },
  });
  const res1 = createMockRes();
  await middleware(req1, res1);
  assert.equal(res1.statusCode, 400);
  assert.equal(res1.getJson().error.code, 'invalid_prompt');

  // Invalid origin (lat > 90)
  const req2 = createMockReq({
    method: 'POST',
    url: '/director/stream',
    body: { prompt: 'Marathon', origin: { name: 'P', lat: 100, lon: 55 } },
  });
  const res2 = createMockRes();
  await middleware(req2, res2);
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.getJson().error.code, 'invalid_origin');
});

test('cinematic middleware returns 404 for unknown route', async () => {
  const middleware = createCinematicMiddleware();
  const req = createMockReq({ method: 'GET', url: '/unknown' });
  const res = createMockRes();
  await middleware(req, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.getJson().error.code, 'not_found');
});
