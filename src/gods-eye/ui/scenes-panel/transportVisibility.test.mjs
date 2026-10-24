import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDom } from './testDom.mjs';
import { installScenesPanel } from './index.js';

test('shared transport stays reachable on active, archive and legacy tabs', () => {
  const { document, window } = createTestDom();
  const host = document.createElement('div');
  const row = document.createElement('div');
  const start = document.createElement('button');
  start.id = 'scene-start-btn';
  row.appendChild(start);
  const legacyTools = document.createElement('div');
  legacyTools.textContent = 'Legacy capture tools';
  host.append(row, legacyTools);
  document.body.appendChild(host);
  const store = { getState: () => ({ scenes: {}, playback: { running: false } }), subscribe: () => () => {} };
  const panel = installScenesPanel({ document, window, host, store });
  for (const tab of ['active', 'archive', 'legacy']) {
    panel.setTab(tab);
    assert.equal(row.hidden, false, `${tab} transport remains visible`);
    assert.equal(legacyTools.hidden, tab !== 'legacy', `${tab} has the correct legacy tools`);
  }
  panel.destroy();
});
