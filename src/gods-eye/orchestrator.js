/**
 * Gods-Eye orchestrator — the ONLY module that wires scenes/, footage/,
 * route/, camera/ and ui/* together. Nothing here runs at import time and
 * nothing fetches, flies or plays until `buildFromPrompt` / `openScene` is
 * called (HARD RULE §0). Public surface: `window.__godsEye` (see
 * docs/gods-eye/CONTRACTS.md §6).
 */
import { createSceneStore } from './scenes/store.js';
import { createPersistence } from './scenes/persistence.js';
import { loadRegister, findAoi, addAoi } from './scenes/aoiRegister.js';
import { encodeSceneShare, decodeSceneShare } from './scenes/share.js';
import { createFootageClient } from '../footage/client.js';
import { createRanker } from './footage/rankClient.js';
import { createFootageCache } from './footage/cache.js';
import { createRouteCache } from './route/cache.js';
import { createCameraController } from './camera/controller.js';
import { createViirsLayer } from './camera/viirs.js';
import { installSceneUi } from './ui/scene/index.js';
import { installScenesPanel } from './ui/scenes-panel/index.js';
import { installSourcesSidebar } from './ui/sidebar/index.js';
import { showRegisterModal } from './ui/sidebar/registerModal.js';
import { createSceneBuilder } from './build.js';
import { createPlaybackController } from './playback.js';

export const GODS_EYE_EVENTS = Object.freeze({
  stage: 'gev:scene-stage',
  status: 'gev:scene-status',
  built: 'gev:scene-built',
  playing: 'gev:scene-playing',
  dwell: 'gev:scene-dwell',
});

/** Wrap fetch so test mode (`?fixtures=1`, `?route500=1`) reaches the service. */
function createServiceFetch(win, fetchImpl) {
  const search = String(win?.location?.search || '');
  const q = new URLSearchParams(search.replace(/^\?/, ''));
  const fixtures = q.get('fixtures') === '1';
  const route500 = q.get('route500') === '1';
  if (!fixtures && !route500) return fetchImpl;
  return (input, init) => {
    let url = String(input);
    if (url.includes('/footage/')) {
      const sep = url.includes('?') ? '&' : '?';
      if (fixtures && !/[?&]fixtures=/.test(url)) url += `${sep}fixtures=1`;
      if (route500 && url.includes('/route/plan') && !/mock=/.test(url))
        url += `${url.includes('?') ? '&' : '?'}mock=500`;
    }
    return fetchImpl(url, init);
  };
}

/**
 * Install the Gods-Eye scene engine into the running application.
 * @returns {object} the `window.__godsEye` API
 */
export function installGodsEye({
  viewer,
  Cesium,
  signal,
  sceneDirector = null,
  readShareLinks = () => null,
  document: doc = globalThis.document,
  window: win = globalThis.window,
  fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = globalThis.localStorage,
  now: initialNow = () => Date.now(),
  fallbackFly = null,
} = {}) {
  if (!doc || !win) return null;
  let nowFn = initialNow;
  const now = () => nowFn();
  const serviceFetch = createServiceFetch(win, fetchImpl);
  const persistence = createPersistence({
    indexedDB: win.indexedDB,
    name: 'gods-eye',
    fetch: serviceFetch,
  });
  const store = createSceneStore({ persistence, now });
  const register = loadRegister({ storage });
  const client = createFootageClient({ fetch: serviceFetch });
  const ranker = createRanker({ Worker: win.Worker });
  const footageCache = createFootageCache({ now });
  const routeCache = createRouteCache({ now });
  const reducedMotion = Boolean(
    win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
  );
  const emit = (type, detail) =>
    win.dispatchEvent?.(new (win.CustomEvent || CustomEvent)(type, { detail }));
  const camera = createCameraController({
    viewer,
    Cesium,
    reducedMotion,
    now,
    fallbackFly,
    dispatch: (stage, waypoint) => {
      doc.documentElement.dataset.geStage = stage;
      const sceneId = store.getState().activeId;
      if (stage === 'S0' || stage === 'S1') viirs.show();
      else viirs.hide();
      sceneUi.setStage(stage);
      emit(GODS_EYE_EVENTS.stage, {
        sceneId,
        stage,
        revealLayers: waypoint?.revealLayers || [],
        at: now(),
      });
    },
  });
  const viirs = createViirsLayer({ viewer, Cesium });
  const enabledSources = {};
  const sceneUi = installSceneUi({
    document: doc,
    window: win,
    store,
    viewer,
    Cesium,
    // The scene UI already mounted the player for this item; just announce it.
    onSelectItem: (item) =>
      emit(GODS_EYE_EVENTS.playing, {
        sceneId: item?.sceneId,
        itemId: item?.id,
        at: now(),
      }),
    onScrub: (window_) => playback.applyScrub(window_),
  });
  const sharedSidebar = win.__workstation?.sources || null;
  const sidebar =
    sharedSidebar ||
    installSourcesSidebar({
      document: doc,
      window: win,
      store,
      storage,
      routeAgent: { status: 'unknown', latencyMs: null },
      onToggle: (platform, enabled) => api.setSourceEnabled(platform, enabled),
    });
  sidebar.bindStore?.(store);
  Object.assign(enabledSources, sidebar.getEnabled?.() || {});
  const share = readShareLinks?.() || null;
  const syncShare = () => {
    if (share?.onSceneStateChange) share.onSceneStateChange();
  };
  store.subscribe(() => {
    const state = store.getState();
    const scene = state.scenes[state.activeId];
    doc.documentElement.dataset.geScene = state.activeId || '';
    doc.documentElement.dataset.geState = scene?.status || '';
  });

  const builder = createSceneBuilder({
    store,
    register,
    camera,
    client,
    ranker,
    footageCache,
    routeCache,
    sceneUi,
    sidebar,
    fetch: serviceFetch,
    viewer,
    Cesium,
    now,
    emit,
    events: GODS_EYE_EVENTS,
    enabledSources,
    document: doc,
    window: win,
    onRegisterPrompt: (place) =>
      new Promise((resolve) => {
        sceneUi.setPoster?.('outsideRegister');
        showRegisterModal({
          document: doc,
          place,
          onAccept: (entry) => resolve(addAoi(entry, { storage })),
          onDecline: () => resolve(null),
        });
      }),
    findAoi,
    syncShare,
  });
  const playback = createPlaybackController({
    store,
    builder,
    camera,
    sceneUi,
    now,
    emit,
    events: GODS_EYE_EVENTS,
    window: win,
  });

  const panel = installScenesPanel({
    document: doc,
    window: win,
    store,
    now,
    host:
      doc.querySelector('#scene-panel .scene-panel-inner') ||
      doc.querySelector('#scene-panel') ||
      doc.body,
    actions: {
      open: (id) => api.openScene(id),
      recreate: (id) => api.recreateScene(id),
      rename: (id, title) => store.patchScene(id, { title }),
      duplicate: (id) => builder.duplicate(id),
      remove: (id) => {
        if (store.getState().activeId === id) playback.stop();
        store.removeScene(id);
        sceneUi.mapLayers?.clear(id);
      },
      share: (id) => api.shareUrl(id),
      start: (ids) => playback.start(ids),
      next: () => playback.next(),
      stop: () => playback.stop(),
    },
  });

  share?.setSceneStateProvider?.(() => {
    const state = store.getState();
    const scene = state.scenes[state.activeId];
    if (!scene) return null;
    const params = new URLSearchParams();
    encodeSceneShare(params, scene);
    const out = {};
    for (const [k, v] of params) if (k !== 'sc') out[k] = v;
    return { sceneId: scene.id, params: out };
  });

  const api = {
    is2d: !viewer,
    store,
    events: GODS_EYE_EVENTS,
    buildFromPrompt: (text) => builder.buildFromPrompt(text),
    openScene: (id) => builder.openScene(id, { playback }),
    recreateScene: (id) => builder.recreateScene(id),
    startPlayback: (ids) => playback.start(ids),
    nextScene: () => playback.next(),
    stopPlayback: () => playback.stop(),
    setSourceEnabled(platform, enabled) {
      enabledSources[platform] = enabled !== false;
      builder.applySourceFilter();
    },
    getEnabledSources: () => ({ ...enabledSources }),
    getState: () => store.getState(),
    listScenes: () =>
      store.getState().order.map((id) => store.getState().scenes[id]),
    shareUrl(id) {
      const scene = store.getState().scenes[id];
      if (!scene) return null;
      const params = new URLSearchParams(
        String(win.location.hash || '').replace(/^#/, ''),
      );
      if (!params.has('v')) params.set('v', '2');
      if (params.has('sc') && !/^s_/.test(params.get('sc')))
        params.set('scp', params.get('sc'));
      encodeSceneShare(params, scene);
      const url = new URL(win.location.href);
      url.hash = params.toString();
      return url.href;
    },
    setNow(fn) {
      nowFn = typeof fn === 'function' ? fn : initialNow;
      store.touch?.();
      panel.refresh?.();
    },
    register: { list: () => register.listAoi(), find: findAoi },
    ui: { sceneUi, panel, sidebar },
    camera,
    destroy() {
      playback.stop();
      builder.destroy();
      panel.destroy();
      // The workstation owns a shared Sources sidebar; never tear it down.
      if (!sharedSidebar) sidebar.destroy();
      sceneUi.destroy();
      viirs.destroy?.();
      ranker.destroy?.();
      share?.setSceneStateProvider?.(null);
      if (win.__godsEye === api) delete win.__godsEye;
    },
  };
  win.__godsEye = api;
  if (sceneDirector) api.sceneDirector = sceneDirector;

  // Share-URL restore: zero refetch. `sc=s_…` → stored scene (IndexedDB or the
  // service mirror); otherwise the encoded fallback state rebuilds a minimal
  // scene. Neither path streams footage or starts a player.
  void store
    .hydrate()
    .catch(() => [])
    .then(() =>
      builder.restoreFromHash(decodeSceneShare(win.location.hash || '')),
    );

  if (signal?.aborted) api.destroy();
  else signal?.addEventListener?.('abort', () => api.destroy(), { once: true });
  return api;
}
