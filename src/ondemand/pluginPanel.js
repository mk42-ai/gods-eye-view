/**
 * ONDEMAND PLUGIN PANEL — Honest lifecycle states & per-turn selection (Phase H).
 *
 * Renders a compact, collapsible "PLUGINS" panel showing every registered plugin:
 *   - Name and provider
 *   - Honest lifecycle state badge: DISCOVERED | INSTALLING | AUTHENTICATING | READY | INVOKING | FAILED
 *   - Per-turn toggle checkbox persisted in localStorage ('ondemand.pluginSelection')
 *   - VERIFY button triggering real server verification without optimistic states
 *   - Error message details for failed plugins and latency/timestamp for ready plugins
 *
 * Importable under Node without DOM (guards like miniChat.js).
 */

export const PLUGIN_PANEL_ID = 'ondemand-plugin-panel';
export const PLUGIN_DOCK_ID = 'ondemand-plugin-dock';
export const STORAGE_KEY = 'ondemand.pluginSelection';

/**
 * Return uppercase badge text for a plugin entry's state.
 * @param {object} entry
 * @returns {string}
 */
export function badgeTextFor(entry) {
  const state = entry?.state || 'discovered';
  return String(state).toUpperCase();
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
  let listElement = null;
  let summaryCountElement = null;
  let refreshButton = null;
  let destroyed = false;

  function renderRows() {
    if (!listElement) return;
    listElement.replaceChildren();

    const readyCount = plugins.filter((p) => p.state === 'ready').length;
    if (summaryCountElement) {
      summaryCountElement.textContent = `${readyCount} ready`;
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

      // Actions: state badge + VERIFY button
      const actions = el(document, 'div', { className: 'od-plugin__actions' });
      const stateEl = el(document, 'span', {
        className: 'od-plugin__state',
        text: badgeTextFor(entry),
        attrs: { 'data-state': entry.state || 'discovered' },
      });
      actions.appendChild(stateEl);

      // Only show verify button for plugin-kind (not tool routes)
      if (entry.kind !== 'ondemand-tool') {
        const verifyBtn = el(document, 'button', {
          className: 'od-plugin__verify',
          text: 'VERIFY',
          attrs: {
            type: 'button',
            'data-plugin-name': entry.name,
          },
        });

        verifyBtn.addEventListener('click', async () => {
          verifyBtn.disabled = true;
          verifyBtn.textContent = 'VERIFYING…';
          try {
            const res = await fetchImpl(`${apiBase}/plugins/verify`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Workstation-User': getExternalUserId(),
              },
              body: JSON.stringify({
                externalUserId: getExternalUserId(),
                names: [entry.name],
              }),
            });
            if (res.ok) {
              const data = await res.json();
              const updatedList = Array.isArray(data?.plugins)
                ? data.plugins
                : Array.isArray(data)
                  ? data
                  : [];
              const updated = updatedList.find(
                (p) => p.name === entry.name || p.pluginId === entry.pluginId,
              );
              if (updated) {
                const idx = plugins.findIndex((p) => p.name === entry.name);
                if (idx !== -1) {
                  plugins[idx] = updated;
                }
              }
            }
          } catch {
            /* verify failed */
          } finally {
            renderRows();
          }
        });
        actions.appendChild(verifyBtn);
      }

      main.appendChild(actions);
      row.appendChild(main);

      // Sub-row: Error message or timing/preview
      if (entry.state === 'failed' && entry.error?.message) {
        const sub = el(document, 'div', { className: 'od-plugin__sub' });
        const errEl = el(document, 'span', {
          className: 'od-plugin__error',
          text: entry.error.message,
        });
        sub.appendChild(errEl);
        row.appendChild(sub);
      } else if (entry.state === 'ready') {
        const sub = el(document, 'div', { className: 'od-plugin__sub' });
        if (entry.verifiedAt) {
          const timeEl = el(document, 'span', {
            className: 'od-plugin__timing',
            text: formatRelativeTime(entry.verifiedAt),
          });
          sub.appendChild(timeEl);
        }
        if (entry.latencyMs != null) {
          const latEl = el(document, 'span', {
            className: 'od-plugin__latency',
            text: `${entry.latencyMs}ms`,
          });
          sub.appendChild(latEl);
        }
        if (entry.answerPreview) {
          const prevEl = el(document, 'span', {
            className: 'od-plugin__preview',
            text: `"${entry.answerPreview}"`,
            attrs: { title: entry.answerPreview },
          });
          sub.appendChild(prevEl);
        }
        row.appendChild(sub);
      } else if (entry.verification) {
        const sub = el(document, 'div', { className: 'od-plugin__sub' });
        const noteEl = el(document, 'span', {
          className: 'od-plugin__timing',
          text: entry.verification,
        });
        sub.appendChild(noteEl);
        row.appendChild(sub);
      }

      listElement.appendChild(row);
    }
  }

  function build() {
    if (rootElement || !document) return;

    rootElement = el(document, 'section', {
      id: PLUGIN_PANEL_ID,
      className: 'od-plugins',
    });

    const details = el(document, 'details', {
      className: 'od-plugins__details',
      attrs: { open: 'true' },
    });

    const summary = el(document, 'summary', {
      className: 'od-plugins__summary',
      text: 'PLUGINS',
    });

    summaryCountElement = el(document, 'span', {
      className: 'od-plugins__summary-count',
      text: '0 ready',
    });
    summary.appendChild(summaryCountElement);
    details.appendChild(summary);

    const header = el(document, 'div', { className: 'od-plugins__header' });
    const headerTitle = el(document, 'span', { text: 'CAPABILITIES' });
    refreshButton = el(document, 'button', {
      className: 'od-plugins__refresh-btn',
      text: 'REFRESH',
      attrs: { type: 'button' },
    });
    refreshButton.addEventListener('click', () => refresh());
    header.append(headerTitle, refreshButton);
    details.appendChild(header);

    listElement = el(document, 'ul', { className: 'od-plugins__list' });
    details.appendChild(listElement);

    rootElement.appendChild(details);
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
    if (container && rootElement) {
      container.appendChild(rootElement);
      refresh();
    }
    return rootElement;
  }

  function destroy() {
    destroyed = true;
    if (typeof rootElement?.parentNode?.removeChild === 'function') {
      rootElement.parentNode.removeChild(rootElement);
    } else if (typeof rootElement?.remove === 'function') {
      rootElement.remove();
    }
    rootElement = null;
    listElement = null;
  }

  function getSelectedPluginIds() {
    return Array.from(selectedIds);
  }

  return {
    mount,
    refresh,
    destroy,
    getSelectedPluginIds,
    getElement: () => rootElement,
    _getPlugins: () => plugins,
  };
}

/**
 * Install the plugin panel into the DOM.
 * Mounts into #ondemand-mini-chat header area if present,
 * else into floating container #ondemand-plugin-dock.
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
