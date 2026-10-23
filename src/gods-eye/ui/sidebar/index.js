/**
 * Gods-Eye sources sidebar component.
 * @module ui/sidebar/index
 */

const ORDERED_PLATFORMS = [
  'tiktok',
  'instagram',
  'youtube',
  'x',
  'reddit',
  'web',
  'route-agent',
];

const PLATFORM_NAMES = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
  x: 'X',
  reddit: 'Reddit',
  web: 'Web',
  'route-agent': 'Route Agent',
};

const STATUS_TEXT = {
  ok: 'OK',
  quota: 'QUOTA',
  inactive: 'INACTIVE',
  error: 'ERROR',
  idle: 'IDLE',
  pending: 'PENDING',
};

function readStorage(storage) {
  try {
    const raw = storage?.getItem?.('godsEye.sources');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStorage(storage, data) {
  try {
    storage?.setItem?.('godsEye.sources', JSON.stringify(data));
  } catch {}
}

/**
 * Install the sources sidebar into the host container.
 *
 * @param {object} params
 * @returns {{element: HTMLElement, destroy: () => void, setRouteAgent: (ra: object) => void, setOpen: (b: boolean) => void, update: () => void, getEnabled: () => Record<string, boolean>}}
 */
export function installSourcesSidebar({
  document = globalThis.document,
  window = globalThis.window,
  store,
  host,
  routeAgent = { status: 'idle', latencyMs: null },
  onToggle,
  storage,
} = {}) {
  const doc = document;
  const win = window;
  const targetHost = host || doc.body;

  let currentRouteAgent = { ...routeAgent };
  let isOpen = false;
  let unsub = null;

  const savedEnabled = readStorage(storage);
  const enabledMap = {};
  for (const p of ORDERED_PLATFORMS) {
    enabledMap[p] = p === 'route-agent' ? false : (savedEnabled[p] ?? true);
  }

  const root = doc.createElement('aside');
  root.id = 'ge-sources';
  root.className = 'ge-sources';

  const toggleBtn = doc.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.id = 'ge-sources-toggle';
  toggleBtn.className = 'ge-sources-toggle';
  toggleBtn.textContent = 'SOURCES';
  toggleBtn.setAttribute('aria-expanded', 'false');
  toggleBtn.addEventListener('click', () => setOpen(!isOpen));
  root.appendChild(toggleBtn);

  const panel = doc.createElement('section');
  panel.id = 'ge-sources-panel';
  panel.className = 'ge-sources-panel';
  panel.hidden = true;

  const header = doc.createElement('header');
  header.className = 'ge-sources-header';
  const title = doc.createElement('h2');
  title.className = 'ge-sources-title';
  title.textContent = 'SOURCES';
  header.appendChild(title);
  panel.appendChild(header);

  const list = doc.createElement('ul');
  list.className = 'ge-sources-list';
  panel.appendChild(list);
  root.appendChild(panel);

  if (targetHost) targetHost.appendChild(root);

  const rows = {};

  for (const platform of ORDERED_PLATFORMS) {
    const li = doc.createElement('li');
    li.className = 'ge-source';
    li.setAttribute('data-platform', platform);
    li.setAttribute('data-status', 'idle');

    const icon = doc.createElement('img');
    icon.className = 'ge-source-icon';
    icon.src =
      platform === 'route-agent'
        ? '/icons/platforms/web.svg'
        : `/icons/platforms/${platform}.svg`;
    icon.alt = PLATFORM_NAMES[platform] || platform;

    const name = doc.createElement('span');
    name.className = 'ge-source-name';
    name.textContent = PLATFORM_NAMES[platform] || platform;

    const cb = doc.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'ge-source-enabled';
    if (platform === 'route-agent') {
      cb.disabled = true;
      cb.checked = false;
    } else {
      cb.checked = Boolean(enabledMap[platform]);
      cb.addEventListener('change', () => {
        enabledMap[platform] = cb.checked;
        savedEnabled[platform] = cb.checked; // user intent wins over scene state
        writeStorage(storage, enabledMap);
        onToggle?.(platform, cb.checked);
      });
    }

    const pill = doc.createElement('span');
    pill.className = 'ge-source-status';
    pill.textContent = 'IDLE';

    const count = doc.createElement('span');
    count.className = 'ge-source-count';

    const latency = doc.createElement('span');
    latency.className = 'ge-source-latency';

    li.append(cb, icon, name, pill, count, latency);
    list.appendChild(li);

    rows[platform] = { li, cb, pill, count, latency };
  }

  function setOpen(open) {
    isOpen = Boolean(open);
    panel.hidden = !isOpen;
    toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    toggleBtn.classList.toggle('is-open', isOpen);
    if (doc.documentElement) {
      doc.documentElement.dataset.geSidebarOpen = isOpen ? '1' : '';
    }
  }

  function update() {
    const state = store?.getState?.() || {};
    const activeScene = state.activeId ? state.scenes?.[state.activeId] : null;
    const sources = activeScene?.sources || {};

    for (const p of ORDERED_PLATFORMS) {
      const row = rows[p];
      if (!row) continue;

      if (p === 'route-agent') {
        const raw = (currentRouteAgent?.status || 'idle').toLowerCase();
        row.li.setAttribute('data-status', raw);
        row.pill.textContent = STATUS_TEXT[raw] || raw.toUpperCase();
        row.count.textContent = '';
        row.latency.textContent =
          currentRouteAgent?.latencyMs != null
            ? `${currentRouteAgent.latencyMs}ms`
            : '';
      } else {
        const src = sources[p];
        const raw = (src?.status || 'idle').toLowerCase();
        row.li.setAttribute('data-status', raw);
        row.pill.textContent = STATUS_TEXT[raw] || raw.toUpperCase();
        row.count.textContent = src?.count != null ? String(src.count) : '';
        row.latency.textContent =
          src?.latencyMs != null ? `${src.latencyMs}ms` : '';

        if (src?.enabled !== undefined && !(p in savedEnabled)) {
          row.cb.checked = Boolean(src.enabled);
          enabledMap[p] = Boolean(src.enabled);
        }
      }
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && isOpen) setOpen(false);
  }

  win?.addEventListener?.('keydown', onKeyDown);
  if (store?.subscribe) unsub = store.subscribe(() => update());
  if (doc.documentElement) doc.documentElement.dataset.geSidebarOpen = '';
  update();

  function destroy() {
    if (unsub) unsub();
    win?.removeEventListener?.('keydown', onKeyDown);
    if (doc.documentElement) doc.documentElement.dataset.geSidebarOpen = '';
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return {
    element: root,
    destroy,
    setRouteAgent: (ra) => {
      currentRouteAgent = { ...currentRouteAgent, ...ra };
      update();
    },
    setOpen,
    update,
    getEnabled: () => ({ ...enabledMap }),
  };
}
