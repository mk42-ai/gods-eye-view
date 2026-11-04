/**
 * Hyper-real Render — opt-in toggle next to Build scene plus a right-side
 * "Render" panel.
 *
 * Flow (all through the same-origin proxy in server/scene-render/routes.js, so
 * the GPU service token never reaches the browser):
 *   toggle on → POST /api/scenes/render {prompt, lat, lng, time_of_day, duration_s}
 *   → poll GET /api/scenes/render/:job/status every 2 s
 *   → show the live MJPEG stream (/stream) while frames arrive, the latest
 *     frame, then the MP4 link once the job is complete.
 *
 * Honesty contract: every render is labelled "Illustrative render · not
 * evidence" (fixed badge inside the panel, `data-illustrative="true"` on the
 * root); a render is NEVER presented as a verified feed or incident. The
 * toggle is a separate, explicit action: it never affects Build scene, never
 * auto-fires on typing, and is a no-op until a scene has been constructed.
 */
export const RENDER_LABEL = 'Illustrative render · not evidence';
export const RENDER_TOGGLE_ID = 'incident-composer-hyperreal';
export const RENDER_PANEL_ID = 'hyperreal-render-panel';

const TERMINAL = new Set(['complete', 'partial', 'failed']);

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

export function renderRequestForScene(
  scene,
  { prompt = '', durationS = 60 } = {},
) {
  const anchor = scene?.anchor;
  if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lon))
    return null;
  const text = String(
    prompt || scene.originalPrompt || scene.title || '',
  ).trim();
  if (text.length < 3) return null;
  return {
    prompt: text.slice(0, 600),
    lat: anchor.lat,
    lng: anchor.lon,
    time_of_day: timeOfDayForScene(scene, text),
    duration_s: durationS,
  };
}

export function createHyperRealRender({
  document: doc = globalThis.document,
  window: win = globalThis.window,
  fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
  pollMs = 2000,
  durationS = 60,
} = {}) {
  let scene = null;
  let prompt = '';
  let job = null;
  let pollTimer = null;
  let destroyed = false;
  let enabled = false;

  // ---- toggle (lives in the composer row, next to Build scene)
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.id = RENDER_TOGGLE_ID;
  toggle.className = 'incident-composer__submit incident-composer__hyperreal';
  toggle.setAttribute('aria-pressed', 'false');
  toggle.setAttribute('aria-label', 'Hyper-real Render');
  toggle.setAttribute('data-affects-scene-build', 'false');
  toggle.title =
    'Hyper-real Render: path-traced illustrative render of the constructed scene on the GPU host (separate from Build scene; never evidence)';
  toggle.textContent = 'Hyper-real Render';
  toggle.disabled = true;

  // ---- panel (right rail)
  const panel = doc.createElement('aside');
  panel.id = RENDER_PANEL_ID;
  panel.className = 'hyperreal-panel';
  panel.setAttribute('aria-label', 'Hyper-real Render');
  panel.setAttribute('data-illustrative', 'true');
  panel.hidden = true;
  const el = (tag, className, attrs = {}, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const header = el('div', 'hyperreal-panel__header');
  const titleEl = el('span', 'hyperreal-panel__title', {}, 'Render');
  const badgeEl = el(
    'span',
    'hyperreal-panel__badge',
    { 'data-testid': 'hyperreal-illustrative-badge' },
    RENDER_LABEL,
  );
  const closeEl = el(
    'button',
    'hyperreal-panel__close',
    { type: 'button', 'aria-label': 'Close render panel' },
    '×',
  );
  header.append(titleEl, badgeEl, closeEl);
  const statusEl = el(
    'div',
    'hyperreal-panel__status',
    { role: 'status', 'aria-live': 'polite', 'data-stage': 'idle' },
    'Not started',
  );
  const viewport = el('div', 'hyperreal-panel__viewport');
  const streamEl = el('img', 'hyperreal-panel__stream', {
    alt: 'Live illustrative render stream',
  });
  const frameEl = el('img', 'hyperreal-panel__frame', {
    alt: 'Latest illustrative render frame',
  });
  const videoEl = el('video', 'hyperreal-panel__video', {
    controls: '',
    playsinline: '',
  });
  const watermark = el(
    'div',
    'hyperreal-panel__watermark',
    { 'aria-hidden': 'true' },
    RENDER_LABEL,
  );
  streamEl.hidden = true;
  frameEl.hidden = true;
  videoEl.hidden = true;
  viewport.append(streamEl, frameEl, videoEl, watermark);
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
  panel.append(header, statusEl, viewport, metaEl, links);
  closeEl.addEventListener('click', () => {
    panel.hidden = true;
  });

  const setStatus = (stage, text) => {
    statusEl.setAttribute('data-stage', stage);
    statusEl.textContent = text;
    panel.setAttribute('data-stage', stage);
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
  const refreshToggle = () => {
    toggle.disabled = !renderRequestForScene(scene, { prompt, durationS });
    toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    toggle.classList?.toggle?.('is-active', enabled);
  };

  function showJob(s) {
    const pct = Math.round((Number(s.progress) || 0) * 100);
    const parts = [];
    if (s.focal?.name)
      parts.push(`${s.focal.name} · ${s.time_of_day || ''}`.trim());
    if (s.model?.endpointId)
      parts.push(
        `spec: ${s.model.endpointId}${s.model.fallback ? ' (template fallback)' : ''}`,
      );
    if (s.land_patch)
      parts.push(
        `patch: ${s.land_patch.buildings} buildings · ${s.land_patch.roads} roads · ${s.land_patch.tiles_ok} imagery tiles`,
      );
    if (s.placement) parts.push(`${s.placement.instances} placed assets`);
    if (Number.isFinite(s.ttff_s)) parts.push(`first frame ${s.ttff_s}s`);
    if (Number.isFinite(s.fps_sustained) && s.fps_sustained > 0)
      parts.push(`${s.fps_sustained} fps sustained`);
    if (s.gpu_metrics)
      parts.push(`GPUs ${Object.keys(s.gpu_metrics).join(',')}`);
    metaEl.textContent = parts.join(' · ');
    if (TERMINAL.has(s.stage)) {
      stopPolling();
      streamEl.hidden = true;
      streamEl.removeAttribute('src');
      if (s.stage === 'failed') {
        setStatus('failed', `Render failed: ${s.error || 'unknown error'}`);
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
        mp4El.setAttribute('href', s.mp4_url);
        mp4El.hidden = false;
      } else if (s.frames_done > 0) {
        frameEl.setAttribute('src', `${s.latest_frame_url}?t=${Date.now()}`);
        frameEl.hidden = false;
      }
      if (s.frames_done > 0) {
        frameLinkEl.setAttribute('href', s.latest_frame_url);
        frameLinkEl.hidden = false;
      }
      return;
    }
    setStatus(
      s.stage || 'queued',
      `${s.stage || 'queued'} · ${pct}%${s.frames_done ? ` · ${s.frames_done} frames` : ''}`,
    );
    if (s.frames_done > 0 && streamEl.hidden && !streamEl.getAttribute('src')) {
      streamEl.setAttribute('src', s.stream_url);
      streamEl.hidden = false;
      frameEl.hidden = true;
    }
  }

  async function poll() {
    if (!job || destroyed) return;
    try {
      const r = await fetchImpl(`/api/scenes/render/${job.job_id}/status`, {
        cache: 'no-store',
      });
      const s = await r.json();
      if (!r.ok) throw new Error(s?.error || `HTTP ${r.status}`);
      job = { ...job, ...s };
      showJob(s);
      emit('gev:hyperreal-status', { ...s });
    } catch (error) {
      setStatus(
        'error',
        `Status unavailable: ${String(error?.message || error).slice(0, 120)}`,
      );
    }
    if (!destroyed && job && !TERMINAL.has(job.stage))
      pollTimer = win.setTimeout(poll, pollMs);
  }

  async function start() {
    const body = renderRequestForScene(scene, { prompt, durationS });
    if (!body) return null;
    stopPolling();
    job = null;
    videoEl.hidden = true;
    videoEl.removeAttribute('src');
    frameEl.hidden = true;
    streamEl.hidden = true;
    streamEl.removeAttribute('src');
    mp4El.hidden = true;
    frameLinkEl.hidden = true;
    metaEl.textContent = '';
    panel.hidden = false;
    setStatus('submitting', 'Submitting render job…');
    try {
      const r = await fetchImpl('/api/scenes/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 503 && data?.error === 'not_configured') {
        setStatus(
          'not_configured',
          'Render service not connected on this deployment (RENDER_SERVICE_URL unset). Nothing was rendered.',
        );
        return null;
      }
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      job = { ...data, request: body };
      setStatus('queued', `Queued · job ${data.job_id}`);
      emit('gev:hyperreal-start', { jobId: data.job_id, request: body });
      pollTimer = win.setTimeout(poll, Math.min(pollMs, 1500));
      return data;
    } catch (error) {
      setStatus(
        'error',
        `Could not start render: ${String(error?.message || error).slice(0, 120)}`,
      );
      return null;
    }
  }

  toggle.addEventListener('click', () => {
    if (toggle.disabled) return;
    enabled = !enabled;
    refreshToggle();
    if (enabled) void start();
    else {
      stopPolling();
      panel.hidden = true;
    }
  });

  return {
    toggle,
    panel,
    start,
    setScene(nextScene, nextPrompt) {
      scene = nextScene || null;
      if (typeof nextPrompt === 'string') prompt = nextPrompt;
      if (!scene) {
        enabled = false;
        stopPolling();
      }
      refreshToggle();
    },
    getJob: () => job,
    isEnabled: () => enabled,
    destroy() {
      destroyed = true;
      stopPolling();
      toggle.remove?.();
      panel.remove?.();
    },
  };
}
