/**
 * @fileoverview Tests for evidence strip component.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStubDocument } from './testDomStub.js';
import { createEvidenceStrip } from './evidence.js';

test('evidence strip renders chips for source platforms', () => {
  const document = createStubDocument();
  const strip = createEvidenceStrip({ document });

  const scene = {
    id: 's_ev',
    sources: [
      { source: 'youtube', status: 'ok', count: 20 },
      { source: 'tiktok', status: 'quota', count: 0 },
      { source: 'x', status: 'inactive', count: 0 },
      { source: 'instagram', status: 'ok', count: 5 },
    ],
  };

  strip.update(scene);

  const ytChip = strip.element.querySelector('[data-platform="youtube"]');
  const ttChip = strip.element.querySelector('[data-platform="tiktok"]');
  const xChip = strip.element.querySelector('[data-platform="x"]');

  assert.ok(ytChip);
  assert.equal(ytChip.dataset.status, 'ok');
  assert.equal(ytChip.textContent, 'YOUTUBE OK 20');

  assert.ok(ttChip);
  assert.equal(ttChip.dataset.status, 'quota');
  assert.equal(ttChip.textContent, 'TIKTOK QUOTA');

  assert.ok(xChip);
  assert.equal(xChip.dataset.status, 'inactive');
  assert.equal(xChip.textContent, 'X INACTIVE');
});
