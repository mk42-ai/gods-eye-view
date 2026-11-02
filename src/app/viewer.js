import * as Cesium from 'cesium';
import {
  TILESET_CACHE_BYTES,
  TILESET_CACHE_OVERFLOW_BYTES,
  SOFTWARE_TILESET_CACHE_BYTES,
} from '../cinematic/renderBudget.js';

/** Create the standard globe viewer in caller-owned, visible containers. */
export function createApplicationViewer({ container, creditContainer }) {
  if (!container || !creditContainer)
    throw new TypeError('Viewer and credit containers are required');
  const viewer = new Cesium.Viewer(container, {
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    vrButton: false,
    selectionIndicator: false,
    infoBox: false,
    baseLayer: false,
    creditContainer,
    msaaSamples: 4,
    showRenderLoopErrors: false,
    contextOptions: { webgl: { preserveDrawingBuffer: true } },
  });
  try {
    viewer.targetFrameRate = 60;
    applySoftwareRendererBudget(viewer);
    viewer.scene.globe.show = false;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
    viewer.scene.skyAtmosphere.saturationShift = -0.12;
    viewer.scene.skyAtmosphere.brightnessShift = -0.08;
    return viewer;
  } catch (error) {
    viewer.destroy();
    throw error;
  }
}

/** Renderer strings of CPU-emulated WebGL (no GPU): SwiftShader, llvmpipe, WARP. */
export const SOFTWARE_RENDERER_PATTERN =
  /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

/** Detect if viewer is running on CPU-emulated WebGL (SwiftShader, llvmpipe, etc.) */
export function isSoftwareRenderer(viewer) {
  try {
    if (viewer?._isSoftwareRenderer) return true;
    const canvas = viewer?.scene?.canvas || viewer?.canvas;
    const gl = canvas?.getContext?.('webgl2') || canvas?.getContext?.('webgl');
    const ext = gl?.getExtension?.('WEBGL_debug_renderer_info');
    const renderer = String(
      (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) ||
        gl?.getParameter?.(gl.RENDERER) ||
        '',
    );
    if (SOFTWARE_RENDERER_PATTERN.test(renderer)) return true;
    if (
      globalThis.document?.documentElement?.getAttribute?.(
        'data-software-renderer',
      ) === 'true'
    )
      return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Returns tileset cache options sized appropriately for the current GPU/renderer.
 * Software renderers receive SOFTWARE_TILESET_CACHE_BYTES (256 MB), while standard GPUs
 * receive TILESET_CACHE_BYTES (768 MB) and TILESET_CACHE_OVERFLOW_BYTES (256 MB).
 *
 * @param {object} [viewer]
 * @returns {{cacheBytes: number, maximumCacheOverflowBytes: number}}
 */
export function tilesetCacheOptions(viewer) {
  if (isSoftwareRenderer(viewer)) {
    return {
      cacheBytes: SOFTWARE_TILESET_CACHE_BYTES,
      maximumCacheOverflowBytes: SOFTWARE_TILESET_CACHE_BYTES,
    };
  }
  return {
    cacheBytes: TILESET_CACHE_BYTES,
    maximumCacheOverflowBytes: TILESET_CACHE_OVERFLOW_BYTES,
  };
}

/**
 * On a CPU-emulated WebGL context every 4x-MSAA full-resolution frame can
 * block the main thread for hundreds of milliseconds, starving input and
 * automation (headless validators time out). Keep the UI responsive there:
 * half resolution, no MSAA, a 20 fps cap. Real GPUs are untouched.
 * @returns {boolean} whether the reduced budget was applied.
 */
export function applySoftwareRendererBudget(viewer) {
  try {
    const canvas = viewer?.scene?.canvas || viewer?.canvas;
    const gl = canvas?.getContext?.('webgl2') || canvas?.getContext?.('webgl');
    const ext = gl?.getExtension?.('WEBGL_debug_renderer_info');
    const renderer = String(
      (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) ||
        gl?.getParameter?.(gl.RENDERER) ||
        '',
    );
    if (!SOFTWARE_RENDERER_PATTERN.test(renderer)) return false;
    viewer._isSoftwareRenderer = true;
    viewer.resolutionScale = 0.5;
    if ('msaaSamples' in viewer.scene) viewer.scene.msaaSamples = 1;
    viewer.targetFrameRate = 20;
    globalThis.document?.documentElement?.setAttribute?.(
      'data-software-renderer',
      'true',
    );
    debounceResizeRendering(viewer, globalThis.window);
    return true;
  } catch {
    return false;
  }
}

/**
 * Software renderers only: a viewport change (window drag, device rotation,
 * DevTools emulation) normally re-renders on the very next frame and starts a
 * new imagery/terrain tile storm for every intermediate size. Hold the render
 * loop until the size has been stable for `settleMs`, then render once.
 */
export function debounceResizeRendering(viewer, win, settleMs = 900) {
  if (!viewer || !win?.addEventListener) return () => {};
  let timer = null;
  const onResize = () => {
    if (viewer.isDestroyed?.()) return;
    viewer.useDefaultRenderLoop = false;
    win.clearTimeout(timer);
    timer = win.setTimeout(() => {
      if (viewer.isDestroyed?.()) return;
      if (!globalThis.document?.hidden) viewer.useDefaultRenderLoop = true;
      viewer.scene?.requestRender?.();
    }, settleMs);
  };
  win.addEventListener('resize', onResize);
  return () => {
    win.removeEventListener('resize', onResize);
    win.clearTimeout(timer);
  };
}
