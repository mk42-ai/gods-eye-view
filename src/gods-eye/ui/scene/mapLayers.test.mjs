/**
 * @fileoverview Tests for map layers controller and Cesium entity management.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMapLayers } from './mapLayers.js';

function createStubViewer() {
  const entityList = [];
  return {
    entities: {
      get values() {
        return entityList;
      },
      add(entity) {
        entityList.push(entity);
        return entity;
      },
      remove(entity) {
        const idx = entityList.indexOf(entity);
        if (idx >= 0) entityList.splice(idx, 1);
      },
      getById(id) {
        return entityList.find((e) => e.id === id);
      },
    },
    scene: {
      cartesianToCanvasCoordinates(cart) {
        return { x: cart.lon * 10, y: cart.lat * 10 };
      },
    },
  };
}

const stubCesium = {
  Color: {
    fromCssColorString: (s) => ({
      toCssColorString: () => s,
      withAlpha: (a) => ({ hex: s, alpha: a }),
    }),
  },
  Cartesian3: {
    fromDegrees: (lon, lat, alt) => ({ lon, lat, alt }),
  },
};

test('mapLayers.clear removes only prefixed entities', () => {
  const viewer = createStubViewer();
  const mapLayers = createMapLayers({ viewer, Cesium: stubCesium });

  // Manually populate entities for two different scenes
  viewer.entities.add({ id: 'ge:sceneA:pin:p1' });
  viewer.entities.add({ id: 'ge:sceneA:route:r1' });
  viewer.entities.add({ id: 'ge:sceneB:pin:p2' });
  viewer.entities.add({ id: 'unrelated:entity:1' });

  assert.equal(viewer.entities.values.length, 4);

  // Clear sceneA only
  mapLayers.clear('sceneA');

  const remainingIds = viewer.entities.values.map((e) => e.id);
  assert.equal(remainingIds.includes('ge:sceneA:pin:p1'), false);
  assert.equal(remainingIds.includes('ge:sceneA:route:r1'), false);
  assert.equal(remainingIds.includes('ge:sceneB:pin:p2'), true);
  assert.equal(remainingIds.includes('unrelated:entity:1'), true);
});

test('mapLayers creates pins, confidence rings, leader lines, and distance rings', () => {
  const viewer = createStubViewer();
  const mapLayers = createMapLayers({ viewer, Cesium: stubCesium });

  const scene = {
    id: 's_burj',
    camera: { stage: 'S2' },
    target: { name: 'Burj Khalifa', lat: 25.1972, lon: 55.2744 },
    route: {
      groundRoutes: [
        {
          id: 'szr',
          name: 'Sheikh Zayed Rd',
          status: 'open',
          geometry: [
            [25.2, 55.27],
            [25.18, 55.25],
          ],
        },
      ],
    },
    footage: [
      {
        id: 'f1',
        recency: 'LIVE',
        location: { lat: 25.196, lon: 55.275, confidence: 'exact' },
      },
      {
        id: 'f2',
        recency: 'RECENT',
        location: { lat: 25.198, lon: 55.279, confidence: 'inferred' },
      },
    ],
  };

  mapLayers.setScene(scene);

  const ids = viewer.entities.values.map((e) => e.id);

  // Pins
  assert.ok(ids.includes('ge:s_burj:pin:f1'));
  assert.ok(ids.includes('ge:s_burj:pin:f2'));

  // Confidence rings
  assert.ok(ids.includes('ge:s_burj:conf:f1'));
  assert.ok(ids.includes('ge:s_burj:conf:f2'));

  // Leader lines
  assert.ok(ids.includes('ge:s_burj:leader:f1'));
  assert.ok(ids.includes('ge:s_burj:leader:f2'));

  // Distance rings (S2)
  assert.ok(ids.includes('ge:s_burj:dist:0.5'));
  assert.ok(ids.includes('ge:s_burj:dist:1'));
  assert.ok(ids.includes('ge:s_burj:dist:2'));

  // Route
  assert.ok(ids.includes('ge:s_burj:route:szr'));
});
