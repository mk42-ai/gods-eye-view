import * as Cesium from 'cesium';

export const TILESET_CACHE_BYTES = 768 * 1024 * 1024;
export const TILESET_CACHE_OVERFLOW_BYTES = 256 * 1024 * 1024;
export const SOFTWARE_TILESET_CACHE_BYTES = 256 * 1024 * 1024;

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

    const resizeGuard = installContainerResizeGuard(viewer, container);

    const originalDestroy = viewer.destroy?.bind(viewer);
    if (originalDestroy) {
      viewer.destroy = function () {
        try {
          resizeGuard.disconnect();
        } catch {}
        return originalDestroy();
      };
    }

    // Ensure imagery/terrain provider errors are logged and do not halt rendering
    try {
      const logProviderError = (provider, err) => {
        console.warn(`[Cesium ${provider} error]`, err?.message || err);
      };
      viewer.terrainProvider?.errorEvent?.addEventListener?.((err) =>
        logProviderError('terrainProvider', err),
      );
      if (viewer.baseLayer?.imageryProvider?.errorEvent?.addEventListener) {
        viewer.baseLayer.imageryProvider.errorEvent.addEventListener((err) =>
          logProviderError('imageryProvider', err),
        );
      }
      if (viewer.imageryLayers) {
        viewer.imageryLayers.layerAdded?.addEventListener?.((layer) => {
          layer?.imageryProvider?.errorEvent?.addEventListener?.((err) =>
            logProviderError('imageryProvider', err),
          );
        });
        const len = viewer.imageryLayers.length || 0;
        for (let i = 0; i < len; i++) {
          const l = viewer.imageryLayers.get
            ? viewer.imageryLayers.get(i)
            : viewer.imageryLayers[i];
          l?.imageryProvider?.errorEvent?.addEventListener?.((err) =>
            logProviderError('imageryProvider', err),
          );
        }
      }
    } catch {}

    return viewer;
  } catch (error) {
    viewer.destroy();
    throw error;
  }
}

/**
 * Install a ResizeObserver on the viewer container that calls viewer.resize()
 * + requestRender() and guards against a zero-size container (defers entity adds
 * until the canvas/container has nonzero size).
 */
export function installContainerResizeGuard(
  viewer,
  container,
  { ResizeObserver: ResizeObserverImpl = globalThis.ResizeObserver } = {},
) {
  if (!viewer) return { disconnect: () => {}, flush: () => {} };
  const containerEl =
    typeof container === 'string'
      ? globalThis.document?.getElementById?.(container)
      : container;
  const pendingEntities = [];
  const originalEntitiesAdd = viewer.entities?.add?.bind(viewer.entities);

  function hasNonzeroSize() {
    const canvas = viewer?.canvas || viewer?.scene?.canvas;
    if (
      canvas &&
      (canvas.clientWidth > 0 ||
        canvas.width > 0 ||
        canvas.clientHeight > 0 ||
        canvas.height > 0)
    ) {
      return true;
    }
    if (
      containerEl &&
      (containerEl.clientWidth > 0 ||
        containerEl.offsetWidth > 0 ||
        containerEl.clientHeight > 0 ||
        containerEl.offsetHeight > 0)
    ) {
      return true;
    }
    if (!containerEl && !canvas) return true;
    return false;
  }

  function flushPendingEntities() {
    if (!hasNonzeroSize() || !originalEntitiesAdd) return false;
    let flushed = false;
    while (pendingEntities.length > 0) {
      const ent = pendingEntities.shift();
      try {
        originalEntitiesAdd(ent);
        flushed = true;
      } catch {}
    }
    if (flushed) {
      viewer.scene?.requestRender?.();
    }
    return flushed;
  }

  if (originalEntitiesAdd) {
    viewer.entities.add = function (entity) {
      if (!hasNonzeroSize()) {
        pendingEntities.push(entity);
        return entity;
      }
      return originalEntitiesAdd(entity);
    };
    viewer.entities.getPending = function () {
      return [...pendingEntities];
    };
    viewer.entities.flushPending = flushPendingEntities;
  }

  let observer = null;
  if (containerEl && typeof ResizeObserverImpl === 'function') {
    observer = new ResizeObserverImpl((entries) => {
      for (const entry of entries) {
        const { width = 0, height = 0 } = entry.contentRect || {};
        if (width > 0 && height > 0) {
          if (!viewer.isDestroyed?.()) {
            viewer.resize?.();
            const flushed = flushPendingEntities();
            if (!flushed) {
              viewer.scene?.requestRender?.();
            }
          }
        }
      }
    });
    try {
      observer.observe(containerEl);
    } catch {}
  }

  return {
    disconnect() {
      try {
        observer?.disconnect?.();
      } catch {}
      pendingEntities.length = 0;
    },
    flush: flushPendingEntities,
    hasNonzeroSize,
  };
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
