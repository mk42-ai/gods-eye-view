import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySoftwareRendererBudget,
  debounceResizeRendering,
  SOFTWARE_RENDERER_PATTERN,
  tilesetCacheOptions,
  isSoftwareRenderer,
  installContainerResizeGuard,
} from './viewer.js';
import {
  TILESET_CACHE_BYTES,
  TILESET_CACHE_OVERFLOW_BYTES,
  SOFTWARE_TILESET_CACHE_BYTES,
} from '../cinematic/renderBudget.js';

const fakeViewer = (renderer) => {
  const gl = {
    RENDERER: 1,
    getExtension: () => null,
    getParameter: () => renderer,
  };
  return {
    resolutionScale: 1,
    targetFrameRate: 60,
    useDefaultRenderLoop: true,
    scene: {
      msaaSamples: 4,
      canvas: { getContext: () => gl },
      requestRender() {
        this.r = (this.r || 0) + 1;
      },
    },
    isDestroyed: () => false,
  };
};

test('software WebGL (SwiftShader) gets a reduced render budget; real GPUs do not', () => {
  assert.ok(
    SOFTWARE_RENDERER_PATTERN.test(
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
    ),
  );
  const soft = fakeViewer('Google SwiftShader');
  assert.equal(applySoftwareRendererBudget(soft), true);
  assert.equal(soft.resolutionScale, 0.5);
  assert.equal(soft.scene.msaaSamples, 1);
  assert.equal(soft.targetFrameRate, 20);
  const gpu = fakeViewer('ANGLE (NVIDIA GeForce RTX 4070)');
  assert.equal(applySoftwareRendererBudget(gpu), false);
  assert.equal(gpu.resolutionScale, 1);
  assert.equal(gpu.scene.msaaSamples, 4);
});

test('tilesetCacheOptions returns software budget for software renderers and standard budget for real GPUs', () => {
  const soft = fakeViewer('Google SwiftShader');
  assert.equal(isSoftwareRenderer(soft), true);
  const softOpts = tilesetCacheOptions(soft);
  assert.equal(softOpts.cacheBytes, SOFTWARE_TILESET_CACHE_BYTES);
  assert.equal(
    softOpts.maximumCacheOverflowBytes,
    SOFTWARE_TILESET_CACHE_BYTES,
  );

  const gpu = fakeViewer('ANGLE (NVIDIA GeForce RTX 4070)');
  assert.equal(isSoftwareRenderer(gpu), false);
  const gpuOpts = tilesetCacheOptions(gpu);
  assert.equal(gpuOpts.cacheBytes, TILESET_CACHE_BYTES);
  assert.equal(gpuOpts.maximumCacheOverflowBytes, TILESET_CACHE_OVERFLOW_BYTES);

  const defOpts = tilesetCacheOptions();
  assert.equal(defOpts.cacheBytes, TILESET_CACHE_BYTES);
  assert.equal(defOpts.maximumCacheOverflowBytes, TILESET_CACHE_OVERFLOW_BYTES);
});

test('resize debounce pauses the render loop and resumes once the size settles', () => {
  const listeners = {};
  const timers = [];
  const win = {
    addEventListener: (t, f) => (listeners[t] = f),
    removeEventListener: () => {},
    setTimeout: (f) => timers.push(f),
    clearTimeout: () => {},
  };
  const v = fakeViewer('SwiftShader');
  const off = debounceResizeRendering(v, win, 10);
  listeners.resize();
  assert.equal(v.useDefaultRenderLoop, false);
  timers.at(-1)();
  assert.equal(v.useDefaultRenderLoop, true);
  assert.equal(v.scene.r, 1);
  off();
});

test('viewer ResizeObserver guard defers entity adds until nonzero size, then flushes and calls resize + requestRender', () => {
  let observedEl = null;
  let observerCallback = null;
  class FakeResizeObserver {
    constructor(cb) {
      observerCallback = cb;
    }
    observe(el) {
      observedEl = el;
    }
    disconnect() {
      observedEl = null;
    }
  }

  let resizeCount = 0;
  let renderCount = 0;
  const entitiesList = [];

  const v = {
    resize() {
      resizeCount++;
    },
    scene: {
      requestRender() {
        renderCount++;
      },
      canvas: { clientWidth: 0, clientHeight: 0 },
    },
    entities: {
      values: entitiesList,
      add(e) {
        entitiesList.push(e);
        return e;
      },
    },
    isDestroyed: () => false,
  };

  const container = { clientWidth: 0, clientHeight: 0 };
  const guard = installContainerResizeGuard(v, container, {
    ResizeObserver: FakeResizeObserver,
  });

  assert.equal(observedEl, container);
  assert.equal(guard.hasNonzeroSize(), false);

  // Adding entity to zero-size viewer must be deferred
  const ent1 = { id: 'test-entity-1' };
  v.entities.add(ent1);
  assert.equal(entitiesList.length, 0);
  assert.equal(v.entities.getPending().length, 1);
  assert.equal(v.entities.getPending()[0], ent1);

  // ResizeObserver fires with nonzero size
  container.clientWidth = 800;
  container.clientHeight = 600;
  assert.equal(guard.hasNonzeroSize(), true);

  observerCallback([{ contentRect: { width: 800, height: 600 } }]);
  assert.equal(resizeCount, 1);
  assert.equal(renderCount, 1);
  assert.equal(entitiesList.length, 1);
  assert.equal(entitiesList[0], ent1);
  assert.equal(v.entities.getPending().length, 0);

  // Further adds when nonzero size add immediately
  const ent2 = { id: 'test-entity-2' };
  v.entities.add(ent2);
  assert.equal(entitiesList.length, 2);
  assert.equal(entitiesList[1], ent2);

  guard.disconnect();
  assert.equal(observedEl, null);
});
