/**
 * Scene Workstation — Blender-only Build flow.
 *
 * Build press -> exactly ONE `POST /api/scenes/render` (same-origin proxy; the
 * GPU service token stays server-side) -> poll `/status` -> show the newest
 * Cycles/OptiX frame from `/latest.jpg` in the viewport -> fill the outliner
 * from the job's real placement (`placement.by_asset`) and the properties panel
 * from the job record. No Cesium globe, no map legend, no sprite icons.
 *
 * Viewport states (data-state on #ws-app): idle | building | ready | error.
 * - idle: no <img> is in the layout (the frame element is detached until a
 *   frame has decoded, so a broken-image placeholder can never render).
 * - building: a progress panel reports stage, frame i/N and the GPU(s).
 * - error: a banner shows the HTTP status, error code and service message
 *   plus a Retry button; the status badge never falls back to "Ready".
 */
import './workstation.css';
import {
  progressText,
  progressFraction,
  buildFailure,
  outlinerRows,
  propertyEntries,
  timelineState,
  isCurrentRun,
} from './model.js';

const $ = (sel) => document.querySelector(sel);
const app = $('#ws-app');
const form = $('#ws-prompt-form');
const input = $('#ws-prompt');
const buildBtn = $('#ws-build');
const viewport = $('#ws-viewport');
const frameSlot = $('#ws-frame-slot');
const canvas = $('#ws-frame-canvas');
const statusEl = $('#ws-status');
const hud = $('#ws-hud');
const progressEl = $('#ws-progress');
const progressBar = $('#ws-progress-bar');
const progressTextEl = $('#ws-progress-text');
const banner = $('#ws-banner');
const bannerText = $('#ws-banner-text');
const retryBtn = $('#ws-retry');
const outliner = $('#ws-outliner-list');
const props = $('#ws-props');
const scrub = $('#ws-scrub');
const readout = $('#ws-frame-readout');

const POLL_MS = 1500;
const DURATION_S = 4;
const SAMPLES = 24;
const PLAY_FPS = 12;

/** Public QA surface (read by the validator). */
const ws = {
  buildRequests: 0,
  statusPolls: 0,
  job: null,
  result: null,
  failure: null,
  history: [],
  errors: [],
};
window.__ws = ws;

// Guard: an allocation failure while decoding/analysing a frame ("RangeError: Array buffer
// allocation failed" took down the old Cesium renderer) must never stop the Build loop. The
// workstation only ever holds one 1280x720 frame plus a 64x36 analysis canvas.
window.addEventListener('error', (event) => {
  if (event?.error instanceof RangeError) {
    ws.errors.push(String(event.error.message).slice(0, 160));
    event.preventDefault();
  }
});

let run = 0;
let frames = { total: 0, done: 0, current: 0, template: '' };
let playTimer = null;
let lastPrompt = '';

/** The viewport <img>: created lazily and attached only once a frame decoded. */
let img = null;
function frameElement() {
  if (img) return img;
  img = document.createElement('img');
  img.id = 'ws-frame';
  img.className = 'ws-frame';
  img.alt = 'Blender Cycles render';
  img.decoding = 'async';
  return img;
}
function detachFrame() {
  if (img && img.isConnected) img.remove();
  if (img) {
    img.removeAttribute('src');
    img.removeAttribute('data-loaded');
  }
}

function setStatus(text, state) {
  statusEl.textContent = text;
  if (state) app.dataset.state = state;
}

function showProgress(job, prompt) {
  progressEl.hidden = false;
  progressTextEl.textContent = progressText(job, prompt);
  progressBar.style.width = `${Math.round(progressFraction(job) * 100)}%`;
  progressEl.setAttribute(
    'aria-valuenow',
    String(Math.round(progressFraction(job) * 100)),
  );
}
function hideProgress() {
  progressEl.hidden = true;
}

function showBanner(failure) {
  ws.failure = failure;
  bannerText.textContent = failure.text;
  banner.dataset.kind = failure.kind;
  banner.dataset.status = String(failure.status ?? '');
  banner.hidden = false;
  hideProgress();
  setStatus(`${failure.title} — see banner`, 'error');
}
function hideBanner() {
  banner.hidden = true;
  ws.failure = null;
}

function renderOutliner(job) {
  const rows = outlinerRows(job);
  if (!rows.length) {
    outliner.innerHTML =
      '<li class="ws-empty">No scene yet. Type a prompt and press Build.</li>';
    return;
  }
  const esc = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  outliner.innerHTML = rows
    .map((r) => {
      if (r.group) return `<li class="ws-group">${esc(r.group)}</li>`;
      const cls = [
        r.asset ? 'ws-asset' : '',
        r.reference ? 'ws-ref' : '',
        r.state ? `ws-ref-${r.state.replace(/[^a-z]+/g, '-')}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      const title = r.reference
        ? ` title="${esc(r.reference)}${r.state ? ` · ${esc(r.state)}` : ''}"`
        : '';
      const state = r.state
        ? `<em class="ws-ref-state">${esc(r.state)}</em>`
        : '';
      return `<li data-object="${esc(r.object)}" class="${cls}"${title}><span>${esc(r.label)}${state}</span><span class="ws-count">${esc(r.count)}</span></li>`;
    })
    .join('');
}

function renderProps(job, extra = {}) {
  props.innerHTML = propertyEntries(job, extra, ws.result)
    .map(([k, v]) => `<dt>${k}</dt><dd>${String(v)}</dd>`)
    .join('');
}

/** Average-hash (8x8) + luminance stddev of the frame currently shown. */
function analyseFrame() {
  try {
    const w = img?.naturalWidth || 0;
    const h = img?.naturalHeight || 0;
    if (!w || !h) return null;
    canvas.width = 64;
    canvas.height = 36;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 64, 36);
    const data = ctx.getImageData(0, 0, 64, 36).data;
    const lum = [];
    for (let i = 0; i < data.length; i += 4)
      lum.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
    const std = Math.sqrt(
      lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length,
    );
    ctx.drawImage(img, 0, 0, 8, 8);
    const small = ctx.getImageData(0, 0, 8, 8).data;
    const g = [];
    for (let i = 0; i < small.length; i += 4)
      g.push(0.299 * small[i] + 0.587 * small[i + 1] + 0.114 * small[i + 2]);
    const gm = g.reduce((a, b) => a + b, 0) / g.length;
    const hash = g.map((v) => (v > gm ? '1' : '0')).join('');
    return {
      width: w,
      height: h,
      lumMean: Math.round(mean * 10) / 10,
      lumStd: Math.round(std * 10) / 10,
      ahash: hash,
    };
  } catch (error) {
    if (error instanceof RangeError) ws.errors.push(String(error.message));
    return null;
  }
}

/**
 * Decode a frame off-DOM first; only a successfully decoded image is attached
 * to the viewport, so a 404/5xx frame can never leave a broken placeholder.
 */
function showFrame(url) {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.decoding = 'async';
    probe.onload = () => {
      const el = frameElement();
      el.src = probe.src;
      if (!el.isConnected) frameSlot.appendChild(el);
      resolve(true);
    };
    probe.onerror = () => resolve(false);
    probe.src = url;
  });
}

function frameUrl(n) {
  return frames.template.replace('{n}', String(n));
}

function setFrameTimeline(job) {
  const t = timelineState(job, frames.current);
  frames.total = t.total;
  frames.done = t.done;
  if (job?.frames_url_template) frames.template = job.frames_url_template;
  scrub.max = String(t.max);
  scrub.disabled = t.disabled;
  if (!frames.current) scrub.value = String(Math.max(1, t.current || 1));
  readout.textContent = t.readout;
}

function resetForBuild(prompt) {
  stopPlayback();
  ws.result = null;
  ws.job = null;
  frames = { total: 0, done: 0, current: 0, template: '' };
  detachFrame();
  hud.hidden = true;
  hideBanner();
  buildBtn.disabled = true;
  renderOutliner(null);
  renderProps(null);
  scrub.max = '1';
  scrub.value = '1';
  scrub.disabled = true;
  readout.textContent = '0 / 0';
  showProgress(null, prompt);
  setStatus(progressText(null, prompt), 'building');
}

async function build(prompt) {
  const mine = ++run;
  lastPrompt = prompt;
  resetForBuild(prompt);
  const t0 = performance.now();
  let start;
  try {
    ws.buildRequests += 1;
    const r = await fetch('/api/scenes/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        duration_s: DURATION_S,
        samples: SAMPLES,
      }),
    });
    start = await r.json().catch(() => ({}));
    if (!r.ok || !start.job_id) {
      if (!isCurrentRun(mine, run)) return;
      buildBtn.disabled = false;
      showBanner(
        buildFailure({
          kind: 'request',
          status: r.status,
          body: start,
          prompt,
        }),
      );
      return;
    }
    app.dataset.seed = String(start.seed ?? '');
  } catch (error) {
    if (!isCurrentRun(mine, run)) return;
    buildBtn.disabled = false;
    showBanner(buildFailure({ kind: 'network', error, prompt }));
    return;
  }
  if (!isCurrentRun(mine, run)) return;
  ws.history.push({
    prompt,
    jobId: start.job_id,
    at: new Date().toISOString(),
  });
  const extra = {
    place: start.location?.name,
    locationSource: start.location?.source,
    seed: start.seed,
    promptHash: start.prompt_hash,
  };
  let firstFrame = false;
  let lastFrames = -1;
  let pollFailures = 0;
  for (;;) {
    await new Promise((res) => setTimeout(res, POLL_MS));
    if (!isCurrentRun(mine, run)) return;
    let job;
    let pollStatus = 0;
    try {
      ws.statusPolls += 1;
      const r = await fetch(`/api/scenes/render/${start.job_id}/status`, {
        cache: 'no-store',
      });
      pollStatus = r.status;
      job = await r.json();
      if (!r.ok)
        throw new Error(job?.message || job?.error || `HTTP ${r.status}`);
      pollFailures = 0;
    } catch (error) {
      pollFailures += 1;
      if (pollFailures >= 8) {
        if (!isCurrentRun(mine, run)) return;
        buildBtn.disabled = false;
        showBanner(
          buildFailure({
            kind: pollStatus ? 'request' : 'network',
            status: pollStatus || null,
            body: job,
            error,
            prompt,
          }),
        );
        return;
      }
      continue;
    }
    if (!isCurrentRun(mine, run)) return;
    ws.job = job;
    const stage = job.stage || 'queued';
    if (stage !== 'failed') renderOutliner(job);
    setFrameTimeline(job);
    if ((job.frames_done || 0) > 0 && job.frames_done !== lastFrames) {
      lastFrames = job.frames_done;
      const ok = await showFrame(
        `/api/scenes/render/${start.job_id}/latest.jpg?n=${job.frames_done}`,
      );
      if (!isCurrentRun(mine, run)) return;
      if (ok) {
        frames.current = job.frames_done;
        scrub.value = String(job.frames_done);
        readout.textContent = `${job.frames_done} / ${job.total_frames || 0}`;
        const metrics = analyseFrame();
        if (!firstFrame) {
          firstFrame = true;
          ws.result = {
            prompt,
            jobId: start.job_id,
            clientTtffS: Math.round((performance.now() - t0) / 100) / 10,
            frameSource: `/api/scenes/render/${start.job_id}/latest.jpg`,
            renderer: 'cycles-optix',
            ...metrics,
          };
          img.dataset.loaded = '1';
        } else if (metrics) {
          Object.assign(ws.result, metrics);
        }
        hud.hidden = false;
        hud.textContent = `Cycles · OptiX · frame ${job.frames_done}/${job.total_frames || '?'}`;
      }
    }
    renderProps(job, extra);
    if (stage === 'failed') {
      buildBtn.disabled = false;
      showBanner(
        buildFailure({
          kind: 'job',
          status: pollStatus,
          body: { error: job.error || 'unknown error' },
          prompt,
        }),
      );
      return;
    }
    if (stage === 'complete' || stage === 'partial') {
      buildBtn.disabled = false;
      hideProgress();
      if (ws.result) {
        ws.result.objects = job.placement?.instances ?? null;
        ws.result.byAsset = job.placement?.by_asset ?? null;
        ws.result.references = job.references ?? null;
        ws.result.fpsSustained = job.fps_sustained ?? null;
        ws.result.fpsAfterFirstFrame = job.fps_after_first_frame ?? null;
        ws.result.serviceTtffS = job.ttff_s ?? null;
        ws.result.totalS = job.wall_clock_total_s ?? null;
        ws.result.gpus = (job.shards || []).map((s) => s.gpu);
        ws.result.complete = true;
        setStatus(
          `Scene ready · ${job.placement?.instances ?? 0} objects · ${job.frames_done} Cycles frames · ${job.wall_clock_total_s ?? '?'} s`,
          'ready',
        );
      } else {
        // The service says complete but no frame ever decoded: that is a failure, not "Ready".
        showBanner(
          buildFailure({
            kind: 'job',
            status: pollStatus,
            body: {
              error: 'no_frame_decoded',
              message: `Service reported stage ${stage} with ${job.frames_done || 0} frames but no frame image could be loaded from /api/scenes/render/${start.job_id}/latest.jpg.`,
            },
            prompt,
          }),
        );
      }
      return;
    }
    showProgress(job, prompt);
    setStatus(progressText(job, prompt), 'building');
  }
}

/**
 * Playback steps to the next frame only after the current one has decoded
 * (each frame is a ~1 MB PNG through the proxy), at most PLAY_FPS per second,
 * so a slow link never leaves a queue of aborted image requests behind.
 */
function startPlayback() {
  const token = {};
  playTimer = token;
  const step = () => {
    if (playTimer !== token || !img) return;
    const started = performance.now();
    const next = frames.current >= frames.done ? 1 : frames.current + 1;
    const done = () => {
      if (playTimer !== token) return;
      const wait = Math.max(0, 1000 / PLAY_FPS - (performance.now() - started));
      setTimeout(step, wait);
    };
    img.onload = done;
    img.onerror = done;
    seek(next);
  };
  step();
}

function stopPlayback() {
  playTimer = null;
  if (img) {
    img.onload = null;
    img.onerror = null;
  }
  const btn = document.querySelector('[data-transport="play"]');
  if (btn) {
    btn.textContent = 'Play';
    btn.setAttribute('aria-pressed', 'false');
  }
}

function seek(n) {
  if (!frames.template || frames.done < 1 || !img) return;
  const f = Math.min(Math.max(1, n), frames.done);
  frames.current = f;
  scrub.value = String(f);
  readout.textContent = `${f} / ${frames.total}`;
  hud.textContent = `Cycles · OptiX · frame ${f}/${frames.total || '?'}`;
  img.src = frameUrl(f);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const prompt = input.value.trim();
  if (prompt.length < 3) {
    setStatus('Type a scene prompt (3+ characters), then press Build.', 'idle');
    return;
  }
  if (buildBtn.disabled) return; // one in-flight Build per press
  build(prompt);
});

retryBtn.addEventListener('click', () => {
  const prompt = input.value.trim() || lastPrompt;
  if (prompt.length < 3 || buildBtn.disabled) return;
  build(prompt);
});

for (const btn of document.querySelectorAll('.ws-mode')) {
  btn.addEventListener('click', () => {
    app.dataset.mode = btn.dataset.mode;
    for (const b of document.querySelectorAll('.ws-mode'))
      b.setAttribute('aria-checked', String(b === btn));
  });
}

for (const btn of document.querySelectorAll('[data-drawer]')) {
  btn.addEventListener('click', () => {
    app.dataset.drawer =
      app.dataset.drawer === btn.dataset.drawer ? '' : btn.dataset.drawer;
  });
}

scrub.addEventListener('input', () => {
  stopPlayback();
  seek(Number(scrub.value));
});

document.querySelector('.ws-transport').addEventListener('click', (event) => {
  const kind = event.target?.dataset?.transport;
  if (!kind) return;
  if (kind === 'play') {
    if (playTimer) return stopPlayback();
    if (frames.done < 2) return;
    event.target.textContent = 'Pause';
    event.target.setAttribute('aria-pressed', 'true');
    startPlayback();
    return;
  }
  stopPlayback();
  if (kind === 'first') seek(1);
  if (kind === 'last') seek(frames.done);
  if (kind === 'prev') seek(frames.current - 1);
  if (kind === 'next') seek(frames.current + 1);
});

// Keep the viewport's empty state honest: nothing but the status badge until a frame decodes.
viewport.dataset.hasFrame = '0';
new MutationObserver(() => {
  viewport.dataset.hasFrame = img && img.isConnected ? '1' : '0';
}).observe(frameSlot, { childList: true });

// Deep link: ?prompt=... pre-fills; &build=1 presses the real Build button once.
const params = new URLSearchParams(location.search);
if (params.get('prompt')) input.value = params.get('prompt').slice(0, 600);
if (params.get('build') === '1' && input.value.trim().length >= 3)
  buildBtn.click();
