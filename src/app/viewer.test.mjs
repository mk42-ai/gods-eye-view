import test from 'node:test';
import assert from 'node:assert/strict';
import { applySoftwareRendererBudget, debounceResizeRendering, SOFTWARE_RENDERER_PATTERN } from './viewer.js';

const fakeViewer = (renderer) => {
  const gl = { RENDERER: 1, getExtension: () => null, getParameter: () => renderer };
  return { resolutionScale: 1, targetFrameRate: 60, useDefaultRenderLoop: true, scene: { msaaSamples: 4, canvas: { getContext: () => gl }, requestRender() { this.r = (this.r || 0) + 1; } }, isDestroyed: () => false };
};

test('software WebGL (SwiftShader) gets a reduced render budget; real GPUs do not', () => {
  assert.ok(SOFTWARE_RENDERER_PATTERN.test('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'));
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

test('resize debounce pauses the render loop and resumes once the size settles', () => {
  const listeners = {};
  const timers = [];
  const win = { addEventListener: (t, f) => (listeners[t] = f), removeEventListener: () => {}, setTimeout: (f) => timers.push(f), clearTimeout: () => {} };
  const v = fakeViewer('SwiftShader');
  const off = debounceResizeRendering(v, win, 10);
  listeners.resize();
  assert.equal(v.useDefaultRenderLoop, false);
  timers.at(-1)();
  assert.equal(v.useDefaultRenderLoop, true);
  assert.equal(v.scene.r, 1);
  off();
});
