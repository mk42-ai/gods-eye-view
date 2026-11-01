/**
 * sceneStreamLayer.js — progressive Cesium preview of element_added features
 *
 * Uses the SAME visual language as sceneStagingLayer:
 *   - Cased lines: PolylineOutlineMaterialProperty outline #0B1220 width 2 around #14B8A6/#A7F3D0 core
 *   - Routes: PolylineGlowMaterialProperty
 *   - Dashed cordons: PolylineDashMaterialProperty
 *   - Points: small billboards from `/scene-icons/png/<icon>.png` or point primitive when icon missing
 *
 * Owns its own CustomDataSource ('scene-stream-preview') and is cleared when the final scene is set.
 * Dependency-injected (viewer passed in) so it can be tested with a fake viewer.
 */
import * as CesiumModule from 'cesium';

export const STREAM_LAYER_NAME = 'scene-stream-preview';
export const STREAM_COLORS = Object.freeze({
  navy: '#0B1220',
  teal: '#14B8A6',
  mint: '#A7F3D0',
  white: '#FFFFFF',
});

const ICON_SIZE = Object.freeze({
  cone: 14,
  barrier: 18,
  police_unit: 26,
  perimeter_unit: 22,
  checkpoint: 24,
  staging_point: 28,
  cctv_signal: 24,
  crowd_zone: 26,
  start_finish: 28,
  egress: 24,
});

export function createSceneStreamLayer(
  viewer,
  { Cesium = CesiumModule, iconBaseUrl = '/scene-icons/png/' } = {},
) {
  const source = Cesium.CustomDataSource
    ? new Cesium.CustomDataSource(STREAM_LAYER_NAME)
    : {
        name: STREAM_LAYER_NAME,
        entities: {
          values: [],
          add(e) {
            this.values.push(e);
            return e;
          },
          remove(e) {
            this.values = this.values.filter((item) => item !== e);
          },
          removeAll() {
            this.values = [];
          },
        },
      };

  viewer?.dataSources?.add?.(source);

  const dark =
    Cesium.Color?.fromCssColorString?.(STREAM_COLORS.navy) ||
    STREAM_COLORS.navy;
  const css = (hex) =>
    Cesium.Color?.fromCssColorString?.(hex) || Cesium.Color?.WHITE || hex;

  function render() {
    viewer?.scene?.requestRender?.();
  }

  function addArea(f) {
    const p = f.properties || {};
    const coords = f.geometry?.coordinates?.[0];
    if (!coords || !coords.length) return;
    const color = css(p.color || STREAM_COLORS.teal);
    const isCordon =
      p.role === 'cordon' || p.lineStyle?.startsWith?.('cordon_');

    const positions = Cesium.Cartesian3?.fromDegreesArray
      ? Cesium.Cartesian3.fromDegreesArray(coords.flat())
      : coords.flat();
    const polyPositions = Cesium.Cartesian3?.fromDegreesArray
      ? Cesium.Cartesian3.fromDegreesArray(coords.slice(0, -1).flat())
      : coords.slice(0, -1).flat();

    const polyMaterial = color?.withAlpha ? color.withAlpha(0.12) : color;

    source.entities.add({
      id: `stream-area-${p.id || Math.random()}`,
      name: p.label || p.element || 'area',
      polygon: {
        hierarchy: polyPositions,
        material: polyMaterial,
      },
      polyline: {
        positions,
        width: 2,
        clampToGround: true,
        material: isCordon
          ? new Cesium.PolylineDashMaterialProperty({
              color,
              gapColor: Cesium.Color?.TRANSPARENT,
              dashLength: p.lineStyle === 'cordon_outer' ? 24 : 14,
            })
          : new Cesium.PolylineOutlineMaterialProperty({
              color,
              outlineColor: dark,
              outlineWidth: 2,
            }),
      },
      properties: { ...p, streamPreview: true },
    });
  }

  function addLine(f) {
    const p = f.properties || {};
    const coords = f.geometry?.coordinates;
    if (!coords || !coords.length) return;
    const color = css(p.color || STREAM_COLORS.teal);
    const isRoute = p.role === 'route' || p.lineStyle?.startsWith?.('route_');
    const isCordon =
      p.role === 'cordon' || p.lineStyle?.startsWith?.('cordon_');

    const positions = Cesium.Cartesian3?.fromDegreesArray
      ? Cesium.Cartesian3.fromDegreesArray(coords.flat())
      : coords.flat();

    let material;
    let width = 4;

    if (isRoute) {
      width = 6;
      material = Cesium.PolylineGlowMaterialProperty
        ? new Cesium.PolylineGlowMaterialProperty({
            color: color?.withAlpha ? color.withAlpha(0.65) : color,
            glowPower: 0.35,
            taperPower: 1,
          })
        : color;
    } else if (isCordon) {
      width = 3;
      material = Cesium.PolylineDashMaterialProperty
        ? new Cesium.PolylineDashMaterialProperty({
            color,
            gapColor: Cesium.Color?.TRANSPARENT,
            dashLength: p.lineStyle === 'cordon_outer' ? 24 : 14,
          })
        : color;
    } else {
      material = Cesium.PolylineOutlineMaterialProperty
        ? new Cesium.PolylineOutlineMaterialProperty({
            color,
            outlineColor: dark,
            outlineWidth: 2,
          })
        : color;
    }

    source.entities.add({
      id: `stream-line-${p.id || Math.random()}`,
      name: p.label || p.element || 'line',
      polyline: {
        positions,
        width,
        clampToGround: true,
        material,
      },
      properties: { ...p, streamPreview: true },
    });
  }

  function addPoint(f) {
    const p = f.properties || {};
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) return;
    const [lon, lat] = coords;
    const size = ICON_SIZE[p.icon] || 20;
    const color = css(p.color || STREAM_COLORS.teal);
    const position = Cesium.Cartesian3?.fromDegrees
      ? Cesium.Cartesian3.fromDegrees(lon, lat)
      : { lon, lat };

    source.entities.add({
      id: `stream-point-${p.id || Math.random()}`,
      name: p.label || p.element || 'point',
      position,
      billboard: p.icon
        ? {
            image: `${iconBaseUrl}${p.icon}.png`,
            width: size,
            height: size,
            heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          }
        : undefined,
      point: p.icon
        ? undefined
        : {
            pixelSize: 9,
            color,
            outlineColor: dark,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
          },
      properties: { ...p, streamPreview: true },
    });
  }

  function addLabel(f) {
    const p = f.properties || {};
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) return;
    const [lon, lat] = coords;
    const position = Cesium.Cartesian3?.fromDegrees
      ? Cesium.Cartesian3.fromDegrees(lon, lat)
      : { lon, lat };

    source.entities.add({
      id: `stream-label-${p.id || Math.random()}`,
      name: p.label || 'label',
      position,
      label: {
        text: p.label || '',
        font: '600 13px system-ui, -apple-system, Segoe UI, sans-serif',
        fillColor: Cesium.Color?.WHITE || STREAM_COLORS.white,
        outlineColor: dark,
        outlineWidth: 4,
        style: Cesium.LabelStyle?.FILL_AND_OUTLINE,
        heightReference: Cesium.HeightReference?.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: { ...p, streamPreview: true },
    });
  }

  function addElement(item) {
    if (!item) return;
    const feature = item.feature || item;
    const layer = item.layer || feature.layer || '';
    const geomType = feature.geometry?.type;

    if (layer === 'areas' || geomType === 'Polygon') {
      addArea(feature);
    } else if (layer === 'lines' || geomType === 'LineString') {
      addLine(feature);
    } else if (layer === 'labels') {
      addLabel(feature);
    } else if (layer === 'points' || geomType === 'Point') {
      addPoint(feature);
    }
    render();
  }

  function clear() {
    source.entities?.removeAll?.();
    render();
  }

  function destroy() {
    clear();
    viewer?.dataSources?.remove?.(source);
    render();
  }

  return {
    source,
    addElement,
    clear,
    destroy,
    getState() {
      return {
        count: source.entities?.values?.length || 0,
        entities: source.entities?.values || [],
      };
    },
  };
}

export default createSceneStreamLayer;
