import test from 'node:test';
import assert from 'node:assert/strict';
import { installRenderGuard } from './renderGuard.js';
import { SOFTWARE_TILESET_CACHE_BYTES } from '../cinematic/renderBudget.js';

function createFakeDom() {
  const elements = new Map();

  function makeElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      id: '',
      hidden: false,
      attributes: {},
      children: [],
      parentNode: null,
      textContent: '',
      setAttribute(k, v) {
        el.attributes[k] = v;
      },
      getAttribute(k) {
        return el.attributes[k];
      },
      appendChild(child) {
        el.children.push(child);
        child.parentNode = el;
        return child;
      },
      removeChild(child) {
        const idx = el.children.indexOf(child);
        if (idx !== -1) el.children.splice(idx, 1);
        child.parentNode = null;
        return child;
      },
      get firstChild() {
        return el.children[0] || null;
      },
      remove() {
        if (el.parentNode) el.parentNode.removeChild(el);
      },
      addEventListener(evt, cb) {
        el._listeners = el._listeners || {};
        el._listeners[evt] = el._listeners[evt] || [];
        el._listeners[evt].push(cb);
      },
      querySelector(selector) {
        if (selector === '.cesium-widget-errorPanel') {
          return (
            el.children.find((c) =>
              c.classList?.contains?.('cesium-widget-errorPanel'),
            ) || null
          );
        }
        return null;
      },
    };
    return el;
  }

  const body = makeElement('body');
  const doc = {
    body,
    createElement(tag) {
      return makeElement(tag);
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelector(sel) {
      return null;
    },
  };

  const dispatchedEvents = [];
  const win = {
    document: doc,
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    dispatchEvent(evt) {
      dispatchedEvents.push(evt);
    },
    requestAnimationFrame(cb) {
      cb();
    },
    setTimeout(cb) {
      return 1;
    },
    clearTimeout() {},
    location: {
      reloaded: false,
      reload() {
        this.reloaded = true;
      },
    },
  };

  return { win, doc, body, dispatchedEvents };
}

function createFakeViewer() {
  const errorListeners = [];
  const canvasListeners = {};

  const fakeTileset = {
    cacheBytes: 1536 * 1024 * 1024,
    maximumCacheOverflowBytes: 1024 * 1024 * 1024,
    totalMemoryUsageInBytes: 512 * 1024 * 1024,
    trimLoadedTilesCalled: false,
    trimLoadedTiles() {
      this.trimLoadedTilesCalled = true;
    },
  };

  const primitives = [fakeTileset];

  const canvas = {
    addEventListener(evt, cb) {
      canvasListeners[evt] = canvasListeners[evt] || [];
      canvasListeners[evt].push(cb);
    },
    removeEventListener(evt, cb) {
      if (canvasListeners[evt]) {
        canvasListeners[evt] = canvasListeners[evt].filter((l) => l !== cb);
      }
    },
    _emit(evt, eventObj) {
      for (const cb of canvasListeners[evt] || []) cb(eventObj);
    },
  };

  const viewer = {
    container: {
      querySelector(sel) {
        return null;
      },
    },
    canvas,
    resolutionScale: 1.0,
    useDefaultRenderLoop: true,
    isDestroyed() {
      return false;
    },
    scene: {
      canvas,
      msaaSamples: 4,
      primitives,
      renderError: {
        addEventListener(cb) {
          errorListeners.push(cb);
          return () => {
            const idx = errorListeners.indexOf(cb);
            if (idx !== -1) errorListeners.splice(idx, 1);
          };
        },
      },
      requestRender() {},
    },
    entities: {
      values: [
        { id: 'e1', billboard: {} },
        { id: 'e2', label: {} },
        { id: 'e3', polyline: {} },
      ],
    },
    dataSources: [
      {
        entities: {
          values: [
            { id: 'ds1', billboard: {}, label: {} },
            { id: 'ds2', billboard: {} },
          ],
        },
      },
    ],
    _emitRenderError(err) {
      for (const cb of [...errorListeners]) cb(viewer.scene, err);
    },
    fakeTileset,
  };

  return viewer;
}

test('installRenderGuard exposes __gevRender API and records stats on render error', () => {
  const { win, doc, dispatchedEvents } = createFakeDom();
  const viewer = createFakeViewer();

  let recoveredReason = null;
  const guard = installRenderGuard(viewer, {
    window: win,
    document: doc,
    onRecover: (reason) => {
      recoveredReason = reason;
    },
    maxRecoveries: 3,
  });

  assert.ok(win.__gevRender);
  assert.equal(typeof win.__gevRender.stats, 'function');
  assert.equal(typeof win.__gevRender.budget, 'function');
  assert.equal(typeof win.__gevRender.reduceBudget, 'function');

  // Trigger render error
  viewer.useDefaultRenderLoop = false;
  viewer._emitRenderError(
    new RangeError('Array buffer allocation failed test'),
  );

  const stats = win.__gevRender.stats();
  assert.equal(stats.renderErrors, 1);
  assert.equal(stats.recoveries, 1);
  assert.match(stats.lastError, /Array buffer allocation failed/);

  // Budget should be reduced
  assert.equal(viewer.resolutionScale, 0.75);
  assert.equal(viewer.scene.msaaSamples, 1);
  assert.equal(viewer.fakeTileset.cacheBytes, SOFTWARE_TILESET_CACHE_BYTES);
  assert.equal(viewer.fakeTileset.trimLoadedTilesCalled, true);

  // Render loop re-enabled
  assert.equal(viewer.useDefaultRenderLoop, true);

  // Event dispatched and callback called
  assert.equal(recoveredReason, 'render-error');
  assert.equal(dispatchedEvents.length, 1);
  assert.equal(dispatchedEvents[0].type, 'gev:render-recovered');
  assert.equal(dispatchedEvents[0].detail.reason, 'render-error');
  assert.equal(dispatchedEvents[0].detail.attempt, 1);

  // Trigger second render error: scale should drop to 0.5
  viewer.useDefaultRenderLoop = false;
  viewer._emitRenderError(new Error('Second error'));
  assert.equal(viewer.resolutionScale, 0.5);
  assert.equal(win.__gevRender.stats().recoveries, 2);

  guard.uninstall();
  assert.equal(win.__gevRender, undefined);
});

test('renderGuard: budget() counts entities, billboards, labels, and tilesetCacheMb', () => {
  const { win, doc } = createFakeDom();
  const viewer = createFakeViewer();

  const guard = installRenderGuard(viewer, { window: win, document: doc });
  const b = win.__gevRender.budget();

  assert.equal(b.entities, 5); // 3 in viewer + 2 in dataSource
  assert.equal(b.billboards, 3); // 1 in viewer + 2 in dataSource
  assert.equal(b.labels, 2); // 1 in viewer + 1 in dataSource
  assert.equal(b.polylines, 1);
  assert.equal(b.primitives, 1);
  assert.equal(b.tilesetCacheMb, 512);

  guard.uninstall();
});

test('renderGuard: halts and shows persistent reload toast when maxRecoveries exceeded', () => {
  const { win, doc } = createFakeDom();
  const viewer = createFakeViewer();

  const guard = installRenderGuard(viewer, {
    window: win,
    document: doc,
    maxRecoveries: 2,
  });

  // 1st error: recovers
  viewer._emitRenderError(new Error('err 1'));
  assert.equal(win.__gevRender.stats().recoveries, 1);

  // 2nd error: recovers
  viewer._emitRenderError(new Error('err 2'));
  assert.equal(win.__gevRender.stats().recoveries, 2);

  // 3rd error: exceeds maxRecoveries=2 within 60s
  viewer.useDefaultRenderLoop = false;
  viewer._emitRenderError(new Error('err 3'));

  // Should NOT increment recoveries past 2
  assert.equal(win.__gevRender.stats().recoveries, 2);
  assert.equal(viewer.useDefaultRenderLoop, false);

  const toast = doc.body.children.find((c) => c.id === 'gev-render-toast');
  assert.ok(toast);
  assert.equal(toast.hidden, false);
  const reloadBtn = toast.children.find((c) =>
    c.classList?.contains?.('gev-render-toast-reload') || c.tagName === 'BUTTON',
  );
  assert.ok(reloadBtn);

  guard.uninstall();
});

test('renderGuard: intercepts webglcontextlost and webglcontextrestored', () => {
  const { win, doc, dispatchedEvents } = createFakeDom();
  const viewer = createFakeViewer();

  let recoveredReason = null;
  const guard = installRenderGuard(viewer, {
    window: win,
    document: doc,
    onRecover: (reason) => {
      recoveredReason = reason;
    },
  });

  let prevented = false;
  viewer.canvas._emit('webglcontextlost', {
    preventDefault() {
      prevented = true;
    },
  });

  assert.equal(prevented, true);
  assert.equal(win.__gevRender.stats().contextLost, 1);

  viewer.useDefaultRenderLoop = false;
  viewer.canvas._emit('webglcontextrestored', {});

  assert.equal(win.__gevRender.stats().contextRestored, 1);
  assert.equal(win.__gevRender.stats().recoveries, 1);
  assert.equal(viewer.useDefaultRenderLoop, true);
  assert.equal(recoveredReason, 'context-restored');
  assert.ok(dispatchedEvents.some((e) => e.detail?.reason === 'context-restored'));

  guard.uninstall();
});
