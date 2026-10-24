import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDom } from './testDom.mjs';
import { installScenesPanel } from './index.js';

test('panel: ARCHIVED tab split', () => {
  const { document, window } = createTestDom();
  const nowMs = new Date('2026-10-23T12:00:00Z').getTime();

  const store = {
    getState: () => ({
      scenes: {
        s_act: {
          id: 's_act',
          title: 'Active Scene',
          lifecycle: {
            createdAt: '2026-10-23T08:00:00Z',
            archivedAt: '2026-10-26T08:00:00Z',
          },
        },
        s_arc: {
          id: 's_arc',
          title: 'Archived Scene',
          lifecycle: {
            createdAt: '2026-10-18T08:00:00Z',
            archivedAt: '2026-10-21T08:00:00Z',
          },
        },
      },
      playback: { running: false },
    }),
    subscribe: () => () => {},
  };

  const host = document.createElement('div');
  document.body.appendChild(host);

  const panel = installScenesPanel({
    document,
    window,
    store,
    host,
    now: () => nowMs,
  });

  const list = panel.element.querySelector('#ge-scenes-list');
  let cards = list.querySelectorAll('.ge-scene-card');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].getAttribute('data-scene-id'), 's_act');

  panel.setTab('archive');
  cards = list.querySelectorAll('.ge-scene-card');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].getAttribute('data-scene-id'), 's_arc');

  panel.setTab('active');
  cards = list.querySelectorAll('.ge-scene-card');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].getAttribute('data-scene-id'), 's_act');

  panel.destroy();
});

test('panel: START intercept calls actions.start with ordered ids of active tab', () => {
  const { document, window } = createTestDom();
  const nowMs = new Date('2026-10-23T12:00:00Z').getTime();

  const startBtn = document.createElement('button');
  startBtn.id = 'scene-start-btn';
  const nextBtn = document.createElement('button');
  nextBtn.id = 'scene-next-btn';
  const stopBtn = document.createElement('button');
  stopBtn.id = 'scene-stop-btn';
  document.body.append(startBtn, nextBtn, stopBtn);

  let startedWith = null;
  let nextCalled = false;
  let stopCalled = false;
  const actions = {
    start: (ids) => {
      startedWith = ids;
    },
    next: () => {
      nextCalled = true;
    },
    stop: () => {
      stopCalled = true;
    },
  };

  const store = {
    getState: () => ({
      scenes: {
        s_1: {
          id: 's_1',
          lifecycle: {
            createdAt: '2026-10-23T09:00:00Z',
            archivedAt: '2026-10-26T00:00:00Z',
          },
        },
        s_2: {
          id: 's_2',
          lifecycle: {
            createdAt: '2026-10-23T10:00:00Z',
            archivedAt: '2026-10-26T00:00:00Z',
          },
        },
      },
      playback: { running: false },
    }),
    subscribe: () => () => {},
  };

  const host = document.createElement('div');
  document.body.appendChild(host);

  const panel = installScenesPanel({
    document,
    window,
    store,
    host,
    actions,
    now: () => nowMs,
  });

  startBtn.click();
  assert.deepEqual(startedWith, ['s_2', 's_1']);

  nextBtn.click();
  assert.equal(nextCalled, true);

  stopBtn.click();
  assert.equal(stopCalled, true);

  startedWith = null;
  panel.setTab('legacy');
  startBtn.click();
  assert.equal(startedWith, null);

  panel.destroy();
});

test('panel: playback status display updates from store', () => {
  const { document, window } = createTestDom();
  let listener = null;
  let currentState = {
    scenes: {},
    playback: { running: false },
  };

  const store = {
    getState: () => currentState,
    subscribe: (fn) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
  };

  const host = document.createElement('div');
  document.body.appendChild(host);

  const panel = installScenesPanel({ document, window, store, host });
  const statusEl = panel.element.querySelector('#ge-scenes-status');
  assert.equal(statusEl.textContent, 'IDLE');

  currentState = {
    scenes: {},
    playback: {
      running: true,
      queue: ['s1', 's2', 's3'],
      index: 1,
      phase: 'dwell-s2',
      dwell: 4.2,
    },
  };
  listener?.();
  assert.equal(statusEl.textContent, 'PLAYING 2/3 · dwell S2 4.2 s');

  panel.destroy();
});
