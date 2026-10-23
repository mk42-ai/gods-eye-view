import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LADDER,
  stageForAltitude,
  totalTravelMs,
  buildScenePath,
  bearingDeg,
  destinationPoint,
  interpolate,
  greatCirclePoints,
} from './ladder.js';
import {
  createCameraController,
  attachAltitudeStageSync,
} from './controller.js';
import { createViirsLayer, VIIRS_CONFIG } from './viirs.js';

const stubCesium = {
  Cartesian3: {
    fromDegrees: (lon, lat, alt) => ({ lon, lat, alt }),
  },
  Cartographic: {
    fromDegrees: (lon, lat) => ({ lon, lat, height: 0 }),
    fromCartesian: (cart) => ({
      lon: cart.lon,
      lat: cart.lat,
      height: cart.alt ?? 0,
    }),
  },
  Math: {
    toRadians: (deg) => (deg * Math.PI) / 180,
  },
  EasingFunction: {
    QUADRATIC_IN_OUT: 'quadInOut',
  },
  GeographicTilingScheme: function () {},
  WebMapTileServiceImageryProvider: function (options) {
    this.options = options;
  },
};

function createStubViewer() {
  const flyCalls = [];
  const setViewCalls = [];
  return {
    camera: {
      flyTo: ({ destination, orientation, duration, complete }) => {
        flyCalls.push({ destination, orientation, duration });
        queueMicrotask(() => complete && complete());
      },
      setView: ({ destination, orientation }) => {
        setViewCalls.push({ destination, orientation });
      },
      cancelFlight: () => {},
      positionCartographic: { height: 18000 },
    },
    imageryLayers: {
      layers: [],
      addImageryProvider(provider) {
        const layer = { provider, show: true, alpha: 1 };
        this.layers.push(layer);
        return layer;
      },
      remove(layer) {
        const idx = this.layers.indexOf(layer);
        if (idx !== -1) this.layers.splice(idx, 1);
      },
    },
    flyCalls,
    setViewCalls,
  };
}

test('ladder altitudes, holds, and travel duration within 9–12 s', () => {
  assert.equal(LADDER.length, 5);
  const stages = LADDER.map((l) => l.stage);
  assert.deepEqual(stages, ['S0', 'S1', 'S2', 'S3', 'S4']);

  assert.equal(LADDER[0].alt, 8_000_000);
  assert.equal(LADDER[0].pitch, -90);
  assert.equal(LADDER[0].holdMs, 1500);

  assert.equal(LADDER[1].alt, 1_200_000);
  assert.equal(LADDER[1].pitch, -70);
  assert.equal(LADDER[1].holdMs, 1500);

  assert.equal(LADDER[2].alt, 18_000);
  assert.equal(LADDER[2].pitch, -60);
  assert.equal(LADDER[2].holdMs, 4200);

  assert.equal(LADDER[3].alt, 2_000);
  assert.equal(LADDER[3].pitch, -45);
  assert.equal(LADDER[3].holdMs, 1500);

  assert.equal(LADDER[4].alt, 300);
  assert.equal(LADDER[4].pitch, -30);
  assert.equal(LADDER[4].holdMs, 11000);

  const travelMs = totalTravelMs(LADDER);
  assert.equal(travelMs, 10500);
  assert.ok(
    travelMs >= 9000 && travelMs <= 12000,
    'total travel must be between 9 s and 12 s',
  );
});

test('stageForAltitude maps correctly by log-altitude', () => {
  assert.equal(stageForAltitude(9_000_000), 'S0');
  assert.equal(stageForAltitude(5_000_000), 'S0');
  assert.equal(stageForAltitude(1_000_000), 'S1');
  assert.equal(stageForAltitude(200_000), 'S1');
  assert.equal(stageForAltitude(18_000), 'S2');
  assert.equal(stageForAltitude(10_000), 'S2');
  assert.equal(stageForAltitude(2_000), 'S3');
  assert.equal(stageForAltitude(800), 'S3');
  assert.equal(stageForAltitude(300), 'S4');
  assert.equal(stageForAltitude(50), 'S4');
});

test('buildScenePath constructs 5 waypoints with S4 ≈350 m from target heading toward it', () => {
  const target = { lat: 25.147, lon: 55.199, name: 'Umm Suqeim' };
  const origin = { lat: 25.2048, lon: 55.2708 };
  const path = buildScenePath({ origin, target });

  assert.equal(path.length, 5);
  assert.deepEqual(
    path.map((w) => w.stage),
    ['S0', 'S1', 'S2', 'S3', 'S4'],
  );

  // Total travel
  const travel = totalTravelMs(path);
  assert.ok(
    travel >= 9000 && travel <= 12000,
    `travel ${travel} within 9..12 s`,
  );

  // S0 over target
  assert.equal(path[0].lat, target.lat);
  assert.equal(path[0].lon, target.lon);

  // S4 is ~350 m from target
  const s4 = path[4];
  const dLat = (s4.lat - target.lat) * (Math.PI / 180);
  const dLon = (s4.lon - target.lon) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(target.lat * (Math.PI / 180)) *
      Math.cos(s4.lat * (Math.PI / 180)) *
      Math.sin(dLon / 2) ** 2;
  const distKm = 2 * 6371.0088 * Math.asin(Math.sqrt(a));
  const distM = distKm * 1000;
  assert.ok(
    Math.abs(distM - 350) < 5,
    `S4 distance should be ~350 m, got ${distM}`,
  );

  // S4 heading is toward target
  const headingToTarget = bearingDeg(s4.lat, s4.lon, target.lat, target.lon);
  assert.ok(
    Math.abs(s4.heading - headingToTarget) < 1e-4 ||
      Math.abs(s4.heading - headingToTarget - 360) < 1e-4,
    `S4 heading ${s4.heading} should point at target ${headingToTarget}`,
  );
});

test('controller flies S0..S4 in order and dispatches stages', async () => {
  const viewer = createStubViewer();
  const dispatched = [];
  const immediateTimeout = (fn) => setTimeout(fn, 0);

  const controller = createCameraController({
    viewer,
    Cesium: stubCesium,
    dispatch: (stage, wp) => dispatched.push({ stage, wp }),
    setTimeoutImpl: immediateTimeout,
    clearTimeoutImpl: clearTimeout,
  });

  const path = buildScenePath({
    target: { lat: 25.147, lon: 55.199 },
    origin: { lat: 25.2, lon: 55.27 },
  });

  const result = await controller.flyScenePath(path);
  assert.equal(result, 'arrived');
  assert.equal(viewer.flyCalls.length, 5);
  assert.deepEqual(
    dispatched.map((d) => d.stage),
    ['S0', 'S1', 'S2', 'S3', 'S4'],
  );
  assert.equal(controller.currentStage(), 'S4');
});

test('controller abort mid-path resolves aborted and stops dispatch', async () => {
  const viewer = createStubViewer();
  const dispatched = [];
  const ac = new AbortController();

  const controller = createCameraController({
    viewer,
    Cesium: stubCesium,
    dispatch: (stage, wp) => {
      dispatched.push(stage);
      if (stage === 'S1') {
        ac.abort();
      }
    },
    setTimeoutImpl: (fn) => setTimeout(fn, 10),
    clearTimeoutImpl: clearTimeout,
  });

  const path = buildScenePath({
    target: { lat: 25.147, lon: 55.199 },
    origin: { lat: 25.2, lon: 55.27 },
  });

  const result = await controller.flyScenePath(path, { signal: ac.signal });
  assert.equal(result, 'aborted');
  assert.ok(dispatched.length < 5, 'should not finish all 5 stages on abort');
  assert.ok(!dispatched.includes('S4'), 'S4 should not be dispatched');
});

test('reducedMotion uses setView instead of flyTo', async () => {
  const viewer = createStubViewer();
  const dispatched = [];

  const controller = createCameraController({
    viewer,
    Cesium: stubCesium,
    reducedMotion: true,
    dispatch: (stage) => dispatched.push(stage),
    setTimeoutImpl: (fn) => setTimeout(fn, 0),
    clearTimeoutImpl: clearTimeout,
  });

  const path = buildScenePath({
    target: { lat: 25.147, lon: 55.199 },
    origin: { lat: 25.2, lon: 55.27 },
  });

  const result = await controller.flyScenePath(path);
  assert.equal(result, 'arrived');
  assert.equal(
    viewer.flyCalls.length,
    0,
    'flyTo should not be called with reducedMotion',
  );
  assert.equal(
    viewer.setViewCalls.length,
    5,
    'setView should be called 5 times',
  );
  assert.deepEqual(dispatched, ['S0', 'S1', 'S2', 'S3', 'S4']);
});

test('viirs layer creates lazily on show, toggles show, and destroys', () => {
  const viewer = createStubViewer();
  const viirs = createViirsLayer({ viewer, Cesium: stubCesium });

  assert.equal(viirs.isShown(), false);
  assert.equal(viewer.imageryLayers.layers.length, 0);

  const layer = viirs.show();
  assert.ok(layer);
  assert.equal(viirs.isShown(), true);
  assert.equal(layer.alpha, 0.85);
  assert.equal(viewer.imageryLayers.layers.length, 1);

  viirs.hide();
  assert.equal(viirs.isShown(), false);
  assert.equal(layer.show, false);

  viirs.destroy();
  assert.equal(viirs.isShown(), false);
  assert.equal(viewer.imageryLayers.layers.length, 0);
});

test('attachAltitudeStageSync triggers callback on altitude change', () => {
  const viewer = createStubViewer();
  const stages = [];
  let callback = null;

  const sync = attachAltitudeStageSync({
    viewer,
    Cesium: stubCesium,
    onStage: (st) => stages.push(st),
    setIntervalImpl: (fn) => {
      callback = fn;
      return 123;
    },
    clearIntervalImpl: () => {},
  });

  viewer.camera.positionCartographic.height = 18000;
  callback();
  assert.deepEqual(stages, ['S2']);

  viewer.camera.positionCartographic.height = 300;
  callback();
  assert.deepEqual(stages, ['S2', 'S4']);

  sync.destroy();
});
