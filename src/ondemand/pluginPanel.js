/**
 * ONDEMAND PLUGIN PANEL — Honest lifecycle states & per-turn selection (Phase H).
 *
 * Renders a compact, collapsible "PLUGINS" panel showing every registered plugin:
 *   - Launcher chip with status dot and ready count
 *   - Toggleable panel drawer (hidden by default)
 *   - Single "Verify all" action and Refresh button in header
 *   - Per-row status dot (ready | unverified | checking | unavailable | error)
 *   - Checkbox toggle persisted in localStorage ('ondemand.pluginSelection')
 *   - Relative verified time for ready plugins, error message for failed plugins
 *
 * Importable under Node without DOM (guards like miniChat.js).
 */

import { Puzzle, X } from 'lucide';

export const PLUGIN_PANEL_ID = 'ondemand-plugin-panel';
export const PLUGIN_DOCK_ID = 'ondemand-plugin-dock';
export const PLUGIN_CHIP_ID = 'od-plugins-chip';
export const STORAGE_KEY = 'ondemand.pluginSelection';

/**
 * Derive display key and sentence-case label for a plugin entry's state.
 * Exactly ONE clear state per plugin.
 *
 * @param {object|null|undefined} entry
 * @returns {{ key: 'ready'|'unverified'|'checking'|'unavailable'|'error', label: string }}
 */
export function displayStateFor(entry) {
  if (!entry) {
    return { key: 'unverified', label: 'Not verified' };
  }
  const state = entry.state;
  if (state === 'ready') {
    return { key: 'ready', label: 'Ready' };
  }
  if (
    state === 'installing' ||
    state === 'authenticating' ||
    state === 'invoking'
  ) {
    return { key: 'checking', label: 'Checking…' };
  }
  if (
    entry.availability === 'inactive' ||
    (state === 'failed' && entry.error?.code === 'inactive_on_account')
  ) {
    return { key: 'unavailable', label: 'Unavailable' };
  }
  if (state === 'failed') {
    return { key: 'error', label: 'Error' };
  }
  return { key: 'unverified', label: 'Not verified' };
}

/**
 * Return display badge label for a plugin entry's state.
 * Kept for backward compatibility.
 * @param {object} entry
 * @returns {string}
 */
export function badgeTextFor(entry) {
  return displayStateFor(entry).label;
}

/**
 * Determine if selection toggle checkbox is enabled for a plugin entry.
 * Disabled while state is installing/authenticating/invoking or when failed with code inactive_on_account.
 * @param {object} entry
 * @returns {boolean}
 */
export function isToggleEnabled(entry) {
  if (!entry) return false;
  const state = entry.state || 'discovered';
  if (
    state === 'installing' ||
    state === 'authenticating' ||
    state === 'invoking'
  ) {
    return false;
  }
  if (state === 'failed' && entry.error?.code === 'inactive_on_account') {
    return false;
  }
  if (entry.availability === 'inactive') {
    return false;
  }
  return true;
}

/**
 * Read persisted plugin selection array from storage.
 * @param {Storage} storage
 * @returns {string[]}
 */
export function readSelection(storage) {
  try {
    const raw = storage?.getItem?.(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((id) => typeof id === 'string' && id.length > 0);
    }
  } catch {
    /* ignore parse/storage errors */
  }
  return [];
}

/**
 * Persist plugin selection array to storage.
 * @param {Storage} storage
 * @param {string[]|Set<string>} ids
 */
export function writeSelection(storage, ids) {
  try {
    const arr = Array.from(ids || []).filter(
      (id) => typeof id === 'string' && id.length > 0,
    );
    storage?.setItem?.(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    /* storage unavailable */
  }
}

/** Format relative time from an ISO timestamp. */
function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function el(document, tag, { id, className, text, attrs } = {}) {
  const node = document.createElement(tag);
  if (id) node.id = id;
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  }
  return node;
}

function renderIcon(document, iconNodes) {
  if (typeof document?.createElementNS !== 'function') {
    return el(document, 'span');
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  if (Array.isArray(iconNodes)) {
    for (const [tag, attrs] of iconNodes) {
      const child = document.createElementNS('http://www.w3.org/2000/svg', tag);
      if (attrs && typeof attrs === 'object') {
        for (const [k, v] of Object.entries(attrs)) {
          child.setAttribute(k, String(v));
        }
      }
      svg.appendChild(child);
    }
  }
  return svg;
}

/**
 * Create the plugin panel controller.
 *
 * @param {object} deps
 * @param {Document} [deps.document]
 * @param {Window} [deps.window]
 * @param {typeof fetch} [deps.fetch]
 * @param {string} [deps.apiBase]
 * @param {Storage} [deps.storage]
 * @param {() => string} [deps.externalUserId]
 * @param {(selectedIds: string[]) => void} [deps.onSelectionChange]
 */
export function createPluginPanel(deps = {}) {
  const document = deps.document ?? globalThis.document;
  const win = deps.window ?? globalThis.window;
  const fetchImpl = deps.fetch ?? ((...a) => globalThis.fetch(...a));
  const apiBase = deps.apiBase || '/api/ondemand/v2';
  const storage =
    deps.storage ??
    (() => {
      try {
        return win?.localStorage ?? null;
      } catch {
        return null;
      }
    })();
  const getExternalUserId =
    typeof deps.externalUserId === 'function'
      ? deps.externalUserId
      : () => 'anonymous';
  const onSelectionChange = deps.onSelectionChange || (() => {});

  let plugins = [];
  let selectedIds = new Set(readSelection(storage));
  let rootElement = null;
  let chipElement = null;
  let chipDotElement = null;
  let chipLabelElement = null;
  let listElement = null;
  let summaryCountElement = null;
  let verifyAllButton = null;
  let refreshButton = null;
  let closeButton = null;
  let destroyed = false;

  function setDockOpen(openState) {
    const dock =
      rootElement?.closest?.(`#${PLUGIN_DOCK_ID}`) ||
      (rootElement?.parentElement?.id === PLUGIN_DOCK_ID
        ? rootElement.parentElement
        : null) ||
      document?.querySelector?.(`#${PLUGIN_DOCK_ID}`);
    if (dock) {
      if (dock.dataset) {
        dock.dataset.open = openState ? 'true' : 'false';
      } else {
        dock.setAttribute?.('data-open', openState ? 'true' : 'false');
      }
    }
  }

  function open() {
    if (!rootElement || !chipElement) return;
    rootElement.hidden = false;
    chipElement.setAttribute('aria-expanded', 'true');
    setDockOpen(true);
  }

  function close() {
    if (!rootElement || !chipElement) return;
    rootElement.hidden = true;
    chipElement.setAttribute('aria-expanded', 'false');
    setDockOpen(false);
    try {
      chipElement.focus?.();
    } catch {
      /* ignore */
    }
  }

  function isOpen() {
    return rootElement ? !rootElement.hidden : false;
  }

  function renderRows() {
    if (!listElement) return;
    listElement.replaceChildren();

    const readyCount = plugins.filter(
      (p) => displayStateFor(p).key === 'ready',
    ).length;
    const totalCount = plugins.length;

    if (summaryCountElement) {
      summaryCountElement.textContent = `${readyCount} of ${totalCount} ready`;
    }

    if (chipLabelElement) {
      chipLabelElement.textContent = `Plugins · ${readyCount} ready`;
      chipElement?.setAttribute?.('aria-label', `Plugins · ${readyCount} ready — open the plugins panel`);
    }
    if (chipDotElement) {
      chipDotElement.setAttribute('data-state', readyCount > 0 ? 'ready' : 'idle');
    }

    for (const entry of plugins) {
      const pluginIdentifier = entry.pluginId || entry.name;
      const isEnabled = isToggleEnabled(entry);
      const isChecked = selectedIds.has(pluginIdentifier);

      const row = el(document, 'li', {
        className: 'od-plugin__row',
        attrs: { 'data-plugin-id': pluginIdentifier },
      });

      const main = el(document, 'div', { className: 'od-plugin__main' });

      // Checkbox toggle
      const toggle = el(document, 'input', {
        className: 'od-plugin__toggle',
        attrs: {
          type: 'checkbox',
          'data-plugin-id': pluginIdentifier,
          'aria-label': `Use ${entry.name} in answers`,
        },
      });
      toggle.checked = isChecked;
      toggle.disabled = !isEnabled;
      toggle.addEventListener('change', () => {
        if (toggle.checked) {
          selectedIds.add(pluginIdentifier);
        } else {
          selectedIds.delete(pluginIdentifier);
        }
        const updated = Array.from(selectedIds);
        writeSelection(storage, updated);
        onSelectionChange(updated);
      });
      main.appendChild(toggle);

      // Status dot (placed before the name)
      const display = displayStateFor(entry);
      const dot = el(document, 'span', {
        className: 'od-plugin__dot',
        attrs: {
          'data-state': display.key,
          role: 'img',
          'aria-label': display.label,
          title: display.label,
        },
      });
      main.appendChild(dot);

      // Name & Provider
      const metaWrap = el(document, 'div', {
        className: 'od-plugin__meta-wrap',
      });
      const nameEl = el(document, 'span', {
        className: 'od-plugin__name',
        text: entry.name,
      });
      const providerEl = el(document, 'span', {
        className: 'od-plugin__provider',
        text: entry.provider || entry.kind || '',
      });
      metaWrap.append(nameEl, providerEl);
      main.appendChild(metaWrap);

      row.appendChild(main);

      // Sub-row: Error message for failed entries, relative timing for ready entries
      if (entry.state === 'failed' && entry.error?.message) {
        const sub = el(document, 'div', { className: 'od-plugin__sub' });
        const errEl = el(document, 'span', {
          className: 'od-plugin__error',
          text: entry.error.message,
        });
        sub.appendChild(errEl);
        row.appendChild(sub);
      } else if (entry.state === 'ready' && entry.verifiedAt) {
        const sub = el(document, 'div', { className: 'od-plugin__sub' });
        const timeEl = el(document, 'span', {
          className: 'od-plugin__timing',
          text: formatRelativeTime(entry.verifiedAt),
        });
        sub.appendChild(timeEl);
        row.appendChild(sub);
      }

      listElement.appendChild(row);
    }
  }

  async function verifyAll() {
    if (verifyAllButton) {
      verifyAllButton.disabled = true;
      verifyAllButton.textContent = 'Checking…';
    }

    const eligible = plugins.filter(
      (entry) =>
        entry.kind !== 'ondemand-tool' &&
        displayStateFor(entry).key !== 'unavailable',
    );
    const names = eligible.map((entry) => entry.name).filter(Boolean);

    try {
      const res = await fetchImpl(`${apiBase}/plugins/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Workstation-User': getExternalUserId(),
        },
        body: JSON.stringify({
          externalUserId: getExternalUserId(),
          names,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const updatedList = Array.isArray(data?.plugins)
          ? data.plugins
          : Array.isArray(data)
            ? data
            : [];
        for (const updated of updatedList) {
          const idx = plugins.findIndex(
            (p) =>
              (updated.pluginId && p.pluginId === updated.pluginId) ||
              (updated.name && p.name === updated.name),
          );
          if (idx !== -1) {
            plugins[idx] = updated;
          }
        }
      }
    } catch {
      /* verify failed */
    } finally {
      if (verifyAllButton) {
        verifyAllButton.disabled = false;
        verifyAllButton.textContent = 'Verify all';
      }
      renderRows();
    }
  }

  function build() {
    if (rootElement || !document) return;

    // 1. Launcher chip button
    chipElement = el(document, 'button', {
      id: PLUGIN_CHIP_ID,
      className: 'od-plugins-chip',
      attrs: {
        type: 'button',
        'aria-expanded': 'false',
        'aria-controls': PLUGIN_PANEL_ID,
        'aria-label': 'Plugins · 0 ready — open the plugins panel',
        title: 'Open the OnDemand plugins panel',
      },
    });
    const chipIconElement = renderIcon(document, Puzzle);
    chipIconElement.setAttribute?.('class', 'od-icon od-icon--puzzle od-plugins-chip__icon');

    chipDotElement = el(document, 'span', {
      className: 'od-plugins-chip__dot',
      attrs: {
        'data-state': 'idle',
      },
    });

    chipLabelElement = el(document, 'span', {
      className: 'od-plugins-chip__label',
      text: 'Plugins · 0 ready',
    });

    chipElement.append(chipIconElement, chipDotElement, chipLabelElement);
    chipElement.addEventListener('click', () => {
      if (isOpen()) {
        close();
      } else {
        open();
      }
    });

    // 2. Panel section (closed/hidden by default)
    rootElement = el(document, 'section', {
      id: PLUGIN_PANEL_ID,
      className: 'od-plugins',
    });
    rootElement.hidden = true;

    rootElement.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27) {
        e.stopPropagation?.();
        close();
      }
    });

    // Panel header
    const header = el(document, 'div', { className: 'od-plugins__header' });

    const headerLeft = el(document, 'div', { className: 'od-plugins__header-left' });
    const headerTitle = el(document, 'span', {
      className: 'od-plugins__title',
      text: 'Plugins',
    });
    summaryCountElement = el(document, 'span', {
      className: 'od-plugins__summary-count',
      text: '0 of 0 ready',
      attrs: { 'aria-live': 'polite' },
    });
    headerLeft.append(headerTitle, summaryCountElement);

    const headerActions = el(document, 'div', {
      className: 'od-plugins__header-actions',
    });

    verifyAllButton = el(document, 'button', {
      className: 'od-plugins__verify-all',
      text: 'Verify all',
      attrs: { type: 'button' },
    });
    verifyAllButton.addEventListener('click', () => verifyAll());

    refreshButton = el(document, 'button', {
      className: 'od-plugins__refresh-btn',
      text: 'Refresh',
      attrs: { type: 'button' },
    });
    refreshButton.addEventListener('click', () => refresh());

    closeButton = el(document, 'button', {
      className: 'od-plugins__close',
      attrs: {
        type: 'button',
        'aria-label': 'Close plugins',
        title: 'Close plugins',
      },
    });
    const xIcon = renderIcon(document, X);
    xIcon.setAttribute?.('class', 'od-icon od-icon--x');
    closeButton.appendChild(xIcon);
    closeButton.addEventListener('click', () => close());

    headerActions.append(verifyAllButton, refreshButton, closeButton);
    header.append(headerLeft, headerActions);
    rootElement.appendChild(header);

    // Panel list
    listElement = el(document, 'ul', { className: 'od-plugins__list' });
    rootElement.appendChild(listElement);
  }

  async function refresh() {
    if (refreshButton) refreshButton.disabled = true;
    try {
      const res = await fetchImpl(`${apiBase}/plugins`, {
        method: 'GET',
        headers: {
          'X-Workstation-User': getExternalUserId(),
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.plugins)) {
          plugins = data.plugins;
        } else if (Array.isArray(data)) {
          plugins = data;
        }
      }
    } catch {
      /* fetch failed */
    } finally {
      if (refreshButton) refreshButton.disabled = false;
      renderRows();
    }
  }

  function mount(container) {
    if (!document) return null;
    build();
    if (container) {
      if (chipElement) {
        if (container.firstChild) {
          container.insertBefore(chipElement, container.firstChild);
        } else {
          container.appendChild(chipElement);
        }
      }
      if (rootElement) {
        if (chipElement && chipElement.nextSibling) {
          container.insertBefore(rootElement, chipElement.nextSibling);
        } else {
          container.appendChild(rootElement);
        }
      }
      setDockOpen(false);
      refresh();
    }
    return rootElement;
  }

  function destroy() {
    destroyed = true;
    if (typeof chipElement?.parentNode?.removeChild === 'function') {
      chipElement.parentNode.removeChild(chipElement);
    } else if (typeof chipElement?.remove === 'function') {
      chipElement.remove();
    }
    if (typeof rootElement?.parentNode?.removeChild === 'function') {
      rootElement.parentNode.removeChild(rootElement);
    } else if (typeof rootElement?.remove === 'function') {
      rootElement.remove();
    }
    rootElement = null;
    chipElement = null;
    chipDotElement = null;
    chipLabelElement = null;
    listElement = null;
  }

  function getSelectedPluginIds() {
    return Array.from(selectedIds);
  }

  return {
    mount,
    refresh,
    destroy,
    open,
    close,
    isOpen,
    getSelectedPluginIds,
    getElement: () => rootElement,
    getChipElement: () => chipElement,
    _getPlugins: () => plugins,
  };
}

/**
 * Install the plugin panel into the DOM.
 * Mounts chip as first child and panel section after it into #ondemand-plugin-dock
 * (or into mini-chat slot if #ondemand-mini-chat exists).
 * Exposes window.__odPlugins debug handle.
 *
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {Document} [options.document]
 * @param {Window} [options.window]
 * @param {typeof fetch} [options.fetch]
 * @param {Storage} [options.storage]
 * @param {string} [options.apiBase]
 * @param {() => string} [options.externalUserId]
 * @param {(selectedIds: string[]) => void} [options.onSelectionChange]
 */
export function installPluginPanel(options = {}) {
  const doc = options.document ?? globalThis.document;
  const win = options.window ?? globalThis.window;
  if (!doc) return null;

  const panel = createPluginPanel({
    document: doc,
    window: win,
    fetch: options.fetch,
    storage: options.storage,
    apiBase: options.apiBase,
    externalUserId: options.externalUserId,
    onSelectionChange: options.onSelectionChange,
  });

  // Determine mount container
  const miniChat = doc.querySelector?.('#ondemand-mini-chat');
  let container = null;
  if (miniChat) {
    // Mount into or beside mini-chat header area
    const header = miniChat.querySelector?.('.od-chat__header');
    if (header) {
      container = doc.createElement('div');
      container.className = 'od-chat__plugin-slot';
      header.parentNode.insertBefore(container, header.nextSibling);
    } else {
      container = miniChat;
    }
  } else {
    // Floating dock container
    let dock = doc.querySelector?.(`#${PLUGIN_DOCK_ID}`);
    if (!dock) {
      dock = doc.createElement('div');
      dock.id = PLUGIN_DOCK_ID;
      (doc.body || doc.documentElement)?.appendChild?.(dock);
    }
    container = dock;
  }

  panel.mount(container);

  // Set window.__odPlugins debug handle
  const teardown = () => {
    panel.destroy();
    if (win?.__odPlugins?.panel === panel) {
      delete win.__odPlugins;
    }
  };

  if (win) {
    win.__odPlugins = {
      getSelectedPluginIds: () => panel.getSelectedPluginIds(),
      refresh: () => panel.refresh(),
      destroy: () => teardown(),
      open: () => panel.open(),
      close: () => panel.close(),
      isOpen: () => panel.isOpen(),
      panel,
    };
  }

  if (options.signal?.aborted) {
    teardown();
  } else {
    options.signal?.addEventListener?.('abort', teardown, { once: true });
  }

  return panel;
}
