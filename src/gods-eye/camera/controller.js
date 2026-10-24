/**
 * Camera controller for stage ladder transitions S0..S4.
 * Injected Cesium + viewer for node:test compatibility.
 */

import { LADDER, stageForAltitude } from './ladder.js';

export function createCameraController({
  viewer,
  Cesium,
  reducedMotion = false,
  dispatch,
  now = () => Date.now(),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  minAglM = 60,
  // 2D recovery (no WebGL): each waypoint is handed to this callback (the
  // workstation's raster map zooms to it) and the S0→S4 ladder still runs.
  fallbackFly = null,
} = {}) {
  const has3d = () => Boolean(viewer?.camera && Cesium?.Cartesian3);
  let currentStageName = null;
  let activeTimer = null;
  let activeCancelFlight = null;
  let abortController = null;

  function doDispatch(stage, waypoint, sceneId) {
    currentStageName = stage;
    if (typeof dispatch === 'function') {
      dispatch(stage, waypoint);
    } else if (
      typeof window !== 'undefined' &&
      typeof window.CustomEvent === 'function'
    ) {
      window.dispatchEvent(
        new CustomEvent('gev:scene-stage', {
          detail: {
            sceneId,
            stage,
            revealLayers: waypoint?.revealLayers || [],
          },
        }),
      );
    }
  }

  function getCameraAltitude() {
    try {
      if (viewer?.camera?.positionCartographic?.height !== undefined) {
        return viewer.camera.positionCartographic.height;
      }
      const carto = Cesium?.Cartographic?.fromCartesian?.(
        viewer?.camera?.position,
      );
      if (typeof carto?.height === 'number') return carto.height;
    } catch {}
    return null;
  }

  function cancel() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    if (activeTimer) {
      clearTimeoutImpl(activeTimer);
      activeTimer = null;
    }
    if (activeCancelFlight) {
      activeCancelFlight();
      activeCancelFlight = null;
    }
    try {
      viewer?.camera?.cancelFlight?.();
    } catch {}
  }

  function setStage(stage, path = [], { camera: cam = null } = {}) {
    const found = Array.isArray(path)
      ? path.find((w) => w.stage === stage)
      : null;
    const wp = cam ? { ...(found || {}), ...cam, stage } : found;
    if (!wp || !Number.isFinite(wp.lat) || !Number.isFinite(wp.lon)) return;
    cancel();
    if (!has3d()) {
      try {
        fallbackFly?.(wp);
      } catch {}
      doDispatch(wp.stage, wp);
      return;
    }
    const destination = Cesium.Cartesian3.fromDegrees(
      wp.lon,
      wp.lat,
      wp.alt ?? 300,
    );
    const orientation = {
      heading: Cesium.Math.toRadians(wp.heading ?? 0),
      pitch: Cesium.Math.toRadians(wp.pitch ?? -30),
      roll: 0,
    };
    viewer.camera.setView({ destination, orientation });
    doDispatch(wp.stage, wp);
  }

  async function guardS4(wp, alt) {
    let res = alt;
    try {
      if (Cesium?.sampleTerrainMostDetailed && viewer?.terrainProvider) {
        const carto = [Cesium.Cartographic.fromDegrees(wp.lon, wp.lat)];
        let tid = null;
        const p1 = Cesium.sampleTerrainMostDetailed(
          viewer.terrainProvider,
          carto,
        );
        const p2 = new Promise((_, rej) => {
          tid = setTimeoutImpl(() => rej(new Error('timeout')), 1500);
        });
        await Promise.race([p1, p2]).finally(
          () => tid && clearTimeoutImpl(tid),
        );
        if (typeof carto[0]?.height === 'number')
          res = Math.max(res, carto[0].height + minAglM);
      }
    } catch {}
    try {
      const h = Cesium?.Cartographic?.fromCartesian?.(
        viewer?.scene?.clampToHeight?.(
          Cesium.Cartesian3.fromDegrees(wp.lon, wp.lat),
        ),
      )?.height;
      if (typeof h === 'number') res = Math.max(res, h + minAglM);
    } catch {}
    return res;
  }

  /**
   * Cesium's `camera.flyTo` advances only on rendered frames. The workstation
   * runs the globe in requestRenderMode (idle governor) and may have switched
   * the default render loop OFF for 2D recovery; both leave a flight parked at
   * its first frame until the watchdog snaps it. For the duration of a scene
   * flight the loop is forced ON and the scene is rendered continuously, then
   * both are restored exactly as found.
   */
  function withContinuousRender() {
    if (!has3d()) return () => {};
    const scene = viewer.scene;
    const prevLoop = viewer.useDefaultRenderLoop;
    const prevMode = scene?.requestRenderMode;
    try {
      viewer.useDefaultRenderLoop = true;
      if (scene && prevMode !== undefined) scene.requestRenderMode = false;
      scene?.requestRender?.();
    } catch {}
    return () => {
      try {
        if (scene && prevMode !== undefined) scene.requestRenderMode = prevMode;
        // Only restore an OFF loop when the page is really in 2D recovery;
        // a flight that finished while 3D is live keeps the globe rendering.
        const recovery =
          typeof document !== 'undefined' &&
          document?.documentElement?.dataset?.renderState === 'fallback';
        if (prevLoop === false && recovery) viewer.useDefaultRenderLoop = false;
        scene?.requestRender?.();
      } catch {}
    };
  }

  async function flyScenePath(path, { signal, sceneId } = {}) {
    cancel();
    const ac = new AbortController();
    abortController = ac;
    const isAborted = () => signal?.aborted || ac.signal.aborted;
    const restoreRender = withContinuousRender();

    const waitMs = (ms) =>
      new Promise((resolve) => {
        if (isAborted()) return resolve(false);
        activeTimer = setTimeoutImpl(() => {
          activeTimer = null;
          resolve(!isAborted());
        }, ms);
      });

    if (signal?.aborted) return 'aborted';
    const onAbort = () => cancel();
    signal?.addEventListener?.('abort', onAbort, { once: true });

    try {
      for (const wp of path) {
        if (isAborted()) return 'aborted';
        if (!has3d()) {
          try {
            fallbackFly?.(wp);
          } catch {}
          doDispatch(wp.stage, wp, sceneId);
          if (wp.stage === 'S4') return 'arrived';
          if (!(await waitMs(reducedMotion ? 150 : 900)) || isAborted())
            return 'aborted';
          continue;
        }
        const targetAlt =
          wp.stage === 'S4' ? await guardS4(wp, wp.alt) : wp.alt;
        const destination = Cesium.Cartesian3.fromDegrees(
          wp.lon,
          wp.lat,
          targetAlt,
        );
        const orientation = {
          heading: Cesium.Math.toRadians(wp.heading),
          pitch: Cesium.Math.toRadians(wp.pitch),
          roll: 0,
        };

        if (reducedMotion) {
          viewer.camera.setView({ destination, orientation });
          const de =
            typeof document !== 'undefined' &&
            document?.documentElement?.dataset;
          if (de) de.geFade = '1';
          doDispatch(wp.stage, wp, sceneId);
          if (wp.stage === 'S4') {
            if (de) delete de.geFade;
            return 'arrived';
          }
          const ok = await waitMs(150);
          if (de) delete de.geFade;
          if (!ok || isAborted()) return 'aborted';
        } else {
          try {
            await new Promise((res, rej) => {
              // Watchdog: Cesium only fires `complete` from a rendered frame.
              // A paused render loop (hidden tab, 2D recovery, software GL)
              // must not leave the build stuck in `flying` — snap the camera
              // to the waypoint and continue the ladder instead.
              const durationMs = wp.durationMs || 1000;
              const watchdog = setTimeoutImpl(() => {
                activeCancelFlight = null;
                try {
                  viewer.camera.cancelFlight?.();
                  viewer.camera.setView({ destination, orientation });
                  viewer.scene?.requestRender?.();
                } catch {}
                res(true);
              }, durationMs + 2500);
              const done = (fn) => (v) => {
                clearTimeoutImpl(watchdog);
                activeCancelFlight = null;
                fn(v);
              };
              activeCancelFlight = () => {
                clearTimeoutImpl(watchdog);
                rej(new Error('aborted'));
              };
              try {
                viewer.scene?.requestRender?.();
              } catch {}
              viewer.camera.flyTo({
                destination,
                orientation,
                duration: (wp.durationMs || 1000) / 1000,
                easingFunction: Cesium.EasingFunction?.QUADRATIC_IN_OUT,
                complete: done(() => res(true)),
                cancel: done(() => rej(new Error('cancelled'))),
              });
            });
          } catch {
            return 'aborted';
          }

          if (isAborted()) return 'aborted';
          doDispatch(wp.stage, wp, sceneId);
          if (wp.stage === 'S4') return 'arrived';

          const holdMs =
            wp.holdMs ??
            LADDER.find((l) => l.stage === wp.stage)?.holdMs ??
            1500;
          if (!(await waitMs(holdMs)) || isAborted()) return 'aborted';
        }
      }
      return 'arrived';
    } finally {
      restoreRender();
      signal?.removeEventListener?.('abort', onAbort);
      if (abortController === ac) abortController = null;
    }
  }

  return {
    flyScenePath,
    setStage,
    cancel,
    stageForCurrentAltitude() {
      const alt = getCameraAltitude();
      return alt !== null ? stageForAltitude(alt) : currentStageName || 'S0';
    },
    currentStage() {
      return currentStageName;
    },
  };
}

export function attachAltitudeStageSync({
  viewer,
  Cesium,
  onStage,
  intervalMs = 800,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
} = {}) {
  let lastStage = null;
  const timer = setIntervalImpl(() => {
    try {
      const alt =
        viewer?.camera?.positionCartographic?.height ??
        Cesium?.Cartographic?.fromCartesian?.(viewer?.camera?.position)?.height;
      if (typeof alt === 'number' && !isNaN(alt)) {
        const stage = stageForAltitude(alt);
        if (stage !== lastStage) {
          lastStage = stage;
          if (typeof onStage === 'function') onStage(stage);
        }
      }
    } catch {}
  }, intervalMs);
  return {
    destroy() {
      clearIntervalImpl(timer);
    },
  };
}
