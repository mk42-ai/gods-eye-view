import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createSceneRuntime } from './sceneRuntime.js';
import { emptyScene } from './sceneSchema.js';

function createMockViewer() {
  let source = null;
  let removed = 0;

  return {
    scene: {
      requestRender() {},
      primitives: {
        add() {},
        remove() {},
      },
    },
    dataSources: {
      add(s) {
        source = s;
      },
      remove(s) {
        if (s === source) {
          source = null;
          removed++;
        }
      },
    },
    isDestroyed: () => false,
    getSource: () => source,
    getRemoved: () => removed,
  };
}

function makeSampleScene() {
  const scene = emptyScene({
    sceneId: 'scene-rt-1',
    origin: { name: 'Burj Khalifa', lat: 25.1972, lon: 55.2744 },
    durationSec: 60,
  });

  scene.entities = [
    {
      id: 'officer-1',
      label: 'Patrol Officer',
      assetId: 'sprite.person.police_officer',
      category: 'police',
      position: { eastM: 10, northM: 20 },
      uncertainty: 'verified',
    },
    {
      id: 'car-1',
      label: 'Civilian Vehicle',
      assetId: 'sprite.vehicle.civilian_sedan',
      category: 'vehicle',
      position: { eastM: 50, northM: -30 },
      uncertainty: 'approximate',
      hypothetical: true,
    },
    {
      id: 'crowd-1',
      label: 'Spectators',
      assetId: 'sprite.crowd_zone',
      category: 'crowd',
      position: { eastM: 0, northM: 0 },
      uncertainty: 'illustrative',
      count: 5,
      spreadM: 15,
    },
  ];

  scene.routes = [
    {
      id: 'route-main',
      label: 'Race Route',
      kind: 'race_route',
      coordinates: [
        [55.27, 25.19],
        [55.28, 25.2],
      ],
      closed: false,
    },
    {
      id: 'route-closed',
      label: 'Road Closed Segment',
      kind: 'road_segment',
      coordinates: [
        [55.275, 25.195],
        [55.276, 25.196],
      ],
      closed: true,
      provenance: { kind: 'test' },
    },
  ];

  return scene;
}

test('creates CustomDataSource cinematic-scene and attaches entities', () => {
  const viewer = createMockViewer();
  const runtime = createSceneRuntime({ viewer });

  assert.equal(runtime.dataSource.name, 'cinematic-scene');

  const scene = makeSampleScene();
  runtime.attach(scene);
  runtime.flush(); // Flush queue synchronously

  // Verify entities added
  const officer = runtime.entityById('officer-1');
  assert.ok(officer, 'officer-1 entity must exist');
  assert.ok(officer.billboard, 'officer-1 billboard must exist');
  assert.ok(officer.label, 'officer-1 label must exist');

  // Uncertainty styling: verified -> mint
  const mintRef = Cesium.Color.fromCssColorString('#A7F3D0');
  const labelColor = officer.label.fillColor.getValue(Cesium.JulianDate.now());
  assert.ok(Math.abs(labelColor.red - mintRef.red) < 0.05);

  // Label halo
  assert.equal(
    officer.label.style.getValue(),
    Cesium.LabelStyle.FILL_AND_OUTLINE,
  );
  assert.equal(officer.label.outlineWidth.getValue(), 4);
});

test('hypothetical prefix and approximate suffix', () => {
  const viewer = createMockViewer();
  const runtime = createSceneRuntime({ viewer });

  runtime.attach(makeSampleScene());
  runtime.flush();

  const car = runtime.entityById('car-1');
  assert.ok(car);
  const text = car.label.text.getValue();
  assert.ok(text.startsWith('HYPOTHETICAL ·'));
  assert.ok(text.endsWith('≈'));

  // Uncertainty amber
  const amberRef = Cesium.Color.fromCssColorString('#F59E0B');
  const labelColor = car.label.fillColor.getValue(Cesium.JulianDate.now());
  assert.ok(Math.abs(labelColor.red - amberRef.red) < 0.05);
});

test('count > 1 creates deterministic spread member billboards', () => {
  const viewer = createMockViewer();
  const runtime = createSceneRuntime({ viewer });

  runtime.attach(makeSampleScene());
  runtime.flush();

  // Crowd has count 5 -> 1 parent + 4 members
  const member1 = runtime.entityById('crowd-1__member_1');
  const member4 = runtime.entityById('crowd-1__member_4');
  assert.ok(member1, 'member 1 should exist');
  assert.ok(member4, 'member 4 should exist');
  assert.ok(member1.billboard);
});

test('moving entities have SampledPositionProperty and VelocityOrientationProperty', () => {
  const viewer = createMockViewer();
  const runtime = createSceneRuntime({ viewer });

  const scene = emptyScene({
    sceneId: 'scene-move',
    origin: { name: 'Origin', lat: 25.2, lon: 55.27 },
  });

  scene.entities = [
    {
      id: 'runner-1',
      label: 'Runner',
      assetId: 'sprite.person.runner',
      category: 'person',
      position: { eastM: 0, northM: 0 },
      behavior: {
        type: 'run',
        speedMps: 4.0,
        path: [
          { eastM: 0, northM: 0, atSec: 0 },
          { eastM: 40, northM: 0, atSec: 10 },
          { eastM: 40, northM: 40, atSec: 20 },
        ],
      },
      uncertainty: 'illustrative',
    },
  ];

  runtime.attach(scene);
  runtime.flush();

  const runner = runtime.entityById('runner-1');
  assert.ok(runner.position instanceof Cesium.SampledPositionProperty);
  assert.ok(runner.orientation instanceof Cesium.VelocityOrientationProperty);

  // Position at sec 0 vs sec 10
  const pos0 = runtime.positionAt('runner-1', 0);
  const pos10 = runtime.positionAt('runner-1', 10);
  assert.ok(pos0 && pos10);
  assert.notDeepEqual(pos0, pos10);
});

test('routes render polylines and closed routes render dashed red with sign', () => {
  const viewer = createMockViewer();
  const runtime = createSceneRuntime({ viewer });

  runtime.attach(makeSampleScene());
  runtime.flush();

  const mainRoute = runtime.entityById('route-main');
  assert.ok(mainRoute?.polyline);
  assert.equal(mainRoute.polyline.width.getValue(), 4);

  const closedRoute = runtime.entityById('route-closed');
  assert.ok(closedRoute?.polyline);
  assert.ok(
    closedRoute.polyline.material instanceof
      Cesium.PolylineDashMaterialProperty,
  );

  const sign = runtime.entityById('route-closed__closed_sign');
  assert.ok(sign, 'closed route midpoint sign should exist');
  assert.ok(sign.billboard);
  assert.equal(sign.label.text.getValue(), 'ROAD CLOSED (illustrative)');
});

test('incremental update diffs entity and route changes without clearing all', () => {
  const viewer = createMockViewer();
  const runtime = createSceneRuntime({ viewer });

  const initial = makeSampleScene();
  runtime.attach(initial);
  runtime.flush();

  const countBefore = runtime.dataSource.entities.values.length;
  assert.ok(countBefore > 0);

  // Update: remove officer-1, add officer-2, keep car-1
  const updated = structuredClone(initial);
  updated.sceneVersion = 1;
  updated.entities = [
    initial.entities[1], // car-1 kept
    {
      id: 'officer-2',
      label: 'New Officer',
      assetId: 'sprite.person.police_officer',
      category: 'police',
      position: { eastM: 30, northM: 30 },
      uncertainty: 'verified',
    },
  ];

  runtime.update(updated);
  runtime.flush();

  assert.equal(runtime.entityById('officer-1'), null);
  assert.ok(runtime.entityById('officer-2'));
  assert.ok(runtime.entityById('car-1'));
});

test('highlight and select badges', () => {
  const viewer = createMockViewer();
  const runtime = createSceneRuntime({ viewer });

  runtime.attach(makeSampleScene());
  runtime.flush();

  runtime.setHighlight('officer-1', true, 3);
  runtime.flush();

  const badge = runtime.entityById('officer-1__badge');
  assert.ok(badge);
  assert.ok(badge.billboard.image.getValue().includes('alert_state_3'));

  runtime.setHighlight('officer-1', false);
  runtime.flush();
  assert.equal(runtime.entityById('officer-1__badge'), null);

  // Selection
  runtime.select('officer-1');
  assert.equal(runtime.selected(), 'officer-1');
});

test('snapshot returns structured JSON', () => {
  const viewer = createMockViewer();
  const runtime = createSceneRuntime({
    viewer,
    playback: { state: () => ({ state: 'playing', positionSec: 12 }) },
  });

  runtime.attach(makeSampleScene());
  runtime.flush();

  const snap = runtime.snapshot();
  assert.equal(snap.sceneId, 'scene-rt-1');
  assert.equal(snap.entities.length, 3);
  assert.equal(snap.routes.length, 2);
  assert.ok(snap.rendered.billboards > 0);
  assert.ok(snap.rendered.polylines > 0);
  assert.equal(snap.playback.positionSec, 12);
});

test('destroy cleans up data source and entities', () => {
  const viewer = createMockViewer();
  const runtime = createSceneRuntime({ viewer });

  runtime.attach(makeSampleScene());
  runtime.flush();

  assert.ok(viewer.getSource());
  runtime.destroy();
  assert.equal(viewer.getRemoved(), 1);
});
