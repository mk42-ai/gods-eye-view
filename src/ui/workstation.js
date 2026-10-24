import { setIconContent } from './icons/layerIcon.js';
import { runFirstRunChoice } from '../firstRunExperience.js';
import { installMiniChat } from '../ondemand/miniChat.js';
import { installSourcesSidebar } from '../gods-eye/ui/sidebar/index.js';
import { createIncidentComposer } from '../incidents/ui/composer.js';
import { createIncidentClient } from '../incidents/client.js';

/** Layout owner only: moves existing controls, never replaces their state owners. */
export function installWorkstation({
  document: doc = document,
  window: win = window,
} = {}) {
  const root = doc.documentElement;
  root.dataset.workstation = '1';
  // Served revision (build/vite.js `GEV_BUILD_ID`): lets a verifier prove the
  // preview is the commit under test. Never a secret.
  root.dataset.geBuild = String(import.meta.env?.GEV_BUILD_ID || '');
  const byId = (id) => doc.getElementById(id);
  // Visible build badge (2026-10-24): the served short SHA in the header, so
  // "which build is this link serving?" is answerable from a screenshot.
  {
    const badge = byId('workstation-build-id');
    if (badge && root.dataset.geBuild) {
      badge.textContent = `build ${root.dataset.geBuild}`;
      badge.hidden = false;
    }
  }
  const view = byId('workstation-view');
  const drawer = byId('workstation-drawer');
  const body = byId('workstation-drawer-body');
  const nav = byId('workstation-nav');
  const groups = new Map();
  let active = null;
  let state = 'loading';
  let fallbackZoom = 5;
  let location = { lat: 30.2672, lon: -97.7431, name: 'Austin' };
  let tileGeneration = 0;
  let mapCleanup = () => {};
  let openButton = null;
  let observer;
  const abort = new AbortController();

  function move(id, parent) {
    const node = byId(id);
    if (node && node.parentElement !== parent) parent.appendChild(node);
    return node;
  }
  for (const id of [
    'cesiumContainer',
    'world-overlay-root',
    'world-overlay-actions',
    'intel-hud',
    'safe-frame-overlay',
  ])
    move(id, view);
  move('title-bar', byId('workstation-brand'));
  move('top-center-actions', byId('workstation-map-actions'));
  for (const [id, icon] of [
    ['tilt-map-view', 'layers'],
    ['north-up-view', 'compass'],
    ['reset-globe-view', 'globe'],
  ]) {
    const target = byId(id)?.querySelector('span:last-child');
    if (target) {
      target.setAttribute(
        'class',
        id === 'north-up-view'
          ? 'camera-compass-needle'
          : 'workstation-map-icon',
      );
      setIconContent(target, icon);
    }
  }
  byId('loading-screen')?.classList.add('hidden');
  function group(name) {
    if (!groups.has(name)) {
      const section = doc.createElement('section');
      section.className = 'workstation-group';
      section.dataset.workstationContent = name;
      section.hidden = true;
      body.appendChild(section);
      groups.set(name, section);
    }
    return groups.get(name);
  }
  // DISPLAY / CCTV / CONTEXT used to be three loose floating modules (plus
  // the BAND/BITS/LVL edge readout). They are now ONE grouped HUD control
  // stack in a single drawer section, each module keeping its own owner.
  const panelIds = {
    hud: [
      'ws-hud-readout',
      'pp-toggles',
      'style-indicator',
      'cctv-panel',
      'global-context-panel',
    ],
    layers: ['data-panel'],
    scenes: ['scene-panel'],
    location: ['command-dock'],
    help: ['first-run-launcher'],
  };
  const PANEL_ALIASES = { display: 'hud', cctv: 'hud', context: 'hud' };
  {
    // Compact read-only HUD readout (BAND / BITS / LVL) folded into the stack.
    const readout = doc.createElement('p');
    readout.id = 'ws-hud-readout';
    readout.className = 'ws-hud-readout';
    const edge = doc.querySelector('#intel-hud .hud-right-edge');
    readout.textContent = edge
      ? [...edge.children]
          .map((n) => n.textContent.trim())
          .filter(Boolean)
          .join(' · ')
      : 'BAND: PAN · BITS: 11 · LVL: 1A';
    doc.body.appendChild(readout);
  }
  for (const [name, ids] of Object.entries(panelIds)) {
    const host = group(name);
    const notice = doc.createElement('p');
    notice.className = 'workstation-requires-map';
    notice.textContent =
      '3D controls become available when the map is ready. Sources, location lookup and standard chat work independently.';
    host.appendChild(notice);
    for (const id of ids) move(id, host);
  }
  const retryRoads = doc.createElement('button');
  retryRoads.type = 'button';
  retryRoads.id = 'workstation-retry-roads';
  retryRoads.textContent = 'Retry roads (Overpass)';
  retryRoads.addEventListener('click', async () => {
    const manager = win.__godsEyeView?.dataManager;
    if (!manager) return;
    retryRoads.disabled = true;
    try {
      await manager.setEnabled('traffic', false);
      await manager.setEnabled('traffic', true);
    } finally {
      retryRoads.disabled = false;
    }
  });
  group('layers').prepend(retryRoads);
  group('help').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-first-run-choice]');
    if (!button) return;
    const style = win.__godsEyeView?.styleManager;
    const manager = win.__godsEyeView?.dataManager;
    const status = byId('first-run-launcher')?.querySelector(
      '[data-first-run-status]',
    );
    if (!style || state !== 'ready') {
      if (status)
        status.textContent =
          'This mission needs the 3D map. Retry 3D, or continue using the 2D location lookup and chat.';
      return;
    }
    button.disabled = true;
    try {
      const result = await runFirstRunChoice(button.dataset.firstRunChoice, {
        setContextMode: (mode) => style.setContextMode(mode),
        setLayerEnabled: (id) =>
          manager.setEnabled(id, true, { origin: 'user' }),
        flyToGlobe: () => style.resetToGlobeView(),
      });
      if (result.ok) closePanel();
      else if (status)
        status.textContent =
          'One or more live sources are unavailable. Check Layers for their individual status; no data was simulated.';
    } catch (error) {
      if (status) status.textContent = `Mission unavailable: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });
  const sources = installSourcesSidebar({
    document: doc,
    window: win,
    host: group('sources'),
    storage: win.localStorage,
    onToggle: (platform, enabled) =>
      win.__godsEye?.setSourceEnabled(platform, enabled),
  });
  // Use the original Sources control and its original preferences/state owner.
  const sourceToggle = byId('ge-sources-toggle');
  const sourcePlaceholder = nav.querySelector(
    '[data-workstation-panel="sources"]',
  );
  sourceToggle.dataset.workstationPanel = 'sources';
  sourceToggle.setAttribute('aria-controls', 'workstation-drawer');
  sourcePlaceholder.replaceWith(sourceToggle);
  const chat = installMiniChat({
    document: doc,
    window: win,
    signal: abort.signal,
  });
  group('chat');

  function adaptPanels() {
    for (const [name, ids] of Object.entries(panelIds))
      for (const id of ids) move(id, group(name));
    const chatNode = byId('ondemand-mini-chat');
    if (chatNode) move('ondemand-mini-chat', group('chat'));
    const evidence = byId('ge-scene-root');
    if (evidence) move('ge-scene-root', byId('workstation-evidence'));
    const credit = byId('cesium-credits');
    if (credit) move('cesium-credits', view);
    const composerNode = byId('incident-composer');
    if (composerNode) {
      byId('workstation-build-placeholder')?.remove();
      move('incident-composer', byId('workstation-build-host'));
    }
  }

  function expandLegacy(name) {
    for (const id of panelIds[name] || []) {
      const node = byId(id);
      const style = win.__godsEyeView?.styleManager;
      if (node?.classList.contains('panel-collapsible')) {
        if (style?.setPanelCollapsed)
          style.setPanelCollapsed(id, false, {
            persist: false,
            syncShare: false,
          });
        else node.classList.remove('collapsed');
      }
    }
    if (name === 'help') {
      const launcher = byId('first-run-launcher');
      if (launcher) {
        launcher.hidden = false;
        launcher.classList.add('visible');
      }
    }
    if (name === 'location') {
      byId('location-bar')?.classList.remove('collapsed');
      byId('control-panel')?.classList.remove('collapsed');
    }
  }
  function closePanel({ restoreFocus = true } = {}) {
    active = null;
    drawer.hidden = true;
    root.removeAttribute('data-workstation-panel');
    sources.setOpen(false);
    chat.close();
    nav
      .querySelectorAll('[data-workstation-panel]')
      .forEach((b) => b.setAttribute('aria-expanded', 'false'));
    if (restoreFocus) openButton?.focus();
    win.__godsEyeView?.viewer?.resize?.();
  }
  function openPanel(name, button = null) {
    name = PANEL_ALIASES[name] || name;
    if (active === name) return closePanel();
    active = name;
    openButton =
      button || nav.querySelector(`[data-workstation-panel="${name}"]`);
    for (const [key, node] of groups) node.hidden = key !== name;
    drawer.hidden = false;
    root.dataset.workstationPanel = name;
    byId('workstation-panel-title').textContent =
      {
        sources: 'Sources',
        hud: 'HUD controls · Display / CCTV / Context',
        layers: 'Data layers',
        scenes: 'Scenes',
        location: 'Location & voice',
        chat: 'Standard chat',
        help: 'Quick start',
      }[name] || name;
    nav
      .querySelectorAll('[data-workstation-panel]')
      .forEach((b) =>
        b.setAttribute('aria-expanded', String(b === openButton)),
      );
    sources.setOpen(name === 'sources');
    if (name === 'chat')
      chat.open({
        objectType: 'hudSummary',
        objectId: 'workstation-chat',
        label: 'Standard chat',
        fields: { location, mapState: state },
        starters: [
          'Help me explore this location',
          'Explain the sources available here',
        ],
      });
    else chat.close();
    adaptPanels();
    expandLegacy(name);
    byId('workstation-close-panel').focus();
    win.__godsEyeView?.viewer?.resize?.();
  }
  nav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-workstation-panel]');
    if (button) openPanel(button.dataset.workstationPanel, button);
  });
  byId('workstation-close-panel').addEventListener('click', () => closePanel());
  win.addEventListener('workstation:reveal-panel', (event) => {
    const id = event.detail?.panelId;
    const groupName =
      id === 'radio-panel'
        ? 'hud'
        : id === 'control-panel' || id === 'location-bar'
          ? 'location'
          : Object.keys(panelIds).find((name) => panelIds[name].includes(id));
    if (groupName && active !== groupName) openPanel(groupName);
  });
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && active) {
      event.preventDefault();
      closePanel();
    }
    if (event.key === 'Tab' && active && win.innerWidth < 1000) {
      const focusable = [
        ...drawer.querySelectorAll(
          'button,input,select,textarea,a[href],[tabindex="0"]',
        ),
      ].filter((node) => !node.disabled && node.getClientRects().length);
      const first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && doc.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  drawer.addEventListener('click', (event) => {
    if (event.target.closest('#ondemand-mini-chat-close')) closePanel();
  });

  const params = new URLSearchParams(win.location.hash.slice(1));
  if (
    Number.isFinite(Number(params.get('lat'))) &&
    params.has('lat') &&
    params.has('lon')
  )
    location = {
      lat: +params.get('lat'),
      lon: +params.get('lon'),
      name: 'Selected coordinates',
    };
  function setRenderState(next, detail = '') {
    state = next;
    root.dataset.renderState = next;
    const statusLabels = {
      ready: '3D MAP',
      loading: 'STARTING MAP',
      fallback: '2D / RECOVERY',
    };
    byId('workstation-render-status').textContent =
      statusLabels[next] || '2D / RECOVERY';
    byId('workstation-render-status').title = root.dataset.geBuild
      ? `build ${root.dataset.geBuild}`
      : '';
    byId('workstation-render-status').dataset.state = next;
    byId('workstation-map-status').hidden = next === 'ready';
    byId('workstation-map-message').textContent =
      detail ||
      (next === 'loading'
        ? 'Loading 3D graphics. All navigation and chat remain available.'
        : '3D graphics are unavailable. Use the 2D map, look up a location, or retry 3D.');
    byId('workstation-2d').hidden = next !== 'fallback';
    for (const [name, ids] of Object.entries(panelIds)) {
      for (const id of ids) {
        const node = byId(id);
        if (node && name !== 'help') node.inert = next !== 'ready';
      }
    }
  }
  function renderRaster() {
    const host = byId('workstation-raster-tiles');
    const generation = ++tileGeneration;
    host.replaceChildren();
    const lat = Math.max(-85, Math.min(85, location.lat));
    const n = 2 ** fallbackZoom;
    const x = ((location.lon + 180) / 360) * n;
    const phi = (lat * Math.PI) / 180;
    const y =
      ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n;
    host.style.transform = `translate(calc(-50% - ${(x - Math.floor(x) - 0.5) * 256}px), calc(-50% - ${(y - Math.floor(y) - 0.5) * 256}px))`;
    let loaded = 0;
    const label = byId('workstation-raster-status');
    label.textContent = 'Loading OpenStreetMap tiles…';
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const image = doc.createElement('img');
        image.alt = '';
        image.width = image.height = 256;
        image.referrerPolicy = 'no-referrer';
        const tx = (Math.floor(x) + dx + n) % n,
          ty = Math.max(0, Math.min(n - 1, Math.floor(y) + dy));
        image.src = `https://tile.openstreetmap.org/${fallbackZoom}/${tx}/${ty}.png`;
        image.addEventListener('load', () => {
          if (generation === tileGeneration) {
            loaded++;
            label.textContent = `2D map · ${location.name} · ${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}`;
          }
        });
        image.addEventListener('error', () => {
          if (generation === tileGeneration && !loaded)
            label.textContent = `Map tiles unavailable · ${location.lat.toFixed(4)}, ${location.lon.toFixed(4)} · Retry map or look up another location.`;
        });
        host.appendChild(image);
      }
  }
  function useFallback(detail) {
    setRenderState('fallback', detail);
    win.dispatchEvent(new CustomEvent('workstation:fallback'));
    const viewer = win.__godsEyeView?.viewer;
    if (viewer) viewer.useDefaultRenderLoop = false;
    renderRaster();
  }
  byId('workstation-use-2d').addEventListener('click', () =>
    useFallback(
      '2D mode selected. 3D scene animation is paused; source selection and standard chat remain available.',
    ),
  );
  for (const id of ['workstation-retry', 'workstation-retry-map'])
    byId(id).addEventListener('click', (event) => {
      event.preventDefault();
      win.sessionStorage.removeItem('workstation:2d');
      win.location.reload();
    });
  for (const [id, delta] of [
    ['workstation-zoom-in', 1],
    ['workstation-zoom-out', -1],
  ])
    byId(id).addEventListener('click', () => {
      fallbackZoom = Math.max(2, Math.min(18, fallbackZoom + delta));
      renderRaster();
    });
  byId('workstation-retry-tiles').addEventListener('click', renderRaster);
  // ------------------------------------------------------------ BUILD SCENE
  // Root cause (2026-10-23): the composer handed the prompt to the scene
  // engine only when the 3D map was already 'ready'. While the map was still
  // starting, or in 2D recovery (no WebGL / black preview), the engine did
  // not exist, the click fell through to a geocode-only lookup and the
  // composer immediately reported "done" — no scene, no status, no error.
  // Now: the engine is always obtained (waiting for the map up to its 12 s
  // deadline, else a 2D engine), every state-machine stage is shown as a
  // chip, and every failure ends in a designed error state with Retry.
  const STAGES = [
    'parsing',
    'geocoded',
    'routing',
    'flying',
    'fetching',
    'ranked',
    'playing',
    'saved',
  ];
  const STAGE_LABELS = {
    idle: 'Idle',
    parsing: 'Parsing',
    geocoded: 'Geocoded',
    routing: 'Routing',
    flying: 'Flying in',
    fetching: 'Fetching',
    ranked: 'Ranked',
    playing: 'Playing',
    saved: 'Saved',
    error: 'Error',
  };
  let enginePromise = null;
  let engine2d = false;
  let lastPrompt = '';
  let buildSeq = 0;
  // Hard ceiling for one build (route 4 s + S0→S4 flight ≈ 12 s + footage cap
  // 15 s + slack). A build that is still not at S4 by then ends in the
  // designed error state with Retry instead of a spinner that never stops.
  const BUILD_WATCHDOG_MS = 75_000;
  let buildWatchdog = null;
  function composerResult() {
    const node = byId('incident-composer-result');
    if (node) node.hidden = false;
    return node;
  }
  // BUILD SCENE button: disabled + "BUILDING…" + spinner while a build runs,
  // re-enabled (label restored) when it ends — success or error. The form's
  // data-state drives the CSS; `aria-busy` tells assistive tech the same.
  function setBuilding(on, label = 'BUILDING…') {
    const btn = byId('incident-composer-submit');
    const form = byId('incident-composer');
    if (btn) {
      if (on) {
        btn.dataset.idleLabel = btn.dataset.idleLabel || btn.textContent;
        btn.textContent = label;
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
      } else {
        btn.textContent = btn.dataset.idleLabel || 'BUILD SCENE';
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
      }
    }
    if (form) form.dataset.building = on ? '1' : '0';
    root.dataset.geBuilding = on ? '1' : '0';
  }
  function endBuild() {
    if (buildWatchdog) {
      clearTimeout(buildWatchdog);
      buildWatchdog = null;
    }
    setBuilding(false);
  }
  // Visible S0→S4 fly-in progress line (2026-10-24). Fed by the engine's
  // `gev:scene-stage` events; reset at the start of every build.
  const FLY_STAGES = ['S0', 'S1', 'S2', 'S3', 'S4'];
  const FLY_NOTE_STOPPED = 'build stopped';
  const FLY_NOTE_ARRIVED = 'camera arrived';
  const FLY_NOTE_WAITING = 'waiting for route';
  function renderFlyProgress(stage, { error = false, note = '' } = {}) {
    const bar = byId('workstation-build-progress');
    if (!bar) return;
    const reached = FLY_STAGES.indexOf(stage);
    bar.hidden = false;
    bar.dataset.stage = stage || '';
    bar.dataset.state = error ? 'error' : reached >= 4 ? 'done' : 'busy';
    for (const li of bar.querySelectorAll('li[data-stage]')) {
      const i = FLY_STAGES.indexOf(li.dataset.stage);
      li.dataset.status =
        error && i === Math.max(0, reached)
          ? 'error'
          : i < reached || (i === reached && reached === 4)
            ? 'done'
            : i === reached
              ? 'active'
              : 'pending';
    }
    const noteNode = byId('workstation-build-progress-note');
    if (noteNode)
      noteNode.textContent =
        note ||
        (error
          ? FLY_NOTE_STOPPED
          : reached < 0
            ? FLY_NOTE_WAITING
            : reached >= 4
              ? FLY_NOTE_ARRIVED
              : `stage ${reached + 1} of 5`);
  }
  const onFlyStage = (event) => {
    const stage = event.detail?.stage;
    if (FLY_STAGES.includes(stage)) renderFlyProgress(stage);
  };
  win.addEventListener('gev:scene-stage', onFlyStage);
  function renderStages(current, { error = null } = {}) {
    const chipsNode = byId('incident-composer-chips');
    const form = byId('incident-composer');
    if (!chipsNode || !form) return;
    const reached = STAGES.indexOf(current);
    chipsNode.replaceChildren();
    chipsNode.dataset.stage = current;
    for (const [i, stage] of STAGES.entries()) {
      const chip = doc.createElement('span');
      chip.className = 'incident-composer__chip';
      chip.dataset.step = stage;
      chip.dataset.status =
        error && i === Math.max(0, reached)
          ? 'error'
          : i < reached || (i === reached && stage === 'saved')
            ? 'done'
            : i === reached
              ? 'active'
              : 'pending';
      chip.textContent = STAGE_LABELS[stage];
      chipsNode.appendChild(chip);
    }
    form.dataset.state = error
      ? 'error'
      : current === 'saved'
        ? 'done'
        : 'busy';
    form.dataset.geStage = current;
    root.dataset.geBuildStage = error ? 'error' : current;
  }
  function showBuildError(message) {
    renderFlyProgress(byId('workstation-build-progress')?.dataset.stage || '', {
      error: true,
    });
    const node = composerResult();
    if (!node) return;
    node.replaceChildren();
    const box = doc.createElement('div');
    box.className =
      'incident-composer__message incident-composer__message--error ws-build-error';
    box.setAttribute('role', 'alert');
    const text = doc.createElement('span');
    text.textContent = message;
    const retry = doc.createElement('button');
    retry.type = 'button';
    retry.id = 'workstation-build-retry';
    retry.className = 'ws-build-retry';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => {
      if (lastPrompt) void runBuild(lastPrompt);
    });
    box.append(text, retry);
    node.appendChild(box);
  }
  function showBuildInfo(message, kind = 'info') {
    const node = composerResult();
    if (!node) return;
    node.replaceChildren();
    const p = doc.createElement('p');
    p.className = `incident-composer__message incident-composer__message--${kind}`;
    p.textContent = message;
    node.appendChild(p);
  }
  function fallbackFly(wp) {
    // 2D recovery camera: zoom the raster map through the same S0→S4 ladder.
    const alt = Number(wp.alt) || 300;
    location = { lat: wp.lat, lon: wp.lon, name: wp.name || location.name };
    fallbackZoom = Math.max(
      2,
      Math.min(17, Math.round(Math.log2(40_000_000 / Math.max(alt, 150)))),
    );
    const next = new URLSearchParams(win.location.hash.slice(1));
    next.set('lat', String(wp.lat));
    next.set('lon', String(wp.lon));
    next.set('alt', String(Math.round(alt)));
    win.history.replaceState(
      null,
      '',
      `${win.location.pathname}${win.location.search}#${next}`,
    );
    if (state === 'fallback') renderRaster();
  }
  function waitForMap(ms) {
    if (state !== 'loading') return Promise.resolve(state);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        win.removeEventListener('workstation:ready', done);
        win.removeEventListener('workstation:fallback', done);
        resolve(state);
      };
      const timer = setTimeout(done, ms);
      win.addEventListener('workstation:ready', done);
      win.addEventListener('workstation:fallback', done);
    });
  }
  async function ensureEngine() {
    if (win.__godsEye && !(engine2d && state === 'ready')) return win.__godsEye;
    if (state === 'loading') {
      showBuildInfo(
        'Starting the map… the scene will build as soon as 3D is ready (or in 2D within 12 s).',
      );
      await waitForMap(13000);
      if (win.__godsEye) return win.__godsEye;
    }
    if (!enginePromise) {
      enginePromise = import('../gods-eye/orchestrator.js')
        .then(({ installGodsEye }) => {
          if (win.__godsEye) return win.__godsEye;
          const view = win.__godsEyeView;
          engine2d = !view?.viewer;
          return installGodsEye({
            viewer: view?.viewer || null,
            Cesium: view?.viewer ? win.Cesium : null,
            sceneDirector: view?.sceneDirector || null,
            document: doc,
            window: win,
            fallbackFly,
          });
        })
        .finally(() => {
          enginePromise = null;
        });
    }
    return enginePromise;
  }
  const onStatus = (event) => {
    const { status } = event.detail || {};
    if (!status || (!STAGES.includes(status) && status !== 'error')) return;
    const engineNow = win.__godsEye;
    const scene = engineNow?.getState?.().scenes?.[event.detail.sceneId];
    if (status === 'error') {
      renderStages(
        root.dataset.geBuildStage && STAGES.includes(root.dataset.geBuildStage)
          ? root.dataset.geBuildStage
          : 'parsing',
        { error: true },
      );
      showBuildError(
        `Scene failed: ${scene?.error?.message || 'unknown error'}. Check the place name and retry.`,
      );
      endBuild();
      return;
    }
    renderStages(status);
    if (status === 'saved' || status === 'playing') {
      const n = scene?.footage?.length || 0;
      const fixture = scene?.footage?.some?.((f) => f.fixture);
      const degraded = [];
      if (scene?.route?.fallback)
        degraded.push('route agent unavailable — great-circle approach');
      const srcs = Object.entries(scene?.sources || {})
        .filter(([, v]) => ['error', 'quota', 'inactive'].includes(v?.status))
        .map(([k, v]) => `${k} ${v.status}`);
      if (srcs.length) degraded.push(`sources: ${srcs.join(', ')}`);
      showBuildInfo(
        `Scene “${scene?.title || lastPrompt}” ${status === 'saved' ? 'saved' : 'playing'} · ${n} clip${n === 1 ? '' : 's'}${fixture ? ' · FIXTURE evidence (live sources returned 0)' : ''}${engine2d ? ' · 2D mode' : ''}${degraded.length ? ` · degraded: ${degraded.join(' · ')}` : ''}.`,
        'ok',
      );
      if (status === 'saved') {
        endBuild();
        root.dataset.geBuildsDone = String(
          (Number(root.dataset.geBuildsDone) || 0) + 1,
        );
      }
    } else {
      showBuildInfo(`${STAGE_LABELS[status]}… “${lastPrompt}”`);
    }
  };
  win.addEventListener('gev:scene-status', onStatus);
  async function runBuild(text) {
    const seq = ++buildSeq;
    lastPrompt = text;
    root.dataset.geBuildsStarted = String(
      (Number(root.dataset.geBuildsStarted) || 0) + 1,
    );
    setBuilding(true);
    if (buildWatchdog) clearTimeout(buildWatchdog);
    buildWatchdog = setTimeout(() => {
      if (seq !== buildSeq) return;
      const latest = win.__godsEye?.getState?.();
      const active = latest?.scenes?.[latest.activeId];
      if (active && ['playing', 'saved'].includes(active.status)) {
        endBuild();
        return;
      }
      console.warn(
        '[Workstation] build watchdog fired at stage',
        root.dataset.geBuildStage || 'parsing',
      );
      renderStages(
        STAGES.includes(root.dataset.geBuildStage)
          ? root.dataset.geBuildStage
          : 'parsing',
        { error: true },
      );
      showBuildError(
        `Scene build stalled at “${STAGE_LABELS[root.dataset.geBuildStage] || 'Parsing'}” after ${Math.round(BUILD_WATCHDOG_MS / 1000)} s. Retry the command.`,
      );
      endBuild();
    }, BUILD_WATCHDOG_MS);
    renderStages('parsing');
    renderFlyProgress('', { note: 'parsing prompt' });
    showBuildInfo(`Parsing “${text}”…`);
    try {
      const eng = await ensureEngine();
      if (seq !== buildSeq) return;
      if (!eng?.buildFromPrompt) throw new Error('scene engine unavailable');
      const scene = await eng.buildFromPrompt(text);
      if (seq !== buildSeq) return;
      if (!scene) {
        const latest = eng.getState?.();
        const active = latest?.scenes?.[latest.activeId];
        if (active?.status === 'error')
          showBuildError(
            `Scene failed: ${active.error?.message || 'unknown error'}. Check the place name and retry.`,
          );
        else if (!active)
          showBuildError(
            'No scene was built — the place is outside the AOI register and was not added. Retry and accept “Add to register”, or name a registered place.',
          );
        else
          showBuildError(
            'The build was interrupted before the camera arrived. Retry the command.',
          );
        renderStages(
          STAGES.includes(active?.status) ? active.status : 'parsing',
          { error: true },
        );
        endBuild();
      } else if (
        !['playing', 'saved'].includes(scene.status) &&
        root.dataset.geBuildStage !== 'saved'
      ) {
        endBuild();
      }
    } catch (error) {
      if (seq !== buildSeq) return;
      console.warn(
        '[Workstation] build failed:',
        error?.message || String(error),
      );
      renderStages('parsing', { error: true });
      showBuildError(
        `Scene failed: ${error?.message || 'unknown error'}. Retry the command.`,
      );
      endBuild();
    }
  }
  const composer = createIncidentComposer({
    document: doc,
    client: createIncidentClient(),
    onFootageCommand(command) {
      void runBuild(command.raw);
      return { handled: true, managed: true };
    },
  });
  byId('workstation-build-placeholder')?.remove();
  byId('workstation-build-host').appendChild(composer.element);

  observer = new MutationObserver(() => adaptPanels());
  // Portals are added at body level. Watching animated HUD text/subtrees here
  // needlessly remeasured every control on every render frame.
  observer.observe(doc.body, { childList: true });
  setRenderState('loading');
  const api = {
    chat,
    composer,
    sources,
    runBuild,
    ensureEngine,
    fallbackFly,
    openPanel,
    closePanel,
    useFallback,
    setRenderState,
    getState: () => ({ renderState: state, panel: active, location }),
    ready(components) {
      const viewer = components.scene.viewer;
      mapCleanup();
      setRenderState('ready');
      // Root cause of the stuck build: the 12 s startup deadline switched to
      // 2D (render loop OFF); when Cesium finished later the state became
      // 'ready' but the loop stayed off, so camera.flyTo never completed and
      // the scene sat in 'flying'. Restore the loop whenever 3D becomes ready.
      viewer.useDefaultRenderLoop = !doc.hidden;
      viewer.scene?.requestRender?.();
      adaptPanels();
      if (active) expandLegacy(active);
      const lost = (event) => {
        event.preventDefault();
        useFallback(
          'WebGL context was lost. Your controls and chat are intact. Retry 3D to restore the globe.',
        );
      };
      const restored = () => {
        byId('workstation-map-message').textContent =
          'Graphics context restored. Retry 3D to rebuild the scene safely.';
      };
      viewer.canvas.addEventListener('webglcontextlost', lost);
      viewer.canvas.addEventListener('webglcontextrestored', restored);
      const removeError = viewer.scene.renderError.addEventListener(
        (_scene, error) =>
          useFallback(
            `3D renderer stopped: ${error?.message || 'graphics failure'}. Retry 3D or continue in 2D.`,
          ),
      );
      mapCleanup = () => {
        viewer.canvas.removeEventListener('webglcontextlost', lost);
        viewer.canvas.removeEventListener('webglcontextrestored', restored);
        removeError?.();
      };
      win.dispatchEvent(new CustomEvent('workstation:ready'));
    },
    destroy() {
      win.removeEventListener('gev:scene-status', onStatus);
      win.removeEventListener('gev:scene-stage', onFlyStage);
      if (buildWatchdog) clearTimeout(buildWatchdog);
      observer.disconnect();
      abort.abort();
      mapCleanup();
      composer.destroy();
      sources.destroy();
    },
  };
  win.__workstation = api;
  return api;
}
