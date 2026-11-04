import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCinematicPanel } from './cinematicPanel.js';
import { RUNTIME_MODES, RUN_STATES } from '../events.js';

function makeDoc() {
  const doc = {};
  function mk(tag) {
    const attrs = new Map();
    const listeners = new Map();
    let ownText = '';

    const node = {
      tagName: tag.toUpperCase(),
      id: '',
      type: '',
      value: '',
      checked: false,
      placeholder: '',
      min: '',
      max: '',
      step: '',
      selected: false,
      children: [],
      parentNode: null,
      dataset: {},
      get textContent() {
        return ownText + this.children.map((c) => c.textContent).join('');
      },
      set textContent(v) {
        ownText = String(v);
        for (const c of this.children) c.parentNode = null;
        this.children = [];
      },
      get innerHTML() {
        return this.textContent;
      },
      set innerHTML(v) {
        this.textContent = v;
      },
      get className() {
        return attrs.get('class') || '';
      },
      set className(v) {
        attrs.set('class', v);
      },
      setAttribute(n, v) {
        attrs.set(n, String(v));
      },
      getAttribute(n) {
        return attrs.get(n) ?? null;
      },
      removeAttribute(n) {
        attrs.delete(n);
      },
      append(...kids) {
        for (const k of kids) {
          if (typeof k === 'string') {
            this.append(doc.createTextNode(k));
            continue;
          }
          if (k.parentNode) k.remove();
          this.children.push(k);
          k.parentNode = this;
        }
      },
      prepend(kid) {
        if (kid.parentNode) kid.remove();
        this.children.unshift(kid);
        kid.parentNode = this;
      },
      remove() {
        if (this.parentNode) {
          this.parentNode.children = this.parentNode.children.filter(
            (c) => c !== this,
          );
          this.parentNode = null;
        }
      },
      get firstChild() {
        return this.children[0] || null;
      },
      get lastChild() {
        return this.children[this.children.length - 1] || null;
      },
      addEventListener(evt, fn) {
        if (!listeners.has(evt)) listeners.set(evt, []);
        listeners.get(evt).push(fn);
      },
      dispatchEvent(eventObj) {
        const type = typeof eventObj === 'string' ? eventObj : eventObj?.type;
        const list = listeners.get(type) || [];
        for (const fn of list) {
          fn(eventObj || { type, preventDefault() {} });
        }
      },
      find(pred) {
        return this.children.flatMap((c) => [
          ...(pred(c) ? [c] : []),
          ...c.find(pred),
        ]);
      },
      matches(sel) {
        if (sel.startsWith('#')) return this.id === sel.slice(1);
        if (sel.startsWith('.'))
          return this.className.split(/\s+/).includes(sel.slice(1));
        if (sel.startsWith('[')) {
          const match = sel.match(
            /\[([a-zA-Z0-9_-]+)(?:=['"]?([^'"\]]+)['"]?)?\]/,
          );
          if (match) {
            const attr = match[1];
            const val = match[2];
            const has = attrs.has(attr);
            return val !== undefined ? attrs.get(attr) === val : has;
          }
        }
        return this.tagName === sel.toUpperCase();
      },
      querySelector(sel) {
        return this.find((c) => c.matches(sel))[0] || null;
      },
      querySelectorAll(sel) {
        return this.find((c) => c.matches(sel));
      },
    };
    return node;
  }

  doc.createElement = mk;
  doc.createTextNode = (txt) => {
    const node = mk('span');
    node.textContent = txt;
    return node;
  };
  doc.body = mk('body');
  return doc;
}

function makeFakeWin() {
  const store = new Map();
  const listeners = new Map();
  return {
    localStorage: {
      getItem(k) {
        return store.get(k) || null;
      },
      setItem(k, v) {
        store.set(k, String(v));
      },
    },
    addEventListener(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, []);
      listeners.get(evt).push(fn);
    },
    removeEventListener(evt, fn) {
      if (listeners.has(evt)) {
        listeners.set(
          evt,
          listeners.get(evt).filter((f) => f !== fn),
        );
      }
    },
    dispatchEvent(evt) {
      const type = typeof evt === 'string' ? evt : evt?.type;
      for (const fn of listeners.get(type) || []) {
        fn(evt);
      }
    },
    requestAnimationFrame(cb) {
      cb();
      return 1;
    },
    cancelAnimationFrame() {},
  };
}

test('cinematicPanel: mounts all 20 required element IDs', () => {
  const doc = makeDoc();
  const win = makeFakeWin();
  const panel = mountCinematicPanel({ document: doc, window: win });
  const el = panel.element;

  const expectedIds = [
    'cinematic-panel',
    'cinematic-mode',
    'cinematic-run-state',
    'cinematic-stages',
    'cinematic-model',
    'cinematic-metrics',
    'cinematic-model-picker',
    'cinematic-autodirect',
    'cinematic-feed',
    'cinematic-inject-closure',
    'cinematic-play',
    'cinematic-pause',
    'cinematic-restart',
    'cinematic-seek',
    'cinematic-speed',
    'cinematic-camera-mode',
    'cinematic-position',
    'cinematic-qa-form',
    'cinematic-qa-input',
    'cinematic-qa-send',
    'cinematic-qa-log',
  ];

  for (const id of expectedIds) {
    if (el.id === id) continue;
    const found = el.querySelector(`#${id}`);
    assert.ok(found, `Expected element #${id} to exist in cinematic panel`);
  }
});

test('cinematicPanel: update changes mode, run-state, stages, model and metrics', () => {
  const doc = makeDoc();
  const win = makeFakeWin();
  const panel = mountCinematicPanel({ document: doc, window: win });
  const el = panel.element;

  panel.update(
    {
      runState: 'running',
      stage: 'C',
      stages: { A: 120, B: 240, C: 380 },
      model: {
        endpointId: 'predefined-cerebras-qwen-3.8-27b',
        provider: 'cerebras',
        ttftMs: 140,
        tokensPerSec: 18.5,
        tokensPerSecMeasured: true,
      },
      metrics: {
        firstSceneInstructionMs: 310,
        firstRenderedObjectMs: 420,
        firstPlayableShotMs: 550,
        fps: 58,
        heapUsedMb: 42.5,
      },
    },
    {
      mode: RUNTIME_MODES.RECONSTRUCTION,
      timeline: { durationSec: 120 },
    },
  );

  const modeEl = el.querySelector('#cinematic-mode');
  assert.equal(modeEl.textContent, 'Evidence-Driven Reconstruction');

  const runStateEl = el.querySelector('#cinematic-run-state');
  assert.equal(runStateEl.getAttribute('data-state'), 'running');
  assert.equal(runStateEl.textContent, 'Running');

  const modelEl = el.querySelector('#cinematic-model');
  assert.ok(modelEl.textContent.includes('predefined-cerebras-qwen-3.8-27b'));
  assert.ok(modelEl.textContent.includes('cerebras'));
  assert.ok(modelEl.textContent.includes('TTFT 140 ms'));
  assert.ok(modelEl.textContent.includes('18.5 tok/s'));

  const metricsEl = el.querySelector('#cinematic-metrics');
  assert.ok(metricsEl.textContent.includes('310ms'));
  assert.ok(metricsEl.textContent.includes('550ms'));
  assert.ok(metricsEl.textContent.includes('58 FPS'));
});

test('cinematicPanel: setModels populates pickers and change updates onModelChange & localStorage', () => {
  const doc = makeDoc();
  const win = makeFakeWin();
  let changed = null;

  const panel = mountCinematicPanel({
    document: doc,
    window: win,
    onModelChange(task, id) {
      changed = { task, id };
    },
  });

  const models = [
    { endpointId: 'model-a', name: 'Model A' },
    { endpointId: 'model-b', name: 'Model B' },
  ];
  panel.setModels(models, { scene_direction: 'model-a' });

  const picker = panel.element.querySelector('[data-task="scene_direction"]');
  assert.ok(picker);
  assert.equal(picker.children.length, 2);

  // Trigger change
  picker.value = 'model-b';
  picker.dispatchEvent({ type: 'change' });

  assert.deepEqual(changed, { task: 'scene_direction', id: 'model-b' });
  const saved = JSON.parse(win.localStorage.getItem('gev.cinematic.models.v1'));
  assert.equal(saved.scene_direction, 'model-b');
});

test('cinematicPanel: inject button triggers inject handler', () => {
  const doc = makeDoc();
  const win = makeFakeWin();
  let injectedKind = null;

  const panel = mountCinematicPanel({
    document: doc,
    window: win,
    inject(kind) {
      injectedKind = kind;
    },
  });

  const btn = panel.element.querySelector('#cinematic-inject-closure');
  btn.dispatchEvent({ type: 'click' });
  assert.equal(injectedKind, 'road_closure');
});

test('cinematicPanel: autodirect checkbox notifies liveDirector', () => {
  const doc = makeDoc();
  const win = makeFakeWin();
  let setAutoDirectVal = null;

  const panel = mountCinematicPanel({
    document: doc,
    window: win,
    liveDirector: {
      setAutoDirect(v) {
        setAutoDirectVal = v;
      },
    },
  });

  const chk = panel.element.querySelector('#cinematic-autodirect');
  chk.checked = false;
  chk.dispatchEvent({ type: 'change' });
  assert.equal(setAutoDirectVal, false);
});

test('cinematicPanel: playback controls invoke playback controller methods', () => {
  const doc = makeDoc();
  const win = makeFakeWin();
  const calls = [];

  const playback = {
    play() {
      calls.push('play');
    },
    pause() {
      calls.push('pause');
    },
    seek(s) {
      calls.push(`seek:${s}`);
    },
    setSpeed(x) {
      calls.push(`speed:${x}`);
    },
    setCameraMode(m) {
      calls.push(`camera:${m}`);
    },
  };

  const panel = mountCinematicPanel({ document: doc, window: win, playback });
  const el = panel.element;

  el.querySelector('#cinematic-play').dispatchEvent({ type: 'click' });
  el.querySelector('#cinematic-pause').dispatchEvent({ type: 'click' });
  el.querySelector('#cinematic-restart').dispatchEvent({ type: 'click' });

  assert.ok(calls.includes('play'));
  assert.ok(calls.includes('pause'));
  assert.ok(calls.includes('seek:0'));
});

test('cinematicPanel: appendFeed prepends items and caps at 50', () => {
  const doc = makeDoc();
  const win = makeFakeWin();
  const panel = mountCinematicPanel({ document: doc, window: win });
  const feed = panel.element.querySelector('#cinematic-feed');

  for (let i = 1; i <= 60; i++) {
    panel.appendFeed(`Event ${i}`);
  }

  assert.equal(feed.children.length, 50);
  assert.equal(feed.children[0].textContent, 'Event 60');
});

test('cinematicPanel: Q&A form submits, queries client, executes commands and logs results', async () => {
  const doc = makeDoc();
  const win = makeFakeWin();

  let askedQuestion = '';
  const client = {
    async cinematicQa(q, ctx) {
      askedQuestion = q;
      return {
        answer: 'I closed the road and focused the camera.',
        commands: [{ command: 'show_route_closed' }],
      };
    },
  };

  let executedCmds = [];
  const qaExecutor = {
    async execute(cmds) {
      executedCmds = cmds;
      return [{ command: 'show_route_closed', ok: true, confirmed: true }];
    },
  };

  const panel = mountCinematicPanel({
    document: doc,
    window: win,
    client,
    qaExecutor,
  });
  const el = panel.element;

  const form = el.querySelector('#cinematic-qa-form');
  const input = el.querySelector('#cinematic-qa-input');
  const log = el.querySelector('#cinematic-qa-log');

  input.value = 'Show me the road closure';
  form.dispatchEvent({ type: 'submit', preventDefault() {} });

  // Yield microtasks for async QA execution
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(askedQuestion, 'Show me the road closure');
  assert.equal(executedCmds.length, 1);
  assert.equal(executedCmds[0].command, 'show_route_closed');

  const logText = log.textContent;
  assert.ok(logText.includes('Q: Show me the road closure'));
  assert.ok(logText.includes('I closed the road and focused the camera.'));
  assert.ok(logText.includes('confirmed: show_route_closed'));
});

test('panel exposes the Open-Meteo live-weather button and routes failures to the feed', async () => {
  const doc = makeDoc();
  const win = makeFakeWin();
  let calls = 0;
  const panel = mountCinematicPanel({
    document: doc,
    window: win,
    pullLiveWeather: async () => {
      calls += 1;
      throw new Error('Open-Meteo HTTP 503');
    },
  });
  const btn = panel.element.querySelector('#cinematic-pull-weather');
  assert.ok(btn, 'weather button must exist');
  assert.ok(btn.textContent.includes('Open-Meteo'));
  btn.dispatchEvent({ type: 'click' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 1);
  const feed = panel.element.querySelector('#cinematic-feed');
  assert.ok(
    feed.textContent.includes('Live weather unavailable: Open-Meteo HTTP 503'),
  );
  panel.destroy();
});

test('cinematicPanel: playhead progressbar reflects seek position and position label shows m:ss / m:ss', () => {
  const doc = makeDoc();
  const win = makeFakeWin();
  let pos = 30;
  const playback = {
    positionSec: () => pos,
    durationSec: () => 60,
    state: () => ({ state: 'playing', positionSec: pos, durationSec: 60 }),
  };

  const panel = mountCinematicPanel({ document: doc, window: win, playback });
  const playhead = panel.element.querySelector('#cinematic-playhead');
  assert.ok(playhead, '#cinematic-playhead element must exist');
  assert.equal(playhead.getAttribute('role'), 'progressbar');

  panel.update({}, { timeline: { durationSec: 60 } });
  assert.equal(playhead.getAttribute('aria-valuenow'), '50');

  const posSpan = panel.element.querySelector('#cinematic-position');
  assert.equal(posSpan.textContent, '0:30 / 1:00');
  panel.destroy();
});

test('cinematicPanel: button states (aria-pressed, data-state, disabled) reflect playback and scene status', () => {
  const doc = makeDoc();
  const win = makeFakeWin();
  let pbState = { state: 'paused', positionSec: 0, durationSec: 60 };
  const playback = {
    positionSec: () => pbState.positionSec,
    durationSec: () => pbState.durationSec,
    state: () => pbState,
    play() {},
    pause() {},
  };

  const panel = mountCinematicPanel({ document: doc, window: win, playback });
  const playBtn = panel.element.querySelector('#cinematic-play');
  const pauseBtn = panel.element.querySelector('#cinematic-pause');

  // Initially with scene: buttons enabled
  panel.update({ playback: pbState }, { timeline: { durationSec: 60 } });
  assert.equal(playBtn.disabled, false);
  assert.equal(playBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(pauseBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(playBtn.getAttribute('data-state'), 'paused');

  // Playing state
  pbState = { state: 'playing', positionSec: 15, durationSec: 60 };
  panel.update({ playback: pbState }, { timeline: { durationSec: 60 } });
  assert.equal(playBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(pauseBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(playBtn.getAttribute('data-state'), 'playing');

  // Ended state
  pbState = { state: 'ended', positionSec: 60, durationSec: 60 };
  panel.update({ playback: pbState }, { timeline: { durationSec: 60 } });
  assert.equal(playBtn.getAttribute('data-state'), 'ended');

  panel.destroy();
});

test('cinematicPanel: Space bar toggles playback when focus is not in an input and ignores input focus', () => {
  const doc = makeDoc();
  const win = makeFakeWin();
  const actions = [];
  let isPlaying = false;

  const playback = {
    state: () => ({ state: isPlaying ? 'playing' : 'paused' }),
    play: () => {
      isPlaying = true;
      actions.push('play');
    },
    pause: () => {
      isPlaying = false;
      actions.push('pause');
    },
  };

  const panel = mountCinematicPanel({ document: doc, window: win, playback });

  // Space on document body -> play
  win.dispatchEvent({
    type: 'keydown',
    code: 'Space',
    preventDefault() {},
  });
  assert.deepEqual(actions, ['play']);

  // Space on document body again -> pause
  win.dispatchEvent({
    type: 'keydown',
    code: 'Space',
    preventDefault() {},
  });
  assert.deepEqual(actions, ['play', 'pause']);

  // Focus in an input -> Space should be ignored
  const input = doc.createElement('input');
  doc.activeElement = input;

  win.dispatchEvent({
    type: 'keydown',
    code: 'Space',
    preventDefault() {},
  });
  // No new action
  assert.deepEqual(actions, ['play', 'pause']);

  panel.destroy();
});
