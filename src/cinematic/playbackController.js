/**
 * Playback Controller for the Cesium Cinematic Scene Runtime.
 * Authoritative over Cesium Clock, handles play/pause/seek/speed/live modes,
 * camera follow binding, duration extension, beat selection, and deterministic time tracking.
 */
import * as Cesium from 'cesium';

function checkHasTimeDynamic(scene) {
  if (!scene) return false;
  if (scene.hasTimeDynamic != null) return Boolean(scene.hasTimeDynamic);
  if (Array.isArray(scene.timeline?.beats) && scene.timeline.beats.length > 0) {
    return true;
  }
  if (
    Array.isArray(scene.timeline?.keyframes) &&
    scene.timeline.keyframes.length > 0
  ) {
    return true;
  }
  if (Array.isArray(scene.entities)) {
    return scene.entities.some((e) => {
      if (e.synthesizedPath) return true;
      if (e.behavior?.path && e.behavior.path.length > 0) return true;
      if (
        [
          'walk',
          'run',
          'drive',
          'fly',
          'patrol',
          'crowd_flow',
          'orbit',
        ].includes(e.behavior?.type)
      ) {
        return true;
      }
      return false;
    });
  }
  return false;
}

/**
 * Creates a Playback Controller.
 *
 * @param {object} options
 * @param {Cesium.Viewer} [options.viewer]
 * @param {Function} [options.onChange] Callback on state change: (state) => void
 * @param {Function} [options.entityGetter] (id) => Cesium.Entity|null
 * @param {Function} [options.positionsSnapshotGetter] (sec) => { [id]: {lon,lat} }
 */
export function createPlaybackController({
  viewer,
  onChange,
  entityGetter,
  positionsSnapshotGetter,
} = {}) {
  const clock = viewer?.clock || new Cesium.Clock();

  let stateValue = 'paused';
  let currentSpeed = 1.0;
  let currentCameraMode = 'cinematic'; // 'cinematic' | 'follow' | 'free'
  let followEntityId = null;
  let isLive = false;
  let currentScene = null;
  let customEntityGetter = entityGetter;
  let customPositionsSnapshotGetter = positionsSnapshotGetter;

  // Configure initial clock state
  clock.clockRange = Cesium.ClockRange.LOOP_STOP;
  // Clock ownership guard: Cesium's Viewer resets clock.canAnimate=false on
  // every tick while async entity geometry is pending; undo it while playing so
  // Play never freezes at 0 s (live defect 2026-11-02).
  if (clock.onTick?.addEventListener) {
    clock.onTick.addEventListener(() => {
      if (
        stateValue === 'playing' &&
        'canAnimate' in clock &&
        !clock.canAnimate
      )
        clock.canAnimate = true;
    });
  }
  clock.multiplier = currentSpeed;
  clock.shouldAnimate = false;

  // Always call viewer.scene?.requestRender?.() on clock ticks
  if (clock.onTick?.addEventListener) {
    clock.onTick.addEventListener(() => {
      viewer?.scene?.requestRender?.();
    });
  }

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
    const dur = durationSec();
    return Math.max(0, dur > 0 ? Math.min(diff, dur) : diff);
  }

  function state() {
    const dur = durationSec();
    const pos = positionSec();
    const isEnded = dur > 0 && pos >= dur && stateValue !== 'playing';
    const effectiveState = isEnded ? 'ended' : stateValue;
    return {
      state: effectiveState,
      positionSec: pos,
      durationSec: dur,
      speed: currentSpeed,
      cameraMode: currentCameraMode,
      followEntityId,
      live: isLive,
      hasTimeDynamic: checkHasTimeDynamic(currentScene),
      progress: dur > 0 ? Math.max(0, Math.min(1, pos / dur)) : 0,
    };
  }

  function load(
    scene,
    { entityGetter: eg, positionsSnapshotGetter: psg } = {},
  ) {
    if (eg) customEntityGetter = eg;
    if (psg) customPositionsSnapshotGetter = psg;
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
    clock.clockRange = Cesium.ClockRange.LOOP_STOP;
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
    const dur = durationSec();
    if (dur > 0 && positionSec() >= dur) {
      seek(0);
    }
    // Cesium's DataSourceDisplay pauses the clock (clock.canAnimate=false) while
    // any asynchronous entity geometry is still being built; the cinematic
    // playback owns the clock, so never let background geometry freeze it.
    try {
      if (viewer && 'allowDataSourcesToSuspendAnimation' in viewer)
        viewer.allowDataSourcesToSuspendAnimation = false;
      if ('canAnimate' in clock) clock.canAnimate = true;
    } catch {
      /* fake viewers in tests */
    }
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

  /** Replace the scene reference without touching the clock (streamed updates). */
  function setScene(scene) {
    if (scene) currentScene = scene;
  }

  function positionsSnapshot(sec = positionSec()) {
    if (typeof customPositionsSnapshotGetter === 'function') {
      return customPositionsSnapshotGetter(sec);
    }
    return {};
  }

  function setPositionsSnapshotGetter(fn) {
    customPositionsSnapshotGetter = fn;
  }

  function onTick(callback) {
    if (!clock.onTick?.addEventListener) {
      return () => {};
    }

    const listener = (c) => {
      // In requestRenderMode, ensure frames advance on every tick
      viewer?.scene?.requestRender?.();
      if (
        stateValue === 'playing' &&
        'canAnimate' in clock &&
        !clock.canAnimate
      )
        clock.canAnimate = true;

      // Check clamped end if CLAMPED is active
      if (
        clock.clockRange === Cesium.ClockRange.CLAMPED &&
        positionSec() >= durationSec() &&
        stateValue === 'playing'
      ) {
        stateValue = 'ended';
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
    setScene,
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
    positionsSnapshot,
    setPositionsSnapshotGetter,
    onTick,
    get clock() {
      return clock;
    },
    get cameraMode() {
      return currentCameraMode;
    },
  };
}
