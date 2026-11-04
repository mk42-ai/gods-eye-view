import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePromptLocation, cleanPlaceQuery, queryLadder } from './geocode.js';

test('known places resolve without any network call', async () => {
  const r = await resolvePromptLocation('concert crowd at etihad arena', { fetchImpl: async () => assert.fail('no fetch') });
  assert.equal(r.name, 'Etihad Arena');
  assert.equal(r.source, 'known-place-table');
});

test('a Nominatim miss falls back to the city named in the prompt, never throws', async () => {
  const r = await resolvePromptLocation('kanes boxing gym abu dhabi', { fetchImpl: async () => ({ ok: true, json: async () => [] }) });
  assert.equal(r.source, 'city-fallback');
  assert.equal(r.name, 'Abu Dhabi');
});

test('network failure and no city still yields prompt-only coordinates', async () => {
  const r = await resolvePromptLocation('mystery warehouse fire', { fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(r.source, 'prompt-only-fallback');
  assert.ok(Number.isFinite(r.lat) && Number.isFinite(r.lng));
});

test('query cleanup strips scenario words and builds a bounded ladder', () => {
  assert.equal(cleanPlaceQuery("car crash outside Kane's gym"), 'kanes gym');
  assert.deepEqual(queryLadder('yas mall west', 6), ['yas mall west', 'yas mall', 'mall west', 'yas', 'mall', 'west']);
});
