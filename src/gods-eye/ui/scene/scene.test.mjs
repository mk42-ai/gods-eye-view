/**
 * @fileoverview Integration tests for installSceneUi and index.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStubDocument } from './testDomStub.js';
import { installSceneUi } from './index.js';

function createFakeStore(initialState) {
  let state = initialState;
  const listeners = new Set();
  return {
    getState: () => state,
    setState: (next) => {
      state = next;
      for (const fn of listeners) fn();
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function createStubViewer() {
  const entityList = [];
  return {
    entities: {
      get values() {
        return entityList;
      },
      add(entity) {
        entityList.push(entity);
        return entity;
      },
      remove(entity) {
        const idx = entityList.indexOf(entity);
        if (idx >= 0) entityList.splice(idx, 1);
      },
    },
  };
}

test('installSceneUi initializes hidden root and attaches all components', () => {
  const document = createStubDocument();
  const store = createFakeStore({ activeId: null, scenes: {} });
  const viewer = createStubViewer();

  const ui = installSceneUi({ document, store, viewer });

  assert.ok(ui.elements.root);
  assert.equal(ui.elements.root.id, 'ge-scene-root');
  assert.equal(ui.elements.root.hidden, true);

  assert.ok(ui.elements.header);
  assert.ok(ui.elements.player);
  assert.ok(ui.elements.timeline);
  assert.ok(ui.elements.evidence);
  assert.ok(ui.elements.rail);
});

test('installSceneUi updates when store sets active scene and stage gates components', () => {
  const document = createStubDocument();
  const viewer = createStubViewer();

  const sceneA = {
    id: 's_rebuild_umm',
    kind: 'rebuild',
    title: 'Umm Suqeim Crash',
    tRef: '2026-09-26T07:00:00Z',
    tRefLabel: 'reported 2026-09-26',
    target: { name: 'Umm Suqeim', lat: 25.147, lon: 55.199 },
    camera: { stage: 'S2' },
    route: { fallback: true, confidence: 0.3 },
    sources: [{ source: 'youtube', status: 'ok', count: 1 }],
    footage: [
      {
        id: 'clip_1',
        url: 'https://www.youtube.com/watch?v=pu6shIJmb5s',
        distanceKm: 0.8,
        timeDelta: 14 * 60,
        uploadedAt: '2026-09-26T07:14:00Z',
      },
    ],
  };

  const store = createFakeStore({
    activeId: null,
    scenes: { s_rebuild_umm: sceneA },
  });

  const ui = installSceneUi({ document, store, viewer });
  assert.equal(ui.elements.root.hidden, true);

  // Set activeId to sceneA at stage S2
  store.setState({
    activeId: 's_rebuild_umm',
    scenes: { s_rebuild_umm: sceneA },
  });

  assert.equal(ui.elements.root.hidden, false);
  assert.equal(ui.elements.header.dataset.stage, 'S2');
  assert.equal(ui.elements.header.dataset.routeFallback, '1');
  assert.equal(ui.elements.rail.hidden, true); // Hidden until S4

  // Verify rebuild banner is visible
  const banner = ui.elements.player.querySelector('#ge-banner');
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /REBUILT FROM ARCHIVAL FOOTAGE/);

  // Advance stage to S4
  ui.setStage('S4');
  assert.equal(ui.elements.rail.hidden, false); // Rail shown at S4

  // Play item
  ui.playNow(sceneA.footage[0]);
  assert.equal(ui.elements.player.dataset.playing, '1');
  assert.equal(ui.elements.player.dataset.kind, 'youtube');

  // Destroy cleans up
  ui.destroy();
  assert.equal(ui.elements.root.parentElement, null);
});
