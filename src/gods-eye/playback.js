/**
 * Playback controller — START/NEXT/STOP across saved scenes in time order
 * with route-guided transitions, the 4.2 s (S2) + 11 s (S4) dwells, and the
 * per-item player advance inside a scene. STOP aborts in-flight work via the
 * store's per-scene AbortSignal.
 */
const DWELL_S2_MS = 4200;
const DWELL_S4_MS = 11000;

export function createPlaybackController({
  store,
  builder,
  camera,
  sceneUi,
  now,
  emit,
  events,
  window: win,
  setTimeoutImpl = (fn, ms) => win.setTimeout(fn, ms),
  clearTimeoutImpl = (h) => win.clearTimeout(h),
}) {
  let timer = null;
  let token = 0;
  let scrubWindow = null;

  const wait = (ms, myToken) =>
    new Promise((resolve) => {
      timer = setTimeoutImpl(() => resolve(myToken === token), ms);
    });

  function setPlayback(partial) {
    const prev = store.getState().playback || {};
    store.setPlayback({ ...prev, ...partial });
  }

  /** Scenes ordered by time (tRef asc, then createdAt asc). */
  function orderedIds(ids) {
    const state = store.getState();
    const list = (ids && ids.length ? ids : state.order)
      .map((id) => state.scenes[id])
      .filter(Boolean)
      .filter((s) => s.status !== 'error');
    list.sort(
      (a, b) =>
        Date.parse(a.tRef || 0) - Date.parse(b.tRef || 0) ||
        Date.parse(a.lifecycle?.createdAt || 0) -
          Date.parse(b.lifecycle?.createdAt || 0),
    );
    return list.map((s) => s.id);
  }

  async function playIndex(index, myToken) {
    const { queue } = store.getState().playback;
    const id = queue[index];
    if (!id || myToken !== token) return finish();
    setPlayback({ index, phase: 'travel' });
    const prev = store.getState().scenes[id];
    // Route-guided transition: the previous scene's S4 is the origin for the
    // route agent (builder reads the live camera, which rests at that S4).
    const onStage = (event) => {
      if (event.detail?.sceneId !== id) return;
      if (event.detail.stage === 'S2') {
        setPlayback({ phase: 'dwell-s2' });
        emit(events.dwell, {
          sceneId: id,
          stage: 'S2',
          ms: DWELL_S2_MS,
          at: now(),
        });
      }
      if (event.detail.stage === 'S4') setPlayback({ phase: 'dwell-s4' });
    };
    win.addEventListener?.(events.stage, onStage);
    let scene;
    try {
      scene = prev?.footage?.length
        ? await builder.recreateScene(id).then((r) => r?.scene || null)
        : await builder.buildFromPrompt(prev?.prompt || prev?.title, {
            reuseId: id,
          });
    } finally {
      win.removeEventListener?.(events.stage, onStage);
    }
    if (myToken !== token) return;
    if (!scene) return playIndex(index + 1, myToken);
    emit(events.dwell, {
      sceneId: id,
      stage: 'S4',
      ms: DWELL_S4_MS,
      at: now(),
    });
    const ok = await wait(DWELL_S4_MS, myToken);
    if (!ok) return;
    // slow idle orbit is the camera's resting state; move on
    return playIndex(index + 1, myToken);
  }

  function finish() {
    setPlayback({ running: false, phase: 'idle' });
  }

  function start(ids) {
    stop();
    token += 1;
    const queue = orderedIds(ids);
    if (!queue.length) return false;
    setPlayback({ running: true, queue, index: -1, phase: 'travel' });
    void playIndex(0, token);
    return true;
  }

  function next() {
    const pb = store.getState().playback;
    if (!pb?.running) return false;
    if (timer) clearTimeoutImpl(timer);
    token += 1;
    void playIndex(pb.index + 1, token);
    return true;
  }

  function stop() {
    token += 1;
    if (timer) clearTimeoutImpl(timer);
    timer = null;
    const active = store.getState().activeId;
    if (active) store.abortScene(active);
    camera.cancel?.();
    sceneUi.stop?.();
    finish();
    return true;
  }

  /** Play a specific clip (card click / timeline). */
  function playItem(item) {
    if (!item) return;
    sceneUi.playNow(item); // the UI announces gev:scene-playing itself
  }

  function applyScrub(window_) {
    scrubWindow = window_;
    sceneUi.setFilter?.(
      window_
        ? (item) => {
            const t = Date.parse(item.uploadedAt || 0);
            return t >= Date.parse(window_.from) && t <= Date.parse(window_.to);
          }
        : null,
    );
  }

  // Keep the idle queue in sync with the saved scenes (time order) so the
  // panel / tests can see what START will play before it is pressed.
  let syncing = false;
  store.subscribe(() => {
    if (syncing) return;
    const pb = store.getState().playback || {};
    if (pb.running) return;
    const next = orderedIds();
    const cur = pb.queue || [];
    if (next.length === cur.length && next.every((id, i) => id === cur[i]))
      return;
    syncing = true;
    try {
      setPlayback({ queue: next, index: -1 });
    } finally {
      syncing = false;
    }
  });

  return {
    start,
    next,
    stop,
    playItem,
    stopItem: () => sceneUi.stop?.(),
    applyScrub,
    getScrub: () => scrubWindow,
    DWELL_S2_MS,
    DWELL_S4_MS,
  };
}
