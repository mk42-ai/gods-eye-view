/**
 * Intercepts Cesium render crashes (RangeError: Array buffer allocation failed,
 * out-of-memory, context loss), reduces render budgets, and auto-recovers the
 * render loop without showing blocking error modals.
 */

import { SOFTWARE_TILESET_CACHE_BYTES } from '../cinematic/renderBudget.js';

export function installRenderGuard(
  viewer,
  {
    window: win = globalThis.window,
    document: doc = globalThis.document,
    onRecover,
    maxRecoveries = 3,
    log = console.warn,
  } = {},
) {
  if (!viewer) return { uninstall: () => {} };

  const statsData = {
    renderErrors: 0,
    contextLost: 0,
    contextRestored: 0,
    recoveries: 0,
    lastError: null,
    lastErrorAt: null,
  };

  let recentErrors = [];
  let hideTimer = null;

  // Defensive removal of Cesium's blocking error panel modal
  function removeErrorPanel() {
    try {
      const container = viewer?.container;
      const panel =
        container?.querySelector?.('.cesium-widget-errorPanel') ||
        doc?.querySelector?.('.cesium-widget-errorPanel');
      if (panel) panel.remove?.();
    } catch {}
  }

  let observer = null;
  const container = viewer?.container;
  if (container && typeof win?.MutationObserver === 'function') {
    try {
      observer = new win.MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes || []) {
            if (node?.classList?.contains?.('cesium-widget-errorPanel')) {
              node.remove?.();
            } else if (node?.querySelector) {
              const p = node.querySelector('.cesium-widget-errorPanel');
              if (p) p.remove?.();
            }
          }
        }
      });
      observer.observe(container, { childList: true, subtree: true });
    } catch {}
  }

  // Ensure non-blocking toast element exists
  let toast = doc?.getElementById?.('gev-render-toast');
  if (!toast && doc?.createElement && doc?.body?.appendChild) {
    toast = doc.createElement('div');
    toast.id = 'gev-render-toast';
    toast.setAttribute('role', 'status');
    toast.hidden = true;
    doc.body.appendChild(toast);
  }

  function showToastMessage(message, autoHide = true) {
    if (!toast) return;
    if (hideTimer) {
      if (win?.clearTimeout) win.clearTimeout(hideTimer);
      hideTimer = null;
    }
    toast.textContent = message;
    toast.hidden = false;

    if (autoHide) {
      const timerFn = win?.setTimeout || setTimeout;
      hideTimer = timerFn(() => {
        if (toast) toast.hidden = true;
        hideTimer = null;
      }, 8000);
    }
  }

  function showPersistentToast() {
    if (!toast) return;
    if (hideTimer) {
      if (win?.clearTimeout) win.clearTimeout(hideTimer);
      hideTimer = null;
    }
    while (toast.firstChild) {
      toast.removeChild(toast.firstChild);
    }
    const span = doc.createElement
      ? doc.createElement('span')
      : { textContent: '' };
    span.textContent = 'Renderer stopped after repeated errors. ';
    const reloadBtn = doc.createElement
      ? doc.createElement('button')
      : { textContent: '', addEventListener: () => {} };
    reloadBtn.textContent = 'Reload';
    reloadBtn.className = 'gev-render-toast-reload';
    reloadBtn.addEventListener?.('click', () => {
      win?.location?.reload?.();
    });
    if (toast.appendChild) {
      toast.appendChild(span);
      toast.appendChild(reloadBtn);
    } else {
      toast.textContent = 'Renderer stopped after repeated errors.';
    }
    toast.hidden = false;
  }

  function reduceBudget() {
    if (!viewer || viewer.isDestroyed?.()) return;

    // 1. Lower resolutionScale to 0.75 then 0.5
    const curScale = viewer.resolutionScale ?? 1.0;
    if (curScale > 0.75) {
      viewer.resolutionScale = 0.75;
    } else if (curScale > 0.5) {
      viewer.resolutionScale = 0.5;
    }

    // 2. Disable MSAA
    if (viewer.scene && 'msaaSamples' in viewer.scene) {
      viewer.scene.msaaSamples = 1;
    }

    // 3. Drop tileset cacheBytes to SOFTWARE_TILESET_CACHE_BYTES
    const primitives = viewer.scene?.primitives;
    if (primitives) {
      const len = primitives.length ?? 0;
      for (let i = 0; i < len; i++) {
        const p = primitives.get ? primitives.get(i) : primitives[i];
        if (p && typeof p.cacheBytes !== 'undefined') {
          p.cacheBytes = SOFTWARE_TILESET_CACHE_BYTES;
          p.maximumCacheOverflowBytes = SOFTWARE_TILESET_CACHE_BYTES;
          if (typeof p.trimLoadedTiles === 'function') {
            p.trimLoadedTiles();
          }
        }
      }
    }
  }

  function scheduleRestart() {
    const raf = win?.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
    raf(() => {
      if (viewer && !viewer.isDestroyed?.()) {
        viewer.useDefaultRenderLoop = true;
        viewer.scene?.requestRender?.();
      }
    });
  }

  function dispatchRecovered(reason, attempt) {
    if (win?.dispatchEvent && typeof win.CustomEvent === 'function') {
      try {
        win.dispatchEvent(
          new win.CustomEvent('gev:render-recovered', {
            detail: { reason, attempt },
          }),
        );
      } catch {}
    }
  }

  function recover(reason = 'manual') {
    statsData.recoveries++;
    reduceBudget();
    scheduleRestart();
    onRecover?.(reason);
    dispatchRecovered(reason, statsData.recoveries);
  }

  function onRenderError(scene, err) {
    removeErrorPanel();

    statsData.renderErrors++;
    statsData.lastError = err?.message || String(err || 'Render error');
    statsData.lastErrorAt = Date.now();

    const now = Date.now();
    recentErrors.push(now);
    recentErrors = recentErrors.filter((t) => now - t <= 60000);

    if (recentErrors.length > maxRecoveries) {
      log?.(
        `[renderGuard] Max recoveries (${maxRecoveries}) exceeded within 60s; halting loop.`,
      );
      showPersistentToast();
      return;
    }

    statsData.recoveries++;
    reduceBudget();

    showToastMessage(
      `Renderer recovered after an out-of-memory error (attempt ${statsData.recoveries}/${maxRecoveries})`,
      true,
    );

    scheduleRestart();
    onRecover?.('render-error');
    dispatchRecovered('render-error', statsData.recoveries);
  }

  let removeRenderErrorListener = null;
  if (viewer.scene?.renderError?.addEventListener) {
    removeRenderErrorListener =
      viewer.scene.renderError.addEventListener(onRenderError);
  }

  function onContextLost(event) {
    event?.preventDefault?.();
    statsData.contextLost++;
    log?.('[renderGuard] webglcontextlost intercepted');
  }

  function onContextRestored() {
    statsData.contextRestored++;
    statsData.recoveries++;
    reduceBudget();
    scheduleRestart();
    onRecover?.('context-restored');
    dispatchRecovered('context-restored', statsData.recoveries);
    showToastMessage(
      `Renderer recovered after context restoration (attempt ${statsData.recoveries}/${maxRecoveries})`,
      true,
    );
    log?.('[renderGuard] webglcontextrestored handled');
  }

  const canvas = viewer?.scene?.canvas || viewer?.canvas;
  if (canvas?.addEventListener) {
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
  }

  function stats() {
    return { ...statsData };
  }

  function budget() {
    if (!viewer || viewer.isDestroyed?.()) {
      return {
        entities: 0,
        billboards: 0,
        labels: 0,
        primitives: 0,
        polylines: 0,
        tilesetCacheMb: 0,
      };
    }

    let totalEntities = 0;
    let totalBillboards = 0;
    let totalLabels = 0;
    let totalPolylines = 0;

    function countEntityCollection(collection) {
      if (!collection) return;
      const values = collection.values || [];
      for (const ent of values) {
        totalEntities++;
        if (ent.billboard) totalBillboards++;
        if (ent.label) totalLabels++;
        if (ent.polyline) totalPolylines++;
      }
    }

    countEntityCollection(viewer.entities);

    const dataSources = viewer.dataSources;
    if (dataSources) {
      const dsLen = dataSources.length ?? 0;
      for (let i = 0; i < dsLen; i++) {
        const ds = dataSources.get ? dataSources.get(i) : dataSources[i];
        if (ds?.entities) {
          countEntityCollection(ds.entities);
        }
      }
    }

    const primitives = viewer.scene?.primitives;
    const primCount = primitives?.length ?? 0;
    let tilesetCacheMb = 0;

    if (primitives) {
      for (let i = 0; i < primCount; i++) {
        const p = primitives.get ? primitives.get(i) : primitives[i];
        if (!p) continue;
        const memBytes =
          p.totalMemoryUsageInBytes ??
          p.statistics?.totalMemoryUsageInBytes ??
          p.statistics?.geometryByteLength;
        if (typeof memBytes === 'number' && memBytes > 0) {
          tilesetCacheMb = Math.round(memBytes / (1024 * 1024));
        }
      }
    }

    return {
      entities: totalEntities,
      billboards: totalBillboards,
      labels: totalLabels,
      primitives: primCount,
      polylines: totalPolylines,
      tilesetCacheMb,
    };
  }

  const guardApi = {
    stats,
    budget,
    reduceBudget,
    recover,
  };

  if (win) {
    win.__gevRender = guardApi;
  }

  return {
    uninstall() {
      if (typeof removeRenderErrorListener === 'function') {
        removeRenderErrorListener();
      } else if (viewer.scene?.renderError?.removeEventListener) {
        viewer.scene.renderError.removeEventListener(onRenderError);
      }
      if (canvas?.removeEventListener) {
        canvas.removeEventListener('webglcontextlost', onContextLost);
        canvas.removeEventListener('webglcontextrestored', onContextRestored);
      }
      if (hideTimer && win?.clearTimeout) {
        win.clearTimeout(hideTimer);
      }
      observer?.disconnect?.();
      toast?.remove?.();
      if (win?.__gevRender?.recover === recover) {
        delete win.__gevRender;
      }
    },
  };
}
