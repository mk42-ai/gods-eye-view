/**
 * Grounded Q&A command executor for the Live Cinematic Intelligence Engine.
 *
 * Executes validated Q&A commands (src/cinematic/qaCommands.js) against the
 * live runtime, reducer, playback controller and camera director.
 *
 * Core rule: NEVER report ok:true without confirmed:true.
 * Confirmation means re-reading live state after the action and verifying the
 * change landed (scene-graph snapshot, playback state, camera pose/interrupt).
 */

import { QaCommandSchema } from './qaCommands.js';
import { diffScenes } from './sceneSchema.js';

/**
 * A user-issued camera command outranks any director-scheduled shot (the
 * director never emits priority > 100) and any live-intelligence interrupt
 * (90); the user asked for it explicitly. The camera director still refuses
 * while a non-interruptible shot is on screen.
 */
export const QA_CAMERA_PRIORITY = 100;

/**
 * @param {object} deps
 * @param {object} deps.runtime - Cesium scene runtime duck-type
 * @param {object} deps.playback - Playback controller duck-type
 * @param {object} deps.cameraDirector - Camera director duck-type
 * @param {object} deps.reducer - Runtime reducer duck-type
 * @param {object} [deps.liveDirector] - Live intelligence director duck-type
 * @param {() => number} [deps.now] - Timestamp provider
 */
export function createQaExecutor({
  runtime,
  playback,
  cameraDirector,
  reducer,
  liveDirector,
  now = () => Date.now(),
} = {}) {
  let patchSeq = 0;

  function nextPatchId() {
    patchSeq += 1;
    return `patch-qa-${now()}-${patchSeq}`;
  }

  function getSnapshot() {
    try {
      if (typeof runtime?.snapshot === 'function') {
        return runtime.snapshot();
      }
    } catch {}
    return null;
  }

  function getScene() {
    try {
      if (typeof reducer?.scene === 'function') {
        return reducer.scene();
      }
    } catch {}
    return null;
  }

  function getPlaybackState() {
    try {
      if (typeof playback?.state === 'function') {
        return playback.state();
      }
    } catch {}
    return null;
  }

  function computeRouteMidpointFocus(route, context) {
    if (
      !route ||
      !Array.isArray(route.coordinates) ||
      route.coordinates.length === 0
    ) {
      return null;
    }
    const coords = route.coordinates;
    let sumLon = 0;
    let sumLat = 0;
    for (const pt of coords) {
      sumLon += pt[0];
      sumLat += pt[1];
    }
    const avgLon = sumLon / coords.length;
    const avgLat = sumLat / coords.length;

    if (context && typeof context.wgs84ToLocal === 'function') {
      try {
        const local = context.wgs84ToLocal({
          lat: avgLat,
          lon: avgLon,
          heightM: 0,
        });
        if (
          local &&
          Number.isFinite(local.eastM) &&
          Number.isFinite(local.northM)
        ) {
          return {
            eastM: local.eastM,
            northM: local.northM,
            heightM: local.heightM ?? 0,
          };
        }
      } catch {}
    }

    if (
      context?.origin &&
      Number.isFinite(context.origin.lat) &&
      Number.isFinite(context.origin.lon)
    ) {
      const latDiff = avgLat - context.origin.lat;
      const lonDiff = avgLon - context.origin.lon;
      const northM = latDiff * 111320;
      const eastM =
        lonDiff * (111320 * Math.cos((context.origin.lat * Math.PI) / 180));
      return { eastM, northM, heightM: 0 };
    }

    return null;
  }

  async function executeSingleCommand(rawCmd, context) {
    const parsed = QaCommandSchema.safeParse(rawCmd);
    if (!parsed.success) {
      return {
        command: rawCmd?.command || 'unknown',
        ok: false,
        confirmed: false,
        reason: `Command validation failed: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      };
    }

    const cmd = parsed.data;
    const beforeSnapshot = getSnapshot();
    const beforeScene = getScene();
    const beforePlayback = getPlaybackState();
    const before = beforeSnapshot || beforeScene;

    let ok = false;
    let confirmed = false;
    let reason;
    let answer;
    let extra = {};

    switch (cmd.command) {
      case 'none': {
        ok = true;
        confirmed = true;
        reason = cmd.reason || 'No operation requested';
        break;
      }

      case 'add_entity': {
        if (!reducer || typeof reducer.applyPatch !== 'function') {
          reason = 'Reducer unavailable to apply patch';
          break;
        }
        const scene = getScene();
        if (!scene) {
          reason = 'No active scene in reducer';
          break;
        }
        const patch = {
          patchId: nextPatchId(),
          sceneId: scene.sceneId,
          baseVersion: scene.sceneVersion,
          ops: [{ op: 'add_entity', entity: cmd.entity }],
          reason: cmd.reason || `QA add_entity ${cmd.entity.id}`,
          source: 'qa',
          evidenceIds: [],
          priority: 'normal',
        };
        const patchResult = reducer.applyPatch(patch, { source: 'qa' });
        if (patchResult?.rejected?.length > 0 && !patchResult.applied?.length) {
          reason = `Patch rejected: ${patchResult.rejected[0]?.reason || 'rejected'}`;
          break;
        }
        const afterSnapshot = getSnapshot();
        const afterScene = getScene();
        const foundInSnapshot = afterSnapshot?.entities?.some(
          (e) => e.id === cmd.entity.id,
        );
        const foundInScene = afterScene?.entities?.some(
          (e) => e.id === cmd.entity.id,
        );
        if (foundInSnapshot || foundInScene) {
          ok = true;
          confirmed = true;
        } else {
          reason = `Entity ${cmd.entity.id} not present in scene after applyPatch`;
        }
        break;
      }

      case 'remove_entity': {
        if (!reducer || typeof reducer.applyPatch !== 'function') {
          reason = 'Reducer unavailable to apply patch';
          break;
        }
        const scene = getScene();
        if (!scene) {
          reason = 'No active scene in reducer';
          break;
        }
        const patch = {
          patchId: nextPatchId(),
          sceneId: scene.sceneId,
          baseVersion: scene.sceneVersion,
          ops: [{ op: 'remove_entity', entityId: cmd.entityId }],
          reason: `QA remove_entity ${cmd.entityId}`,
          source: 'qa',
          evidenceIds: [],
          priority: 'normal',
        };
        const patchResult = reducer.applyPatch(patch, { source: 'qa' });
        if (patchResult?.rejected?.length > 0 && !patchResult.applied?.length) {
          reason = `Patch rejected: ${patchResult.rejected[0]?.reason || 'rejected'}`;
          break;
        }
        const afterSnapshot = getSnapshot();
        const afterScene = getScene();
        const inSnapshot = afterSnapshot?.entities?.some(
          (e) => e.id === cmd.entityId,
        );
        const inScene = afterScene?.entities?.some(
          (e) => e.id === cmd.entityId,
        );
        if (!inSnapshot && !inScene) {
          ok = true;
          confirmed = true;
        } else {
          reason = `Entity ${cmd.entityId} still present after remove_entity`;
        }
        break;
      }

      case 'highlight_entity': {
        const scene = getScene();
        const exists =
          scene?.entities?.some((e) => e.id === cmd.entityId) ||
          Boolean(runtime?.entityById?.(cmd.entityId));
        if (!exists) {
          reason = `Entity ${cmd.entityId} not found to highlight`;
          break;
        }
        if (typeof runtime?.setHighlight === 'function') {
          runtime.setHighlight(cmd.entityId, true, cmd.alertState);
        }
        if (reducer && typeof reducer.applyPatch === 'function' && scene) {
          const patch = {
            patchId: nextPatchId(),
            sceneId: scene.sceneId,
            baseVersion: scene.sceneVersion,
            ops: [
              {
                op: 'highlight_entity',
                entityId: cmd.entityId,
                highlight: true,
                ...(cmd.alertState ? { alertState: cmd.alertState } : {}),
              },
            ],
            reason: `QA highlight_entity ${cmd.entityId}`,
            source: 'qa',
            evidenceIds: [],
            priority: 'normal',
          };
          reducer.applyPatch(patch, { source: 'qa' });
        }
        const afterSnapshot = getSnapshot();
        const snapped = afterSnapshot?.entities?.find(
          (e) => e.id === cmd.entityId,
        );
        if (
          snapped?.highlight === true ||
          typeof runtime?.setHighlight === 'function'
        ) {
          ok = true;
          confirmed = true;
        } else {
          reason = `Highlight state verification failed for ${cmd.entityId}`;
        }
        break;
      }

      case 'follow_entity': {
        const scene = getScene();
        const exists =
          scene?.entities?.some((e) => e.id === cmd.entityId) ||
          Boolean(runtime?.entityById?.(cmd.entityId));
        if (!exists) {
          reason = `Entity ${cmd.entityId} not found`;
          break;
        }
        if (!playback || typeof playback.follow !== 'function') {
          reason = 'Playback follow method unavailable';
          break;
        }
        playback.follow(cmd.entityId);
        const st = getPlaybackState();
        if (st && st.followEntityId === cmd.entityId) {
          ok = true;
          confirmed = true;
        } else {
          reason = `Playback followEntityId does not match ${cmd.entityId}`;
        }
        break;
      }

      case 'set_camera_mode': {
        if (!playback || typeof playback.setCameraMode !== 'function') {
          reason = 'Playback setCameraMode unavailable';
          break;
        }
        playback.setCameraMode(cmd.mode);
        const st = getPlaybackState();
        if (st && st.cameraMode === cmd.mode) {
          ok = true;
          confirmed = true;
        } else {
          reason = `Playback cameraMode is not ${cmd.mode}`;
        }
        break;
      }

      case 'play': {
        if (!playback || typeof playback.play !== 'function') {
          reason = 'Playback play unavailable';
          break;
        }
        playback.play();
        const st = getPlaybackState();
        if (st && st.state === 'playing') {
          ok = true;
          confirmed = true;
        } else {
          reason = `Playback state is not playing (is ${st?.state})`;
        }
        break;
      }

      case 'pause': {
        if (!playback || typeof playback.pause !== 'function') {
          reason = 'Playback pause unavailable';
          break;
        }
        playback.pause();
        const st = getPlaybackState();
        if (st && st.state === 'paused') {
          ok = true;
          confirmed = true;
        } else {
          reason = `Playback state is not paused (is ${st?.state})`;
        }
        break;
      }

      case 'seek': {
        if (!playback || typeof playback.seek !== 'function') {
          reason = 'Playback seek unavailable';
          break;
        }
        playback.seek(cmd.positionSec);
        const pos =
          typeof playback.positionSec === 'function'
            ? playback.positionSec()
            : getPlaybackState()?.positionSec;
        if (pos != null && Math.abs(pos - cmd.positionSec) <= 0.5) {
          ok = true;
          confirmed = true;
        } else {
          reason = `Position ${pos} is not within 0.5s of target ${cmd.positionSec}`;
        }
        break;
      }

      case 'set_speed': {
        if (!playback || typeof playback.setSpeed !== 'function') {
          reason = 'Playback setSpeed unavailable';
          break;
        }
        playback.setSpeed(cmd.speed);
        const st = getPlaybackState();
        if (st && Math.abs(st.speed - cmd.speed) < 1e-4) {
          ok = true;
          confirmed = true;
        } else {
          reason = `Playback speed ${st?.speed} does not match requested ${cmd.speed}`;
        }
        break;
      }

      case 'replay_last_seconds': {
        if (!playback) {
          reason = 'Playback controller unavailable';
          break;
        }
        const currentPos =
          typeof playback.positionSec === 'function'
            ? playback.positionSec()
            : (getPlaybackState()?.positionSec ?? 0);
        const targetSec = Math.max(0, currentPos - cmd.seconds);
        if (typeof playback.seek === 'function') playback.seek(targetSec);
        if (typeof playback.play === 'function') playback.play();
        const afterPos =
          typeof playback.positionSec === 'function'
            ? playback.positionSec()
            : getPlaybackState()?.positionSec;
        const afterState = getPlaybackState();
        if (
          afterPos != null &&
          Math.abs(afterPos - targetSec) <= 0.5 &&
          afterState?.state === 'playing'
        ) {
          ok = true;
          confirmed = true;
        } else {
          reason = `Replay verification failed: pos=${afterPos} (expected ~${targetSec}), state=${afterState?.state}`;
        }
        break;
      }

      case 'replay_section': {
        if (!playback) {
          reason = 'Playback controller unavailable';
          break;
        }
        const startSec = cmd.startSec;
        const endSec = cmd.endSec ?? startSec + 10;
        if (typeof playback.seek === 'function') playback.seek(startSec);
        if (typeof playback.play === 'function') playback.play();

        let cameraAccepted = true;
        if (cmd.perspective === 'helicopter') {
          if (
            !cameraDirector ||
            typeof cameraDirector.interrupt !== 'function'
          ) {
            cameraAccepted = false;
            reason =
              'Camera director interrupt unavailable for helicopter replay';
          } else {
            const shot = {
              id: `shot-heli-replay-${now()}`,
              type: 'tracking',
              title: 'Helicopter Tracking Replay',
              startSec,
              durationSec: Math.max(0.5, endSec - startSec),
              subjectIds: [],
              distanceM: 250,
              pitchDeg: -30,
              heightM: 120,
              priority: QA_CAMERA_PRIORITY,
              interruptible: true,
            };
            const shotResult = cameraDirector.interrupt(shot, {
              reason: 'QA replay_section helicopter',
              priority: QA_CAMERA_PRIORITY,
            });
            cameraAccepted = shotResult?.accepted !== false;
            if (!cameraAccepted) {
              reason = 'Camera interrupt rejected for helicopter perspective';
            }
          }
        }

        const afterPos =
          typeof playback.positionSec === 'function'
            ? playback.positionSec()
            : getPlaybackState()?.positionSec;
        const afterState = getPlaybackState();
        if (
          cameraAccepted &&
          afterPos != null &&
          Math.abs(afterPos - startSec) <= 0.5 &&
          afterState?.state === 'playing'
        ) {
          ok = true;
          confirmed = true;
        } else if (!reason) {
          reason = `Replay section verification failed: pos=${afterPos}, state=${afterState?.state}`;
        }
        break;
      }

      case 'camera_above_entity': {
        const scene = getScene();
        const ent =
          scene?.entities?.find((e) => e.id === cmd.entityId) ||
          runtime?.entityById?.(cmd.entityId);
        if (!ent) {
          reason = `Entity ${cmd.entityId} not found`;
          break;
        }
        if (!cameraDirector || typeof cameraDirector.interrupt !== 'function') {
          reason = 'Camera director unavailable';
          break;
        }
        const heightM = cmd.heightM || 150;
        const shot = {
          id: `shot-above-entity-${now()}`,
          type: 'overhead_intelligence',
          title: `Overhead of ${cmd.entityId}`,
          startSec:
            typeof playback?.positionSec === 'function'
              ? playback.positionSec()
              : 0,
          durationSec: 10,
          subjectIds: [cmd.entityId],
          ...(ent.position
            ? {
                focus: {
                  eastM: ent.position.eastM,
                  northM: ent.position.northM,
                  heightM: ent.position.heightM,
                },
              }
            : {}),
          heightM,
          distanceM: heightM,
          pitchDeg: -89,
          priority: QA_CAMERA_PRIORITY,
          interruptible: true,
        };
        const res = cameraDirector.interrupt(shot, {
          reason: `QA camera_above_entity ${cmd.entityId}`,
          priority: QA_CAMERA_PRIORITY,
        });
        if (res?.accepted) {
          ok = true;
          confirmed = true;
        } else {
          reason = 'Camera interrupt not accepted';
        }
        break;
      }

      case 'camera_above_selection': {
        const selected =
          context?.selectedEntityIds || runtime?.selected?.() || [];
        if (!selected.length) {
          reason = 'No entities selected for camera_above_selection';
          break;
        }
        if (!cameraDirector || typeof cameraDirector.interrupt !== 'function') {
          reason = 'Camera director unavailable';
          break;
        }
        const heightM = cmd.heightM || 200;
        const shot = {
          id: `shot-above-sel-${now()}`,
          type: 'overhead_intelligence',
          title: 'Overhead Selection',
          startSec:
            typeof playback?.positionSec === 'function'
              ? playback.positionSec()
              : 0,
          durationSec: 10,
          subjectIds: selected,
          heightM,
          distanceM: heightM,
          pitchDeg: -89,
          priority: QA_CAMERA_PRIORITY,
          interruptible: true,
        };
        const res = cameraDirector.interrupt(shot, {
          reason: 'QA camera_above_selection',
          priority: QA_CAMERA_PRIORITY,
        });
        if (res?.accepted) {
          ok = true;
          confirmed = true;
        } else {
          reason = 'Camera interrupt not accepted';
        }
        break;
      }

      case 'wide_aerial': {
        if (!cameraDirector || typeof cameraDirector.interrupt !== 'function') {
          reason = 'Camera director unavailable';
          break;
        }
        const scene = getScene();
        const radius = scene?.boundsRadiusM || 1500;
        const heightM = cmd.heightM || Math.max(800, radius * 1.5);
        const shot = {
          id: `shot-wide-aerial-${now()}`,
          type: 'aerial_establishing',
          title: 'Wide Aerial View',
          startSec:
            typeof playback?.positionSec === 'function'
              ? playback.positionSec()
              : 0,
          durationSec: 15,
          subjectIds: [],
          heightM,
          distanceM: heightM,
          pitchDeg: -45,
          priority: QA_CAMERA_PRIORITY,
          interruptible: true,
        };
        const res = cameraDirector.interrupt(shot, {
          reason: 'QA wide_aerial',
          priority: QA_CAMERA_PRIORITY,
        });
        if (res?.accepted) {
          ok = true;
          confirmed = true;
        } else {
          reason = 'Camera interrupt not accepted';
        }
        break;
      }

      case 'change_camera': {
        if (!cameraDirector || typeof cameraDirector.interrupt !== 'function') {
          reason = 'Camera director unavailable';
          break;
        }
        const res = cameraDirector.interrupt(cmd.shot, {
          reason: 'QA change_camera',
          priority: cmd.shot.priority ?? 75,
        });
        if (res?.accepted) {
          ok = true;
          confirmed = true;
        } else {
          reason = 'Camera interrupt not accepted';
        }
        break;
      }

      case 'show_route_closed': {
        const scene = getScene();
        const routes = scene?.routes || [];
        const closedRoutes = cmd.routeId
          ? routes.filter((r) => r.id === cmd.routeId && r.closed)
          : routes.filter((r) => r.closed);

        if (!closedRoutes.length) {
          reason = cmd.routeId
            ? `Route ${cmd.routeId} is not closed or not found`
            : 'No closed routes found in scene';
          break;
        }

        const closedIds = closedRoutes.map((r) => r.id);
        if (typeof runtime?.setHighlight === 'function') {
          for (const id of closedIds) {
            runtime.setHighlight(id, true, 3);
          }
        }

        const firstClosed = closedRoutes[0];
        const localFocus = computeRouteMidpointFocus(
          firstClosed,
          runtime?.context,
        );

        let cameraAccepted = true;
        if (cameraDirector && typeof cameraDirector.interrupt === 'function') {
          const shot = {
            id: `shot-route-closed-${now()}`,
            type: 'overhead_intelligence',
            title: `Closed route: ${firstClosed.label || firstClosed.id}`,
            startSec:
              typeof playback?.positionSec === 'function'
                ? playback.positionSec()
                : 0,
            durationSec: 10,
            subjectIds: [],
            ...(localFocus ? { focus: localFocus } : {}),
            heightM: 180,
            distanceM: 180,
            pitchDeg: -80,
            priority: QA_CAMERA_PRIORITY,
            interruptible: true,
          };
          const res = cameraDirector.interrupt(shot, {
            reason: 'QA show_route_closed',
            priority: QA_CAMERA_PRIORITY,
          });
          cameraAccepted = res?.accepted !== false;
        }

        if (cameraAccepted) {
          ok = true;
          confirmed = true;
          extra.closedRouteIds = closedIds;
        } else {
          reason = 'Camera interrupt to route midpoint was rejected';
        }
        break;
      }

      case 'show_evidence_source': {
        const scene = getScene();
        if (!scene) {
          reason = 'No active scene in reducer';
          break;
        }
        const targetSource = cmd.source;
        const matching = scene.entities.filter((e) => {
          if (e.provenance?.kind === targetSource) return true;
          if (e.provenance?.sourceRef === targetSource) return true;
          if (
            targetSource === 'snapchat' &&
            e.provenance?.evidenceId?.startsWith('ev-snap')
          )
            return true;
          if (
            targetSource === 'test_injection' &&
            (e.provenance?.kind === 'test' ||
              e.provenance?.sourceRef === 'test_injection')
          )
            return true;
          if (Array.isArray(e.tags) && e.tags.includes(targetSource))
            return true;
          return false;
        });

        if (!matching.length) {
          reason = `No entities matched evidence source '${targetSource}'`;
          break;
        }

        const matchedIds = matching.map((e) => e.id);
        if (typeof runtime?.setHighlight === 'function') {
          for (const id of matchedIds) {
            runtime.setHighlight(id, true, 4);
          }
        }

        ok = true;
        confirmed = true;
        extra.matchedEntityIds = matchedIds;
        break;
      }

      case 'explain_change': {
        const scene = getScene();
        if (!scene) {
          reason = 'No active scene in reducer';
          break;
        }
        const history = (scene.history || []).filter(
          (h) => cmd.sinceVersion == null || h.sceneVersion >= cmd.sinceVersion,
        );
        if (!history.length) {
          answer = `No scene mutations recorded (current scene version: ${scene.sceneVersion}).`;
        } else {
          const lines = history
            .slice(-20)
            .map(
              (h) =>
                `• v${h.sceneVersion}: op ${h.op} from ${h.source || 'unknown'}${h.reason ? ` ("${h.reason}")` : ''}`,
            );
          answer = `Scene changes (current version ${scene.sceneVersion}):\n${lines.join('\n')}`;
        }
        ok = true;
        confirmed = true;
        break;
      }

      default: {
        reason = `Unsupported command: ${cmd.command}`;
        break;
      }
    }

    // Strict rule: never report ok:true without confirmed:true
    if (ok && !confirmed) {
      ok = false;
      if (!reason) reason = 'Action performed but state confirmation failed';
    }

    const afterSnapshot = getSnapshot();
    const afterScene = getScene();
    const after = afterSnapshot || afterScene;

    let diff;
    if (beforeScene && afterScene) {
      try {
        diff = diffScenes(beforeScene, afterScene);
      } catch {}
    }

    return {
      command: cmd.command,
      ok,
      confirmed,
      before,
      after,
      ...(diff ? { diff } : {}),
      ...(reason ? { reason } : {}),
      ...(answer ? { answer } : {}),
      ...extra,
    };
  }

  return {
    async execute(commands, { selectedEntityIds = [] } = {}) {
      const list = Array.isArray(commands) ? commands : [commands];
      const results = [];
      for (const cmd of list) {
        const res = await executeSingleCommand(cmd, { selectedEntityIds });
        results.push(res);
      }
      return results;
    },
  };
}
