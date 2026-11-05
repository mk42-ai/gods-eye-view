import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldFallBackToJsonConstruct } from './ui/index.js';

test('stream transport failures fall back to the JSON construct route', () => {
  assert.equal(
    shouldFallBackToJsonConstruct(Object.assign(new Error('x'), { status: 404 })),
    true,
    'older server without /construct/stream',
  );
  assert.equal(
    shouldFallBackToJsonConstruct(
      Object.assign(new Error('x'), { code: 'non_sse_response' }),
    ),
    true,
  );
  assert.equal(
    shouldFallBackToJsonConstruct(
      Object.assign(new Error('x'), { code: 'resume_unavailable' }),
    ),
    true,
  );
  assert.equal(
    shouldFallBackToJsonConstruct(new TypeError('Failed to fetch')),
    true,
    'network drop with no status and no code',
  );
});

test('scene errors and cancellations never trigger a silent JSON re-run', () => {
  assert.equal(
    shouldFallBackToJsonConstruct(
      Object.assign(new Error('needs clarification'), {
        status: 422,
        code: 'needs_clarification',
      }),
    ),
    false,
  );
  assert.equal(
    shouldFallBackToJsonConstruct(
      Object.assign(new Error('planner failed'), { status: 502 }),
    ),
    false,
  );
  const abort = new Error('Request cancelled.');
  abort.name = 'AbortError';
  assert.equal(shouldFallBackToJsonConstruct(abort), false);
  assert.equal(
    shouldFallBackToJsonConstruct(
      Object.assign(new Error('stream error'), { code: 'scene_service_error' }),
    ),
    false,
    'an error event from the stream carries a code and is final',
  );
  assert.equal(shouldFallBackToJsonConstruct(null), false);
});

test('stream telemetry never becomes a persisted scene field', async () => {
  const { createGeographicSceneStore } = await import(
    '../scenes/geographicScene.js'
  );
  const memory = new Map();
  const storage = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
  };
  const store = createGeographicSceneStore(storage);
  // A scene object carrying telemetry the way index.js attaches it.
  const scene = { version: 'not-a-real-scene' };
  Object.defineProperty(scene, 'streamTimings', {
    value: { ttftMs: 1 },
    enumerable: false,
  });
  assert.equal(Object.keys(scene).includes('streamTimings'), false);
  assert.equal(JSON.parse(JSON.stringify(scene)).streamTimings, undefined);
  // The store rejects the fake version, not an unknown telemetry key.
  const result = store.save(scene);
  assert.equal(result.saved, false);
  assert.equal(result.reason, 'invalid-scene');
});
