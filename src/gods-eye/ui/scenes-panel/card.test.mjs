import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDom } from './testDom.mjs';
import { renderSceneCard } from './card.js';

test('card: data attributes and NEW pill when lifecycle.isNew is true', () => {
  const { document } = createTestDom();
  const scene = {
    id: 's_test1',
    kind: 'incident',
    title: 'Test Incident',
    target: { name: 'Burj Khalifa', lat: 25.1972, lon: 55.2744 },
    tRefLabel: 'reported 14:30',
    lifecycle: {
      isNew: true,
      createdAt: '2026-10-23T10:00:00Z',
      archivedAt: '2026-10-26T10:00:00Z',
    },
    route: { fallback: false, confidence: 0.95 },
    sources: {
      tiktok: { status: 'ok', count: 4 },
      instagram: { status: 'ok', count: 2 },
    },
    footage: [
      {
        id: 'f1',
        platform: 'tiktok',
        thumbUrl: 'https://img.test/1.jpg',
        distanceKm: 0.8,
        diff: 'new',
      },
    ],
  };

  const card = renderSceneCard({
    document,
    scene,
    now: new Date('2026-10-23T12:00:00Z').getTime(),
  });

  assert.equal(card.getAttribute('data-scene-id'), 's_test1');
  assert.equal(card.getAttribute('data-kind'), 'incident');
  assert.equal(card.getAttribute('data-new'), '1');
  assert.equal(card.getAttribute('data-archived'), '0');

  const newPill = card.querySelector('.ge-sc-new');
  assert.ok(newPill, '.ge-sc-new pill must be rendered');
  assert.equal(newPill.textContent, 'NEW');

  const kindBadge = card.querySelector('.ge-sc-kind');
  assert.equal(kindBadge.textContent, 'INCIDENT');

  const clips = card.querySelector('.ge-sc-clips');
  assert.equal(clips.textContent, '1 clip');

  const nearest = card.querySelector('.ge-sc-nearest');
  assert.equal(nearest.textContent, 'nearest 0.8 km');

  const route = card.querySelector('.ge-sc-route');
  assert.equal(route.textContent, 'ROUTE: 95%');

  const thumbImg = card.querySelector('.ge-sc-thumb');
  assert.ok(thumbImg.classList.contains('is-new'));
});

test('card: no NEW pill when isNew false and displays ARCHIVED when expired', () => {
  const { document } = createTestDom();
  const scene = {
    id: 's_old',
    kind: 'live',
    title: 'Old Live Scene',
    lifecycle: {
      isNew: false,
      createdAt: '2026-10-10T00:00:00Z',
      archivedAt: '2026-10-13T00:00:00Z',
    },
    route: { fallback: true },
  };

  const card = renderSceneCard({
    document,
    scene,
    now: new Date('2026-10-23T12:00:00Z').getTime(),
  });

  assert.equal(card.getAttribute('data-new'), '0');
  assert.equal(card.getAttribute('data-archived'), '1');
  assert.equal(card.querySelector('.ge-sc-new'), null);

  const archPill = card.querySelector('.ge-sc-archived');
  assert.ok(archPill);
  assert.equal(archPill.textContent, 'ARCHIVED');

  const route = card.querySelector('.ge-sc-route');
  assert.equal(route.textContent, 'ROUTE: FALLBACK');
});

test('card: diff text and removed items count', () => {
  const { document } = createTestDom();
  const scene = {
    id: 's_diff',
    title: 'Diff Scene',
    lastDiff: { added: 2, removed: 1, unchanged: 4 },
    footage: [
      { id: 'f1', thumbUrl: 'https://img.test/1.jpg', diff: 'new' },
      { id: 'f2', thumbUrl: 'https://img.test/2.jpg', diff: 'removed' },
    ],
  };

  const card = renderSceneCard({ document, scene });
  const diffEl = card.querySelector('.ge-scene-diff');
  assert.ok(diffEl);
  assert.equal(diffEl.textContent, '+2 new · 1 removed · 4 unchanged');

  const goneCount = card.querySelector('.ge-sc-gone-count');
  assert.ok(goneCount);
  assert.equal(goneCount.textContent, '1 no longer available');
});

test('card: rename inline input commits on Enter and cancels on Esc', () => {
  const { document } = createTestDom();
  let renamedTo = null;
  const actions = {
    rename: (id, val) => {
      renamedTo = val;
    },
  };
  const scene = { id: 's_ren', title: 'Initial Title' };

  const card = renderSceneCard({ document, scene, actions });
  const renameBtn = card.querySelector('.ge-sc-rename');
  renameBtn.click();

  let input = card.querySelector('.ge-sc-title-input');
  assert.ok(input, 'input should appear after clicking rename');
  assert.equal(input.value, 'Initial Title');

  input.value = 'Committed Title';
  input.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
  assert.equal(renamedTo, 'Committed Title');
  assert.equal(
    card.querySelector('.ge-sc-title').textContent,
    'Committed Title',
  );

  // Test Esc cancels
  renameBtn.click();
  input = card.querySelector('.ge-sc-title-input');
  assert.ok(input);
  input.value = 'Ignored Change';
  input.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
  assert.equal(
    card.querySelector('.ge-sc-title').textContent,
    'Committed Title',
  );
});

test('card: action buttons and keyboard Enter trigger actions', async () => {
  const { document } = createTestDom();
  const called = [];
  const actions = {
    open: (id) => called.push(`open:${id}`),
    recreate: (id) => called.push(`recreate:${id}`),
    duplicate: (id) => called.push(`duplicate:${id}`),
    remove: (id) => called.push(`remove:${id}`),
    share: async (id) => {
      called.push(`share:${id}`);
      return 'https://godseye.test/s/123';
    },
  };
  const scene = { id: 's_act_test', title: 'Action Scene' };
  const card = renderSceneCard({ document, scene, actions });

  card.querySelector('.ge-sc-open').click();
  assert.ok(called.includes('s_act_test'.replace(/^/, 'open:')));

  card.querySelector('.ge-sc-recreate').click();
  assert.ok(called.includes('recreate:s_act_test'));

  card.querySelector('.ge-sc-duplicate').click();
  assert.ok(called.includes('duplicate:s_act_test'));

  card.querySelector('.ge-sc-delete').click();
  assert.ok(called.includes('remove:s_act_test'));

  // Enter on focused card triggers Open
  card.dispatchEvent({
    type: 'keydown',
    key: 'Enter',
    target: card,
    preventDefault() {},
  });
  assert.equal(called.filter((c) => c === 'open:s_act_test').length, 2);

  // Share button shows feedback
  const shareBtn = card.querySelector('.ge-sc-share');
  shareBtn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(called.includes('share:s_act_test'));
  const feedback = card.querySelector('.ge-sc-share-feedback');
  assert.equal(feedback.hidden, false);
});
