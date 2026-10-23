/**
 * @fileoverview Tests for poster mapping and posterForState resolution.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSTERS, posterForState } from './posters.js';

test('POSTERS map contains all required keys per spec', () => {
  const expectedKeys = [
    'idle',
    'loading',
    'empty',
    'archive',
    'quota',
    'error',
    'routeFallback',
    'outsideRegister',
    'recreateDiff',
  ];
  for (const key of expectedKeys) {
    assert.ok(POSTERS[key], `POSTERS.${key} should exist`);
  }
});

test('posterForState handles explicit flags with highest priority', () => {
  assert.equal(posterForState(null, { recreateDiff: true }), 'recreateDiff');
  assert.equal(
    posterForState(null, { outsideRegister: true }),
    'outsideRegister',
  );
  assert.equal(posterForState(null, { routeFallback: true }), 'routeFallback');
});

test('posterForState resolves scene statuses', () => {
  assert.equal(posterForState({ status: 'idle' }), 'idle');
  assert.equal(posterForState({ status: 'flying' }), 'loading');
  assert.equal(posterForState({ status: 'fetching' }), 'loading');
  assert.equal(
    posterForState({ status: 'error', error: { code: 'NETWORK_ERR' } }),
    'error',
  );
  assert.equal(
    posterForState({
      status: 'error',
      error: { message: 'Daily quota reached' },
    }),
    'quota',
  );
});

test('posterForState resolves rebuild scenes to archive', () => {
  const rebuildScene = {
    id: 's_reb',
    kind: 'rebuild',
    status: 'ranked',
    footage: [{ id: 'f1' }],
  };
  assert.equal(posterForState(rebuildScene), 'archive');
});

test('posterForState resolves empty scenes without footage', () => {
  const emptyScene = {
    id: 's_empty',
    kind: 'live',
    status: 'ranked',
    footage: [],
  };
  assert.equal(posterForState(emptyScene), 'empty');
});

test('every poster resolves under the designed-state token base and tokens publish to CSS', async () => {
  const { POSTER_BASE, POSTER_FILES, applyPosterTokens } = await import('./posters.js');
  assert.equal(POSTER_BASE, '/assets/states');
  for (const [key, url] of Object.entries(POSTERS)) {
    assert.ok(url.startsWith(`${POSTER_BASE}/state-`), `${key} → ${url}`);
    assert.equal(url, `${POSTER_BASE}/${POSTER_FILES[key]}`);
  }
  const props = {};
  const fakeRoot = { style: { setProperty: (k, v) => (props[k] = v) } };
  const set = applyPosterTokens(fakeRoot);
  assert.equal(props['--ge-poster-route-fallback'], 'url("/assets/states/state-route-fallback.png")');
  assert.equal(props['--ge-poster-outside-register'], 'url("/assets/states/state-outside-aoi.png")');
  assert.equal(Object.keys(set).length, Object.keys(POSTERS).length);
  assert.deepEqual(applyPosterTokens(null), {});
});
