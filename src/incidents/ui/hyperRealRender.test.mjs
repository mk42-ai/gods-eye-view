import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHyperRealRender,
  renderRequestForScene,
  timeOfDayForScene,
  outlinerTree,
  transformEntries,
  RENDER_LABEL,
  RENDER_ENDPOINT,
  GPU_BADGE,
} from './hyperRealRender.js';

function makeDoc() {
  const mk = (tag) => {
    const node = {
      tagName: tag.toUpperCase(), children: [], attrs: {}, listeners: {}, className: '', textContent: '', hidden: false, parentNode: null, disabled: false, value: '',
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, removeAttribute(k) { delete this.attrs[k]; },
      append(...kids) { for (const k of kids) { k.parentNode = this; this.children.push(k); } }, appendChild(k) { this.append(k); return k; },
      replaceChildren(...kids) { this.children = []; this.append(...kids); },
      remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); },
      addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }, removeEventListener() {},
      click() { for (const fn of this.listeners.click || []) fn({ type: 'click' }); },
      classList: { toggle() {}, contains() { return false; } },
      get dataset() { const a = this.attrs; return new Proxy({}, { get: (_, k) => a['data-' + String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())] }); },
      querySelector(sel) { return this.all().find((n) => n.matches(sel)) || null; },
      querySelectorAll(sel) { return this.all().filter((n) => n.matches(sel)); },
      all() { return this.children.flatMap((c) => [c, ...c.all()]); },
      matches(sel) {
        if (sel.startsWith('.')) return this.className.split(/\s+/).includes(sel.slice(1));
        if (sel.startsWith('[')) { const m = sel.match(/^\[([^=\]]+)="?([^"\]]*)"?\]$/); return m && this.attrs[m[1]] === m[2]; }
        return this.tagName === sel.toUpperCase();
      },
      text() { return [this.textContent, ...this.children.map((c) => c.text())].filter(Boolean).join(' '); },
    };
    return node;
  };
  const doc = { createElement: mk, body: mk('body') };
  return doc;
}
const fakeWindow = () => {
  const events = [];
  return { events, setTimeout, clearTimeout, dispatchEvent(e) { events.push(e); }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } } };
};

const scene = { id: 's1', title: 'car crash outside yas mall', anchor: { name: 'Yas Mall', lat: 24.4885, lon: 54.6088 } };
const JOB = 'abc123def456abcd';
const statusBody = (done) => ({
  job_id: JOB, stage: done ? 'complete' : 'render', progress: done ? 1 : 0.4, frames_done: done ? 72 : 10, total_frames: 120, timeline_fps: 24,
  mp4_bytes: done ? 1000 : 0, ttff_s: 21.5, fps_steady: 24.9, mp4_url: `/api/scenes/render/${JOB}/video.mp4`, latest_frame_url: `/api/scenes/render/${JOB}/latest.jpg`,
  stream_url: `/api/scenes/render/${JOB}/stream`, frames_url_template: `/api/scenes/render/${JOB}/frames/{n}.jpg`, illustrative: true,
  land_patch: { buildings: 108, roads: 656, status: 'ok' }, patch: { id: 'patch_x', elevation: { source: 'Copernicus DSM' } },
  camera: { position: [1, 2, 3], target: [4, 5, 6], fovDeg: 50 },
  placement: { instances: 2, by_asset: { civilian_sedan: 1, debris_tire: 1 }, items: [
    { id: 'staged_0', asset: 'civilian_sedan', x: 109.7, y: 201.1, z: -6.1, heading_deg: -79.1, scale: 1, sourceId: 'way/1' },
    { id: 'staged_1', asset: 'debris_tire', x: 109.5, y: 198.8, z: -6.2, heading_deg: -94, scale: 1, sourceId: 'way/1' },
  ] },
  frames: [{ index: 1, quality: 'preview', gpu: { physicalIndex: 2, uuid: 'GPU-b2aff670' } }, { index: 2, quality: 'sequence', gpu: { physicalIndex: 6, uuid: 'GPU-2c78264d' } }],
});

test('renderRequestForScene builds the ondemandPatchRender body (lat/lon/place, bounded duration, street camera)', () => {
  assert.equal(renderRequestForScene(null), null);
  assert.equal(renderRequestForScene({ anchor: { lat: 1, lon: 2 }, title: '' }), null);
  const r = renderRequestForScene(scene, { prompt: 'car crash outside yas mall at dusk', durationS: 60 });
  assert.deepEqual(r, { prompt: 'car crash outside yas mall at dusk', lat: 24.4885, lon: 54.6088, place: 'Yas Mall', time_of_day: 'dusk', camera_mode: 'street', duration: 10, resolution: '1280x720' });
  assert.equal(renderRequestForScene(scene, { prompt: 'x y z', durationS: 1 }).duration, 2);
  assert.equal(timeOfDayForScene(scene, 'raid at night'), 'night');
  assert.equal(timeOfDayForScene(scene, 'crowd at midday'), 'midday');
  assert.equal(timeOfDayForScene(scene, 'nothing', () => new Date('2026-11-03T20:00:00Z')), 'night'); // 00:00 UAE
  assert.equal(timeOfDayForScene(scene, 'nothing', () => new Date('2026-11-03T06:00:00Z')), 'midday'); // 10:00 UAE
});

test('outlinerTree groups the job into Terrain / Buildings / Roads / Vehicles / Debris and transforms come from placement', () => {
  const tree = outlinerTree(statusBody(true));
  const names = tree.map((g) => g.name);
  for (const n of ['Terrain', 'Buildings', 'Roads', 'Vehicles', 'Debris', 'Camera']) assert.ok(names.includes(n), n);
  const vehicles = tree.find((g) => g.name === 'Vehicles').rows;
  assert.ok(vehicles.some((r) => r.object === 'instance:staged_0'));
  const t = transformEntries(statusBody(true), 'instance:staged_0');
  assert.equal(t[0][1], '109.70 / 201.10 / -6.10');
  assert.equal(t[1][1], '0 / 0 / -79.1');
  assert.equal(t[2][1], '1 / 1 / 1');
  assert.equal(outlinerTree(null).length, 0);
});

test('typing never renders; a built scene posts exactly ONE /api/patch-render request, polls, populates outliner/properties/render/timeline', async () => {
  const document = makeDoc();
  const window = fakeWindow();
  const calls = [];
  let statusCalls = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === RENDER_ENDPOINT)
      return { ok: true, status: 202, json: async () => ({ tool: 'ondemandPatchRender', job_id: JOB, status: 'queued', stream_url: `/api/scenes/render/${JOB}/stream`, latest_frame_url: `/api/scenes/render/${JOB}/latest.jpg`, mp4_url: `/api/scenes/render/${JOB}/video.mp4`, illustrative: true, label: RENDER_LABEL }) };
    statusCalls++;
    return { ok: true, status: 200, json: async () => statusBody(statusCalls >= 2) };
  };
  const hr = createHyperRealRender({ document, window, fetch: fetchImpl, pollMs: 5 });
  document.body.append(hr.toggle, hr.panel);
  assert.equal(hr.toggle.disabled, true, 'no scene → disabled');
  assert.equal(hr.isEnabled(), true, 'armed by default: Build scene → one render');
  assert.equal(hr.panel.getAttribute('data-illustrative'), 'true');
  assert.ok(hr.panel.text().includes(RENDER_LABEL));
  assert.ok(hr.panel.text().includes(GPU_BADGE));
  assert.equal(hr.panel.hidden, false, 'panel strip is present from the start');
  assert.equal(hr.panel.getAttribute('data-collapsed'), 'true', '…but collapsed so it never covers the map');
  // typing / prompt changes only re-point the scene; never a network call
  hr.setScene(scene, 'car crash outside yas mall');
  hr.setScene(null);
  hr.setScene(scene, 'car crash outside yas mall');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.length, 0, 'setScene (typing) sends nothing');
  assert.equal(hr.toggle.disabled, false);
  // Build scene succeeded → exactly one POST
  hr.onSceneBuilt(scene, 'car crash outside yas mall');
  await new Promise((r) => setTimeout(r, 80));
  const posts = calls.filter((c) => c.url === RENDER_ENDPOINT);
  assert.equal(posts.length, 1, 'exactly one render request per build');
  const body = JSON.parse(posts[0].init.body);
  assert.equal(body.lat, 24.4885);
  assert.equal(body.lon, 54.6088);
  assert.equal(body.duration, 5);
  assert.equal(body.camera_mode, 'street');
  assert.ok(statusCalls >= 2, 'polled status until terminal');
  assert.equal(hr.getCounters().posts, 1);
  assert.equal(hr.panel.getAttribute('data-stage'), 'complete');
  assert.equal(hr.panel.querySelector('.hyperreal-panel__video').getAttribute('src'), `/api/scenes/render/${JOB}/video.mp4`);
  assert.equal(hr.panel.hidden, false);
  assert.equal(hr.panel.getAttribute('data-collapsed'), 'false', 'a started render expands the panel');
  assert.equal(hr.panel.querySelectorAll('.hyperreal-panel__badge').length, 1);
  // Outliner tree populated with the groups the mockups call for
  const groups = hr.panel.querySelector('.hyperreal-outliner').getAttribute('data-groups');
  for (const n of ['Terrain', 'Buildings', 'Roads', 'Vehicles']) assert.ok(groups.includes(n), n);
  // Properties show transform rows; Render sheet shows the GPU badge + stats
  const props = hr.panel.querySelector('.hyperreal-props').text();
  assert.ok(props.includes('Location (m E/N/U)') && props.includes('Rotation') && props.includes('Scale'));
  const stats = hr.panel.querySelector('.hyperreal-render-stats').text();
  assert.ok(stats.includes('GPU 2 + GPU 6') && stats.includes('24.9 fps') && stats.includes('21.5 s'));
  assert.ok(hr.panel.querySelector('.hyperreal-panel__hud-gpu').textContent.includes('GPU 2 + 6'));
  // Timeline: Play advances frames from the frames template
  const play = hr.panel.querySelector('.hyperreal-timeline__play');
  assert.equal(play.disabled, false);
  play.click();
  await new Promise((r) => setTimeout(r, 120));
  play.click();
  const frameSrc = hr.panel.querySelector('.hyperreal-panel__frame').getAttribute('src');
  assert.match(frameSrc, new RegExp(`/api/scenes/render/${JOB}/frames/\\d+\\.jpg`));
  assert.ok(window.events.some((e) => e.type === 'gev:hyperreal-frame'));
  hr.destroy();
});

test('a failed request shows the HTTP status banner with Retry; Retry re-posts the same body once', async () => {
  const document = makeDoc();
  const window = fakeWindow();
  let n = 0;
  const hr = createHyperRealRender({ document, window, pollMs: 5, fetch: async (url) => {
    if (url !== RENDER_ENDPOINT) return { ok: true, status: 200, json: async () => statusBody(true) };
    n++;
    if (n === 1) return { ok: false, status: 409, json: async () => ({ error: 'gpu_policy_violation', violations: ['gpu_service_not_ready'] }) };
    return { ok: true, status: 202, json: async () => ({ job_id: JOB }) };
  } });
  hr.setScene(scene, 'x y z');
  const out = await hr.start();
  assert.equal(out, null);
  const banner = hr.panel.querySelector('.hyperreal-panel__banner');
  assert.equal(banner.hidden, false);
  assert.equal(banner.querySelector('.hyperreal-panel__banner-status').textContent, 'HTTP 409');
  assert.match(banner.querySelector('.hyperreal-panel__banner-text').textContent, /gpu_policy_violation/);
  hr.panel.querySelector('.hyperreal-panel__retry').click();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(n, 2, 'Retry posted exactly once more');
  assert.equal(banner.hidden, true);
  assert.equal(hr.panel.getAttribute('data-stage'), 'complete');
  hr.destroy();
});

test('not_configured deployments show an honest message and never fake a render', async () => {
  const document = makeDoc();
  const window = fakeWindow();
  const hr = createHyperRealRender({ document, window, fetch: async () => ({ ok: false, status: 503, json: async () => ({ error: 'not_configured' }) }), pollMs: 5 });
  hr.setScene(scene, 'x y z');
  const out = await hr.start();
  assert.equal(out, null);
  assert.equal(hr.panel.getAttribute('data-stage'), 'not_configured');
  assert.ok(hr.panel.querySelector('.hyperreal-panel__status').textContent.includes('not connected'));
  assert.equal(hr.panel.querySelector('.hyperreal-panel__video').hidden, true);
  assert.equal(hr.panel.querySelector('.hyperreal-panel__banner').querySelector('.hyperreal-panel__banner-status').textContent, 'HTTP 503');
});

test('a superseded build (new scene while polling) stops the old poll loop — older jobs never overwrite the newer panel', async () => {
  const document = makeDoc();
  const window = fakeWindow();
  let polls = 0;
  const hr = createHyperRealRender({ document, window, pollMs: 5, fetch: async (url) => {
    if (url === RENDER_ENDPOINT) return { ok: true, status: 202, json: async () => ({ job_id: JOB }) };
    polls++;
    return { ok: true, status: 200, json: async () => statusBody(false) };
  } });
  hr.setScene(scene, 'first');
  await hr.start();
  await new Promise((r) => setTimeout(r, 30));
  const seen = polls;
  assert.ok(seen >= 1);
  hr.setScene(null); // prompt changed / cancelled
  await new Promise((r) => setTimeout(r, 40));
  assert.ok(polls - seen <= 1, 'old poll loop stopped after the scene was invalidated');
  hr.destroy();
});
