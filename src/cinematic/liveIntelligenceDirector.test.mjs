import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveIntelligenceDirector } from './liveIntelligenceDirector.js';

function makeValidPatch({
  patchId = 'patch-test-1',
  sceneId = 'scene-alpha',
  baseVersion = 0,
  priority = 'high',
  entityId = 'ent-ev-snap-test1',
  assetId = 'sprite.alert.state_4',
  tier = 'verified',
} = {}) {
  return {
    patchId,
    sceneId,
    baseVersion,
    source: 'intelligence',
    priority,
    reason: 'Incoming verified intelligence',
    ops: [
      {
        op: 'add_evidence',
        evidence: {
          id: 'ev-snap-test1',
          source: 'snapchat',
          tier,
          title: 'Footage item',
          url: 'https://www.snapchat.com/spotlight/test1',
        },
      },
      {
        op: 'add_entity',
        entity: {
          id: entityId,
          assetId,
          label: 'Snapchat · verified · 12:00 UTC',
          category: 'marker',
          position: { eastM: 100, northM: 200 },
          headingDeg: 0,
          scale: 1,
          count: 1,
          spreadM: 0,
          behavior: { type: 'static' },
          startSec: 0,
          endSec: null,
          uncertainty: tier === 'verified' ? 'verified' : 'approximate',
          provenance: {
            kind: 'evidence',
            evidenceId: 'ev-snap-test1',
            tier,
          },
          highlight: false,
          hypothetical: false,
          tags: ['snapchat'],
        },
      },
    ],
  };
}

test('liveIntelligenceDirector: autoDirect=true + high priority triggers cameraDirector.interrupt ("interrupted")', () => {
  const highlighted = [];
  const runtime = {
    setHighlight(id, on, state) {
      highlighted.push({ id, on, state });
    },
  };
  const playback = {
    _pos: 15.5,
    positionSec() {
      return this._pos;
    },
    seek(sec) {
      throw new Error(`seek should never be called, attempted: ${sec}`);
    },
  };
  let interruptedShot = null;
  const cameraDirector = {
    interrupt(shot, meta) {
      interruptedShot = { shot, meta };
      return true; // accepted
    },
  };

  const director = createLiveIntelligenceDirector({
    runtime,
    playback,
    cameraDirector,
    autoDirect: true,
  });

  const patch = makeValidPatch({ priority: 'high' });
  const res = director.receive({ patch, priority: 'high' });

  assert.equal(res.camera, 'interrupted');
  assert.equal(res.eventId, 'patch-test-1');
  assert.ok(interruptedShot);
  assert.equal(interruptedShot.shot.type, 'overhead_intelligence');
  assert.equal(interruptedShot.shot.startSec, 15.5);
  assert.deepEqual(interruptedShot.shot.subjectIds, ['ent-ev-snap-test1']);
  assert.equal(director.queue().length, 0);

  // Check feed entry
  const feed = director.feed();
  assert.equal(feed.length, 1);
  assert.equal(feed[0].camera, 'interrupted');
  assert.equal(feed[0].tier, 'verified');
});

test('liveIntelligenceDirector: queued when cameraDirector refuses interrupt', () => {
  const runtime = { setHighlight() {} };
  const playback = { positionSec: () => 20 };
  const cameraDirector = {
    interrupt() {
      return false; // refused (e.g. higher priority shot active)
    },
  };

  const director = createLiveIntelligenceDirector({
    runtime,
    playback,
    cameraDirector,
    autoDirect: true,
  });

  const patch = makeValidPatch({ priority: 'high' });
  const res = director.receive({ patch });

  assert.equal(res.camera, 'queued');
  assert.equal(director.queue().length, 1);
  assert.equal(director.queue()[0].shot.type, 'overhead_intelligence');

  const flushed = director.flushQueue();
  assert.equal(flushed.length, 1);
  assert.equal(director.queue().length, 0);
});

test('liveIntelligenceDirector: annotated when priority/relevance is normal/low', () => {
  const highlighted = [];
  const runtime = {
    setHighlight(id, on, state) {
      highlighted.push({ id, on, state });
    },
  };
  const playback = { positionSec: () => 10 };
  let interruptCalled = false;
  const cameraDirector = {
    interrupt() {
      interruptCalled = true;
      return true;
    },
  };

  const director = createLiveIntelligenceDirector({
    runtime,
    playback,
    cameraDirector,
    autoDirect: true,
  });

  const patch = makeValidPatch({ priority: 'normal', tier: 'candidate' });
  const res = director.receive({ patch, priority: 'normal', relevance: 0.4 });

  assert.equal(res.camera, 'annotated');
  assert.equal(interruptCalled, false);
  assert.equal(highlighted.length, 1);
  assert.equal(highlighted[0].id, 'ent-ev-snap-test1');
  assert.equal(highlighted[0].state, 2);
});

test('liveIntelligenceDirector: setAutoDirect(false) disables camera interruption', () => {
  let interruptCalled = false;
  const cameraDirector = {
    interrupt() {
      interruptCalled = true;
      return true;
    },
  };
  const runtime = { setHighlight() {} };
  const playback = { positionSec: () => 5 };

  const director = createLiveIntelligenceDirector({
    runtime,
    playback,
    cameraDirector,
    autoDirect: true,
  });

  director.setAutoDirect(false);
  assert.equal(director.autoDirect(), false);

  const patch = makeValidPatch({ priority: 'high' });
  const res = director.receive({ patch, priority: 'high', relevance: 0.95 });

  assert.equal(
    interruptCalled,
    false,
    'interrupt must not be called when autoDirect is false',
  );
  assert.equal(res.camera, 'annotated');
  // High-priority item with autoDirect=false is queued as well
  assert.equal(director.queue().length, 1);
});

test('liveIntelligenceDirector: invalid patch is safely rejected without throwing', () => {
  const director = createLiveIntelligenceDirector();

  const invalidPatch = {
    patchId: 'short', // invalid schema: min 4
    sceneId: '',
    ops: [],
  };

  const res = director.receive({ patch: invalidPatch });
  assert.equal(res.camera, 'none');
  assert.equal(res.applied.length, 0);
  assert.ok(res.rejected.length > 0);
  assert.equal(res.rejected[0].reason, 'invalid_patch');
});

test('liveIntelligenceDirector: never calls playback.seek backwards (no rewind)', () => {
  let seekCalled = false;
  const playback = {
    positionSec: () => 42.0,
    seek() {
      seekCalled = true;
    },
  };
  const cameraDirector = { interrupt: () => true };
  const runtime = { setHighlight() {} };

  const director = createLiveIntelligenceDirector({
    runtime,
    playback,
    cameraDirector,
  });

  const patch = makeValidPatch();
  director.receive({ patch });

  assert.equal(
    seekCalled,
    false,
    'playback.seek must never be invoked on intelligence arrival',
  );
});

test('liveIntelligenceDirector: onScenePatchEvent handles SSE intelligence.received and emits intelligence.validated', () => {
  const events = [];
  const onEvent = (name, data) => events.push({ name, data });

  const director = createLiveIntelligenceDirector({
    onEvent,
    cameraDirector: { interrupt: () => true },
  });

  const patch = makeValidPatch({ patchId: 'patch-sse-123', priority: 'high' });
  const sseEvent = {
    id: 'run-1:4',
    event: 'intelligence.received',
    data: {
      runId: 'run-1',
      sceneId: 'scene-alpha',
      priority: 'high',
      relevance: 0.9,
      patch,
    },
  };

  const res = director.onScenePatchEvent(sseEvent);
  assert.ok(res);
  assert.equal(res.camera, 'interrupted');

  assert.equal(events.length, 1);
  assert.equal(events[0].name, 'intelligence.validated');
  assert.equal(events[0].data.runId, 'run-1');
  assert.equal(events[0].data.sceneId, 'scene-alpha');
  assert.equal(events[0].data.patchId, 'patch-sse-123');
  assert.equal(events[0].data.camera, 'interrupted');
});
