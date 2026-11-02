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
import { createSceneStagingLayer } from './sceneStagingLayer.js';
import { createSceneStreamLayer } from './sceneStreamLayer.js';
import { createSceneLegend } from './sceneLegend.js';
import { installCinematicEngine } from '../../cinematic/index.js';
import * as CesiumModule from 'cesium';
import { classifyPrompt, templateSpec } from '../../scenes/sceneTemplates.js';

/**
 * Decide whether a failed SSE construct attempt may be retried over the JSON
 * /construct route. Only transport-level failures qualify (older server
 * without the stream route, a non-SSE answer, a cold instance that cannot
 * resume, or a network drop with no HTTP status). Server-side scene errors
 * (4xx/5xx with a code) and cancellations are surfaced unchanged so a bad
 * prompt is never silently re-run.
 */
export function shouldFallBackToJsonConstruct(error) {
  if (!error || error.name === 'AbortError') return false;
  if (error.status === 404 || error.status === 405) return true;
  if (error.code === 'non_sse_response' || error.code === 'resume_unavailable')
    return true;
  return error.status === undefined && !error.code;
}

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
  if (typeof win !== 'undefined' && viewer) {
    win.__gevViewer = viewer;
  }
  const client = createIncidentClient({ fetch: fetchImpl, storage });
  const geographicStore = createGeographicSceneStore(
    storage || win.localStorage,
  );
  const geographicOverlay = createGeographicOverlay(viewer, { document: doc });
  const geometryLayer = createSceneGeometryLayer(viewer, { document: doc });
  // Deterministic staging (cordons, routes, units, cones, icons, haloed labels).
  const stagingLayer = createSceneStagingLayer(viewer, { document: doc });
  // Progressive SSE preview of staging elements (cleared once the final scene lands).
  const streamLayer = createSceneStreamLayer(viewer);
  // Compact map legend (collapsed pill; icon + label per element type present).
  let sceneLegend = null;
  try {
    sceneLegend = createSceneLegend({
      document: doc,
      viewerContainer: viewer.container || doc.body,
    });
  } catch (error) {
    console.warn('[scene-legend] unavailable', error?.message || error);
  }
  // Live Cinematic Intelligence Engine (2026-11-01): typed SSE events from the
  // same construct stream drive the persistent Cesium runtime, playback clock,
  // camera director, live-intelligence patches, Q&A and the cinematic panel.
  const cinematic = installCinematicEngine({
    viewer,
    document: doc,
    window: win,
    fetch: fetchImpl,
    headers: () => ({
      'X-Workstation-User': client.externalUserId,
      'X-Workstation-Workspace': client.workspace,
    }),
    log: (line) => console.info(line),
  });
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

    // Guaranteed render: when fallback is partial, promote and KEEP streamLayer visible!
    if (scene.fallback === 'partial') {
      for (const button of [playBtn, pauseBtn, prevBtn, nextBtn])
        button.disabled = false;
      scrub.disabled = false;
      panel.dataset.activeScene = scene.id;
      panel.dataset.playable = 'true';
      viewer.useDefaultRenderLoop = true;
      viewer.scene?.requestRender?.();
      studio?.setScene(scene);
      if (focus && !reopen) {
        await triggerCinematicFlyIn(scene);
      }
      return scene;
    }

    geographicOverlay.setScene(scene);
    geometryLayer.setScene(scene);
    streamLayer.clear();
    stagingLayer.setScene(scene);
    // Verified camera-discovery candidates become cctv_signal markers; nothing invented.
    stagingLayer.setCameras(cameraCandidatesFor(scene));
    try {
      sceneLegend?.setScene(scene.staging || scene.plan || scene);
    } catch {
      /* legend is decorative */
    }
    viewer.scene?.requestRender?.();
    if (cinematic) {
      if (
        scene.cinematic &&
        cinematic.scene()?.sceneId !== scene.cinematic.sceneId
      )
        cinematic.attachScene(scene.cinematic);
      else if (!scene.cinematic && !cinematic.scene()?.entities?.length)
        cinematic.clear();
    }
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
      viewer.scene?.requestRender?.();
      const first = sceneDirector._getSelectedScene?.()?.shots?.[0];
      if (first)
        await sceneDirector.loadShot(scene.id, first.id, { flyDuration: 1.8 });
      await triggerCinematicFlyIn(scene);
    }
    assertCurrent(reopen ? {} : request);
    studio?.setScene(scene);
    sceneCamera?.setScene(scene);
    sceneFootageControls?.setScene(scene);
    viewer.scene?.requestRender?.();
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
  function cameraCandidatesFor(scene) {
    if (!scene?.staging) return [];
    const st = sceneCamera?.getState?.();
    return (st?.candidates || [])
      .filter((c) => c.usable && c.location)
      .slice(0, 6)
      .map((c) => ({
        id: c.id,
        name: c.name,
        lat: c.location.lat,
        lon: c.location.lon,
        distanceM: c.distanceM,
        status: c.status,
        provider: c.provider,
        usable: true,
      }));
  }
  studio.cameraHost.append(sceneCamera.element);
  sceneLibrary.element.append(studio.element);
  cinematic?.mountPanel(studio.element);
  // Snapchat evidence → validated scene patches through the live director.
  // The footage module may install after this one (src/app/tools.js order),
  // so wire lazily on first availability.
  const wireFootage = () => {
    const footageApi = win.__gevSceneFootage;
    if (!cinematic || !footageApi?.setEvidencePatchHandler) return false;
    footageApi.setPatchContext(() => {
      const sc = cinematic.scene();
      return sc
        ? {
            sceneId: sc.sceneId,
            baseVersion: sc.sceneVersion,
            origin: sc.origin,
          }
        : null;
    });
    footageApi.setEvidencePatchHandler((patch, { counts } = {}) => {
      const verified = Number(counts?.verified || 0);
      cinematic.liveDirector.receive({
        patch,
        priority: verified > 0 ? 'high' : 'normal',
        relevance: verified > 0 ? 0.9 : 0.4,
        source: 'snapchat',
      });
    });
    return true;
  };
  if (!wireFootage()) {
    let tries = 0;
    const retry = () => {
      if (wireFootage() || ++tries > 20) return;
      setTimeout(retry, 250);
    };
    setTimeout(retry, 0);
  }
  const cameraLayer = dataManager?.layers?.get?.('cctv')?.module;
  if (cameraLayer?.subscribe)
    removeCameraSubscription = cameraLayer.subscribe((snapshot) => {
      // Raw catalog records are not upgraded to verified coverage/permissions.
      sceneCamera.updateCameras(snapshot?.cameras || []);
      if (activeGeographicScene?.staging)
        stagingLayer.setCameras(cameraCandidatesFor(activeGeographicScene));
    });
  const onPromptStarted = () => {
    viewer.camera?.cancelFlight?.();
    if (sceneDirector.running || sceneDirector.paused)
      sceneDirector.stopScene('Prompt changed');
    studio.invalidate();
    sceneCamera.setScene(null);
    sceneFootageControls?.setScene(null);
    streamLayer.clear();
    cinematic?.clear();
  };
  win.addEventListener('gev:incident-command-started', onPromptStarted);
  win.addEventListener('gev:incident-command-cancelled', onPromptStarted);
  win.__gevSceneStudio = studio;
  // Cycle 21 calm launch: the Scenes drawer starts CLOSED; the Scenes tab opens it.
  sidebar = sceneLibrary.installSidebar({ expanded: false });
  for (const button of [playBtn, pauseBtn, prevBtn, nextBtn])
    button.disabled = true;
  scrub.disabled = true;

  // ------------------------------------------------- streaming construct
  function buildLocalTemplateFallback(payload, lastOrigin) {
    const prompt = payload.prompt || '';
    const scenarioType = classifyPrompt(prompt);
    const spec = templateSpec(prompt, scenarioType);

    const anchor = {
      name:
        payload.candidate?.name ||
        lastOrigin?.name ||
        spec.focalEntity?.name ||
        'Local area',
      lat: Number.isFinite(payload.candidate?.lat)
        ? payload.candidate.lat
        : Number.isFinite(lastOrigin?.lat)
          ? lastOrigin.lat
          : 25.0806,
      lon: Number.isFinite(payload.candidate?.lon)
        ? payload.candidate.lon
        : Number.isFinite(lastOrigin?.lon)
          ? lastOrigin.lon
          : 55.1397,
    };

    const typeMap = {
      inner_cordon: 'barrier',
      outer_cordon: 'barrier',
      cordon: 'barrier',
      barriers: 'barrier',
      cones: 'barrier',
      perimeter_unit: 'police',
      checkpoint: 'police_vehicle',
      vehicle_checkpoint: 'police_vehicle',
      police_car: 'police_vehicle',
      staging_point: 'police_vehicle',
      cctv_signal: 'police',
      crowd_zone: 'person',
      runner: 'runner',
      start_finish: 'start_line',
      approach_route: 'vehicle',
      egress_route: 'vehicle',
      route_line: 'barrier',
    };

    const entities = (spec.elements || []).map((element, i) => {
      const entType = typeMap[element.type] || 'police';
      const angle = i * 45 * (Math.PI / 180);
      const dist = 30 + i * 15;
      return {
        id: `fallback-ent-${i + 1}`,
        type: entType,
        label: element.type.replace(/_/g, ' '),
        quantity: Math.min(element.params?.count || 1, 10),
        position: {
          eastM: Math.round(dist * Math.cos(angle)),
          northM: Math.round(dist * Math.sin(angle)),
        },
        heading: (i * 45) % 360,
      };
    });

    if (entities.length === 0) {
      entities.push({
        id: 'fallback-ent-1',
        type: 'police',
        label: 'Security unit',
        quantity: 1,
        position: { eastM: 10, northM: 10 },
        heading: 0,
      });
    }

    const plan = {
      version: 1,
      title: `${spec.focalEntity?.name || 'Scene'} (${scenarioType.replace(/_/g, ' ')})`,
      illustrative: true,
      durationSec: 15,
      location: {
        name: anchor.name,
        lat: anchor.lat,
        lon: anchor.lon,
      },
      camera: { distanceM: 400, heading: 45, pitch: -35, framing: 'wide' },
      entities,
      relationships: [],
      beats: [
        {
          atSec: 0,
          title: 'Initial Overview',
          narration: 'Approximate template fallback staging.',
          entityIds: [entities[0].id],
        },
      ],
      citations: [],
      verification: {
        status: 'location_approximate',
        locationSource: 'Client template fallback',
        checkedAt: new Date().toISOString(),
        limitations: [
          'Approximate template fallback generated client-side after timeout.',
        ],
      },
    };

    return {
      ok: true,
      plan,
      staging: null,
      geometry: null,
      locationResolution: {
        approximate: true,
        confidence: 0.35,
        precision: 'approximate',
      },
      fallbacks: ['template fallback'],
      fallback: 'template fallback',
      anchor,
    };
  }

  let lastFlyInSceneId = null;

  function extractCartesianPositions(scene, Cesium) {
    const positions = [];
    const anchor = scene.anchor || { lat: 25.0806, lon: 55.1397 };
    if (!Cesium?.Cartesian3?.fromDegrees) return positions;

    if (Array.isArray(scene.plan?.entities)) {
      for (const ent of scene.plan.entities) {
        if (ent.position) {
          const dLat = (ent.position.northM || 0) / 111111;
          const dLon =
            (ent.position.eastM || 0) /
            (111111 * Math.cos((anchor.lat * Math.PI) / 180));
          positions.push(
            Cesium.Cartesian3.fromDegrees(
              anchor.lon + dLon,
              anchor.lat + dLat,
              0,
            ),
          );
        }
      }
    }

    if (Array.isArray(scene.staging?.points)) {
      for (const pt of scene.staging.points) {
        if (Number.isFinite(pt.lat) && Number.isFinite(pt.lon)) {
          positions.push(
            Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, pt.alt || 0),
          );
        }
      }
    }

    return positions;
  }

  function extractScenePositions(scene) {
    const positions = [];
    const anchor = scene.anchor || { lat: 25.0806, lon: 55.1397 };

    if (Array.isArray(scene.plan?.entities)) {
      for (const ent of scene.plan.entities) {
        if (ent.position) {
          const dLat = (ent.position.northM || 0) / 111111;
          const dLon =
            (ent.position.eastM || 0) /
            (111111 * Math.cos((anchor.lat * Math.PI) / 180));
          positions.push({
            lat: anchor.lat + dLat,
            lon: anchor.lon + dLon,
          });
        }
      }
    }

    if (Array.isArray(scene.staging?.points)) {
      for (const pt of scene.staging.points) {
        if (Number.isFinite(pt.lat) && Number.isFinite(pt.lon)) {
          positions.push({ lat: pt.lat, lon: pt.lon });
        }
      }
    }

    return positions;
  }

  async function triggerCinematicFlyIn(scene) {
    if (!viewer || !scene || scene.id === lastFlyInSceneId) return;
    lastFlyInSceneId = scene.id;

    try {
      const flyInModule = await import('./sceneFlyIn.js').catch(() => null);
      if (typeof flyInModule?.flyToScene === 'function') {
        const positions = extractScenePositions(scene);
        await flyInModule.flyToScene(viewer, {
          positions,
          anchor: scene.anchor,
          Cesium: CesiumModule,
        });
        return;
      }
    } catch {}

    if (!viewer?.camera?.flyToBoundingSphere) return;

    try {
      const Cesium = CesiumModule;
      const positions = extractCartesianPositions(scene, Cesium);
      let sphere;
      if (positions.length > 0 && Cesium.BoundingSphere?.fromPoints) {
        sphere = Cesium.BoundingSphere.fromPoints(positions);
      } else {
        const center = Cesium.Cartesian3?.fromDegrees
          ? Cesium.Cartesian3.fromDegrees(
              scene.anchor?.lon ?? 55.1397,
              scene.anchor?.lat ?? 25.0806,
              scene.anchor?.alt || 0,
            )
          : { x: 0, y: 0, z: 0 };
        sphere = Cesium.BoundingSphere
          ? new Cesium.BoundingSphere(center, 600)
          : { center, radius: 600 };
      }

      const headingRad = Cesium.Math?.toRadians
        ? Cesium.Math.toRadians(25)
        : (25 * Math.PI) / 180;
      const pitchRad = Cesium.Math?.toRadians
        ? Cesium.Math.toRadians(-45)
        : (-45 * Math.PI) / 180;
      const range = (sphere.radius || 600) * 2.0;

      const offset = Cesium.HeadingPitchRange
        ? new Cesium.HeadingPitchRange(headingRad, pitchRad, range)
        : { heading: headingRad, pitch: pitchRad, range };

      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 2.5,
        offset,
      });
    } catch (err) {
      console.warn(
        '[fly-in] inline flyToBoundingSphere error',
        err?.message || err,
      );
    }
  }

  /**
   * Build through the SSE route when available (typed events feed the
   * composer's typewriter view and the progressive map preview); fall back to
   * the JSON /construct route when the server is older, answers non-SSE, or
   * cannot resume. Timings are measured client-side from real event arrival.
   */
  async function constructWithStream(
    payload,
    {
      signal,
      silenceTimeoutMs = win?.__gevSilenceTimeoutMs || 45_000,
      totalTimeoutMs = win?.__gevTotalTimeoutMs || 150_000,
    } = {},
  ) {
    const streamEnabled =
      typeof client.constructSceneStream === 'function' &&
      win.__gevSceneStream !== false;
    if (!streamEnabled) return client.constructScene(payload, { signal });
    const view = composerRef?.streamView || null;
    const started = performance.now();
    const timings = {
      ttftMs: null,
      firstElementMs: null,
      planMs: null,
      doneMs: null,
      tokens: 0,
      tokensPerSec: null,
      elements: 0,
      transport: 'sse',
    };
    const requestId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `req-${Date.now().toString(36)}`;
    streamLayer.clear();
    viewer?.scene?.requestRender?.();
    let lastEventId = null;
    let lastKnownOrigin = null;
    const fallbacks = [];

    let silenceTimer = null;
    let totalTimer = null;
    let timedOut = false;
    let streamAborted = false;
    const internalAbort = new AbortController();

    const forwardAbort = () => {
      internalAbort.abort(signal?.reason);
    };
    if (signal) {
      if (signal.aborted) {
        internalAbort.abort(signal.reason);
      } else {
        signal.addEventListener('abort', forwardAbort, { once: true });
      }
    }

    const cleanupTimers = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      if (totalTimer) clearTimeout(totalTimer);
      silenceTimer = null;
      totalTimer = null;
      if (signal) signal.removeEventListener?.('abort', forwardAbort);
    };

    const handleTimeout = (reason) => {
      if (timedOut || streamAborted) return;
      timedOut = true;
      view?.setFallback(
        'Research timed out · continuing with approximate location',
      );
      try {
        internalAbort.abort(new Error(`Scene build timed out (${reason})`));
      } catch {}
    };

    const resetSilenceTimer = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      if (timedOut || streamAborted) return;
      silenceTimer = setTimeout(() => {
        handleTimeout('silence');
      }, silenceTimeoutMs);
      silenceTimer?.unref?.();
    };

    totalTimer = setTimeout(() => {
      handleTimeout('total');
    }, totalTimeoutMs);
    totalTimer?.unref?.();
    resetSilenceTimer();

    const onEvent = (evt) => {
      resetSilenceTimer();
      if (evt?.id) lastEventId = evt.id;
      const data = evt?.data || {};
      const at = Math.round(performance.now() - started);
      // Typed cinematic events → persistent runtime (reducer drops stale seq).
      try {
        cinematic?.onStreamEvent(evt);
      } catch (err) {
        console.warn('[cinematic] event rejected', err?.message || err);
      }
      switch (evt?.event) {
        case 'status':
          if (data.stage === 'fallback') {
            view?.setFallback(
              data.text ||
                'Research timed out · continuing with approximate location',
            );
          } else {
            view?.setStatus(data.stage, data.text);
          }
          if (data.stage) view?.setState('streaming');
          break;
        case 'fallback':
          view?.setFallback(
            data.reason ||
              data.text ||
              'Research timed out · continuing with approximate location',
          );
          if (data.reason || data.mode)
            fallbacks.push(data.reason || data.mode);
          break;
        case 'thinking':
          view?.setThinking(data.note);
          break;
        case 'model.selected':
          if (data.endpointId || data.modelId || data.id)
            view?.setModel(data.endpointId || data.modelId || data.id);
          break;
        case 'plan':
          if (timings.planMs == null) timings.planMs = at;
          if (data.model?.id || data.model?.endpointId)
            view?.setModel(data.model.id || data.model.endpointId);
          if (data.spec?.location) lastKnownOrigin = data.spec.location;
          else if (data.plan?.location) lastKnownOrigin = data.plan.location;
          break;
        case 'run.started':
          if (data.origin) lastKnownOrigin = data.origin;
          else if (data.location) lastKnownOrigin = data.location;
          break;
        case 'element_added':
          if (timings.firstElementMs == null) timings.firstElementMs = at;
          timings.elements += 1;
          try {
            streamLayer.addElement(data);
          } catch {
            /* preview only */
          }
          viewer?.scene?.requestRender?.();
          break;
        case 'narration_token':
          if (timings.ttftMs == null) timings.ttftMs = at;
          timings.tokens += 1;
          view?.appendToken(
            typeof data.token === 'string'
              ? data.token
              : String(data.token ?? ''),
          );
          break;
        case 'answer.delta': {
          if (timings.ttftMs == null) timings.ttftMs = at;
          const deltaText =
            typeof data.text === 'string'
              ? data.text
              : typeof data.delta === 'string'
                ? data.delta
                : '';
          const deltaTokens = Number.isFinite(data.tokens)
            ? data.tokens
            : Math.max(1, Math.round(deltaText.length / 4));
          timings.tokens += deltaTokens;
          view?.addTokens?.(deltaTokens);
          if (deltaText) view?.appendToken?.(deltaText, 0);
          break;
        }
        case 'usage':
          if (Number.isFinite(data.tokensEstimated)) {
            timings.tokens = data.tokensEstimated;
            view?.setTokensAuthoritative?.(data.tokensEstimated);
            if (timings.ttftMs != null) {
              const secs = Math.max(0.001, (at - timings.ttftMs) / 1000);
              timings.tokensPerSec = Math.round(data.tokensEstimated / secs);
              view?.setTokensPerSec(timings.tokensPerSec);
            }
          }
          break;
        case 'done':
          if (Array.isArray(data.result?.fallbacks)) {
            fallbacks.push(...data.result.fallbacks);
          }
          break;
        default:
          break;
      }
    };

    let result = null;
    try {
      const endpointId = cinematic?.selectedEndpointId?.();
      result = await client.constructSceneStream(
        { ...payload, requestId, ...(endpointId ? { endpointId } : {}) },
        { signal: internalAbort.signal, onEvent },
      );
    } catch (error) {
      if (signal?.aborted || (error?.name === 'AbortError' && !timedOut)) {
        streamAborted = true;
        cleanupTimers();
        throw error;
      }
      if (!timedOut) {
        if (!shouldFallBackToJsonConstruct(error)) {
          cleanupTimers();
          throw error;
        }
        view?.setState('reconnecting');
        timings.transport = `json-fallback:${error?.code || error?.status || error?.message || 'network'}`;
        try {
          result = await client.constructScene(payload, { signal });
        } catch {
          result = null;
        }
      }
    }

    if (!result && lastEventId && !timedOut && !signal?.aborted) {
      // Stream ended without a done event (dropped connection): resume once.
      view?.setState('reconnecting');
      try {
        result = await client.constructSceneStream(
          { ...payload, requestId },
          { signal: internalAbort.signal, onEvent, lastEventId },
        );
      } catch (error) {
        if (signal?.aborted || (error?.name === 'AbortError' && !timedOut)) {
          cleanupTimers();
          throw error;
        }
        if (!timedOut) {
          timings.transport = `json-fallback-after-resume:${error?.code || error?.status || 'network'}`;
          try {
            result = await client.constructScene(payload, { signal });
          } catch {
            result = null;
          }
        }
      }
    }

    cleanupTimers();

    if (timedOut) {
      view?.setFallback(
        'Research timed out · continuing with approximate location',
      );
      composerRef?.showNotice?.(
        'Scene build timed out — showing the best available scene',
      );

      // Branch A: element_added features were already streamed
      if (timings.elements > 0 || streamLayer.getState().count > 0) {
        composerRef?.element?.setAttribute('data-state', 'done');
        composerRef?.element?.setAttribute('data-fallback', 'partial');
        viewer?.scene?.requestRender?.();
        result = {
          ok: true,
          partial: true,
          fallback: 'partial',
          fallbacks: ['partial stream'],
          anchor: lastKnownOrigin || payload.candidate,
          __streamTimings: timings,
        };
        return result;
      }

      // Branch B: no elements streamed yet -> fall back to JSON /construct route once
      view?.setState('reconnecting');
      view?.setFallback(
        'Research timed out · continuing with approximate location',
      );
      try {
        result = await client.constructScene(payload, { signal });
        if (result && result.ok && result.plan) {
          if (!result.fallbacks) result.fallbacks = ['json fallback'];
          return result;
        }
      } catch {}

      // Branch C: JSON also failed -> render LOCAL fallback
      result = buildLocalTemplateFallback(payload, lastKnownOrigin);
      return result;
    }

    if (!result || !result.ok || !result.plan) {
      // Guaranteed render: if server returned no plan, build local fallback
      result = buildLocalTemplateFallback(payload, lastKnownOrigin);
    }

    if (fallbacks.length > 0 && result) {
      result.fallbacks = [
        ...new Set([...(result.fallbacks || []), ...fallbacks]),
      ];
    }

    timings.doneMs = Math.round(performance.now() - started);
    if (
      timings.tokensPerSec == null &&
      timings.tokens &&
      timings.ttftMs != null
    )
      timings.tokensPerSec = Math.round(
        timings.tokens /
          Math.max(0.001, (timings.doneMs - timings.ttftMs) / 1000),
      );
    if (result && typeof result === 'object')
      Object.defineProperty(result, '__streamTimings', {
        value: timings,
        enumerable: false,
      });
    return result;
  }

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
      // A verified geocoder hint must be inside the scene AOI. Unverified or
      // missing hints are resolved server-side; the RESOLVED anchor is gated below.
      const hasHintCoords =
        Number.isFinite(candidate?.lat) && Number.isFinite(candidate?.lon);
      if (candidate?.verified === true) {
        const gate = resolveIncidentGate(text, candidate);
        if (!gate.allowed)
          throw new Error('Outside UAE AOI — external context only');
      }
      const refinement =
        refinementContext?.prompt === text ? refinementContext : null;
      const result = await constructWithStream(
        {
          prompt: text,
          // QA degradation hook (fallback acceptance tests only; see
          // scripts/qa-bugfix-live.mjs). The server can only degrade with it.
          ...(win.__gevQaForce && typeof win.__gevQaForce === 'object'
            ? { qaForce: win.__gevQaForce }
            : {}),
          candidate: {
            name: String(candidate?.name || text).slice(0, 300),
            ...(hasHintCoords
              ? { lat: candidate.lat, lon: candidate.lon }
              : {}),
            verified: candidate?.verified === true,
            ...(candidate?.source
              ? { source: String(candidate.source).slice(0, 200) }
              : {}),
            ...(candidate?.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
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

      if (result.partial) {
        composerRef?.element?.setAttribute('data-state', 'done');
        composerRef?.element?.setAttribute('data-fallback', 'partial');
        const resolvedAnchor = result.anchor || {
          name: candidate?.name || text,
          lat: Number.isFinite(candidate?.lat) ? candidate.lat : 25.0806,
          lon: Number.isFinite(candidate?.lon) ? candidate.lon : 55.1397,
        };
        const scene = {
          id: `geo-scene-partial-${Date.now().toString(36)}`,
          title: text,
          geographic: true,
          anchor: resolvedAnchor,
          fallback: 'partial',
          fallbacks: ['partial stream'],
          selectedTime: {
            windowHours: extraction.windowHours,
            timeMode: extraction.timeMode,
            windowStart: extraction.windowStart,
            windowEnd: extraction.windowEnd,
          },
        };
        return scene;
      }

      if (!result.ok || !result.plan)
        throw new Error('No validated scene plan was returned.');
      const streamTimings = result.__streamTimings || null;
      const resolvedAnchor = result.plan.location;
      const gate = resolveIncidentGate(text, resolvedAnchor);
      if (!gate.allowed)
        throw new Error(
          `Resolved location ${resolvedAnchor.name} is outside the UAE scene AOI — external context only`,
        );
      const resolution = result.locationResolution || null;
      const scene = buildPlannedScene({
        plan: result.plan,
        candidate: {
          name: resolvedAnchor.name,
          lat: resolvedAnchor.lat,
          lon: resolvedAnchor.lon,
          verified: true,
          resolvedBy: 'scene-planner',
          approximate: resolution?.approximate === true,
          precision: resolution?.precision,
          confidence: resolution?.confidence,
          source:
            String(
              result.anchor?.source || candidate?.source || 'scene-planner',
            )
              .replace(/[^a-z0-9_-]/gi, '-')
              .slice(0, 80) || 'scene-planner',
          ...(resolvedAnchor.sourceUrl
            ? { sourceUrl: resolvedAnchor.sourceUrl }
            : {}),
          aoi_membership: { inside: true, aoi_ids: gate.aoiIds },
        },
        text,
        originalPrompt: refinement?.scene?.originalPrompt || text,
        geometry: result.geometry || null,
        locationResolution: resolution,
        staging: result.staging || null,
        selectedTime: {
          windowHours: extraction.windowHours,
          timeMode: extraction.timeMode,
          windowStart: extraction.windowStart,
          windowEnd: extraction.windowEnd,
        },
        now: new Date(),
      });
      if (result.fallbacks) scene.fallbacks = result.fallbacks;
      if (result.fallback) scene.fallback = result.fallback;
      // Cinematic runtime document (validated on save/load; null for legacy
      // planner results). The streamed events already built the live runtime;
      // the final document is kept so reload/library restores the same scene.
      if (result.cinematic) scene.cinematic = result.cinematic;
      // Telemetry only: non-enumerable so the strict saved-scene allowlist
      // (geographicScene.js snapshot) never sees an unknown field and
      // save/restore keeps working byte-for-byte.
      if (streamTimings)
        Object.defineProperty(scene, 'streamTimings', {
          value: streamTimings,
          enumerable: false,
          configurable: true,
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
      streamLayer.clear();
      stagingLayer.clear();
      sceneLegend?.clear();
      viewer?.scene?.requestRender?.();
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
      if (action === 'play') {
        const id = sceneDirector._selectedSceneId || state.scenes[0]?.id;
        if (id) return playScene(id, { fly: false });
        return cinematic?.playback?.play?.() ?? null;
      }
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
      sceneStaging: activeGeographicScene
        ? { ...stagingLayer.getState(), sceneId: activeGeographicScene.id }
        : null,
      sceneStream: {
        count: streamLayer.getState().count,
        timings: win.__gevLastStreamTimings || null,
      },
      lastConstructGeometryStatus: lastConstructGeometry?.status || null,
      studio: studio.getState(),
      sceneCamera: sceneCamera.getState(),
      cinematic: cinematic ? cinematic.state() : null,
    }),
    cinematic,
    destroy() {
      cinematic?.destroy();
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
      if (typeof win !== 'undefined' && win.__gevViewer === viewer) {
        delete win.__gevViewer;
      }
      doc.removeEventListener('keydown', onKey);
      composer.destroy();
      diagnostics.destroy();
      sceneLibrary.destroy();
      sceneLegend?.destroy?.();
      geographicOverlay.destroy();
      geometryLayer.destroy();
      streamLayer.destroy();
      stagingLayer.destroy();
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
