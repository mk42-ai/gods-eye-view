import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSceneStudio,
  DEFAULT_NARRATION_CONFIG,
  describeConstructedScene,
  measuredNarrationFit,
} from './ui/sceneStudio.js';
import { locationQueryForPrompt, planFromCandidates } from './client.js';
import { evidenceKey } from '../sceneEvidence/model.js';
import {
  buildPlannedScene,
  createGeographicSceneStore,
} from '../scenes/geographicScene.js';
import { incidentSceneToProjectScene } from '../scenes/incidentScenes.js';
import { validateScenePlan } from '../scenes/structuredPlan.js';

function fixture() {
  return {
    version: 1,
    title: 'Illustrative test scene',
    illustrative: true,
    durationSec: 24,
    location: {
      name: 'Burj Khalifa',
      lat: 25.1970336,
      lon: 55.2741329,
      sourceUrl: 'https://www.openstreetmap.org/way/446646206',
    },
    camera: { distanceM: 180, heading: 40, pitch: -45, framing: 'wide' },
    entities: [
      {
        id: 'runners',
        type: 'runner',
        label: 'Runners',
        quantity: 6,
        position: { eastM: 4, northM: 12 },
        heading: 90,
      },
    ],
    relationships: [],
    beats: [
      {
        atSec: 0,
        title: 'Establish',
        narration: 'Six illustrative runners wait.',
        entityIds: ['runners'],
      },
      {
        atSec: 12,
        title: 'Start',
        narration: 'The illustrated start area is framed.',
        entityIds: ['runners'],
      },
    ],
    citations: [],
    verification: {
      status: 'location_verified',
      locationSource: 'fixture',
      checkedAt: '2026-10-31T00:00:00Z',
      limitations: ['Synthetic test data, not a real event.'],
    },
  };
}
function mockDoc() {
  const all = [];
  const doc = {
    defaultView: {},
    createElement(tag) {
      const listeners = new Map();
      const e = {
        tagName: tag.toUpperCase(),
        children: [],
        dataset: {},
        attrs: {},
        value: '',
        paused: true,
        duration: NaN,
        setAttribute(k, v) {
          this.attrs[k] = String(v);
        },
        removeAttribute(k) {
          delete this.attrs[k];
          if (k === 'src') this.src = '';
        },
        append(...c) {
          this.children.push(...c);
        },
        replaceChildren(...c) {
          this.children = c;
        },
        remove() {},
        addEventListener(k, f) {
          listeners.set(k, [...(listeners.get(k) || []), f]);
        },
        removeEventListener(k, f) {
          listeners.set(
            k,
            (listeners.get(k) || []).filter((x) => x !== f),
          );
        },
        async emit(k) {
          return Promise.all(
            (listeners.get(k) || []).map((f) => f({ preventDefault() {} })),
          );
        },
        pause() {
          this.paused = true;
        },
        load() {},
        async play() {
          this.paused = false;
        },
      };
      all.push(e);
      return e;
    },
    getElementById(id) {
      return all.find((e) => e.id === id);
    },
  };
  return doc;
}
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function scene() {
  const plan = fixture();
  return { id: 'test-scene', anchor: plan.location, plan };
}

test('scene-aware description uses actual quantities, positions, framing and beats', () => {
  const s = describeConstructedScene(scene());
  for (const expected of [
    '6 Runners',
    '4 m east',
    '24 seconds',
    '180 m',
    '12s: Start',
    'not a confirmed incident',
  ])
    assert.ok(s.includes(expected), expected);
});
test('duration fit is measured audio math, never estimated from text', () => {
  assert.equal(measuredNarrationFit(NaN, 24), null);
  assert.deepEqual(measuredNarrationFit(30, 24), {
    measuredDurationSec: 30,
    sceneDurationSec: 24,
    rate: 1.25,
    canFit: true,
  });
  assert.equal(measuredNarrationFit(80, 24).canFit, false);
});
test('full multiline prompt and supported late location remain locatable', () => {
  assert.equal(
    locationQueryForPrompt('x'.repeat(2000) + ' near Burj Khalifa'),
    'Burj Khalifa',
  );
  assert.equal(
    locationQueryForPrompt('Location: Umm Suqeim\nSix runners, 24 seconds'),
    'Umm Suqeim',
  );
});
test('two distinct nearby venues are not silently collapsed to one choice', () => {
  const one = {
    name: 'Venue A',
    lat: 25.2,
    lon: 55.3,
    aoi_membership: { inside: true },
  };
  assert.equal(
    planFromCandidates([one, { ...one, name: 'Venue B', lat: 25.28 }]).kind,
    'pick',
  );
});
test('platform allowlist is part of cached evidence identity', () => {
  const input = { sceneId: 'fixture', text: 'fixture', lat: 25.2, lon: 55.3 };
  assert.notEqual(
    evidenceKey(input),
    evidenceKey({
      ...input,
      allowedPlatforms: ['youtube', 'tiktok', 'instagram'],
    }),
  );
});
test('actual director duration equals plan duration and short invalid beats fail at schema boundary', () => {
  const plan = fixture();
  const built = buildPlannedScene({
    plan,
    candidate: { ...plan.location, verified: true, source: 'geocode_place' },
    now: 0,
  });
  const played = incidentSceneToProjectScene(built);
  assert.equal(
    played.shots.reduce(
      (sum, shot) => sum + shot.durationSec + shot.holdSec,
      0,
    ),
    plan.durationSec,
  );
  plan.beats[1].atSec = 0.1;
  assert.throws(() => validateScenePlan(plan));
});
test('full ElevenLabs narration configuration survives existing browser-local store', () => {
  const plan = fixture();
  const built = buildPlannedScene({
    plan,
    candidate: { ...plan.location, verified: true, source: 'geocode_place' },
    now: 0,
  });
  built.narrationConfig = { ...DEFAULT_NARRATION_CONFIG };
  const data = new Map();
  const store = createGeographicSceneStore({
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
  });
  assert.equal(store.save(built).saved, true);
  assert.deepEqual(
    store.load(built.id).narrationConfig,
    DEFAULT_NARRATION_CONFIG,
  );
});
test('a changed voice cancels a pending request and re-enables generation', async () => {
  const doc = mockDoc(),
    pending = deferred();
  const ui = createSceneStudio({
    document: doc,
    onNarration: () => pending.promise,
  });
  ui.setScene(scene());
  const generate = doc.getElementById('scene-narration-generate');
  const job = generate.emit('click');
  assert.equal(generate.disabled, true);
  const voice = doc.getElementById('scene-narration-voice');
  voice.value = 'different-voice';
  await voice.emit('change');
  assert.equal(generate.disabled, false);
  pending.resolve({ audioUrl: 'https://media.example/new.mp3' });
  await job;
  assert.equal(doc.getElementById('scene-narration-audio').src || '', '');
  ui.destroy();
});
test('late audio.play completion cannot start an obsolete scene after replacement', async () => {
  const doc = mockDoc();
  let plays = 0;
  const ui = createSceneStudio({
    document: doc,
    onNarration: async () => ({ audioUrl: 'https://media.example/fresh.mp3' }),
    onPlay: () => plays++,
  });
  ui.setScene(scene());
  await doc.getElementById('scene-narration-generate').emit('click');
  const audio = doc.getElementById('scene-narration-audio');
  audio.duration = 24;
  await audio.emit('loadedmetadata');
  const delayed = deferred();
  audio.play = () => delayed.promise;
  const run = doc.getElementById('scene-narration-play').emit('click');
  ui.setScene({ ...scene(), id: 'replacement' });
  await doc.getElementById('scene-narration-generate').emit('click');
  audio.duration = 24;
  await audio.emit('loadedmetadata');
  delayed.resolve();
  await run;
  assert.equal(plays, 0);
  ui.destroy();
});

test('mute preference is saved with narration config and restored on load', async () => {
  const doc = mockDoc();
  const ui = createSceneStudio({ document: doc });
  ui.setScene(scene());
  await doc.getElementById('scene-narration-mute').emit('click');
  assert.equal(ui.getSnapshot().narrationConfig.muted, true);
  const saved = {
    ...scene(),
    narrationConfig: ui.getSnapshot().narrationConfig,
  };
  ui.setScene(saved);
  assert.equal(ui.getState().audio.muted, true);
  ui.destroy();
});
