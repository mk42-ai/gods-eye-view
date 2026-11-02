/**
 * Debug API and test-injection harness for the Live Cinematic Intelligence Engine.
 *
 * Installs window.__gevCinematic for browser QA scripts, automated harnesses,
 * and live evidence reports.
 */

import { buildQaContext } from './qaCommands.js';
import { ScenePatchSchema, validateScenePatch } from './sceneSchema.js';

export const EVENT_RING_CAPACITY = 2000;

/**
 * Ring buffer of fixed capacity for SSE events.
 */
export function createEventRingBuffer(capacity = EVENT_RING_CAPACITY) {
  const cap = Math.max(1, capacity);
  const buffer = new Array(cap);
  let head = 0;
  let count = 0;

  return {
    push(entry) {
      buffer[head] = entry;
      head = (head + 1) % cap;
      if (count < cap) count += 1;
    },
    toArray() {
      if (count === 0) return [];
      const out = new Array(count);
      const start = count < cap ? 0 : head;
      for (let i = 0; i < count; i++) {
        out[i] = buffer[(start + i) % cap];
      }
      return out;
    },
    size() {
      return count;
    },
    clear() {
      head = 0;
      count = 0;
    },
  };
}

/**
 * Record an SSE event into the ring buffer.
 */
export function recordEvent(
  ringBuffer,
  evt,
  now = () => new Date().toISOString(),
) {
  if (!ringBuffer || typeof ringBuffer.push !== 'function') return null;
  const entry = {
    t: evt?.t || (evt?.data && evt.data.t) || now(),
    id: evt?.id || null,
    event: evt?.event || 'message',
    data: evt?.data || null,
  };
  ringBuffer.push(entry);
  return entry;
}

/**
 * Construct a valid test road-closure patch for the active scene.
 */
export function createTestRoadClosurePatch(
  scene,
  { now = () => Date.now(), positionSec = 0, context } = {},
) {
  if (!scene) {
    throw new Error('createTestRoadClosurePatch requires an active scene');
  }

  const patchId = `patch-inject-${now()}`;
  const firstRoute =
    Array.isArray(scene.routes) && scene.routes.length > 0
      ? scene.routes[0]
      : null;
  const ops = [];

  let signPosition = { eastM: 120, northM: 0, heightM: 0 };

  if (firstRoute) {
    ops.push({
      op: 'adjust_route',
      routeId: firstRoute.id,
      closed: true,
      closedReason: 'Test road closure injected',
    });

    if (
      Array.isArray(firstRoute.coordinates) &&
      firstRoute.coordinates.length > 0
    ) {
      // Place the sign on the route vertex NEAREST the scene origin, not the
      // route centroid: a researched route (e.g. Sheikh Zayed Road, ~55 km)
      // has a centroid far outside the 5 km placement bound, which made the
      // injected patch fail schema validation on the live preview (Demo B,
      // 2026-11-01T15:53Z ZodError). The nearest vertex is always inside the
      // scene bounds whenever the route touches them.
      const coords = firstRoute.coordinates;
      const oLat = Number.isFinite(scene.origin?.lat) ? scene.origin.lat : null;
      const oLon = Number.isFinite(scene.origin?.lon) ? scene.origin.lon : null;
      let midLon = coords[0][0];
      let midLat = coords[0][1];
      if (oLat != null && oLon != null) {
        const cosLat = Math.cos((oLat * Math.PI) / 180) || 1;
        let best = Infinity;
        for (const pt of coords) {
          const dx = (pt[0] - oLon) * cosLat;
          const dy = pt[1] - oLat;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) {
            best = d2;
            midLon = pt[0];
            midLat = pt[1];
          }
        }
      } else {
        let sumLon = 0;
        let sumLat = 0;
        for (const pt of coords) {
          sumLon += pt[0];
          sumLat += pt[1];
        }
        midLon = sumLon / coords.length;
        midLat = sumLat / coords.length;
      }

      if (context && typeof context.wgs84ToLocal === 'function') {
        try {
          const loc = context.wgs84ToLocal({
            lat: midLat,
            lon: midLon,
            heightM: 0,
          });
          if (
            loc &&
            Number.isFinite(loc.eastM) &&
            Number.isFinite(loc.northM)
          ) {
            signPosition = {
              eastM: Math.round(loc.eastM),
              northM: Math.round(loc.northM),
              heightM: loc.heightM ?? 0,
            };
          }
        } catch {}
      } else if (
        scene.origin &&
        Number.isFinite(scene.origin.lat) &&
        Number.isFinite(scene.origin.lon)
      ) {
        const latDiff = midLat - scene.origin.lat;
        const lonDiff = midLon - scene.origin.lon;
        const northM = Math.round(latDiff * 111320);
        const eastM = Math.round(
          lonDiff * (111320 * Math.cos((scene.origin.lat * Math.PI) / 180)),
        );
        signPosition = { eastM, northM, heightM: 0 };
      }
    }
  } else {
    const originLat = scene.origin?.lat ?? 25.1972;
    const originLon = scene.origin?.lon ?? 55.2744;
    const cosLat = Math.cos((originLat * Math.PI) / 180);
    const lonDelta = 120 / (111320 * (cosLat || 1));
    const latDelta = 60 / 111320;

    const routeCoords = [
      [originLon + lonDelta, originLat - latDelta],
      [originLon + lonDelta, originLat + latDelta],
    ];

    ops.push({
      op: 'add_route',
      route: {
        id: 'route-test-closure',
        label: 'Test Closed Road Segment',
        kind: 'road_segment',
        coordinates: routeCoords,
        closed: true,
        closedReason: 'Test road closure injected',
        provenance: { kind: 'test' },
        uncertainty: 'illustrative',
      },
    });

    signPosition = { eastM: 120, northM: 0, heightM: 0 };
  }

  // Never emit a position the schema rejects: clamp to the placement bound.
  const BOUND = 4900;
  signPosition = {
    ...signPosition,
    eastM: Math.max(-BOUND, Math.min(BOUND, Math.round(signPosition.eastM))),
    northM: Math.max(-BOUND, Math.min(BOUND, Math.round(signPosition.northM))),
  };
  const signId = `sign-road-closed-${now()}`;
  ops.push({
    op: 'add_entity',
    entity: {
      id: signId,
      assetId: 'sprite.signage.road_closed',
      label: 'ROAD CLOSED (test)',
      category: 'signage',
      position: signPosition,
      headingDeg: 0,
      scale: 1,
      count: 1,
      spreadM: 0,
      behavior: { type: 'static' },
      startSec: 0,
      endSec: null,
      uncertainty: 'illustrative',
      provenance: { kind: 'test', note: 'Test road closure signage' },
      highlight: true,
      alertState: 3,
      hypothetical: false,
      tags: ['test_injection', 'signage'],
    },
  });

  ops.push({
    op: 'add_timeline_event',
    beat: {
      atSec: Math.max(0, Math.round(positionSec)),
      title: 'Test road closure injected',
      narration: 'Test road closure injected for simulation QA verification.',
      entityIds: [signId],
      evidenceIds: [],
    },
  });

  const patch = {
    patchId,
    sceneId: scene.sceneId,
    baseVersion: scene.sceneVersion,
    ops,
    reason: 'Test road closure injected',
    source: 'test_injection',
    evidenceIds: [],
    priority: 'high',
    label: 'TEST PATCH — illustrative road closure',
    createdAt: new Date(now()).toISOString(),
  };

  return ScenePatchSchema.parse(patch);
}

/**
 * Measure FPS by counting requestAnimationFrame calls over 2 seconds.
 */
export function measureFps(
  windowObj = typeof window !== 'undefined' ? window : null,
) {
  return new Promise((resolve) => {
    if (!windowObj || typeof windowObj.requestAnimationFrame !== 'function') {
      resolve(60);
      return;
    }
    let frames = 0;
    const perf = windowObj.performance || Date;
    const t0 = perf.now();

    function step() {
      frames += 1;
      const elapsed = perf.now() - t0;
      if (elapsed >= 2000) {
        resolve(Math.round((frames / elapsed) * 1000));
      } else {
        windowObj.requestAnimationFrame(step);
      }
    }

    windowObj.requestAnimationFrame(step);
  });
}

/**
 * Read current JS heap usage in MB from performance.memory if available.
 */
export function getHeapMb(
  windowObj = typeof window !== 'undefined' ? window : null,
) {
  try {
    const mem = windowObj?.performance?.memory?.usedJSHeapSize;
    if (typeof mem === 'number' && Number.isFinite(mem)) {
      return Number((mem / 1048576).toFixed(2));
    }
  } catch {}
  return null;
}

/**
 * Read viewer camera pose { lat, lon, height, heading, pitch }.
 */
export function getCameraPose(viewer) {
  if (!viewer?.camera) {
    return { lat: 0, lon: 0, height: 0, heading: 0, pitch: 0 };
  }
  const cam = viewer.camera;
  const carto = cam.positionCartographic;
  if (!carto) {
    return { lat: 0, lon: 0, height: 0, heading: 0, pitch: 0 };
  }
  const toDeg = (rad) => (Number.isFinite(rad) ? (rad * 180) / Math.PI : 0);
  return {
    lat: Number(toDeg(carto.latitude).toFixed(5)),
    lon: Number(toDeg(carto.longitude).toFixed(5)),
    height: Math.round(carto.height ?? 0),
    heading: Math.round(toDeg(cam.heading ?? 0)),
    pitch: Math.round(toDeg(cam.pitch ?? 0)),
  };
}

/**
 * Install window.__gevCinematic debug and QA harness API.
 *
 * @param {Window} windowObj
 * @param {object} deps
 * @param {object} [deps.runtime]
 * @param {object} [deps.playback]
 * @param {object} [deps.cameraDirector]
 * @param {object} [deps.reducer]
 * @param {object} [deps.liveDirector]
 * @param {object} [deps.qaExecutor]
 * @param {object} [deps.client]
 * @param {object} [deps.viewer]
 * @param {(task: string, id: string) => void} [deps.onModelChange]
 * @param {() => Promise<any[]>|any[]} [deps.getModels]
 * @param {() => Promise<object>} [deps.pullLiveWeather]
 * @param {ReturnType<typeof createEventRingBuffer>} [deps.ringBuffer]
 */
export function installDebugApi(windowObj, deps = {}) {
  const ringBuffer =
    deps.ringBuffer || createEventRingBuffer(EVENT_RING_CAPACITY);

  const debugApi = {
    scene() {
      return deps.reducer?.scene?.() ?? null;
    },

    state() {
      return deps.reducer?.state?.() ?? { runState: 'idle' };
    },

    metrics() {
      return deps.reducer?.state?.()?.metrics ?? {};
    },

    events() {
      return ringBuffer.toArray();
    },

    recordEvent(evt) {
      return recordEvent(ringBuffer, evt);
    },

    snapshot() {
      return deps.runtime?.snapshot?.() ?? null;
    },

    applyPatch(patch) {
      const validated = validateScenePatch(patch);
      if (deps.reducer && typeof deps.reducer.applyPatch === 'function') {
        return deps.reducer.applyPatch(validated, {
          source: validated.source || 'qa',
        });
      }
      throw new Error('Reducer unavailable to apply patch');
    },

    inject(kind) {
      if (kind === 'road_closure') {
        const currentScene = deps.reducer?.scene?.();
        if (!currentScene) {
          throw new Error('Cannot inject road closure without an active scene');
        }
        const patch = createTestRoadClosurePatch(currentScene, {
          positionSec: deps.playback?.positionSec?.() ?? 0,
          context: deps.runtime?.context,
        });

        if (
          deps.liveDirector &&
          typeof deps.liveDirector.receive === 'function'
        ) {
          return deps.liveDirector.receive({
            patch,
            priority: 'high',
            relevance: 0.9,
            source: 'test_injection',
          });
        }

        if (deps.reducer && typeof deps.reducer.applyPatch === 'function') {
          return deps.reducer.applyPatch(patch, { source: 'test_injection' });
        }

        throw new Error(
          'Neither liveDirector nor reducer available to apply injected patch',
        );
      }

      throw new Error(`Unsupported injection kind: ${kind}`);
    },

    get playback() {
      if (!deps.playback) return null;
      return new Proxy(deps.playback, {
        get(target, prop, receiver) {
          if (prop === 'play') {
            return typeof target.play === 'function'
              ? target.play.bind(target)
              : () => {};
          }
          if (prop === 'pause') {
            return typeof target.pause === 'function'
              ? target.pause.bind(target)
              : () => {};
          }
          if (prop === 'seek') {
            return typeof target.seek === 'function'
              ? target.seek.bind(target)
              : () => {};
          }
          if (prop === 'state') {
            return typeof target.state === 'function'
              ? target.state.bind(target)
              : () => ({ state: 'idle' });
          }
          if (prop === 'positionsSnapshot') {
            return (sec) => {
              if (typeof target.positionsSnapshot === 'function') {
                const res = target.positionsSnapshot(sec);
                if (res && Object.keys(res).length > 0) return res;
              }
              const s = sec ?? target.positionSec?.() ?? 0;
              return deps.runtime?.positionsSnapshot?.(s) || {};
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
    },

    camera() {
      const viewer = deps.viewer || windowObj?.__godsEyeView?.viewer;
      return getCameraPose(viewer);
    },

    async qa(question) {
      const scene = deps.reducer?.scene?.();
      const playbackState = deps.playback?.state?.();
      const cameraState = debugApi.camera();
      const context = buildQaContext({
        scene,
        playback: playbackState,
        camera: cameraState,
        selectedEntityIds: deps.runtime?.selected?.() || [],
      });

      let qaResponse = null;
      if (deps.client && typeof deps.client.cinematicQa === 'function') {
        qaResponse = await deps.client.cinematicQa(question, context);
      } else if (deps.client && typeof deps.client.qa === 'function') {
        qaResponse = await deps.client.qa(question, context);
      } else {
        throw new Error('Q&A client unavailable on debug API');
      }

      let results = [];
      if (deps.qaExecutor && typeof deps.qaExecutor.execute === 'function') {
        results = await deps.qaExecutor.execute(qaResponse?.commands || [], {
          selectedEntityIds: deps.runtime?.selected?.() || [],
        });
      }

      return {
        answer: qaResponse?.answer || '',
        commands: qaResponse?.commands || [],
        results,
      };
    },

    setModel(task, endpointId) {
      if (typeof deps.onModelChange === 'function') {
        deps.onModelChange(task, endpointId);
      }
      try {
        if (windowObj?.localStorage) {
          const raw = windowObj.localStorage.getItem('gev.cinematic.models.v1');
          const stored = raw ? JSON.parse(raw) : {};
          stored[task] = endpointId;
          windowObj.localStorage.setItem(
            'gev.cinematic.models.v1',
            JSON.stringify(stored),
          );
        }
      } catch {}
    },

    async getModels() {
      if (typeof deps.getModels === 'function') {
        return deps.getModels();
      }
      if (deps.client && typeof deps.client.cinematicModels === 'function') {
        return deps.client.cinematicModels();
      }
      return [];
    },

    fps() {
      return measureFps(windowObj);
    },

    heap() {
      return getHeapMb(windowObj);
    },

    forceModel(endpointId) {
      if (windowObj) {
        windowObj.__gevCinematicForceModel = endpointId;
      }
    },

    /** Live Intelligence: Open-Meteo observation for the scene origin → patch. */
    async pullLiveWeather() {
      if (typeof deps.pullLiveWeather !== 'function') {
        throw new Error('Live weather source unavailable on debug API');
      }
      return deps.pullLiveWeather();
    },
  };

  if (windowObj) {
    windowObj.__gevCinematic = debugApi;
  }

  return debugApi;
}
