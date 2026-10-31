/** A location field may seed an empty/mirrored draft, never replace a typed composer. */
export function canMirrorLocationDraft({
  draft,
  lastMirrored = '',
  composerFocused = false,
} = {}) {
  const value = String(draft ?? '');
  if (composerFocused && value !== '') return false;
  return value === '' || value === String(lastMirrored ?? '');
}
