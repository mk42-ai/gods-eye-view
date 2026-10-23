/**
 * Gods-Eye scene engine — reducer and state machine.
 * Runtime-neutral: browser ES module, no DOM, no Node builtins.
 */

/**
 * Legal scene status transitions.
 * idle -> parsing -> geocoded -> routing -> flying -> fetching -> ranked -> playing -> saved
 * any -> error; error -> parsing; saved -> routing (Recreate); saved -> playing (Open)
 */
export const TRANSITIONS = Object.freeze({
  idle: Object.freeze(['parsing', 'error']),
  parsing: Object.freeze(['geocoded', 'error']),
  geocoded: Object.freeze(['routing', 'error']),
  routing: Object.freeze(['flying', 'error']),
  flying: Object.freeze(['fetching', 'error']),
  fetching: Object.freeze(['ranked', 'error']),
  ranked: Object.freeze(['playing', 'error']),
  playing: Object.freeze(['saved', 'error']),
  saved: Object.freeze(['routing', 'playing', 'error']),
  error: Object.freeze(['parsing', 'error']),
});

/**
 * Error thrown on illegal status transitions.
 */
export class SceneStateError extends Error {
  constructor(fromStatus, toStatus, sceneId) {
    const target = sceneId ? ` for scene '${sceneId}'` : '';
    super(
      `Illegal scene status transition from '${fromStatus}' to '${toStatus}'${target}`,
    );
    this.name = 'SceneStateError';
    this.from = fromStatus;
    this.to = toStatus;
    this.sceneId = sceneId;
  }
}

/**
 * Check if a status transition is legal.
 *
 * @param {string} from Current status
 * @param {string} to Target status
 * @returns {boolean}
 */
export function isValidTransition(from, to) {
  if (to === 'error') return true;
  const allowed = TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

/**
 * Initial scene store state.
 *
 * @returns {object}
 */
export function initialState() {
  return {
    scenes: {},
    order: [],
    activeId: null,
    playback: {
      running: false,
      queue: [],
      index: 0,
      phase: 'idle',
    },
    ui: {},
  };
}

/**
 * Pure state reducer.
 *
 * @param {object} [state=initialState()]
 * @param {object} action
 * @returns {object}
 */
export function reduce(state = initialState(), action) {
  if (!action || typeof action !== 'object') return state;

  switch (action.type) {
    case 'RESET':
      return { ...initialState(), ...(action.payload || {}) };

    case 'SCENE_UPSERT': {
      const scene = action.payload?.scene || action.payload;
      if (!scene?.id) return state;
      const scenes = { ...state.scenes, [scene.id]: scene };
      const order = state.order.includes(scene.id)
        ? state.order
        : [...state.order, scene.id];
      return { ...state, scenes, order };
    }

    case 'SCENE_PATCH': {
      const { id, patch, ...rest } = action.payload || {};
      if (!id || !state.scenes[id]) return state;
      const updates = patch || rest;
      const updatedScene = { ...state.scenes[id], ...updates };
      return {
        ...state,
        scenes: { ...state.scenes, [id]: updatedScene },
      };
    }

    case 'SCENE_REMOVE': {
      const id = action.payload?.id || action.payload;
      if (!id || !state.scenes[id]) return state;
      const scenes = { ...state.scenes };
      delete scenes[id];
      const order = state.order.filter((x) => x !== id);
      const activeId = state.activeId === id ? null : state.activeId;
      return { ...state, scenes, order, activeId };
    }

    case 'SCENE_ACTIVE': {
      const id = action.payload?.id ?? action.payload;
      return { ...state, activeId: id || null };
    }

    case 'SCENE_STATUS': {
      const { id, status, error } = action.payload || {};
      if (!id || !state.scenes[id]) return state;
      const current = state.scenes[id];
      if (!isValidTransition(current.status, status)) {
        throw new SceneStateError(current.status, status, id);
      }
      const updated = {
        ...current,
        status,
        error:
          error !== undefined
            ? error
            : status === 'error'
              ? current.error
              : null,
      };
      return {
        ...state,
        scenes: { ...state.scenes, [id]: updated },
      };
    }

    case 'FOOTAGE_MERGE': {
      const { id, items, force, replace } = action.payload || {};
      if (!id || !state.scenes[id]) return state;
      if (state.activeId !== id && !force) {
        return state;
      }
      const existing = replace ? [] : state.scenes[id].footage || [];
      const byId = new Map();
      for (const item of existing) {
        if (item?.id) byId.set(item.id, item);
      }
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item?.id) byId.set(item.id, item);
        }
      }
      const merged = Array.from(byId.values()).sort(
        (a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0),
      );
      return {
        ...state,
        scenes: {
          ...state.scenes,
          [id]: { ...state.scenes[id], footage: merged },
        },
      };
    }

    case 'SOURCE_STATUS': {
      const { id, platform, status, count, latencyMs } = action.payload || {};
      if (!id || !platform || !state.scenes[id]) return state;
      const scene = state.scenes[id];
      const prevSource = scene.sources?.[platform] || { enabled: true };
      const updatedSource = {
        ...prevSource,
        status: status ?? prevSource.status ?? 'idle',
        count: typeof count === 'number' ? count : (prevSource.count ?? 0),
        latencyMs:
          typeof latencyMs === 'number'
            ? latencyMs
            : (prevSource.latencyMs ?? 0),
      };
      return {
        ...state,
        scenes: {
          ...state.scenes,
          [id]: {
            ...scene,
            sources: { ...scene.sources, [platform]: updatedSource },
          },
        },
      };
    }

    case 'PLAYBACK_SET': {
      return {
        ...state,
        playback: { ...state.playback, ...(action.payload || {}) },
      };
    }

    default:
      return state;
  }
}
