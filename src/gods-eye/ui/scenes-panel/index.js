/**
 * Gods-Eye scenes director panel component.
 * @module ui/scenes-panel/index
 */

import { renderSceneCard } from './card.js';

function formatPlayback(pb) {
  if (!pb || !pb.running) return 'IDLE';
  const total = pb.queue?.length || 0;
  const curr = (pb.index ?? 0) + 1;
  let phaseStr = '';
  if (pb.phase === 'dwell-s2') {
    phaseStr = ` · dwell S2 ${pb.dwell ?? 4.2} s`;
  } else if (pb.phase === 'dwell-s4') {
    phaseStr = ` · dwell S4 ${pb.dwell ?? 11} s`;
  } else if (pb.phase && pb.phase !== 'idle') {
    phaseStr = ` · ${pb.phase}`;
  }
  return `PLAYING ${curr}/${total}${phaseStr}`;
}

/**
 * Install the Gods-Eye scenes director panel into the host container.
 *
 * @param {object} params
 * @returns {{element: HTMLElement, destroy: () => void, refresh: () => void, setTab: (tab: string) => void}}
 */
export function installScenesPanel({
  document = globalThis.document,
  window = globalThis.window,
  store,
  host,
  actions = {},
  now = Date.now,
} = {}) {
  const doc = document;
  const targetHost =
    host || doc.querySelector?.('#scene-panel .scene-panel-inner') || doc.body;

  let currentTab = 'active';
  let unsub = null;

  const root = doc.createElement('section');
  root.id = 'ge-scenes';
  root.className = 'ge-scenes';

  const tabBar = doc.createElement('nav');
  tabBar.className = 'ge-scenes-tabs';
  tabBar.setAttribute('role', 'tablist');

  const makeTab = (id, text, tabKey) => {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.id = id;
    btn.className = 'ge-scenes-tab';
    btn.textContent = text;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('data-tab', tabKey);
    btn.addEventListener('click', () => setTab(tabKey));
    return btn;
  };

  const activeTabBtn = makeTab('ge-scenes-tab-active', 'GODS-EYE', 'active');
  const archiveTabBtn = makeTab('ge-scenes-tab-archive', 'ARCHIVE', 'archive');
  const legacyTabBtn = makeTab('ge-scenes-tab-legacy', 'LEGACY', 'legacy');
  tabBar.append(activeTabBtn, archiveTabBtn, legacyTabBtn);
  root.appendChild(tabBar);

  const statusEl = doc.createElement('div');
  statusEl.id = 'ge-scenes-status';
  statusEl.className = 'ge-scenes-status';
  statusEl.textContent = 'IDLE';
  root.appendChild(statusEl);

  const listEl = doc.createElement('div');
  listEl.id = 'ge-scenes-list';
  listEl.className = 'ge-scenes-list';
  root.appendChild(listEl);

  if (targetHost) targetHost.appendChild(root);

  const getNowMs = () =>
    typeof now === 'function' ? now() : (now ?? Date.now());

  function getSortedScenes(filterActive) {
    const state = store?.getState?.() || {};
    const scenes = Object.values(state.scenes || {});
    const nowMs = getNowMs();
    return scenes
      .filter((s) => {
        const arch = s?.lifecycle?.archivedAt
          ? new Date(s.lifecycle.archivedAt).getTime()
          : Infinity;
        return filterActive ? arch > nowMs : arch <= nowMs;
      })
      .sort((a, b) => {
        const ta = new Date(a?.lifecycle?.createdAt || 0).getTime();
        const tb = new Date(b?.lifecycle?.createdAt || 0).getTime();
        return tb - ta;
      });
  }

  function updateLegacyVisibility() {
    if (!targetHost?.children) return;
    const isLegacy = currentTab === 'legacy';
    for (const child of Array.from(targetHost.children)) {
      if (child === root) continue;
      if (child.classList?.contains?.('panel-header')) continue;
      if (child.classList?.contains?.('panel-glow')) continue;
      // START / NEXT / STOP are shared transports: handlers below route them
      // to the active scene engine. Do not hide them with legacy-only tools.
      if (child.querySelector?.('#scene-start-btn')) {
        child.hidden = false;
        continue;
      }
      child.hidden = !isLegacy;
    }
  }

  function setTab(tab) {
    if (typeof syncButtons === 'function') queueMicrotask(syncButtons);
    currentTab = tab;
    activeTabBtn.classList.toggle('is-active', tab === 'active');
    activeTabBtn.setAttribute(
      'aria-selected',
      tab === 'active' ? 'true' : 'false',
    );
    archiveTabBtn.classList.toggle('is-active', tab === 'archive');
    archiveTabBtn.setAttribute(
      'aria-selected',
      tab === 'archive' ? 'true' : 'false',
    );
    legacyTabBtn.classList.toggle('is-active', tab === 'legacy');
    legacyTabBtn.setAttribute(
      'aria-selected',
      tab === 'legacy' ? 'true' : 'false',
    );

    if (tab === 'legacy') {
      listEl.hidden = true;
      statusEl.hidden = true;
      updateLegacyVisibility();
      return;
    }

    listEl.hidden = false;
    statusEl.hidden = false;
    updateLegacyVisibility();
    refresh();
  }

  function refresh() {
    const state = store?.getState?.() || {};
    statusEl.textContent = formatPlayback(state.playback);
    if (currentTab === 'legacy') return;

    if (typeof listEl.replaceChildren === 'function') {
      listEl.replaceChildren();
    } else {
      while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    }

    const scenes = getSortedScenes(currentTab === 'active');
    if (!scenes.length) {
      // Designed empty state (never a blank panel).
      const empty = doc.createElement('p');
      empty.className = 'ge-scenes-empty';
      empty.dataset.state = 'empty';
      empty.textContent =
        currentTab === 'active'
          ? 'No scenes yet. Type a place or incident in the composer and press BUILD SCENE — built scenes are saved here and reopen with zero refetch.'
          : 'No archived scenes. Scenes move here automatically when they age out.';
      listEl.appendChild(empty);
    }
    for (const sc of scenes) {
      listEl.appendChild(
        renderSceneCard({
          document: doc,
          scene: sc,
          actions,
          now,
          activeId: state.activeId,
        }),
      );
    }
  }

  const startBtn = doc.querySelector?.('#scene-start-btn');
  const nextBtn = doc.querySelector?.('#scene-next-btn');
  const stopBtn = doc.querySelector?.('#scene-stop-btn');

  const onStart = (e) => {
    if (currentTab !== 'legacy') {
      e.preventDefault();
      e.stopImmediatePropagation?.();
      actions.start?.(getSortedScenes(true).map((s) => s.id));
    }
  };
  const onNext = (e) => {
    if (currentTab !== 'legacy') {
      e.preventDefault();
      e.stopImmediatePropagation?.();
      actions.next?.();
    }
  };
  const onStop = (e) => {
    if (currentTab !== 'legacy') {
      e.preventDefault();
      e.stopImmediatePropagation?.();
      actions.stop?.();
    }
  };

  startBtn?.addEventListener?.('click', onStart, true);
  nextBtn?.addEventListener?.('click', onNext, true);
  stopBtn?.addEventListener?.('click', onStop, true);

  // The legacy director disables STOP while idle and START/NEXT while it runs.
  // On the Gods-Eye tabs the buttons mirror OUR playback state instead.
  function syncButtons() {
    if (currentTab === 'legacy') return;
    const running = Boolean(store?.getState?.()?.playback?.running);
    // Only write when different — a same-value write still fires the
    // MutationObserver below and would loop forever.
    const want = [
      [startBtn, running],
      [nextBtn, !running],
      [stopBtn, !running],
    ];
    for (const [btn, disabled] of want)
      if (btn && btn.disabled !== disabled) btn.disabled = disabled;
  }
  const buttonSync = store?.subscribe ? store.subscribe(syncButtons) : null;
  let buttonObserver = null;
  if (typeof MutationObserver === 'function' && stopBtn && startBtn) {
    buttonObserver = new MutationObserver(() => syncButtons());
    for (const b of [startBtn, nextBtn, stopBtn])
      if (b)
        buttonObserver.observe(b, {
          attributes: true,
          attributeFilter: ['disabled'],
        });
  }
  syncButtons();

  if (store?.subscribe) unsub = store.subscribe(() => refresh());
  setTab('active');

  function destroy() {
    if (unsub) unsub();
    startBtn?.removeEventListener?.('click', onStart, true);
    nextBtn?.removeEventListener?.('click', onNext, true);
    stopBtn?.removeEventListener?.('click', onStop, true);
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return { element: root, destroy, refresh, setTab };
}
