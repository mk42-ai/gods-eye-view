import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { flyToScene } from './sceneFlyIn.js';

test('flyToScene computes fallback 600m sphere around anchor and calls flyToBoundingSphere', () => {
  let flownSphere = null;
  let flownOptions = null;

  const viewer = {
    camera: {
      flyToBoundingSphere(sphere, options) {
        flownSphere = sphere;
        flownOptions = options;
      },
    },
  };

  const anchor = { lat: 25.1972, lon: 55.2744 };
  const sphere = flyToScene(viewer, {
    anchor,
    Cesium,
    durationSec: 2.5,
    pitchDeg: -45,
    headingOffsetDeg: 25,
  });

  assert.ok(sphere, 'returns BoundingSphere');
  assert.equal(flownSphere, sphere);
  assert.ok(sphere.radius >= 600, 'radius should be at least 600m');

  assert.ok(flownOptions);
  assert.equal(flownOptions.duration, 2.5);
  assert.ok(flownOptions.offset);
  assert.ok(
    Math.abs(flownOptions.offset.pitch - Cesium.Math.toRadians(-45)) < 1e-4,
  );
  assert.ok(
    Math.abs(flownOptions.offset.heading - Cesium.Math.toRadians(25)) < 1e-4,
  );
});

test('flyToScene encloses all positions and includes anchor', () => {
  let flownSphere = null;
  const viewer = {
    camera: {
      flyToBoundingSphere(sphere) {
        flownSphere = sphere;
      },
    },
  };

  const positions = [
    { lat: 25.19, lon: 55.27 },
    { lat: 25.21, lon: 55.28 },
    { lat: 25.2, lon: 55.26 },
  ];
  const anchor = { lat: 25.2, lon: 55.27 };

  const sphere = flyToScene(viewer, {
    positions,
    anchor,
    Cesium,
    durationSec: 3.0,
  });

  assert.ok(sphere);
  assert.equal(flownSphere, sphere);
  assert.ok(sphere.radius >= 600);
});
