/**
 * Gods-Eye Ranker Web Worker
 * Runs rankItems off the main UI thread.
 */

import { rankItems } from './ranker.js';

self.onmessage = ({ data }) => {
  if (!data) return;
  const { id, items, scene, nowMs } = data;
  try {
    const ranked = rankItems(items, scene, nowMs);
    self.postMessage({ id, items: ranked });
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
