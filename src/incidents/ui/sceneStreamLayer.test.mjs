import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneStreamLayer } from './sceneStreamLayer.js';

function createMockViewer() {
  const sources = [];
  let renderRequested = false;
  return {
    dataSources: {
      add(ds) {
        sources.push(ds);
        return ds;
      },
      remove(ds) {
        const idx = sources.indexOf(ds);
        if (idx !== -1) sources.splice(idx, 1);
      },
      get list() {
        return sources;
      },
    },
    scene: {
      requestRender() {
        renderRequested = true;
      },
    },
    get renderRequested() {
      return renderRequested;
    },
  };
}

test('sceneStreamLayer creates CustomDataSource and adds entities for element_added events', () => {
  const viewer = createMockViewer();
  const layer = createSceneStreamLayer(viewer);

  assert.equal(viewer.dataSources.list.length, 1);
  assert.equal(layer.getState().count, 0);

  // Add line (approach route)
  layer.addElement({
    layer: 'lines',
    feature: {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [55.27, 25.19],
          [55.28, 25.2],
        ],
      },
      properties: {
        id: 'route-1',
        element: 'approach_route',
        role: 'route',
        color: '#14B8A6',
      },
    },
  });

  assert.equal(layer.getState().count, 1);
  const routeEntity = layer.getState().entities[0];
  assert.ok(routeEntity.polyline);
  const routePropId =
    routeEntity.properties?.id?.getValue?.() || routeEntity.properties?.id;
  assert.equal(routePropId, 'route-1');

  // Add dashed cordon
  layer.addElement({
    layer: 'lines',
    feature: {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [55.27, 25.19],
          [55.28, 25.19],
        ],
      },
      properties: {
        id: 'cordon-1',
        element: 'outer_cordon',
        role: 'cordon',
        lineStyle: 'cordon_outer',
      },
    },
  });

  assert.equal(layer.getState().count, 2);

  // Add point with icon (billboard)
  layer.addElement({
    layer: 'points',
    feature: {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [55.275, 25.195],
      },
      properties: {
        id: 'unit-1',
        element: 'police_unit',
        role: 'unit',
        icon: 'police_unit',
      },
    },
  });

  assert.equal(layer.getState().count, 3);
  const pointEntity = layer.getState().entities[2];
  assert.ok(pointEntity.billboard);
  const billboardImg =
    pointEntity.billboard.image?.getValue?.() || pointEntity.billboard.image;
  assert.match(billboardImg, /police_unit\.png$/);

  // Add point without icon (point primitive)
  layer.addElement({
    layer: 'points',
    feature: {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [55.276, 25.196],
      },
      properties: {
        id: 'marker-2',
        element: 'cctv_signal',
        role: 'signal',
      },
    },
  });

  assert.equal(layer.getState().count, 4);
  const pointEntity2 = layer.getState().entities[3];
  assert.ok(pointEntity2.point);
  assert.equal(pointEntity2.billboard, undefined);

  // Clear removes entities
  layer.clear();
  assert.equal(layer.getState().count, 0);

  // Destroy removes data source
  layer.destroy();
  assert.equal(viewer.dataSources.list.length, 0);
});
