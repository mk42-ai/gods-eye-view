import test from 'node:test';
import assert from 'node:assert/strict';
import { createQaExecutor } from './qaExecutor.js';
import { emptyScene, applyScenePatch } from './sceneSchema.js';

function makeMockScene(overrides = {}) {
  const scene = emptyScene({
    sceneId: 'test-scene-1',
    title: 'Test Scene for QA',
    origin: {
      name: 'Downtown Dubai',
      lat: 25.1972,
      lon: 55.2744,
      heightM: 0,
    },
  });
  scene.entities = [
    {
      id: 'car-1',
      assetId: 'sprite.vehicle.police_car',
      label: 'Patrol 1',
      category: 'vehicle',
      position: { eastM: 10, northM: 20 },
      headingDeg: 0,
      scale: 1,
      count: 1,
      spreadM: 0,
      behavior: { type: 'drive' },
      startSec: 0,
      endSec: null,
      uncertainty: 'illustrative',
      provenance: { kind: 'generated', sourceRef: 'director' },
      highlight: false,
      tags: ['police'],
    },
    {
      id: 'snap-1',
      assetId: 'sprite.alert.state_4',
      label: 'Snapchat Evidence',
      category: 'marker',
      position: { eastM: 50, northM: 60 },
      headingDeg: 0,
      scale: 1,
      count: 1,
      spreadM: 0,
      behavior: { type: 'static' },
      startSec: 0,
      endSec: null,
      uncertainty: 'verified',
      provenance: {
        kind: 'evidence',
        evidenceId: 'ev-snap-101',
        sourceRef: 'snapchat',
      },
      highlight: false,
      tags: ['snapchat'],
    },
  ];
  scene.routes = [
    {
      id: 'route-main',
      label: 'Main Boulevard',
      kind: 'road_segment',
      coordinates: [
        [55.2744, 25.1972],
        [55.2754, 25.1982],
      ],
      closed: true,
      closedReason: 'Marathon setup',
      provenance: { kind: 'test' },
      uncertainty: 'illustrative',
    },
    {
      id: 'route-open',
      label: 'Open Street',
      kind: 'road_segment',
      coordinates: [
        [55.27, 25.19],
        [55.271, 25.191],
      ],
      closed: false,
      provenance: { kind: 'test' },
      uncertainty: 'illustrative',
    },
  ];
  scene.history = [
    {
      sceneVersion: 1,
      at: '2026-11-01T12:00:00Z',
      op: 'add_entity:car-1',
      reason: 'Initial setup',
      source: 'director',
    },
  ];
  return { ...scene, ...overrides };
}

function makeMockDeps({
  sceneOverride,
  snapshotOverride,
  playbackOverride,
  cameraOverride,
} = {}) {
  let currentScene = makeMockScene(sceneOverride);
  let playbackState = {
    state: 'paused',
    positionSec: 10,
    speed: 1,
    cameraMode: 'cinematic',
    followEntityId: null,
    live: false,
    ...playbackOverride,
  };
  const highlights = new Map();
  const cameraCalls = [];

  const runtime = {
    snapshot() {
      return {
        sceneId: currentScene.sceneId,
        sceneVersion: currentScene.sceneVersion,
        entities: currentScene.entities.map((e) => ({
          ...e,
          highlight: highlights.get(e.id) ?? e.highlight,
        })),
        routes: currentScene.routes,
        shots: currentScene.shots,
        playback: playbackState,
      };
    },
    setHighlight(id, on, alertState) {
      highlights.set(id, on);
    },
    select(id) {},
    selected() {
      return ['car-1'];
    },
    entityById(id) {
      return currentScene.entities.find((e) => e.id === id) || null;
    },
    context: {
      origin: currentScene.origin,
      boundsRadiusM: 1500,
      wgs84ToLocal({ lat, lon }) {
        return { eastM: 100, northM: 120, heightM: 0 };
      },
    },
  };

  const reducer = {
    scene() {
      return currentScene;
    },
    applyPatch(patch, opts) {
      const res = applyScenePatch(currentScene, patch);
      if (res.scene) {
        currentScene = res.scene;
      }
      return res;
    },
  };

  const playback = {
    state() {
      return { ...playbackState };
    },
    play() {
      playbackState.state = 'playing';
    },
    pause() {
      playbackState.state = 'paused';
    },
    seek(sec) {
      playbackState.positionSec = sec;
    },
    setSpeed(x) {
      playbackState.speed = x;
    },
    positionSec() {
      return playbackState.positionSec;
    },
    durationSec() {
      return 60;
    },
    setCameraMode(mode, opts) {
      playbackState.cameraMode = mode;
      if (opts?.entityId) playbackState.followEntityId = opts.entityId;
    },
    follow(id) {
      playbackState.cameraMode = 'follow';
      playbackState.followEntityId = id;
    },
    returnToCinematic() {
      playbackState.cameraMode = 'cinematic';
      playbackState.followEntityId = null;
    },
  };

  const cameraDirector = {
    interrupt(shot, opts) {
      cameraCalls.push({ shot, opts });
      return { accepted: true, queued: false };
    },
    cameraCalls,
  };

  return { runtime, reducer, playback, cameraDirector, highlights };
}

test('qaExecutor: none command succeeds without mutation', async () => {
  const deps = makeMockDeps();
  const executor = createQaExecutor(deps);
  const results = await executor.execute([{ command: 'none', reason: 'noop' }]);
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].confirmed, true);
  assert.equal(results[0].command, 'none');
});

test('qaExecutor: never reports ok:true without confirmed:true', async () => {
  const deps = makeMockDeps();
  // Corrupt follow to never update state
  deps.playback.follow = () => {};
  const executor = createQaExecutor(deps);
  const results = await executor.execute([
    { command: 'follow_entity', entityId: 'car-1' },
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].confirmed, false);
  assert.ok(results[0].reason);
});

test('qaExecutor: add_entity applies patch and confirms in snapshot', async () => {
  const deps = makeMockDeps();
  const executor = createQaExecutor(deps);
  const newEntity = {
    id: 'amb-1',
    assetId: 'sprite.vehicle.ambulance',
    label: 'Ambulance 1',
    category: 'vehicle',
    position: { eastM: 15, northM: 25 },
    behavior: { type: 'arrive' },
    uncertainty: 'illustrative',
  };
  const results = await executor.execute([
    { command: 'add_entity', entity: newEntity },
  ]);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].confirmed, true);
  assert.ok(results[0].diff?.entities?.added?.includes('amb-1'));
  assert.equal(
    deps.reducer.scene().entities.some((e) => e.id === 'amb-1'),
    true,
  );
});

test('qaExecutor: remove_entity removes and confirms in snapshot', async () => {
  const deps = makeMockDeps();
  const executor = createQaExecutor(deps);
  const results = await executor.execute([
    { command: 'remove_entity', entityId: 'car-1' },
  ]);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].confirmed, true);
  assert.equal(
    deps.reducer.scene().entities.some((e) => e.id === 'car-1'),
    false,
  );
});

test('qaExecutor: follow_entity sets playback followEntityId', async () => {
  const deps = makeMockDeps();
  const executor = createQaExecutor(deps);
  const results = await executor.execute([
    { command: 'follow_entity', entityId: 'car-1' },
  ]);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].confirmed, true);
  assert.equal(deps.playback.state().followEntityId, 'car-1');
});

test('qaExecutor: follow_entity fails when entity does not exist', async () => {
  const deps = makeMockDeps();
  const executor = createQaExecutor(deps);
  const results = await executor.execute([
    { command: 'follow_entity', entityId: 'missing-id' },
  ]);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].confirmed, false);
  assert.ok(results[0].reason.includes('not found'));
});

test('qaExecutor: playback commands (play, pause, seek, set_speed)', async () => {
  const deps = makeMockDeps();
  const executor = createQaExecutor(deps);

  const resPlay = await executor.execute([{ command: 'play' }]);
  assert.equal(resPlay[0].ok, true);
  assert.equal(deps.playback.state().state, 'playing');

  const resPause = await executor.execute([{ command: 'pause' }]);
  assert.equal(resPause[0].ok, true);
  assert.equal(deps.playback.state().state, 'paused');

  const resSeek = await executor.execute([
    { command: 'seek', positionSec: 25 },
  ]);
  assert.equal(resSeek[0].ok, true);
  assert.equal(deps.playback.positionSec(), 25);

  const resSpeed = await executor.execute([{ command: 'set_speed', speed: 2 }]);
  assert.equal(resSpeed[0].ok, true);
  assert.equal(deps.playback.state().speed, 2);
});

test('qaExecutor: replay_last_seconds seeks back and plays', async () => {
  const deps = makeMockDeps({
    playbackOverride: { positionSec: 30, state: 'paused' },
  });
  const executor = createQaExecutor(deps);
  const results = await executor.execute([
    { command: 'replay_last_seconds', seconds: 10 },
  ]);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].confirmed, true);
  assert.equal(deps.playback.positionSec(), 20);
  assert.equal(deps.playback.state().state, 'playing');
});

test('qaExecutor: replay_section helicopter interrupts camera and plays', async () => {
  const deps = makeMockDeps({
    playbackOverride: { positionSec: 0, state: 'paused' },
  });
  const executor = createQaExecutor(deps);
  const results = await executor.execute([
    {
      command: 'replay_section',
      startSec: 15,
      endSec: 25,
      perspective: 'helicopter',
    },
  ]);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].confirmed, true);
  assert.equal(deps.playback.positionSec(), 15);
  assert.equal(deps.playback.state().state, 'playing');

  const cameraShot = deps.cameraDirector.cameraCalls[0]?.shot;
  assert.ok(cameraShot);
  assert.equal(cameraShot.type, 'tracking');
  assert.equal(cameraShot.distanceM, 250);
  assert.equal(cameraShot.pitchDeg, -30);
  assert.equal(cameraShot.heightM, 120);
});

test('qaExecutor: show_route_closed highlights closed route and interrupts camera with local focus', async () => {
  const deps = makeMockDeps();
  const executor = createQaExecutor(deps);
  const results = await executor.execute([{ command: 'show_route_closed' }]);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].confirmed, true);
  assert.deepEqual(results[0].closedRouteIds, ['route-main']);
  assert.equal(deps.highlights.get('route-main'), true);

  const cameraShot = deps.cameraDirector.cameraCalls[0]?.shot;
  assert.ok(cameraShot);
  assert.equal(cameraShot.type, 'overhead_intelligence');
  assert.deepEqual(cameraShot.focus, { eastM: 100, northM: 120, heightM: 0 });
});

test('qaExecutor: show_evidence_source highlights matching entities', async () => {
  const deps = makeMockDeps();
  const executor = createQaExecutor(deps);
  const results = await executor.execute([
    { command: 'show_evidence_source', source: 'snapchat' },
  ]);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].confirmed, true);
  assert.deepEqual(results[0].matchedEntityIds, ['snap-1']);
  assert.equal(deps.highlights.get('snap-1'), true);
});

test('qaExecutor: explain_change returns answer without mutation', async () => {
  const deps = makeMockDeps();
  const executor = createQaExecutor(deps);
  const results = await executor.execute([{ command: 'explain_change' }]);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].confirmed, true);
  assert.ok(results[0].answer);
  assert.ok(results[0].answer.includes('add_entity:car-1'));
});

test('qaExecutor: camera_above_entity and wide_aerial interrupt camera', async () => {
  const deps = makeMockDeps();
  const executor = createQaExecutor(deps);

  const res1 = await executor.execute([
    { command: 'camera_above_entity', entityId: 'car-1', heightM: 180 },
  ]);
  assert.equal(res1[0].ok, true);
  assert.equal(
    deps.cameraDirector.cameraCalls[0].shot.type,
    'overhead_intelligence',
  );
  assert.equal(deps.cameraDirector.cameraCalls[0].shot.heightM, 180);

  const res2 = await executor.execute([
    { command: 'wide_aerial', heightM: 1200 },
  ]);
  assert.equal(res2[0].ok, true);
  assert.equal(
    deps.cameraDirector.cameraCalls[1].shot.type,
    'aerial_establishing',
  );
  assert.equal(deps.cameraDirector.cameraCalls[1].shot.heightM, 1200);
});
