/**
 * Research-grounded scene geometry layer: lines (routes snapped to the road
 * network), dots (researched locations) and areas (venue footprints) drawn as
 * real Cesium entities, so pan, zoom, tilt and resize re-project them natively
 * every frame — no screen-space overlay can drift out of alignment.
 *
 * The recording window only re-styles existing entities (setTimeWindow); it
 * never rebuilds geometry. Every depiction is labelled ILLUSTRATIVE; empty or
 * failed research renders an explicit legend state and draws nothing.
 */
import * as Cesium from 'cesium';
import { governorRequestRender } from '../../renderGovernor.js';
import {
  geometryRenderSpec,
  geometrySignature,
  SUGGESTED_MARKER_LABEL,
} from '../../scenes/sceneGeometry.js';

const COLORS = Object.freeze({
  route: '#4fd1c5',
  point: '#f6c453',
  area: '#7aa7ff',
});
const STATUS_TEXT = Object.freeze({
  grounded: 'Research-grounded',
  partial: 'Partially grounded (some places could not be located)',
  empty: 'Research returned no mappable places — nothing drawn',
  unavailable: 'Location research unavailable — nothing drawn',
});
const short = (value, max = 34) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

export function createSceneGeometryLayer(
  viewer,
  {
    document: doc = globalThis.document,
    now = () => Date.now(),
    createHandler = (canvas) =>
      Cesium.ScreenSpaceEventHandler
        ? new Cesium.ScreenSpaceEventHandler(canvas)
        : null,
  } = {},
) {
  const source = new Cesium.CustomDataSource('scene-research-geometry');
  viewer.dataSources.add(source);
  const legend = doc.createElement('aside');
  legend.id = 'scene-geometry-legend';
  legend.className = 'scene-geometry-legend';
  legend.setAttribute('aria-label', 'Scene map legend and research citations');
  legend.hidden = true;
  const tooltip = doc.createElement('div');
  tooltip.id = 'scene-geometry-tooltip';
  tooltip.className = 'scene-geometry-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  doc.body.append(legend, tooltip);

  let geometry = null;
  let spec = null;
  let selectedTime = null;
  let destroyed = false;
  let renders = 0;
  let restyles = 0;
  const byId = new Map();

  function render() {
    viewer.scene?.requestRender?.();
    governorRequestRender('scene-research-geometry');
  }
  function citationText(item) {
    if (!item.citationNumbers.length)
      return 'No research citation for this feature.';
    return item.citationNumbers
      .map((n) => {
        const c = spec.citations[n - 1];
        return `[${n}] ${c?.title || c?.url || ''}`;
      })
      .join('\n');
  }
  function describe(item, kind) {
    return [
      `ILLUSTRATIVE · ${item.label}`,
      `${kind} · ${item.role}`,
      `Geometry: ${item.provenance.source}`,
      item.timeState === 'outside-window'
        ? 'Outside the selected recording window'
        : item.timeState === 'in-window'
          ? 'Within the selected recording window'
          : 'No researched time window',
      citationText(item),
    ].join('\n');
  }
  function style(item) {
    const entity = byId.get(item.id);
    if (!entity) return;
    const base = Cesium.Color.fromCssColorString(
      COLORS[entity.properties.kind.getValue()],
    );
    const alpha = item.timeState === 'outside-window' ? 0.35 : 1;
    entity.properties.timeState = item.timeState;
    if (entity.polyline) {
      entity.polyline.width = item.timeState === 'outside-window' ? 3 : 5;
      entity.polyline.material =
        item.timeState === 'outside-window'
          ? new Cesium.PolylineDashMaterialProperty({
              color: base.withAlpha(alpha),
              dashLength: 16,
            })
          : new Cesium.PolylineOutlineMaterialProperty({
              color: base.withAlpha(alpha),
              outlineColor: Cesium.Color.fromCssColorString('#06141b'),
              outlineWidth: 1.5,
            });
    }
    if (entity.polygon) entity.polygon.material = base.withAlpha(alpha * 0.22);
    if (entity.point) {
      entity.point.color = base.withAlpha(alpha);
    }
    const label = byId.get(`${item.id}-label`);
    if (label?.label)
      label.label.fillColor = Cesium.Color.WHITE.withAlpha(
        item.timeState === 'outside-window' ? 0.55 : 1,
      );
  }
  function addLabel(item, position, kind) {
    const numbers = item.citationNumbers.length
      ? ` [${item.citationNumbers.join(',')}]`
      : '';
    const entity = source.entities.add({
      id: `${item.id}-label`,
      position,
      label: {
        text: `ILLUSTRATIVE · ${short(item.label)}${numbers}`,
        font: '600 12px system-ui, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#06141b'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        showBackground: false,
        pixelOffset: new Cesium.Cartesian2(0, kind === 'point' ? -18 : 0),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(500, 1, 60000, 0.7),
      },
      properties: { featureId: item.id, illustrative: true, labelOnly: true },
    });
    byId.set(`${item.id}-label`, entity);
  }
  function add(item, kind) {
    const common = {
      id: item.id,
      name: `ILLUSTRATIVE · ${item.label}`,
      description: describe(item, kind),
      properties: {
        illustrative: true,
        researchGrounded: true,
        kind,
        featureId: item.id,
        citationNumbers: item.citationNumbers,
        provenance: item.provenance.source,
        timeState: item.timeState,
      },
    };
    let entity;
    if (kind === 'route') {
      entity = source.entities.add({
        ...common,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(
            item.coordinates.flat(),
          ),
          clampToGround: true,
          width: 5,
          material: Cesium.Color.fromCssColorString(COLORS.route),
        },
      });
      addLabel(
        item,
        Cesium.Cartesian3.fromDegrees(item.labelAt.lon, item.labelAt.lat),
        kind,
      );
    } else if (kind === 'area') {
      entity = source.entities.add({
        ...common,
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(
            item.ring.slice(0, -1).flat(),
          ),
          material: Cesium.Color.fromCssColorString(COLORS.area).withAlpha(
            0.22,
          ),
          classificationType: Cesium.ClassificationType?.BOTH,
        },
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(item.ring.flat()),
          clampToGround: true,
          width: 2,
          material: Cesium.Color.fromCssColorString(COLORS.area),
        },
      });
      addLabel(
        item,
        Cesium.Cartesian3.fromDegrees(item.labelAt.lon, item.labelAt.lat),
        kind,
      );
    } else {
      const position = Cesium.Cartesian3.fromDegrees(item.lon, item.lat);
      entity = source.entities.add({
        ...common,
        position,
        point: {
          pixelSize: 12,
          color: Cesium.Color.fromCssColorString(COLORS.point),
          outlineColor: Cesium.Color.fromCssColorString('#06141b'),
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      addLabel(item, position, kind);
    }
    byId.set(item.id, entity);
    style(item);
  }
  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function renderLegend() {
    if (!geometry) {
      legend.hidden = true;
      legend.replaceChildren();
      return;
    }
    legend.hidden = false;
    legend.dataset.status = spec.status;
    legend.dataset.signature = geometrySignature(geometry);
    const head = el('div', 'scene-geometry-legend__head');
    head.append(
      el('strong', 'scene-geometry-legend__badge', 'ILLUSTRATIVE'),
      el('span', 'scene-geometry-legend__title', 'Research map'),
    );
    const status = el(
      'p',
      'scene-geometry-legend__status',
      STATUS_TEXT[spec.status] || spec.status,
    );
    status.id = 'scene-geometry-status';
    const window = el(
      'p',
      'scene-geometry-legend__window',
      `Recording window: ${spec.windowLabel} · ${spec.counts.inWindow} in window, ${spec.counts.outsideWindow} outside, ${spec.counts.timeUnknown} undated`,
    );
    window.id = 'scene-geometry-window';
    const keys = el('ul', 'scene-geometry-legend__keys');
    for (const [kind, label, count] of [
      ['route', 'Researched route (road-snapped)', spec.counts.lines],
      ['point', 'Researched location', spec.counts.points],
      ['area', 'Researched area / footprint', spec.counts.areas],
    ]) {
      const li = el(
        'li',
        `scene-geometry-legend__key scene-geometry-legend__key--${kind}`,
      );
      const swatch = el('span', 'scene-geometry-legend__swatch');
      swatch.style.background = COLORS[kind];
      li.append(swatch, el('span', '', `${label} (${count})`));
      keys.append(li);
    }
    const staged = el(
      'li',
      'scene-geometry-legend__key scene-geometry-legend__key--staged',
    );
    staged.append(
      el(
        'span',
        'scene-geometry-legend__swatch scene-geometry-legend__swatch--staged',
      ),
      el('span', '', `People / vehicles: ${SUGGESTED_MARKER_LABEL}`),
    );
    keys.append(staged);
    legend.replaceChildren(head, status, window, keys);
    if (geometry.message)
      legend.append(
        el('p', 'scene-geometry-legend__message', geometry.message),
      );
    if (geometry.unresolved?.length)
      legend.append(
        el(
          'p',
          'scene-geometry-legend__unresolved',
          `Not located (not drawn): ${geometry.unresolved
            .map((u) => u.name)
            .slice(0, 6)
            .join('; ')}`,
        ),
      );
    if (spec.citations.length) {
      const list = el('ol', 'scene-geometry-legend__citations');
      list.id = 'scene-geometry-citations';
      for (const c of spec.citations) {
        const li = el('li');
        const a = el('a', '', c.title || c.url);
        a.href = c.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.title = c.url;
        li.append(a);
        list.append(li);
      }
      legend.append(
        el('p', 'scene-geometry-legend__sources', 'Research sources'),
        list,
      );
    }
    legend.append(
      el(
        'p',
        'scene-geometry-legend__note',
        'Geometry © OpenStreetMap contributors (Nominatim / OSRM). Not live, not verified deployment, not an operational plan.',
      ),
    );
  }

  let handler = null;
  function ensureHandler() {
    if (
      handler ||
      !viewer.scene?.canvas ||
      typeof viewer.scene.pick !== 'function'
    )
      return;
    try {
      handler = createHandler(viewer.scene.canvas);
    } catch {
      handler = null;
    }
    if (!handler) return;
    handler.setInputAction((movement) => {
      if (destroyed || !geometry) return;
      const picked = viewer.scene.pick(movement.endPosition);
      const entity = picked?.id;
      const featureId = entity?.properties?.featureId?.getValue?.();
      const target = featureId && byId.get(featureId);
      if (!target || !source.entities.contains(target)) {
        tooltip.hidden = true;
        return;
      }
      tooltip.textContent = target.description.getValue();
      tooltip.style.left = `${Math.round(movement.endPosition.x + 14)}px`;
      tooltip.style.top = `${Math.round(movement.endPosition.y + 14)}px`;
      tooltip.hidden = false;
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  function build() {
    source.entities.removeAll();
    byId.clear();
    tooltip.hidden = true;
    if (!geometry) {
      spec = null;
      renderLegend();
      render();
      return;
    }
    spec = geometryRenderSpec(geometry, { selectedTime, now: now() });
    for (const item of spec.areas) add(item, 'area');
    for (const item of spec.lines) add(item, 'route');
    for (const item of spec.points) add(item, 'point');
    renders += 1;
    renderLegend();
    ensureHandler();
    render();
  }

  return {
    setScene(scene) {
      if (destroyed) return;
      geometry = scene?.geometry || null;
      selectedTime = scene?.selectedTime || null;
      build();
    },
    /** Restyle for a new recording window. Never rebuilds or re-fetches geometry. */
    setTimeWindow(nextTime) {
      if (destroyed) return;
      selectedTime = nextTime || null;
      if (!geometry) return;
      spec = geometryRenderSpec(geometry, { selectedTime, now: now() });
      for (const item of [...spec.points, ...spec.lines, ...spec.areas]) {
        style(item);
        const entity = byId.get(item.id);
        if (entity)
          entity.description = describe(
            item,
            entity.properties.kind.getValue(),
          );
      }
      restyles += 1;
      renderLegend();
      render();
    },
    clear() {
      geometry = null;
      build();
    },
    getState() {
      return {
        status: geometry ? spec.status : 'none',
        signature: geometry ? geometrySignature(geometry) : null,
        windowLabel: spec?.windowLabel || null,
        renders,
        restyles,
        entities: source.entities.values.length,
        points: (spec?.points || []).map((p) => ({
          id: p.id,
          label: p.label,
          lat: p.lat,
          lon: p.lon,
          citationNumbers: p.citationNumbers,
          timeState: p.timeState,
        })),
        lines: (spec?.lines || []).map((l) => ({
          id: l.id,
          label: l.label,
          vertices: l.coordinates.length,
          first: l.coordinates[0],
          last: l.coordinates.at(-1),
          citationNumbers: l.citationNumbers,
          timeState: l.timeState,
        })),
        areas: (spec?.areas || []).map((a) => ({
          id: a.id,
          label: a.label,
          vertices: a.ring.length,
          citationNumbers: a.citationNumbers,
          timeState: a.timeState,
        })),
        citations: (spec?.citations || []).map((c) => ({
          id: c.id,
          number: c.number,
          url: c.url,
          title: c.title || null,
        })),
        legendVisible: !legend.hidden,
      };
    },
    destroy() {
      destroyed = true;
      handler?.destroy?.();
      legend.remove();
      tooltip.remove();
      if (!viewer.isDestroyed?.()) viewer.dataSources.remove(source, true);
    },
  };
}
