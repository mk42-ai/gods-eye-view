/** Bound optional SDK work even when its transport has no AbortSignal support. */
export function providerDeadline(promise, ms = 3500, label = 'Map provider') {
  let timer;
  let expired = false;
  const work = Promise.resolve(promise).then((value) => {
    if (expired) { if (typeof value?.destroy === 'function' && !value.isDestroyed?.()) value.destroy(); return undefined; }
    return value;
  });
  return Promise.race([
    work,
    new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error(`${label} timed out after ${ms}ms`)); }, ms); }),
  ]).finally(() => clearTimeout(timer));
}
