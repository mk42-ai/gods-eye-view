/**
 * Separate scene playback from layer controls without rebuilding either UI.
 * Reparenting the original nodes preserves checked state and event listeners.
 */
const installations = new WeakMap();

export function installIncidentDiagnostics({
  document: doc = globalThis.document,
  panel,
  toggles,
  legend,
  hiddenNote,
  dataPanel,
} = {}) {
  if (!doc?.createElement || !panel) return { destroy() {} };
  if (installations.has(panel)) return installations.get(panel);

  let destroyed = false;
  const origins = [toggles, legend, hiddenNote].filter(Boolean).map((node) => {
    const parent = node.parentNode;
    const next = node.nextSibling;
    const anchor =
      parent && doc.createComment
        ? doc.createComment('incident-control-origin')
        : null;
    if (anchor) parent.insertBefore(anchor, node);
    return { node, parent, next, anchor };
  });

  const details = doc.createElement('details');
  details.className = 'incident-diagnostics';
  details.open = false;
  const summary = doc.createElement('summary');
  summary.className = 'incident-diagnostics__summary';
  summary.textContent = 'Diagnostic info';
  details.appendChild(summary);
  if (hiddenNote) {
    (hiddenNote.parentNode || panel).insertBefore(
      details,
      hiddenNote.parentNode ? hiddenNote : null,
    );
    details.appendChild(hiddenNote);
  }

  const layers = doc.createElement('section');
  layers.className = 'incident-layer-controls incident-layers-section';
  layers.setAttribute('aria-label', 'Incident layers');
  const heading = doc.createElement('h3');
  heading.className = 'incident-layer-controls__title';
  heading.textContent = 'Incident layers';
  layers.appendChild(heading);

  const mountLayers = () => {
    if (destroyed) return;
    const container =
      typeof dataPanel === 'string'
        ? doc.querySelector?.(dataPanel)
        : dataPanel?.isConnected !== false && dataPanel
          ? dataPanel
          : doc.getElementById?.('data-panel');
    const host = container?.matches?.('.data-panel-inner')
      ? container
      : container?.querySelector?.('.data-panel-inner');
    // If the rail has not mounted yet, leave all settings usable in place.
    if (!host) return;
    if (layers.parentNode !== host) host.appendChild(layers);
    for (const node of [toggles, legend]) {
      if (node && node.parentNode !== layers) layers.appendChild(node);
    }
  };
  mountLayers();
  const Observer =
    doc.defaultView?.MutationObserver || globalThis.MutationObserver;
  const observer =
    typeof Observer === 'function' ? new Observer(mountLayers) : null;
  if (doc.body || doc.documentElement) {
    observer?.observe(doc.body || doc.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  const api = {
    details,
    layers,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer?.disconnect();
      // Comment anchors restore exact sibling positions, including empty text
      // nodes. Never clone controls or replace listeners during teardown.
      for (const { node, parent, next, anchor } of origins) {
        if (anchor?.parentNode) {
          anchor.parentNode.insertBefore(node, anchor);
          anchor.remove();
        } else if (parent) {
          parent.insertBefore(node, next?.parentNode === parent ? next : null);
        } else {
          node.remove();
        }
      }
      details.remove();
      layers.remove();
      installations.delete(panel);
    },
  };
  installations.set(panel, api);
  return api;
}
