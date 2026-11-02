/**
 * Scene staging layer — renders the deterministic engine's GeoJSON layers
 * (SCENE_ARCHITECTURE.md §4–5) as real Cesium entities:
 *   areas   cordons (dashed outline + translucent fill), focal footprint, crowd zones
 *   lines   routes: dark casing + teal/mint core + soft glow
 *   points  sprite icons (billboards) from /scene-icons/png/<key>.png
 *   labels  haloed text (>= 13 px, #0B1220 halo), de-duplicated by the engine
 *           and decluttered here by priority (text-allow-overlap:false)
 *   badge   ONE fixed DOM element – never repeated as a map label
 *   camera  verified camera-discovery markers (cctv_signal) added by the parent
 *
 * The recording window never rebuilds this layer (geometry is prompt-derived,
 * not time-derived). Saved scenes restore it from the validated `staging`.
 */
import * as Cesium from 'cesium';
import { governorRequestRender } from '../../renderGovernor.js';
import {
  STAGING_COLORS,
  STAGING_BADGE_TEXT,
  PRIORITY,
  stagingSignature,
  stagingCounts,
} from '../../scenes/sceneStaging.js';
import { iconBillboardGraphics } from '../../scenes/iconBillboard.js';

export const STAGING_LABEL_FONT =
  '600 13px system-ui, -apple-system, Segoe UI, sans-serif';
export const STAGING_FOCAL_FONT =
  '700 14px system-ui, -apple-system, Segoe UI, sans-serif';
/** Cesium outlineWidth is in CSS px at DPR 1 => >= 1.5 px halo requirement. */
export const STAGING_HALO_WIDTH = 4;
export const ICON_BASE_URL = '/scene-icons/png/';
const LINE_WIDTH = Object.freeze({
  route_line: { core: 6, casing: 9, glow: 14 },
  route_approach: { core: 4, casing: 7, glow: 11 },
  route_egress: { core: 4, casing: 7, glow: 11 },
  cordon_inner: { core: 3, casing: 5 },
  cordon_outer: { core: 2.5, casing: 4.5 },
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
  command_post: 28,
  cctv: 24,
  cordon_node: 22,
  route_start: 26,
  route_finish: 26,
  generic: 20,
});

/**
 * Greedy label declutter by priority: returns the set of label ids to show.
 * Pure (no Cesium) so it is unit-testable. `boxes` = [{id, priority, x, y, w, h}].
 */
export function declutterLabels(boxes, padding = 4) {
  const sorted = [...boxes].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
  );
  const kept = [];
  const visible = new Set();
  for (const box of sorted) {
    const overlaps = kept.some(
      (k) =>
        box.x - padding < k.x + k.w &&
        box.x + box.w + padding > k.x &&
        box.y - padding < k.y + k.h &&
        box.y + box.h + padding > k.y,
    );
    if (overlaps) continue;
    kept.push(box);
    visible.add(box.id);
  }
  return visible;
}

/** Approximate screen box of a label (13 px font ≈ 7.2 px per char). */
export function labelBox(
  id,
  priority,
  x,
  y,
  text,
  { px = 13, charW = 0.56 } = {},
) {
  const w = Math.max(12, Math.round(text.length * px * charW));
  const h = Math.round(px * 1.4);
  return { id, priority, x: x - w / 2, y: y - h / 2, w, h };
}

export function createSceneStagingLayer(
  viewer,
  { document: doc = globalThis.document, iconBaseUrl = ICON_BASE_URL } = {},
) {
  const source = new Cesium.CustomDataSource('scene-staging');
  viewer.dataSources.add(source);
  const badge = doc.createElement('div');
  badge.id = 'scene-illustrative-badge';
  badge.className = 'scene-illustrative-badge';
  badge.setAttribute('role', 'note');
  badge.textContent = STAGING_BADGE_TEXT;
  badge.hidden = true;
  doc.body.append(badge);

  const tooltip = doc.createElement('div');
  tooltip.id = 'scene-staging-tooltip';
  tooltip.className = 'scene-staging-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  doc.body.append(tooltip);

  let staging = null;
  let cameras = [];
  let destroyed = false;
  let renders = 0;
  const labelEntities = [];
  const dark = Cesium.Color.fromCssColorString(STAGING_COLORS.navy);
  const css = (hex) => Cesium.Color.fromCssColorString(hex);

  // Hover tooltips via Cesium ScreenSpaceEventHandler (MOUSE_MOVE -> scene.pick)
  let hoverHandler = null;
  const canvas = viewer.scene?.canvas || viewer.canvas;
  if (canvas && typeof Cesium.ScreenSpaceEventHandler === 'function') {
    hoverHandler = new Cesium.ScreenSpaceEventHandler(canvas);
    hoverHandler.setInputAction((movement) => {
      if (destroyed || !staging || !movement?.endPosition) {
        tooltip.hidden = true;
        return;
      }
      let picked = null;
      try {
        picked = viewer.scene?.pick?.(movement.endPosition);
      } catch {
        picked = null;
      }
      const entity = picked?.id;
      const props = entity?.properties;
      if (entity && props) {
        const getProp = (k) =>
          typeof props[k]?.getValue === 'function'
            ? props[k].getValue(Cesium.JulianDate.now())
            : props[k];

        const elem = getProp('element');
        if (elem) {
          const conf = getProp('confidence');
          const source = getProp('source');
          const tier = getProp('evidenceTier');
          const relevance = getProp('relevance');

          const lines = [];
          lines.push(`<strong>${String(elem).replace(/_/g, ' ')}</strong>`);
          if (conf !== undefined && conf !== null) {
            lines.push(`Confidence: ${Math.round(conf * 100)}%`);
          }
          if (source) {
            lines.push(`Source: ${source}`);
          }
          if (tier) {
            lines.push(`Evidence: ${tier}`);
          }
          if (relevance !== undefined && relevance !== null) {
            lines.push(`Relevance: ${Math.round(relevance * 100)}%`);
          }

          tooltip.innerHTML = lines.join('<br/>');
          tooltip.style.left = `${Math.round(movement.endPosition.x + 12)}px`;
          tooltip.style.top = `${Math.round(movement.endPosition.y + 12)}px`;
          tooltip.hidden = false;
          return;
        }
      }
      tooltip.hidden = true;
    }, Cesium.ScreenSpaceEventType?.MOUSE_MOVE || 15);
  }

  function render() {
    viewer.scene?.requestRender?.();
    governorRequestRender('scene-staging');
  }
  function addArea(f) {
    const p = f.properties;
    const ring = f.geometry.coordinates[0];
    const color = css(p.color);
    const isCordon = p.role === 'cordon';
    const widths = LINE_WIDTH[p.lineStyle] || { core: 2, casing: 4 };
    source.entities.add({
      id: `staging-${p.id}`,
      name: p.label || p.element,
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(ring.slice(0, -1).flat()),
        material: color.withAlpha(
          p.role === 'focal'
            ? 0.16
            : p.role === 'zone'
              ? 0.18
              : isCordon
                ? 0.07
                : 0.12,
        ),
        classificationType: Cesium.ClassificationType?.BOTH,
      },
      properties: {
        illustrative: true,
        element: p.element,
        role: p.role,
        stagingId: p.id,
        confidence: p.confidence ?? null,
        source: p.source ?? '',
        evidenceTier: p.evidenceTier ?? '',
        generic: p.generic ?? false,
      },
    });
    // Casing + core outline as separate polylines (Cesium polygons clamp outlines poorly).
    source.entities.add({
      id: `staging-${p.id}-casing`,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(ring.flat()),
        clampToGround: true,
        width: widths.casing,
        material: dark.withAlpha(0.85),
      },
      properties: {
        illustrative: true,
        element: p.element,
        role: 'casing',
        stagingId: p.id,
      },
    });
    source.entities.add({
      id: `staging-${p.id}-outline`,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(ring.flat()),
        clampToGround: true,
        width: widths.core,
        material: isCordon
          ? new Cesium.PolylineDashMaterialProperty({
              color,
              gapColor: Cesium.Color.TRANSPARENT,
              dashLength: p.lineStyle === 'cordon_outer' ? 24 : 14,
            })
          : color.withAlpha(0.9),
      },
      properties: {
        illustrative: true,
        element: p.element,
        role: 'outline',
        stagingId: p.id,
      },
    });
  }
  function addLine(f) {
    const p = f.properties;
    const positions = Cesium.Cartesian3.fromDegreesArray(
      f.geometry.coordinates.flat(),
    );
    const widths = LINE_WIDTH[p.lineStyle] || LINE_WIDTH.route_approach;
    const color = css(p.color);
    if (widths.glow)
      source.entities.add({
        id: `staging-${p.id}-glow`,
        polyline: {
          positions,
          clampToGround: true,
          width: widths.glow,
          material: new Cesium.PolylineGlowMaterialProperty({
            color: color.withAlpha(0.55),
            glowPower: 0.35,
            taperPower: 1,
          }),
        },
        properties: {
          illustrative: true,
          element: p.element,
          role: 'glow',
          stagingId: p.id,
        },
      });
    source.entities.add({
      id: `staging-${p.id}-casing`,
      polyline: {
        positions,
        clampToGround: true,
        width: widths.casing,
        material: dark.withAlpha(0.9),
      },
      properties: {
        illustrative: true,
        element: p.element,
        role: 'casing',
        stagingId: p.id,
      },
    });
    source.entities.add({
      id: `staging-${p.id}`,
      name: p.label || p.element,
      polyline: {
        positions,
        clampToGround: true,
        width: widths.core,
        material:
          p.lineStyle === 'route_egress'
            ? new Cesium.PolylineArrowMaterialProperty(color)
            : color,
      },
      properties: {
        illustrative: true,
        element: p.element,
        role: p.role,
        stagingId: p.id,
        lineStyle: p.lineStyle || '',
        confidence: p.confidence ?? null,
        source: p.source ?? '',
        evidenceTier: p.evidenceTier ?? '',
        generic: p.generic ?? false,
      },
    });
  }
  function addPoint(f) {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const size = ICON_SIZE[p.icon] || 20;
    source.entities.add({
      id: `staging-${p.id}`,
      name: p.label || p.element,
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      billboard: p.icon
        ? iconBillboardGraphics(Cesium, {
            key: p.icon,
            image: `${iconBaseUrl}${p.icon}.png`,
            sizePx: size,
            heading:
              p.icon === 'cone' || p.icon === 'barrier' ? 0 : -(p.heading || 0),
            rotate: !(p.icon === 'cone' || p.icon === 'barrier'),
          })
        : undefined,
      point: p.icon
        ? undefined
        : {
            pixelSize: 9,
            color: css(p.color),
            outlineColor: dark,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
      properties: {
        illustrative: true,
        element: p.element,
        role: p.role,
        stagingId: p.id,
        icon: p.icon || '',
        priority: p.priority,
        confidence: p.confidence ?? null,
        source: p.source ?? '',
        evidenceTier: p.evidenceTier ?? '',
        generic: p.generic ?? false,
        ...(p.relevance !== undefined ? { relevance: p.relevance } : {}),
        ...(p.status ? { status: p.status } : {}),
        ...(p.distanceM !== undefined ? { distanceM: p.distanceM } : {}),
      },
    });
  }
  function addLabel(f) {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const focal = p.role === 'focal';
    const entity = source.entities.add({
      id: `staging-${p.id}`,
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      label: {
        text: p.label,
        font: focal ? STAGING_FOCAL_FONT : STAGING_LABEL_FONT,
        fillColor: css(focal ? STAGING_COLORS.white : p.color),
        outlineColor: dark,
        outlineWidth: STAGING_HALO_WIDTH,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: false,
        pixelOffset: new Cesium.Cartesian2(0, focal ? -26 : -16),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(500, 1, 40000, 0.85),
        distanceDisplayCondition:
          Cesium.DistanceDisplayCondition &&
          typeof Cesium.DistanceDisplayCondition === 'function'
            ? new Cesium.DistanceDisplayCondition(0, 60000)
            : undefined,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      },
      properties: {
        illustrative: true,
        element: p.element,
        role: 'label',
        stagingId: p.id,
        priority: p.priority,
        labelText: p.label,
      },
    });
    labelEntities.push({
      entity,
      priority: p.priority,
      text: p.label,
      id: p.id,
    });
  }
  function addCameraMarkers() {
    const wanted = staging?.spec?.elements?.some(
      (e) => e.type === 'cctv_signal',
    );
    if (!wanted) return 0;
    let n = 0;
    for (const cam of cameras.slice(0, 6)) {
      if (!Number.isFinite(cam.lat) || !Number.isFinite(cam.lon)) continue;
      source.entities.add({
        id: `staging-cctv-${n + 1}`,
        name: cam.name || cam.id || 'Camera',
        position: Cesium.Cartesian3.fromDegrees(cam.lon, cam.lat),
        billboard: iconBillboardGraphics(Cesium, {
          key: 'cctv_signal',
          image: `${iconBaseUrl}cctv_signal.png`,
          sizePx: ICON_SIZE.cctv_signal,
        }),
        properties: {
          illustrative: false,
          element: 'cctv_signal',
          role: 'signal',
          stagingId: `cctv-${n + 1}`,
          status: cam.status || 'unknown',
          distanceM: cam.distanceM ?? null,
          provider: cam.provider || '',
        },
      });
      n += 1;
    }
    return n;
  }

  // ---- declutter (text-allow-overlap:false by priority) --------------------
  let lastDeclutter = 0;
  function declutter() {
    if (destroyed || !staging || !labelEntities.length) return;
    const scene = viewer.scene;
    if (
      !scene ||
      typeof Cesium.SceneTransforms?.worldToWindowCoordinates !== 'function'
    )
      return;
    const boxes = [];
    for (const item of labelEntities) {
      const pos = item.entity.position?.getValue?.(Cesium.JulianDate.now());
      if (!pos) continue;
      let win;
      try {
        win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, pos);
      } catch {
        win = null;
      }
      if (!win) {
        item.entity.show = false;
        continue;
      }
      boxes.push(
        labelBox(
          item.id,
          item.priority,
          win.x,
          win.y - (item.priority >= PRIORITY.focal ? 26 : 16),
          item.text,
        ),
      );
    }
    const visible = declutterLabels(boxes);
    for (const item of labelEntities) item.entity.show = visible.has(item.id);
  }
  const onPostRender = () => {
    const t = Date.now();
    if (t - lastDeclutter < 120) return;
    lastDeclutter = t;
    declutter();
  };
  viewer.scene?.postRender?.addEventListener?.(onPostRender);

  function build() {
    source.entities.removeAll();
    labelEntities.length = 0;
    if (!staging) {
      badge.hidden = true;
      render();
      return;
    }
    for (const f of staging.layers.areas.features) addArea(f);
    for (const f of staging.layers.lines.features) addLine(f);
    for (const f of staging.layers.points.features) addPoint(f);
    for (const f of staging.layers.labels.features) addLabel(f);
    addCameraMarkers();
    badge.hidden = false;
    badge.dataset.signature = stagingSignature(staging);
    badge.dataset.scenario = staging.spec.scenarioType;
    renders += 1;
    declutter();
    render();
  }

  return {
    setScene(scene) {
      if (destroyed) return;
      staging = scene?.staging || null;
      build();
    },
    /** Verified camera-discovery results (cctv_signal). Never invented here. */
    setCameras(list) {
      if (destroyed) return;
      cameras = Array.isArray(list)
        ? list.filter((c) => c && c.usable !== false)
        : [];
      if (staging) build();
    },
    clear() {
      staging = null;
      tooltip.hidden = true;
      build();
    },
    declutter,
    getState() {
      const counts = staging ? stagingCounts(staging) : {};
      return {
        status: staging ? 'staged' : 'none',
        scenario: staging?.spec?.scenarioType || null,
        signature: staging ? stagingSignature(staging) : null,
        renders,
        entities: source.entities.values.length,
        counts,
        areas: staging?.layers.areas.features.length || 0,
        lines: staging?.layers.lines.features.length || 0,
        points: staging?.layers.points.features.length || 0,
        labels: labelEntities.map((l) => ({
          id: l.id,
          text: l.text,
          priority: l.priority,
          visible: l.entity.show !== false,
        })),
        cameraMarkers: source.entities.values.filter(
          (e) => e.properties?.element?.getValue?.() === 'cctv_signal',
        ).length,
        badgeVisible: !badge.hidden,
        badgeText: badge.textContent,
        badgeCount: doc.querySelectorAll
          ? doc.querySelectorAll('#scene-illustrative-badge').length
          : 1,
        model: staging?.model
          ? {
              provider: staging.model.provider,
              id: staging.model.id,
              latencyMs: staging.model.latencyMs,
            }
          : null,
        timing: staging?.timing || null,
        unavailable: staging?.unavailable || [],
      };
    },
    destroy() {
      destroyed = true;
      if (hoverHandler && typeof hoverHandler.destroy === 'function') {
        hoverHandler.destroy();
        hoverHandler = null;
      }
      tooltip.remove();
      viewer.scene?.postRender?.removeEventListener?.(onPostRender);
      badge.remove();
      if (!viewer.isDestroyed?.()) viewer.dataSources.remove(source, true);
    },
  };
}
