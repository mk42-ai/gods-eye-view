/**
 * @fileoverview Map layers management for Cesium viewer (pins, routes, AOI, distance rings).
 * @module gods-eye/ui/scene/mapLayers
 */

import {
  STATUS_COLORS,
  getCesiumColor,
  getCartesian,
  buildPinEntity,
  buildConfidenceEntity,
  buildLeaderLine,
  detectClusters,
} from './mapLayersGraphics.js';

/**
 * Creates the map layers controller for a Cesium viewer.
 * @param {object} params
 * @param {any} params.viewer
 * @param {any} [params.Cesium]
 */
export function createMapLayers({ viewer, Cesium }) {
  let currentScene = null;
  let currentStage = 'S2';
  let currentItems = [];
  let currentRoutes = [];
  let currentAoi = null;
  let filterPredicate = null;

  function safeAdd(entity) {
    if (viewer?.entities?.add && entity) viewer.entities.add(entity);
  }

  function clearPrefix(prefix) {
    const entities = viewer?.entities;
    if (!entities) return;
    const values = Array.isArray(entities.values)
      ? entities.values.slice()
      : entities.values
        ? Array.from(entities.values)
        : [];
    for (const ent of values) {
      if (ent?.id && String(ent.id).startsWith(prefix)) {
        if (typeof entities.remove === 'function') entities.remove(ent);
        else if (typeof entities.removeById === 'function')
          entities.removeById(ent.id);
      }
    }
  }

  function clear(sceneId) {
    if (sceneId) clearPrefix(`ge:${sceneId}:`);
  }

  function renderAoi() {
    if (!currentScene?.id || !['S0', 'S1'].includes(currentStage)) return;
    clearPrefix(`ge:${currentScene.id}:aoi`);
    const aoi = currentAoi || currentScene.aoi;
    if (!aoi?.radiusKm) return;
    const radiusM = aoi.radiusKm * 1000;
    const lon = aoi.lon ?? currentScene.target?.lon ?? 0;
    const lat = aoi.lat ?? currentScene.target?.lat ?? 0;

    safeAdd({
      id: `ge:${currentScene.id}:aoi`,
      position: getCartesian(Cesium, lon, lat),
      ellipse: {
        semiMinorAxis: radiusM,
        semiMajorAxis: radiusM,
        material: getCesiumColor(Cesium, '#3bb795', 0.15),
        outline: true,
        outlineColor: getCesiumColor(Cesium, '#3bb795', 0.8),
        outlineWidth: 2,
      },
    });
  }

  function renderDistanceRings() {
    if (!currentScene?.id || !['S2', 'S3', 'S4'].includes(currentStage)) return;
    clearPrefix(`ge:${currentScene.id}:dist:`);
    const tgt = currentScene.target;
    if (tgt?.lat == null || tgt?.lon == null) return;
    const center = getCartesian(Cesium, tgt.lon, tgt.lat);

    for (const ring of [
      { id: '0.5', radius: 500 },
      { id: '1', radius: 1000 },
      { id: '2', radius: 2000 },
    ]) {
      safeAdd({
        id: `ge:${currentScene.id}:dist:${ring.id}`,
        position: center,
        ellipse: {
          semiMinorAxis: ring.radius,
          semiMajorAxis: ring.radius,
          material: getCesiumColor(Cesium, '#3bb795', 0.05),
          outline: true,
          outlineColor: getCesiumColor(Cesium, '#3bb795', 0.4),
          outlineWidth: 1,
        },
      });
    }
  }

  function renderRoutes() {
    if (!currentScene?.id) return;
    clearPrefix(`ge:${currentScene.id}:route:`);
    const routes =
      currentRoutes.length > 0
        ? currentRoutes
        : currentScene.route?.groundRoutes || [];
    for (const route of routes) {
      if (!Array.isArray(route?.geometry) || route.geometry.length < 2)
        continue;
      const positions = route.geometry.map(([lat, lon]) =>
        getCartesian(Cesium, lon, lat),
      );
      const hex = STATUS_COLORS[route.status] || STATUS_COLORS.unknown;
      safeAdd({
        id: `ge:${currentScene.id}:route:${route.id}`,
        description: `${route.name || 'Route'} (${route.status || 'unknown'})`,
        polyline: {
          positions,
          width: 3,
          material: getCesiumColor(Cesium, hex, 0.85),
        },
      });
    }
  }

  function renderFootage() {
    if (!currentScene?.id || !['S2', 'S3', 'S4'].includes(currentStage)) return;
    clearPrefix(`ge:${currentScene.id}:pin:`);
    clearPrefix(`ge:${currentScene.id}:conf:`);
    clearPrefix(`ge:${currentScene.id}:leader:`);
    clearPrefix(`ge:${currentScene.id}:cluster:`);

    const items = filterPredicate
      ? currentItems.filter(filterPredicate)
      : currentItems;
    if (!items.length) return;
    const target = currentScene.target;
    const clusters = !['S3', 'S4'].includes(currentStage)
      ? detectClusters(items, viewer, Cesium)
      : null;

    if (clusters) {
      const clusteredIds = new Set();
      clusters.forEach((grp, idx) => {
        grp.forEach((g) => clusteredIds.add(g.item.id));
        const avgLon =
          grp.reduce((acc, g) => acc + (g.item.location?.lon ?? 0), 0) /
          grp.length;
        const avgLat =
          grp.reduce((acc, g) => acc + (g.item.location?.lat ?? 0), 0) /
          grp.length;
        safeAdd({
          id: `ge:${currentScene.id}:cluster:${idx}`,
          position: getCartesian(Cesium, avgLon, avgLat),
          point: {
            pixelSize: 26,
            color: getCesiumColor(Cesium, '#3bb795'),
            outlineColor: getCesiumColor(Cesium, '#070f16'),
            outlineWidth: 2,
          },
          label: {
            text: String(grp.length),
            font: '11px monospace',
            fillColor: getCesiumColor(Cesium, '#f3f3f3'),
          },
        });
      });

      for (const item of items) {
        if (clusteredIds.has(item.id)) continue;
        safeAdd(buildPinEntity(Cesium, currentScene.id, item));
        safeAdd(buildConfidenceEntity(Cesium, currentScene.id, item, target));
        safeAdd(buildLeaderLine(Cesium, currentScene.id, item, target));
      }
      return;
    }

    for (const item of items) {
      safeAdd(buildPinEntity(Cesium, currentScene.id, item));
      safeAdd(buildConfidenceEntity(Cesium, currentScene.id, item, target));
      safeAdd(buildLeaderLine(Cesium, currentScene.id, item, target));
    }
  }

  function renderAll() {
    renderAoi();
    renderDistanceRings();
    renderRoutes();
    renderFootage();
  }

  return {
    setScene(scene) {
      if (currentScene?.id && currentScene.id !== scene?.id)
        clear(currentScene.id);
      currentScene = scene;
      if (scene?.camera?.stage) currentStage = scene.camera.stage;
      if (Array.isArray(scene?.footage)) currentItems = scene.footage;
      if (Array.isArray(scene?.route?.groundRoutes))
        currentRoutes = scene.route.groundRoutes;
      renderAll();
    },
    setStage(stage) {
      currentStage = stage || 'S2';
      renderAll();
    },
    setItems(items) {
      currentItems = Array.isArray(items) ? items : [];
      renderFootage();
    },
    setFilter(predicate) {
      filterPredicate = predicate;
      renderFootage();
    },
    setRoutes(groundRoutes) {
      currentRoutes = Array.isArray(groundRoutes) ? groundRoutes : [];
      renderRoutes();
    },
    setAoi(aoi) {
      currentAoi = aoi;
      renderAoi();
    },
    pulse(itemId) {
      if (!currentScene?.id || !viewer?.entities) return;
      const id = `ge:${currentScene.id}:pin:${itemId}`;
      const ent = viewer.entities.getById
        ? viewer.entities.getById(id)
        : Array.from(viewer.entities.values || []).find((e) => e.id === id);
      if (ent?.point) {
        const origSize = ent.point.pixelSize || 10;
        ent.point.pixelSize = origSize * 2;
        setTimeout(() => {
          if (ent.point) ent.point.pixelSize = origSize;
        }, 600);
      }
    },
    clear,
    destroy() {
      if (currentScene?.id) clear(currentScene.id);
    },
  };
}
