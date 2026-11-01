/**
 * Playback Controller for the Cesium Cinematic Scene Runtime.
 * Authoritative over Cesium Clock, handles play/pause/seek/speed/live modes,
 * camera follow binding, duration extension, beat selection, and deterministic time tracking.
 */
import * as Cesium from 'cesium';

/**
 * Creates a Playback Controller.
 *
 * @param {object} options
 * @param {Cesium.Viewer} [options.viewer]
 * @param {Function} [options.onChange] Callback on state change: (state) => void
 * @param {Function} [options.entityGetter] (id) => Cesium.Entity|null
 */
export function createPlaybackController({
  viewer,
  onChange,
  entityGetter,
} = {}) {
  const clock = viewer?.clock || new Cesium.Clock();

  let stateValue = 'paused';
  let currentSpeed = 1.0;
  let currentCameraMode = 'cinematic'; // 'cinematic' | 'follow' | 'free'
  let followEntityId = null;
  let isLive = false;
  let currentScene = null;
  let customEntityGetter = entityGetter;

  // Configure initial clock state
  clock.clockRange = Cesium.ClockRange.CLAMPED;
  clock.multiplier = currentSpeed;
  clock.shouldAnimate = false;

  function notifyChange() {
    if (typeof onChange === 'function') {
      try {
        onChange(state());
      } catch (err) {
        console.error('[playbackController] onChange error:', err);
      }
    }
  }

  function durationSec() {
    if (!clock.startTime || !clock.stopTime) return 0;
    return Math.max(
      0,
      Cesium.JulianDate.secondsDifference(clock.stopTime, clock.startTime),
    );
  }

  function positionSec() {
    if (!clock.startTime || !clock.currentTime) return 0;
    const diff = Cesium.JulianDate.secondsDifference(
      clock.currentTime,
      clock.startTime,
    );
    return Math.max(0, Math.min(diff, durationSec()));
  }

  function state() {
    return {
      state: stateValue,
      positionSec: positionSec(),
      durationSec: durationSec(),
      speed: currentSpeed,
      cameraMode: currentCameraMode,
      followEntityId,
      live: isLive,
    };
  }

  function load(scene, { entityGetter: eg } = {}) {
    if (eg) customEntityGetter = eg;
    if (!scene) return;

    const isSameScene = currentScene && currentScene.sceneId === scene.sceneId;
    const prevSec = isSameScene ? positionSec() : 0;

    let startTime;
    if (scene.provenance?.generatedAt) {
      try {
        startTime = Cesium.JulianDate.fromIso8601(scene.provenance.generatedAt);
      } catch {
        startTime = Cesium.JulianDate.fromIso8601('2026-01-01T00:00:00Z');
      }
    } else {
      startTime = Cesium.JulianDate.fromIso8601('2026-01-01T00:00:00Z');
    }

    const duration = Math.max(1, scene.timeline?.durationSec ?? 60);
    const stopTime = Cesium.JulianDate.addSeconds(
      startTime,
      duration,
      new Cesium.JulianDate(),
    );

    clock.startTime = startTime;
    clock.stopTime = stopTime;
    clock.clockRange = Cesium.ClockRange.CLAMPED;
    clock.multiplier = currentSpeed;

    if (isSameScene) {
      // Keep previous position across version updates
      seek(prevSec);
    } else {
      clock.currentTime = Cesium.JulianDate.clone(startTime);
      clock.shouldAnimate = false;
      stateValue = 'paused';
    }

    currentScene = scene;
    notifyChange();
  }

  function play() {
    clock.shouldAnimate = true;
    stateValue = 'playing';
    notifyChange();
  }

  function pause() {
    clock.shouldAnimate = false;
    stateValue = 'paused';
    notifyChange();
  }

  function resume() {
    play();
  }

  function seek(sec) {
    if (!clock.startTime) return;
    const clampedSec = Math.max(0, Math.min(sec, durationSec()));
    clock.currentTime = Cesium.JulianDate.addSeconds(
      clock.startTime,
      clampedSec,
      new Cesium.JulianDate(),
    );
    notifyChange();
  }

  function restart() {
    seek(0);
    play();
  }

  function setSpeed(speed) {
    const s = Math.max(0.1, Math.min(10, speed));
    currentSpeed = s;
    clock.multiplier = s;
    notifyChange();
  }

  function follow(entityId) {
    followEntityId = entityId;
    currentCameraMode = 'follow';

    if (viewer && typeof customEntityGetter === 'function') {
      const ent = customEntityGetter(entityId);
      if (ent) {
        viewer.trackedEntity = ent;
      }
    }
    notifyChange();
  }

  function returnToCinematic() {
    if (viewer) {
      viewer.trackedEntity = undefined;
    }
    followEntityId = null;
    currentCameraMode = 'cinematic';
    notifyChange();
  }

  function setCameraMode(mode, { entityId = null } = {}) {
    if (mode === 'follow' && entityId) {
      follow(entityId);
    } else if (mode === 'cinematic') {
      returnToCinematic();
    } else if (mode === 'free') {
      if (viewer) viewer.trackedEntity = undefined;
      followEntityId = null;
      currentCameraMode = 'free';
      notifyChange();
    }
  }

  function selectEvent(beatIndexOrSec) {
    if (typeof beatIndexOrSec === 'number') {
      if (
        currentScene?.timeline?.beats &&
        Number.isInteger(beatIndexOrSec) &&
        beatIndexOrSec >= 0 &&
        beatIndexOrSec < currentScene.timeline.beats.length
      ) {
        const beat = currentScene.timeline.beats[beatIndexOrSec];
        if (typeof beat.atSec === 'number') {
          seek(beat.atSec);
          return;
        }
      }
      seek(beatIndexOrSec);
    }
  }

  function setLive(bool) {
    isLive = Boolean(bool);
    if (isLive) {
      // In live mode, clock currentTime moves to now/stopTime
      clock.shouldAnimate = true;
      stateValue = 'playing';
    }
    notifyChange();
  }

  function extendDuration(sec) {
    const currentDur = durationSec();
    if (sec > currentDur) {
      clock.stopTime = Cesium.JulianDate.addSeconds(
        clock.startTime,
        sec,
        new Cesium.JulianDate(),
      );
      notifyChange();
    }
  }

  function onTick(callback) {
    if (!clock.onTick?.addEventListener) {
      return () => {};
    }

    const listener = (c) => {
      // Check clamped end
      if (
        clock.clockRange === Cesium.ClockRange.CLAMPED &&
        positionSec() >= durationSec() &&
        stateValue === 'playing'
      ) {
        stateValue = 'paused';
        clock.shouldAnimate = false;
        notifyChange();
      }

      callback({
        sec: positionSec(),
        julian: c?.currentTime || clock.currentTime,
      });
    };

    clock.onTick.addEventListener(listener);
    return () => {
      clock.onTick.removeEventListener(listener);
    };
  }

  return {
    load,
    play,
    pause,
    resume,
    restart,
    seek,
    setSpeed,
    positionSec,
    durationSec,
    state,
    setCameraMode,
    follow,
    returnToCinematic,
    selectEvent,
    setLive,
    extendDuration,
    onTick,
    get clock() {
      return clock;
    },
    get cameraMode() {
      return currentCameraMode;
    },
  };
}
