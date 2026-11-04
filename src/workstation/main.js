/**
 * Scene Workstation — Blender-only Build flow.
 *
 * Build press -> exactly ONE `POST /api/scenes/render` (same-origin proxy; the
 * GPU service token stays server-side) -> poll `/status` -> show the newest
 * Cycles/OptiX frame from `/latest.jpg` in the viewport -> fill the outliner
 * from the job's real placement (`placement.by_asset`) and the properties panel
 * from the job record. No Cesium globe, no map legend, no sprite icons.
 */
import './workstation.css';

const $ = (sel) => document.querySelector(sel);
const app = $('#ws-app');
const form = $('#ws-prompt-form');
const input = $('#ws-prompt');
const buildBtn = $('#ws-build');
const img = $('#ws-frame');
const canvas = $('#ws-frame-canvas');
const statusEl = $('#ws-status');
const hud = $('#ws-hud');
const outliner = $('#ws-outliner-list');
const props = $('#ws-props');
const scrub = $('#ws-scrub');
const readout = $('#ws-frame-readout');

const POLL_MS = 1500;
const DURATION_S = 4;
const SAMPLES = 24;

const ASSET_LABELS = {
  police_patrol_car: 'Police patrol car',
  police_escort_motorcycle: 'Police motorcycle',
  ambulance_medical_point: 'Ambulance',
  crowd_control_barrier: 'Crowd barrier',
  road_closed_barricade: 'Road barricade',
  traffic_cone_cluster: 'Traffic cone',
  foot_patrol_officer: 'Officer on foot',
  spectator_crowd_cluster: 'Pedestrian group',
  cctv_camera: 'CCTV camera',
  city_bus: 'Bus',
  event_command_post: 'Command post',
  marine_patrol_boat: 'Patrol boat',
};

/** Public QA surface (read by the validator). */
const ws = {
  buildRequests: 0,
  statusPolls: 0,
  job: null,
  result: null,
  history: [],
};
window.__ws = ws;

let run = 0;
let frames = { total: 0, done: 0, current: 0, template: '' };
let playTimer = null;

function setStatus(text, state) {
  statusEl.textContent = text;
  if (state) app.dataset.state = state;
}

function renderOutliner(job) {
  const by = job?.placement?.by_asset || {};
  const rows = [];
  rows.push('<li class="ws-group">Environment</li>');
  rows.push(`<li data-object="land_patch"><span>Ground · satellite patch</span><span class="ws-count">1</span></li>`);
  if (job?.land_patch?.buildings)
    rows.push(`<li data-object="buildings"><span>OSM buildings (extruded)</span><span class="ws-count">${job.land_patch.buildings}</span></li>`);
  rows.push(`<li data-object="sun_sky"><span>Sun + sky (${job?.time_of_day || 'auto'})</span><span class="ws-count">1</span></li>`);
  rows.push(`<li data-object="camera"><span>Camera</span><span class="ws-count">1</span></li>`);
  const keys = Object.keys(by);
  if (keys.length) {
    rows.push('<li class="ws-group">Placed assets</li>');
    for (const k of keys.sort()) {
      const label = ASSET_LABELS[k] || k.replace(/_/g, ' ');
      rows.push(`<li data-object="${k}" class="ws-asset"><span>${label}</span><span class="ws-count">${by[k]}</span></li>`);
    }
  }
  outliner.innerHTML = rows.join('');
}

function renderProps(job, extra = {}) {
  const devices = (job?.events_tail || [])
    .map((e) => e?.data?.line || '')
    .find((l) => l.startsWith('SCENE_READY'));
  const dev = devices ? (devices.match(/devices=\[([^\]]*)\]/) || [])[1] : null;
  const entries = [
    ['Renderer', 'Blender Cycles · OptiX'],
    ['Device', dev ? dev.replace(/'/g, '') : 'GPU (OptiX)'],
    ['GPUs', (job?.shards || []).map((s) => s.gpu).filter((v, i, a) => a.indexOf(v) === i).join(', ') || '—'],
    ['Place', job?.focal ? `${job.focal.name} (${job.focal.lat.toFixed(4)}, ${job.focal.lon.toFixed(4)})` : extra.place || '—'],
    ['Located by', extra.locationSource || job?.focal?.source || '—'],
    ['Scene spec', job?.model?.attempts?.[0]?.endpointId || job?.model?.endpointId || '—'],
    ['Scenario', job?.spec?.scenarioType || '—'],
    ['Objects', job?.placement?.instances ?? '—'],
    ['Stage', job?.stage || '—'],
    ['Frames', job?.total_frames ? `${job.frames_done || 0} / ${job.total_frames}` : '—'],
    ['First frame', job?.ttff_s ? `${job.ttff_s} s (service)` : '—'],
    ['Client first frame', ws.result?.clientTtffS ? `${ws.result.clientTtffS} s` : '—'],
    ['Sustained fps', job?.fps_sustained ?? '—'],
    ['Job', job?.job_id || '—'],
  ];
  props.innerHTML = entries.map(([k, v]) => `<dt>${k}</dt><dd>${String(v)}</dd>`).join('');
}

/** Average-hash (8x8) + luminance stddev of the frame currently shown. */
function analyseFrame() {
  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return null;
    canvas.width = 64;
    canvas.height = 36;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 64, 36);
    const data = ctx.getImageData(0, 0, 64, 36).data;
    const lum = [];
    for (let i = 0; i < data.length; i += 4) lum.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
    const std = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length);
    ctx.drawImage(img, 0, 0, 8, 8);
    const small = ctx.getImageData(0, 0, 8, 8).data;
    const g = [];
    for (let i = 0; i < small.length; i += 4) g.push(0.299 * small[i] + 0.587 * small[i + 1] + 0.114 * small[i + 2]);
    const gm = g.reduce((a, b) => a + b, 0) / g.length;
    const hash = g.map((v) => (v > gm ? '1' : '0')).join('');
    return { width: w, height: h, lumMean: Math.round(mean * 10) / 10, lumStd: Math.round(std * 10) / 10, ahash: hash };
  } catch {
    return null;
  }
}

function showFrame(url) {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => {
      img.src = probe.src;
      img.hidden = false;
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
  frames.total = job.total_frames || 0;
  frames.done = job.frames_done || 0;
  if (job.frames_url_template) frames.template = job.frames_url_template;
  scrub.max = String(Math.max(1, frames.done));
  scrub.disabled = frames.done < 1;
  readout.textContent = `${frames.current || frames.done} / ${frames.total}`;
}

async function build(prompt) {
  const mine = ++run;
  stopPlayback();
  ws.result = null;
  ws.job = null;
  frames = { total: 0, done: 0, current: 0, template: '' };
  img.hidden = true;
  img.removeAttribute('data-loaded');
  hud.hidden = true;
  buildBtn.disabled = true;
  renderOutliner(null);
  renderProps(null);
  setStatus(`Building “${prompt}” — locating, planning scene, starting Blender…`, 'building');
  const t0 = performance.now();
  let start;
  try {
    ws.buildRequests += 1;
    const r = await fetch('/api/scenes/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, duration_s: DURATION_S, samples: SAMPLES }),
    });
    start = await r.json().catch(() => ({}));
    if (!r.ok || !start.job_id) throw new Error(start.message || start.error || `HTTP ${r.status}`);
  } catch (error) {
    if (mine !== run) return;
    buildBtn.disabled = false;
    setStatus(`Render service error: ${error.message}`, 'error');
    return;
  }
  if (mine !== run) return;
  ws.history.push({ prompt, jobId: start.job_id, at: new Date().toISOString() });
  const extra = { place: start.location?.name, locationSource: start.location?.source };
  let firstFrame = false;
  let lastFrames = -1;
  for (;;) {
    await new Promise((res) => setTimeout(res, POLL_MS));
    if (mine !== run) return;
    let job;
    try {
      ws.statusPolls += 1;
      const r = await fetch(`/api/scenes/render/${start.job_id}/status`, { cache: 'no-store' });
      job = await r.json();
    } catch {
      continue;
    }
    if (mine !== run) return;
    ws.job = job;
    if (job.stage && job.stage !== 'failed') renderOutliner(job);
    setFrameTimeline(job);
    if ((job.frames_done || 0) > 0 && job.frames_done !== lastFrames) {
      lastFrames = job.frames_done;
      const ok = await showFrame(`/api/scenes/render/${start.job_id}/latest.jpg?n=${job.frames_done}`);
      if (mine !== run) return;
      if (ok) {
        frames.current = job.frames_done;
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
    const stage = job.stage || 'queued';
    if (stage === 'failed') {
      buildBtn.disabled = false;
      setStatus(`Blender job failed: ${job.error || 'unknown error'}`, 'error');
      return;
    }
    if (stage === 'complete' || stage === 'partial') {
      buildBtn.disabled = false;
      if (ws.result) {
        ws.result.objects = job.placement?.instances ?? null;
        ws.result.byAsset = job.placement?.by_asset ?? null;
        ws.result.fpsSustained = job.fps_sustained ?? null;
        ws.result.serviceTtffS = job.ttff_s ?? null;
        ws.result.totalS = job.wall_clock_total_s ?? null;
        ws.result.gpus = (job.shards || []).map((s) => s.gpu);
        ws.result.complete = true;
      }
      setStatus(`Scene ready · ${job.placement?.instances ?? 0} objects · ${job.frames_done} Cycles frames · ${job.wall_clock_total_s ?? '?'} s`, 'ready');
      return;
    }
    const label = { queued: 'Queued', geocode: 'Locating', land_patch: 'Fetching land patch', scene_spec: 'Planning scene (Kimi K3 Fast)', placement: 'Placing assets', render: 'Rendering (Cycles · OptiX)', encode: 'Encoding' }[stage] || stage;
    setStatus(`${label}… ${job.frames_done ? `${job.frames_done}/${job.total_frames} frames` : ''}`, 'building');
  }
}

function stopPlayback() {
  if (playTimer) clearInterval(playTimer);
  playTimer = null;
  const btn = document.querySelector('[data-transport="play"]');
  if (btn) btn.textContent = 'Play';
}

function seek(n) {
  if (!frames.template || frames.done < 1) return;
  const f = Math.min(Math.max(1, n), frames.done);
  frames.current = f;
  scrub.value = String(f);
  readout.textContent = `${f} / ${frames.total}`;
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

for (const btn of document.querySelectorAll('.ws-mode')) {
  btn.addEventListener('click', () => {
    app.dataset.mode = btn.dataset.mode;
    for (const b of document.querySelectorAll('.ws-mode')) b.setAttribute('aria-checked', String(b === btn));
  });
}

for (const btn of document.querySelectorAll('[data-drawer]')) {
  btn.addEventListener('click', () => {
    app.dataset.drawer = app.dataset.drawer === btn.dataset.drawer ? '' : btn.dataset.drawer;
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
    playTimer = setInterval(() => seek(frames.current >= frames.done ? 1 : frames.current + 1), 1000 / 12);
    return;
  }
  stopPlayback();
  if (kind === 'first') seek(1);
  if (kind === 'last') seek(frames.done);
  if (kind === 'prev') seek(frames.current - 1);
  if (kind === 'next') seek(frames.current + 1);
});

// Deep link: ?prompt=... pre-fills; &build=1 presses the real Build button once.
const params = new URLSearchParams(location.search);
if (params.get('prompt')) input.value = params.get('prompt').slice(0, 600);
if (params.get('build') === '1' && input.value.trim().length >= 3) buildBtn.click();
