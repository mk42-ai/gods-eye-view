/**
 * Hyper-real Render — the Blender Scene Workstation panels merged into the
 * Gods Eye View console shell: one collapsible right-rail "Render" panel that
 * carries the live MJPEG render viewport (badged 'Illustrative render · not
 * evidence' with a GPU/fps HUD), the Outliner tree, the Properties sheet, the
 * Render stats (GPU 2 + 6 · Cycles OptiX badge), the timeline with Play/scrub
 * and the failure banner with HTTP status + Retry.
 *
 * ONE render path. Build scene → the shell calls `onSceneBuilt()` → exactly one
 * POST /api/patch-render (the ondemandPatchRender contract the OnDemand custom
 * tool calls too; render host token stays server-side) → poll
 * GET /api/scenes/render/:job/status every 2 s → MJPEG stream while frames
 * arrive, frame scrub from /frames/{n}.jpg, MP4 once complete.
 *
 * Honesty contract: every render is labelled "Illustrative render · not
 * evidence" (fixed badge, `data-illustrative="true"` on the root); a render is
 * NEVER presented as a verified feed or incident. Typing never fires a render;
 * the toggle only re-arms/cancels; the panel never covers the map viewport
 * (it lives in the collapsible right rail and can be collapsed).
 */
import {
  normalizeJob,
  outlinerRows,
  propertyEntries,
  progressText,
  progressFraction,
  buildFailure,
  jobGpus,
  timelineState,
  frameSource,
} from '../../workstation/model.js';

export const RENDER_LABEL = 'Illustrative render · not evidence';
export const RENDER_TOGGLE_ID = 'incident-composer-hyperreal';
export const RENDER_PANEL_ID = 'hyperreal-render-panel';
export const RENDER_ENDPOINT = '/api/patch-render';
export const GPU_BADGE = 'GPU 2 + 6 · Cycles OptiX';
export const RENDER_RESOLUTION_LABEL = '1280x720 viewport';

const TERMINAL = new Set(['complete', 'partial', 'failed', 'cancelled']);
const SECTIONS = Object.freeze([
  ['viewport', 'Viewport'],
  ['outliner', 'Outliner'],
  ['properties', 'Properties'],
  ['render', 'Render'],
  ['timeline', 'Timeline'],
]);

export function timeOfDayForScene(scene, prompt = '', now = () => new Date()) {
  const p = String(prompt || scene?.title || '').toLowerCase();
  if (/\bnight\b|midnight|after dark/.test(p)) return 'night';
  if (/\bdusk\b|sunset|evening|golden hour/.test(p)) return 'dusk';
  if (/\bmidday\b|\bnoon\b|afternoon|morning|daylight/.test(p)) return 'midday';
  // Fall back to the anchor's local solar time (UAE ≈ UTC+4) for a sensible default.
  const anchor = scene?.anchor;
  const lon = Number.isFinite(anchor?.lon) ? anchor.lon : 55;
  const h = (now().getUTCHours() + lon / 15 + 24) % 24;
  if (h >= 19.5 || h < 5.5) return 'night';
  if (h >= 17 || h < 7) return 'dusk';
  return 'midday';
}

/**
 * Body for POST /api/patch-render (ondemandPatchRender contract). The
 * constructed scene's verified anchor becomes the patch centre; the duration
 * is bounded 2–10 s by the contract (24 fps timeline → ≤ 240 frames).
 */
export function renderRequestForScene(
  scene,
  { prompt = '', durationS = 5 } = {},
) {
  const anchor = scene?.anchor;
  if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lon))
    return null;
  const text = String(
    prompt || scene.originalPrompt || scene.title || '',
  ).trim();
  if (text.length < 3) return null;
  const duration = Math.min(
    10,
    Math.max(2, Math.round(Number(durationS) || 5)),
  );
  return {
    prompt: text.slice(0, 600),
    lat: anchor.lat,
    lon: anchor.lon,
    place: String(anchor.name || scene.title || '').slice(0, 200) || undefined,
    time_of_day: timeOfDayForScene(scene, text),
    camera_mode: 'street',
    duration,
    resolution: '1280x720',
  };
}

/** Group the flat outliner rows into the Terrain / Buildings / Roads / Vehicles tree. */
export function outlinerTree(job) {
  const rows = outlinerRows(job);
  const groups = new Map();
  const put = (name, row) => {
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  };
  const lp = job?.land_patch;
  if (job?.patch || lp) {
    put('Terrain', {
      object: 'terrain',
      label: job?.patch?.elevation
        ? `DSM terrain · ${job.patch.elevation.source || job.patch.elevation.provider || 'service'}`
        : `AOI patch · ${job?.patch?.id || 'identifier pending'}`,
      count: 1,
      data: job?.patch?.elevation || job?.patch || {},
    });
  }
  if (lp) {
    put('Buildings', {
      object: 'env:buildings',
      label: `OSM buildings · ${lp.buildings ?? '?'}`,
      count: lp.buildings || 0,
      data: lp,
    });
    put('Roads', {
      object: 'env:roads',
      label: `OSM roads · ${lp.roads ?? '?'}`,
      count: lp.roads || 0,
      data: lp,
    });
  }
  for (const row of rows) {
    if (row.group) continue;
    const o = String(row.object || '');
    if (o === 'land_patch' || o === 'env:osm') continue;
    if (o === 'env:sidewalks') put('Roads', row);
    else if (o === 'env:imagery') put('Terrain', row);
    else if (o.startsWith('feature:')) {
      const kind = row.data?.properties?.kind || row.data?.kind;
      put(
        kind === 'roads' ? 'Roads' : kind === 'water' ? 'Terrain' : 'Buildings',
        row,
      );
    } else if (o === 'camera') put('Camera', row);
    else if (o.startsWith('scenery:')) put('Scenery (CC0)', row);
    else if (o.startsWith('ref_')) put('References', row);
    else if (row.asset) {
      const asset = String(row.data?.asset || o);
      put(
        /sedan|hatchback|vehicle|car|truck|van|police|ambulance/.test(asset)
          ? 'Vehicles'
          : /debris|glass|bumper|tire|door|plate/.test(asset)
            ? 'Debris'
            : 'Staging',
        row,
      );
    } else put('Service', row);
  }
  const order = [
    'Terrain',
    'Buildings',
    'Roads',
    'Vehicles',
    'Debris',
    'Staging',
    'Scenery (CC0)',
    'Camera',
    'References',
    'Service',
  ];
  return order
    .filter((name) => groups.has(name))
    .map((name) => ({ name, rows: groups.get(name) }));
}

/** Transform rows for the Properties sheet (location / rotation / scale). */
export function transformEntries(job, selection) {
  const row = outlinerRows(job).find((r) => r.object === selection);
  const d = row?.data || {};
  const pos = d.localPositionMetres || job?.camera?.position || null;
  const heading = Number.isFinite(d.headingDegrees) ? d.headingDegrees : null;
  const fmt = (v) =>
    Array.isArray(v) && v.length >= 3
      ? v
          .map((n) => (Number.isFinite(n) ? Number(n).toFixed(2) : '—'))
          .join(' / ')
      : '—';
  return [
    ['Location (m E/N/U)', fmt(pos)],
    [
      'Rotation (°)',
      heading !== null
        ? `0 / 0 / ${heading.toFixed(1)}`
        : job?.camera?.target
          ? 'look-at target'
          : '—',
    ],
    [
      'Scale',
      Number.isFinite(d.scale)
        ? `${d.scale} / ${d.scale} / ${d.scale}`
        : '1 / 1 / 1',
    ],
  ];
}

export function createHyperRealRender({
  document: doc = globalThis.document,
  window: win = globalThis.window,
  fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
  pollMs = 2000,
  durationS = 5,
  autoRender = true,
} = {}) {
  let scene = null;
  let prompt = '';
  let job = null;
  let pollTimer = null;
  let playTimer = null;
  let destroyed = false;
  let enabled = autoRender;
  let selection = null;
  let frameIndex = 0;
  let lastRequest = null;
  let buildSeq = 0;
  const counters = { posts: 0, polls: 0 };

  const el = (tag, className, attrs = {}, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // ---- toggle (lives in the composer row, next to Build scene)
  const toggle = el(
    'button',
    'incident-composer__submit incident-composer__hyperreal',
    {
      type: 'button',
      id: RENDER_TOGGLE_ID,
      'aria-pressed': enabled ? 'true' : 'false',
      'aria-label': 'Hyper-real Render',
      'data-affects-scene-build': 'false',
      title:
        'Hyper-real Render: after Build scene, one GPU render (Blender Cycles OptiX on GPUs 2 + 6) of the land patch is requested through /api/patch-render. Click to cancel / re-arm. Never evidence.',
    },
  );
  toggle.textContent = 'Hyper-real Render';
  toggle.disabled = true;

  // ---- panel (right rail, collapsible)
  const panel = el('aside', 'hyperreal-panel panel-collapsible', {
    id: RENDER_PANEL_ID,
    'aria-label': 'Hyper-real Render',
    'data-illustrative': 'true',
    'data-stage': 'idle',
  });
  // Visible from the start as a collapsed header strip (badge + GPU policy) so it
  // never covers the map; it expands when a render actually starts.
  panel.hidden = false;
  const header = el('div', 'hyperreal-panel__header');
  const titleEl = el('span', 'hyperreal-panel__title', {}, 'Render');
  const badgeEl = el(
    'span',
    'hyperreal-panel__badge',
    { 'data-testid': 'hyperreal-illustrative-badge' },
    RENDER_LABEL,
  );
  const collapseEl = el(
    'button',
    'hyperreal-panel__collapse',
    {
      type: 'button',
      'aria-expanded': 'true',
      'aria-label': 'Collapse render panel',
      title: 'Collapse (keeps the map viewport clear)',
    },
    '–',
  );
  const closeEl = el(
    'button',
    'hyperreal-panel__close',
    { type: 'button', 'aria-label': 'Close render panel' },
    '×',
  );
  header.append(titleEl, badgeEl, collapseEl, closeEl);

  const statusEl = el(
    'div',
    'hyperreal-panel__status',
    { role: 'status', 'aria-live': 'polite', 'data-stage': 'idle' },
    'Not started',
  );
  const progressEl = el('div', 'hyperreal-panel__progress', {
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': '0',
  });
  const progressBar = el('span', 'hyperreal-panel__progress-bar');
  progressEl.append(progressBar);

  // failure banner (HTTP status + Retry)
  const banner = el('div', 'hyperreal-panel__banner', {
    role: 'alert',
    'data-testid': 'hyperreal-failure-banner',
  });
  banner.hidden = true;
  const bannerText = el('span', 'hyperreal-panel__banner-text');
  const bannerStatus = el('code', 'hyperreal-panel__banner-status');
  const retryEl = el(
    'button',
    'hyperreal-panel__retry',
    { type: 'button', 'data-testid': 'hyperreal-retry' },
    'Retry',
  );
  banner.append(bannerStatus, bannerText, retryEl);

  // body: section tabs + sections
  const body = el('div', 'hyperreal-panel__body');
  const nav = el('div', 'hyperreal-panel__nav', { role: 'tablist' });
  const sections = {};
  const tabs = {};
  for (const [key, label] of SECTIONS) {
    const tab = el(
      'button',
      'hyperreal-panel__tab',
      {
        type: 'button',
        role: 'tab',
        'data-section': key,
        'aria-selected': 'false',
      },
      label,
    );
    const section = el(
      'section',
      `hyperreal-panel__section hyperreal-panel__section--${key}`,
      {
        'data-section': key,
        'aria-label': label,
      },
    );
    section.hidden = true;
    tabs[key] = tab;
    sections[key] = section;
    nav.append(tab);
    tab.addEventListener('click', () => openSection(key, true));
  }
  body.append(nav);

  // -- viewport (MJPEG stream / frame / mp4 + HUD + watermark)
  const viewport = el('div', 'hyperreal-panel__viewport', {
    'data-resolution': RENDER_RESOLUTION_LABEL,
  });
  const streamEl = el('img', 'hyperreal-panel__stream', {
    alt: 'Live illustrative render stream (MJPEG)',
    decoding: 'async',
  });
  const frameEl = el('img', 'hyperreal-panel__frame', {
    alt: 'Illustrative render frame',
    decoding: 'async',
  });
  const videoEl = el('video', 'hyperreal-panel__video', {
    controls: '',
    playsinline: '',
    muted: '',
    loop: '',
  });
  const hud = el('div', 'hyperreal-panel__hud', { 'aria-hidden': 'true' });
  const hudFrame = el(
    'span',
    'hyperreal-panel__hud-frame',
    {},
    'Frame 0000 / 0000',
  );
  const hudFps = el('span', 'hyperreal-panel__hud-fps', {}, '— fps');
  const hudGpu = el(
    'span',
    'hyperreal-panel__hud-gpu',
    { 'data-testid': 'hyperreal-gpu-badge' },
    GPU_BADGE,
  );
  hud.append(hudFrame, hudFps, hudGpu);
  const watermark = el(
    'div',
    'hyperreal-panel__watermark',
    { 'aria-hidden': 'true' },
    RENDER_LABEL,
  );
  const idleEl = el(
    'p',
    'hyperreal-panel__idle',
    {},
    'No render yet. Build scene requests one GPU render of the land patch.',
  );
  streamEl.hidden = true;
  frameEl.hidden = true;
  videoEl.hidden = true;
  viewport.append(idleEl, streamEl, frameEl, videoEl, hud, watermark);
  const metaEl = el('div', 'hyperreal-panel__meta');
  const links = el('div', 'hyperreal-panel__links');
  const mp4El = el(
    'a',
    'hyperreal-panel__mp4',
    { target: '_blank', rel: 'noopener' },
    'Open MP4',
  );
  const frameLinkEl = el(
    'a',
    'hyperreal-panel__frames',
    { target: '_blank', rel: 'noopener' },
    'Latest frame',
  );
  mp4El.hidden = true;
  frameLinkEl.hidden = true;
  links.append(mp4El, frameLinkEl);
  sections.viewport.append(viewport, metaEl, links);

  // -- outliner
  const outlinerEl = el('div', 'hyperreal-outliner', {
    role: 'tree',
    'data-testid': 'hyperreal-outliner',
  });
  sections.outliner.append(outlinerEl);

  // -- properties
  const propsEl = el('dl', 'hyperreal-props', {
    'data-testid': 'hyperreal-properties',
  });
  sections.properties.append(propsEl);

  // -- render stats
  const renderBadge = el(
    'span',
    'hyperreal-panel__gpu-badge',
    { 'data-testid': 'hyperreal-render-badge' },
    GPU_BADGE,
  );
  const renderStats = el('dl', 'hyperreal-render-stats', {
    'data-testid': 'hyperreal-render-stats',
  });
  sections.render.append(renderBadge, renderStats);

  // -- timeline
  const timeline = el('div', 'hyperreal-timeline', {
    'data-testid': 'hyperreal-timeline',
  });
  const playBtn = el(
    'button',
    'hyperreal-timeline__play',
    {
      type: 'button',
      'aria-pressed': 'false',
      'data-testid': 'hyperreal-play',
    },
    'Play',
  );
  const scrub = el('input', 'hyperreal-timeline__scrub', {
    type: 'range',
    min: '1',
    max: '1',
    value: '1',
    'aria-label': 'Frame',
  });
  scrub.disabled = true;
  const timecode = el(
    'span',
    'hyperreal-timeline__timecode',
    { 'data-testid': 'hyperreal-timecode' },
    '0 / 0 · 00:00.000',
  );
  timeline.append(playBtn, scrub, timecode);
  sections.timeline.append(timeline);

  for (const key of Object.keys(sections)) body.append(sections[key]);
  panel.append(header, statusEl, progressEl, banner, body);

  function openSection(key, user = false) {
    for (const [k, section] of Object.entries(sections)) {
      const on = k === key;
      section.hidden = !on;
      tabs[k].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[k].classList?.toggle?.('is-active', on);
    }
    panel.setAttribute('data-section', key);
    if (user) emit('gev:hyperreal-section', { section: key });
  }
  openSection('viewport');

  function setCollapsed(collapsed) {
    panel.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
    panel.classList?.toggle?.('collapsed', collapsed);
    collapseEl.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    collapseEl.setAttribute(
      'aria-label',
      collapsed ? 'Expand render panel' : 'Collapse render panel',
    );
    collapseEl.textContent = collapsed ? '+' : '–';
    body.hidden = collapsed;
    statusEl.hidden = collapsed;
    progressEl.hidden = collapsed;
  }
  collapseEl.addEventListener('click', () => {
    setCollapsed(panel.getAttribute('data-collapsed') !== 'true');
  });
  setCollapsed(true);
  closeEl.addEventListener('click', () => {
    panel.hidden = true;
  });

  const setStatus = (stage, text) => {
    statusEl.setAttribute('data-stage', stage);
    statusEl.textContent = text;
    panel.setAttribute('data-stage', stage);
  };
  const setProgress = (fraction) => {
    const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    progressEl.setAttribute('aria-valuenow', String(pct));
    progressBar.setAttribute('style', `width:${pct}%`);
  };
  const emit = (type, detail) => {
    try {
      const Ctor = win?.CustomEvent || globalThis.CustomEvent;
      if (Ctor && typeof win?.dispatchEvent === 'function')
        win.dispatchEvent(new Ctor(type, { detail }));
    } catch {
      /* non-browser host */
    }
  };
  const stopPolling = () => {
    if (pollTimer) win.clearTimeout(pollTimer);
    pollTimer = null;
  };
  const stopPlayback = () => {
    if (playTimer) win.clearTimeout(playTimer);
    playTimer = null;
    playBtn.setAttribute('aria-pressed', 'false');
    playBtn.textContent = 'Play';
  };
  const refreshToggle = () => {
    toggle.disabled = !renderRequestForScene(scene, { prompt, durationS });
    toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    toggle.classList?.toggle?.('is-active', enabled);
  };
  const showBanner = (failure) => {
    bannerStatus.textContent = failure.status
      ? `HTTP ${failure.status}`
      : failure.kind || 'error';
    bannerText.textContent = failure.message || failure.code || 'Render failed';
    banner.setAttribute('data-code', failure.code || '');
    banner.hidden = false;
    retryEl.disabled = !lastRequest;
  };
  const hideBanner = () => {
    banner.hidden = true;
  };
  const clearMedia = () => {
    stopPlayback();
    for (const node of [streamEl, frameEl, videoEl]) {
      node.hidden = true;
      node.removeAttribute('src');
    }
    mp4El.hidden = true;
    frameLinkEl.hidden = true;
    idleEl.hidden = false;
    metaEl.textContent = '';
    hudFrame.textContent = 'Frame 0000 / 0000';
    hudFps.textContent = '— fps';
    outlinerEl.replaceChildren?.();
    propsEl.replaceChildren?.();
    renderStats.replaceChildren?.();
    scrub.disabled = true;
    scrub.setAttribute('max', '1');
    scrub.value = '1';
    timecode.textContent = '0 / 0 · 00:00.000';
  };

  const pad = (n) => String(n).padStart(4, '0');
  const fmtMs = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(Math.floor(ms % 1000)).padStart(3, '0')}`;
  };

  function renderOutliner(j) {
    const tree = outlinerTree(j);
    const nodes = [];
    for (const group of tree) {
      const g = el('div', 'hyperreal-outliner__group', {
        role: 'treeitem',
        'aria-expanded': 'true',
        'data-group': group.name,
      });
      const head = el(
        'div',
        'hyperreal-outliner__group-head',
        {},
        `${group.name} (${group.rows.length})`,
      );
      const list = el('div', 'hyperreal-outliner__children', { role: 'group' });
      for (const row of group.rows.slice(0, 80)) {
        const item = el(
          'button',
          'hyperreal-outliner__item',
          {
            type: 'button',
            role: 'treeitem',
            'data-object': String(row.object),
            'aria-selected': selection === row.object ? 'true' : 'false',
          },
          `${row.label}${row.count > 1 ? ` ×${row.count}` : ''}`,
        );
        item.addEventListener('click', () => {
          selection = row.object;
          renderOutliner(job);
          renderProps(job);
          openSection('properties');
          emit('gev:hyperreal-select', { object: row.object });
        });
        list.append(item);
      }
      if (group.rows.length > 80)
        list.append(
          el(
            'span',
            'hyperreal-outliner__more',
            {},
            `… ${group.rows.length - 80} more`,
          ),
        );
      g.append(head, list);
      nodes.push(g);
    }
    outlinerEl.replaceChildren?.(...nodes);
    outlinerEl.setAttribute('data-groups', tree.map((t) => t.name).join(','));
  }
  function renderProps(j) {
    const entries = [
      ...transformEntries(j, selection),
      ...propertyEntries(j, { selection }).filter(([k]) =>
        [
          'Selected',
          'Job',
          'Renderer',
          'Device',
          'GPUs',
          'Stage',
          'Frames rendered',
        ].includes(k),
      ),
    ];
    const nodes = [];
    for (const [k, v] of entries) {
      nodes.push(
        el('dt', '', {}, k),
        el('dd', '', { 'data-prop': k }, String(v ?? '—')),
      );
    }
    propsEl.replaceChildren?.(...nodes);
  }
  function renderStatsSheet(j) {
    const gpus = jobGpus(j);
    const entries = [
      ['Engine', 'Blender 4.2 Cycles · OptiX'],
      [
        'GPUs',
        gpus.length
          ? gpus.map((g) => `GPU ${g}`).join(' + ')
          : 'GPU 2 + 6 (policy)',
      ],
      ['Resolution', RENDER_RESOLUTION_LABEL],
      [
        'Samples',
        j?.request?.samples ?? j?.samples ?? 'adaptive (service default)',
      ],
      ['First frame', Number.isFinite(j?.ttff_s) ? `${j.ttff_s} s` : '—'],
      [
        'Steady fps',
        Number.isFinite(j?.fps_steady) ? `${j.fps_steady} fps` : '—',
      ],
      ['Frames', `${j?.frames_done || 0} / ${j?.total_frames || '?'}`],
      ['Encoder', j?.encoder || 'libx264 (CPU) on completion'],
      ['Label', RENDER_LABEL],
    ];
    const nodes = [];
    for (const [k, v] of entries)
      nodes.push(
        el('dt', '', {}, k),
        el('dd', '', { 'data-stat': k }, String(v)),
      );
    renderStats.replaceChildren?.(...nodes);
  }
  function showFrame(n) {
    if (!job) return;
    const src = frameSource(job, n);
    if (!src) return;
    frameIndex = n;
    frameEl.setAttribute('src', src);
    frameEl.hidden = false;
    idleEl.hidden = true;
    streamEl.hidden = true;
    videoEl.hidden = true;
    const t = timelineState(job, n);
    scrub.value = String(n);
    const fps = Number(job.timeline_fps) || 24;
    timecode.textContent = `${n} / ${t.total || job.total_frames || '?'} · ${fmtMs(((n - 1) / fps) * 1000)}`;
    hudFrame.textContent = `Frame ${pad(n)} / ${pad(job.total_frames || 0)}`;
    emit('gev:hyperreal-frame', { frame: n });
  }
  function updateTimeline(j) {
    const total = Math.max(1, Number(j?.frames_done) || 0);
    scrub.setAttribute('max', String(total));
    scrub.disabled = !(j?.frames_done > 0 && j?.frames_url_template);
    playBtn.disabled = scrub.disabled;
    if (!frameIndex) {
      timecode.textContent = `${j?.frames_done || 0} / ${j?.total_frames || '?'} · 00:00.000`;
      hudFrame.textContent = `Frame ${pad(j?.frames_done || 0)} / ${pad(j?.total_frames || 0)}`;
    }
  }
  scrub.addEventListener('input', () => {
    stopPlayback();
    showFrame(Number(scrub.value) || 1);
  });
  playBtn.addEventListener('click', () => {
    if (playTimer) return stopPlayback();
    if (!job || !(job.frames_done > 0)) return;
    playBtn.setAttribute('aria-pressed', 'true');
    playBtn.textContent = 'Pause';
    const fps = Math.min(24, Number(job.timeline_fps) || 24);
    const step = () => {
      if (destroyed || !job) return stopPlayback();
      const total = Number(job.frames_done) || 1;
      const next = frameIndex >= total ? 1 : frameIndex + 1;
      showFrame(next);
      playTimer = win.setTimeout(step, 1000 / fps);
    };
    step();
  });

  function showJob(raw) {
    const s = normalizeJob(raw, job || {});
    job = { ...job, ...s };
    const parts = [];
    if (s.focal?.name)
      parts.push(`${s.focal.name} · ${s.time_of_day || ''}`.trim());
    if (s.land_patch)
      parts.push(
        `patch: ${s.land_patch.buildings} buildings · ${s.land_patch.roads} roads`,
      );
    if (s.placement?.instances)
      parts.push(`${s.placement.instances} staged assets`);
    if (s.scenery?.count) parts.push(`${s.scenery.count} CC0 scenery`);
    if (Number.isFinite(s.ttff_s)) parts.push(`first frame ${s.ttff_s}s`);
    if (Number.isFinite(s.fps_steady) && s.fps_steady > 0)
      parts.push(`${s.fps_steady} fps steady`);
    const gpus = jobGpus(s);
    if (gpus.length) parts.push(`GPUs ${gpus.join(', ')}`);
    metaEl.textContent = parts.join(' · ');
    hudFps.textContent =
      Number.isFinite(s.fps_steady) && s.fps_steady > 0
        ? `${s.fps_steady.toFixed(1)} fps`
        : '— fps';
    hudGpu.textContent = gpus.length
      ? `GPU ${gpus.join(' + ')} · Cycles OptiX`
      : GPU_BADGE;
    setProgress(progressFraction(s));
    renderOutliner(job);
    renderProps(job);
    renderStatsSheet(job);
    updateTimeline(job);
    if (TERMINAL.has(s.stage)) {
      stopPolling();
      streamEl.hidden = true;
      streamEl.removeAttribute('src');
      if (s.stage === 'failed' || s.stage === 'cancelled') {
        setStatus(
          s.stage,
          `Render ${s.stage}: ${s.error || 'no detail from service'}`,
        );
        showBanner(
          buildFailure({
            kind: 'service',
            status: null,
            body: { code: s.stage, message: s.error || `Render ${s.stage}` },
          }),
        );
        emit('gev:hyperreal-status', { ...s });
        return;
      }
      setStatus(
        s.stage,
        s.stage === 'complete'
          ? `Complete · ${s.frames_done} frames`
          : `Partial · ${s.frames_done}/${s.total_frames || '?'} frames`,
      );
      if (s.mp4_bytes > 0 && s.mp4_url) {
        videoEl.setAttribute('src', s.mp4_url);
        videoEl.hidden = false;
        frameEl.hidden = true;
        idleEl.hidden = true;
        mp4El.setAttribute('href', s.mp4_url);
        mp4El.hidden = false;
      } else if (s.frames_done > 0) {
        showFrame(s.frames_done);
      }
      if (s.frames_done > 0 && s.latest_frame_url) {
        frameLinkEl.setAttribute('href', s.latest_frame_url);
        frameLinkEl.hidden = false;
      }
      emit('gev:hyperreal-status', { ...s });
      return;
    }
    setStatus(s.stage || 'queued', progressText(s, prompt));
    if (
      s.frames_done > 0 &&
      streamEl.hidden &&
      !streamEl.getAttribute('src') &&
      s.stream_url
    ) {
      streamEl.setAttribute('src', s.stream_url);
      streamEl.hidden = false;
      frameEl.hidden = true;
      idleEl.hidden = true;
    }
    emit('gev:hyperreal-status', { ...s });
  }

  async function poll(seq) {
    if (!job || destroyed || seq !== buildSeq) return;
    try {
      counters.polls++;
      const r = await fetchImpl(`/api/scenes/render/${job.job_id}/status`, {
        cache: 'no-store',
      });
      const s = await r.json();
      if (seq !== buildSeq) return;
      if (!r.ok)
        throw Object.assign(new Error(s?.error || `HTTP ${r.status}`), {
          status: r.status,
          body: s,
        });
      showJob(s);
    } catch (error) {
      if (seq !== buildSeq) return;
      setStatus(
        'error',
        `Status unavailable: ${String(error?.message || error).slice(0, 120)}`,
      );
      if (error?.status) {
        showBanner(
          buildFailure({
            kind: 'status',
            status: error.status,
            body: error.body,
            error,
          }),
        );
        stopPolling();
        return;
      }
    }
    if (!destroyed && job && !TERMINAL.has(job.stage) && seq === buildSeq)
      pollTimer = win.setTimeout(() => poll(seq), pollMs);
  }

  async function start(
    body = renderRequestForScene(scene, { prompt, durationS }),
  ) {
    if (!body) return null;
    const seq = ++buildSeq;
    stopPolling();
    job = null;
    selection = null;
    frameIndex = 0;
    hideBanner();
    clearMedia();
    setProgress(0.02);
    panel.hidden = false;
    setCollapsed(false);
    lastRequest = body;
    setStatus('submitting', 'Submitting render job via /api/patch-render…');
    openSection('viewport');
    try {
      counters.posts++;
      emit('gev:hyperreal-submit', {
        request: body,
        endpoint: RENDER_ENDPOINT,
      });
      const r = await fetchImpl(RENDER_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (seq !== buildSeq) return null;
      if (r.status === 503 && data?.error === 'not_configured') {
        setStatus(
          'not_configured',
          'Render service not connected on this deployment (RENDER_SERVICE_URL unset). Nothing was rendered.',
        );
        showBanner(buildFailure({ kind: 'request', status: 503, body: data }));
        return null;
      }
      if (!r.ok) {
        const failure = buildFailure({
          kind: 'request',
          status: r.status,
          body: data,
        });
        setStatus('failed', `Render request failed (HTTP ${r.status})`);
        showBanner(failure);
        emit('gev:hyperreal-failed', { status: r.status, body: data });
        return null;
      }
      job = normalizeJob(data, { request: body });
      job.job_id = data.job_id || data.jobId;
      setStatus('queued', `Queued · job ${job.job_id}`);
      setProgress(0.03);
      emit('gev:hyperreal-start', { jobId: job.job_id, request: body });
      pollTimer = win.setTimeout(() => poll(seq), Math.min(pollMs, 1500));
      return data;
    } catch (error) {
      if (seq !== buildSeq) return null;
      setStatus(
        'error',
        `Could not start render: ${String(error?.message || error).slice(0, 120)}`,
      );
      showBanner(buildFailure({ kind: 'network', status: null, error }));
      return null;
    }
  }

  retryEl.addEventListener('click', () => {
    if (lastRequest) void start(lastRequest);
  });

  toggle.addEventListener('click', () => {
    if (toggle.disabled) return;
    enabled = !enabled;
    refreshToggle();
    if (enabled) void start();
    else {
      buildSeq++;
      stopPolling();
      stopPlayback();
      if (job && !TERMINAL.has(job.stage)) {
        setStatus('cancelled', 'Render cancelled by operator');
        void fetchImpl(`/api/scenes/render/${job.job_id}/cancel`, {
          method: 'POST',
        }).catch(() => {});
      }
    }
  });

  return {
    toggle,
    panel,
    start,
    openSection,
    /** Scene changed (typing / new prompt / cleared): never fires a render. */
    setScene(nextScene, nextPrompt) {
      scene = nextScene || null;
      if (typeof nextPrompt === 'string') prompt = nextPrompt;
      if (!scene) {
        buildSeq++;
        stopPolling();
        stopPlayback();
      }
      refreshToggle();
    },
    /** Build scene succeeded: exactly ONE render request per completed build. */
    onSceneBuilt(builtScene, builtPrompt) {
      this.setScene(builtScene, builtPrompt);
      if (!enabled || !scene) return null;
      return start();
    },
    getJob: () => job,
    getCounters: () => ({ ...counters }),
    isEnabled: () => enabled,
    destroy() {
      destroyed = true;
      buildSeq++;
      stopPolling();
      stopPlayback();
      toggle.remove?.();
      panel.remove?.();
    },
  };
}
