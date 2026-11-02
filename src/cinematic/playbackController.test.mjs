import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createPlaybackController } from './playbackController.js';
import { emptyScene } from './sceneSchema.js';

function createFakeClock() {
  const listeners = new Set();
  const startTime = Cesium.JulianDate.fromIso8601('2026-01-01T00:00:00Z');
  const stopTime = Cesium.JulianDate.fromIso8601('2026-01-01T00:01:00Z');
  const currentTime = Cesium.JulianDate.clone(startTime);

  return {
    startTime,
    stopTime,
    currentTime,
    multiplier: 1.0,
    shouldAnimate: false,
    clockRange: Cesium.ClockRange.CLAMPED,
    onTick: {
      addEventListener(fn) {
        listeners.add(fn);
      },
      removeEventListener(fn) {
        listeners.delete(fn);
      },
    },
    tick() {
      if (this.shouldAnimate) {
        this.currentTime = Cesium.JulianDate.addSeconds(
          this.currentTime,
          this.multiplier * 0.1,
          new Cesium.JulianDate(),
        );
      }
      for (const fn of listeners) {
        fn(this);
      }
    },
  };
}

test('load configures clock and pauses initially', () => {
  const clock = createFakeClock();
  const playback = createPlaybackController({ viewer: { clock } });

  const scene = emptyScene({
    sceneId: 'scene-load-1',
    origin: { name: 'Origin', lat: 25, lon: 55 },
    durationSec: 120,
  });

  playback.load(scene);

  assert.equal(playback.durationSec(), 120);
  assert.equal(playback.positionSec(), 0);
  assert.equal(playback.state().state, 'paused');
  assert.equal(clock.shouldAnimate, false);
});

test('play, pause, resume, seek, setSpeed mutate clock state', () => {
  const clock = createFakeClock();
  const playback = createPlaybackController({ viewer: { clock } });
  const scene = emptyScene({
    sceneId: 'scene-ctrl-1',
    origin: { name: 'Origin', lat: 25, lon: 55 },
    durationSec: 60,
  });
  playback.load(scene);

  playback.play();
  assert.equal(playback.state().state, 'playing');
  assert.equal(clock.shouldAnimate, true);

  playback.pause();
  assert.equal(playback.state().state, 'paused');
  assert.equal(clock.shouldAnimate, false);

  playback.seek(25);
  assert.equal(playback.positionSec(), 25);

  playback.setSpeed(2.5);
  assert.equal(playback.state().speed, 2.5);
  assert.equal(clock.multiplier, 2.5);

  playback.restart();
  assert.equal(playback.positionSec(), 0);
  assert.equal(playback.state().state, 'playing');
});

test('seek is deterministic and clamped', () => {
  const clock = createFakeClock();
  const playback = createPlaybackController({ viewer: { clock } });
  const scene = emptyScene({
    sceneId: 'scene-det-1',
    origin: { name: 'Origin', lat: 25, lon: 55 },
    durationSec: 40,
  });
  playback.load(scene);

  playback.seek(18.5);
  const p1 = playback.positionSec();
  playback.seek(18.5);
  const p2 = playback.positionSec();
  assert.equal(p1, p2);
  assert.equal(p1, 18.5);

  // Clamp beyond duration
  playback.seek(100);
  assert.equal(playback.positionSec(), 40);

  // Clamp below zero
  playback.seek(-10);
  assert.equal(playback.positionSec(), 0);
});

test('idempotent load for same sceneId preserves positionSec', () => {
  const clock = createFakeClock();
  const playback = createPlaybackController({ viewer: { clock } });

  const sceneV0 = emptyScene({
    sceneId: 'scene-versioned',
    origin: { name: 'Origin', lat: 25, lon: 55 },
    durationSec: 60,
  });
  playback.load(sceneV0);
  playback.seek(34);

  // Load updated scene with same sceneId
  const sceneV1 = { ...sceneV0, sceneVersion: 1 };
  playback.load(sceneV1);

  assert.equal(playback.positionSec(), 34);
});

test('extendDuration only grows stopTime and never rewinds position', () => {
  const clock = createFakeClock();
  const playback = createPlaybackController({ viewer: { clock } });
  const scene = emptyScene({
    sceneId: 'scene-extend',
    origin: { name: 'Origin', lat: 25, lon: 55 },
    durationSec: 50,
  });
  playback.load(scene);
  playback.seek(45);

  playback.extendDuration(80);
  assert.equal(playback.durationSec(), 80);
  assert.equal(playback.positionSec(), 45);

  // Smaller extension does not shrink duration
  playback.extendDuration(30);
  assert.equal(playback.durationSec(), 80);
});

test('camera modes and follow tracking', () => {
  const clock = createFakeClock();
  const mockEntity = { id: 'drone-1' };
  const mockViewer = { clock, trackedEntity: undefined };

  const playback = createPlaybackController({
    viewer: mockViewer,
    entityGetter: (id) => (id === 'drone-1' ? mockEntity : null),
  });

  playback.setCameraMode('follow', { entityId: 'drone-1' });
  assert.equal(playback.state().cameraMode, 'follow');
  assert.equal(playback.state().followEntityId, 'drone-1');
  assert.equal(mockViewer.trackedEntity, mockEntity);

  playback.returnToCinematic();
  assert.equal(playback.state().cameraMode, 'cinematic');
  assert.equal(playback.state().followEntityId, null);
  assert.equal(mockViewer.trackedEntity, undefined);

  playback.setCameraMode('free');
  assert.equal(playback.state().cameraMode, 'free');
});

test('selectEvent seeks to beat atSec or numeric second', () => {
  const clock = createFakeClock();
  const playback = createPlaybackController({ viewer: { clock } });

  const scene = emptyScene({
    sceneId: 'scene-beats',
    origin: { name: 'Origin', lat: 25, lon: 55 },
    durationSec: 100,
  });
  scene.timeline.beats = [
    { atSec: 10, title: 'Beat 1' },
    { atSec: 35, title: 'Beat 2' },
  ];

  playback.load(scene);

  playback.selectEvent(1); // Select beat index 1 -> atSec 35
  assert.equal(playback.positionSec(), 35);

  playback.selectEvent(50); // Select numeric second 50
  assert.equal(playback.positionSec(), 50);
});

test('onTick listener receives updates and unsubscribes cleanly', () => {
  const clock = createFakeClock();
  const playback = createPlaybackController({ viewer: { clock } });
  playback.load(
    emptyScene({
      sceneId: 'scene-tick',
      origin: { name: 'Origin', lat: 25, lon: 55 },
    }),
  );

  const ticks = [];
  const unsub = playback.onTick((info) => ticks.push(info));

  clock.tick();
  assert.equal(ticks.length, 1);
  assert.equal(typeof ticks[0].sec, 'number');

  unsub();
  clock.tick();
  assert.equal(ticks.length, 1);
});

test('LOOP_STOP configured on clock and play at durationSec restarts from 0', () => {
  const clock = createFakeClock();
  const playback = createPlaybackController({ viewer: { clock } });
  const scene = emptyScene({
    sceneId: 'scene-loop-stop',
    origin: { name: 'Origin', lat: 25, lon: 55 },
    durationSec: 60,
  });
  playback.load(scene);

  assert.equal(clock.clockRange, Cesium.ClockRange.LOOP_STOP);

  // Seek to end
  playback.seek(60);
  assert.equal(playback.positionSec(), 60);
  assert.equal(playback.state().state, 'ended');
  assert.equal(playback.state().progress, 1);

  // Calling play at the end must restart from 0
  playback.play();
  assert.equal(playback.positionSec(), 0);
  assert.equal(playback.state().state, 'playing');
  assert.equal(playback.state().progress, 0);
});

test('requestRender called on clock tick', () => {
  const clock = createFakeClock();
  let renderCalls = 0;
  const mockViewer = {
    clock,
    scene: {
      requestRender() {
        renderCalls++;
      },
    },
  };

  const playback = createPlaybackController({ viewer: mockViewer });
  playback.load(
    emptyScene({
      sceneId: 'scene-render',
      origin: { name: 'Origin', lat: 25, lon: 55 },
    }),
  );

  clock.tick();
  assert.ok(
    renderCalls >= 1,
    'scene.requestRender must be called on clock tick',
  );
});

test('hasTimeDynamic reflects beats or entity paths', () => {
  const clock = createFakeClock();
  const playback = createPlaybackController({ viewer: { clock } });

  // Empty scene
  const sceneEmpty = emptyScene({
    sceneId: 'scene-empty',
    origin: { name: 'Origin', lat: 25, lon: 55 },
  });
  playback.load(sceneEmpty);
  assert.equal(playback.state().hasTimeDynamic, false);

  // Scene with beats
  const sceneBeats = emptyScene({
    sceneId: 'scene-beats-2',
    origin: { name: 'Origin', lat: 25, lon: 55 },
  });
  sceneBeats.timeline.beats = [{ atSec: 10, title: 'Beat 1' }];
  playback.load(sceneBeats);
  assert.equal(playback.state().hasTimeDynamic, true);

  // Scene with entity having path
  const scenePath = emptyScene({
    sceneId: 'scene-path',
    origin: { name: 'Origin', lat: 25, lon: 55 },
  });
  scenePath.entities = [
    {
      id: 'car-1',
      category: 'vehicle',
      behavior: {
        type: 'drive',
        path: [
          { eastM: 0, northM: 0 },
          { eastM: 10, northM: 10 },
        ],
      },
    },
  ];
  playback.load(scenePath);
  assert.equal(playback.state().hasTimeDynamic, true);

  // Scene with synthesized path
  const sceneSynth = emptyScene({
    sceneId: 'scene-synth',
    origin: { name: 'Origin', lat: 25, lon: 55 },
  });
  sceneSynth.entities = [
    {
      id: 'car-2',
      category: 'vehicle',
      synthesizedPath: true,
    },
  ];
  playback.load(sceneSynth);
  assert.equal(playback.state().hasTimeDynamic, true);
});
