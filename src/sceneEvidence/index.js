/**
 * Scene evidence — application wiring (src/app/tools.js).
 *  • mounts the evidence panel once
 *  • opens it on `gev:scene-evidence` (BUILD SCENE located / scene built /
 *    saved scene reopened / card / voice) and on a `?evidence=` share link
 *  • renders map pins per item (Cesium points + labels); approximate
 *    locations are labelled "~" and drawn hollow — never shown as exact
 */
import * as Cesium from 'cesium';
import { createSceneEvidencePanel, PLATFORM_NAME } from './panel.js';
import { decodeShare } from './store.js';
import { governorRequestRender } from '../renderGovernor.js';

export const SCENE_EVIDENCE_EVENT = 'gev:scene-evidence';
const FRESH_COLOR = {
  LIVE: '#ff3b3b',
  RECENT: '#ffb020',
  STALE: '#5fb3ff',
  ARCHIVAL: '#9aa4b2',
};
const GEO_TAG = { exact: '', place: '~PLACE ', text: '~TEXT ', none: '' };

function createPins(viewer) {
  const source = new Cesium.CustomDataSource('scene-evidence-pins');
  viewer?.dataSources?.add?.(source);
  return {
    source,
    set(items, selectedId) {
      source.entities.removeAll();
      const located = items.filter(
        (i) => Number.isFinite(i.geo?.lat) && Number.isFinite(i.geo?.lon),
      );
      // Approximate (place/text) items share the AOI centre: fan them on a ring
      // so each stays clickable — the ring itself signals "approximate".
      const groups = new Map();
      for (const it of located) {
        const k = `${it.geo.lat.toFixed(4)},${it.geo.lon.toFixed(4)}`;
        groups.set(k, [...(groups.get(k) || []), it]);
      }
      for (const group of groups.values())
        group.forEach((it, i) => {
          const exact = it.geo.precision === 'exact';
          const r = group.length > 1 ? 0.0018 + 0.0004 * Math.floor(i / 12) : 0;
          const a = (2 * Math.PI * (i % 12)) / Math.min(12, group.length);
          const color = Cesium.Color.fromCssColorString(
            FRESH_COLOR[it.freshness] || FRESH_COLOR.ARCHIVAL,
          );
          const sel = it.id === selectedId;
          source.entities.add({
            id: `sev-${it.id}`,
            position: Cesium.Cartesian3.fromDegrees(
              it.geo.lon + r * Math.cos(a),
              it.geo.lat + r * Math.sin(a),
              30,
            ),
            point: {
              pixelSize: sel ? 15 : exact ? 11 : 9,
              color: exact ? color : color.withAlpha(0.25),
              outlineColor: exact ? Cesium.Color.BLACK : color,
              outlineWidth: exact ? 2 : 3,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label:
              sel || exact
                ? {
                    text: `${GEO_TAG[it.geo.precision]}${PLATFORM_NAME[it.platform] || ''} ${it.freshness}`,
                    font: '11px monospace',
                    fillColor: Cesium.Color.WHITE,
                    showBackground: true,
                    backgroundColor:
                      Cesium.Color.fromCssColorString('#0b0f14').withAlpha(
                        0.85,
                      ),
                    pixelOffset: new Cesium.Cartesian2(0, -18),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                  }
                : undefined,
            properties: { evidenceId: it.id, geoPrecision: it.geo.precision },
          });
        });
      governorRequestRender?.('scene-evidence-pins');
    },
    focus(item) {
      if (!Number.isFinite(item?.geo?.lat)) return;
      try {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(
            item.geo.lon,
            item.geo.lat,
            item.geo.precision === 'exact' ? 900 : 3200,
          ),
          duration: 1.2,
        });
      } catch {
        /* camera busy (scene playback) */
      }
      governorRequestRender?.('scene-evidence-focus');
    },
    clear() {
      source.entities.removeAll();
      governorRequestRender?.('scene-evidence-pins');
    },
  };
}

export function installSceneEvidence({
  viewer,
  signal,
  document: doc = globalThis.document,
  window: win = globalThis.window,
} = {}) {
  if (!doc) return null;
  let pins = null;
  try {
    pins = viewer ? createPins(viewer) : null;
  } catch {
    pins = null;
  }
  const panel = createSceneEvidencePanel({
    document: doc,
    window: win,
    pins,
    storage: win?.localStorage,
  });
  (doc.body || doc.documentElement).appendChild(panel.element);

  // Clicking a pin on the map selects its card (map ↔ rail ↔ player sync).
  let handler = null;
  try {
    if (viewer?.scene?.canvas) {
      handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((m) => {
        const picked = viewer.scene.pick(m.position);
        const id = picked?.id?.properties?.evidenceId?.getValue?.();
        if (id) panel.select(id, { focusMap: false });
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }
  } catch {
    handler = null;
  }

  let lastKey = '';
  let lastAt = 0;
  const onEvent = (event) => {
    const d = event?.detail || {};
    if (!d.text && !d.place) return;
    const request = {
      text: d.text || d.place,
      place: d.place,
      lat: Number.isFinite(d.lat) ? d.lat : d.anchor?.lat,
      lon: Number.isFinite(d.lon) ? d.lon : d.anchor?.lon,
      radiusKm: d.radiusKm || 5,
      windowHours: d.windowHours || 72,
      sceneId: d.sceneId,
      fresh: Boolean(d.fresh),
    };
    // located → built fire back-to-back for one BUILD SCENE: open once.
    const key = `${request.place || request.text}|${request.lat?.toFixed?.(3)}|${request.lon?.toFixed?.(3)}`;
    if (
      !d.fresh &&
      !d.preferCache &&
      key === lastKey &&
      Date.now() - lastAt < 15_000
    )
      return;
    lastKey = key;
    lastAt = Date.now();
    void panel.open(request, { preferCache: Boolean(d.preferCache) });
  };
  win?.addEventListener?.(SCENE_EVIDENCE_EVENT, onEvent);
  const onCancel = () => panel.close();
  win?.addEventListener?.('gev:incident-command-cancelled', onCancel);

  // Shared link: ?evidence=<encoded request> reopens the same evidence scene.
  try {
    const shared = decodeShare(
      new URL(win.location.href).searchParams.get('evidence'),
    );
    if (shared)
      setTimeout(
        () => void panel.open({ ...shared, text: shared.place }),
        1500,
      );
  } catch {
    /* no share param */
  }

  const api = {
    panel,
    open: (req, opts) => panel.open(req, opts),
    getState: () => {
      const s = panel.state;
      return {
        phase: s.phase,
        key: s.key,
        place: s.place,
        items: s.items.length,
        signals: s.signals.length,
        sources: s.sources.map((x) => ({
          id: x.id,
          state: x.state,
          count: x.count,
          ms: x.ms,
        })),
        client: s.client,
        timings: s.timings,
        engine: s.engine,
        summary: s.summary,
        selectedId: s.selectedId,
        filters: s.filters,
        diff: s.diff,
        byFreshness: s.items.reduce(
          (m, x) => ((m[x.freshness] = (m[x.freshness] || 0) + 1), m),
          {},
        ),
        byGeo: s.items.reduce(
          (m, x) => ((m[x.geo.precision] = (m[x.geo.precision] || 0) + 1), m),
          {},
        ),
      };
    },
    destroy() {
      win?.removeEventListener?.(SCENE_EVIDENCE_EVENT, onEvent);
      win?.removeEventListener?.('gev:incident-command-cancelled', onCancel);
      handler?.destroy?.();
      panel.destroy();
      if (pins && viewer?.dataSources?.remove)
        viewer.dataSources.remove(pins.source, true);
      if (win && win.__gevSceneEvidence === api) delete win.__gevSceneEvidence;
    },
  };
  if (win) win.__gevSceneEvidence = api;
  if (signal?.aborted) api.destroy();
  else signal?.addEventListener?.('abort', () => api.destroy(), { once: true });
  return api;
}
