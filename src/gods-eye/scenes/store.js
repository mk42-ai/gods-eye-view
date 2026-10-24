/**
 * Gods-Eye scene engine — scene store.
 * Manages state, transitions, abort signals, and persistence debouncing.
 * Runtime-neutral: browser ES module, no DOM, no Node builtins.
 */

import { reduce, initialState } from './reducer.js';

const PERSIST_STATUSES = Object.freeze(['saved', 'playing', 'ranked']);

/**
 * Creates the scene store instance.
 *
 * @param {object} [options={}]
 * @param {object} [options.persistence]
 * @param {() => number} [options.now]
 * @param {typeof setTimeout} [options.setTimeoutImpl]
 * @param {typeof clearTimeout} [options.clearTimeoutImpl]
 * @returns {object} Store per Contract §2
 */
export function createSceneStore({
  persistence,
  now = () => Date.now(),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  let state = initialState();
  const listeners = new Set();
  const controllers = new Map();
  let currentActiveId = null;
  const saveTimers = new Map();
  const lastSaved = new Map();

  function getState() {
    return state;
  }

  function subscribe(fn) {
    if (typeof fn === 'function') {
      listeners.add(fn);
    }
    return () => {
      listeners.delete(fn);
    };
  }

  function select(selector) {
    return selector(state);
  }

  function dispatch(action) {
    state = reduce(state, action);
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        // listener errors swallowed
      }
    }
    return state;
  }

  function maybeScheduleSave(scene) {
    if (!persistence?.save || !scene?.id) return;
    if (!PERSIST_STATUSES.includes(scene.status)) return;

    const id = scene.id;
    if (saveTimers.has(id)) {
      clearTimeoutImpl(saveTimers.get(id));
    }

    const timer = setTimeoutImpl(async () => {
      saveTimers.delete(id);
      try {
        const latest = getState().scenes[id];
        if (latest && PERSIST_STATUSES.includes(latest.status)) {
          // Open / share restore must be zero-network: skip the write (and
          // its /footage/scenes mirror) when nothing changed since last save.
          const fingerprint = JSON.stringify(latest);
          if (lastSaved.get(id) === fingerprint) return;
          lastSaved.set(id, fingerprint);
          await persistence.save(latest);
        }
      } catch {
        // swallowed
      }
    }, 250);

    saveTimers.set(id, timer);
  }

  function beginScene(id) {
    if (currentActiveId && currentActiveId !== id) {
      abortScene(currentActiveId);
    }

    const controller = new AbortController();
    controllers.set(id, controller);
    currentActiveId = id;
    setActive(id);
    return controller.signal;
  }

  function signalFor(id) {
    return controllers.get(id)?.signal || null;
  }

  function abortScene(id) {
    const controller = controllers.get(id);
    if (controller) {
      controller.abort();
      controllers.delete(id);
    }
    if (currentActiveId === id) {
      currentActiveId = null;
    }
  }

  function upsertScene(scene) {
    dispatch({ type: 'SCENE_UPSERT', payload: scene });
    const saved = getState().scenes[scene.id];
    if (saved) maybeScheduleSave(saved);
    return saved;
  }

  function patchScene(id, partial) {
    dispatch({ type: 'SCENE_PATCH', payload: { id, patch: partial } });
    const saved = getState().scenes[id];
    if (saved) maybeScheduleSave(saved);
    return saved;
  }

  function setActive(id) {
    dispatch({ type: 'SCENE_ACTIVE', payload: id });
  }

  function removeScene(id) {
    abortScene(id);
    if (saveTimers.has(id)) {
      clearTimeoutImpl(saveTimers.get(id));
      saveTimers.delete(id);
    }
    dispatch({ type: 'SCENE_REMOVE', payload: id });
    if (persistence?.remove) {
      persistence.remove(id).catch(() => {});
    }
  }

  function mergeFootage(id, items, options = {}) {
    const force =
      typeof options === 'boolean' ? options : Boolean(options?.force);
    const replace = Boolean(options?.replace);
    dispatch({ type: 'FOOTAGE_MERGE', payload: { id, items, force, replace } });
  }

  function setSourceStatus(id, platform, { status, count, latencyMs } = {}) {
    dispatch({
      type: 'SOURCE_STATUS',
      payload: { id, platform, status, count, latencyMs },
    });
  }

  function setStatus(id, status, error) {
    dispatch({ type: 'SCENE_STATUS', payload: { id, status, error } });
    const saved = getState().scenes[id];
    if (saved) maybeScheduleSave(saved);
    return saved;
  }

  function setPlayback(partial) {
    dispatch({ type: 'PLAYBACK_SET', payload: partial });
  }

  /** Load one scene from persistence (used by Open / share restore). */
  async function load(id) {
    if (!persistence?.load) return null;
    try {
      const scene = (await persistence.load(id)) || null;
      if (scene) lastSaved.set(id, JSON.stringify(scene));
      return scene;
    } catch {
      return null;
    }
  }

  /** Re-publish the current state (clock mocks, lifecycle re-evaluation). */
  function touch() {
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        // swallowed
      }
    }
  }

  async function hydrate() {
    if (!persistence?.list) return [];
    try {
      const list = await persistence.list();
      if (Array.isArray(list)) {
        for (const scene of list) {
          if (scene?.id) {
            lastSaved.set(scene.id, JSON.stringify(scene));
            dispatch({ type: 'SCENE_UPSERT', payload: scene });
          }
        }
      }
      return list;
    } catch {
      return [];
    }
  }

  return {
    getState,
    dispatch,
    subscribe,
    select,
    beginScene,
    signalFor,
    abortScene,
    upsertScene,
    patchScene,
    setActive,
    removeScene,
    mergeFootage,
    setSourceStatus,
    setStatus,
    setPlayback,
    hydrate,
    load,
    touch,
  };
}
