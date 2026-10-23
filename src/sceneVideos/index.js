/**
 * Scene video evidence — application wiring (src/app/tools.js).
 *  • mounts the rail (rail.js) once
 *  • starts a fan-out whenever the bottom incident composer is submitted
 *    (captured before the composer clears its input), and on the
 *    `gev:scene-videos` window event (voice / other entry points)
 *  • renders a map pin per clip location (Cesium billboard-free point +
 *    label, so no new icon assets) and flies to the pin on PLAY
 */
import * as Cesium from 'cesium';
import { createSceneVideoRail } from './rail.js';
import { PLATFORM_SHORT } from './labels.js';
import { governorRequestRender } from '../renderGovernor.js';

export const SCENE_VIDEOS_EVENT = 'gev:scene-videos';
const TIER_COLOR = { LIVE: '#ff3b3b', RECENT: '#ffb020', ARCHIVAL: '#9aa4b2' };

function createPins(viewer) {
  const source = new Cesium.CustomDataSource('scene-video-pins');
  viewer?.dataSources?.add?.(source);
  return {
    source,
    set(clips) {
      source.entities.removeAll();
      // Clips that share the incident anchor are fanned out on a small ring so
      // every pin stays clickable.
      const groups = new Map();
      for (const c of clips) {
        if (!Number.isFinite(c.geo?.lat)) continue;
        const k = `${c.geo.lat.toFixed(4)},${c.geo.lon.toFixed(4)}`;
        groups.set(k, [...(groups.get(k) || []), c]);
      }
      for (const group of groups.values()) {
        group.forEach((c, i) => {
          const r = group.length > 1 ? 0.0025 : 0;
          const a = (2 * Math.PI * i) / group.length;
          source.entities.add({
            id: `svp-${c.id}`,
            position: Cesium.Cartesian3.fromDegrees(
              c.geo.lon + r * Math.cos(a),
              c.geo.lat + r * Math.sin(a),
              30,
            ),
            point: {
              pixelSize: 11,
              color: Cesium.Color.fromCssColorString(
                TIER_COLOR[c.tier] || TIER_COLOR.ARCHIVAL,
              ),
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: `${PLATFORM_SHORT[c.platform] || ''} ${c.tier}`,
              font: '11px monospace',
              fillColor: Cesium.Color.WHITE,
              showBackground: true,
              backgroundColor:
                Cesium.Color.fromCssColorString('#0b0f14').withAlpha(0.8),
              pixelOffset: new Cesium.Cartesian2(0, -18),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              scaleByDistance: new Cesium.NearFarScalar(2_000, 1, 200_000, 0.6),
            },
            properties: { clipId: c.id },
          });
        });
      }
      governorRequestRender?.('scene-video-pins');
    },
    clear() {
      source.entities.removeAll();
      governorRequestRender?.('scene-video-pins');
    },
  };
}

export function installSceneVideos({
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
  const rail = createSceneVideoRail({ document: doc, window: win, pins });
  (doc.body || doc.documentElement).appendChild(rail.element);

  const onSubmit = (event) => {
    const form = event.target;
    if (!form || form.id !== 'incident-composer') return;
    const input = form.querySelector?.('#incident-composer-input');
    const text = String(input?.value || '').trim();
    if (text) void rail.start(text);
  };
  // capture phase: runs before the composer's own handler clears the input
  doc.addEventListener('submit', onSubmit, true);
  const onEvent = (event) => {
    const prompt = event?.detail?.prompt;
    if (prompt) void rail.start(prompt, { anchor: event.detail.anchor });
  };
  win?.addEventListener?.(SCENE_VIDEOS_EVENT, onEvent);

  const api = {
    rail,
    start: (prompt, opts) => rail.start(prompt, opts),
    getState: () => ({
      clips: rail.state.clips.length,
      platforms: [...new Set(rail.state.clips.map((c) => c.platform))],
      tiers: rail.state.clips.map((c) => c.tier),
      playing: rail.state.playingId,
      done: rail.state.done,
      banner:
        doc.getElementById?.('scene-video-rail-banner')?.textContent || '',
    }),
    destroy() {
      doc.removeEventListener('submit', onSubmit, true);
      win?.removeEventListener?.(SCENE_VIDEOS_EVENT, onEvent);
      rail.destroy();
      if (pins && viewer?.dataSources?.remove)
        viewer.dataSources.remove(pins.source, true);
      if (win && win.__gevSceneVideos === api) delete win.__gevSceneVideos;
    },
  };
  if (win) win.__gevSceneVideos = api;
  if (signal?.aborted) api.destroy();
  else signal?.addEventListener?.('abort', () => api.destroy(), { once: true });
  return api;
}
