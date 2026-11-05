/**
 * Incident overlay — Cesium rendering of the incident ledger: category
 * markers (the 10 generated icons), AOI outlines per group (toggleable) and
 * a click → popover hook. Everything lives in one CustomDataSource so the
 * scene director's layer reconciliation never touches it.
 */
import * as Cesium from 'cesium';
import {
  registerPickOwner,
  unregisterPickOwner,
} from '../../data/pickRegistry.js';
import { isPointerFree } from '../../data/inputOwnership.js';
import { governorRequestRender } from '../../renderGovernor.js';

export const INCIDENT_PICK_PREFIX = 'incident:';
export const AOI_PICK_PREFIX = 'aoi:';

const CONFIDENCE_COLORS = {
  confirmed: '#3bb795',
  inferred: '#f5a623',
  unverified: '#9aa7b2',
};

export function createIncidentOverlay(viewer, { onPick } = {}) {
  const source = new Cesium.CustomDataSource('incident-ledger');
  const aoiSource = new Cesium.CustomDataSource('incident-aoi');
  viewer.dataSources.add(aoiSource);
  viewer.dataSources.add(source);
  let groupVisibility = {};
  let handler = null;
  let destroyed = false;
  const byIncidentId = new Map();

  function installPick() {
    if (handler || !viewer?.scene?.canvas) return;
    registerPickOwner('incidents', (id) =>
      String(id).startsWith(INCIDENT_PICK_PREFIX),
    );
    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click) => {
      if (!isPointerFree?.()) return;
      const picked = viewer.scene.pick(click.position);
      const id = picked?.id?.id ?? picked?.id;
      if (typeof id !== 'string' || !id.startsWith(INCIDENT_PICK_PREFIX))
        return;
      const incidentId = id.slice(INCIDENT_PICK_PREFIX.length);
      const rec = byIncidentId.get(incidentId);
      if (rec) onPick?.(rec, { x: click.position.x, y: click.position.y });
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function setIncidents(incidents) {
    if (destroyed) return;
    source.entities.suspendEvents();
    source.entities.removeAll();
    byIncidentId.clear();
    for (const inc of incidents) {
      byIncidentId.set(inc.id, inc);
      const color = Cesium.Color.fromCssColorString(
        CONFIDENCE_COLORS[inc.confidence] || CONFIDENCE_COLORS.unverified,
      );
      source.entities.add({
        id: `${INCIDENT_PICK_PREFIX}${inc.id}`,
        name: inc.title,
        position: Cesium.Cartesian3.fromDegrees(inc.lon, inc.lat, 0),
        billboard: {
          image: `/icons/incidents/${inc.category}.png`,
          width: inc.category === 'thermal_hotspot' ? 22 : 30,
          height: inc.category === 'thermal_hotspot' ? 22 : 30,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(2.0e5, 1.2, 8.0e6, 0.45),
        },
        point: {
          pixelSize: 5,
          color,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: { incidentId: inc.id, category: inc.category },
      });
    }
    source.entities.resumeEvents();
    installPick();
    governorRequestRender?.('incident-overlay');
  }

  function setAoiOutlines(outlines) {
    if (destroyed) return;
    aoiSource.entities.suspendEvents();
    aoiSource.entities.removeAll();
    for (const outline of outlines) {
      const positions = outline.ring.flatMap(([lon, lat]) => [lon, lat]);
      const color = Cesium.Color.fromCssColorString(outline.color || '#ffffff');
      aoiSource.entities.add({
        id: `${AOI_PICK_PREFIX}${outline.id}`,
        name: outline.name,
        show: groupVisibility[outline.group] !== false,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(positions),
          width: outline.group === 'presence' ? 1.5 : 2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: color.withAlpha(0.85),
            dashLength: outline.group === 'country' ? 24 : 12,
          }),
          clampToGround: true,
        },
        properties: { group: outline.group },
      });
    }
    aoiSource.entities.resumeEvents();
    governorRequestRender?.('incident-aoi');
  }

  function setGroupVisibility(next) {
    groupVisibility = { ...groupVisibility, ...next };
    for (const entity of aoiSource.entities.values) {
      const group =
        entity.properties?.group?.getValue?.() ?? entity.properties?.group;
      entity.show = groupVisibility[group] !== false;
    }
    governorRequestRender?.('incident-aoi-toggle');
  }

  function flyTo(
    lat,
    lon,
    { altitude = 180_000, heading = 0, pitch = -60, duration = 2.5 } = {},
  ) {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, altitude),
      orientation: {
        heading: Cesium.Math.toRadians(heading),
        pitch: Cesium.Math.toRadians(pitch),
        roll: 0,
      },
      duration,
    });
  }

  /** Screen position of an incident for the popover anchor (null when behind the globe). */
  function screenPosition(incidentId) {
    const entity = source.entities.getById(
      `${INCIDENT_PICK_PREFIX}${incidentId}`,
    );
    const cartesian = entity?.position?.getValue?.(Cesium.JulianDate.now());
    if (!cartesian) return null;
    const win =
      Cesium.SceneTransforms.worldToWindowCoordinates?.(
        viewer.scene,
        cartesian,
      ) ||
      Cesium.SceneTransforms.wgs84ToWindowCoordinates?.(
        viewer.scene,
        cartesian,
      );
    return win ? { x: win.x, y: win.y } : null;
  }

  function destroy() {
    destroyed = true;
    unregisterPickOwner('incidents');
    handler?.destroy();
    handler = null;
    try {
      viewer.dataSources.remove(source, true);
      viewer.dataSources.remove(aoiSource, true);
    } catch {
      /* viewer may already be gone */
    }
  }

  return {
    setIncidents,
    setAoiOutlines,
    setGroupVisibility,
    flyTo,
    screenPosition,
    destroy,
    get incidentCount() {
      return byIncidentId.size;
    },
    getIncident: (id) => byIncidentId.get(id) || null,
  };
}
