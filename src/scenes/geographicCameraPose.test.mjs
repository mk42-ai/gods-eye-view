import test from 'node:test';
import assert from 'node:assert/strict';
import { geographicCameraPose, incidentSceneToProjectScene } from './incidentScenes.js';

for (const heading of [0, 30, 90, 180, 270]) {
  test(`oblique geographic shot looks back at its ground target, heading ${heading}`, () => {
    const target = { lat: 25.0786415, lon: 55.1352524, altitudeM: 2400, pitch: -62, bearing: heading };
    const pose = geographicCameraPose(target);
    const rad = Math.PI / 180;
    const distance = pose.alt / Math.tan(-pose.pitch * rad);
    const angular = distance / 6371008.8;
    const lat = pose.lat * rad;
    const bearing = pose.heading * rad;
    const projectedLat = Math.asin(Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing));
    const projectedLon = pose.lon * rad + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat), Math.cos(angular) - Math.sin(lat) * Math.sin(projectedLat));
    assert.ok(Math.abs(projectedLat / rad - target.lat) < 0.000003);
    assert.ok(Math.abs(projectedLon / rad - target.lon) < 0.000003);
    assert.equal(pose.pitch, target.pitch);
    assert.equal(pose.heading, heading);
    assert.equal(target.lat, 25.0786415, 'target is not mutated');
  });
}

test('geographic adapter offsets the camera but preserves non-geographic incident semantics', () => {
  const frame = { lat: 25.0786415, lon: 55.1352524, altitudeM: 2400, pitch: -62, bearing: 30, time: 0 };
  const scene = { id: 'fixture-scene', keyframes: [frame] };
  const ordinary = incidentSceneToProjectScene(scene).shots[0].camera;
  const geographic = incidentSceneToProjectScene({ ...scene, geographic: true }).shots[0].camera;
  assert.equal(ordinary.lat, frame.lat);
  assert.equal(ordinary.lon, frame.lon);
  assert.notEqual(geographic.lat, frame.lat);
  assert.notEqual(geographic.lon, frame.lon);
  assert.equal(geographic.alt, ordinary.alt);
});

test('nadir geographic camera remains at its target', () => {
  const pose = geographicCameraPose({ lat: 25, lon: 55, altitudeM: 1000, pitch: -90, bearing: 0 });
  assert.ok(Math.abs(pose.lat - 25) < 1e-10);
  assert.ok(Math.abs(pose.lon - 55) < 1e-10);
});
