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
    const el = {
      tagName: tag.toUpperCase(),
      children,
      id: '',
      open: false,
      hidden: false,
      disabled: false,
      checked: false,
      type: '',
      _text: '',
      parentNode: null,
      nextSibling: null,
      get textContent() {
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
        const hs = listeners.get(event?.type || event) || [];
        for (const h of hs) h(event);
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
    if (sel.startsWith('#')) return el.id === sel.slice(1);
    if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
    if (sel.includes('[')) {
      const match = /\[([a-zA-Z0-9_-]+)(?:=['"]?([^'"\]]+)['"]?)?\]/.exec(sel);
      if (match) {
        const [, attr, val] = match;
        const attrVal = el.getAttribute(attr);
        if (val !== undefined) return attrVal === val;
        return attrVal !== null;
      }
    }
    return el.tagName === sel.toUpperCase();
  }

  const doc = {
    body: createMockEl('body'),
    documentElement: createMockEl('html'),
    createElement: (tag) => createMockEl(tag),
    createTextNode: (text) => ({ textContent: text }),
    querySelector: (sel) => {
      if (matchesSel(doc.body, sel)) return doc.body;
      for (const c of doc.body.children) {
        if (matchesSel(c, sel)) return c;
        const sub = c.querySelector(sel);
        if (sub) return sub;
      }
      return null;
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

  test('mounts panel, fetches plugins and renders honest state badges', async () => {
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

    await new Promise((r) => setTimeout(r, 10));

    // Verify GET /plugins call made
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/ondemand/v2/plugins');
    assert.equal(calls[0].method, 'GET');

    // Verify container has section#ondemand-plugin-panel
    const section = container.querySelector(`#${PLUGIN_PANEL_ID}`);
    assert.ok(section, 'Section element must exist');
    assert.ok(section.classList.contains('od-plugins'));

    // Verify rows rendered
    const rows = section.querySelectorAll('.od-plugin__row');
    assert.equal(rows.length, 3);

    // Row 0: internet_web_search (ready)
    const stateBadge0 = rows[0].querySelector('.od-plugin__state');
    assert.equal(stateBadge0.textContent, 'Ready');
    assert.equal(stateBadge0.getAttribute('data-state'), 'ready');
    const toggle0 = rows[0].querySelector('.od-plugin__toggle');
    assert.equal(
      toggle0.checked,
      true,
      'persisted selection should be checked',
    );
    assert.equal(toggle0.disabled, false);
    assert.equal(
      toggle0.getAttribute('aria-label'),
      'Use internet_web_search in answers',
    );
    const verify0 = rows[0].querySelector('.od-plugin__verify');
    assert.ok(verify0);
    assert.equal(verify0.textContent, 'Re-check');

    // Row 1: x_mcp_connector (failed inactive_on_account)
    const stateBadge1 = rows[1].querySelector('.od-plugin__state');
    assert.equal(stateBadge1.textContent, 'Unavailable');
    assert.equal(stateBadge1.getAttribute('data-state'), 'unavailable');
    const toggle1 = rows[1].querySelector('.od-plugin__toggle');
    assert.equal(
      toggle1.disabled,
      true,
      'inactive_on_account toggle must be disabled',
    );
    assert.equal(
      toggle1.getAttribute('aria-label'),
      'Use x_mcp_connector in answers',
    );
    const errEl = rows[1].querySelector('.od-plugin__error');
    assert.ok(errEl, 'Error element must be rendered for failed row');
    assert.equal(errEl.textContent, 'Inactive on the OnDemand account');
    assert.equal(
      rows[1].querySelector('.od-plugin__verify'),
      null,
      'unavailable row must not have a verify button',
    );

    // Row 2: earthquake_search (tool with route-level verification)
    const stateBadge2 = rows[2].querySelector('.od-plugin__state');
    assert.equal(stateBadge2.textContent, 'Not verified');
    assert.equal(stateBadge2.getAttribute('data-state'), 'unverified');
    const toggle2 = rows[2].querySelector('.od-plugin__toggle');
    assert.equal(
      toggle2.getAttribute('aria-label'),
      'Use earthquake_search in answers',
    );
    const noteEl = rows[2].querySelector('.od-plugin__timing');
    assert.ok(noteEl);
    assert.equal(noteEl.textContent, 'route-level (see /api/tools)');
    assert.equal(
      rows[2].querySelector('.od-plugin__verify'),
      null,
      'tool-kind row must not have a verify button',
    );

    // Summary count & accessible attributes
    const countEl = section.querySelector('.od-plugins__summary-count');
    assert.ok(countEl);
    assert.equal(countEl.textContent, '1 of 3 ready');
    assert.equal(countEl.getAttribute('aria-live'), 'polite');

    const header = section.querySelector('.od-plugins__header');
    assert.ok(header);
    const headerTitle = header.querySelector('span');
    assert.equal(headerTitle.textContent, 'Capabilities');

    const refreshBtn = section.querySelector('.od-plugins__refresh-btn');
    assert.equal(refreshBtn.textContent, 'Refresh');

    // Toggle interaction test
    toggle0.checked = false;
    toggle0.dispatchEvent({ type: 'change' });
    assert.deepEqual(panel.getSelectedPluginIds(), []);
    assert.deepEqual(selectionUpdates[selectionUpdates.length - 1], []);

    panel.destroy();
  });

  test('clicking VERIFY button triggers POST /plugins/verify and renders updated server response', async () => {
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
                pluginId: 'plugin-1741871229',
                provider: 'GPT Search',
                kind: 'ondemand-plugin',
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
                pluginId: 'plugin-1741871229',
                provider: 'GPT Search',
                kind: 'ondemand-plugin',
                availability: 'active',
                state: 'ready',
                verifiedAt: new Date().toISOString(),
                latencyMs: 312,
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
      externalUserId: () => 'verify-user',
    });

    const container = doc.createElement('div');
    doc.body.appendChild(container);
    panel.mount(container);
    await new Promise((r) => setTimeout(r, 10));

    const verifyBtn = container.querySelector('.od-plugin__verify');
    assert.ok(verifyBtn, 'Verify button should exist');
    assert.equal(verifyBtn.textContent, 'Verify');

    // Click VERIFY
    const clickPromise = verifyBtn.dispatchEvent({ type: 'click' });
    assert.equal(verifyBtn.textContent, 'Checking…');
    assert.equal(verifyBtn.disabled, true);

    await new Promise((r) => setTimeout(r, 10));

    // Verify POST was made with correct payload and headers
    const verifyCall = fetchCalls.find((c) =>
      c.url.endsWith('/plugins/verify'),
    );
    assert.ok(verifyCall);
    assert.equal(verifyCall.method, 'POST');
    assert.equal(verifyCall.headers?.['X-Workstation-User'], 'verify-user');
    assert.deepEqual(verifyCall.body, {
      externalUserId: 'verify-user',
      names: ['gpt_search'],
    });

    // Check state badge updated to Ready from server response
    const badge = container.querySelector('.od-plugin__state');
    assert.equal(badge.textContent, 'Ready');
    assert.equal(badge.getAttribute('data-state'), 'ready');
    assert.equal(
      container.querySelector('.od-plugin__verify').textContent,
      'Re-check',
    );

    panel.destroy();
  });

  test('single-action rule: unavailable row has no .od-plugin__verify, error row has "Retry", ready row has "Re-check"', async () => {
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

    // ready row: 'Re-check', not disabled
    const readyBtn = rows[0].querySelector('.od-plugin__verify');
    assert.ok(readyBtn);
    assert.equal(readyBtn.textContent, 'Re-check');
    assert.equal(readyBtn.disabled, false);

    // unverified row: 'Verify', not disabled
    const unverifiedBtn = rows[1].querySelector('.od-plugin__verify');
    assert.ok(unverifiedBtn);
    assert.equal(unverifiedBtn.textContent, 'Verify');
    assert.equal(unverifiedBtn.disabled, false);

    // checking row: 'Checking…', disabled
    const checkingBtn = rows[2].querySelector('.od-plugin__verify');
    assert.ok(checkingBtn);
    assert.equal(checkingBtn.textContent, 'Checking…');
    assert.equal(checkingBtn.disabled, true);

    // error row: 'Retry', not disabled
    const errorBtn = rows[3].querySelector('.od-plugin__verify');
    assert.ok(errorBtn);
    assert.equal(errorBtn.textContent, 'Retry');
    assert.equal(errorBtn.disabled, false);

    // unavailable row: no button at all
    const unavailableBtn = rows[4].querySelector('.od-plugin__verify');
    assert.equal(unavailableBtn, null);

    // tool-kind row: no button at all
    const toolBtn = rows[5].querySelector('.od-plugin__verify');
    assert.equal(toolBtn, null);

    panel.destroy();
  });

  test('installPluginPanel mounts into floating dock and sets window.__odPlugins', () => {
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
    assert.ok(doc.body.querySelector(`#${PLUGIN_DOCK_ID}`));
    assert.ok(win.__odPlugins);
    assert.equal(typeof win.__odPlugins.getSelectedPluginIds, 'function');
    assert.equal(typeof win.__odPlugins.refresh, 'function');
    assert.equal(typeof win.__odPlugins.destroy, 'function');

    win.__odPlugins.destroy();
    assert.equal(win.__odPlugins, undefined);
  });
});
