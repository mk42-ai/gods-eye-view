/**
 * @fileoverview Entity constructors and graphic definitions for Cesium map layers.
 * @module gods-eye/ui/scene/mapLayersGraphics
 */

export const RECENCY_COLORS = Object.freeze({
  LIVE: '#35d07f',
  RECENT: '#f5a623',
  ARCHIVE: '#8a9a99',
});

export const STATUS_COLORS = Object.freeze({
  open: '#35d07f',
  restricted: '#f5a623',
  closed: '#ff5a4e',
  unknown: '#8a9a99',
});

export function getCesiumColor(Cesium, hex, alpha = 1.0) {
  if (Cesium?.Color?.fromCssColorString) {
    const col = Cesium.Color.fromCssColorString(hex);
    if (alpha !== 1.0 && col?.withAlpha) {
      return col.withAlpha(alpha);
    }
    return col;
  }
  return hex;
}

export function getCartesian(Cesium, lon, lat, alt = 0) {
  if (Cesium?.Cartesian3?.fromDegrees) {
    return Cesium.Cartesian3.fromDegrees(lon, lat, alt);
  }
  return { lon, lat, alt };
}

export function buildPinEntity(Cesium, sceneId, item) {
  const lon = item.location?.lon ?? 0;
  const lat = item.location?.lat ?? 0;
  const hex = RECENCY_COLORS[item.recency] || RECENCY_COLORS.ARCHIVE;
  const color = getCesiumColor(Cesium, hex);
  const pos = getCartesian(Cesium, lon, lat);

  return {
    id: `ge:${sceneId}:pin:${item.id}`,
    position: pos,
    point: {
      pixelSize: 10,
      color,
      outlineColor: getCesiumColor(Cesium, '#070f16'),
      outlineWidth: 2,
    },
  };
}

export function buildConfidenceEntity(Cesium, sceneId, item, target) {
  const conf = item.location?.confidence || 'unknown';
  let centerLon = item.location?.lon ?? target?.lon ?? 0;
  let centerLat = item.location?.lat ?? target?.lat ?? 0;
  let radius = 25;
  let hex = '#3bb795';

  if (conf === 'unknown') {
    centerLon = target?.lon ?? 0;
    centerLat = target?.lat ?? 0;
    radius = 600;
    hex = '#8a9a99';
  } else if (conf === 'inferred') {
    hex = '#f5a623';
    radius = 50;
  }

  const pos = getCartesian(Cesium, centerLon, centerLat);
  const color = getCesiumColor(Cesium, hex, 0.25);
  const outlineColor = getCesiumColor(Cesium, hex, 0.85);

  const entity = {
    id: `ge:${sceneId}:conf:${item.id}`,
    position: pos,
    ellipse: {
      semiMinorAxis: radius,
      semiMajorAxis: radius,
      material: color,
      outline: true,
      outlineColor,
      outlineWidth: 1.5,
    },
  };

  if (conf === 'inferred' && Cesium?.PolylineDashMaterialProperty) {
    entity.ellipse.outlineMaterial = new Cesium.PolylineDashMaterialProperty({
      color: outlineColor,
      dashLength: 12.0,
    });
  }

  return entity;
}

export function buildLeaderLine(Cesium, sceneId, item, target) {
  const pinPos = getCartesian(
    Cesium,
    item.location?.lon ?? 0,
    item.location?.lat ?? 0,
  );
  const tgtPos = getCartesian(Cesium, target?.lon ?? 0, target?.lat ?? 0);
  return {
    id: `ge:${sceneId}:leader:${item.id}`,
    polyline: {
      positions: [pinPos, tgtPos],
      width: 1,
      material: getCesiumColor(Cesium, '#3bb795', 0.4),
    },
  };
}

export function detectClusters(items, viewer, Cesium) {
  if (!viewer?.scene?.cartesianToCanvasCoordinates || items.length <= 8)
    return null;
  const projected = items.map((item) => {
    const cart = getCartesian(
      Cesium,
      item.location?.lon ?? 0,
      item.location?.lat ?? 0,
    );
    const pt = viewer.scene.cartesianToCanvasCoordinates(cart) || {
      x: 0,
      y: 0,
    };
    return { item, x: pt.x, y: pt.y };
  });

  const visited = new Set();
  const groups = [];
  for (let i = 0; i < projected.length; i++) {
    if (visited.has(i)) continue;
    const group = [projected[i]];
    for (let j = i + 1; j < projected.length; j++) {
      if (visited.has(j)) continue;
      if (
        Math.hypot(
          projected[i].x - projected[j].x,
          projected[i].y - projected[j].y,
        ) <= 100
      ) {
        group.push(projected[j]);
        visited.add(j);
      }
    }
    if (group.length > 8) {
      visited.add(i);
      groups.push(group);
    }
  }
  return groups.length > 0 ? groups : null;
}
