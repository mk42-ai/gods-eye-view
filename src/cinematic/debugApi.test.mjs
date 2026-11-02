import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEventRingBuffer,
  recordEvent,
  createTestRoadClosurePatch,
  installDebugApi,
  getHeapMb,
  getCameraPose,
} from './debugApi.js';
import { emptyScene, ScenePatchSchema } from './sceneSchema.js';

function makeBaseScene(withRoute = true) {
  const scene = emptyScene({
    sceneId: 'scene-debug-1',
    title: 'Downtown Dubai Simulation',
    origin: {
      name: 'Downtown Dubai',
      lat: 25.1972,
      lon: 55.2744,
      heightM: 0,
    },
  });
  if (withRoute) {
    scene.routes = [
      {
        id: 'route-szr',
        label: 'Sheikh Zayed Road',
        kind: 'road_segment',
        coordinates: [
          [55.274, 25.197],
          [55.276, 25.199],
        ],
        closed: false,
        provenance: { kind: 'generated' },
        uncertainty: 'illustrative',
      },
    ];
  }
  return scene;
}

test('createEventRingBuffer: caps at capacity and maintains insertion order', () => {
  const ring = createEventRingBuffer(5);
  for (let i = 1; i <= 8; i++) {
    ring.push({ id: `e-${i}`, val: i });
  }
  assert.equal(ring.size(), 5);
  const arr = ring.toArray();
  assert.equal(arr.length, 5);
  assert.deepEqual(
    arr.map((x) => x.val),
    [4, 5, 6, 7, 8],
  );
});

test('recordEvent: formats SSE frame envelope and records to ring buffer', () => {
  const ring = createEventRingBuffer(10);
  const rec = recordEvent(ring, {
    id: 'run-1:1',
    event: 'scene.patch',
    data: { patchId: 'p-1' },
  });
  assert.ok(rec.t);
  assert.equal(rec.id, 'run-1:1');
  assert.equal(rec.event, 'scene.patch');
  assert.equal(ring.size(), 1);
});

test('createTestRoadClosurePatch: with existing route adjusts first route and validates schema', () => {
  const scene = makeBaseScene(true);
  const patch = createTestRoadClosurePatch(scene, { positionSec: 12 });
  assert.doesNotThrow(() => ScenePatchSchema.parse(patch));
  assert.equal(patch.source, 'test_injection');
  assert.equal(patch.label, 'TEST PATCH — illustrative road closure');
  assert.equal(patch.priority, 'high');

  const adjustOp = patch.ops.find((o) => o.op === 'adjust_route');
  assert.ok(adjustOp);
  assert.equal(adjustOp.routeId, 'route-szr');
  assert.equal(adjustOp.closed, true);

  const signOp = patch.ops.find((o) => o.op === 'add_entity');
  assert.ok(signOp);
  assert.equal(signOp.entity.assetId, 'sprite.signage.road_closed');

  const timelineOp = patch.ops.find((o) => o.op === 'add_timeline_event');
  assert.ok(timelineOp);
  assert.equal(timelineOp.beat.atSec, 12);
  assert.equal(timelineOp.beat.title, 'Test road closure injected');
});

test('createTestRoadClosurePatch: without existing route adds synthetic 2-point route and validates', () => {
  const scene = makeBaseScene(false);
  const patch = createTestRoadClosurePatch(scene, { positionSec: 5 });
  assert.doesNotThrow(() => ScenePatchSchema.parse(patch));

  const addRouteOp = patch.ops.find((o) => o.op === 'add_route');
  assert.ok(addRouteOp);
  assert.equal(addRouteOp.route.closed, true);
  assert.equal(addRouteOp.route.coordinates.length, 2);

  const signOp = patch.ops.find((o) => o.op === 'add_entity');
  assert.ok(signOp);
  assert.equal(signOp.entity.position.eastM, 120);
});

test('installDebugApi: installs on window and exposes complete interface', async () => {
  const fakeStorage = new Map();
  const fakeWindow = {
    localStorage: {
      getItem(k) {
        return fakeStorage.get(k) || null;
      },
      setItem(k, v) {
        fakeStorage.set(k, String(v));
      },
    },
    performance: {
      memory: {
        usedJSHeapSize: 52428800, // 50 MB
      },
      now() {
        return Date.now();
      },
    },
    requestAnimationFrame(cb) {
      setTimeout(cb, 10);
      return 1;
    },
  };

  const scene = makeBaseScene(true);
  let appliedPatches = [];
  let liveReceived = [];
  let modelChanged = null;

  const deps = {
    reducer: {
      scene() {
        return scene;
      },
      state() {
        return {
          runState: 'succeeded',
          metrics: { ttftMs: 220, firstPlayableShotMs: 450 },
        };
      },
      applyPatch(p) {
        appliedPatches.push(p);
        return { scene, applied: p.ops, rejected: [] };
      },
    },
    playback: {
      state() {
        return { state: 'playing', positionSec: 10 };
      },
      positionSec() {
        return 10;
      },
    },
    runtime: {
      snapshot() {
        return { sceneId: scene.sceneId, entities: scene.entities };
      },
      selected() {
        return ['car-1'];
      },
    },
    liveDirector: {
      receive(item) {
        liveReceived.push(item);
        return { applied: true, camera: 'interrupted', eventId: 'ev-live-1' };
      },
    },
    qaExecutor: {
      async execute(commands) {
        return commands.map((c) => ({
          command: c.command,
          ok: true,
          confirmed: true,
        }));
      },
    },
    client: {
      async cinematicQa(question, context) {
        return {
          answer: `Answer to: ${question}`,
          commands: [{ command: 'wide_aerial' }],
        };
      },
      async cinematicModels() {
        return [{ endpointId: 'predefined-cerebras-qwen-3.8-27b' }];
      },
    },
    onModelChange(task, id) {
      modelChanged = { task, id };
    },
  };

  const api = installDebugApi(fakeWindow, deps);
  assert.equal(fakeWindow.__gevCinematic, api);

  assert.equal(api.scene().sceneId, 'scene-debug-1');
  assert.equal(api.state().runState, 'succeeded');
  assert.equal(api.metrics().ttftMs, 220);
  assert.equal(api.snapshot().sceneId, 'scene-debug-1');

  // Test inject
  const injectRes = api.inject('road_closure');
  assert.equal(liveReceived.length, 1);
  assert.equal(liveReceived[0].priority, 'high');
  assert.equal(liveReceived[0].relevance, 0.9);
  assert.equal(
    liveReceived[0].patch.label,
    'TEST PATCH — illustrative road closure',
  );

  // Test QA
  const qaRes = await api.qa('Show wide aerial view');
  assert.ok(qaRes.answer.includes('Show wide aerial view'));
  assert.equal(qaRes.results[0].command, 'wide_aerial');
  assert.equal(qaRes.results[0].ok, true);

  // Test models
  api.setModel('scene_direction', 'predefined-cerebras-qwen-3.8-27b');
  assert.deepEqual(modelChanged, {
    task: 'scene_direction',
    id: 'predefined-cerebras-qwen-3.8-27b',
  });
  const storedModels = JSON.parse(fakeStorage.get('gev.cinematic.models.v1'));
  assert.equal(
    storedModels.scene_direction,
    'predefined-cerebras-qwen-3.8-27b',
  );

  // Test forceModel
  api.forceModel('predefined-does-not-exist');
  assert.equal(
    fakeWindow.__gevCinematicForceModel,
    'predefined-does-not-exist',
  );

  // Test heap
  assert.equal(api.heap(), 50);

  // Test events
  api.recordEvent({ id: 'evt-1', event: 'test', data: {} });
  assert.equal(api.events().length, 1);
  assert.equal(api.events()[0].id, 'evt-1');

  // Test playback API on debugApi
  assert.ok(api.playback, 'api.playback must exist');
  assert.equal(typeof api.playback.play, 'function');
  assert.equal(typeof api.playback.pause, 'function');
  assert.equal(typeof api.playback.seek, 'function');
  assert.equal(typeof api.playback.state, 'function');
  assert.equal(typeof api.playback.positionsSnapshot, 'function');
  assert.equal(api.playback.state().state, 'playing');
});

test('getCameraPose: extracts degrees from Cesium cartographic', () => {
  const fakeViewer = {
    camera: {
      positionCartographic: {
        latitude: (25.1972 * Math.PI) / 180,
        longitude: (55.2744 * Math.PI) / 180,
        height: 450.2,
      },
      heading: (90 * Math.PI) / 180,
      pitch: (-35 * Math.PI) / 180,
    },
  };
  const pose = getCameraPose(fakeViewer);
  assert.equal(pose.lat, 25.1972);
  assert.equal(pose.lon, 55.2744);
  assert.equal(pose.height, 450);
  assert.equal(pose.heading, 90);
  assert.equal(pose.pitch, -35);
});

test('test road-closure injection stays inside the placement bound on a long researched route (live defect 2026-11-01)', async () => {
  const { createTestRoadClosurePatch } = await import('./debugApi.js');
  const { safeValidateScenePatch } = await import('./sceneSchema.js');
  // Sheikh Zayed Road-like route: ~50 km of vertices, only one near the origin.
  const origin = { lat: 25.1972, lon: 55.2744 };
  const coords = [];
  for (let i = 0; i < 50; i++)
    coords.push([55.2744 - i * 0.01, 25.1972 - i * 0.008]);
  const scene = {
    sceneId: 'scene-long-route',
    sceneVersion: 3,
    origin,
    routes: [{ id: 'route-szr', coordinates: coords }],
  };
  const patch = createTestRoadClosurePatch(scene, {
    now: () => 1,
    positionSec: 10,
  });
  const parsed = safeValidateScenePatch(patch);
  assert.equal(
    parsed.success,
    true,
    JSON.stringify(parsed.error?.issues)?.slice(0, 300),
  );
  const sign = patch.ops.find((o) => o.op === 'add_entity').entity;
  assert.ok(
    Math.abs(sign.position.eastM) <= 4900 &&
      Math.abs(sign.position.northM) <= 4900,
  );
  assert.ok(
    Math.hypot(sign.position.eastM, sign.position.northM) < 50,
    'sign sits on the vertex nearest the origin',
  );
});
