import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDom } from './testDom.mjs';
import { installSourcesSidebar } from './index.js';

test('sidebar: rows order, status text mapping, and onToggle', () => {
  const { document, window } = createTestDom();

  const store = {
    getState: () => ({
      activeId: 's_act',
      scenes: {
        s_act: {
          id: 's_act',
          sources: {
            tiktok: { status: 'ok', count: 12, latencyMs: 240 },
            instagram: { status: 'quota', count: 0 },
            youtube: { status: 'inactive' },
            x: { status: 'error' },
            reddit: { status: 'idle' },
            web: { status: 'pending', count: 5, latencyMs: 1200 },
          },
        },
      },
    }),
    subscribe: () => () => {},
  };

  const toggles = [];
  const fakeStorage = {
    _data: {},
    getItem(k) {
      return this._data[k] || null;
    },
    setItem(k, v) {
      this._data[k] = String(v);
    },
  };

  const sidebar = installSourcesSidebar({
    document,
    window,
    store,
    routeAgent: { status: 'inactive', latencyMs: 3718 },
    onToggle: (p, enabled) => toggles.push({ platform: p, enabled }),
    storage: fakeStorage,
  });

  const rows = sidebar.element.querySelectorAll('li.ge-source');
  assert.equal(rows.length, 7);

  const expectedOrder = [
    'tiktok',
    'instagram',
    'youtube',
    'x',
    'reddit',
    'web',
    'route-agent',
  ];

  const actualOrder = Array.from(rows).map((r) =>
    r.getAttribute('data-platform'),
  );
  assert.deepEqual(actualOrder, expectedOrder);

  // Status mapping checks
  const tiktokPill = rows[0].querySelector('.ge-source-status');
  assert.equal(tiktokPill.textContent, 'OK');
  assert.equal(rows[0].querySelector('.ge-source-count').textContent, '12');

  const instaPill = rows[1].querySelector('.ge-source-status');
  assert.equal(instaPill.textContent, 'QUOTA');

  const ytPill = rows[2].querySelector('.ge-source-status');
  assert.equal(ytPill.textContent, 'INACTIVE');

  const xPill = rows[3].querySelector('.ge-source-status');
  assert.equal(xPill.textContent, 'ERROR');

  const redditPill = rows[4].querySelector('.ge-source-status');
  assert.equal(redditPill.textContent, 'IDLE');

  const webPill = rows[5].querySelector('.ge-source-status');
  assert.equal(webPill.textContent, 'PENDING');

  const routePill = rows[6].querySelector('.ge-source-status');
  assert.equal(routePill.textContent, 'INACTIVE');
  assert.equal(
    rows[6].querySelector('.ge-source-latency').textContent,
    '3718ms',
  );

  // Route agent checkbox must be disabled
  const routeCb = rows[6].querySelector('.ge-source-enabled');
  assert.equal(routeCb.disabled, true);

  // onToggle on tiktok checkbox change
  const tiktokCb = rows[0].querySelector('.ge-source-enabled');
  assert.equal(tiktokCb.checked, true);
  tiktokCb.checked = false;
  tiktokCb.dispatchEvent({ type: 'change' });

  assert.equal(toggles.length, 1);
  assert.deepEqual(toggles[0], { platform: 'tiktok', enabled: false });

  // Storage persisted
  const saved = JSON.parse(fakeStorage.getItem('godsEye.sources'));
  assert.equal(saved.tiktok, false);

  sidebar.destroy();
});

test('sidebar: setOpen, Esc key closes, and geSidebarOpen dataset', () => {
  const { document, window } = createTestDom();
  const store = {
    getState: () => ({ activeId: null, scenes: {} }),
    subscribe: () => () => {},
  };

  const sidebar = installSourcesSidebar({ document, window, store });
  assert.equal(document.documentElement.dataset.geSidebarOpen, '');

  sidebar.setOpen(true);
  assert.equal(document.documentElement.dataset.geSidebarOpen, '1');

  // Esc closes
  window.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(document.documentElement.dataset.geSidebarOpen, '');

  sidebar.destroy();
});

test('sidebar: setRouteAgent updates row and getEnabled returns current map', () => {
  const { document, window } = createTestDom();
  const store = {
    getState: () => ({ activeId: null, scenes: {} }),
    subscribe: () => () => {},
  };

  const sidebar = installSourcesSidebar({ document, window, store });
  const routeRow = sidebar.element.querySelector(
    'li.ge-source[data-platform="route-agent"]',
  );
  assert.equal(routeRow.querySelector('.ge-source-status').textContent, 'IDLE');

  sidebar.setRouteAgent({ status: 'ok', latencyMs: 85 });
  assert.equal(routeRow.querySelector('.ge-source-status').textContent, 'OK');
  assert.equal(
    routeRow.querySelector('.ge-source-latency').textContent,
    '85ms',
  );

  const enabled = sidebar.getEnabled();
  assert.equal(typeof enabled, 'object');
  assert.equal(enabled.tiktok, true);
  assert.equal(enabled['route-agent'], false);

  sidebar.destroy();
});
