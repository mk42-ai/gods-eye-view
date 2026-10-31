/** A location field may seed an empty/mirrored draft, never replace a typed composer. */
export function canMirrorLocationDraft({
  draft,
  lastMirrored = '',
  composerFocused = false,
} = {}) {
  const value = String(draft ?? '');
  // A focused composer belongs to the operator, even while empty: never seed it
  // mid-typing (that would move the caret or replace the first keystrokes).
  if (composerFocused) return false;
  return value === '' || value === String(lastMirrored ?? '');
}
