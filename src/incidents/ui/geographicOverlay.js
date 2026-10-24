/** Real map entities for authored geography and non-playable external context. */
import * as Cesium from 'cesium';
import { governorRequestRender } from '../../renderGovernor.js';

export function createGeographicOverlay(viewer, { document: doc = globalThis.document } = {}) {
  const source = new Cesium.CustomDataSource('authored-geography');
  viewer.dataSources.add(source);
  const label = doc.createElement('div');
  label.id = 'scene-anchor-label';
  label.className = 'scene-anchor-label';
  label.hidden = true;
  label.setAttribute('aria-live', 'polite');
  doc.body.append(label);
  let anchor = null;
  let external = false;
  let destroyRequested = false;
  const update = () => {
    if (!anchor || destroyRequested) return;
    const p = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, anchor);
    if (!p || p.x < 0 || p.y < 0 || p.x > viewer.canvas.clientWidth || p.y > viewer.canvas.clientHeight) {
      label.hidden = true;
      return;
    }
    label.hidden = false;
    label.style.left = `${Math.round(p.x)}px`;
    label.style.top = `${Math.round(p.y)}px`;
  };
  viewer.scene.postRender.addEventListener(update);

  function mark(point, title, isExternal = false) {
    source.entities.removeAll();
    external = isExternal;
    anchor = Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 15);
    const color = Cesium.Color.fromCssColorString(isExternal ? '#f3b34c' : '#51d3c4');
    source.entities.add({
      id: isExternal ? 'external-context-anchor' : 'geographic-scene-anchor',
      name: title, position: anchor,
      point: {
        pixelSize: isExternal ? 16 : 12,
        color: isExternal ? Cesium.Color.BLACK.withAlpha(0.1) : color,
        outlineColor: color, outlineWidth: isExternal ? 4 : 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: isExternal ? 'EXTERNAL' : title.toUpperCase(),
        font: 'bold 12px sans-serif', fillColor: color,
        showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('#10232d').withAlpha(0.9),
        pixelOffset: new Cesium.Cartesian2(0, -28),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: { contextOnly: isExternal, playable: !isExternal },
    });
    label.className = isExternal ? 'scene-anchor-label incident-external-marker external' : 'scene-anchor-label geographic-scene-marker';
    label.textContent = isExternal ? `EXTERNAL · ${title}` : title;
    label.dataset.external = String(isExternal);
    label.dataset.lat = String(point.lat);
    label.dataset.lon = String(point.lon);
    label.hidden = false;
    viewer.scene.requestRender();
    governorRequestRender('authored-geography');
  }
  return {
    setScene(scene) {
      mark(scene.anchor, scene.anchor.name);
      source.entities.add({
        id: 'geographic-camera-orbit', name: 'Authored camera orbit, not a road or vessel track',
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(scene.keyframes.flatMap((frame) => [frame.lon, frame.lat])),
          width: 2, clampToGround: true,
          material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.fromCssColorString('#51d3c4').withAlpha(0.8), dashLength: 14 }),
        },
      });
      scene.keyframes.forEach((frame, index) => source.entities.add({
        id: `geographic-camera-${index}`, name: `Camera view ${index + 1}: ${frame.label}`,
        position: Cesium.Cartesian3.fromDegrees(frame.lon, frame.lat, 10),
        point: { pixelSize: 6, color: Cesium.Color.fromCssColorString('#a1e7df'), outlineColor: Cesium.Color.BLACK, outlineWidth: 1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      }));
      update();
    },
    setExternal(candidate) { mark(candidate, candidate.name, true); update(); },
    getState() { return { external, entities: source.entities.values.length, markerVisible: !label.hidden }; },
    destroy() {
      destroyRequested = true;
      viewer.scene.postRender.removeEventListener(update);
      label.remove();
      if (!viewer.isDestroyed?.()) viewer.dataSources.remove(source, true);
    },
  };
}
