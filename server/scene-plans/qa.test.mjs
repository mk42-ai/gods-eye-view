import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSceneQa, buildQaPrompt, QaServiceError } from './qa.js';

test('buildQaPrompt formats prompt with QA_COMMAND_SPEC and context JSON', () => {
  const prompt = buildQaPrompt({
    question: 'Show aerial view',
    context: { sceneId: 's1', entities: [{ id: 'e1', label: 'Car' }] },
  });

  assert.match(prompt, /Grounded Cinematic Scene Q&A Assistant/);
  assert.match(prompt, /wide_aerial/);
  assert.match(prompt, /"sceneId": "s1"/);
  assert.match(prompt, /QUESTION: Show aerial view/);
});

function createMockRegistry(models = []) {
  return {
    async list() {
      return { models, source: 'live' };
    },
    async isAvailable(id) {
      return Boolean(models.find((m) => m.endpointId === id && m.available));
    },
    async pickForTask() {
      return (
        models.find((m) => m.available && m.streaming) || models[0] || null
      );
    },
  };
}

function createMockSessions() {
  let releaseCalls = 0;
  return {
    async acquire({ purpose }) {
      return { id: `sess-${purpose}`, refs: 1 };
    },
    release() {
      releaseCalls++;
    },
    get releaseCalls() {
      return releaseCalls;
    },
  };
}

test('createSceneQa ask() happy path validates and returns commands', async () => {
  const qaOutput = JSON.stringify({
    answer: 'Switching to a wide aerial view of the Burj Khalifa scene.',
    commands: [{ command: 'wide_aerial', heightM: 800 }],
  });

  const deltas = [];
  const mockStreamQuery = async ({ onDelta }) => {
    onDelta(qaOutput, { eventIndex: 0, elapsedMs: 50 });
    return {
      answer: qaOutput,
      deltas: 1,
      ttftMs: 120,
      totalMs: 450,
      tokensPerSec: 180,
    };
  };

  const registry = createMockRegistry([
    {
      endpointId: 'predefined-cerebras-qwen-3.8-27b',
      modelId: 'qwen-3.8-27b',
      provider: 'cerebras',
      available: true,
      streaming: true,
    },
  ]);
  const sessions = createMockSessions();

  const qa = createSceneQa({
    registry,
    sessions,
    streamQuery: mockStreamQuery,
  });

  const result = await qa.ask({
    question: 'Show me an aerial view',
    context: { sceneId: 'scene-1', entities: [] },
    onDelta: (text) => deltas.push(text),
  });

  assert.equal(
    result.answer,
    'Switching to a wide aerial view of the Burj Khalifa scene.',
  );
  assert.deepEqual(result.commands, [{ command: 'wide_aerial', heightM: 800 }]);
  assert.equal(result.repaired, false);
  assert.equal(result.model.endpointId, 'predefined-cerebras-qwen-3.8-27b');
  assert.equal(sessions.releaseCalls, 1);
  assert.equal(deltas.length, 1);
});

test('createSceneQa ask() handles repair round when initial answer is invalid', async () => {
  let pass = 0;
  const mockStreamQuery = async ({ onDelta }) => {
    pass++;
    if (pass === 1) {
      // Invalid response (not JSON)
      const raw = 'I am showing an aerial view now.';
      onDelta(raw, { eventIndex: 0, elapsedMs: 20 });
      return {
        answer: raw,
        deltas: 1,
        ttftMs: 50,
        totalMs: 200,
        tokensPerSec: 100,
      };
    } else {
      // Corrected response
      const fixed = JSON.stringify({
        answer: 'Showing wide aerial view.',
        commands: [{ command: 'wide_aerial' }],
      });
      onDelta(fixed, { eventIndex: 0, elapsedMs: 30 });
      return {
        answer: fixed,
        deltas: 1,
        ttftMs: 60,
        totalMs: 250,
        tokensPerSec: 120,
      };
    }
  };

  const registry = createMockRegistry([
    {
      endpointId: 'ep-1',
      modelId: 'm-1',
      provider: 'cerebras',
      available: true,
      streaming: true,
    },
  ]);
  const sessions = createMockSessions();

  const qa = createSceneQa({
    registry,
    sessions,
    streamQuery: mockStreamQuery,
  });

  const result = await qa.ask({
    question: 'wide aerial',
    context: { sceneId: 's1' },
  });

  assert.equal(pass, 2);
  assert.equal(result.repaired, true);
  assert.equal(result.answer, 'Showing wide aerial view.');
  assert.deepEqual(result.commands, [{ command: 'wide_aerial' }]);
});

test('createSceneQa ask() falls back to free-text answer with empty commands if repair fails', async () => {
  const mockStreamQuery = async () => ({
    answer: 'Just a plain conversational answer without commands.',
    deltas: 1,
    ttftMs: 50,
    totalMs: 200,
    tokensPerSec: 100,
  });

  const registry = createMockRegistry([
    {
      endpointId: 'ep-1',
      modelId: 'm-1',
      provider: 'cerebras',
      available: true,
      streaming: true,
    },
  ]);
  const sessions = createMockSessions();

  const qa = createSceneQa({
    registry,
    sessions,
    streamQuery: mockStreamQuery,
  });

  const result = await qa.ask({
    question: 'What is happening?',
    context: { sceneId: 's1' },
  });

  assert.equal(
    result.answer,
    'Just a plain conversational answer without commands.',
  );
  assert.deepEqual(result.commands, []);
  assert.equal(result.repaired, true);
});

test('createSceneQa ask() validates input and throws error on missing model', async () => {
  const registry = createMockRegistry([]);
  const sessions = createMockSessions();
  const qa = createSceneQa({ registry, sessions });

  // Missing question -> 400
  await assert.rejects(
    qa.ask({ question: '', context: {} }),
    (err) => err instanceof QaServiceError && err.status === 400,
  );

  // Missing model -> 503
  await assert.rejects(
    qa.ask({ question: 'hello', context: {} }),
    (err) => err instanceof QaServiceError && err.status === 503,
  );
});
