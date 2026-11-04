import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCinematicDirector,
  buildDirectorPrompt,
  DirectorError,
} from './director.js';

test('buildDirectorPrompt includes registered asset IDs, DIRECTOR_LINE_SPEC and route rules', () => {
  const promptNoRoutes = buildDirectorPrompt({
    prompt: 'Marathon at Burj Khalifa',
    origin: { name: 'Burj Khalifa', lat: 25.1972, lon: 55.2744 },
    researchedRoutes: [],
  });

  assert.match(promptNoRoutes, /REGISTERED ASSET IDS/);
  assert.match(promptNoRoutes, /sprite\.cordon_node/);
  assert.match(promptNoRoutes, /Emit NDJSON/);
  assert.match(promptNoRoutes, /NO RESEARCHED ROUTES SUPPLIED/);
  assert.match(promptNoRoutes, /HYPOTHETICAL/);

  const promptWithRoutes = buildDirectorPrompt({
    prompt: 'Marathon at Burj Khalifa',
    origin: { name: 'Burj Khalifa', lat: 25.1972, lon: 55.2744 },
    researchedRoutes: [
      {
        name: 'Loop',
        coordinates: [
          [55.27, 25.19],
          [55.28, 25.2],
        ],
      },
    ],
  });
  assert.match(promptWithRoutes, /RESEARCHED ROUTES AVAILABLE/);
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

test('createCinematicDirector streams NDJSON lines, normalizes assets, emits typed events and validates final scene', async () => {
  const sampleLines = [
    JSON.stringify({
      kind: 'classification',
      title: 'Burj Khalifa Marathon',
      classification: {
        scenarioType: 'marathon',
        intent: 'Staging marathon around Burj Khalifa',
        hypothetical: false,
        geographicConstraints: ['Downtown Dubai'],
        labels: ['Marathon', 'Crowds'],
        uncertaintyNote: 'Illustrative',
      },
    }),
    JSON.stringify({ kind: 'timeline', durationSec: 60 }),
    JSON.stringify({
      kind: 'entity',
      entity: {
        id: 'runner_lead',
        assetId: 'sprite.person.runner',
        label: 'Lead Runners',
        category: 'person',
        position: { eastM: 10, northM: 20 },
        behavior: { type: 'run', speedMps: 5 },
      },
    }),
    JSON.stringify({
      kind: 'entity',
      entity: {
        id: 'crowd_1',
        assetId: 'unknown_asset_id', // Needs asset normalization/substitution
        label: 'Spectators',
        category: 'crowd',
        position: { eastM: -15, northM: 30 },
      },
    }),
    JSON.stringify({
      kind: 'entity',
      entity: {
        id: 'barrier_1',
        assetId: 'sprite.barrier',
        label: 'Perimeter Barrier',
        category: 'barrier',
        position: { eastM: 0, northM: 10 },
      },
    }),
    JSON.stringify({
      kind: 'shot',
      shot: {
        id: 'shot_1',
        type: 'aerial_establishing',
        title: 'Aerial View',
        startSec: 0,
        durationSec: 10,
        subjectIds: ['runner_lead'],
      },
    }),
    JSON.stringify({
      kind: 'beat',
      beat: {
        atSec: 0,
        title: 'Race Start',
        narration: 'Runners approach the boulevard.',
        entityIds: ['runner_lead'],
      },
    }),
    JSON.stringify({ kind: 'end', summary: 'Scene complete' }),
  ];

  const mockStreamQuery = async ({ onDelta }) => {
    for (const line of sampleLines) {
      onDelta(`${line}\n`);
    }
    return {
      answer: sampleLines.join('\n'),
      deltas: sampleLines.length,
      ttftMs: 150,
      totalMs: 1200,
      outputTokens: 250,
      inputTokens: 50,
      tokensPerSec: 238,
    };
  };

  const registry = createMockRegistry([
    {
      endpointId: 'predefined-cerebras-qwen-3.8-27b',
      modelId: 'qwen-3.8-27b',
      provider: 'cerebras',
      available: true,
      streaming: true,
      cerebras: true,
      reasoningEfforts: ['low'],
    },
  ]);
  const sessions = createMockSessions();

  const director = createCinematicDirector({
    registry,
    sessions,
    streamQuery: mockStreamQuery,
  });

  const emitted = [];
  const result = await director.direct({
    prompt: 'Marathon at Burj Khalifa',
    origin: { name: 'Burj Khalifa', lat: 25.1972, lon: 55.2744 },
    emit: (event, data) => emitted.push({ event, data }),
  });

  // Check event sequence
  const eventNames = emitted.map((e) => e.event);
  assert.ok(eventNames.includes('model.selected'));
  assert.ok(eventNames.includes('scene.planning'));
  assert.ok(eventNames.includes('answer.delta'));
  assert.ok(eventNames.includes('scene.object.created'));
  assert.ok(eventNames.includes('scene.patch'));
  assert.ok(eventNames.includes('answer.completed'));

  // Check asset substitution
  assert.ok(result.assetSubstitutions.length > 0);
  assert.equal(result.assetSubstitutions[0].requested, 'unknown_asset_id');

  // Check final scene shape
  assert.ok(result.scene);
  assert.equal(result.scene.entities.length, 3);
  assert.equal(result.scene.shots.length, 1);
  assert.equal(result.scene.timeline.beats.length, 1);
  assert.equal(result.repairs, 0);

  // Check model provenance
  assert.equal(result.model.endpointId, 'predefined-cerebras-qwen-3.8-27b');
  assert.equal(result.model.provider, 'cerebras');

  // Verify session release was called
  assert.equal(sessions.releaseCalls, 1);
});

test('createCinematicDirector performs repair round when minimum requirements not met', async () => {
  // First pass returns only 1 entity and 0 shots/beats
  let pass = 0;
  const mockStreamQuery = async ({ onDelta }) => {
    pass++;
    if (pass === 1) {
      onDelta(
        JSON.stringify({
          kind: 'classification',
          title: 'Partial Scene',
          classification: {
            scenarioType: 'observation',
            intent: 'Incomplete',
            hypothetical: false,
          },
        }) + '\n',
      );
      onDelta(
        JSON.stringify({
          kind: 'entity',
          entity: {
            id: 'e1',
            assetId: 'sprite.generic',
            label: 'Entity 1',
            category: 'marker',
            position: { eastM: 0, northM: 0 },
          },
        }) + '\n',
      );
      onDelta(JSON.stringify({ kind: 'end', summary: 'Early end' }) + '\n');
    } else {
      // Repair pass provides remaining entities, shot, beat
      onDelta(
        JSON.stringify({
          kind: 'entity',
          entity: {
            id: 'e2',
            assetId: 'sprite.generic',
            label: 'Entity 2',
            category: 'marker',
            position: { eastM: 10, northM: 0 },
          },
        }) + '\n',
      );
      onDelta(
        JSON.stringify({
          kind: 'entity',
          entity: {
            id: 'e3',
            assetId: 'sprite.generic',
            label: 'Entity 3',
            category: 'marker',
            position: { eastM: 20, northM: 0 },
          },
        }) + '\n',
      );
      onDelta(
        JSON.stringify({
          kind: 'shot',
          shot: {
            id: 'shot_1',
            type: 'aerial_establishing',
            title: 'Shot 1',
            startSec: 0,
            durationSec: 10,
          },
        }) + '\n',
      );
      onDelta(
        JSON.stringify({
          kind: 'beat',
          beat: { atSec: 0, title: 'Beat 1', narration: 'Start' },
        }) + '\n',
      );
    }
    return {
      answer: 'ok',
      deltas: 5,
      ttftMs: 100,
      totalMs: 1000,
      outputTokens: 100,
    };
  };

  const registry = createMockRegistry([
    {
      endpointId: 'ep-1',
      modelId: 'm-1',
      provider: 'openai',
      available: true,
      streaming: true,
    },
  ]);
  const sessions = createMockSessions();

  const director = createCinematicDirector({
    registry,
    sessions,
    streamQuery: mockStreamQuery,
  });

  const result = await director.direct({
    prompt: 'Observation scene',
    origin: { name: 'Origin', lat: 25, lon: 55 },
  });

  assert.equal(pass, 2); // 1 initial + 1 repair
  assert.equal(result.repairs, 1);
  assert.equal(result.scene.entities.length, 3);
  assert.equal(result.scene.shots.length, 1);
  assert.equal(result.scene.timeline.beats.length, 1);
});

test('createCinematicDirector throws DirectorError when no model available or validation fails', async () => {
  const emptyRegistry = createMockRegistry([]);
  const sessions = createMockSessions();
  const director = createCinematicDirector({
    registry: emptyRegistry,
    sessions,
  });

  await assert.rejects(
    director.direct({
      prompt: 'Scene',
      origin: { name: 'Origin', lat: 25, lon: 55 },
    }),
    (err) => {
      assert.ok(err instanceof DirectorError);
      assert.equal(err.code, 'model_unavailable');
      return true;
    },
  );
});

test('createCinematicDirector honours callerEndpointId when available', async () => {
  const sampleLines = [
    JSON.stringify({
      kind: 'classification',
      title: 'Test',
      classification: {
        scenarioType: 'custom',
        intent: 'test',
        hypothetical: false,
      },
    }),
    JSON.stringify({ kind: 'timeline', durationSec: 30 }),
    JSON.stringify({
      kind: 'entity',
      entity: {
        id: 'e1',
        assetId: 'sprite.generic',
        label: 'E1',
        category: 'marker',
        position: { eastM: 0, northM: 0 },
      },
    }),
    JSON.stringify({
      kind: 'entity',
      entity: {
        id: 'e2',
        assetId: 'sprite.generic',
        label: 'E2',
        category: 'marker',
        position: { eastM: 10, northM: 0 },
      },
    }),
    JSON.stringify({
      kind: 'entity',
      entity: {
        id: 'e3',
        assetId: 'sprite.generic',
        label: 'E3',
        category: 'marker',
        position: { eastM: 20, northM: 0 },
      },
    }),
    JSON.stringify({
      kind: 'shot',
      shot: {
        id: 's1',
        type: 'aerial_establishing',
        title: 'Shot',
        startSec: 0,
        durationSec: 10,
      },
    }),
    JSON.stringify({
      kind: 'beat',
      beat: { atSec: 0, title: 'Beat', narration: 'text' },
    }),
    JSON.stringify({ kind: 'end', summary: 'done' }),
  ];

  let selectedEndpoint = null;
  const mockStream = async ({ endpointId, onDelta }) => {
    selectedEndpoint = endpointId;
    for (const l of sampleLines) onDelta(l + '\n');
    return {
      answer: 'ok',
      deltas: sampleLines.length,
      ttftMs: 50,
      totalMs: 500,
      outputTokens: 80,
    };
  };

  const registry = createMockRegistry([
    {
      endpointId: 'default-ep',
      available: true,
      streaming: true,
      provider: 'cerebras',
    },
    {
      endpointId: 'custom-ep',
      available: true,
      streaming: true,
      provider: 'openai',
    },
  ]);
  const sessions = createMockSessions();
  const director = createCinematicDirector({
    registry,
    sessions,
    streamQuery: mockStream,
  });

  const result = await director.direct({
    prompt: 'Custom model test',
    origin: { name: 'Origin', lat: 25, lon: 55 },
    endpointId: 'custom-ep',
  });

  assert.equal(selectedEndpoint, 'custom-ep');
  assert.equal(result.model.endpointId, 'custom-ep');
});
