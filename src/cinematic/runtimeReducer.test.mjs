import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeReducer, reduceEvent } from './runtimeReducer.js';
import { emptyScene } from './sceneSchema.js';

test('run.started initializes state', () => {
  const reducer = createRuntimeReducer();
  const res = reducer.ingest({
    event: 'run.started',
    data: {
      runId: 'run-1',
      sceneId: 'scene-1',
      mode: 'cinematic_simulation',
      startedAt: 1000,
      origin: { lat: 25.2, lon: 55.2 },
    },
  });

  assert.equal(res.accepted, true);
  const state = reducer.state();
  assert.equal(state.runId, 'run-1');
  assert.equal(state.sceneId, 'scene-1');
  assert.equal(state.runState, 'running');
  assert.equal(state.stage, 'A');
});

test('monotonic seq drops stale_seq', () => {
  const reducer = createRuntimeReducer();
  reducer.ingest({
    event: 'run.started',
    data: { runId: 'run-1', seq: 1 },
  });

  const res2 = reducer.ingest({
    event: 'answer.delta',
    data: { runId: 'run-1', seq: 3, text: 'hello' },
  });
  assert.equal(res2.accepted, true);

  const stale = reducer.ingest({
    event: 'answer.delta',
    data: { runId: 'run-1', seq: 2, text: 'stale' },
  });
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, 'stale_seq');
});

test('new runId resets state and scene', () => {
  const reducer = createRuntimeReducer();
  reducer.ingest({
    event: 'run.started',
    data: { runId: 'run-1', sceneId: 'scene-1' },
  });

  reducer.ingest({
    event: 'scene.object.created',
    data: {
      entity: {
        id: 'e1',
        assetId: 'sprite.cone',
        label: 'Cone',
        category: 'barrier',
        position: { eastM: 10, northM: 10 },
        uncertainty: 'illustrative',
      },
    },
  });
  assert.ok(reducer.scene());

  // New runId
  reducer.ingest({
    event: 'run.started',
    data: { runId: 'run-2', sceneId: 'scene-2' },
  });

  assert.equal(reducer.state().runId, 'run-2');
  assert.equal(reducer.scene(), null);
});

test('answer.delta sets ttftMs on first delta and accumulates text', () => {
  let currentTime = 1000;
  const reducer = createRuntimeReducer({ now: () => currentTime });

  reducer.ingest({
    event: 'run.started',
    data: { runId: 'run-1', startedAt: 1000 },
  });

  currentTime = 1250;
  reducer.ingest({
    event: 'answer.delta',
    data: { text: 'Hello ' },
  });

  assert.equal(reducer.state().metrics.ttftMs, 250);
  assert.equal(reducer.state().metrics.answerChars, 6);

  currentTime = 1400;
  reducer.ingest({
    event: 'answer.delta',
    data: { text: 'world!' },
  });

  // ttftMs unchanged, answerChars grows
  assert.equal(reducer.state().metrics.ttftMs, 250);
  assert.equal(reducer.state().metrics.answerChars, 12);
});

test('scene.object.created streams in before scene.initialized and creates emptyScene', () => {
  let currentTime = 1000;
  const reducer = createRuntimeReducer({ now: () => currentTime });

  reducer.ingest({
    event: 'run.started',
    data: { runId: 'run-1', origin: { lat: 25.1972, lon: 55.2744 } },
  });

  currentTime = 1300;
  const res = reducer.ingest({
    event: 'scene.object.created',
    data: {
      entity: {
        id: 'officer-1',
        assetId: 'sprite.person.police_officer',
        label: 'Officer 1',
        category: 'police',
        position: { eastM: 20, northM: 30 },
        uncertainty: 'illustrative',
      },
    },
  });

  assert.equal(res.accepted, true);
  assert.ok(reducer.scene());
  assert.equal(reducer.scene().entities.length, 1);
  assert.equal(reducer.scene().entities[0].id, 'officer-1');
  assert.equal(reducer.state().sceneVersion, 1);
  assert.equal(reducer.state().metrics.firstSceneInstructionMs, 300);
});

test('invalid scene.object.created records to invalid[] without throwing', () => {
  const reducer = createRuntimeReducer();
  reducer.ingest({
    event: 'run.started',
    data: { runId: 'run-1' },
  });

  const res = reducer.ingest({
    event: 'scene.object.created',
    data: {
      entity: {
        id: 'bad-entity',
        // missing assetId, category, uncertainty
      },
    },
  });

  assert.equal(res.accepted, false);
  assert.equal(res.reason, 'invalid_entity');
  assert.equal(reducer.state().invalid.length, 1);
});

test('run.completed marks succeeded or partially_completed if invalid exists', () => {
  const r1 = createRuntimeReducer();
  r1.ingest({ event: 'run.started', data: { runId: 'r1' } });
  r1.ingest({ event: 'run.completed', data: {} });
  assert.equal(r1.state().runState, 'succeeded');

  const r2 = createRuntimeReducer();
  r2.ingest({ event: 'run.started', data: { runId: 'r2' } });
  r2.ingest({ event: 'scene.object.created', data: { entity: { id: 'bad' } } });
  r2.ingest({ event: 'run.completed', data: {} });
  assert.equal(r2.state().runState, 'partially_completed');
});

test('intelligence events update counts and evidenceToVisualMs', () => {
  let currentTime = 2000;
  const reducer = createRuntimeReducer({ now: () => currentTime });

  reducer.ingest({ event: 'run.started', data: { runId: 'r1' } });

  currentTime = 2500;
  reducer.ingest({ event: 'intelligence.received', data: {} });
  assert.equal(reducer.state().metrics.intelligenceReceivedCount, 1);
  assert.equal(reducer.state().stage, 'F');

  currentTime = 2850;
  reducer.ingest({ event: 'intelligence.validated', data: {} });
  assert.equal(reducer.state().metrics.intelligenceValidatedCount, 1);
  assert.equal(reducer.state().metrics.evidenceToVisualMs, 350);
});

test('markRendered sets firstRenderedObjectMs', () => {
  const reducer = createRuntimeReducer();
  reducer.ingest({
    event: 'run.started',
    data: { runId: 'r1', startedAt: 1000 },
  });

  reducer.markRendered(1450);
  assert.equal(reducer.state().metrics.firstRenderedObjectMs, 450);
});

test('applyPatch applies patch and tracks stale ops', () => {
  const reducer = createRuntimeReducer();
  reducer.ingest({
    event: 'run.started',
    data: { runId: 'r1', sceneId: 'sc1', origin: { lat: 25, lon: 55 } },
  });

  const baseScene = emptyScene({
    sceneId: 'scene-1',
    origin: { name: 'Origin', lat: 25, lon: 55 },
  });
  reducer.ingest({
    event: 'scene.initialized',
    data: { scene: baseScene },
  });

  const patch = {
    patchId: 'patch-1',
    sceneId: 'scene-1',
    baseVersion: 0,
    source: 'director',
    reason: 'test',
    ops: [
      {
        op: 'add_entity',
        entity: {
          id: 'cone-1',
          assetId: 'sprite.cone',
          label: 'Cone',
          category: 'barrier',
          position: { eastM: 5, northM: 5 },
          uncertainty: 'illustrative',
        },
      },
    ],
  };

  const res = reducer.applyPatch(patch);
  assert.equal(res.accepted, true);
  assert.equal(reducer.scene().entities.length, 1);
  assert.equal(reducer.scene().sceneVersion, 1);
});

test('pure reduceEvent works directly', () => {
  let context = {
    state: {
      runId: null,
      sceneId: null,
      sceneVersion: 0,
      lastSeq: -1,
      runState: 'idle',
      startedAt: null,
      mode: 'cinematic_simulation',
      title: 'Scene',
      origin: null,
      model: null,
      stage: 'A',
      invalid: [],
      metrics: {
        ttftMs: null,
        firstSceneInstructionMs: null,
        firstRenderedObjectMs: null,
        firstPlayableShotMs: null,
        evidenceToVisualMs: null,
        answerChars: 0,
        staleOpsCount: 0,
        intelligenceReceivedCount: 0,
        intelligenceValidatedCount: 0,
      },
      error: null,
      _lastIntelligenceReceivedAt: null,
    },
    scene: null,
  };

  const { context: nextCtx, result } = reduceEvent(context, {
    event: 'run.started',
    data: { runId: 'pure-run' },
  });

  assert.equal(result.accepted, true);
  assert.equal(nextCtx.state.runId, 'pure-run');
  assert.equal(nextCtx.state.runState, 'running');
});
