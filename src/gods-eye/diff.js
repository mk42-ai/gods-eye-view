/**
 * Recreate diff — compares the previous footage set with the freshly
 * ranked one. Items are matched by id (platform + canonical url).
 * `added` items are flagged `diff:'new'` (animate-in), `removed` ones are
 * kept at the tail flagged `diff:'removed'` + `hidden:true` so the rail can
 * grey them as "no longer available" without re-ranking them.
 */
export function diffFootage(previous = [], next = []) {
  const prevIds = new Set(previous.map((f) => f.id));
  const nextIds = new Set(next.map((f) => f.id));
  let added = 0;
  let unchanged = 0;
  const items = next.map((f) => {
    if (prevIds.has(f.id)) {
      unchanged += 1;
      return { ...f, diff: 'unchanged' };
    }
    added += 1;
    return { ...f, diff: 'new' };
  });
  const removedItems = previous
    .filter((f) => !nextIds.has(f.id))
    .map((f) => ({ ...f, diff: 'removed', hidden: true }));
  return {
    items: [...items, ...removedItems],
    summary: { added, removed: removedItems.length, unchanged },
  };
}

/** '+N new · M removed · K unchanged' */
export function formatDiff(summary) {
  if (!summary) return '';
  return `+${summary.added} new · ${summary.removed} removed · ${summary.unchanged} unchanged`;
}
