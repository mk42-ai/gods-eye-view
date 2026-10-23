import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createScene,
  createFootageItem,
  sceneLifecycle,
  newSceneId,
  SCENE_STATES,
  SOURCE_PLATFORMS,
  STAGES,
} from './models.js';

describe('models & lifecycle', () => {
  it('newSceneId generates IDs starting with s_', () => {
    const id1 = newSceneId();
    const id2 = newSceneId();
    assert.match(id1, /^s_[a-z0-9]+$/);
    assert.match(id2, /^s_[a-z0-9]+$/);
    assert.notStrictEqual(id1, id2);
  });

  it('createScene produces complete default schema', () => {
    const scene = createScene();
    assert.match(scene.id, /^s_/);
    assert.strictEqual(scene.label, 'UAE Interest Watch');
    assert.strictEqual(scene.kind, 'live');
    assert.strictEqual(scene.status, 'idle');
    assert.deepEqual(Object.keys(scene.sources), [...SOURCE_PLATFORMS]);
    assert.strictEqual(scene.preset.alt, 18000);
    assert.strictEqual(scene.camera.stage, 'S0');
    assert.strictEqual(scene.lifecycle.isNew, true);
    assert.strictEqual(scene.lifecycle.isArchived, false);
  });

  it('createFootageItem produces item schema', () => {
    const item = createFootageItem({
      id: 'f1',
      sceneId: 's_1',
      platform: 'tiktok',
      rankScore: 0.85,
    });
    assert.strictEqual(item.id, 'f1');
    assert.strictEqual(item.sceneId, 's_1');
    assert.strictEqual(item.platform, 'tiktok');
    assert.strictEqual(item.rankScore, 0.85);
    assert.strictEqual(item.recency, 'LIVE');
    assert.strictEqual(item.location.confidence, 'unknown');
  });

  it('sceneLifecycle computes isNew/archived at +1h, +25h, and +73h', () => {
    const t0 = Date.parse('2026-10-23T00:00:00.000Z');
    const scene = createScene({}, t0);

    // At +1h
    const lc1h = sceneLifecycle(scene, t0 + 1 * 3600_000);
    assert.strictEqual(lc1h.isNew, true, '+1h should be isNew=true');
    assert.strictEqual(lc1h.isArchived, false, '+1h should not be archived');

    // At +25h
    const lc25h = sceneLifecycle(scene, t0 + 25 * 3600_000);
    assert.strictEqual(lc25h.isNew, false, '+25h should be isNew=false');
    assert.strictEqual(lc25h.isArchived, false, '+25h should not be archived');

    // At +73h
    const lc73h = sceneLifecycle(scene, t0 + 73 * 3600_000);
    assert.strictEqual(lc73h.isNew, false, '+73h should be isNew=false');
    assert.strictEqual(lc73h.isArchived, true, '+73h should be archived');
  });

  it('exports frozen lists of constants', () => {
    assert.ok(Array.isArray(SCENE_STATES));
    assert.ok(SCENE_STATES.includes('idle'));
    assert.ok(SCENE_STATES.includes('saved'));
    assert.deepEqual(SOURCE_PLATFORMS, [
      'tiktok',
      'instagram',
      'youtube',
      'x',
      'reddit',
      'web',
    ]);
    assert.deepEqual(STAGES, ['S0', 'S1', 'S2', 'S3', 'S4']);
  });
});
