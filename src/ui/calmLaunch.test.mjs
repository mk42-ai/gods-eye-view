import test from 'node:test';
import assert from 'node:assert/strict';
import { installCalmLaunch, markSceneReady, SCENE_READY_EVENTS } from './calmLaunch.js';

function env() {
  const listeners = new Map();
  const document = { body: { dataset: {} } };
  const window = {
    addEventListener: (t, fn) => listeners.set(t, fn),
    removeEventListener: (t) => listeners.delete(t),
  };
  return { document, window, listeners };
}

test('first load is calm: telemetry flag stays off until a scene is built', () => {
  const { document, window, listeners } = env();
  const calm = installCalmLaunch({ document, window });
  assert.equal(document.body.dataset.calmLaunch, 'true');
  assert.equal(document.body.dataset.sceneReady, 'false');
  assert.equal(calm.isSceneReady(), false);
  assert.deepEqual([...listeners.keys()].sort(), [...SCENE_READY_EVENTS].sort());
  listeners.get('gev:scene-evidence')();
  assert.equal(document.body.dataset.sceneReady, 'true');
  assert.equal(calm.isSceneReady(), true);
});

test('an incident ledger scene also reveals telemetry', () => {
  const { document, window, listeners } = env();
  installCalmLaunch({ document, window });
  listeners.get('gev:incident-scene-built')();
  assert.equal(document.body.dataset.sceneReady, 'true');
});

test('a share link restores an already-built view', () => {
  const { document, window } = env();
  installCalmLaunch({ document, window, hasShareState: true });
  assert.equal(document.body.dataset.sceneReady, 'true');
  assert.equal(markSceneReady(document), false, 'idempotent');
});

test('destroy removes listeners and a missing document is inert', () => {
  const { document, window, listeners } = env();
  installCalmLaunch({ document, window }).destroy();
  assert.equal(listeners.size, 0);
  assert.equal(installCalmLaunch({ document: {}, window }), null);
});
