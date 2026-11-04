/**
 * Camera Director for the Cesium Cinematic Scene Runtime.
 * Computes procedural camera poses (aerial, street, orbit, tracking, dolly, pan, tilt, fly_through)
 * in the local ENU frame, applies easing and smooth shot transitions, enforces terrain clearance,
 * guards against NaNs, and handles priority-based interrupts.
 */
import * as Cesium from 'cesium';

function easeLinear(t) {
  return t;
}

function easeIn(t) {
  return t * t;
}

function easeOut(t) {
  return t * (2 - t);
}

function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

function getEasing(name) {
  switch (name) {
    case 'ease_in':
      return easeIn;
    case 'ease_out':
      return easeOut;
    case 'ease_in_out':
      return easeInOut;
    case 'linear':
    default:
      return easeLinear;
  }
}

/**
 * Creates a Camera Director.
 *
 * @param {object} options
 * @param {Cesium.Viewer} [options.viewer]
 * @param {object} [options.context] GeoSceneContext
 * @param {object} [options.runtime] SceneRuntime
 * @param {object} [options.playback] PlaybackController
 * @param {Function} [options.onShotChanged]
 */
export function createCameraDirector({
  viewer,
  context,
  runtime,
  playback,
  onShotChanged,
} = {}) {
  let enabled = true;
  /** @type {Array<object>} */
  let shotsList = [];
  let lastGoodPose = null;
  let lastShotId = null;

  /** @type {{shot: object, reason: string, priority: number, startedAt: number}|null} */
  let activeInterrupt = null;
  /** @type {Array<{shot: object, reason: string, priority: number}>} */
  const interruptQueue = [];

  function setShots(shots = []) {
    shotsList = [...shots].sort(
      (a, b) => (a.startSec ?? 0) - (b.startSec ?? 0),
    );
  }

  function currentShot(sec = 0) {
    if (activeInterrupt) {
      const interruptDuration = activeInterrupt.shot.durationSec ?? 8;
      if (sec < activeInterrupt.startedAt + interruptDuration) {
        return activeInterrupt.shot;
      }
      // Interrupt expired
      activeInterrupt = null;
    }

    if (!shotsList.length) return null;

    let match = shotsList[0];
    for (let i = 0; i < shotsList.length; i++) {
      if ((shotsList[i].startSec ?? 0) <= sec) {
        match = shotsList[i];
      } else {
        break;
      }
    }
    return match;
  }

  function getFocusPoint(shot, subjectPositions = []) {
    if (subjectPositions.length > 0) {
      let sumEast = 0;
      let sumNorth = 0;
      let sumHeight = 0;
      let count = 0;

      for (const pos of subjectPositions) {
        if (!pos) continue;
        let local;
        if (typeof pos.eastM === 'number' && typeof pos.northM === 'number') {
          local = pos;
        } else if (context?.cartesianToLocal) {
          local = context.cartesianToLocal(pos);
        } else {
          local = {
            eastM: pos.x || 0,
            northM: pos.y || 0,
            heightM: pos.z || 0,
          };
        }
        sumEast += local.eastM ?? 0;
        sumNorth += local.northM ?? 0;
        sumHeight += local.heightM ?? 0;
        count++;
      }

      if (count > 0) {
        return {
          eastM: sumEast / count,
          northM: sumNorth / count,
          heightM: sumHeight / count,
        };
      }
    }

    if (shot.focus) {
      return {
        eastM: shot.focus.eastM ?? 0,
        northM: shot.focus.northM ?? 0,
        heightM: shot.focus.heightM ?? 0,
      };
    }

    return { eastM: 0, northM: 0, heightM: 0 };
  }

  function poseForShot(shot, sec = 0, { subjectPositions = [] } = {}) {
    if (!shot) {
      if (lastGoodPose) return lastGoodPose;
      const defPos = context
        ? context.localToCartesian({ eastM: 0, northM: -500, heightM: 300 })
        : new Cesium.Cartesian3(0, -500, 300);
      return {
        position: defPos,
        heading: 0,
        pitch: Cesium.Math.toRadians(-45),
        roll: 0,
      };
    }

    const startSec = shot.startSec ?? 0;
    const duration = Math.max(0.1, shot.durationSec ?? 5);
    const elapsed = Math.max(0, sec - startSec);
    const rawT = Math.min(1.0, Math.max(0.0, elapsed / duration));
    const easeFn = getEasing(shot.easing);
    const t = easeFn(rawT);

    const focus = getFocusPoint(shot, subjectPositions);

    let distanceM = shot.distanceM;
    let pitchDeg = shot.pitchDeg;
    let headingDeg = shot.headingDeg ?? 0;
    const rollDeg = shot.rollDeg ?? 0;

    switch (shot.type) {
      case 'aerial_establishing':
        distanceM = distanceM ?? 1200;
        pitchDeg = pitchDeg ?? -65;
        if (shot.headingDeltaDeg) headingDeg += shot.headingDeltaDeg * t;
        break;

      case 'overhead_intelligence':
        distanceM = distanceM ?? 800;
        pitchDeg = pitchDeg ?? -75;
        if (shot.headingDeltaDeg) headingDeg += shot.headingDeltaDeg * t;
        break;

      case 'street_level':
        distanceM = distanceM ?? 20;
        pitchDeg = pitchDeg ?? -5;
        focus.heightM = (focus.heightM || 0) + 2.5; // Street level eye line
        break;

      case 'orbit':
        distanceM = distanceM ?? 150;
        pitchDeg = pitchDeg ?? -30;
        headingDeg += (shot.headingDeltaDeg ?? 360) * t;
        break;

      case 'tracking':
      case 'vehicle_follow': {
        distanceM = distanceM ?? 30;
        pitchDeg = pitchDeg ?? -20;
        // Place behind the subject
        if (subjectPositions.length > 1) {
          // Derive direction from positions
          const p1 = subjectPositions[0];
          const p2 = subjectPositions[1];
          const dx = (p2.x || p2.eastM || 0) - (p1.x || p1.eastM || 0);
          const dy = (p2.y || p2.northM || 0) - (p1.y || p1.northM || 0);
          if (Math.hypot(dx, dy) > 0.01) {
            headingDeg = Cesium.Math.toDegrees(Math.atan2(dx, dy));
          }
        }
        break;
      }

      case 'dolly':
        distanceM = (distanceM ?? 60) * (1.5 - 0.5 * t);
        pitchDeg = pitchDeg ?? -15;
        break;

      case 'pan':
        distanceM = distanceM ?? 60;
        pitchDeg = pitchDeg ?? -15;
        headingDeg += (shot.headingDeltaDeg ?? 60) * t;
        break;

      case 'tilt':
        distanceM = distanceM ?? 60;
        pitchDeg = (pitchDeg ?? -45) + (shot.pitchDeltaDeg ?? 30) * t;
        break;

      case 'close_up':
        distanceM = distanceM ?? 8;
        pitchDeg = pitchDeg ?? -10;
        break;

      case 'fly_through':
        distanceM = distanceM ?? 80;
        pitchDeg = pitchDeg ?? -20;
        if (shot.headingDeltaDeg) headingDeg += shot.headingDeltaDeg * t;
        break;

      default:
        distanceM = distanceM ?? 100;
        pitchDeg = pitchDeg ?? -30;
        break;
    }

    // Clamp pitch between -89.9 and 10 deg
    pitchDeg = Math.max(-89.9, Math.min(10, pitchDeg));

    const headingRad = Cesium.Math.toRadians(headingDeg);
    const pitchRad = Cesium.Math.toRadians(pitchDeg);
    const rollRad = Cesium.Math.toRadians(rollDeg);

    // Compute camera offset from focus
    // Pitch is negative looking down; camera sits above focus by dist * sin(-pitch)
    const absPitch = Math.abs(pitchRad);
    const horizDist = distanceM * Math.cos(absPitch);
    const vertDist = distanceM * Math.sin(absPitch);

    // Camera is positioned behind the view direction
    const camEastM = focus.eastM - horizDist * Math.sin(headingRad);
    const camNorthM = focus.northM - horizDist * Math.cos(headingRad);
    let camHeightM = focus.heightM + vertDist;

    // Terrain clipping check: camera height >= groundHeightAt(local) + 5
    if (context?.groundHeightAt) {
      const groundH = context.groundHeightAt({
        eastM: camEastM,
        northM: camNorthM,
      });
      if (camHeightM < groundH + 5) {
        camHeightM = groundH + 5;
      }
    }

    let position;
    if (context?.localToCartesian) {
      position = context.localToCartesian({
        eastM: camEastM,
        northM: camNorthM,
        heightM: camHeightM,
      });
    } else {
      position = new Cesium.Cartesian3(camEastM, camNorthM, camHeightM);
    }

    const headingClamped = Cesium.Math.zeroToTwoPi(headingRad);

    // NaN guard
    const isBad =
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(position.z) ||
      !Number.isFinite(headingClamped) ||
      !Number.isFinite(pitchRad) ||
      !Number.isFinite(rollRad);

    if (isBad) {
      if (lastGoodPose) return lastGoodPose;
      return {
        position: Cesium.Cartesian3.ZERO,
        heading: 0,
        pitch: -Math.PI / 4,
        roll: 0,
      };
    }

    const pose = {
      position,
      heading: headingClamped,
      pitch: pitchRad,
      roll: rollRad,
    };

    lastGoodPose = pose;
    return pose;
  }

  function getBlendedPose(sec = 0, { subjectPositions = [] } = {}) {
    const shot = currentShot(sec);
    if (!shot) return poseForShot(null, sec);

    // Find previous shot for transition blending
    const shotIdx = shotsList.findIndex((s) => s.id === shot.id);
    if (shotIdx > 0) {
      const prevShot = shotsList[shotIdx - 1];
      const transitionDuration = Math.min(2.0, (shot.durationSec ?? 5) * 0.25);
      const timeInShot = sec - (shot.startSec ?? 0);

      if (
        timeInShot < transitionDuration &&
        timeInShot >= 0 &&
        transitionDuration > 0.01
      ) {
        const blendT = easeInOut(timeInShot / transitionDuration);
        const prevPose = poseForShot(prevShot, sec, { subjectPositions });
        const currPose = poseForShot(shot, sec, { subjectPositions });

        // Interpolate position and angles
        const lerpPos = Cesium.Cartesian3.lerp(
          prevPose.position,
          currPose.position,
          blendT,
          new Cesium.Cartesian3(),
        );

        // Interpolate angles
        let dHeading = currPose.heading - prevPose.heading;
        if (dHeading > Math.PI) dHeading -= 2 * Math.PI;
        else if (dHeading < -Math.PI) dHeading += 2 * Math.PI;
        const lerpHeading = Cesium.Math.zeroToTwoPi(
          prevPose.heading + dHeading * blendT,
        );

        const lerpPitch =
          prevPose.pitch + (currPose.pitch - prevPose.pitch) * blendT;
        const lerpRoll =
          prevPose.roll + (currPose.roll - prevPose.roll) * blendT;

        return {
          position: lerpPos,
          heading: lerpHeading,
          pitch: lerpPitch,
          roll: lerpRoll,
        };
      }
    }

    return poseForShot(shot, sec, { subjectPositions });
  }

  function interrupt(shot, { reason = 'intelligence', priority = 50 } = {}) {
    // Compare against the shot that is ACTUALLY on screen at the current
    // playback position (not the first scheduled shot at t=0), so a user /
    // Q&A / live-intelligence request is scored against what it would
    // replace. A paused or finished timeline has nothing to protect.
    const nowSec = playback?.positionSec?.() ?? 0;
    const curr = currentShot(nowSec);
    const currPriority = curr?.priority ?? 50;
    const isInterruptible = curr?.interruptible !== false;
    // Without a playback controller (pure tests) the timeline counts as live.
    const playing = playback?.state
      ? playback.state()?.state === 'playing'
      : true;
    const scheduledHasEnded =
      !activeInterrupt &&
      curr &&
      nowSec >= (curr.startSec ?? 0) + (curr.durationSec ?? 0);
    // An ACTIVE interrupt keeps its priority even while paused; only a
    // scheduled timeline shot yields when playback is paused or finished.
    const protectedShot = activeInterrupt
      ? true
      : playing && !scheduledHasEnded;

    if (
      curr &&
      protectedShot &&
      (!isInterruptible || priority < currPriority)
    ) {
      interruptQueue.push({ shot, reason, priority });
      return {
        accepted: false,
        queued: true,
        reason: !isInterruptible
          ? `current shot ${curr.id} is not interruptible`
          : `priority ${priority} < current shot priority ${currPriority}`,
      };
    }

    activeInterrupt = {
      shot,
      reason,
      priority,
      startedAt: nowSec,
    };

    if (typeof onShotChanged === 'function') {
      try {
        onShotChanged({ shot, at: activeInterrupt.startedAt, reason });
      } catch (err) {
        console.error('[cameraDirector] onShotChanged error:', err);
      }
    }
    // A paused viewer in requestRenderMode would otherwise show the new shot
    // only on the next user interaction.
    try {
      tick(nowSec);
      viewer?.scene?.requestRender?.();
    } catch {}

    return { accepted: true, queued: false };
  }

  function release() {
    activeInterrupt = null;
    if (interruptQueue.length > 0) {
      const next = interruptQueue.shift();
      return interrupt(next.shot, {
        reason: next.reason,
        priority: next.priority,
      });
    }
    const sec = playback?.positionSec?.() ?? 0;
    const shot = currentShot(sec);
    if (typeof onShotChanged === 'function' && shot) {
      try {
        onShotChanged({ shot, at: sec, reason: 'release' });
      } catch (err) {
        console.error('[cameraDirector] onShotChanged error:', err);
      }
    }
    return { released: true };
  }

  function tick(sec = 0) {
    if (!enabled) return;
    if (playback?.cameraMode && playback.cameraMode !== 'cinematic') return;

    const shot = currentShot(sec);
    if (shot && shot.id !== lastShotId) {
      lastShotId = shot.id;
      if (typeof onShotChanged === 'function') {
        try {
          onShotChanged({ shot, at: sec, reason: 'shot_boundary' });
        } catch (err) {
          console.error('[cameraDirector] onShotChanged error:', err);
        }
      }
    }

    let subjectPositions = [];
    if (shot?.subjectIds?.length && typeof runtime?.positionAt === 'function') {
      subjectPositions = shot.subjectIds
        .map((id) => runtime.positionAt(id, sec))
        .filter(Boolean);
    }

    const pose = getBlendedPose(sec, { subjectPositions });

    if (viewer?.camera?.setView) {
      try {
        viewer.camera.setView({
          destination: pose.position,
          orientation: {
            heading: pose.heading,
            pitch: pose.pitch,
            roll: pose.roll,
          },
        });
      } catch (err) {
        console.error('[cameraDirector] camera.setView error:', err);
      }
    }
  }

  return {
    setShots,
    currentShot,
    enable: (val) => {
      enabled = Boolean(val);
    },
    isEnabled: () => enabled,
    poseForShot,
    getBlendedPose,
    interrupt,
    release,
    tick,
  };
}
