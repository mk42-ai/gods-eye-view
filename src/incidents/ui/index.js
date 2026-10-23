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
import { createIncidentComposer } from './composer.js';
import { ASK_OBJECT_EVENT } from '../../ondemand/miniChat.js';

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
  signal,
  document: doc = globalThis.document,
  window: win = globalThis.window,
  fetch: fetchImpl,
  storage,
} = {}) {
  if (!doc || !viewer || !sceneDirector) return null;
  const client = createIncidentClient({ fetch: fetchImpl, storage });
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
    text: 'AOI INCIDENTS',
  });
  const counts = el(doc, 'span', {
    id: `${INCIDENT_PANEL_ID}-counts`,
    className: 'incident-panel__counts',
    text: '…',
  });
  const refreshBtn = el(doc, 'button', {
    id: `${INCIDENT_PANEL_ID}-refresh`,
    className: 'scene-btn incident-panel__refresh',
    text: 'REFRESH LIVE',
    attrs: {
      type: 'button',
      title: 'Pull live incidents through OnDemand plugins (POST /refresh)',
    },
  });
  header.append(title, counts, refreshBtn);

  // playback bar: PAUSE / RESUME / PREV / NEXT / scrub
  const playback = el(doc, 'div', {
    id: PLAYBACK_BAR_ID,
    className: 'incident-playback',
  });
  const playBtn = el(doc, 'button', {
    id: `${PLAYBACK_BAR_ID}-play`,
    className: 'scene-btn',
    text: 'PLAY',
    attrs: { type: 'button' },
  });
  const pauseBtn = el(doc, 'button', {
    id: `${PLAYBACK_BAR_ID}-pause`,
    className: 'scene-btn',
    text: 'PAUSE',
    attrs: { type: 'button' },
  });
  const prevBtn = el(doc, 'button', {
    id: `${PLAYBACK_BAR_ID}-prev`,
    className: 'scene-btn',
    text: 'PREV',
    attrs: { type: 'button', 'aria-label': 'Previous keyframe' },
  });
  const nextBtn = el(doc, 'button', {
    id: `${PLAYBACK_BAR_ID}-next`,
    className: 'scene-btn',
    text: 'NEXT',
    attrs: { type: 'button', 'aria-label': 'Next keyframe' },
  });
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
  panel.append(header, playback, toggles, legend, hiddenNote);
  host.appendChild(panel);

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
      text: 'PLAY SCENE',
      attrs: { type: 'button', 'data-action': 'play' },
    });
    play.disabled = !scene;
    play.addEventListener('click', () => scene && playScene(scene.id));
    const ask = el(doc, 'button', {
      className: 'scene-btn incident-popover__ask ask-ondemand-btn',
      text: 'ASK ONDEMAND',
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
  function playScene(sceneId, { fly = true } = {}) {
    selectedSceneId = sceneId;
    const scene = state.scenes.find((s) => s.id === sceneId);
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
  prevBtn.addEventListener('click', () => {
    const id = sceneDirector._selectedSceneId;
    const shotId = sceneDirector._selectedShotId;
    if (id && shotId) void sceneDirector.loadAdjacentShot(id, shotId, -1);
  });
  nextBtn.addEventListener('click', () => {
    const id = sceneDirector._selectedSceneId;
    const shotId = sceneDirector._selectedShotId;
    if (id && shotId) void sceneDirector.loadAdjacentShot(id, shotId, 1);
  });
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
    pauseBtn.textContent = snap.running
      ? 'PAUSE'
      : sceneDirector.paused
        ? 'RESUME'
        : 'PAUSE';
    panel.dataset.playback = snap.running
      ? 'playing'
      : sceneDirector.paused
        ? 'paused'
        : 'idle';
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
    state.scenes = payload.scenes || buildScenes(state.incidents);
    state.rejected = payload.rejected || { count: 0, items: [] };
    state.perAoi = payload.per_aoi || {};
    state.groups = payload.aoi_groups || state.groups;
    overlay.setIncidents(state.incidents);
    sceneDirector.syncIncidentScenes(state.scenes);
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
      refreshBtn.textContent = 'REFRESH LIVE';
    }
  });

  // ---------------------------------------------------------------- composer
  const composer = createIncidentComposer({
    document: doc,
    client,
    buildScene: (incidents) => buildScenes(incidents)[0],
    // LIVE FOOTAGE (2026-10-23): a "rebuild the <incident> reported in
    // <place>" command drives the footage dock (fly-to + archive playlist)
    // and still builds the incident scene below.
    onFootageCommand: (command) => {
      const dock = win.__gevFootage;
      if (!dock) return null;
      void dock.runCommand(command.raw);
      return { handled: true, alsoBuildScene: true, skipPlayback: true };
    },
    onScene: async ({ scene, incident, override, footage }) => {
      const sceneWithFlags = override ? { ...scene, override: true } : scene;
      const added = sceneDirector.addIncidentScene(sceneWithFlags, {
        override,
        select: true,
      });
      if (!added.added) throw new Error(added.reason || 'scene rejected');
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
      // A LIVE FOOTAGE rebuild command already flew the camera to the
      // incident place; the approach→overhead→context tour would carry it
      // ~30 km away again, so the scene is selected but not auto-toured.
      if (footage?.skipPlayback) {
        selectedSceneId = scene.id;
        sceneDirector._selectedSceneId = scene.id;
        sceneDirector._publish?.({ type: 'scene-options-changed' });
        return;
      }
      await playScene(scene.id);
    },
  });
  (doc.body || doc.documentElement).appendChild(composer.element);

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
    }),
    destroy() {
      unsubscribeClock?.();
      doc.removeEventListener('keydown', onKey);
      composer.destroy();
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
