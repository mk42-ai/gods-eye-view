import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayStateFor,
  badgeTextFor,
  isToggleEnabled,
  readSelection,
  writeSelection,
  createPluginPanel,
  installPluginPanel,
  PLUGIN_PANEL_ID,
  PLUGIN_DOCK_ID,
  PLUGIN_CHIP_ID,
  STORAGE_KEY,
} from './pluginPanel.js';

function makeMockStorage(initial = {}) {
  const mem = new Map(Object.entries(initial));
  return {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear(),
  };
}

function makeMockDoc() {
  function createMockEl(tag) {
    const children = [];
    const listeners = new Map();
    const attrs = new Map();
    const classList = new Set();

    const dataset = new Proxy({}, {
      get: (target, prop) => {
        const attrName =
          'data-' + String(prop).replace(/([A-Z])/g, '-$1').toLowerCase();
        return attrs.get(attrName) ?? target[prop];
      },
      set: (target, prop, value) => {
        target[prop] = String(value);
        const attrName =
          'data-' + String(prop).replace(/([A-Z])/g, '-$1').toLowerCase();
        attrs.set(attrName, String(value));
        return true;
      },
    });

    const el = {
      tagName: tag.toUpperCase(),
      children,
      id: '',
      open: false,
      _hidden: false,
      disabled: false,
      checked: false,
      type: '',
      _text: '',
      parentNode: null,
      dataset,
      _focused: false,
      focus: () => {
        el._focused = true;
      },
      get hidden() {
        return this._hidden;
      },
      set hidden(v) {
        this._hidden = Boolean(v);
        if (this._hidden) attrs.set('hidden', '');
        else attrs.delete('hidden');
      },
      get firstChild() {
        return children[0] || null;
      },
      get nextSibling() {
        if (!el.parentNode) return null;
        const siblings = el.parentNode.children;
        const idx = siblings.indexOf(el);
        if (idx >= 0 && idx + 1 < siblings.length) {
          return siblings[idx + 1];
        }
        return null;
      },
      get textContent() {
        if (children.length > 0) {
          return children.map((c) => c.textContent ?? '').join('');
        }
        return this._text;
      },
      set textContent(v) {
        this._text = String(v ?? '');
        children.length = 0;
      },
      get className() {
        return [...classList].join(' ');
      },
      set className(v) {
        classList.clear();
        if (v) v.split(/\s+/).forEach((c) => c && classList.add(c));
      },
      classList: {
        add: (...cs) => cs.forEach((c) => classList.add(c)),
        remove: (...cs) => cs.forEach((c) => classList.delete(c)),
        contains: (c) => classList.has(c),
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => attrs.get(k) ?? null,
      removeAttribute: (k) => attrs.delete(k),
      appendChild: (child) => {
        children.push(child);
        child.parentNode = el;
        return child;
      },
      removeChild: (child) => {
        const idx = children.indexOf(child);
        if (idx >= 0) children.splice(idx, 1);
        child.parentNode = null;
        return child;
      },
      append: (...cs) => {
        for (const c of cs) {
          children.push(c);
          c.parentNode = el;
        }
      },
      insertBefore: (newNode, refNode) => {
        const idx = children.indexOf(refNode);
        if (idx !== -1) {
          children.splice(idx, 0, newNode);
        } else {
          children.push(newNode);
        }
        newNode.parentNode = el;
        return newNode;
      },
      replaceChildren: (...cs) => {
        children.length = 0;
        for (const c of cs) {
          children.push(c);
          c.parentNode = el;
        }
      },
      remove: () => {
        if (el.parentNode) {
          const idx = el.parentNode.children.indexOf(el);
          if (idx >= 0) el.parentNode.children.splice(idx, 1);
          el.parentNode = null;
        }
      },
      addEventListener: (event, handler) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(handler);
      },
      dispatchEvent: (event) => {
        const ev = typeof event === 'string' ? { type: event } : event;
        const hs = listeners.get(ev?.type) || [];
        for (const h of hs) h(ev);
      },
      closest: (sel) => {
        let curr = el;
        while (curr) {
          if (matchesSel(curr, sel)) return curr;
          curr = curr.parentNode;
        }
        return null;
      },
      querySelector: (sel) => {
        function search(node) {
          for (const c of node.children) {
            if (matchesSel(c, sel)) return c;
            const sub = search(c);
            if (sub) return sub;
          }
          return null;
        }
        return search(el);
      },
      querySelectorAll: (sel) => {
        const found = [];
        function search(node) {
          for (const c of node.children) {
            if (matchesSel(c, sel)) found.push(c);
            search(c);
          }
        }
        search(el);
        return found;
      },
    };
    return el;
  }

  function matchesSel(el, sel) {
    if (!el || !sel) return false;
    let s = sel.trim();

    // Check attribute selectors
    const attrRegex = /\[([a-zA-Z0-9_-]+)(?:=['"]?([^'"\]]+)['"]?)?\]/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(s)) !== null) {
      const [, attr, val] = attrMatch;
      const attrVal = el.getAttribute(attr);
      if (val !== undefined && attrVal !== val) return false;
      if (val === undefined && attrVal === null) return false;
    }
    s = s.replace(attrRegex, '');
    if (!s) return true;

    // Check ID selector
    const idMatch = /#([a-zA-Z0-9_-]+)/.exec(s);
    if (idMatch) {
      if (el.id !== idMatch[1]) return false;
      s = s.replace(idMatch[0], '');
    }
    if (!s) return true;

    // Check class selectors
    const classMatches = s.match(/\.([a-zA-Z0-9_-]+)/g);
    if (classMatches) {
      for (const cm of classMatches) {
        if (!el.classList.contains(cm.slice(1))) return false;
        s = s.replace(cm, '');
      }
    }
    if (!s) return true;

    // Remaining tag name
    if (s) {
      if (el.tagName !== s.toUpperCase()) return false;
    }
    return true;
  }

  const doc = {
    body: createMockEl('body'),
    documentElement: createMockEl('html'),
    createElement: (tag) => createMockEl(tag),
    createElementNS: (ns, tag) => createMockEl(tag),
    createTextNode: (text) => ({ textContent: text }),
    querySelector: (sel) => {
      if (matchesSel(doc.body, sel)) return doc.body;
      function search(node) {
        for (const c of node.children) {
          if (matchesSel(c, sel)) return c;
          const sub = search(c);
          if (sub) return sub;
        }
        return null;
      }
      return search(doc.body);
    },
  };
  return doc;
}

describe('pluginPanel pure helpers', () => {
  test('displayStateFor derives { key, label } for all five lifecycle keys', () => {
    // ready
    assert.deepEqual(displayStateFor({ state: 'ready' }), {
      key: 'ready',
      label: 'Ready',
    });

    // checking
    assert.deepEqual(displayStateFor({ state: 'installing' }), {
      key: 'checking',
      label: 'Checking…',
    });
    assert.deepEqual(displayStateFor({ state: 'authenticating' }), {
      key: 'checking',
      label: 'Checking…',
    });
    assert.deepEqual(displayStateFor({ state: 'invoking' }), {
      key: 'checking',
      label: 'Checking…',
    });

    // unavailable
    assert.deepEqual(
      displayStateFor({
        state: 'failed',
        error: { code: 'inactive_on_account' },
      }),
      { key: 'unavailable', label: 'Unavailable' },
    );
    assert.deepEqual(displayStateFor({ availability: 'inactive' }), {
      key: 'unavailable',
      label: 'Unavailable',
    });
    assert.deepEqual(
      displayStateFor({ state: 'failed', availability: 'inactive' }),
      { key: 'unavailable', label: 'Unavailable' },
    );

    // error
    assert.deepEqual(displayStateFor({ state: 'failed' }), {
      key: 'error',
      label: 'Error',
    });
    assert.deepEqual(
      displayStateFor({
        state: 'failed',
        error: { code: 'other_error', message: 'Something broke' },
      }),
      { key: 'error', label: 'Error' },
    );

    // unverified
    assert.deepEqual(displayStateFor({ state: 'discovered' }), {
      key: 'unverified',
      label: 'Not verified',
    });
    assert.deepEqual(displayStateFor(null), {
      key: 'unverified',
      label: 'Not verified',
    });
    assert.deepEqual(displayStateFor({}), {
      key: 'unverified',
      label: 'Not verified',
    });
  });

  test('badgeTextFor returns displayStateFor label', () => {
    assert.equal(badgeTextFor({ state: 'ready' }), 'Ready');
    assert.equal(badgeTextFor({ state: 'failed' }), 'Error');
    assert.equal(badgeTextFor({ state: 'installing' }), 'Checking…');
    assert.equal(badgeTextFor({ state: 'authenticating' }), 'Checking…');
    assert.equal(badgeTextFor({ state: 'invoking' }), 'Checking…');
    assert.equal(badgeTextFor({ state: 'discovered' }), 'Not verified');
    assert.equal(badgeTextFor(null), 'Not verified');
    assert.equal(badgeTextFor({}), 'Not verified');
  });

  test('isToggleEnabled enables ready, discovered and regular failed, disables in-flight & inactive', () => {
    assert.equal(isToggleEnabled({ state: 'ready' }), true);
    assert.equal(isToggleEnabled({ state: 'discovered' }), true);
    assert.equal(
      isToggleEnabled({ state: 'failed', error: { code: 'rate_limited' } }),
      true,
    );

    // In-flight states are disabled
    assert.equal(isToggleEnabled({ state: 'installing' }), false);
    assert.equal(isToggleEnabled({ state: 'authenticating' }), false);
    assert.equal(isToggleEnabled({ state: 'invoking' }), false);

    // Inactive on account is disabled
    assert.equal(
      isToggleEnabled({
        state: 'failed',
        error: { code: 'inactive_on_account' },
      }),
      false,
    );
    assert.equal(isToggleEnabled({ availability: 'inactive' }), false);
    assert.equal(isToggleEnabled(null), false);
  });

  test('readSelection and writeSelection persist selection in storage', () => {
    const storage = makeMockStorage();
    assert.deepEqual(readSelection(storage), []);

    writeSelection(storage, ['plugin-1', 'plugin-2']);
    assert.deepEqual(readSelection(storage), ['plugin-1', 'plugin-2']);

    // Handles malformed data gracefully
    storage.setItem(STORAGE_KEY, 'invalid-json');
    assert.deepEqual(readSelection(storage), []);

    // Handles null storage
    writeSelection(null, ['x']);
    assert.deepEqual(readSelection(null), []);
  });
});

describe('createPluginPanel DOM & lifecycle integration', () => {
  const samplePlugins = [
    {
      name: 'internet_web_search',
      pluginId: 'plugin-1713924030',
      provider: 'OnDemand · Internet web search',
      kind: 'ondemand-plugin',
      availability: 'active',
      state: 'ready',
      verifiedAt: '2026-10-21T00:00:00Z',
      latencyMs: 145,
      answerPreview: 'READY. The search agent is online.',
    },
    {
      name: 'x_mcp_connector',
      pluginId: 'plugin-1785777296',
      provider: 'OnDemand · X MCP connector',
      kind: 'ondemand-plugin',
      availability: 'inactive',
      state: 'failed',
      error: {
        code: 'inactive_on_account',
        message: 'Inactive on the OnDemand account',
      },
    },
    {
      name: 'earthquake_search',
      pluginId: null,
      provider: 'USGS FDSN via gateway',
      kind: 'ondemand-tool',
      availability: 'active',
      state: 'discovered',
      verification: 'route-level (see /api/tools)',
    },
  ];

  test('mounts chip and panel, fetches plugins, updates chip count and renders status dots', async () => {
    const doc = makeMockDoc();
    const storage = makeMockStorage({
      [STORAGE_KEY]: JSON.stringify(['plugin-1713924030']),
    });

    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), method: init?.method || 'GET' });
      return {
        ok: true,
        json: async () => ({
          generatedAt: '2026-10-21T00:01:00Z',
          plugins: samplePlugins,
        }),
      };
    };

    let selectionUpdates = [];
    const panel = createPluginPanel({
      document: doc,
      storage,
      fetch: fetchImpl,
      apiBase: '/api/ondemand/v2',
      externalUserId: () => 'test-user-42',
      onSelectionChange: (ids) => selectionUpdates.push(ids),
    });

    const container = doc.createElement('div');
    doc.body.appendChild(container);
    panel.mount(container);

    // Initial state before fetch resolves: chip shows 0 ready, panel is hidden
    const chip = container.querySelector(`#${PLUGIN_CHIP_ID}`);
    assert.ok(chip, 'Chip button must exist');
    assert.equal(chip.className, 'od-plugins-chip');
    assert.equal(chip.getAttribute('aria-expanded'), 'false');
    assert.equal(chip.getAttribute('aria-controls'), PLUGIN_PANEL_ID);

    const chipDot = chip.querySelector('.od-plugins-chip__dot');
    assert.ok(chipDot, 'Chip status dot must exist');
    assert.equal(chipDot.getAttribute('data-state'), 'idle');

    const chipLabel = chip.querySelector('.od-plugins-chip__label');
    assert.ok(chipLabel, 'Chip label must exist');
    assert.equal(chipLabel.textContent, 'Plugins · 0 ready');

    const section = container.querySelector(`#${PLUGIN_PANEL_ID}`);
    assert.ok(section, 'Section element must exist');
    assert.equal(section.hidden, true, 'Panel must be hidden by default');

    await new Promise((r) => setTimeout(r, 10));

    // Verify GET /plugins call made
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/ondemand/v2/plugins');
    assert.equal(calls[0].method, 'GET');

    // Chip updated to 1 ready (internet_web_search is ready)
    assert.equal(chipLabel.textContent, 'Plugins · 1 ready');
    assert.equal(chipDot.getAttribute('data-state'), 'ready');

    // Panel header summary count
    const countEl = section.querySelector('.od-plugins__summary-count');
    assert.ok(countEl);
    assert.equal(countEl.textContent, '1 of 3 ready');

    const headerTitle = section.querySelector('.od-plugins__title');
    assert.ok(headerTitle);
    assert.equal(headerTitle.textContent, 'Plugins');

    const verifyAllBtn = section.querySelector('.od-plugins__verify-all');
    assert.ok(verifyAllBtn);
    assert.equal(verifyAllBtn.textContent, 'Verify all');

    const refreshBtn = section.querySelector('.od-plugins__refresh-btn');
    assert.ok(refreshBtn);
    assert.equal(refreshBtn.textContent, 'Refresh');

    const closeBtn = section.querySelector('.od-plugins__close');
    assert.ok(closeBtn);
    assert.equal(closeBtn.getAttribute('aria-label'), 'Close plugins');

    // Verify rows rendered
    const rows = section.querySelectorAll('.od-plugin__row');
    assert.equal(rows.length, 3);

    // Row 0: internet_web_search (ready)
    const dot0 = rows[0].querySelector('.od-plugin__dot');
    assert.ok(dot0, 'Row 0 must have status dot');
    assert.equal(dot0.getAttribute('data-state'), 'ready');
    assert.equal(dot0.getAttribute('aria-label'), 'Ready');
    assert.equal(dot0.getAttribute('title'), 'Ready');
    assert.equal(rows[0].querySelector('.od-plugin__state'), null, 'No per-row text pill');
    assert.equal(rows[0].querySelector('.od-plugin__verify'), null, 'No per-row verify button');
    const toggle0 = rows[0].querySelector('.od-plugin__toggle');
    assert.equal(toggle0.checked, true);
    assert.equal(toggle0.disabled, false);

    // Row 1: x_mcp_connector (failed inactive_on_account / unavailable)
    const dot1 = rows[1].querySelector('.od-plugin__dot');
    assert.ok(dot1, 'Row 1 must have status dot');
    assert.equal(dot1.getAttribute('data-state'), 'unavailable');
    assert.equal(dot1.getAttribute('aria-label'), 'Unavailable');
    assert.equal(rows[1].querySelector('.od-plugin__state'), null);
    assert.equal(rows[1].querySelector('.od-plugin__verify'), null);
    const errEl = rows[1].querySelector('.od-plugin__error');
    assert.ok(errEl, 'Error element rendered for failed entry');
    assert.equal(errEl.textContent, 'Inactive on the OnDemand account');

    // Row 2: earthquake_search (discovered / unverified)
    const dot2 = rows[2].querySelector('.od-plugin__dot');
    assert.ok(dot2, 'Row 2 must have status dot');
    assert.equal(dot2.getAttribute('data-state'), 'unverified');
    assert.equal(dot2.getAttribute('aria-label'), 'Not verified');
    assert.equal(rows[2].querySelector('.od-plugin__state'), null);
    assert.equal(rows[2].querySelector('.od-plugin__verify'), null);

    // Toggling panel with chip
    assert.equal(panel.isOpen(), false);
    chip.dispatchEvent('click');
    assert.equal(panel.isOpen(), true);
    assert.equal(section.hidden, false);
    assert.equal(chip.getAttribute('aria-expanded'), 'true');

    chip.dispatchEvent('click');
    assert.equal(panel.isOpen(), false);
    assert.equal(section.hidden, true);
    assert.equal(chip.getAttribute('aria-expanded'), 'false');
    assert.equal(chip._focused, true);

    // Opening and closing via close button
    panel.open();
    assert.equal(panel.isOpen(), true);
    assert.equal(section.hidden, false);
    closeBtn.dispatchEvent('click');
    assert.equal(panel.isOpen(), false);
    assert.equal(section.hidden, true);

    // Opening and closing via Escape key
    panel.open();
    assert.equal(panel.isOpen(), true);
    section.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(panel.isOpen(), false);
    assert.equal(section.hidden, true);

    panel.destroy();
  });

  test('clicking "Verify all" sends exactly one POST with eligible names and re-renders from response', async () => {
    const doc = makeMockDoc();
    const storage = makeMockStorage();

    const fetchCalls = [];
    const fetchImpl = async (url, init) => {
      fetchCalls.push({
        url: String(url),
        method: init?.method || 'GET',
        headers: init?.headers,
        body: init?.body ? JSON.parse(init.body) : null,
      });

      if (url.endsWith('/plugins') && init?.method === 'GET') {
        return {
          ok: true,
          json: async () => ({
            plugins: [
              {
                name: 'gpt_search',
                pluginId: 'plugin-1',
                provider: 'GPT Search',
                kind: 'ondemand-plugin',
                availability: 'active',
                state: 'discovered',
              },
              {
                name: 'web_reader',
                pluginId: 'plugin-2',
                provider: 'Web Reader',
                kind: 'ondemand-plugin',
                availability: 'active',
                state: 'ready',
              },
              {
                name: 'inactive_plugin',
                pluginId: 'plugin-3',
                provider: 'Inactive Connector',
                kind: 'ondemand-plugin',
                availability: 'inactive',
                state: 'failed',
                error: { code: 'inactive_on_account' },
              },
              {
                name: 'tool_entry',
                pluginId: null,
                provider: 'Built-in Tool',
                kind: 'ondemand-tool',
                availability: 'active',
                state: 'discovered',
              },
            ],
          }),
        };
      }

      if (url.endsWith('/plugins/verify') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            plugins: [
              {
                name: 'gpt_search',
                pluginId: 'plugin-1',
                provider: 'GPT Search',
                kind: 'ondemand-plugin',
                availability: 'active',
                state: 'ready',
                verifiedAt: new Date().toISOString(),
              },
              {
                name: 'web_reader',
                pluginId: 'plugin-2',
                provider: 'Web Reader',
                kind: 'ondemand-plugin',
                availability: 'active',
                state: 'ready',
                verifiedAt: new Date().toISOString(),
              },
            ],
          }),
        };
      }

      return { ok: false, status: 404 };
    };

    const panel = createPluginPanel({
      document: doc,
      storage,
      fetch: fetchImpl,
      apiBase: '/api/ondemand/v2',
      externalUserId: () => 'verify-user-all',
    });

    const container = doc.createElement('div');
    doc.body.appendChild(container);
    panel.mount(container);
    await new Promise((r) => setTimeout(r, 10));

    const verifyAllBtn = container.querySelector('.od-plugins__verify-all');
    assert.ok(verifyAllBtn, 'Verify all button must exist in header');
    assert.equal(verifyAllBtn.textContent, 'Verify all');

    // Click "Verify all"
    verifyAllBtn.dispatchEvent({ type: 'click' });
    assert.equal(verifyAllBtn.textContent, 'Checking…');
    assert.equal(verifyAllBtn.disabled, true);

    await new Promise((r) => setTimeout(r, 10));

    // Exactly one POST was made to /plugins/verify
    const verifyCalls = fetchCalls.filter((c) =>
      c.url.endsWith('/plugins/verify'),
    );
    assert.equal(verifyCalls.length, 1);
    assert.equal(verifyCalls[0].method, 'POST');
    assert.equal(
      verifyCalls[0].headers?.['X-Workstation-User'],
      'verify-user-all',
    );

    // inactive_plugin (unavailable) and tool_entry (ondemand-tool) must be excluded
    assert.deepEqual(verifyCalls[0].body, {
      externalUserId: 'verify-user-all',
      names: ['gpt_search', 'web_reader'],
    });

    // Button restored
    assert.equal(verifyAllBtn.textContent, 'Verify all');
    assert.equal(verifyAllBtn.disabled, false);

    // State dots updated: gpt_search and web_reader are now both ready (2 ready)
    const chipLabel = container.querySelector('.od-plugins-chip__label');
    assert.equal(chipLabel.textContent, 'Plugins · 2 ready');

    const dots = container.querySelectorAll('.od-plugin__dot');
    assert.equal(dots[0].getAttribute('data-state'), 'ready');
    assert.equal(dots[1].getAttribute('data-state'), 'ready');
    assert.equal(dots[2].getAttribute('data-state'), 'unavailable');
    assert.equal(dots[3].getAttribute('data-state'), 'unverified');

    panel.destroy();
  });

  test('rows show status dot with correct data-state and no per-row verify buttons', async () => {
    const doc = makeMockDoc();
    const storage = makeMockStorage();

    const variedPlugins = [
      {
        name: 'ready_plugin',
        kind: 'ondemand-plugin',
        state: 'ready',
      },
      {
        name: 'unverified_plugin',
        kind: 'ondemand-plugin',
        state: 'discovered',
      },
      {
        name: 'checking_plugin',
        kind: 'ondemand-plugin',
        state: 'installing',
      },
      {
        name: 'error_plugin',
        kind: 'ondemand-plugin',
        state: 'failed',
        error: { code: 'rate_limited', message: 'Quota exceeded' },
      },
      {
        name: 'unavailable_plugin',
        kind: 'ondemand-plugin',
        availability: 'inactive',
        state: 'failed',
        error: { code: 'inactive_on_account' },
      },
      {
        name: 'tool_row',
        kind: 'ondemand-tool',
        state: 'discovered',
      },
    ];

    const panel = createPluginPanel({
      document: doc,
      storage,
      fetch: async () => ({
        ok: true,
        json: async () => ({ plugins: variedPlugins }),
      }),
    });

    const container = doc.createElement('div');
    doc.body.appendChild(container);
    panel.mount(container);
    await new Promise((r) => setTimeout(r, 10));

    const rows = container.querySelectorAll('.od-plugin__row');
    assert.equal(rows.length, 6);

    const states = ['ready', 'unverified', 'checking', 'error', 'unavailable', 'unverified'];
    for (let i = 0; i < rows.length; i++) {
      const dot = rows[i].querySelector('.od-plugin__dot');
      assert.ok(dot, `Row ${i} must have .od-plugin__dot`);
      assert.equal(dot.getAttribute('data-state'), states[i]);
      assert.equal(rows[i].querySelector('.od-plugin__state'), null, `Row ${i} must have no .od-plugin__state`);
      assert.equal(rows[i].querySelector('.od-plugin__verify'), null, `Row ${i} must have no .od-plugin__verify`);
    }

    panel.destroy();
  });

  test('installPluginPanel mounts chip+panel into #ondemand-plugin-dock and exposes open/close on window.__odPlugins', () => {
    const doc = makeMockDoc();
    const win = { localStorage: makeMockStorage() };

    const panel = installPluginPanel({
      document: doc,
      window: win,
      fetch: async () => ({
        ok: true,
        json: async () => ({ plugins: [] }),
      }),
    });

    assert.ok(panel);
    const dock = doc.body.querySelector(`#${PLUGIN_DOCK_ID}`);
    assert.ok(dock, '#ondemand-plugin-dock must be created');

    // Dock children: chip is first child, panel section is after it
    assert.equal(dock.children.length, 2);
    assert.equal(dock.children[0].id, PLUGIN_CHIP_ID);
    assert.equal(dock.children[1].id, PLUGIN_PANEL_ID);

    // Initial closed state
    assert.equal(dock.dataset.open, 'false');
    assert.equal(dock.children[1].hidden, true);

    // window.__odPlugins debug handle
    assert.ok(win.__odPlugins);
    assert.equal(typeof win.__odPlugins.getSelectedPluginIds, 'function');
    assert.equal(typeof win.__odPlugins.refresh, 'function');
    assert.equal(typeof win.__odPlugins.destroy, 'function');
    assert.equal(typeof win.__odPlugins.open, 'function');
    assert.equal(typeof win.__odPlugins.close, 'function');
    assert.equal(typeof win.__odPlugins.isOpen, 'function');

    // Test open()
    assert.equal(win.__odPlugins.isOpen(), false);
    win.__odPlugins.open();
    assert.equal(win.__odPlugins.isOpen(), true);
    assert.equal(dock.dataset.open, 'true');
    assert.equal(dock.children[1].hidden, false);

    // Test close()
    win.__odPlugins.close();
    assert.equal(win.__odPlugins.isOpen(), false);
    assert.equal(dock.dataset.open, 'false');
    assert.equal(dock.children[1].hidden, true);

    win.__odPlugins.destroy();
    assert.equal(win.__odPlugins, undefined);
  });

  test('installPluginPanel mounts into mini-chat slot when #ondemand-mini-chat is present', () => {
    const doc = makeMockDoc();
    const miniChat = doc.createElement('div');
    miniChat.id = 'ondemand-mini-chat';
    const header = doc.createElement('div');
    header.className = 'od-chat__header';
    miniChat.appendChild(header);
    doc.body.appendChild(miniChat);

    const win = { localStorage: makeMockStorage() };
    const panel = installPluginPanel({
      document: doc,
      window: win,
      fetch: async () => ({
        ok: true,
        json: async () => ({ plugins: [] }),
      }),
    });

    assert.ok(panel);
    const slot = miniChat.querySelector('.od-chat__plugin-slot');
    assert.ok(slot, 'Should mount into .od-chat__plugin-slot');
    assert.ok(slot.querySelector(`#${PLUGIN_CHIP_ID}`));
    assert.ok(slot.querySelector(`#${PLUGIN_PANEL_ID}`));

    panel.destroy();
  });

  test('installPluginPanel respects AbortSignal teardown', () => {
    const doc = makeMockDoc();
    const win = { localStorage: makeMockStorage() };
    const controller = new AbortController();

    const panel = installPluginPanel({
      document: doc,
      window: win,
      signal: controller.signal,
      fetch: async () => ({
        ok: true,
        json: async () => ({ plugins: [] }),
      }),
    });

    assert.ok(win.__odPlugins);
    controller.abort();
    assert.equal(win.__odPlugins, undefined);
  });
});

