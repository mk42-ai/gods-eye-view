import './workstation.css';
import {
  Authority,
  STORAGE_KEY,
  AUTO_STORAGE_KEY,
  LEGACY_HASH_KEYS,
  createState,
  savedState,
  readHash,
  writeHash,
  number,
  point,
  validateAoi,
  validateDraft,
  validCamera,
  cameraFromHash,
  cameraToHash,
  decodeAndCommit,
  safeLink,
  localMedia,
  parseSse,
} from './state.js';
import {
  normalizeJob,
  progressText,
  progressFraction,
  buildFailure,
  outlinerRows,
  propertyEntries,
  planGeometry,
  frameSource,
  canSeek,
  latestFrameNumber,
  patchSelectionIssue,
} from './model.js';

const $ = (q) => document.querySelector(q);
const app = $('#ws-app'),
  form = $('#ws-prompt-form'),
  input = $('#ws-prompt');
const frameSlot = $('#ws-frame-slot');
const state = createState({}, location.hash);
state.sceneDirty = true;
const ws = {
  state,
  buildRequests: 0,
  cameraRequests: 0,
  statusPolls: 0,
  job: null,
  result: null,
  failure: null,
  history: [],
  events: [],
  errors: [],
};
window.__ws = ws;
function event(type, detail = {}) {
  const entry = {
    type,
    utc: new Date().toISOString(),
    performanceMs: performance.now(),
    revision: state.revision,
    jobId: state.job?.job_id || state.active?.jobId || null,
    sceneId: state.job?.sceneId || null,
    ...detail,
  };
  ws.events.push(entry);
  if (ws.events.length > 1500) ws.events.shift();
  return entry;
}
const authority = new Authority(state, event);
let displayOwner = null,
  playToken = 0,
  video = null;
function node(tag, text, cls) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function link(label, raw) {
  const url = safeLink(raw, location.origin);
  if (!url) return node('span', label);
  const a = node('a', label);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}
function openPanel(name) {
  for (const panel of document.querySelectorAll('.ws-panel'))
    panel.classList.toggle('is-open', panel.id === `ws-${name}`);
  for (const btn of document.querySelectorAll('[data-panel]'))
    btn.setAttribute('aria-expanded', String(btn.dataset.panel === name));
  app.dataset.panel = name || '';
}
function syncHash() {
  const hash = writeHash(state.legacyHash);
  if (location.hash.slice(1) !== hash)
    history.replaceState(
      null,
      '',
      location.pathname + location.search + (hash ? '#' + hash : ''),
    );
}
function storageSave(automatic = false) {
  try {
    localStorage.setItem(
      automatic ? AUTO_STORAGE_KEY : STORAGE_KEY,
      JSON.stringify(savedState(state)),
    );
    if (!automatic)
      $('#ws-storage-status').textContent =
        'Saved in this browser only · no cloud sync';
  } catch (error) {
    $('#ws-storage-status').textContent = 'Browser-local storage unavailable';
    event('storage-unavailable', { message: error.message });
  }
}
function stopPlayback() {
  playToken++;
  authority.frameEpoch++;
  video?.pause();
  const b = $('[data-transport="play"]');
  b.textContent = 'Play';
  b.setAttribute('aria-pressed', 'false');
}
function cancelRemote(jobId) {
  if (!jobId) return;
  void fetch(`/api/scenes/render/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    keepalive: true,
  })
    .then((r) =>
      event('remote-cancel-requested', { jobId, httpStatus: r.status }),
    )
    .catch(() => event('remote-cancel-unconfirmed', { jobId }));
}
function edit(patch, reason, sceneDirty = true) {
  stopPlayback();
  const activeJobId = state.active?.jobId;
  if (sceneDirty && Object.prototype.hasOwnProperty.call(patch, 'prompt')) {
    patch = { ...patch, camera: null };
    if (state.aoi?.verification === 'verified') patch.aoi = null;
  }
  authority.edit(patch, reason);
  cancelRemote(activeJobId);
  if (sceneDirty) state.sceneDirty = true;
  ws.failure = null;
  render();
  storageSave(true);
}
function fail(error, kind = 'request', body = null, status = null) {
  const failure = buildFailure({ kind, body, status, error });
  state.failure = failure;
  ws.failure = failure;
  state.phase = 'error';
  ws.errors.push(
    event('request-error', {
      message: failure.message,
      status: failure.status,
      code: failure.code,
    }),
  );
  render();
}
function renderOutliner() {
  const list = $('#ws-outliner-list');
  list.replaceChildren();
  const rows = outlinerRows(state.job);
  if (!rows.length)
    list.append(
      node(
        'li',
        'No service scene yet. AOI selection and Build are explicit.',
        'ws-note',
      ),
    );
  for (const row of rows) {
    const li = node('li');
    if (row.group) {
      li.className = 'ws-group';
      li.textContent = row.group;
    } else {
      const b = node('button');
      b.type = 'button';
      b.dataset.object = row.object;
      b.setAttribute('aria-pressed', String(state.selection === row.object));
      b.append(node('span', row.label), node('span', row.count, 'ws-count'));
      if (row.state) b.title = row.state;
      li.append(b);
    }
    list.append(li);
  }
}
function renderProps() {
  const props = $('#ws-props');
  props.replaceChildren();
  for (const [k, v] of propertyEntries(
    state.job,
    { selection: state.selection, revision: state.revision, aoi: state.aoi },
    state.result,
  ))
    props.append(node('dt', k), node('dd', v));
}
function renderAoi() {
  $('#ws-location-status').textContent = state.locationStatus;
  $('#ws-aoi-readout').textContent = state.aoi
    ? `${state.aoi.lat}, ${state.aoi.lon} · radius ${state.aoi.radiusM} m · ${state.aoi.verification === 'verified' ? 'source-verified ' + (state.aoi.sourceFeatureId || '') : 'operator-selected, unverified'}${state.stale ? ' · displayed render may be stale' : ''}`
    : 'Selection required — no exact AOI selected. No city-centroid fallback.';
  const a = $('#ws-osm');
  a.hidden = !state.aoi;
  if (state.aoi)
    a.href = `https://www.openstreetmap.org/?mlat=${state.aoi.lat}&mlon=${state.aoi.lon}#map=18/${state.aoi.lat}/${state.aoi.lon}`;
  const container = $('#ws-aoi-plan');
  container.replaceChildren();
  const plan = planGeometry(state.job);
  if (!plan) {
    container.textContent =
      'Geographic plan unavailable until the service returns patch bounds and real features.';
    return;
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 300 196');
  svg.setAttribute('role', 'group');
  svg.setAttribute(
    'aria-label',
    'Returned AOI patch and selectable geographic features',
  );
  const title = document.createElementNS(svg.namespaceURI, 'title');
  title.textContent = `Service patch ${state.job.patch.id || ''}; ${plan.geographic ? 'WGS84 coordinates' : 'local coordinates'}`;
  svg.append(title);
  const rect = document.createElementNS(svg.namespaceURI, 'rect');
  for (const [k, v] of Object.entries({
    x: 16,
    y: 16,
    width: 268,
    height: 158,
    fill: 'none',
    stroke: '#75869d',
    'data-object': 'land_patch',
    tabindex: '0',
    role: 'button',
    'aria-label': 'Select returned AOI patch',
    'aria-pressed': String(state.selection === 'land_patch'),
  }))
    rect.setAttribute(k, v);
  svg.append(rect);
  for (const shape of plan.shapes) {
    const el = document.createElementNS(
      svg.namespaceURI,
      shape.points.length === 1
        ? 'circle'
        : shape.close
          ? 'polygon'
          : 'polyline',
    );
    if (shape.points.length === 1) {
      el.setAttribute('cx', shape.points[0][0]);
      el.setAttribute('cy', shape.points[0][1]);
      el.setAttribute('r', 4);
    } else {
      el.setAttribute('points', shape.points.map((p) => p.join(',')).join(' '));
      if (!shape.close) el.classList.add('ws-plan-road');
    }
    el.dataset.object = shape.id;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', `Select ${shape.label}`);
    el.setAttribute('aria-pressed', String(state.selection === shape.id));
    svg.append(el);
  }
  container.append(
    svg,
    node(
      'p',
      `${state.job.patch.id || 'Patch'} · ${plan.geographic ? '[W, S, E, N]' : '[minX, minY, maxX, maxY]'} ${plan.bounds.map((v) => Number(v).toFixed(5)).join(', ')} · ${plan.shapes.length} returned geometries${state.stale ? ' · stale render patch' : ''}`,
      'ws-note',
    ),
  );
  if (!plan.shapes.length)
    container.append(
      node(
        'p',
        'Only bounds returned. No building or road geometry invented.',
        'ws-note',
      ),
    );
}
function renderEvidence() {
  const e = state.evidence;
  $('#ws-evidence-status').textContent =
    `${e.phase.toUpperCase()} · ${e.message}${e.receivedAt ? ' · retrieved ' + e.receivedAt : ''}`;
  $('#ws-research').disabled = !!state.active || e.phase === 'loading';
  const sources = $('#ws-evidence-sources');
  sources.replaceChildren();
  for (const source of state.job?.patch?.provenance ||
    state.aoi?.provenance ||
    []) {
    const li = node('li');
    li.append(
      link(
        source.source || source.provider || 'Geographic source',
        source.url || source.apiUrl || source.endpoint,
      ),
    );
    const license =
      typeof source.license === 'object' ? source.license.name : source.license;
    li.append(
      node(
        'small',
        `${license || 'Source facts only'} · retrieved/reviewed ${source.retrievedUtc || source.reviewedUtc || 'not reported'}${source.fact ? ' · ' + source.fact : ''}`,
      ),
    );
    sources.append(li);
  }
  for (const source of e.sources || []) {
    const li = node(
      'li',
      `${source.name || source.id || 'Source'} — ${source.state || source.status || 'status unreported'}`,
    );
    if (source.message) li.append(node('small', source.message));
    sources.append(li);
  }
  const list = $('#ws-evidence-list');
  list.replaceChildren();
  for (const item of e.items || []) {
    const li = node('li');
    li.append(
      link(
        item.title || item.url || 'Source record',
        item.url || item.sourceUrl,
      ),
    );
    li.append(
      node(
        'small',
        `Source: ${item.source?.name || item.source?.id || item.platform || 'not reported'} · Recorded: ${item.recordedAt || 'unknown'} · Published: ${item.publishedAt || 'unknown'}`,
      ),
    );
    li.append(
      node(
        'small',
        `Retrieved: ${item.retrievedAt || e.receivedAt || 'not reported'} · ${(item.qualification?.labels || []).join(' · ') || 'Source metadata, not independently verified'}`,
      ),
    );
    list.append(li);
  }
  if (e.candidates?.length)
    list.append(
      node(
        'li',
        `${e.candidates.length} unqualified candidate(s) excluded from source evidence. Their location/time did not satisfy source policy.`,
      ),
    );
  if (!e.items?.length)
    list.append(
      node(
        'li',
        'No qualifying source recordings returned. This is not evidence that an incident did or did not occur.',
      ),
    );
}
function renderCamera() {
  const canUse = !!state.job?.job_id && !state.sceneDirty && !state.active;
  for (const button of document.querySelectorAll('[data-camera-action]'))
    button.disabled = !canUse;
  $('#ws-camera-render').disabled = !canUse;
  $('#ws-camera-status').textContent = state.camera
    ? `Pose ${state.cameraDirty ? 'draft · render to apply' : 'restored / service-reported'} · GPU camera changes only${state.sceneDirty ? ' · rebuild the edited scene first' : ''}`
    : 'No camera pose reported. Build an explicit AOI first; no random fallback camera.';
  const hash = $('#ws-hash-state');
  hash.replaceChildren();
  for (const k of LEGACY_HASH_KEYS)
    if (Object.hasOwn(state.legacyHash, k))
      hash.append(node('dt', k), node('dd', state.legacyHash[k] || '(empty)'));
  if (!hash.children.length)
    hash.append(node('dt', 'Hash'), node('dd', 'No legacy view supplied'));
  const c = state.cctv;
  $('#ws-cctv-status').textContent =
    `${c.phase.toUpperCase()} · ${c.message}${c.receivedAt ? ' · checked ' + c.receivedAt : ''}`;
  $('#ws-cctv-load').disabled = !!state.active || c.phase === 'loading';
  $('#ws-cctv-refresh').disabled =
    !c.selectedId ||
    !c.cameras.some((cam) => cam.id === c.selectedId) ||
    c.phase === 'loading' ||
    c.phase === 'stale';
  $('#ws-cctv-select').disabled = !c.cameras.length || c.phase === 'stale';
}
function fillCamera() {
  $('#ws-camera-position').value = state.camera?.position?.join(', ') || '';
  $('#ws-camera-target').value = state.camera?.target?.join(', ') || '';
  $('#ws-camera-fov').value = String(state.camera?.fovDeg || 45);
}
function render() {
  ws.job = state.job;
  ws.result = state.result;
  app.dataset.state = state.phase;
  app.dataset.revision = String(state.revision);
  app.dataset.jobId = state.job?.job_id || '';
  app.dataset.sceneId = state.job?.sceneId || '';
  app.dataset.stale = String(state.stale);
  $('#ws-build').disabled = !!state.active;
  $('#ws-cancel').disabled =
    !state.active &&
    state.evidence.phase !== 'loading' &&
    state.cctv.phase !== 'loading' &&
    state.locationStatus !== 'Finding site candidates…';
  $('#ws-draft').textContent = state.active
    ? `Building · revision ${state.revision}`
    : state.stale
      ? 'Draft changed · displayed render is stale'
      : state.phase === 'ready'
        ? 'Current render · illustrative, not evidence'
        : state.phase === 'error'
          ? 'Unavailable · see render details'
          : 'Draft · not built';
  const banner = $('#ws-banner');
  banner.hidden = !state.failure;
  $('#ws-banner-text').textContent = state.failure?.text || '';
  const active = !!state.active;
  $('#ws-progress').hidden = !active;
  if (active) {
    $('#ws-progress-text').textContent = progressText(state.job);
    const pc = Math.round(progressFraction(state.job) * 100);
    $('#ws-progress-bar').style.width = `${pc}%`;
    $('#ws-progress').setAttribute('aria-valuenow', pc);
  }
  $('#ws-status').textContent = active
    ? `${progressText(state.job)}${state.stale ? ' · previous decoded frame retained' : ''}`
    : state.failure
      ? state.failure.text
      : state.stale
        ? 'Stale render retained — press Build to apply this draft. Previous requests invalidated.'
        : state.phase === 'ready'
          ? `${state.job?.stage === 'partial' ? 'Partial result' : 'Scene ready'} · ${state.job?.frames_done || 0} rendered frames · illustrative staging, not evidence`
          : state.phase === 'cancelled'
            ? 'Cancelled locally — no older frame can replace this view. Remote work may still finish.'
            : 'Draft only · Build resolves a verified site, or confirm selected coordinates';
  $('#ws-empty-view').hidden = !!state.displayed;
  $('#ws-viewport').dataset.hasFrame = state.displayed ? '1' : '0';
  $('#ws-hud').hidden = !state.displayed;
  if (state.displayed)
    $('#ws-hud').textContent =
      `${state.stale ? 'STALE · ' : ''}${state.displayed.jobId} · frame ${state.displayed.number || (state.displayed.media === 'video' ? 'video' : 'latest')} · ${state.displayed.width}×${state.displayed.height}`;
  const done = state.job?.frames_done || 0;
  const playable =
    !!displayOwner && authority.current(displayOwner) && !state.stale;
  $('#ws-scrub').max = String(Math.max(1, done));
  $('#ws-scrub').disabled = !playable || !done || !canSeek(state.job);
  $('#ws-scrub').value = String(Math.max(1, state.displayed?.number || 1));
  $('#ws-frame-readout').textContent =
    `${state.displayed?.jobId === state.job?.job_id ? (state.displayed?.number ?? 'Latest') : 0} / ${state.job?.total_frames || done || 0}`;
  for (const b of document.querySelectorAll('[data-transport]'))
    b.disabled =
      !playable ||
      done < 1 ||
      (b.dataset.transport === 'play'
        ? done < 2 || (!canSeek(state.job) && !state.job?.mp4_url)
        : !canSeek(state.job));
  $('#ws-playback-note').textContent = state.job?.mp4_bytes
    ? 'Native video available · playback ≠ render FPS'
    : state.job?.frames_url_template
      ? 'Decoded frames · playback ≠ render FPS'
      : 'Only latest frame available';
  renderOutliner();
  renderProps();
  renderAoi();
  renderEvidence();
  renderCamera();
}
function decodedImage(url, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    const clear = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      image.onload = image.onerror = null;
    };
    const timer = setTimeout(() => {
      clear();
      image.removeAttribute('src');
      reject(new Error('Frame decode timed out'));
    }, 20000);
    const abort = () => {
      clear();
      image.removeAttribute('src');
      reject(new DOMException('Frame superseded', 'AbortError'));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    image.onerror = () => {
      clear();
      reject(new Error('Frame unavailable or could not be decoded'));
    };
    image.onload = async () => {
      try {
        if (image.decode) await image.decode();
        if (!image.naturalWidth || !image.naturalHeight)
          throw new Error('Empty decoded frame');
        if (signal?.aborted) return abort();
        clear();
        resolve(image);
      } catch (error) {
        clear();
        reject(error);
      }
    };
    image.src = url;
  });
}
async function decodedRenderImage(url, signal) {
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`Frame HTTP ${response.status}`);
  const metadata = {};
  for (const [key, header] of Object.entries({
    frameId: 'x-frame-id',
    sha256: 'x-frame-sha256',
    sceneId: 'x-scene-id',
    patchId: 'x-patch-id',
    revision: 'x-camera-revision',
    createdUtc: 'x-frame-created-utc',
  })) {
    const value = response.headers.get(header);
    if (value !== null) metadata[key] = value;
  }
  const blob = await response.blob();
  if (metadata.sha256 && globalThis.crypto?.subtle) {
    const bytes = await blob.arrayBuffer();
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    ]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
    if (hash !== metadata.sha256)
      throw new Error('Frame byte hash does not match the render manifest');
    metadata.sha256Verified = true;
  }
  if (!/^image\/(jpeg|png|webp)/i.test(blob.type))
    throw new Error('Render response is not a supported frame image');
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await decodedImage(objectUrl, signal);
    image.renderMetadata = metadata;
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
function analyseFrame(image) {
  try {
    const canvas = $('#ws-frame-canvas');
    canvas.width = 64;
    canvas.height = 36;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, 64, 36);
    const data = ctx.getImageData(0, 0, 64, 36).data;
    const lum = [];
    for (let i = 0; i < data.length; i += 4)
      lum.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
    const std = Math.sqrt(
      lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length,
    );
    ctx.drawImage(image, 0, 0, 8, 8);
    const small = ctx.getImageData(0, 0, 8, 8).data;
    const gray = [];
    for (let i = 0; i < small.length; i += 4)
      gray.push(0.299 * small[i] + 0.587 * small[i + 1] + 0.114 * small[i + 2]);
    const average = gray.reduce((a, b) => a + b, 0) / gray.length;
    return {
      lumMean: mean,
      lumStd: std,
      ahash: gray.map((n) => (n > average ? '1' : '0')).join(''),
    };
  } catch (error) {
    event('frame-analysis-unavailable', { message: error.message });
    return {};
  }
}
async function showFrame(owner, n) {
  const job = state.job;
  const source =
    n == null
      ? job.latest_frame_url ||
        job.latestFrameUrl ||
        `/api/scenes/render/${encodeURIComponent(job.job_id)}/latest.jpg?n=${job.frames_done}`
      : frameSource(job, n);
  const url =
    localMedia(source, location.origin) ||
    (n != null && job.frames_url_template
      ? localMedia(
          job.frames_url_template.replace('{n}', String(n)),
          location.origin,
        )
      : null);
  if (!url || !authority.current(owner)) return false;
  event('frame-request', { jobId: job.job_id, frame: n, url });
  try {
    return await decodeAndCommit({
      authority,
      owner,
      url,
      decode: decodedRenderImage,
      commit(image) {
        if (
          image.renderMetadata?.sceneId &&
          job.sceneId &&
          image.renderMetadata.sceneId !== job.sceneId
        )
          throw new Error('Decoded frame scene identity mismatch');
        if (
          image.renderMetadata?.patchId &&
          job.patch?.id &&
          image.renderMetadata.patchId !== job.patch.id
        )
          throw new Error('Decoded frame patch identity mismatch');
        if (
          image.renderMetadata?.revision != null &&
          Number.isInteger(job.revision) &&
          Number(image.renderMetadata.revision) !== job.revision
        )
          throw new Error('Decoded frame camera revision mismatch');
        image.id = 'ws-frame';
        image.className = 'ws-frame';
        image.alt = `Illustrative Blender render, job ${job.job_id}, frame ${n ?? 'latest (index unreported)'} — not evidence`;
        image.dataset.loaded = '1';
        image.dataset.jobId = job.job_id;
        image.dataset.frame = n ?? 'latest';
        video?.pause();
        video = null;
        frameSlot.replaceChildren(image);
        state.displayed = {
          jobId: job.job_id,
          sceneId: job.sceneId || null,
          revision: owner.revision,
          number: n,
          media: 'image',
          width: image.naturalWidth,
          height: image.naturalHeight,
          url,
          decodedAt: new Date().toISOString(),
          metadata: image.renderMetadata || {},
        };
        state.stale = false;
        displayOwner = owner;
        const metrics = analyseFrame(image);
        if (state.result?.jobId !== job.job_id)
          state.result = {
            jobId: job.job_id,
            sceneId: job.sceneId || null,
            prompt: state.prompt,
            clientTtffS: (performance.now() - owner.startedAt) / 1000,
            frameSource: url,
            renderer: job.renderer || 'Blender (service)',
            complete: false,
          };
        Object.assign(state.result, metrics, {
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
        event('frame-presented', {
          metadata: image.renderMetadata || {},
          frame: n,
          jobId: job.job_id,
          sceneId: job.sceneId || null,
          width: image.naturalWidth,
          height: image.naturalHeight,
          ...metrics,
        });
        render();
      },
    });
  } catch (error) {
    if (authority.current(owner) && error.name !== 'AbortError') {
      event('frame-error', { frame: n, message: error.message });
      $('#ws-playback-note').textContent =
        'Frame unavailable · previous frame retained';
    }
    return false;
  }
}
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
  });
}
async function request(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      body.message ||
        body.detail?.message ||
        body.error ||
        `HTTP ${response.status}`,
    );
    error.body = body;
    error.status = response.status;
    throw error;
  }
  return body;
}
function selectionFailure(message) {
  fail(new Error(message), 'request', { code: 'selection_required', message });
  openPanel('aoi');
  $('#ws-lat').focus();
}
async function launch(kind = 'build', payload = null) {
  if (state.active) {
    event('submit-ignored', { reason: 'owner-already-active' });
    return;
  }
  if (kind === 'build') {
    const error = validateDraft(state);
    if (error) {
      if (validateAoi(state.aoi)) selectionFailure(error);
      else
        fail(new Error(error), 'request', {
          code: 'invalid_draft',
          message: error,
        });
      return;
    }
    if (!state.camera && state.aoi?.source === 'user-selected')
      state.camera = cameraFromHash(state.legacyHash, state.aoi);
    const selected = state.aoi?.source === 'user-selected';
    payload = {
      prompt: state.prompt.trim(),
      durationSec: state.durationSec,
      ...(selected ? { aoi: state.aoi } : {}),
      ...(validCamera(state.camera) && state.aoi
        ? { camera: state.camera }
        : {}),
      request_id: `ws-${Date.now()}-${state.revision}`,
    };
  } else if (!state.job?.job_id || state.sceneDirty) {
    selectionFailure(
      'Build the current AOI and scene before requesting a camera render.',
    );
    return;
  }
  const previousJob = state.job;
  const owner = authority.begin(kind);
  if (!owner) return;
  owner.startedAt = performance.now();
  state.retry = { kind, payload };
  stopPlayback();
  state.job = null;
  state.result = null;
  state.selection = null;
  state.cameraDirty = false;
  ws.failure = null;
  const url =
    kind === 'camera'
      ? `/api/scenes/render/${encodeURIComponent(previousJob.job_id)}/camera`
      : '/api/scenes/render/start';
  const body =
    kind === 'camera'
      ? {
          ...payload,
          revision: Math.max(state.revision, (previousJob.revision || 0) + 1),
        }
      : payload;
  render();
  event(kind === 'camera' ? 'camera-submit' : 'build-submit', {
    url,
    camera: payload?.camera || (kind === 'camera' ? payload : null),
    aoi: state.aoi,
  });
  if (kind === 'camera') ws.cameraRequests++;
  else ws.buildRequests++;
  try {
    const start = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: owner.controller.signal,
    });
    if (!authority.current(owner)) return;
    const jobId = start.jobId || start.job_id;
    if (!jobId)
      throw Object.assign(
        new Error(start.message || 'Service returned no job identifier.'),
        { body: start },
      );
    owner.jobId = jobId;
    if (kind === 'build' && start.location) {
      const l = start.location;
      state.aoi = {
        lat: l.lat,
        lon: l.lng ?? l.lon,
        radiusM: l.radiusM || state.aoi?.radiusM || 500,
        source: l.source,
        verification: l.verification,
        sourceFeatureId: l.sourceFeatureId || null,
        name: l.name,
        precision: l.precision,
        provenance: l.provenance || [],
      };
      state.locationStatus = `${l.name} · ${l.precision || 'operator selection'} · ${l.limitation || ''}`;
      $('#ws-lat').value = state.aoi.lat;
      $('#ws-lon').value = state.aoi.lon;
      $('#ws-radius').value = state.aoi.radiusM;
    }
    ws.history.push({
      prompt: state.prompt,
      jobId,
      kind,
      at: new Date().toISOString(),
    });
    event('job-accepted', { jobId, kind });
    const statusUrl = localMedia(
      start.statusUrl ||
        start.status_url ||
        `/api/scenes/render/${encodeURIComponent(jobId)}/status`,
      location.origin,
    );
    if (!statusUrl)
      throw new Error(
        'Unsafe or unavailable status URL. A same-origin proxy URL is required.',
      );
    let consecutiveErrors = 0,
      lastFrame = null;
    for (;;) {
      if (!authority.current(owner)) return;
      if (performance.now() - owner.startedAt > 15 * 60 * 1000)
        throw new Error(
          'Render status timed out after 15 minutes. Remote job may still be running.',
        );
      let raw;
      try {
        ws.statusPolls++;
        raw = await request(statusUrl, { signal: owner.controller.signal });
        consecutiveErrors = 0;
      } catch (error) {
        if (!authority.current(owner)) return;
        consecutiveErrors++;
        event('status-error', {
          status: error.status || null,
          attempt: consecutiveErrors,
          message: error.message,
        });
        if (consecutiveErrors >= 3) throw error;
        $('#ws-status').textContent =
          `Status unavailable · retry ${consecutiveErrors}/3 · previous frame retained`;
        await sleep(1500, owner.controller.signal);
        continue;
      }
      if (!authority.current(owner)) return;
      const job = normalizeJob(raw, { ...start, job_id: jobId });
      if (job.job_id !== jobId)
        throw new Error('Status job identifier does not match this request.');
      if (
        kind === 'build' &&
        payload.camera &&
        !owner.cameraConfirmed &&
        job.frameMetadata?.length
      ) {
        const firstPose = job.frameMetadata[0]?.pose;
        if (validCamera(firstPose)) {
          const values = (p) => [...p.position, ...p.target, p.fovDeg];
          if (
            values(firstPose).some(
              (v, i) => Math.abs(v - values(payload.camera)[i]) > 0.001,
            )
          ) {
            throw new Error(
              'Render service did not apply the requested camera pose. Refusing a substituted camera; restore or update the pose and retry.',
            );
          }
          owner.cameraConfirmed = true;
        }
      }
      state.job = job;
      event('status-received', {
        jobId,
        stage: job.stage,
        framesDone: job.frames_done,
        totalFrames: job.total_frames,
        patchId: job.patch?.id || null,
      });
      if (validCamera(job.camera)) {
        state.camera = job.camera;
        fillCamera();
        if (kind === 'camera') {
          state.legacyHash = cameraToHash(
            job.camera,
            job.patch?.origin || state.aoi,
            state.legacyHash,
          );
          syncHash();
        }
        storageSave(true);
      }
      if (
        [
          'failed',
          'error',
          'cancelled',
          'selection_required',
          'selection-required',
        ].includes(job.stage)
      )
        throw Object.assign(
          new Error(job.message || job.error || 'Render did not complete.'),
          { body: job, kind: 'job' },
        );
      if (job.frames_done > 0 || job.latestFrame) {
        const patchIssue = patchSelectionIssue(job, state.aoi);
        if (patchIssue) throw new Error(patchIssue);
      }
      const terminal = ['complete', 'completed', 'ready', 'partial'].includes(
        job.stage,
      );
      if (
        (job.frames_done > 0 || job.latestFrame) &&
        ((job.latestFrame?.id || job.frames_done) !== lastFrame ||
          (terminal && state.displayed?.jobId !== jobId))
      ) {
        const shown = await showFrame(owner, latestFrameNumber(job));
        if (!authority.current(owner)) return;
        if (shown) lastFrame = job.latestFrame?.id || job.frames_done;
      }
      if (terminal) {
        if (state.displayed?.jobId !== jobId)
          throw new Error(
            'Service finished, but no current-job frame decoded. Previous render retained; not marked ready.',
          );
        state.sceneDirty = false;
        state.phase = 'ready';
        state.stale = false;
        state.result.complete = job.stage !== 'partial';
        Object.assign(state.result, {
          objects: job.placement?.instances ?? null,
          byAsset: job.placement?.by_asset ?? null,
          references: job.references ?? null,
          fpsSustained: job.fps_sustained ?? null,
          fpsAfterFirstFrame: job.fps_after_first_frame ?? null,
          serviceTtffS: job.ttff_s ?? null,
          totalS: job.wall_clock_total_s ?? null,
          gpus: (job.shards || []).map((s) => s.gpu),
          patch: job.patch || null,
        });
        event('job-finished', {
          jobId,
          stage: job.stage,
          decodedFrame: state.displayed.number,
        });
        storageSave(true);
        break;
      }
      render();
      await sleep(1500, owner.controller.signal);
    }
  } catch (error) {
    if (!authority.current(owner) || error.name === 'AbortError') return;
    fail(
      error,
      error.kind || (error.status ? 'request' : 'network'),
      error.body,
      error.status,
    );
    if (
      /selection|location|coordinate|exact.site/i.test(
        `${error.body?.code || error.body?.error || ''} ${error.message}`,
      )
    )
      openPanel('aoi');
    if (!state.job && kind === 'camera') state.job = previousJob;
  } finally {
    if (authority.current(owner)) {
      authority.end(owner);
      render();
    }
  }
}

async function playVideo(owner, token) {
  const url = localMedia(state.job?.mp4_url, location.origin);
  if (!url || !state.job?.mp4_bytes) return false;
  const element = document.createElement('video');
  element.className = 'ws-frame';
  element.id = 'ws-video';
  element.preload = 'auto';
  element.controls = true;
  element.playsInline = true;
  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        element.onloadeddata = element.onerror = null;
        owner.controller.signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        element.removeAttribute('src');
        element.load();
        reject(new DOMException('Superseded', 'AbortError'));
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Video load timed out'));
      }, 15000);
      element.onloadeddata = () => {
        cleanup();
        resolve();
      };
      element.onerror = () => {
        cleanup();
        reject(new Error('Video unavailable'));
      };
      owner.controller.signal.addEventListener('abort', abort, { once: true });
      element.src = url;
      element.load();
    });
    if (!authority.current(owner) || token !== playToken) {
      element.removeAttribute('src');
      element.load();
      return false;
    }
    video = element;
    frameSlot.replaceChildren(element);
    state.displayed = {
      ...state.displayed,
      number: null,
      media: 'video',
      width: element.videoWidth,
      height: element.videoHeight,
      url,
    };
    render();
    element.addEventListener('timeupdate', () => {
      if (authority.current(owner) && video === element) {
        $('#ws-frame-readout').textContent =
          `${element.currentTime.toFixed(1)} / ${Number.isFinite(element.duration) ? element.duration.toFixed(1) : '?'} s`;
        event('video-time', { currentTime: element.currentTime });
      }
    });
    element.addEventListener('ended', stopPlayback);
    await element.play();
    if (!authority.current(owner) || token !== playToken) {
      element.pause();
      return false;
    }
    event('video-playing', { url });
    $('[data-transport="play"]').textContent = 'Pause';
    $('[data-transport="play"]').setAttribute('aria-pressed', 'true');
    return true;
  } catch (error) {
    if (
      authority.current(owner) &&
      token === playToken &&
      error.name !== 'AbortError'
    )
      event('video-error', { message: error.message });
    return false;
  }
}
async function playFrames() {
  const owner = displayOwner;
  if (!owner || !authority.current(owner)) return;
  const token = ++playToken;
  $('[data-transport="play"]').textContent = 'Loading…';
  $('[data-transport="play"]').setAttribute('aria-pressed', 'true');
  if (state.job?.mp4_url && (await playVideo(owner, token))) return;
  if (!authority.current(owner) || token !== playToken) return;
  if (!canSeek(state.job)) {
    stopPlayback();
    $('#ws-playback-note').textContent =
      'Playback unavailable: service returned no sequence or playable video.';
    return;
  }
  const b = $('[data-transport="play"]');
  b.textContent = 'Pause';
  b.setAttribute('aria-pressed', 'true');
  while (token === playToken && authority.current(owner)) {
    const next =
      (state.displayed?.number || 0) >= state.job.frames_done
        ? 1
        : (state.displayed?.number || 0) + 1;
    if (!(await showFrame(owner, next))) break;
    await sleep(100, owner.controller.signal).catch(() => {}); // At most 10 fps playback, never reported as GPU rendering speed.
  }
  if (token === playToken) stopPlayback();
}

async function locate() {
  const query = $('#ws-location-search').value.trim();
  if (!query) return;
  edit({ aoi: null, locationQuery: query }, 'location-query');
  const controller = authority.controller(),
    epoch = authority.epoch;
  state.locationStatus = 'Finding site candidates…';
  state.candidates = [];
  $('#ws-location-results').replaceChildren();
  render();
  event('location-search', { query });
  try {
    const data = await request('/api/scenes/render/locate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: query }),
      signal: controller.signal,
    });
    if (epoch !== authority.epoch || controller.signal.aborted) return;
    state.candidates = (
      data.location
        ? [{ ...data.location, lon: data.location.lng ?? data.location.lon }]
        : data.candidates || []
    ).filter((c) => point(c.lat, c.lon));
    state.locationStatus = state.candidates.length
      ? 'Candidates only — inspect the source and confirm exact coordinates below. A geocoder match does not verify an exact site.'
      : 'No exact site found. Enter known coordinates and confirm an unverified operator AOI; no city centroid will be substituted.';
    const list = $('#ws-location-results');
    list.replaceChildren();
    for (const c of state.candidates) {
      const li = node('li');
      const b = node(
        'button',
        `Inspect ${c.name} · ${c.lat}, ${c.lon}`,
        'ws-btn',
      );
      b.type = 'button';
      b.addEventListener('click', () => {
        edit(
          {
            aoi:
              c.verification === 'verified'
                ? { ...c, radiusM: c.radiusM || 500 }
                : null,
            camera: null,
          },
          'candidate-inspected',
        );
        $('#ws-lat').value = c.lat;
        $('#ws-lon').value = c.lon;
        state.locationStatus =
          c.verification === 'verified'
            ? `${c.name} · ${c.precision} · ${c.limitation || ''}`
            : 'Candidate coordinates copied. Confirm this unverified AOI explicitly.';
        render();
      });
      li.append(
        b,
        node(
          'small',
          `${c.source || 'Unknown source'} · ${c.cached ? 'cached' : 'fresh lookup'} · observed ${c.observedAt || 'time unknown'} · exact site not established`,
        ),
      );
      if (c.sourceUrl) li.append(link('Inspect location source', c.sourceUrl));
      list.append(li);
    }
    event('location-result', { count: state.candidates.length });
  } catch (error) {
    if (epoch === authority.epoch && !controller.signal.aborted)
      state.locationStatus = `Lookup unavailable${error.status ? ' · HTTP ' + error.status : ''}: ${error.message}. Enter exact coordinates manually.`;
  } finally {
    authority.release(controller);
    if (epoch === authority.epoch) render();
  }
}
async function research() {
  if (state.active || state.evidence.phase === 'loading') return;
  const problem = validateAoi(state.aoi);
  if (problem) return selectionFailure(problem);
  if (validateDraft(state)) {
    fail(new Error(validateDraft(state)));
    return;
  }
  const controller = authority.controller(),
    epoch = authority.epoch;
  state.evidence = {
    phase: 'loading',
    items: [],
    candidates: [],
    sources: [],
    receivedAt: null,
    message: 'Querying source recordings for the selected AOI…',
  };
  render();
  const requestId = `ws-${Date.now()}-${state.revision}`;
  event('evidence-request', { requestId });
  try {
    const response = await fetch('/api/ondemand/v2/scene/evidence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        text: state.prompt,
        place: state.locationQuery,
        lat: state.aoi.lat,
        lon: state.aoi.lon,
        radiusKm: state.aoi.radiusM / 1000,
        windowHours: state.evidenceWindowHours,
        sceneId: state.job?.sceneId || '',
        requestId,
        fresh: true,
      }),
    });
    if (!response.ok)
      throw new Error(`Evidence service HTTP ${response.status}`);
    if (!response.body) throw new Error('Evidence response had no stream');
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = '',
      finished = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (epoch !== authority.epoch || controller.signal.aborted) {
        await reader.cancel();
        return;
      }
      buffer += done
        ? decoder.decode() + '\n\n'
        : decoder.decode(value, { stream: true });
      const parsed = parseSse(buffer);
      buffer = parsed.rest;
      for (const { event: name, data } of parsed.events) {
        if (name === 'source') {
          state.evidence.sources = [
            ...state.evidence.sources.filter((s) => s.id !== data.id),
            data,
          ];
        }
        if (name === 'item')
          state.evidence.items = [
            ...state.evidence.items.filter((x) => x.id !== data.id),
            data,
          ];
        if (name === 'error')
          throw new Error(
            data.message || data.error || 'Source research failed',
          );
        if (name === 'done') {
          finished = true;
          state.evidence = {
            ...state.evidence,
            ...data,
            phase: data.items?.length ? 'ready' : 'empty',
            receivedAt: new Date().toISOString(),
            message: `${data.items?.length || 0} qualifying source recording(s). ${data.cached ? 'Cached result' : 'Fresh retrieval'}; not an independent incident confirmation.`,
          };
          event('evidence-result', {
            requestId: data.requestId || requestId,
            count: data.items?.length || 0,
            builtAt: data.builtAt || null,
          });
        }
      }
      renderEvidence();
      if (done) break;
    }
    if (!finished)
      throw new Error(
        'Source stream ended before a completion record. Results are incomplete.',
      );
  } catch (error) {
    if (epoch === authority.epoch && !controller.signal.aborted) {
      state.evidence.phase = 'unavailable';
      state.evidence.message = `${error.message} Retry research when available.`;
      event('evidence-error', { message: error.message });
    }
  } finally {
    authority.release(controller);
    if (epoch === authority.epoch) render();
  }
}
function distanceM(a, b) {
  const r = Math.PI / 180,
    dlat = (a.lat - b.lat) * r,
    dlon = (a.lon - b.lon) * r;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
async function loadCctv() {
  if (state.active || state.cctv.phase === 'loading') return;
  const problem = validateAoi(state.aoi);
  if (problem) return selectionFailure(problem);
  const controller = authority.controller(),
    epoch = authority.epoch;
  state.cctv.phase = 'loading';
  state.cctv.message = 'Reading registered source cameras in this AOI…';
  render();
  try {
    const data = await request('/api/cctv/sources', {
      signal: controller.signal,
    });
    if (epoch !== authority.epoch || controller.signal.aborted) return;
    const cameras = (data.sources || []).filter(
      (c) =>
        point(c.lat, c.lon) &&
        !/fallback|synthetic|streetview/i.test(c.sourceKind || '') &&
        distanceM(c, state.aoi) <= state.aoi.radiusM,
    );
    state.cctv = {
      ...state.cctv,
      cameras,
      phase: cameras.length ? 'ready' : 'empty',
      receivedAt: new Date().toISOString(),
      message: cameras.length
        ? `${cameras.length} source camera(s). Select one; live status is not assumed.`
        : 'No registered source camera in this AOI. No random or synthetic camera substituted.',
    };
    const select = $('#ws-cctv-select');
    select.replaceChildren();
    const empty = node('option', 'Select a source camera');
    empty.value = '';
    select.append(empty);
    for (const c of cameras) {
      const option = node(
        'option',
        `${c.name || c.id} · ${c.provider || c.sourceKind || 'source'}`,
      );
      option.value = c.id;
      select.append(option);
    }
    select.value = cameras.some((c) => c.id === state.cctv.selectedId)
      ? state.cctv.selectedId
      : '';
    event('cctv-catalog', { count: cameras.length });
  } catch (error) {
    if (epoch === authority.epoch && !controller.signal.aborted) {
      state.cctv.phase = 'unavailable';
      state.cctv.message = `Source camera lookup failed: ${error.message}. Retry when available.`;
    }
  } finally {
    authority.release(controller);
    if (epoch === authority.epoch) render();
  }
}
async function refreshCctv() {
  const camera = state.cctv.cameras.find((c) => c.id === state.cctv.selectedId);
  if (!camera) return;
  const controller = authority.controller(),
    epoch = authority.epoch,
    cameraId = camera.id;
  const sequence = (state.cctv.requestSequence || 0) + 1;
  state.cctv.requestSequence = sequence;
  const current = () =>
    epoch === authority.epoch &&
    !controller.signal.aborted &&
    state.cctv.selectedId === cameraId &&
    state.cctv.requestSequence === sequence;
  state.cctv.phase = 'loading';
  state.cctv.message = `Loading ${camera.name || camera.id} from its registered upstream…`;
  renderCamera();
  let objectUrl = null;
  try {
    const response = await fetch(
      `/api/cctv/frame/${encodeURIComponent(camera.id)}?ts=${Date.now()}`,
      { cache: 'no-store', signal: controller.signal },
    );
    if (!response.ok) throw new Error(`Camera HTTP ${response.status}`);
    if (response.headers.get('x-cctv-source') !== 'upstream-image')
      throw new Error(
        'No verified upstream image returned. Synthetic and Street View fallbacks are not displayed as CCTV.',
      );
    const blob = await response.blob();
    if (!/^image\/(jpeg|png|webp)/i.test(blob.type))
      throw new Error('Unsupported source image');
    objectUrl = URL.createObjectURL(blob);
    const image = await decodedImage(objectUrl, controller.signal);
    if (!current()) return;
    image.alt = `Source snapshot: ${camera.name || camera.id}. Capture time unreported; not assumed live.`;
    $('#ws-cctv-preview').replaceChildren(
      image,
      node(
        'p',
        `${camera.provider || 'Registered source'} · upstream image · capture time unreported · retrieved ${new Date().toISOString()}`,
      ),
    );
    state.cctv.phase = 'ready';
    state.cctv.receivedAt = new Date().toISOString();
    state.cctv.message = `${camera.name || camera.id} · source snapshot, not assumed live`;
    event('cctv-frame', {
      cameraId,
      source: 'upstream-image',
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
  } catch (error) {
    if (current()) {
      state.cctv.phase = 'unavailable';
      state.cctv.message = `${error.message} Previous source image, if any, is stale.`;
      event('cctv-error', { cameraId, message: error.message });
    }
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    authority.release(controller);
    if (epoch === authority.epoch) render();
  }
}

input.addEventListener('input', () =>
  edit({ prompt: input.value }, 'prompt-edited'),
);
$('#ws-duration').addEventListener('input', (e) =>
  edit({ durationSec: number(e.target.value) }, 'duration-edited'),
);
form.addEventListener('submit', (e) => {
  e.preventDefault();
  void launch();
});
input.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    form.requestSubmit();
  }
});
$('#ws-cancel').addEventListener('click', () => {
  stopPlayback();
  cancelRemote(state.active?.jobId);
  authority.edit({}, 'operator-cancelled');
  state.phase = 'cancelled';
  state.failure = null;
  if (state.locationStatus === 'Finding site candidates…')
    state.locationStatus = 'Location lookup cancelled.';
  state.evidence.phase = state.evidence.receivedAt ? 'stale' : 'cancelled';
  state.evidence.message =
    'Cancelled locally. Refresh to retrieve current source records.';
  state.cctv.phase = state.cctv.receivedAt ? 'stale' : 'cancelled';
  state.cctv.message = 'Cancelled locally. Refresh source cameras to continue.';
  event('cancelled');
  render();
});
$('#ws-retry').addEventListener('click', () => {
  if (state.retry?.kind === 'camera' && !state.sceneDirty && state.job)
    void launch('camera', state.retry.payload);
  else void launch();
});
for (const b of document.querySelectorAll('[data-panel]'))
  b.addEventListener('click', () =>
    openPanel(app.dataset.panel === b.dataset.panel ? '' : b.dataset.panel),
  );
for (const b of document.querySelectorAll('[data-close-panel]'))
  b.addEventListener('click', () => openPanel(''));
$('[data-open-aoi]').addEventListener('click', () => {
  openPanel('aoi');
  $('#ws-location-search').focus();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') openPanel('');
});
function selectObject(target) {
  const id = target?.closest('[data-object]')?.dataset.object;
  if (!id) return;
  state.selection = id;
  event('object-selected', { objectId: id });
  renderOutliner();
  renderProps();
  renderAoi();
}
$('#ws-outliner-list').addEventListener('click', (e) => selectObject(e.target));
$('#ws-aoi-plan').addEventListener('click', (e) => selectObject(e.target));
$('#ws-aoi-plan').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    selectObject(e.target);
  }
});
$('#ws-location-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void locate();
});
$('#ws-location-search').addEventListener('input', () => {
  edit(
    { aoi: null, locationQuery: $('#ws-location-search').value },
    'location-text-edited',
  );
  state.locationStatus =
    'Location draft changed — find candidates or explicitly confirm coordinates.';
  $('#ws-location-results').replaceChildren();
  renderAoi();
});
for (const b of document.querySelectorAll('[data-place]'))
  b.addEventListener('click', () => {
    $('#ws-location-search').value = b.dataset.place;
    void locate();
  });
for (const id of ['#ws-lat', '#ws-lon', '#ws-radius'])
  $(id).addEventListener('input', () =>
    edit({ aoi: null }, 'aoi-coordinate-edited'),
  );
$('#ws-aoi-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const aoi = {
    lat: number($('#ws-lat').value),
    lon: number($('#ws-lon').value),
    radiusM: number($('#ws-radius').value),
    source: 'user-selected',
    verification: 'unverified',
  };
  const problem = validateAoi(aoi);
  if (problem) return selectionFailure(problem);
  edit(
    {
      aoi,
      camera: state.hashRestored
        ? state.camera || cameraFromHash(state.legacyHash, aoi)
        : null,
    },
    'aoi-confirmed',
  );
  state.locationStatus =
    'Operator coordinates confirmed — exact-site and incident verification remain unverified.';
  event('aoi-selected', { aoi });
  fillCamera();
  render();
  storageSave(true);
});
$('#ws-research').addEventListener('click', () => void research());
$('#ws-evidence-window').addEventListener('change', () => {
  state.evidenceWindowHours = Number($('#ws-evidence-window').value);
  storageSave(true);
  if (state.evidence.phase === 'loading') {
    edit({}, 'evidence-window-changed', false);
  }
  state.evidence.phase = 'stale';
  state.evidence.message =
    'Recording window changed. Press Research to retrieve current records.';
  render();
});
for (const b of document.querySelectorAll('[data-camera-action]'))
  b.addEventListener('click', () => {
    if (state.active || state.sceneDirty) return;
    edit({}, 'camera-action', false);
    void launch('camera', { action: b.dataset.cameraAction });
  });
function readCamera() {
  const vector = (selector) =>
    $(selector)
      .value.trim()
      .split(/[\s,]+/)
      .map(number);
  return {
    position: vector('#ws-camera-position'),
    target: vector('#ws-camera-target'),
    fovDeg: number($('#ws-camera-fov').value),
  };
}
for (const selector of [
  '#ws-camera-position',
  '#ws-camera-target',
  '#ws-camera-fov',
])
  $(selector).addEventListener('input', () => {
    const camera = readCamera();
    edit(
      { camera: validCamera(camera) ? camera : null, cameraDirty: true },
      'camera-pose-edited',
      false,
    );
    if (validCamera(camera)) {
      state.legacyHash = cameraToHash(
        camera,
        state.job?.patch?.origin || state.aoi,
        state.legacyHash,
      );
      syncHash();
      storageSave(true);
    }
  });
$('#ws-camera-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const camera = readCamera();
  if (!validCamera(camera)) {
    fail(
      new Error(
        'Enter finite X, Y, Z position and a distinct target, with field of view 25–70°.',
      ),
    );
    return;
  }
  void launch('camera', camera);
});
$('#ws-cctv-load').addEventListener('click', () => void loadCctv());
$('#ws-cctv-select').addEventListener('change', (e) => {
  state.cctv.selectedId = e.target.value || null;
  state.cctv.requestSequence = (state.cctv.requestSequence || 0) + 1;
  $('#ws-cctv-preview').replaceChildren();
  state.cctv.phase = 'ready';
  state.cctv.message =
    'Camera selected; refresh the source recording to inspect it.';
  storageSave(true);
  renderCamera();
  event('cctv-selected', { cameraId: state.cctv.selectedId });
});
$('#ws-cctv-refresh').addEventListener('click', () => void refreshCctv());
$('#ws-save').addEventListener('click', () => storageSave());
$('#ws-load').addEventListener('click', () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      $('#ws-storage-status').textContent = 'No saved draft in this browser';
      return;
    }
    const saved = JSON.parse(raw);
    if (saved.version !== 1) throw new Error('Unsupported local save version');
    const restored = createState(saved);
    edit(
      {
        prompt: restored.prompt,
        durationSec: restored.durationSec,
        aoi: restored.aoi,
        camera: restored.camera,
        legacyHash: restored.legacyHash,
        locationQuery: restored.locationQuery,
        evidenceWindowHours: restored.evidenceWindowHours,
      },
      'local-draft-loaded',
    );
    state.cctv.selectedId = restored.cctv.selectedId;
    $('#ws-location-search').value = state.locationQuery;
    $('#ws-evidence-window').value = state.evidenceWindowHours;
    storageSave(true);
    input.value = state.prompt;
    $('#ws-duration').value = state.durationSec;
    $('#ws-lat').value = state.aoi?.lat ?? '';
    $('#ws-lon').value = state.aoi?.lon ?? '';
    $('#ws-radius').value = state.aoi?.radiusM || 250;
    syncHash();
    fillCamera();
    render();
    $('#ws-storage-status').textContent =
      'Browser-local draft loaded · press Build to render';
    event('local-draft-loaded');
  } catch (error) {
    $('#ws-storage-status').textContent =
      `Local save unavailable: ${error.message}`;
  }
});
window.addEventListener('hashchange', () => {
  const hash = readHash(location.hash);
  edit(
    {
      legacyHash: hash,
      camera: cameraFromHash(hash, state.aoi),
      hashRestored: true,
    },
    'hash-view-restored',
    false,
  );
  fillCamera();
  render();
  event('hash-restored', { keys: Object.keys(hash) });
});
$('#ws-scrub').addEventListener('input', (e) => {
  stopPlayback();
  if (displayOwner && !state.stale)
    void showFrame(displayOwner, Number(e.target.value));
});
$('.ws-transport').addEventListener('click', (e) => {
  const action = e.target.closest('[data-transport]')?.dataset.transport;
  if (!action || !displayOwner || state.stale) return;
  event('transport-action', { action });
  if (action === 'play') {
    if ($('[data-transport="play"]').getAttribute('aria-pressed') === 'true') {
      stopPlayback();
      return;
    }
    void playFrames();
    return;
  }
  stopPlayback();
  const current = state.displayed?.number || 1,
    done = state.job?.frames_done || 1;
  const n =
    action === 'first'
      ? 1
      : action === 'last'
        ? done
        : action === 'prev'
          ? Math.max(1, current - 1)
          : Math.min(done, current + 1);
  void showFrame(displayOwner, n);
});
window.addEventListener('error', (e) => {
  ws.errors.push(
    event('runtime-error', { message: e.message || 'Unknown runtime error' }),
  );
});
window.addEventListener('unhandledrejection', (e) => {
  ws.errors.push(
    event('unhandled-rejection', {
      message: e.reason?.message || String(e.reason),
    }),
  );
});
// Query links may fill the draft, but never submit it, even if ?build=1 is supplied.
const params = new URLSearchParams(location.search);
if (params.get('prompt')) {
  state.prompt = params.get('prompt').slice(0, 600);
  input.value = state.prompt;
}
// Restore only actual saved camera state on reload. A full draft requires explicit Load local.
try {
  const saved = JSON.parse(
    localStorage.getItem(AUTO_STORAGE_KEY) ||
      localStorage.getItem(STORAGE_KEY) ||
      'null',
  );
  if (saved?.version === 1) {
    if (!location.hash && validCamera(saved.camera))
      state.camera = saved.camera;
    if (
      location.hash &&
      writeHash(saved.legacyHash || {}) === writeHash(state.legacyHash) &&
      validCamera(saved.camera)
    )
      state.camera = saved.camera;
    state.cctv.selectedId = saved.cctvId || null;
  }
} catch {
  /* storage restriction is surfaced on Save/Load */
}
fillCamera();
render();
event('workstation-ready', { hashKeys: Object.keys(state.legacyHash) });
