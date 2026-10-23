/**
 * @fileoverview Tests for scene header component.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStubDocument } from './testDomStub.js';
import {
  createSceneHeader,
  formatCoords,
  formatDistance,
  formatSourcesSummary,
} from './header.js';

test('formatCoords formats latitude and longitude', () => {
  assert.equal(formatCoords(25.147, 55.199), '25.1470°N 55.1990°E');
  assert.equal(formatCoords(-12.5, -45.2), '12.5000°S 45.2000°W');
  assert.equal(formatCoords(null, 55.199), '—');
});

test('formatDistance formats km and m', () => {
  assert.equal(formatDistance(0.8), '800 m');
  assert.equal(formatDistance(0.32), '320 m');
  assert.equal(formatDistance(1.5), '1.5 km');
  assert.equal(formatDistance(null), '— km');
});

test('header text for a rebuild scene with fallback route shows ROUTE: FALLBACK and UAE Interest Watch', () => {
  const document = createStubDocument();
  const { element, update } = createSceneHeader({ document });

  const scene = {
    id: 's_test1',
    title: 'Umm Suqeim Crash Rebuild',
    kind: 'rebuild',
    label: 'UAE Interest Watch',
    target: { name: 'Umm Suqeim', lat: 25.147, lon: 55.199 },
    tRef: '2026-09-26T07:00:00Z',
    tRefLabel: 'reported 2026-09-26',
    aoi: { name: 'Dubai Metro' },
    route: { fallback: true, confidence: 0.3 },
    camera: { stage: 'S2' },
    sources: [
      { source: 'youtube', status: 'ok', count: 1 },
      { source: 'instagram', status: 'ok', count: 3 },
    ],
    footage: [
      { id: 'f1', distanceKm: 0.8 },
      { id: 'f2', distanceKm: 1.2 },
    ],
  };

  update(scene);

  const routeEl = element.querySelector('.ge-h-route');
  const labelEl = element.querySelector('.ge-h-label');
  const kindEl = element.querySelector('.ge-h-kind');
  const coordsEl = element.querySelector('.ge-h-coords');
  const nearestEl = element.querySelector('.ge-h-nearest');
  const sourcesEl = element.querySelector('.ge-h-sources');

  assert.equal(routeEl.textContent, 'ROUTE: FALLBACK');
  assert.equal(labelEl.textContent, 'UAE Interest Watch');
  assert.equal(kindEl.textContent, 'REBUILD');
  assert.equal(coordsEl.textContent, '25.1470°N 55.1990°E');
  assert.equal(element.dataset.routeFallback, '1');
  assert.equal(element.dataset.kind, 'rebuild');
  assert.equal(element.dataset.stage, 'S2');
  assert.equal(nearestEl.textContent, '800 m');
  assert.match(sourcesEl.textContent, /2 sources · 2 clips/);
});

test('header updates non-fallback route confidence percentage', () => {
  const document = createStubDocument();
  const { element, update } = createSceneHeader({ document });

  update({
    id: 's_live1',
    title: 'Burj Khalifa Live',
    kind: 'live',
    target: { lat: 25.1972, lon: 55.2744 },
    route: { fallback: false, confidence: 0.94 },
    sources: { youtube: { status: 'ok', count: 3 } },
    footage: [{ id: 'f1', distanceKm: 2.5 }],
  });

  const routeEl = element.querySelector('.ge-h-route');
  assert.equal(routeEl.textContent, 'ROUTE: 94%');
  assert.equal(element.dataset.routeFallback, '0');
  assert.equal(element.dataset.kind, 'live');
});
