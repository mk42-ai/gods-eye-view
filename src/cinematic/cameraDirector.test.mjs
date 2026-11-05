import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createCameraDirector } from './cameraDirector.js';
import { createGeoSceneContext } from './geoSceneContext.js';

function makeContext() {
  return createGeoSceneContext({
    origin: { name: 'Dubai', lat: 25.2, lon: 55.27, heightM: 0 },
  });
}

test('poseForShot produces no NaNs for all shot types', () => {
  const context = makeContext();
  const director = createCameraDirector({ context });

  const shotTypes = [
    'aerial_establishing',
    'street_level',
    'orbit',
    'tracking',
    'vehicle_follow',
    'overhead_intelligence',
    'close_up',
    'dolly',
    'pan',
    'tilt',
    'fly_through',
  ];

  for (const type of shotTypes) {
    const shot = {
      id: `shot-${type}`,
      type,
      startSec: 0,
      durationSec: 10,
      headingDeg: 45,
      pitchDeg: -30,
      distanceM: 100,
    };

    for (let sec = 0; sec <= 10; sec += 2.5) {
      const pose = director.poseForShot(shot, sec);
      assert.ok(
        Number.isFinite(pose.position.x),
        `NaN in x for ${type} at ${sec}`,
      );
      assert.ok(
        Number.isFinite(pose.position.y),
        `NaN in y for ${type} at ${sec}`,
      );
      assert.ok(
        Number.isFinite(pose.position.z),
        `NaN in z for ${type} at ${sec}`,
      );
      assert.ok(
        Number.isFinite(pose.heading),
        `NaN in heading for ${type} at ${sec}`,
      );
      assert.ok(
        Number.isFinite(pose.pitch),
        `NaN in pitch for ${type} at ${sec}`,
      );
      assert.ok(
        Number.isFinite(pose.roll),
        `NaN in roll for ${type} at ${sec}`,
      );
    }
  }
});

test('camera height is always >= groundHeightAt + 5', () => {
  const context = createGeoSceneContext({
    origin: { name: 'Origin', lat: 25.2, lon: 55.27 },
  });

  // Mock ground height at local coordinates
  context.groundHeightAt = () => 45.0;

  const director = createCameraDirector({ context });

  const lowShot = {
    id: 'shot-ground',
    type: 'street_level',
    startSec: 0,
    durationSec: 5,
    distanceM: 5,
    pitchDeg: 0,
  };

  const pose = director.poseForShot(lowShot, 2);
  const local = context.cartesianToLocal(pose.position);
  assert.ok(
    local.heightM >= 50.0,
    `Camera height ${local.heightM} must be >= 45 + 5 = 50`,
  );
});

test('orbit heading sweeps monotonically over durationSec', () => {
  const context = makeContext();
  const director = createCameraDirector({ context });

  const shot = {
    id: 'shot-orbit',
    type: 'orbit',
    startSec: 0,
    durationSec: 10,
    headingDeg: 0,
    headingDeltaDeg: 180,
    easing: 'linear',
  };

  let prevHeading = -1;
  for (let sec = 0; sec <= 10; sec += 1) {
    const pose = director.poseForShot(shot, sec);
    assert.ok(
      pose.heading >= prevHeading,
      `Heading should increase monotonically: ${pose.heading} >= ${prevHeading}`,
    );
    prevHeading = pose.heading;
  }
});

test('deterministic: same (shot, sec) yields identical pose', () => {
  const context = makeContext();
  const director = createCameraDirector({ context });

  const shot = {
    id: 'shot-dolly',
    type: 'dolly',
    startSec: 5,
    durationSec: 8,
    distanceM: 120,
    headingDeg: 60,
    pitchDeg: -25,
    easing: 'ease_in_out',
  };

  const pose1 = director.poseForShot(shot, 7.3);
  const pose2 = director.poseForShot(shot, 7.3);

  assert.equal(pose1.position.x, pose2.position.x);
  assert.equal(pose1.position.y, pose2.position.y);
  assert.equal(pose1.position.z, pose2.position.z);
  assert.equal(pose1.heading, pose2.heading);
  assert.equal(pose1.pitch, pose2.pitch);
  assert.equal(pose1.roll, pose2.roll);
});

test('currentShot selects latest shot with startSec <= sec and falls back to first', () => {
  const director = createCameraDirector();
  director.setShots([
    { id: 's2', startSec: 10, durationSec: 10 },
    { id: 's1', startSec: 0, durationSec: 10 },
    { id: 's3', startSec: 20, durationSec: 10 },
  ]);

  // Falls back to first if sec < first
  assert.equal(director.currentShot(-2).id, 's1');
  assert.equal(director.currentShot(0).id, 's1');
  assert.equal(director.currentShot(5).id, 's1');
  assert.equal(director.currentShot(10).id, 's2');
  assert.equal(director.currentShot(15).id, 's2');
  assert.equal(director.currentShot(25).id, 's3');
});

test('interruption rules honour priority and interruptibility', () => {
  const director = createCameraDirector();
  director.setShots([
    {
      id: 's1',
      startSec: 0,
      durationSec: 20,
      priority: 20,
      interruptible: true,
    },
  ]);

  // First interrupt with priority 80
  const res1 = director.interrupt(
    { id: 'int-high', type: 'overhead_intelligence', durationSec: 5 },
    { priority: 80, reason: 'high_intel' },
  );
  assert.equal(res1.accepted, true);
  assert.equal(res1.queued, false);
  assert.equal(director.currentShot(0).id, 'int-high');

  // Lower priority (30) while int-high (80) is active is queued
  const res2 = director.interrupt(
    { id: 'int-low', type: 'overhead_intelligence', durationSec: 5 },
    { priority: 30, reason: 'low_intel' },
  );
  assert.equal(res2.accepted, false);
  assert.equal(res2.queued, true);

  // Release pops the queued interrupt (priority 30 >= s1 priority 20)
  director.release();
  assert.equal(director.currentShot(0).id, 'int-low');

  // Release again returns to timeline
  director.release();
  assert.equal(director.currentShot(0).id, 's1');
});

test('tick applies setView when enabled and cameraMode is cinematic', () => {
  const context = makeContext();
  let setViewCalled = false;
  let viewTarget = null;

  const mockViewer = {
    camera: {
      setView(opts) {
        setViewCalled = true;
        viewTarget = opts;
      },
    },
  };

  const mockPlayback = {
    cameraMode: 'cinematic',
    positionSec: () => 5,
  };

  const director = createCameraDirector({
    viewer: mockViewer,
    context,
    playback: mockPlayback,
  });

  director.setShots([{ id: 'shot-1', startSec: 0, durationSec: 10 }]);

  director.tick(5);
  assert.equal(setViewCalled, true);
  assert.ok(viewTarget?.destination instanceof Cesium.Cartesian3);

  // When disabled, tick does not call setView
  setViewCalled = false;
  director.enable(false);
  director.tick(5);
  assert.equal(setViewCalled, false);

  // When cameraMode is free, tick does not call setView
  director.enable(true);
  mockPlayback.cameraMode = 'free';
  director.tick(5);
  assert.equal(setViewCalled, false);
});

test('a paused or finished timeline yields to a Q&A / intelligence interrupt (live defect 2026-11-01)', () => {
  // Reproduces the live Demo H / acceptance failure: the scheduled
  // aerial_establishing shot carried priority 100 so every Q&A camera command
  // (priority 85) was queued even though playback had finished at 60 s.
  let state = 'paused';
  let pos = 60;
  const playback = {
    positionSec: () => pos,
    state: () => ({ state, positionSec: pos }),
  };
  const director = createCameraDirector({ playback });
  director.setShots([
    { id: 'aerial', startSec: 0, durationSec: 20, priority: 100, interruptible: true },
    { id: 'street', startSec: 20, durationSec: 40, priority: 90, interruptible: true },
  ]);
  const res = director.interrupt(
    { id: 'qa-wide', type: 'aerial_establishing', durationSec: 10 },
    { priority: 85, reason: 'QA wide_aerial' },
  );
  assert.equal(res.accepted, true, JSON.stringify(res));
  assert.equal(director.currentShot(60).id, 'qa-wide');

  // While PLAYING inside a higher-priority scheduled shot the request queues
  // and the refusal is explained.
  director.release();
  state = 'playing';
  pos = 5;
  const res2 = director.interrupt(
    { id: 'qa-wide-2', type: 'aerial_establishing', durationSec: 10 },
    { priority: 85, reason: 'QA wide_aerial' },
  );
  assert.equal(res2.accepted, false);
  assert.equal(res2.queued, true);
  assert.match(res2.reason, /priority 85 < current shot priority 100/);
});
