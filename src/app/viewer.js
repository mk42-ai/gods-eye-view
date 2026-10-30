import * as Cesium from 'cesium';

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
export const SOFTWARE_RENDERER_PATTERN = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

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
      (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl?.getParameter?.(gl.RENDERER) || '',
    );
    if (!SOFTWARE_RENDERER_PATTERN.test(renderer)) return false;
    viewer.resolutionScale = 0.5;
    if ('msaaSamples' in viewer.scene) viewer.scene.msaaSamples = 1;
    viewer.targetFrameRate = 20;
    globalThis.document?.documentElement?.setAttribute?.('data-software-renderer', 'true');
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
