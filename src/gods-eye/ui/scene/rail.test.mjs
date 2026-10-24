/**
 * @fileoverview Tests for footage rail component.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStubDocument } from './testDomStub.js';
import {
  createFootageRail,
  formatDistanceText,
  formatDeltaText,
} from './rail.js';

test('rail renders distance/delta strings', () => {
  // Test formatDistanceText helper directly
  assert.equal(formatDistanceText(0.8), '800 m from target');
  assert.equal(formatDistanceText(0.32), '320 m from target');
  assert.equal(formatDistanceText(1.5), '1.5 km from target');
  assert.equal(formatDistanceText(null), '— km');

  // Test formatDeltaText helper directly
  assert.equal(formatDeltaText(14 * 60, 'incident'), '+14 min after incident');
  assert.equal(formatDeltaText(-5 * 60, 'rebuild'), '-5 min before incident');
  assert.equal(formatDeltaText(2 * 3600, 'live'), 'posted 2 h ago');
  assert.equal(formatDeltaText(null, 'live'), '—');
});

test('footage rail builds cards with exact attributes and text', () => {
  const document = createStubDocument();
  let selectedItem = null;
  let hoveredId = null;

  const rail = createFootageRail({
    document,
    onSelect: (item) => {
      selectedItem = item;
    },
    onHover: (id) => {
      hoveredId = id;
    },
  });

  const items = [
    {
      id: 'item_1',
      platform: 'youtube',
      thumbUrl: '/thumbs/1.jpg',
      authorHandle: 'dxb_watcher',
      distanceKm: 0.8,
      timeDelta: 14 * 60,
      recency: 'RECENT',
      location: { confidence: 'exact' },
      pluginMeta: { icon: '/icons/platforms/youtube.svg' },
    },
    {
      id: 'item_2',
      platform: 'tiktok',
      thumbUrl: '/thumbs/2.jpg',
      authorHandle: 'citylive',
      distanceKm: 0.32,
      timeDelta: 2 * 3600,
      recency: 'LIVE',
      location: { confidence: 'inferred' },
    },
  ];

  rail.setItems(items, 'incident');
  rail.show();

  const card1 = rail.element.querySelector('[data-item-id="item_1"]');
  assert.ok(card1);
  assert.equal(card1.dataset.platform, 'youtube');
  assert.equal(card1.dataset.recency, 'RECENT');
  assert.equal(card1.dataset.confidence, 'exact');

  const distEl = card1.querySelector('.ge-card-distance');
  const deltaEl = card1.querySelector('.ge-card-delta');
  const handleEl = card1.querySelector('.ge-card-handle');

  assert.equal(distEl.textContent, '800 m from target');
  assert.equal(deltaEl.textContent, '+14 min after incident');
  assert.equal(handleEl.textContent, '@dxb_watcher');

  // Selection
  card1.click();
  assert.equal(selectedItem?.id, 'item_1');

  // Hover
  card1.dispatchEvent({ type: 'mouseenter' });
  assert.equal(hoveredId, 'item_1');
  card1.dispatchEvent({ type: 'mouseleave' });
  assert.equal(hoveredId, null);

  // Keyboard navigation
  const card2 = rail.element.querySelector('[data-item-id="item_2"]');
  card2.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
  assert.equal(selectedItem?.id, 'item_2');
});

test('rail setPulse triggers is-pulse class', () => {
  const document = createStubDocument();
  let timerCb = null;
  const fakeWin = {
    setTimeout: (cb) => {
      timerCb = cb;
    },
  };

  const rail = createFootageRail({ document, window: fakeWin });
  rail.setItems([{ id: 'p1', distanceKm: 1.0 }]);
  rail.show();

  const card = rail.element.querySelector('[data-item-id="p1"]');
  assert.ok(card);
  assert.equal(card.classList.contains('is-pulse'), false);

  rail.setPulse('p1');
  assert.equal(card.classList.contains('is-pulse'), true);

  // Trigger timeout to clear pulse
  if (timerCb) timerCb();
  assert.equal(card.classList.contains('is-pulse'), false);
});
