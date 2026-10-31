/**
 * Scene footage — application wiring (src/app/tools.js).
 *
 * Triggers (all funnel into controller.open → POST /api/scenes/:locationId/footage/snapchat):
 *   • location open / BUILD SCENE / saved-scene reopen / card  → `gev:scene-evidence`
 *     (the event the incident composer already dispatches for every in-AOI scene)
 *   • explicit                                                 → `gev:scene-footage`
 *   • map-marker select   → LEFT_CLICK on any picked entity with a position
 *   • camera move into a new scene → camera.moveEnd at ≤ 60 km whose view centre
 *     falls in a configured footage place (config/aoi/footage-places.json)
 * Outside-UAE points never trigger retrieval (same pure scene gate as BUILD SCENE).
 */
import * as Cesium from 'cesium';
import { createFootageController } from './controller.js';
import { createSceneFootagePanel } from './panel.js';
import {
  placeForPoint,
  locationIdFor,
  haversineKm,
  findPlaceByName,
  narrowestPlace,
} from './places.js';
import { resolveIncidentGate } from '../aoi/sceneGate.js';

export const SCENE_FOOTAGE_EVENT = 'gev:scene-footage';
const CAMERA_TRIGGER_MAX_HEIGHT_M = 60_000;

export function installSceneFootage({
  viewer,
  signal,
  document: doc = globalThis.document,
  window: win = globalThis.window,
  fetch: fetchImpl,
} = {}) {
  if (!doc) return null;
  const controller = createFootageController({
    document: doc,
    defaultRefreshMs: 0,
    fetch: fetchImpl,
  });
  // Cost guard: refresh is opt-in, never an implicit background source search.
  controller.setRefreshMs(0);
  const panel = createSceneFootagePanel({
    document: doc,
    controller,
    window: win,
  });
  (doc.body || doc.documentElement).appendChild(panel.element);
  const triggers = [];
  let promptDerivedActive = false;
  controller.subscribe((st) =>
    doc.body?.classList?.toggle('sfp-open', Boolean(st.scene)),
  );

  function open(detail, trigger) {
    // A prompt scene uses only its scoped YouTube/TikTok/Instagram evidence.
    // Moving its camera must not silently start unrelated Snapchat discovery.
    if (
      promptDerivedActive &&
      !['explicit', 'api'].includes(trigger) &&
      !detail?.standby
    )
      return null;
    const lat = Number.isFinite(detail?.lat)
      ? detail.lat
      : Number.isFinite(detail?.anchor?.lat)
        ? detail.anchor.lat
        : controller.state.scene?.lat;
    const lon = Number.isFinite(detail?.lon)
      ? detail.lon
      : Number.isFinite(detail?.anchor?.lon)
        ? detail.anchor.lon
        : controller.state.scene?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (!resolveIncidentGate('', { lat, lon }).allowed) return null;
    // Narrowest configured place named by the operator's own words or the
    // geocoder's candidate name. A long geocoder
    // label ("Corniche Beach - Phase 2, …, Abu Dhabi …") must not widen the
    // scene to the whole city when the operator typed "Abu Dhabi Corniche".
    const rawPlace = String(
      detail.place ||
        detail.placeName ||
        controller.state.scene?.placeName ||
        '',
    )
      .trim()
      .slice(0, 80);
    // Named places (operator text, geocoder label) win over the coordinate;
    // the coordinate is the fallback when no configured name matches.
    const placeName =
      (
        narrowestPlace([
          findPlaceByName(detail.text),
          findPlaceByName(rawPlace),
        ]) || placeForPoint(lat, lon)
      )?.names?.[0] ||
      rawPlace ||
      null;
    // A marker/camera event inside the active scene is the same scene: no re-query.
    const cur = controller.state.scene;
    if (
      cur &&
      (trigger === 'marker-select' || trigger === 'camera-move') &&
      haversineKm(cur, { lat, lon }) < (trigger === 'camera-move' ? 3 : 0.5)
    )
      return null;
    const radius = Number.isFinite(Number(detail.radius ?? detail.radius_km))
      ? Number(detail.radius ?? detail.radius_km)
      : null;
    const timeWindow =
      detail.timeWindow ||
      (Number.isFinite(Number(detail.windowHours))
        ? {
            windowHours: Number(detail.windowHours),
            windowStart: detail.windowStart || null,
            windowEnd: detail.windowEnd || null,
            strictCaptureTime: Boolean(detail.strictCaptureTime),
          }
        : null);
    const strictBounds = Boolean(detail.strictBounds);
    const scene = {
      lat,
      lon,
      placeName,
      bbox: Array.isArray(detail.bbox) ? detail.bbox : null,
      label: detail.text || placeName,
      ...(radius ? { radius } : {}),
      ...(timeWindow ? { timeWindow } : {}),
      ...(strictBounds ? { strictBounds: true } : {}),
    };
    scene.locationId = detail.locationId || locationIdFor(scene);
    triggers.push({
      utc: new Date().toISOString(),
      trigger,
      locationId: scene.locationId,
    });
    return controller.open(scene, {
      trigger,
      force: Boolean(detail.force),
      standby: Boolean(detail.standby),
      radius,
      timeWindow,
      strictBounds,
    });
  }

  const onPromptStart = (sceneInfo = null) => {
    promptDerivedActive = true;
    if (sceneInfo) {
      void controller.open(sceneInfo, {
        trigger: 'prompt-derived',
        standby: true,
        force: true,
      });
    } else {
      controller.close();
    }
  };
  const onEvidence = (e) => {
    const detail = e?.detail || {};
    if (detail.promptDerived) {
      const lat = Number.isFinite(detail?.lat)
        ? detail.lat
        : detail?.anchor?.lat;
      const lon = Number.isFinite(detail?.lon)
        ? detail.lon
        : detail?.anchor?.lon;
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        resolveIncidentGate('', { lat, lon }).allowed
      ) {
        const rawPlace = String(detail.place || detail.placeName || '')
          .trim()
          .slice(0, 80);
        const placeName =
          (
            narrowestPlace([
              findPlaceByName(detail.text),
              findPlaceByName(rawPlace),
            ]) || placeForPoint(lat, lon)
          )?.names?.[0] ||
          rawPlace ||
          null;
        const scene = {
          lat,
          lon,
          placeName,
          bbox: Array.isArray(detail.bbox) ? detail.bbox : null,
          label: detail.text || placeName,
          locationId:
            detail.locationId || locationIdFor({ lat, lon, placeName }),
          radius: 1,
          strictBounds: true,
          timeWindow:
            detail.timeMode === 'historical'
              ? {
                  windowStart: detail.windowStart,
                  windowEnd: detail.windowEnd,
                  strictCaptureTime: true,
                }
              : {
                  windowHours: Number(detail.windowHours) || 1,
                  strictCaptureTime: true,
                },
        };
        onPromptStart(scene);
        return;
      }
      onPromptStart();
      return;
    }
    if (!promptDerivedActive)
      void open(detail, detail?.preferCache ? 'scene-reopen' : 'scene-open');
  };
  const onExplicit = (e) => {
    // Keep this explicit scope protected from later marker/camera-triggered queries.
    promptDerivedActive = true;
    const detail = e?.detail || {};
    void open(
      { ...detail, force: true, standby: false },
      detail.trigger || 'explicit',
    );
  };
  const onExternal = () => {
    promptDerivedActive = true;
    controller.close();
  };
  win?.addEventListener?.('gev:scene-evidence', onEvidence);
  win?.addEventListener?.(SCENE_FOOTAGE_EVENT, onExplicit);
  win?.addEventListener?.('gev:incident-external', onExternal);
  const onPromptEvent = () => onPromptStart();
  win?.addEventListener?.('gev:incident-command-started', onPromptEvent);
  win?.addEventListener?.('gev:incident-command-cancelled', onPromptEvent);

  let handler = null,
    removeMoveEnd = null,
    moveTimer = null;
  try {
    if (viewer?.scene?.canvas) {
      handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((m) => {
        const picked = viewer.scene.pick(m.position);
        const entity = picked?.id;
        const eid = String(entity?.id ?? '');
        // Map markers only: incident markers, the scene anchor, evidence pins.
        if (!/^(incident:|geographic-scene-anchor$|sev-)/.test(eid)) return;
        const pos = entity?.position?.getValue?.(
          viewer.clock?.currentTime || Cesium.JulianDate.now(),
        );
        if (!pos) return;
        const c = Cesium.Cartographic.fromCartesian(pos);
        const label = entity?.label?.text?.getValue?.() || entity?.name || '';
        void open(
          {
            lat: Cesium.Math.toDegrees(c.latitude),
            lon: Cesium.Math.toDegrees(c.longitude),
            placeName: '',
            text: label,
          },
          'marker-select',
        );
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      removeMoveEnd = viewer.camera.moveEnd.addEventListener(() => {
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => {
          try {
            const height = viewer.camera.positionCartographic?.height;
            if (!(height <= CAMERA_TRIGGER_MAX_HEIGHT_M)) return;
            const canvas = viewer.scene.canvas;
            const ray = viewer.camera.getPickRay(
              new Cesium.Cartesian2(
                canvas.clientWidth / 2,
                canvas.clientHeight / 2,
              ),
            );
            const hit = ray && viewer.scene.globe.pick(ray, viewer.scene);
            if (!hit) return;
            const c = Cesium.Cartographic.fromCartesian(hit);
            const lat = Cesium.Math.toDegrees(c.latitude),
              lon = Cesium.Math.toDegrees(c.longitude);
            const place = placeForPoint(lat, lon);
            if (!place || `snap-${place.id}` === controller.state.locationId)
              return;
            void open({ lat, lon, placeName: place.names[0] }, 'camera-move');
          } catch {
            /* camera busy */
          }
        }, 1800);
      });
    }
  } catch {
    handler = null;
  }

  const api = {
    controller,
    panel,
    open: (d, t = 'api') => open(d, t),
    discover: (opts = {}) => {
      const s = controller.state.scene;
      if (!s) return null;
      promptDerivedActive = true;
      return open(
        {
          ...s,
          ...opts,
          force: true,
          standby: false,
        },
        opts.trigger || 'explicit',
      );
    },
    getState: () => {
      const s = controller.state;
      return {
        phase: s.phase,
        scene: s.scene,
        promptDerivedSuppressed: promptDerivedActive,
        standby: Boolean(s.standby),
        locationId: s.locationId,
        generation: s.generation,
        selectedId: s.selectedId,
        clipIds: s.clips.map((c) => c.id),
        clips: s.clips,
        coverageLevel: s.coverageLevel,
        coverageLabel: s.coverageLabel,
        expanded: s.expanded,
        retrievalTime: s.retrievalTime,
        lastCheckedAt: s.lastCheckedAt,
        refreshMs: s.refreshMs,
        minRefreshMs: s.minRefreshMs,
        refreshCount: s.refreshCount,
        paused: s.paused,
        error: s.error,
        message: s.message,
        trigger: s.trigger,
        ladder: s.ladder,
        trace: s.trace,
        requestId: s.requestId,
        triggers: triggers.slice(-30),
        discarded: s.history.filter((h) => h.discarded).length,
        accounting: s.accounting,
        capabilities: s.capabilities,
        bounds: s.bounds,
      };
    },
    destroy() {
      win?.removeEventListener?.('gev:scene-evidence', onEvidence);
      win?.removeEventListener?.(SCENE_FOOTAGE_EVENT, onExplicit);
      win?.removeEventListener?.('gev:incident-external', onExternal);
      win?.removeEventListener?.('gev:incident-command-started', onPromptEvent);
      win?.removeEventListener?.(
        'gev:incident-command-cancelled',
        onPromptEvent,
      );
      handler?.destroy?.();
      removeMoveEnd?.();
      clearTimeout(moveTimer);
      controller.destroy();
      panel.destroy();
      if (win && win.__gevSceneFootage === api) delete win.__gevSceneFootage;
    },
  };
  if (win) win.__gevSceneFootage = api;
  if (signal?.aborted) api.destroy();
  else signal?.addEventListener?.('abort', () => api.destroy(), { once: true });
  return api;
}
