import test from 'node:test';
import assert from 'node:assert/strict';
import { purgeStaleServiceWorkers } from './staleServiceWorkers.js';

test('unregisters every stale service worker and clears Cache Storage; never registers one', async () => {
  const unregistered = [];
  const registrations = [
    { unregister: () => (unregistered.push('a'), Promise.resolve(true)) },
    { unregister: () => (unregistered.push('b'), Promise.resolve(true)) },
  ];
  const deleted = [];
  const out = await purgeStaleServiceWorkers({
    navigator: {
      serviceWorker: {
        getRegistrations: () => Promise.resolve(registrations),
        register: () => {
          throw new Error('must never register');
        },
      },
    },
    caches: {
      keys: () => Promise.resolve(['old-build', 'tiles']),
      delete: (k) => (deleted.push(k), Promise.resolve(true)),
    },
  });
  assert.deepEqual(unregistered, ['a', 'b']);
  assert.deepEqual(deleted, ['old-build', 'tiles']);
  assert.deepEqual(out, { workers: 2, caches: 2 });
});

test('is a no-op without service worker or cache support', async () => {
  assert.deepEqual(await purgeStaleServiceWorkers({ navigator: {}, caches: undefined }), { workers: 0, caches: 0 });
});
