import test from 'node:test';
import assert from 'node:assert/strict';
import { canMirrorLocationDraft } from './ui/draftOwnership.js';

test('location changes may seed an empty draft without implying submission', () => {
  assert.equal(canMirrorLocationDraft({ draft: '' }), true);
});
test('location changes preserve an independently typed multiline composer', () => {
  assert.equal(
    canMirrorLocationDraft({
      draft: 'Location: Burj Khalifa\nThree people',
      lastMirrored: 'Burj Khalifa',
    }),
    false,
  );
});
test('an unfocused mirrored location can be intentionally replaced or cleared', () => {
  assert.equal(
    canMirrorLocationDraft({
      draft: 'Burj Khalifa',
      lastMirrored: 'Burj Khalifa',
    }),
    true,
  );
});
test('a focused typed draft cannot be overwritten even if it equals the previous mirror', () => {
  assert.equal(
    canMirrorLocationDraft({
      draft: 'Burj Khalifa',
      lastMirrored: 'Burj Khalifa',
      composerFocused: true,
    }),
    false,
  );
});
