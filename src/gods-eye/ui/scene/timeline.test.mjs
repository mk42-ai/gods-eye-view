/**
 * @fileoverview Tests for timeline scrubber and tick calculations.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStubDocument } from './testDomStub.js';
import { createTimeline, calculateTimelinePercent } from './timeline.js';

test('timeline tick percent for tRef = 0', () => {
  // If start is -3600 and end is +3600, tRef at 0 is at 50%
  const pct1 = calculateTimelinePercent(0, -3600, 3600);
  assert.equal(pct1, 50);

  // If start is 0 and end is 100, tRef at 0 is at 0%
  const pct2 = calculateTimelinePercent(0, 0, 100);
  assert.equal(pct2, 0);

  // If start is -100 and end is 0, tRef at 0 is at 100%
  const pct3 = calculateTimelinePercent(0, -100, 0);
  assert.equal(pct3, 100);
});

test('timeline positions per-clip ticks by percent', () => {
  const document = createStubDocument();
  let scrubResult = undefined;
  let playItems = null;

  const timeline = createTimeline({
    document,
    onScrub: (w) => {
      scrubResult = w;
    },
    onPlay: (items) => {
      playItems = items;
    },
  });

  const scene = {
    id: 's_tl',
    timeline: {
      start: '2026-09-26T00:00:00Z',
      end: '2026-09-26T12:00:00Z',
    },
    tRef: '2026-09-26T06:00:00Z',
  };

  const items = [
    { id: 'clip_start', uploadedAt: '2026-09-26T00:00:00Z' },
    { id: 'clip_mid', uploadedAt: '2026-09-26T06:00:00Z' },
    { id: 'clip_end', uploadedAt: '2026-09-26T12:00:00Z' },
  ];

  timeline.setScene(scene, items);

  const tickStart = timeline.element.querySelector(
    '[data-item-id="clip_start"]',
  );
  const tickMid = timeline.element.querySelector('[data-item-id="clip_mid"]');
  const tickEnd = timeline.element.querySelector('[data-item-id="clip_end"]');

  assert.ok(tickStart);
  assert.ok(tickMid);
  assert.ok(tickEnd);

  assert.equal(tickStart.style.left, '0%');
  assert.equal(tickMid.style.left, '50%');
  assert.equal(tickEnd.style.left, '100%');

  // Scrub interaction
  const scrubInput = timeline.element.querySelector('#ge-timeline-scrub');
  scrubInput.value = '500';
  scrubInput.dispatchEvent({ type: 'input', target: scrubInput });

  assert.ok(scrubResult);
  assert.ok(scrubResult.from);
  assert.ok(scrubResult.to);

  // Verify 15-minute window span around cursor (900_000 ms)
  const spanMs = Date.parse(scrubResult.to) - Date.parse(scrubResult.from);
  assert.equal(spanMs, 15 * 60 * 1000);

  // Reset button emits null
  const resetBtn = timeline.element.querySelector('#ge-timeline-reset');
  resetBtn.click();
  assert.equal(scrubResult, null);

  // Play button sorts items in chronological order
  const unsortedItems = [
    { id: 'c3', uploadedAt: '2026-09-26T10:00:00Z' },
    { id: 'c1', uploadedAt: '2026-09-26T02:00:00Z' },
    { id: 'c2', uploadedAt: '2026-09-26T05:00:00Z' },
  ];
  timeline.setScene(scene, unsortedItems);

  const playBtn = timeline.element.querySelector('#ge-timeline-play');
  playBtn.click();

  assert.ok(Array.isArray(playItems));
  assert.deepEqual(
    playItems.map((i) => i.id),
    ['c1', 'c2', 'c3'],
  );
});
