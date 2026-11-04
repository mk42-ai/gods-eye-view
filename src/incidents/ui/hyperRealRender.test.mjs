import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHyperRealRender,
  renderRequestForScene,
  timeOfDayForScene,
  RENDER_LABEL,
} from './hyperRealRender.js';

function makeDoc() {
  const mk = (tag) => {
    const node = {
      tagName: tag.toUpperCase(), children: [], attrs: {}, listeners: {}, className: '', textContent: '', hidden: false, parentNode: null, disabled: false,
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, removeAttribute(k) { delete this.attrs[k]; },
      append(...kids) { for (const k of kids) { k.parentNode = this; this.children.push(k); } }, appendChild(k) { this.append(k); return k; },
      remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); },
      addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); }, removeEventListener() {},
      click() { for (const fn of this.listeners.click || []) fn({ type: 'click' }); },
      classList: { toggle() {}, contains() { return false; } },
      get dataset() { const a = this.attrs; return new Proxy({}, { get: (_, k) => a['data-' + String(k).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())] }); },
      querySelector(sel) { return this.all().find((n) => n.matches(sel)) || null; },
      querySelectorAll(sel) { return this.all().filter((n) => n.matches(sel)); },
      all() { return this.children.flatMap((c) => [c, ...c.all()]); },
      matches(sel) { return sel.startsWith('.') ? this.className.split(/\s+/).includes(sel.slice(1)) : this.tagName === sel.toUpperCase(); },
      text() { return [this.textContent, ...this.children.map((c) => c.text())].filter(Boolean).join(' '); },
    };
    return node;
  };
  const doc = { createElement: mk, body: mk('body') };
  return doc;
}
const fakeWindow = () => ({ setTimeout, clearTimeout, dispatchEvent() {}, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } } });

const scene = { id: 's1', title: 'car crash outside yas mall', anchor: { name: 'Yas Mall', lat: 24.4885, lon: 54.6088 } };

test('renderRequestForScene needs an anchor and a prompt; time of day comes from the prompt first', () => {
  assert.equal(renderRequestForScene(null), null);
  assert.equal(renderRequestForScene({ anchor: { lat: 1, lon: 2 }, title: '' }), null);
  const r = renderRequestForScene(scene, { prompt: 'car crash outside yas mall at dusk' });
  assert.deepEqual(r, { prompt: 'car crash outside yas mall at dusk', lat: 24.4885, lng: 54.6088, time_of_day: 'dusk', duration_s: 60 });
  assert.equal(timeOfDayForScene(scene, 'raid at night'), 'night');
  assert.equal(timeOfDayForScene(scene, 'crowd at midday'), 'midday');
  assert.equal(timeOfDayForScene(scene, 'nothing', () => new Date('2026-11-03T20:00:00Z')), 'night'); // 00:00 UAE
  assert.equal(timeOfDayForScene(scene, 'nothing', () => new Date('2026-11-03T06:00:00Z')), 'midday'); // 10:00 UAE
});

test('toggle is disabled without a scene, posts to the same-origin proxy, polls status and labels everything illustrative', async () => {
  const document = makeDoc();
  const window = fakeWindow();
  const calls = [];
  let statusCalls = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url === '/api/scenes/render')
      return { ok: true, status: 202, json: async () => ({ job_id: 'abc123def456', stream_url: '/api/scenes/render/abc123def456/stream', latest_frame_url: '/api/scenes/render/abc123def456/latest.jpg', mp4_url: '/api/scenes/render/abc123def456/video.mp4', illustrative: true, label: RENDER_LABEL }) };
    statusCalls++;
    const done = statusCalls >= 2;
    return { ok: true, status: 200, json: async () => ({ job_id: 'abc123def456', stage: done ? 'complete' : 'render', progress: done ? 1 : 0.4, frames_done: done ? 72 : 10, mp4_bytes: done ? 1000 : 0, ttff_s: 21.5, fps_sustained: 1.9, mp4_url: '/api/scenes/render/abc123def456/video.mp4', latest_frame_url: '/api/scenes/render/abc123def456/latest.jpg', stream_url: '/api/scenes/render/abc123def456/stream', illustrative: true }) };
  };
  const hr = createHyperRealRender({ document, window, fetch: fetchImpl, pollMs: 5 });
  document.body.append(hr.toggle, hr.panel);
  assert.equal(hr.toggle.disabled, true, 'no scene → disabled');
  assert.equal(hr.panel.getAttribute('data-illustrative'), 'true');
  assert.ok(hr.panel.text().includes(RENDER_LABEL));
  hr.setScene(scene, 'car crash outside yas mall');
  assert.equal(hr.toggle.disabled, false);
  hr.toggle.click();
  assert.equal(hr.toggle.getAttribute('aria-pressed'), 'true');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls[0].url, '/api/scenes/render');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.lat, 24.4885);
  assert.equal(body.duration_s, 60);
  assert.ok(statusCalls >= 2, 'polled status until terminal');
  assert.equal(hr.panel.getAttribute('data-stage'), 'complete');
  assert.equal(hr.panel.querySelector('.hyperreal-panel__video').getAttribute('src'), '/api/scenes/render/abc123def456/video.mp4');
  assert.equal(hr.panel.hidden, false);
  // the badge is fixed in the header and the watermark sits over the viewport
  assert.equal(hr.panel.querySelectorAll('.hyperreal-panel__badge').length, 1);
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
});
