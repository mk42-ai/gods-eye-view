/**
 * Incident scenes — application wiring (src/app/tools.js → installIncidentScenes).
 *
 *  • loads GET /incidents/list and turns every incident scene into a Scene
 *    Director scene (AOI-checked), replacing earlier incident scenes
 *  • renders markers + AOI outlines (overlay.js) with per-group toggles and
 *    a legend of the 10 category icons inside the SCENES panel
 *  • marker click → popover: title, summary, sources (url + published_at),
 *    confidence badge, PLAY SCENE and an ASK ONDEMAND mini chat carrying
 *    incident_id / aoi / sources / timestamps as object context
 *  • PAUSE / RESUME / PREV NEXT / scrub bar for the selected scene
 *  • REFRESH LIVE → POST /refresh (OnDemand-mediated plugins)
 *  • bottom composer (composer.js) → /locate → /ingest → new scene → play
 */
import {
  createIncidentClient,
  incidentChatContext,
  INCIDENT_EVENTS,
} from '../client.js';
import {
  buildScenes,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  INCIDENT_CATEGORIES,
} from '../model.js';
import { createIncidentOverlay } from './overlay.js';
import { setIconContent } from '../../ui/icons/layerIcon.js';
import { createIncidentComposer } from './composer.js';
import { canMirrorLocationDraft } from './draftOwnership.js';
import { createSceneFootageControls } from './sceneFootageControls.js';
import { ASK_OBJECT_EVENT } from '../../ondemand/miniChat.js';
import {
  buildPlannedScene,
  createGeographicSceneStore,
} from '../../scenes/geographicScene.js';
import { createSceneStudio } from './sceneStudio.js';
import { createSceneCamera } from './sceneCamera.js';
import { resolveIncidentGate } from '../../aoi/sceneGate.js';
import { createSceneLibrary } from './sceneLibrary.js';
import { installIncidentDiagnostics } from './diagnostics.js';
import { createGeographicOverlay } from './geographicOverlay.js';
import { createSceneGeometryLayer } from './sceneGeometryLayer.js';

export const INCIDENT_PANEL_ID = 'incident-panel';
export const INCIDENT_POPOVER_ID = 'incident-popover';
export const INCIDENT_LEGEND_ID = 'incident-legend';
export const AOI_TOGGLES_ID = 'incident-aoi-toggles';
export const PLAYBACK_BAR_ID = 'incident-playback';

const GROUP_ORDER = ['country', 'maritime', 'border', 'waters', 'presence'];

function el(doc, tag, { id, className, text, attrs } = {}) {
  const node = doc.createElement(tag);
  if (id) node.id = id;
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  return node;
}

export function installIncidentScenes({
  viewer,
  sceneDirector,
  dataManager,
  signal,
  document: doc = globalThis.document,
  window: win = globalThis.window,
  fetch: fetchImpl,
  storage,
} = {}) {
  if (!doc || !viewer || !sceneDirector) return null;
  const client = createIncidentClient({ fetch: fetchImpl, storage });
  const geographicStore = createGeographicSceneStore(
    storage || win.localStorage,
  );
  const geographicOverlay = createGeographicOverlay(viewer, { document: doc });
  const geometryLayer = createSceneGeometryLayer(viewer, { document: doc });
  let activeGeographicScene = null;
  let lastConstructGeometry = null;
  let sceneLibrary = null;
  let sidebar = null;
  let studio = null;
  let sceneCamera = null;
  let sceneFootageControls = null;
  let removeCameraSubscription = null;
  let refinementContext = null;
  const overlay = createIncidentOverlay(viewer, {
    onPick: (incident) => openPopover(incident),
  });
  const state = {
    incidents: [],
    scenes: [],
    rejected: { count: 0, items: [] },
    perAoi: {},
    groups: {},
    groupVisibility: {},
    lastList: null,
    popoverIncident: null,
  };

  // ---------------------------------------------------------------- panel
  const scenePanel = doc.getElementById('scene-panel');
  const host =
    scenePanel?.querySelector?.('.scene-panel-inner') || scenePanel || doc.body;
  const panel = el(doc, 'section', {
    id: INCIDENT_PANEL_ID,
    className: 'incident-panel',
    attrs: { 'aria-label': 'UAE AOI incident scenes' },
  });
  const header = el(doc, 'div', { className: 'incident-panel__header' });
  const title = el(doc, 'span', {
    className: 'incident-panel__title',
    text: 'AOI incidents',
  });
  const counts = el(doc, 'span', {
    id: `${INCIDENT_PANEL_ID}-counts`,
    className: 'incident-panel__counts',
    text: '…',
  });
  const refreshBtn = el(doc, 'button', {
    id: `${INCIDENT_PANEL_ID}-refresh`,
    className: 'scene-btn incident-panel__refresh',
    text: 'Refresh',
    attrs: {
      type: 'button',
      title: 'Pull live incidents through OnDemand plugins (POST /refresh)',
    },
  });
  setIconContent(refreshBtn, 'refresh-cw', { text: 'Refresh' }, doc);
  header.append(title, counts, refreshBtn);

  // playback bar: PAUSE / RESUME / PREV / NEXT / scrub
  const playback = el(doc, 'div', {
    id: PLAYBACK_BAR_ID,
    className: 'incident-playback',
  });
  const playBtn = el(doc, 'button', {
    id: `${PLAYBACK_BAR_ID}-play`,
    className: 'scene-btn',
    text: 'Play',
    attrs: { type: 'button' },
  });
  const pauseBtn = el(doc, 'button', {
    id: `${PLAYBACK_BAR_ID}-pause`,
    className: 'scene-btn',
    text: 'Pause',
    attrs: { type: 'button' },
  });
  const prevBtn = el(doc, 'button', {
    id: `${PLAYBACK_BAR_ID}-prev`,
    className: 'scene-btn',
    text: 'Previous',
    attrs: { type: 'button', 'aria-label': 'Previous keyframe' },
  });
  const nextBtn = el(doc, 'button', {
    id: `${PLAYBACK_BAR_ID}-next`,
    className: 'scene-btn',
    text: 'Next',
    attrs: { type: 'button', 'aria-label': 'Next keyframe' },
  });
  // Lucide outline icons + accessible names on every transport control.
  for (const [button, icon, text, label] of [
    [playBtn, 'play', 'Play', 'Play scene'],
    [pauseBtn, 'pause', 'Pause', 'Pause scene'],
    [prevBtn, 'skip-back', 'Previous', 'Previous keyframe'],
    [nextBtn, 'skip-forward', 'Next', 'Next keyframe'],
  ]) {
    setIconContent(button, icon, { text }, doc);
    button.setAttribute('aria-label', label);
    button.title = label;
  }
  const scrub = el(doc, 'input', {
    id: `${PLAYBACK_BAR_ID}-scrub`,
    className: 'incident-playback__scrub',
    attrs: {
      type: 'range',
      min: '0',
      max: '1000',
      value: '0',
      step: '1',
      'aria-label': 'Scrub scene',
    },
  });
  const clock = el(doc, 'span', {
    id: `${PLAYBACK_BAR_ID}-clock`,
    className: 'incident-playback__clock',
    text: '0.0s / 0.0s',
  });
  playback.append(playBtn, pauseBtn, prevBtn, nextBtn, scrub, clock);
  const keyframeCaption = el(doc, 'p', {
    id: 'scene-active-keyframe',
    text: 'Select or build a scene',
    attrs: { 'aria-live': 'polite' },
  });

  // AOI toggles
  const toggles = el(doc, 'div', {
    id: AOI_TOGGLES_ID,
    className: 'incident-aoi-toggles',
    attrs: { role: 'group', 'aria-label': 'AOI layers' },
  });
  // legend
  const legend = el(doc, 'details', {
    id: INCIDENT_LEGEND_ID,
    className: 'incident-legend',
  });
  const legendSummary = el(doc, 'summary', { text: 'LEGEND · 10 CATEGORIES' });
  const legendList = el(doc, 'ul', { className: 'incident-legend__list' });
  for (const category of INCIDENT_CATEGORIES) {
    const li = el(doc, 'li', { className: 'incident-legend__item' });
    const img = el(doc, 'img', {
      attrs: {
        src: CATEGORY_ICONS[category],
        alt: '',
        width: '18',
        height: '18',
        loading: 'lazy',
      },
    });
    li.append(img, el(doc, 'span', { text: CATEGORY_LABELS[category] }));
    legendList.appendChild(li);
  }
  legend.append(legendSummary, legendList);
  const hiddenNote = el(doc, 'div', {
    id: `${INCIDENT_PANEL_ID}-hidden`,
    className: 'incident-panel__hidden',
  });
  panel.append(header, playback, keyframeCaption, toggles, legend, hiddenNote);
  host.appendChild(panel);
  const diagnostics = installIncidentDiagnostics({
    document: doc,
    panel,
    toggles,
    legend,
    hiddenNote,
    dataPanel: doc.getElementById('data-panel'),
  });

  // ---------------------------------------------------------------- popover
  const popover = el(doc, 'aside', {
    id: INCIDENT_POPOVER_ID,
    className: 'incident-popover',
    attrs: { role: 'dialog', 'aria-label': 'Incident details', hidden: '' },
  });
  (doc.body || doc.documentElement).appendChild(popover);

  function closePopover() {
    popover.hidden = true;
    popover.replaceChildren();
    state.popoverIncident = null;
  }
  function sceneForIncident(incidentId) {
    return (
      state.scenes.find((s) => s.incident_ids.includes(incidentId)) || null
    );
  }
  function openPopover(incident, screen) {
    if (!incident) return;
    state.popoverIncident = incident;
    const scene = sceneForIncident(incident.id);
    popover.replaceChildren();
    popover.dataset.incidentId = incident.id;
    const head = el(doc, 'header', { className: 'incident-popover__head' });
    const icon = el(doc, 'img', {
      attrs: {
        src: CATEGORY_ICONS[incident.category],
        alt: '',
        width: '28',
        height: '28',
      },
    });
    const titleWrap = el(doc, 'div');
    titleWrap.append(
      el(doc, 'h3', {
        className: 'incident-popover__title',
        text: incident.title,
      }),
      el(doc, 'div', {
        className: 'incident-popover__meta',
        text: `${CATEGORY_LABELS[incident.category] || incident.category} · ${incident.place || incident.aoi} · ${incident.time_utc}`,
      }),
    );
    const badge = el(doc, 'span', {
      className: `incident-badge incident-badge--${incident.confidence}`,
      text: incident.confidence.toUpperCase(),
      attrs: { 'data-confidence': incident.confidence },
    });
    const close = el(doc, 'button', {
      className: 'incident-popover__close',
      text: '×',
      attrs: { type: 'button', 'aria-label': 'Close' },
    });
    close.addEventListener('click', closePopover);
    head.append(icon, titleWrap, badge, close);
    const summary = el(doc, 'p', {
      className: 'incident-popover__summary',
      text: incident.summary || '—',
    });
    const sources = el(doc, 'ul', { className: 'incident-popover__sources' });
    for (const s of incident.sources || []) {
      const li = el(doc, 'li');
      const a = el(doc, 'a', {
        text: s.title || s.url.replace(/^https?:\/\//, '').slice(0, 70),
        attrs: { href: s.url, target: '_blank', rel: 'noopener noreferrer' },
      });
      li.append(
        a,
        el(doc, 'span', {
          className: 'incident-popover__published',
          text: s.published_at ? ` · ${s.published_at.slice(0, 10)}` : '',
        }),
      );
      sources.appendChild(li);
    }
    if (!incident.sources?.length)
      sources.appendChild(
        el(doc, 'li', {
          className: 'incident-popover__nosource',
          text: `provenance: ${incident.provenance}`,
        }),
      );
    const evidence = el(doc, 'div', {
      className: 'incident-popover__evidence',
    });
    for (const e of (incident.evidence || scene?.evidence || []).slice(0, 3)) {
      const fig = el(doc, 'figure');
      const img = el(doc, 'img', {
        attrs: {
          src: e.thumbnail_url,
          alt: `PlanetScope ${e.item_id}`,
          loading: 'lazy',
        },
      });
      fig.append(
        img,
        el(doc, 'figcaption', {
          text: `${e.item_id}${e.acquired ? ` · ${e.acquired.slice(0, 10)}` : ''}`,
        }),
      );
      evidence.appendChild(fig);
    }
    const actions = el(doc, 'div', { className: 'incident-popover__actions' });
    const play = el(doc, 'button', {
      className: 'scene-btn',
      text: 'Play scene',
      attrs: { type: 'button', 'data-action': 'play' },
    });
    play.disabled = !scene;
    play.addEventListener('click', () => scene && playScene(scene.id));
    const ask = el(doc, 'button', {
      className: 'scene-btn incident-popover__ask ask-ondemand-btn',
      text: 'Ask OnDemand',
      attrs: {
        type: 'button',
        'data-action': 'ask',
        'data-ask-object': `alert:${incident.id}`,
      },
    });
    ask.addEventListener('click', () => {
      win.dispatchEvent(
        new CustomEvent(ASK_OBJECT_EVENT, {
          detail: incidentChatContext(scene, incident),
        }),
      );
    });
    actions.append(play, ask);
    const aoiLine = el(doc, 'div', {
      className: 'incident-popover__aoi',
      text: incident.aoi_membership?.reason || incident.aoi,
    });
    popover.append(head, summary, sources, evidence, aoiLine, actions);
    popover.hidden = false;
    if (screen) {
      popover.style.left = `${Math.min(screen.x + 14, (win.innerWidth || 1200) - 360)}px`;
      popover.style.top = `${Math.max(16, Math.min(screen.y - 20, (win.innerHeight || 800) - 320))}px`;
    } else {
      popover.style.left = '';
      popover.style.top = '';
    }
  }

  // ---------------------------------------------------------------- playback
  let selectedSceneId = null;
  let composerRef = null;
  /**
   * Resolve once the director has actually STARTED the run (it sets `running`
   * synchronously), not when the whole fly-through ends. A start that is
   * refused resolves with the director's `{ started: false, reason }`.
   */
  function startedPlayback(run) {
    if (sceneDirector.running) return Promise.resolve({ started: true });
    return Promise.resolve(run);
  }
  function playScene(sceneId, { fly = true } = {}) {
    const scene = state.scenes.find((s) => s.id === sceneId);
    const point = scene?.anchor || scene?.keyframes?.[0];
    if (
      !scene ||
      !point ||
      !resolveIncidentGate(scene.title, { lat: point.lat, lon: point.lon })
        .allowed
    )
      return Promise.resolve({ started: false, reason: 'outside-uae-aoi' });
    selectedSceneId = sceneId;
    viewer.useDefaultRenderLoop = true;
    viewer.scene.requestRender();
    if (fly && scene?.keyframes?.[0]) {
      const kf = scene.keyframes[1] || scene.keyframes[0];
      overlay.flyTo(kf.lat, kf.lon, { duration: 0.1 });
    }
    sceneDirector._selectedSceneId = sceneId;
    sceneDirector._selectedShotId =
      sceneDirector._getSelectedScene?.()?.shots?.[0]?.id || null;
    sceneDirector._publish?.({ type: 'scene-options-changed' });
    sceneDirector._publish?.({ type: 'shots-changed' });
    return sceneDirector.startScene(sceneId, { single: true, preview: false });
  }
  playBtn.addEventListener('click', () => {
    const id = sceneDirector._selectedSceneId || state.scenes[0]?.id;
    if (!id) return;
    if (sceneDirector.paused?.sceneId === id) void sceneDirector.resumeScene();
    else void playScene(id, { fly: false });
  });
  pauseBtn.addEventListener('click', () => {
    if (sceneDirector.running) sceneDirector.pauseScene();
    else if (sceneDirector.paused) void sceneDirector.resumeScene();
  });
  async function moveKeyframe(direction) {
    if (sceneDirector.running) sceneDirector.pauseScene();
    const id = selectedSceneId || sceneDirector._selectedSceneId;
    const shotId = sceneDirector._selectedShotId;
    if (id && shotId) {
      sceneDirector._paused = null;
      await sceneDirector.loadAdjacentShot(id, shotId, direction);
    }
  }
  prevBtn.addEventListener('click', () => void moveKeyframe(-1));
  nextBtn.addEventListener('click', () => void moveKeyframe(1));
  let scrubbing = false;
  scrub.addEventListener('input', () => {
    scrubbing = true;
    const id = sceneDirector._selectedSceneId;
    if (!id) return;
    void sceneDirector.seekScene(id, Number(scrub.value) / 1000);
  });
  scrub.addEventListener('change', () => {
    scrubbing = false;
  });
  const unsubscribeClock = sceneDirector.subscribeSceneClock?.((snap) => {
    if (!snap) return;
    if (!scrubbing)
      scrub.value = String(Math.round((snap.sceneProgress || 0) * 1000));
    clock.textContent = `${(snap.sceneElapsedSec || 0).toFixed(1)}s / ${(snap.sceneDurationSec || 0).toFixed(1)}s${snap.running ? '' : ' · paused'}`;
    const active = sceneDirector._getSelectedScene?.();
    const frame = active?.shots?.find(
      (shot) => shot.id === sceneDirector._selectedShotId,
    );
    keyframeCaption.textContent = frame
      ? frame.title
      : 'Select or build a scene';
    const pauseLabel =
      !snap.running && sceneDirector.paused ? 'Resume' : 'Pause';
    setIconContent(
      pauseBtn,
      pauseLabel === 'Resume' ? 'play' : 'pause',
      { text: pauseLabel },
      doc,
    );
    pauseBtn.setAttribute('aria-label', `${pauseLabel} scene`);
    panel.dataset.playback = snap.running
      ? 'playing'
      : sceneDirector.paused
        ? 'paused'
        : 'idle';
    // Mirror the transport state onto the AOI composer's Play button (Play or Pause).
    composerRef?.setPlaybackState?.(panel.dataset.playback);
    if (activeGeographicScene?.id === sceneDirector._selectedSceneId)
      geographicOverlay.setTime?.(snap.sceneElapsedSec || 0);
  });

  // ---------------------------------------------------------------- toggles
  function renderToggles() {
    toggles.replaceChildren();
    const groups = state.groups || {};
    for (const group of GROUP_ORDER.filter((g) => groups[g])) {
      const label = el(doc, 'label', { className: 'incident-aoi-toggle' });
      const box = el(doc, 'input', {
        attrs: { type: 'checkbox', 'data-aoi-group': group },
      });
      box.checked = state.groupVisibility[group] !== false;
      box.addEventListener('change', () => {
        state.groupVisibility[group] = box.checked;
        overlay.setGroupVisibility({ [group]: box.checked });
      });
      const swatch = el(doc, 'span', {
        className: 'incident-aoi-toggle__swatch',
      });
      swatch.style.background = groups[group].color || '#fff';
      label.append(
        box,
        swatch,
        el(doc, 'span', { text: groups[group].label || group }),
      );
      toggles.appendChild(label);
    }
  }

  // ---------------------------------------------------------------- data
  function applyList(payload) {
    state.lastList = payload;
    state.incidents = payload.incidents || [];
    const incoming = payload.scenes || buildScenes(state.incidents);
    const saved = geographicStore.list();
    state.scenes = [...saved, ...incoming].filter((scene) => {
      const point = scene.anchor || scene.keyframes?.[0];
      return (
        point &&
        resolveIncidentGate(scene.title, { lat: point.lat, lon: point.lon })
          .allowed
      );
    });
    state.rejected = payload.rejected || { count: 0, items: [] };
    state.perAoi = payload.per_aoi || {};
    state.groups = payload.aoi_groups || state.groups;
    overlay.setIncidents(state.incidents);
    sceneDirector.syncIncidentScenes(
      state.scenes.filter((scene) => !scene.geographic),
    );
    for (const savedScene of saved)
      sceneDirector.addIncidentScene(savedScene, { select: false });
    sceneLibrary?.renderSaved(saved);
    if (!activeGeographicScene && saved[0])
      activateGeographic(saved[0], { saved: true });
    const hidden = sceneDirector.hiddenScenes?.() || [];
    counts.textContent = `${state.incidents.length} incidents · ${state.scenes.length} scenes · ${state.rejected.count} out of AOI`;
    counts.title = Object.entries(state.perAoi)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    hiddenNote.textContent = hidden.length
      ? `Hidden (out of AOI): ${hidden.map((h) => `${h.title} — ${h.reason}`).join(' · ')}`
      : '';
    renderToggles();
    panel.dataset.incidents = String(state.incidents.length);
    panel.dataset.scenes = String(state.scenes.length);
    win.dispatchEvent?.(
      new CustomEvent(INCIDENT_EVENTS.listChanged, {
        detail: {
          incidents: state.incidents.length,
          scenes: state.scenes.length,
          rejected: state.rejected.count,
        },
      }),
    );
  }

  async function load() {
    counts.textContent = 'loading…';
    try {
      const [list, aoi] = await Promise.all([client.list('all'), client.aoi()]);
      state.groups = aoi?.config?.groups || list.aoi_groups || {};
      overlay.setAoiOutlines(aoi?.outlines || []);
      applyList(list);
    } catch (err) {
      counts.textContent = `ledger unavailable (${err.message})`;
      panel.dataset.error = err.message;
    }
  }

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'REFRESHING…';
    try {
      const out = await client.refresh();
      const okSources = (out.sources || []).filter(
        (s) => s.status === 'ok',
      ).length;
      await load();
      counts.textContent += ` · refresh +${out.inserted_count} (${okSources}/${out.sources?.length || 0} sources ok)`;
      panel.dataset.lastRefresh = JSON.stringify({
        pulled: out.pulled,
        inserted: out.inserted_count,
        sources: out.sources,
      });
    } catch (err) {
      counts.textContent = `refresh failed (${err.message})`;
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh';
    }
  });

  // Authored geographic plans reuse the existing SceneDirector. They are
  // explicitly named/saved by the operator, never ingested as reported events.
  // Scene evidence (2026-10-24): every in-AOI scene opens its evidence panel.
  // Saved scenes reopen from the local evidence cache with no provider calls.
  function assertCurrent(request = {}) {
    if (
      signal?.aborted ||
      request.signal?.aborted ||
      (request.revision !== undefined &&
        request.revision !== composerRef?.state.promptRevision) ||
      (request.generation !== undefined &&
        request.generation !== composerRef?.state.generation)
    )
      throw new DOMException('Scene request superseded', 'AbortError');
  }
  function captureSceneSnapshot(scene) {
    const p = viewer.camera?.positionCartographic;
    const view =
      p && Number.isFinite(p.latitude)
        ? {
            lat: (p.latitude * 180) / Math.PI,
            lon: (p.longitude * 180) / Math.PI,
            alt: p.height,
            heading:
              (((viewer.camera.heading || 0) * 180) / Math.PI + 360) % 360,
            pitch: ((viewer.camera.pitch || 0) * 180) / Math.PI,
            roll: ((viewer.camera.roll || 0) * 180) / Math.PI,
          }
        : scene.cameraState;
    const selected = sceneCamera?.getState()?.selected;
    return {
      ...scene,
      ...(studio?.getSnapshot() || {}),
      hashSnapshot: win.location?.hash || '',
      cameraSelection: selected
        ? { mode: 'cctv', id: selected.id }
        : { mode: 'plan' },
      ...(view ? { cameraState: view } : {}),
      updatedAt: new Date().toISOString(),
    };
  }
  const evidenceScopeByScene = new Map();
  function openEvidence(
    scene,
    { text, preferCache = false, selectedTime = {} } = {},
  ) {
    if (selectedTime.windowHours || selectedTime.timeMode)
      evidenceScopeByScene.set(scene.id, selectedTime);
    selectedTime = evidenceScopeByScene.get(scene.id) || {
      windowHours:
        Number(doc.getElementById('incident-composer-window')?.value) || 1,
      timeMode: 'recent',
    };
    const a = scene?.anchor;
    if (!a || !Number.isFinite(a.lat) || !Number.isFinite(a.lon)) return;
    win.dispatchEvent?.(
      new CustomEvent('gev:scene-evidence', {
        detail: {
          text: text || scene.refinedPrompt || a.name || scene.title,
          place: a.name || undefined,
          lat: a.lat,
          lon: a.lon,
          sceneId: scene.id,
          windowHours: selectedTime.windowHours || 1,
          ...selectedTime,
          preferCache,
          promptDerived: true,
          constructed: true,
          promptRevision: composerRef?.state.promptRevision,
          allowedPlatforms: ['youtube', 'tiktok', 'instagram'],
        },
      }),
    );
  }
  async function activateGeographic(
    scene,
    {
      saved = false,
      focus = true,
      evidenceText,
      reopen = false,
      selectedTime = {},
      research = true,
      request = {},
    } = {},
  ) {
    assertCurrent(request);
    const gate = resolveIncidentGate(scene.title, scene.anchor);
    if (!gate.allowed)
      throw new Error('Outside UAE AOI — external context only');
    activeGeographicScene = scene;
    const added = sceneDirector.addIncidentScene(scene, { select: true });
    if (!added.added) throw new Error(added.reason || 'Scene was not accepted');
    selectedSceneId = scene.id;
    state.scenes = [
      scene,
      ...state.scenes.filter((item) => item.id !== scene.id),
    ];
    sceneLibrary?.setScene(scene, { saved });
    sceneLibrary?.element.setAttribute('data-scene-id', scene.id);
    geographicOverlay.setScene(scene);
    geometryLayer.setScene(scene);
    for (const button of [playBtn, pauseBtn, prevBtn, nextBtn])
      button.disabled = false;
    scrub.disabled = false;
    panel.dataset.activeScene = scene.id;
    panel.dataset.playable = 'true';
    // Phones: the drawer and the footage sheet share the top band; keep the
    // drawer closed after a build so the footage (and every icon) stays visible.
    if (!win.matchMedia?.('(max-width: 700px)')?.matches)
      sidebar?.selectTab('scenes');
    if (reopen) {
      composerRef?.restorePrompt(
        scene.refinedPrompt || scene.originalPrompt || scene.anchor?.name || '',
        { selectedTime: scene.selectedTime },
      );
      composerRef?.attachStoredScene(scene);
      const savedHash =
        typeof scene.hashSnapshot === 'string'
          ? scene.hashSnapshot
          : '#' + new URLSearchParams(scene.hashSnapshot || {}).toString();
      if (savedHash.startsWith('#') && savedHash.length > 1) {
        win.history.replaceState(null, '', savedHash);
        win.dispatchEvent(new Event('hashchange'));
      }
    }
    if (focus && !reopen) {
      viewer.useDefaultRenderLoop = true;
      viewer.scene.requestRender();
      const first = sceneDirector._getSelectedScene?.()?.shots?.[0];
      if (first)
        await sceneDirector.loadShot(scene.id, first.id, { flyDuration: 1.8 });
    }
    assertCurrent(reopen ? {} : request);
    studio?.setScene(scene);
    sceneCamera?.setScene(scene);
    sceneFootageControls?.setScene(scene);
    if (research)
      openEvidence(scene, {
        text: evidenceText,
        preferCache: reopen,
        selectedTime: scene.selectedTime || selectedTime,
      });
    return scene;
  }
  sceneLibrary = createSceneLibrary({
    document: doc,
    window: win,
    sceneDirector,
    storage: geographicStore,
    onSelect: async (scene) => {
      composerRef?.cancel();
      viewer.camera?.cancelFlight?.();
      sceneDirector.stopScene('Loading saved scene');
      const request = {
        revision: composerRef?.state.promptRevision,
        generation: composerRef?.state.generation,
      };
      await sceneDirector._waitForRunIdle();
      assertCurrent(request);
      return activateGeographic(scene, { saved: true, reopen: true });
    },
    onSave: (scene) => {
      const saved = geographicStore.save(captureSceneSnapshot(scene));
      if (!saved.saved) throw new Error(saved.reason || 'Storage unavailable');
      // Let the library finish its own save transaction before rerendering it;
      // setScene() here would invalidate its generation and erase confirmation.
      activeGeographicScene = saved.scene;
      state.scenes = [
        saved.scene,
        ...state.scenes.filter((item) => item.id !== saved.scene.id),
      ];
      sceneDirector.addIncidentScene(saved.scene, { select: true });
      return saved.scene;
    },
  });
  studio = createSceneStudio({
    document: doc,
    window: win,
    onRefine: async ({ text: refinement, scene, chat }) => {
      const prompt = `${scene.refinedPrompt || scene.originalPrompt || scene.anchor.name}\nRefinement: ${refinement}`;
      refinementContext = { prompt, scene, chat };
      composerRef.restorePrompt(prompt, { selectedTime: scene.selectedTime });
      return composerRef.submit(prompt);
    },
    onNarration: async (scene, settings, { signal: audioSignal } = {}) => {
      if (scene.id !== activeGeographicScene?.id || !scene.plan)
        throw new Error('Only the current completed scene can be narrated.');
      const revision = composerRef.state.promptRevision;
      const config = {
        voiceId: settings.voiceId,
        modelId: settings.modelId,
        stability: settings.stability,
        similarityBoost:
          settings.similarity_boost ?? settings.similarityBoost ?? 0.75,
        speed: settings.speed,
        style: settings.style,
        useSpeakerBoost:
          settings.use_speaker_boost ?? settings.useSpeakerBoost ?? true,
      };
      const result = await client.narrateScene(
        { plan: scene.plan, config, revision },
        { signal: audioSignal },
      );
      if (
        scene.id !== activeGeographicScene?.id ||
        revision !== composerRef.state.promptRevision ||
        audioSignal?.aborted
      )
        throw new DOMException('Obsolete narration', 'AbortError');
      return result;
    },
    onStateChange: (extra) => {
      if (activeGeographicScene) Object.assign(activeGeographicScene, extra);
    },
    onPlay: (scene) => {
      void playScene(scene.id, { fly: false });
    },
    onPause: () => {
      if (sceneDirector.running) sceneDirector.pauseScene();
    },
  });
  sceneCamera = createSceneCamera({ document: doc });
  studio.cameraHost.append(sceneCamera.element);
  sceneLibrary.element.append(studio.element);
  const cameraLayer = dataManager?.layers?.get?.('cctv')?.module;
  if (cameraLayer?.subscribe)
    removeCameraSubscription = cameraLayer.subscribe((snapshot) => {
      // Raw catalog records are not upgraded to verified coverage/permissions.
      sceneCamera.updateCameras(snapshot?.cameras || []);
    });
  const onPromptStarted = () => {
    viewer.camera?.cancelFlight?.();
    if (sceneDirector.running || sceneDirector.paused)
      sceneDirector.stopScene('Prompt changed');
    studio.invalidate();
    sceneCamera.setScene(null);
    sceneFootageControls?.setScene(null);
  };
  win.addEventListener('gev:incident-command-started', onPromptStarted);
  win.addEventListener('gev:incident-command-cancelled', onPromptStarted);
  win.__gevSceneStudio = studio;
  // Cycle 21 calm launch: the Scenes drawer starts CLOSED; the Scenes tab opens it.
  sidebar = sceneLibrary.installSidebar({ expanded: false });
  for (const button of [playBtn, pauseBtn, prevBtn, nextBtn])
    button.disabled = true;
  scrub.disabled = true;

  // ---------------------------------------------------------------- composer
  const composer = (composerRef = createIncidentComposer({
    document: doc,
    client,
    buildResearchScene: true,
    structuredPlanning: true,
    requestTimeoutMs: 240_000,
    buildScene: (incidents) => buildScenes(incidents)[0],
    createGeographicScene: async (request) => {
      const {
        candidate,
        extraction,
        text,
        signal: requestSignal,
        revision,
      } = request;
      assertCurrent(request);
      const gate = resolveIncidentGate(text, candidate);
      if (!gate.allowed)
        throw new Error('Outside UAE AOI — external context only');
      const refinement =
        refinementContext?.prompt === text ? refinementContext : null;
      const result = await client.constructScene(
        {
          prompt: text,
          candidate: {
            name: candidate.name,
            lat: candidate.lat,
            lon: candidate.lon,
            verified: candidate.verified === true,
            source: candidate.source,
            sourceUrl: candidate.sourceUrl,
          },
          ...(refinement?.scene?.plan
            ? { previousPlan: refinement.scene.plan }
            : {}),
          selectedTime:
            extraction.timeMode === 'historical'
              ? extraction.windowStart
              : extraction.windowHours,
          revision,
        },
        { signal: requestSignal },
      );
      lastConstructGeometry = result.geometry || null;
      assertCurrent(request);
      if (!result.ok || !result.plan)
        throw new Error('No validated scene plan was returned.');
      const scene = buildPlannedScene({
        plan: result.plan,
        candidate: {
          ...candidate,
          aoi_membership: { inside: true, aoi_ids: gate.aoiIds },
        },
        text,
        originalPrompt: refinement?.scene?.originalPrompt || text,
        geometry: result.geometry || null,
        selectedTime: {
          windowHours: extraction.windowHours,
          timeMode: extraction.timeMode,
          windowStart: extraction.windowStart,
          windowEnd: extraction.windowEnd,
        },
        now: new Date(),
      });
      if (refinement) {
        scene.chat = [
          ...refinement.chat,
          {
            role: 'assistant',
            text: 'Refinement applied to the actual scene through the validated construction pipeline.',
          },
        ];
        scene.narrationConfig =
          refinement.scene.narrationConfig || scene.narrationConfig;
      }
      return scene;
    },
    onTimeChange: async (request) => {
      assertCurrent(request);
      const { scene, selectedTime, text } = request;
      if (!scene || scene.id !== activeGeographicScene?.id) return;
      Object.assign(scene, {
        selectedTime,
        updatedAt: new Date().toISOString(),
      });
      activeGeographicScene = scene;
      sceneLibrary.setScene(scene, { saved: false });
      // Re-style the existing research lines/dots for the new window; no rebuild.
      geometryLayer.setTimeWindow(selectedTime);
      // Update evidence for the same entities/camera plan, without an LLM or geocoder rebuild.
      openEvidence(scene, { text, selectedTime });
      return { updated: true, sceneId: scene.id };
    },
    onExternal: (request) => {
      assertCurrent(request);
      const { candidate } = request;
      studio.setScene(null);
      sceneCamera.setScene(null);
      sceneFootageControls?.setScene(null);
      sceneDirector.stopScene('External context only');
      activeGeographicScene = null;
      selectedSceneId = null;
      sceneLibrary.setScene(null);
      sceneLibrary.element.removeAttribute('data-scene-id');
      for (const button of [playBtn, pauseBtn, prevBtn, nextBtn])
        button.disabled = true;
      scrub.disabled = true;
      panel.dataset.playable = 'false';
      delete panel.dataset.activeScene;
      geographicOverlay.setExternal(candidate);
      geometryLayer.clear();
      overlay.flyTo(candidate.lat, candidate.lon, {
        altitude: 14000,
        duration: 1.6,
      });
    },
    onPlaybackControl: ({ action }) => {
      if (action === 'pause' && sceneDirector.running)
        return sceneDirector.pauseScene();
      if (action === 'resume' && sceneDirector.paused)
        return sceneDirector.resumeScene();
      return null;
    },
    onUnresolved: (request) => {
      assertCurrent(request);
      studio.setStatus(
        'Location could not be verified. No scene, camera, narration or social footage was substituted.',
      );
    },
    onLocated: (request) => {
      assertCurrent(request);
      // Geocoding alone is not a successfully constructed scene. No camera
      // flight or social lookup is dispatched at this stage.
    },
    onScene: async (request) => {
      const {
        scene,
        incident,
        override,
        play = false,
        text,
        selectedTime = {},
        signal: requestSignal,
      } = request;
      assertCurrent(request);
      if (!play && (sceneDirector.running || sceneDirector.paused)) {
        // LOAD is rejected while a previous playback owns the camera. Wait for
        // its real cancellation cleanup before selecting/flying to the new AOI.
        sceneDirector.stopScene('Rebuilding the AOI scene');
        await sceneDirector._waitForRunIdle();
        assertCurrent(request);
        sceneDirector._paused = null;
      }
      if (scene.geographic) {
        if (!play)
          await activateGeographic(scene, {
            saved: Boolean(geographicStore.load(scene.id)),
            focus: true,
            evidenceText: text,
            selectedTime,
            research: true,
            request,
          });
        assertCurrent(request);
        // Return the run (root-cause fix, cycle 23): a fire-and-forget start let
        // the composer reset Play to idle in 0 ms, and the next press was then
        // rejected by the director as 'already-running'.
        if (play) return startedPlayback(playScene(scene.id, { fly: false }));
        return;
      }
      const point = scene.anchor || scene.keyframes?.[0];
      if (
        !point ||
        !resolveIncidentGate(scene.title, { lat: point.lat, lon: point.lon })
          .allowed
      )
        throw new Error('Outside UAE AOI — external context only');
      const sceneWithFlags = scene;
      const added = sceneDirector.addIncidentScene(sceneWithFlags, {
        override,
        select: true,
      });
      if (!added.added) throw new Error(added.reason || 'scene rejected');
      assertCurrent(request);
      if (!play && text)
        win.dispatchEvent?.(
          new CustomEvent('gev:scene-evidence', {
            detail: {
              text,
              lat: point.lat,
              lon: point.lon,
              sceneId: scene.id,
              windowHours: selectedTime.windowHours || 1,
              ...selectedTime,
              promptDerived: true,
              constructed: true,
              promptRevision: request.revision,
            },
          }),
        );
      if (incident) {
        state.incidents = [
          incident,
          ...state.incidents.filter((i) => i.id !== incident.id),
        ];
        overlay.setIncidents(state.incidents);
      }
      state.scenes = [
        sceneWithFlags,
        ...state.scenes.filter((s) => s.id !== scene.id),
      ];
      counts.textContent = `${state.incidents.length} incidents · ${state.scenes.length} scenes · ${state.rejected.count} out of AOI`;
      panel.dataset.incidents = String(state.incidents.length);
      panel.dataset.scenes = String(state.scenes.length);
      win.dispatchEvent?.(
        new CustomEvent(INCIDENT_EVENTS.sceneBuilt, {
          detail: {
            sceneId: scene.id,
            incidentId: incident?.id,
            override: Boolean(override),
          },
        }),
      );
      selectedSceneId = scene.id;
      for (const button of [playBtn, pauseBtn, prevBtn, nextBtn])
        button.disabled = false;
      scrub.disabled = false;
      if (play) return startedPlayback(playScene(scene.id));
      else if (scene.keyframes?.[0])
        overlay.flyTo(scene.keyframes[0].lat, scene.keyframes[0].lon, {
          altitude: 7000,
          duration: 1.6,
        });
    },
  }));
  sceneFootageControls = createSceneFootageControls({
    document: doc,
    window: win,
  });
  composer.element.appendChild(sceneFootageControls.element);
  (doc.body || doc.documentElement).appendChild(composer.element);
  const locationInput = doc.getElementById('location-search');
  let lastMirroredLocation = '';
  const onLocationInput = () => {
    const text = String(locationInput?.value || '');
    if (text === composer.input.value) return;
    if (
      !canMirrorLocationDraft({
        draft: composer.input.value,
        lastMirrored: lastMirroredLocation,
        composerFocused: doc.activeElement === composer.input,
      })
    )
      return;
    refinementContext = null;
    lastMirroredLocation = text;
    composer.input.value = text;
    // Updating a draft is deliberately NOT a submit, including programmatic updates.
    composer.input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  locationInput?.addEventListener('input', onLocationInput);

  // Close the popover on Escape.
  const onKey = (event) => {
    if (event.key === 'Escape' && !popover.hidden) closePopover();
  };
  doc.addEventListener('keydown', onKey);

  void load();

  const api = {
    client,
    overlay,
    composer,
    panel,
    popover,
    load,
    playScene,
    openPopover,
    closePopover,
    getState: () => ({
      incidents: state.incidents.length,
      scenes: state.scenes.length,
      rejected: state.rejected.count,
      perAoi: state.perAoi,
      hidden: sceneDirector.hiddenScenes?.() || [],
      sceneTitles: sceneDirector.listScenes().map((s) => s.title),
      activeGeographicScene: activeGeographicScene?.id || null,
      geographicSaved: geographicStore.list().map((scene) => ({
        id: scene.id,
        title: scene.title,
        anchor: scene.anchor,
      })),
      geographicOverlay: geographicOverlay.getState(),
      structuredScene: activeGeographicScene,
      sceneGeometry: activeGeographicScene
        ? {
            ...geometryLayer.getState(),
            sceneId: activeGeographicScene.id,
            selectedTime: activeGeographicScene.selectedTime || null,
          }
        : null,
      lastConstructGeometryStatus: lastConstructGeometry?.status || null,
      studio: studio.getState(),
      sceneCamera: sceneCamera.getState(),
    }),
    destroy() {
      unsubscribeClock?.();
      removeCameraSubscription?.();
      locationInput?.removeEventListener('input', onLocationInput);
      win.removeEventListener('gev:incident-command-started', onPromptStarted);
      win.removeEventListener(
        'gev:incident-command-cancelled',
        onPromptStarted,
      );
      studio.destroy();
      sceneCamera.destroy();
      sceneFootageControls?.destroy();
      if (win.__gevSceneStudio === studio) delete win.__gevSceneStudio;
      doc.removeEventListener('keydown', onKey);
      composer.destroy();
      diagnostics.destroy();
      sceneLibrary.destroy();
      geographicOverlay.destroy();
      geometryLayer.destroy();
      popover.remove();
      panel.remove();
      overlay.destroy();
      if (win.__gevIncidents === api) delete win.__gevIncidents;
    },
  };
  win.__gevIncidents = api;
  if (signal?.aborted) api.destroy();
  else signal?.addEventListener?.('abort', () => api.destroy(), { once: true });
  return api;
}
