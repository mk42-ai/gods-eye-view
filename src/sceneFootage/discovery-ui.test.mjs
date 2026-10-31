import test from 'node:test';
import assert from 'node:assert/strict';
import { createFootageController } from './controller.js';
import { createSceneFootagePanel, FOOTAGE_PANEL_ID } from './panel.js';
import { installSceneFootage, SCENE_FOOTAGE_EVENT } from './index.js';

function makeDoc() {
  const mk = (tag) => {
    const listeners = new Map();
    return {
      tagName: tag.toUpperCase(),
      children: [],
      attrs: new Map(),
      dataset: {},
      style: {},
      textContent: '',
      hidden: false,
      options: [],
      value: '',
      set className(v) {
        this.attrs.set('class', v);
      },
      get className() {
        return this.attrs.get('class') || '';
      },
      set id(v) {
        this.attrs.set('id', v);
      },
      get id() {
        return this.attrs.get('id');
      },
      setAttribute(k, v) {
        this.attrs.set(k, String(v));
        if (k.startsWith('data-'))
          this.dataset[
            k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
          ] = String(v);
      },
      getAttribute(k) {
        return this.attrs.get(k) ?? null;
      },
      append(...k) {
        for (const c of k) this.appendChild(c);
      },
      appendChild(c) {
        this.children.push(c);
        c.parentNode = this;
        if (this.tagName === 'SELECT') this.options = this.children;
        return c;
      },
      replaceChildren(...k) {
        this.children = [];
        for (const c of k) this.appendChild(c);
      },
      addEventListener(t, f) {
        listeners.set(t, [...(listeners.get(t) || []), f]);
      },
      dispatch(t, e = {}) {
        for (const f of listeners.get(t) || []) f(e);
      },
      canPlayType: () => 'maybe',
      play: () => Promise.resolve(),
      remove() {},
    };
  };
  const body = mk('body');
  return {
    createElement: mk,
    createTextNode: (t) => ({ textContent: t, children: [] }),
    body,
    documentElement: body,
  };
}

const find = (n, pred) => {
  if (!n) return null;
  if (pred(n)) return n;
  for (const c of n.children || []) {
    const r = find(c, pred);
    if (r) return r;
  }
  return null;
};

test('UI contracts: discoverable data attributes and distinct non-CCTV footage source', () => {
  const doc = makeDoc();
  const ctl = createFootageController({ document: null });
  const panel = createSceneFootagePanel({ document: doc, controller: ctl });

  assert.equal(panel.element.getAttribute('data-snapchat-discovery'), 'panel');
  assert.equal(
    panel.element.getAttribute('data-footage-source'),
    'snapchat-spotlight',
  );
  assert.equal(
    panel.element.getAttribute('data-source-type'),
    'social-footage',
  );

  const discoverBtn = find(
    panel.element,
    (n) => n.id === `${FOOTAGE_PANEL_ID}-discover`,
  );
  assert.ok(discoverBtn, 'discover button exists');
  assert.equal(
    discoverBtn.getAttribute?.('data-snapchat-discovery'),
    'discover-btn',
  );

  const status = find(
    panel.element,
    (n) => n.id === `${FOOTAGE_PANEL_ID}-status`,
  );
  assert.ok(status, 'status element exists');
  assert.equal(status.getAttribute('data-snapchat-discovery'), 'status');

  const controls = find(
    panel.element,
    (n) => n.getAttribute?.('data-snapchat-discovery') === 'controls',
  );
  assert.ok(controls, 'controls container exists');
});

test('UI standby mode: prompt-derived scenes set visible standby state without automatic network request', async () => {
  const doc = makeDoc();
  const win = {
    listeners: new Map(),
    addEventListener(t, f) {
      this.listeners.set(t, [...(this.listeners.get(t) || []), f]);
    },
    removeEventListener(t, f) {
      this.listeners.set(
        t,
        (this.listeners.get(t) || []).filter((x) => x !== f),
      );
    },
    dispatchEvent(event) {
      for (const f of this.listeners.get(event.type) || []) f(event);
    },
  };

  const fetchCalls = [];
  const fakeFetch = async (url, init) => {
    fetchCalls.push({ url, init });
    return { ok: true, json: async () => ({ state: 'ok', clips: [] }) };
  };

  const footage = installSceneFootage({
    document: doc,
    window: win,
    fetch: fakeFetch,
  });

  // Prompt-derived scene event (as dispatched by composer/sceneStudio)
  win.dispatchEvent({
    type: 'gev:scene-evidence',
    detail: {
      text: 'Dubai Marina incident overview',
      place: 'Dubai Marina',
      lat: 25.0786415,
      lon: 55.1352524,
      promptDerived: true,
      constructed: true,
    },
  });

  const state = footage.getState();
  assert.equal(
    state.promptDerivedSuppressed,
    true,
    'prompt-derived suppression active',
  );
  assert.equal(state.standby, true, 'controller placed in standby');
  assert.equal(state.phase, 'standby');
  assert.equal(state.scene.placeName, 'Dubai Marina');

  // CRITICAL: NO automatic network request was dispatched!
  assert.equal(
    fetchCalls.length,
    0,
    'no automatic network request fired for prompt-derived scene',
  );

  // BUT panel is NOT hidden! Controls are visible to operator!
  assert.equal(
    footage.panel.element.hidden,
    false,
    'panel is visible in standby',
  );

  footage.destroy();
});

test('explicit discovery via gev:scene-footage propagates metadata, UTC timeWindow, and radius', async () => {
  const doc = makeDoc();
  const win = {
    listeners: new Map(),
    addEventListener(t, f) {
      this.listeners.set(t, [...(this.listeners.get(t) || []), f]);
    },
    removeEventListener(t, f) {
      this.listeners.set(
        t,
        (this.listeners.get(t) || []).filter((x) => x !== f),
      );
    },
    dispatchEvent(event) {
      for (const f of this.listeners.get(event.type) || []) f(event);
    },
  };

  const fetchCalls = [];
  const fakeFetch = async (url, init) => {
    fetchCalls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      json: async () => ({
        state: 'ok',
        locationId: 'snap-dubai-marina',
        clips: [],
        coverageLevel: 'landmark',
        coverageLabel: 'Dubai Marina',
        accounting: {
          returnedCount: 0,
          uniqueCount: 0,
          matchingCount: 0,
          queriesCount: 1,
          pagesCount: 1,
        },
        capabilities: { paginationSupported: false, batchSupported: false },
      }),
    };
  };

  const footage = installSceneFootage({
    document: doc,
    window: win,
    fetch: fakeFetch,
  });

  // Explicit gev:scene-footage event
  win.dispatchEvent({
    type: SCENE_FOOTAGE_EVENT,
    detail: {
      lat: 25.0786415,
      lon: 55.1352524,
      placeName: 'Dubai Marina',
      radius: 2.5,
      strictBounds: true,
      timeWindow: {
        windowHours: 24,
        windowStart: '2026-10-30T00:00:00Z',
        strictCaptureTime: true,
      },
    },
  });

  // The explicit event fired open with explicit bounds
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.radius, 2.5);
  assert.equal(fetchCalls[0].body.timeWindow.strictCaptureTime, true);
  footage.destroy();
});

test('api.discover() triggers discovery for active scene with explicit bounds', async () => {
  const doc = makeDoc();
  const win = {
    listeners: new Map(),
    addEventListener(t, f) {
      this.listeners.set(t, [...(this.listeners.get(t) || []), f]);
    },
    removeEventListener() {},
  };

  const fetchCalls = [];
  const fakeFetch = async (url, init) => {
    fetchCalls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      json: async () => ({
        state: 'ok',
        locationId: 'snap-dubai-marina',
        clips: [],
        coverageLevel: 'landmark',
        coverageLabel: 'Dubai Marina',
      }),
    };
  };

  const footage = installSceneFootage({
    document: doc,
    window: win,
    fetch: fakeFetch,
  });

  await footage.controller.open(
    {
      lat: 25.0786415,
      lon: 55.1352524,
      placeName: 'Dubai Marina',
    },
    { standby: true },
  );

  assert.equal(footage.controller.state.phase, 'standby');

  // Trigger explicit discover via controller / api
  await footage.controller.discover({ radius: 3.0, strictBounds: true });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.radius, 3.0);
  assert.equal(fetchCalls[0].body.strictBounds, true);

  footage.destroy();
});
