/**
 * Gods-Eye Ranker Client
 * Manages module worker execution with correlation IDs and 3s fallback to sync ranking.
 */

import { rankItems } from './ranker.js';

/**
 * Creates a ranker instance using a Worker when available, falling back to sync rankItems.
 * @param {{ Worker?: Function, workerUrl?: string|URL }} options
 * @returns {{ rank: (items: Array, scene: object, nowMs?: number) => Promise<Array>, destroy: () => void }}
 */
export function createRanker({ Worker = globalThis.Worker, workerUrl } = {}) {
  let worker = null;
  let seq = 0;
  const pending = new Map();

  if (typeof Worker === 'function') {
    try {
      // Literal `new Worker(new URL(...), import.meta.url)` so Vite emits the
      // worker as its own chunk (an indirect URL is inlined as data: and its
      // relative import then fails at runtime).
      worker = workerUrl
        ? new Worker(workerUrl, { type: 'module' })
        : new Worker(new URL('./rank.worker.js', import.meta.url), {
            type: 'module',
          });

      worker.onmessage = ({ data }) => {
        if (!data || data.id === undefined) return;
        const entry = pending.get(data.id);
        if (!entry) return;
        pending.delete(data.id);
        if (entry.timer) clearTimeout(entry.timer);
        if (data.error) {
          entry.resolve(rankItems(entry.items, entry.scene, entry.nowMs));
        } else {
          entry.resolve(data.items);
        }
      };

      worker.onerror = () => {
        // On worker error, drain pending requests with sync ranking
        for (const [id, entry] of pending.entries()) {
          pending.delete(id);
          if (entry.timer) clearTimeout(entry.timer);
          entry.resolve(rankItems(entry.items, entry.scene, entry.nowMs));
        }
      };
    } catch {
      worker = null;
    }
  }

  function rank(items, scene, nowMs = Date.now()) {
    if (!worker) {
      return Promise.resolve(rankItems(items, scene, nowMs));
    }

    const id = ++seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve(rankItems(items, scene, nowMs));
        }
      }, 3000);

      pending.set(id, { resolve, timer, items, scene, nowMs });
      worker.postMessage({ id, items, scene, nowMs });
    });
  }

  function destroy() {
    for (const entry of pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    pending.clear();
    if (worker) {
      if (typeof worker.terminate === 'function') {
        worker.terminate();
      }
      worker = null;
    }
  }

  return { rank, destroy };
}
