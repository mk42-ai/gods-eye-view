import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reduce, initialState, SceneStateError } from './reducer.js';
import { createSceneStore } from './store.js';
import { createScene } from './models.js';

describe('reducer transitions', () => {
  it('allows full linear legal transition pipeline', () => {
    let state = initialState();
    const scene = createScene({ id: 's_test', status: 'idle' });
    state = reduce(state, { type: 'SCENE_UPSERT', payload: scene });

    const pipeline = [
      'parsing',
      'geocoded',
      'routing',
      'flying',
      'fetching',
      'ranked',
      'playing',
      'saved',
    ];

    for (const nextStatus of pipeline) {
      state = reduce(state, {
        type: 'SCENE_STATUS',
        payload: { id: 's_test', status: nextStatus },
      });
      assert.strictEqual(state.scenes['s_test'].status, nextStatus);
    }
  });

  it('allows saved -> routing (Recreate) and saved -> playing (Open)', () => {
    const scene = createScene({ id: 's_saved', status: 'saved' });
    let state = reduce(initialState(), {
      type: 'SCENE_UPSERT',
      payload: scene,
    });

    // saved -> routing
    let sRecreate = reduce(state, {
      type: 'SCENE_STATUS',
      payload: { id: 's_saved', status: 'routing' },
    });
    assert.strictEqual(sRecreate.scenes['s_saved'].status, 'routing');

    // saved -> playing
    let sOpen = reduce(state, {
      type: 'SCENE_STATUS',
      payload: { id: 's_saved', status: 'playing' },
    });
    assert.strictEqual(sOpen.scenes['s_saved'].status, 'playing');
  });

  it('allows any status -> error, and error -> parsing', () => {
    const scene = createScene({ id: 's_err', status: 'flying' });
    let state = reduce(initialState(), {
      type: 'SCENE_UPSERT',
      payload: scene,
    });

    state = reduce(state, {
      type: 'SCENE_STATUS',
      payload: {
        id: 's_err',
        status: 'error',
        error: { message: 'lost connection' },
      },
    });
    assert.strictEqual(state.scenes['s_err'].status, 'error');
    assert.deepEqual(state.scenes['s_err'].error, {
      message: 'lost connection',
    });

    state = reduce(state, {
      type: 'SCENE_STATUS',
      payload: { id: 's_err', status: 'parsing' },
    });
    assert.strictEqual(state.scenes['s_err'].status, 'parsing');
  });

  it('throws SceneStateError on illegal transitions', () => {
    const scene = createScene({ id: 's_bad', status: 'idle' });
    const state = reduce(initialState(), {
      type: 'SCENE_UPSERT',
      payload: scene,
    });

    assert.throws(
      () => {
        reduce(state, {
          type: 'SCENE_STATUS',
          payload: { id: 's_bad', status: 'flying' },
        });
      },
      (err) => {
        assert.ok(err instanceof SceneStateError);
        assert.strictEqual(err.from, 'idle');
        assert.strictEqual(err.to, 'flying');
        return true;
      },
    );

    const routingScene = createScene({ id: 's_bad2', status: 'routing' });
    const routingState = reduce(initialState(), {
      type: 'SCENE_UPSERT',
      payload: routingScene,
    });

    assert.throws(() => {
      reduce(routingState, {
        type: 'SCENE_STATUS',
        payload: { id: 's_bad2', status: 'idle' },
      });
    }, SceneStateError);
  });
});

describe('store operations', () => {
  it('beginScene aborts previous active scene signal', () => {
    const store = createSceneStore();
    const sig1 = store.beginScene('s_first');
    assert.strictEqual(sig1.aborted, false);

    const sig2 = store.beginScene('s_second');
    assert.strictEqual(sig1.aborted, true, 'previous signal must be aborted');
    assert.strictEqual(sig2.aborted, false, 'new signal must be active');
    assert.strictEqual(store.getState().activeId, 's_second');
  });

  it('mergeFootage dedupes by item.id and maintains rankScore desc', () => {
    const store = createSceneStore();
    const scene = createScene({ id: 's_foot', status: 'idle' });
    store.upsertScene(scene);
    store.beginScene('s_foot');

    const batch1 = [
      { id: 'item_1', rankScore: 0.4 },
      { id: 'item_2', rankScore: 0.9 },
    ];
    store.mergeFootage('s_foot', batch1);

    const footage1 = store.getState().scenes['s_foot'].footage;
    assert.strictEqual(footage1.length, 2);
    assert.strictEqual(footage1[0].id, 'item_2');
    assert.strictEqual(footage1[1].id, 'item_1');

    // Duplicate item_1 with higher rankScore, plus new item_3
    const batch2 = [
      { id: 'item_1', rankScore: 0.95 },
      { id: 'item_3', rankScore: 0.7 },
    ];
    store.mergeFootage('s_foot', batch2);

    const footage2 = store.getState().scenes['s_foot'].footage;
    assert.strictEqual(footage2.length, 3, 'deduped by item.id');
    assert.strictEqual(footage2[0].id, 'item_1');
    assert.strictEqual(footage2[0].rankScore, 0.95);
    assert.strictEqual(footage2[1].id, 'item_2');
    assert.strictEqual(footage2[2].id, 'item_3');
  });

  it('mergeFootage drops footage for stale (non-active) scene unless forced', () => {
    const store = createSceneStore();
    const s1 = createScene({ id: 's_active' });
    const s2 = createScene({ id: 's_stale' });
    store.upsertScene(s1);
    store.upsertScene(s2);

    store.beginScene('s_active');

    // Attempt merge onto s_stale without force
    store.mergeFootage('s_stale', [{ id: 'f1', rankScore: 0.9 }]);
    assert.strictEqual(store.getState().scenes['s_stale'].footage.length, 0);

    // Attempt merge with force: true
    store.mergeFootage('s_stale', [{ id: 'f1', rankScore: 0.9 }], {
      force: true,
    });
    assert.strictEqual(store.getState().scenes['s_stale'].footage.length, 1);
  });

  it('persists with 250ms debounce when status is in saved|playing|ranked', async () => {
    const savedCalls = [];
    const persistenceMock = {
      save: async (scene) => {
        savedCalls.push(scene.id);
        return scene;
      },
    };

    let fakeTimerCallback = null;
    let scheduledDelay = 0;
    const setTimeoutMock = (cb, ms) => {
      fakeTimerCallback = cb;
      scheduledDelay = ms;
      return 123;
    };
    const clearTimeoutMock = () => {
      fakeTimerCallback = null;
    };

    const store = createSceneStore({
      persistence: persistenceMock,
      setTimeoutImpl: setTimeoutMock,
      clearTimeoutImpl: clearTimeoutMock,
    });

    const scene = createScene({ id: 's_debounced', status: 'saved' });
    store.upsertScene(scene);

    assert.strictEqual(scheduledDelay, 250);
    assert.ok(fakeTimerCallback, 'debounced save must be scheduled');
    assert.strictEqual(savedCalls.length, 0, 'save not called synchronously');

    // Trigger timer
    await fakeTimerCallback();
    assert.strictEqual(savedCalls.length, 1);
    assert.strictEqual(savedCalls[0], 's_debounced');
  });
});
