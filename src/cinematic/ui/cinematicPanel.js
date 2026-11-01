/**
 * Live Cinematic Intelligence Engine — UI Panel.
 *
 * Mounts #cinematic-panel into container (or document.body) with vanilla DOM,
 * keyboard accessibility, dark theme tokens, and requestAnimationFrame batching.
 *
 * Element ids:
 *   #cinematic-panel, #cinematic-mode, #cinematic-run-state, #cinematic-stages,
 *   #cinematic-model, #cinematic-metrics, #cinematic-model-picker,
 *   #cinematic-autodirect, #cinematic-feed, #cinematic-inject-closure,
 *   #cinematic-play, #cinematic-pause, #cinematic-restart, #cinematic-seek,
 *   #cinematic-speed, #cinematic-camera-mode, #cinematic-position,
 *   #cinematic-qa-form, #cinematic-qa-input, #cinematic-qa-send, #cinematic-qa-log
 */

import { RUNTIME_MODES, RUN_STATES, STAGES } from '../events.js';
import { buildQaContext } from '../qaCommands.js';

const MODE_LABELS = Object.freeze({
  [RUNTIME_MODES.SIMULATION]: 'Cinematic Simulation',
  [RUNTIME_MODES.RECONSTRUCTION]: 'Evidence-Driven Reconstruction',
  [RUNTIME_MODES.LIVE]: 'Live Intelligence Visualization',
});

const RUN_STATE_HUMAN = Object.freeze({
  idle: 'Idle',
  queued: 'Queued',
  running: 'Running',
  partially_completed: 'Partially Completed',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  timed_out: 'Timed Out',
});

const TASKS = Object.freeze([
  { id: 'scene_direction', label: 'Scene Direction' },
  { id: 'camera_direction', label: 'Camera Direction' },
  { id: 'scene_patch', label: 'Scene Patch' },
  { id: 'qa', label: 'Q&A' },
]);

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function mountCinematicPanel({
  document: doc = globalThis.document,
  window: win = globalThis.window,
  container,
  runtime,
  playback,
  cameraDirector,
  reducer,
  liveDirector,
  qaExecutor,
  client,
  onModelChange,
  inject,
  pullLiveWeather,
} = {}) {
  if (!doc) throw new Error('mountCinematicPanel requires a document');

  let destroyed = false;
  let pendingUpdate = null;
  let rafId = null;
  let lastState = null;
  let lastScene = null;
  const stageTimestamps = new Map();

  const root = doc.createElement('section');
  root.id = 'cinematic-panel';
  root.className = 'cinematic-panel';

  // 1. Header: Mode label + Run state badge
  const header = doc.createElement('div');
  header.className = 'cinematic-panel__header';

  const modeLabel = doc.createElement('div');
  modeLabel.id = 'cinematic-mode';
  modeLabel.className = 'cinematic-panel__mode';
  modeLabel.textContent = 'Cinematic Simulation';

  const runStateBadge = doc.createElement('div');
  runStateBadge.id = 'cinematic-run-state';
  runStateBadge.className = 'cinematic-panel__run-state';
  runStateBadge.setAttribute('data-state', 'idle');
  runStateBadge.textContent = 'Idle';

  header.append(modeLabel, runStateBadge);

  // 2. Stage progress (A-F)
  const stagesContainer = doc.createElement('div');
  stagesContainer.id = 'cinematic-stages';
  stagesContainer.className = 'cinematic-panel__stages';

  const stageRows = new Map();
  for (const [letter, stageKey] of Object.entries(STAGES)) {
    const row = doc.createElement('div');
    row.className = 'cinematic-stage-row';
    row.setAttribute('data-stage', letter);

    const nameSpan = doc.createElement('span');
    nameSpan.className = 'cinematic-stage-label';
    nameSpan.textContent = `Stage ${letter}: ${stageKey.replace(/_/g, ' ')}`;

    const timeSpan = doc.createElement('span');
    timeSpan.className = 'cinematic-stage-time';
    timeSpan.textContent = '--';

    row.append(nameSpan, timeSpan);
    stagesContainer.append(row);
    stageRows.set(letter, { row, timeSpan });
  }

  // 3. Model chip
  const modelChip = doc.createElement('div');
  modelChip.id = 'cinematic-model';
  modelChip.className = 'cinematic-panel__model';
  modelChip.textContent = 'No model selected';

  // 4. Metrics strip
  const metricsStrip = doc.createElement('div');
  metricsStrip.id = 'cinematic-metrics';
  metricsStrip.className = 'cinematic-panel__metrics';

  const metricFields = [
    { key: 'firstInstruction', label: '1st Instruction' },
    { key: 'firstObject', label: '1st Object' },
    { key: 'firstShot', label: '1st Shot' },
    { key: 'fps', label: 'FPS' },
    { key: 'heap', label: 'Heap' },
  ];
  const metricValues = new Map();

  for (const f of metricFields) {
    const item = doc.createElement('div');
    item.className = 'cinematic-metric-item';

    const lbl = doc.createElement('span');
    lbl.className = 'cinematic-metric-label';
    lbl.textContent = f.label;

    const val = doc.createElement('span');
    val.className = 'cinematic-metric-value';
    val.textContent = '--';

    item.append(lbl, val);
    metricsStrip.append(item);
    metricValues.set(f.key, val);
  }

  // 5. Model pickers
  const modelPickerContainer = doc.createElement('div');
  modelPickerContainer.id = 'cinematic-model-picker';
  modelPickerContainer.className = 'cinematic-panel__model-picker';

  const pickerSelects = new Map();
  for (const t of TASKS) {
    const row = doc.createElement('div');
    row.className = 'cinematic-picker-row';

    const lbl = doc.createElement('label');
    lbl.className = 'cinematic-picker-label';
    lbl.textContent = t.label;

    const sel = doc.createElement('select');
    sel.className = 'cinematic-select';
    sel.setAttribute('data-task', t.id);

    sel.addEventListener('change', () => {
      const selectedId = sel.value;
      if (typeof onModelChange === 'function') {
        onModelChange(t.id, selectedId);
      }
      try {
        if (win?.localStorage) {
          const raw = win.localStorage.getItem('gev.cinematic.models.v1');
          const stored = raw ? JSON.parse(raw) : {};
          stored[t.id] = selectedId;
          win.localStorage.setItem(
            'gev.cinematic.models.v1',
            JSON.stringify(stored),
          );
        }
      } catch {}
    });

    lbl.append(sel);
    row.append(lbl);
    modelPickerContainer.append(row);
    pickerSelects.set(t.id, sel);
  }

  // 6. Action toggles & Test injection button
  const actionGroup = doc.createElement('div');
  actionGroup.className = 'cinematic-panel__actions';

  const autodirectLabel = doc.createElement('label');
  autodirectLabel.className = 'cinematic-autodirect-label';

  const autodirectCheck = doc.createElement('input');
  autodirectCheck.type = 'checkbox';
  autodirectCheck.id = 'cinematic-autodirect';
  autodirectCheck.checked = true;
  autodirectCheck.addEventListener('change', () => {
    liveDirector?.setAutoDirect?.(autodirectCheck.checked);
  });

  autodirectLabel.append(
    autodirectCheck,
    doc.createTextNode('Auto-direct cameras'),
  );

  const injectButton = doc.createElement('button');
  injectButton.type = 'button';
  injectButton.id = 'cinematic-inject-closure';
  injectButton.className = 'cinematic-btn cinematic-btn--warn';
  injectButton.textContent = 'Inject Road Closure';
  injectButton.addEventListener('click', () => {
    try {
      if (typeof win?.__gevCinematic?.inject === 'function') {
        win.__gevCinematic.inject('road_closure');
      } else if (typeof inject === 'function') {
        inject('road_closure');
      }
    } catch (err) {
      console.warn('[CinematicPanel] inject road closure failed:', err);
    }
  });

  const weatherButton = doc.createElement('button');
  weatherButton.type = 'button';
  weatherButton.id = 'cinematic-pull-weather';
  weatherButton.className = 'cinematic-btn';
  weatherButton.textContent = 'Pull live weather (Open-Meteo)';
  weatherButton.title =
    'Live Intelligence source: current Open-Meteo observation at the scene origin, applied as a validated scene patch. Weather data by Open-Meteo.com (CC BY 4.0).';
  weatherButton.addEventListener('click', async () => {
    const fn =
      typeof pullLiveWeather === 'function'
        ? pullLiveWeather
        : win?.__gevCinematic?.pullLiveWeather;
    if (typeof fn !== 'function') return;
    weatherButton.disabled = true;
    const prev = weatherButton.textContent;
    weatherButton.textContent = 'Fetching Open-Meteo…';
    try {
      await fn();
    } catch (err) {
      console.warn('[CinematicPanel] live weather failed:', err);
      panelApi.appendFeed(`Live weather unavailable: ${err?.message || err}`);
    } finally {
      weatherButton.disabled = false;
      weatherButton.textContent = prev;
    }
  });

  actionGroup.append(autodirectLabel, injectButton, weatherButton);

  // 7. Playback controls
  const playbackContainer = doc.createElement('div');
  playbackContainer.className = 'cinematic-playback';

  const btnRow = doc.createElement('div');
  btnRow.className = 'cinematic-playback__buttons';

  const playBtn = doc.createElement('button');
  playBtn.type = 'button';
  playBtn.id = 'cinematic-play';
  playBtn.className = 'cinematic-btn';
  playBtn.textContent = 'Play';
  playBtn.addEventListener('click', () => playback?.play?.());

  const pauseBtn = doc.createElement('button');
  pauseBtn.type = 'button';
  pauseBtn.id = 'cinematic-pause';
  pauseBtn.className = 'cinematic-btn';
  pauseBtn.textContent = 'Pause';
  pauseBtn.addEventListener('click', () => playback?.pause?.());

  const restartBtn = doc.createElement('button');
  restartBtn.type = 'button';
  restartBtn.id = 'cinematic-restart';
  restartBtn.className = 'cinematic-btn';
  restartBtn.textContent = 'Restart';
  restartBtn.addEventListener('click', () => {
    playback?.seek?.(0);
    playback?.play?.();
  });

  btnRow.append(playBtn, pauseBtn, restartBtn);

  const seekRow = doc.createElement('div');
  seekRow.className = 'cinematic-playback__seek-row';

  const seekInput = doc.createElement('input');
  seekInput.type = 'range';
  seekInput.id = 'cinematic-seek';
  seekInput.className = 'cinematic-playback__seek';
  seekInput.min = '0';
  seekInput.max = '60';
  seekInput.value = '0';
  seekInput.step = '0.5';

  const onSeek = () => {
    const val = Number(seekInput.value);
    playback?.seek?.(val);
  };
  seekInput.addEventListener('input', onSeek);
  seekInput.addEventListener('change', onSeek);

  const positionSpan = doc.createElement('span');
  positionSpan.id = 'cinematic-position';
  positionSpan.className = 'cinematic-playback__position';
  positionSpan.textContent = '00:00 / 00:00';

  seekRow.append(seekInput, positionSpan);

  const optionsRow = doc.createElement('div');
  optionsRow.className = 'cinematic-playback__options';

  const speedSelect = doc.createElement('select');
  speedSelect.id = 'cinematic-speed';
  speedSelect.className = 'cinematic-select';
  for (const s of [0.5, 1, 2, 4]) {
    const opt = doc.createElement('option');
    opt.value = String(s);
    opt.textContent = `${s}x`;
    if (s === 1) opt.selected = true;
    speedSelect.append(opt);
  }
  speedSelect.addEventListener('change', () => {
    playback?.setSpeed?.(Number(speedSelect.value));
  });

  const cameraModeSelect = doc.createElement('select');
  cameraModeSelect.id = 'cinematic-camera-mode';
  cameraModeSelect.className = 'cinematic-select';
  for (const [modeVal, modeTxt] of [
    ['cinematic', 'Cinematic'],
    ['follow', 'Follow'],
    ['free', 'Free'],
  ]) {
    const opt = doc.createElement('option');
    opt.value = modeVal;
    opt.textContent = modeTxt;
    if (modeVal === 'cinematic') opt.selected = true;
    cameraModeSelect.append(opt);
  }
  cameraModeSelect.addEventListener('change', () => {
    playback?.setCameraMode?.(cameraModeSelect.value);
  });

  optionsRow.append(speedSelect, cameraModeSelect);
  playbackContainer.append(btnRow, seekRow, optionsRow);

  // 8. Live Feed
  const feedSection = doc.createElement('div');
  feedSection.className = 'cinematic-panel__feed-section';

  const feedTitle = doc.createElement('div');
  feedTitle.className = 'cinematic-panel__feed-title';
  feedTitle.textContent = 'Live Feed';

  const feedList = doc.createElement('ul');
  feedList.id = 'cinematic-feed';
  feedList.className = 'cinematic-panel__feed';
  feedList.setAttribute('aria-live', 'polite');

  feedSection.append(feedTitle, feedList);

  // 9. Q&A section
  const qaSection = doc.createElement('div');
  qaSection.className = 'cinematic-qa';

  const qaForm = doc.createElement('form');
  qaForm.id = 'cinematic-qa-form';
  qaForm.className = 'cinematic-qa-form';

  const qaInput = doc.createElement('textarea');
  qaInput.id = 'cinematic-qa-input';
  qaInput.className = 'cinematic-qa-input';
  qaInput.placeholder = 'Ask a question or request a change...';

  const qaSendBtn = doc.createElement('button');
  qaSendBtn.type = 'submit';
  qaSendBtn.id = 'cinematic-qa-send';
  qaSendBtn.className = 'cinematic-btn cinematic-btn--primary';
  qaSendBtn.textContent = 'Ask';

  qaForm.append(qaInput, qaSendBtn);

  const qaLog = doc.createElement('div');
  qaLog.id = 'cinematic-qa-log';
  qaLog.className = 'cinematic-qa-log';
  qaLog.setAttribute('aria-live', 'polite');

  qaForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const qText = qaInput.value.trim();
    if (!qText) return;
    qaInput.value = '';

    const qEl = doc.createElement('div');
    qEl.className = 'cinematic-qa-entry cinematic-qa-entry--question';
    qEl.textContent = `Q: ${qText}`;
    qaLog.append(qEl);

    try {
      const activeScene = lastScene || reducer?.scene?.();
      const activePlayback = playback?.state?.();
      const context = buildQaContext({
        scene: activeScene,
        playback: activePlayback,
        selectedEntityIds: runtime?.selected?.() || [],
      });

      let qaRes = null;
      if (client && typeof client.cinematicQa === 'function') {
        qaRes = await client.cinematicQa(qText, context);
      } else if (client && typeof client.qa === 'function') {
        qaRes = await client.qa(qText, context);
      } else {
        qaRes = { answer: 'Q&A client not configured', commands: [] };
      }

      if (qaRes?.answer) {
        const aEl = doc.createElement('div');
        aEl.className = 'cinematic-qa-entry cinematic-qa-entry--answer';
        aEl.textContent = qaRes.answer;
        qaLog.append(aEl);
      }

      if (
        qaExecutor &&
        Array.isArray(qaRes?.commands) &&
        qaRes.commands.length > 0
      ) {
        const results = await qaExecutor.execute(qaRes.commands, {
          selectedEntityIds: runtime?.selected?.() || [],
        });
        for (const r of results) {
          const cmdEl = doc.createElement('div');
          cmdEl.className = `cinematic-qa-entry cinematic-qa-entry--cmd ${r.confirmed ? 'is-confirmed' : 'is-failed'}`;
          if (r.confirmed) {
            cmdEl.textContent = `confirmed: ${r.command}`;
          } else {
            cmdEl.textContent = `not confirmed: ${r.command}: ${r.reason || 'not confirmed'}`;
          }
          qaLog.append(cmdEl);
        }
      }
    } catch (err) {
      const errEl = doc.createElement('div');
      errEl.className = 'cinematic-qa-entry cinematic-qa-entry--cmd is-failed';
      errEl.textContent = `error: ${err?.message || 'Q&A failed'}`;
      qaLog.append(errEl);
    }
  });

  qaSection.append(qaForm, qaLog);

  // Assemble all sections into root
  root.append(
    header,
    stagesContainer,
    modelChip,
    metricsStrip,
    modelPickerContainer,
    actionGroup,
    playbackContainer,
    feedSection,
    qaSection,
  );

  if (container) {
    container.append(root);
  }

  // Pure diff update routine
  function applyUpdate(state, scene) {
    if (destroyed) return;
    lastState = state;
    lastScene = scene;

    // Mode
    const rawMode = scene?.mode || state?.mode;
    const modeTxt = (rawMode && MODE_LABELS[rawMode]) || 'Cinematic Simulation';
    if (modeLabel.textContent !== modeTxt) {
      modeLabel.textContent = modeTxt;
    }

    // Run State
    const runState = state?.runState || 'idle';
    if (runStateBadge.getAttribute('data-state') !== runState) {
      runStateBadge.setAttribute('data-state', runState);
      runStateBadge.textContent = RUN_STATE_HUMAN[runState] || runState;
    }

    // Stages
    const currentStage = state?.stage;
    if (state?.stages) {
      for (const [stLetter, msTime] of Object.entries(state.stages)) {
        if (!stageTimestamps.has(stLetter)) {
          stageTimestamps.set(stLetter, msTime);
        }
      }
    }
    for (const [letter, { row, timeSpan }] of stageRows.entries()) {
      const isDone =
        stageTimestamps.has(letter) || (currentStage && currentStage > letter);
      const isCurrent = currentStage === letter;
      row.className = `cinematic-stage-row${isDone ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`;
      const timeVal = stageTimestamps.get(letter);
      if (timeVal != null) {
        timeSpan.textContent = `${timeVal}ms`;
      }
    }

    // Model chip: endpointId · provider · TTFT n ms · tok/s n
    const model = state?.model || scene?.provenance?.model;
    const metrics = state?.metrics || {};
    if (model?.endpointId) {
      const parts = [model.endpointId];
      if (model.provider) parts.push(model.provider);
      const ttft = metrics.ttftMs ?? model.ttftMs;
      if (ttft != null) parts.push(`TTFT ${ttft} ms`);
      const tps = metrics.tokensPerSec ?? model.tokensPerSec;
      if (tps != null && tps > 0) {
        const isMeasured = Boolean(
          metrics.tokensPerSecMeasured || model.tokensPerSecMeasured,
        );
        parts.push(`${tps.toFixed(1)} tok/s${isMeasured ? '' : ' est.'}`);
      }
      const chipTxt = parts.join(' · ');
      if (modelChip.textContent !== chipTxt) {
        modelChip.textContent = chipTxt;
      }
    } else if (modelChip.textContent !== 'No model selected') {
      modelChip.textContent = 'No model selected';
    }

    // Metrics strip: first instruction / first object / first shot / FPS / heap
    const fiVal = metrics.firstSceneInstructionMs
      ? `${metrics.firstSceneInstructionMs}ms`
      : '--';
    const foVal = metrics.firstRenderedObjectMs
      ? `${metrics.firstRenderedObjectMs}ms`
      : '--';
    const fsVal = metrics.firstPlayableShotMs
      ? `${metrics.firstPlayableShotMs}ms`
      : '--';
    const fpsVal = metrics.fps ? `${Math.round(metrics.fps)} FPS` : '--';
    const heapVal = metrics.heapUsedMb ? `${metrics.heapUsedMb} MB` : '--';

    metricValues.get('firstInstruction').textContent = fiVal;
    metricValues.get('firstObject').textContent = foVal;
    metricValues.get('firstShot').textContent = fsVal;
    metricValues.get('fps').textContent = fpsVal;
    metricValues.get('heap').textContent = heapVal;

    // Playback state & position
    const curPos =
      typeof playback?.positionSec === 'function' ? playback.positionSec() : 0;
    const duration =
      (typeof playback?.durationSec === 'function'
        ? playback.durationSec()
        : null) ||
      scene?.timeline?.durationSec ||
      60;

    positionSpan.textContent = `${formatTime(curPos)} / ${formatTime(duration)}`;
    seekInput.max = String(duration);
    seekInput.value = String(curPos);

    if (playback?.state) {
      const pbState = playback.state();
      if (pbState?.speed && speedSelect.value !== String(pbState.speed)) {
        speedSelect.value = String(pbState.speed);
      }
      if (
        pbState?.cameraMode &&
        cameraModeSelect.value !== pbState.cameraMode
      ) {
        cameraModeSelect.value = pbState.cameraMode;
      }
    }
  }

  function scheduleUpdate(state, scene) {
    if (destroyed) return;
    pendingUpdate = { state, scene };
    if (rafId === null) {
      const raf = win?.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
      rafId = raf(() => {
        rafId = null;
        if (pendingUpdate && !destroyed) {
          const { state: s, scene: sc } = pendingUpdate;
          pendingUpdate = null;
          applyUpdate(s, sc);
        }
      });
    }
  }

  const panelApi = {
    element: root,

    update(state, scene) {
      scheduleUpdate(state, scene);
    },

    setModels(list = [], assignments = {}) {
      for (const [taskId, sel] of pickerSelects.entries()) {
        sel.innerHTML = '';
        for (const m of list) {
          const opt = doc.createElement('option');
          opt.value = m.endpointId;
          opt.textContent = `${m.name || m.endpointId}${m.cerebras ? ' (Cerebras)' : ''}`;
          sel.append(opt);
        }
        if (assignments[taskId]) {
          sel.value = assignments[taskId];
        }
      }
    },

    appendFeed(entry) {
      if (!entry) return;
      const li = doc.createElement('li');
      li.className = 'cinematic-feed-item';
      const text =
        typeof entry === 'string'
          ? entry
          : entry.summary || entry.text || JSON.stringify(entry);
      li.textContent = text;
      feedList.prepend(li);
      while (feedList.children.length > 50) {
        feedList.lastChild?.remove();
      }
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (rafId !== null && win?.cancelAnimationFrame) {
        win.cancelAnimationFrame(rafId);
      }
      rafId = null;
      root.remove();
    },
  };
  return panelApi;
}

export const mount = mountCinematicPanel;
