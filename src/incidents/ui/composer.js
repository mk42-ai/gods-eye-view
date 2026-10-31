/**
 * Abortable incident search / scene composer. Geography-only scene requests
 * never enter the incident ledger; out-of-AOI candidates are external context.
 * Async integrations receive a signal and must honour it before side effects.
 */
import {
  COMPOSER_STEPS,
  planFromCandidates,
  incidentFromText,
} from '../client.js';
import { parseIncidentQuery, CONVERSATIONAL_HINT } from '../query.js';
import { buildGeographicScene } from '../../scenes/geographicScene.js';
import { setIconContent } from '../../ui/icons/layerIcon.js';

export const COMPOSER_ID = 'incident-composer';
/** One inline status label per composer step (replaces the three pills). */
export const STEP_STATUS_TEXT = Object.freeze({
  locating: 'Locating',
  verifying: 'Verifying AOI',
  building: 'Building scene',
  searching: 'Searching sources',
});
/** Short one-line place label from a geocoder display name (first segment). */
export function shortPlaceLabel(name) {
  const full = String(name || '')
    .replace(/\s+/g, ' ')
    .trim();
  const first = (full.split(',')[0] || '').trim() || full;
  const small = new Set(['of', 'and', 'the', 'in', 'at', 'on', 'for']);
  return first
    .split(' ')
    .map((w, i) => (i > 0 && small.has(w.toLowerCase()) ? w.toLowerCase() : w))
    .join(' ');
}
export const COMPOSER_PLACEHOLDER =
  'Create a slow aerial orbit around Burj Khalifa.\nShow the surrounding skyline, then return to the tower.';

/** Template slots must be replaced before any location/provider request. */
export function unresolvedPromptTokens(text) {
  return (
    String(text ?? '').match(
      /\{\{[^{}]*\}\}|\[[^\]\r\n]+\]|<\s*(?:location|place|city|landmark|aoi|insert[^<>]*|your[^<>]*)\s*>/gi,
    ) || []
  );
}

export function createIncidentComposer({
  document = globalThis.document,
  ResizeObserver: ResizeObserverImpl = globalThis.ResizeObserver,
  client,
  onScene,
  onStatus,
  onLocated,
  onExternal,
  buildScene,
  createGeographicScene,
  onUnresolved,
  onPlaybackControl,
  onTimeChange,
  debounceMs = 300,
  requestTimeoutMs = 75_000,
  buildResearchScene = false,
  structuredPlanning = false,
} = {}) {
  const root = document.createElement('form');
  root.id = COMPOSER_ID;
  root.className = 'incident-composer';
  root.setAttribute('role', 'search');
  root.setAttribute(
    'aria-label',
    'Type an incident to locate it and build a scene',
  );
  root.setAttribute('data-state', 'idle');
  root.setAttribute('aria-busy', 'false');
  root.dataset.promptRevision = '0';
  // Explicit submission UI contract: drafts never auto-generate
  root.dataset.submissionMode = 'explicit';

  const row = document.createElement('div');
  row.className = 'incident-composer__row';
  const icon = document.createElement('span');
  icon.className = 'incident-composer__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.title = 'Area of interest';
  // Lucide outline pin (was the text glyph "AOI"); decorative — the input is labelled.
  setIconContent(icon, 'map-pin', {}, document);
  const input = document.createElement('textarea');
  input.rows = 2;
  input.id = `${COMPOSER_ID}-input`;
  input.className = 'incident-composer__input';
  input.placeholder = COMPOSER_PLACEHOLDER;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', COMPOSER_PLACEHOLDER);
  input.setAttribute('enterkeyhint', 'enter');
  input.setAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
  input.setAttribute('title', 'Press Ctrl+Enter or Cmd+Enter to build scene');
  input.maxLength = 6000;
  // One native button owns the label AND the icon (the svg is a child with
  // pointer-events:none), so a click/tap anywhere on it — icon included — is
  // the same single, explicit action. type=button: the form never submits
  // implicitly (e.g. Enter in a date field); the click handler admits a build.
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.id = `${COMPOSER_ID}-submit`;
  submit.className = 'incident-composer__submit';
  submit.setAttribute('aria-label', 'Build scene');
  submit.title =
    'Locate the place, verify it is inside a UAE AOI and build a camera scene (Ctrl+Enter or Cmd+Enter)';
  setIconContent(submit, 'clapperboard', { text: 'Build scene' }, document);
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.id = `${COMPOSER_ID}-cancel`;
  cancelButton.className =
    'incident-composer__submit incident-composer__cancel';
  cancelButton.setAttribute('aria-label', 'Cancel the current request');
  cancelButton.title = 'Cancel the current request';
  setIconContent(cancelButton, 'x', { text: 'Cancel' }, document);
  cancelButton.hidden = true;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.id = `${COMPOSER_ID}-retry`;
  retry.className = 'incident-composer__submit incident-composer__retry';
  retry.setAttribute('aria-label', 'Retry the last request');
  retry.title = 'Retry the last request';
  setIconContent(retry, 'rotate-ccw', { text: 'Retry' }, document);
  retry.hidden = true;
  row.append(icon, input, submit);
  const actions = document.createElement('div');
  actions.className = 'incident-composer__actions';
  actions.append(cancelButton, retry);

  const timeRow = document.createElement('div');
  timeRow.className = 'incident-composer__time';
  const timeLabel = document.createElement('label');
  timeLabel.textContent = 'Recording window (UTC) ';
  timeLabel.setAttribute('for', 'incident-composer-window');
  const timeSelect = document.createElement('select');
  timeSelect.id = 'incident-composer-window';
  timeSelect.setAttribute('aria-label', 'Recording time window');
  for (const [value, title] of [
    ['1', 'Last hour'],
    ['6', 'Last 6 hours'],
    ['24', 'Last 24 hours'],
    ['72', 'Last 72 hours'],
    ['168', 'Last 7 days'],
    ['historical', 'Historical interval'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = title;
    timeSelect.appendChild(option);
  }
  timeSelect.value = '1';
  const historicalStart = document.createElement('input');
  historicalStart.type = 'datetime-local';
  historicalStart.id = 'incident-composer-from';
  historicalStart.setAttribute('aria-label', 'Recording interval start UTC');
  historicalStart.hidden = true;
  const historicalEnd = document.createElement('input');
  historicalEnd.type = 'datetime-local';
  historicalEnd.id = 'incident-composer-to';
  historicalEnd.setAttribute('aria-label', 'Recording interval end UTC');
  historicalEnd.hidden = true;
  const shortcutHint = document.createElement('span');
  shortcutHint.className = 'incident-composer__shortcut-hint';
  shortcutHint.id = `${COMPOSER_ID}-shortcut-hint`;
  shortcutHint.textContent = 'Draft only · Build scene or Ctrl/Cmd+Enter';
  input.setAttribute('aria-describedby', shortcutHint.id);
  timeRow.append(
    timeLabel,
    timeSelect,
    historicalStart,
    historicalEnd,
    shortcutHint,
  );
  const chips = document.createElement('div');
  chips.className = 'incident-composer__chips';
  chips.id = `${COMPOSER_ID}-chips`;
  chips.setAttribute('aria-live', 'polite');
  chips.dataset.presentation = 'inline-status';
  const result = document.createElement('div');
  result.className = 'incident-composer__result';
  result.id = `${COMPOSER_ID}-result`;
  result.hidden = true;
  result.setAttribute('aria-live', 'polite');
  // Cycle 22: one compact status row — inline status/result on the left, a
  // persistent slot on the right where the scene-evidence chip mounts.
  const statusRow = document.createElement('div');
  statusRow.className = 'incident-composer__status';
  statusRow.id = `${COMPOSER_ID}-status`;
  const evidenceSlot = document.createElement('div');
  evidenceSlot.className = 'incident-composer__evidence-slot';
  evidenceSlot.id = `${COMPOSER_ID}-evidence-slot`;
  statusRow.append(result, evidenceSlot);
  root.append(row, timeRow, chips, statusRow, actions);

  const layoutHost = document.documentElement || document.body;
  const updateStackHeight = () => {
    const height = root.getBoundingClientRect?.().height;
    if (height > 0)
      layoutHost?.style?.setProperty?.(
        '--incident-composer-height',
        `${Math.ceil(height)}px`,
      );
  };
  let onObserved = updateStackHeight;
  const resizeObserver =
    typeof ResizeObserverImpl === 'function'
      ? new ResizeObserverImpl((...args) => onObserved(...args))
      : null;
  resizeObserver?.observe(root);
  // Cycle 22: the composer is anchored ABOVE the command dock's measured top
  // edge (--command-dock-clearance), so it grows upward and can never overlap
  // the Visual presets / Location / Voice dock, whatever the dock's height.
  const view = document.defaultView;
  const updateDockClearance = () => {
    const dock = document.getElementById?.('command-dock');
    if (!dock || !view) return;
    const rect = dock.getBoundingClientRect?.();
    const style = view.getComputedStyle?.(dock);
    const shown =
      rect &&
      rect.height > 0 &&
      style?.display !== 'none' &&
      style?.visibility !== 'hidden';
    const clearance = shown
      ? Math.max(0, Math.ceil((view.innerHeight || 0) - rect.top))
      : 0;
    layoutHost?.style?.setProperty?.(
      '--command-dock-clearance',
      `${clearance}px`,
    );
  };
  // The composer's own ResizeObserver also watches the dock (one observer).
  let observedDock = null;
  const observeDock = () => {
    const dock = document.getElementById?.('command-dock');
    if (dock && dock !== observedDock) {
      resizeObserver?.observe(dock);
      observedDock = dock;
    }
    updateDockClearance();
  };
  onObserved = () => {
    updateStackHeight();
    updateDockClearance();
  };
  observeDock();
  view?.addEventListener?.('resize', updateDockClearance);
  view?.setTimeout?.(observeDock, 0);

  const state = {
    playback: 'idle',
    busy: false,
    text: '',
    candidates: [],
    steps: {},
    lastPlan: null,
    lastScene: null,
    abort: null,
    extraction: null,
    lastSearch: null,
    generation: 0,
    promptRevision: 0,
  };
  let destroyed = false;
  let activeRun = null;
  let composing = false;
  let lastPayload = null;
  let admissionOwner = null;
  let lastSubmittedSnapshot = null;
  let lastFailedSnapshot = null;

  function invalidate({ promptChanged = false } = {}) {
    state.generation += 1;
    if (promptChanged) {
      state.promptRevision += 1;
      root.dataset.promptRevision = String(state.promptRevision);
    }
    activeRun = null;
    admissionOwner = null;
    state.abort?.abort();
  }
  function notifyStarted() {
    const Event = document.defaultView?.CustomEvent;
    if (Event)
      document.defaultView.dispatchEvent(
        new Event('gev:incident-command-started'),
      );
  }
  function clearScene() {
    state.lastScene = null;
    state.lastSearch = null;
    lastPayload = null;
    playButton = null;
    state.playback = 'idle';
  }
  function callbackContext(run) {
    return {
      signal: run.signal,
      revision: run.revision,
      promptRevision: run.revision,
      generation: run.id,
    };
  }
  // Adapters must check signal/revision before their own external side effects.
  // Check both sides of each await so uncooperative adapters cannot publish here.
  async function invoke(run, callback, payload) {
    checkCurrent(run);
    const outcome = await callback?.({ ...payload, ...callbackContext(run) });
    checkCurrent(run);
    return outcome;
  }

  function current(run) {
    return (
      !destroyed &&
      activeRun === run &&
      run?.id === state.generation &&
      run?.revision === state.promptRevision &&
      !run.signal?.aborted
    );
  }
  function checkCurrent(run) {
    if (!current(run)) {
      const error = new Error('Request cancelled.');
      error.name = 'AbortError';
      throw error;
    }
  }
  // Bound every asynchronous stage, including adapters that ignore abort.
  // The caller publishes the timeout before aborting so it remains an error,
  // not a misleading user-cancelled result. Late stages cannot publish.
  async function bounded(run, work) {
    let timer;
    let aborted;
    try {
      checkCurrent(run);
      return await Promise.race([
        Promise.resolve(work()),
        new Promise((_, reject) => {
          const timeout = Number(requestTimeoutMs);
          timer = setTimeout(
            () => {
              const error = new Error(
                'Request timed out. Retry or edit the AOI and build again.',
              );
              error.name = 'TimeoutError';
              reject(error);
            },
            Number.isFinite(timeout) && timeout > 0 ? timeout : 75_000,
          );
          aborted = () => {
            const error = new Error('Request cancelled.');
            error.name = 'AbortError';
            reject(error);
          };
          run.signal?.addEventListener('abort', aborted, { once: true });
          if (run.signal?.aborted) aborted();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      run.signal?.removeEventListener('abort', aborted);
    }
  }
  function setBusy(busy) {
    state.busy = busy;
    // Keep a replacement request editable and submittable while work is pending.
    // Identical duplicate submits are coalesced in submitText instead.
    submit.disabled = false;
    retry.disabled = busy;
    cancelButton.hidden = !busy;
    root.setAttribute('aria-busy', String(busy));
    updateStackHeight();
  }
  function setChips(active, { error = false, done = false } = {}) {
    chips.replaceChildren();
    for (const item of state.extraction?.intent === 'incident_search'
      ? [
          ...COMPOSER_STEPS.slice(0, 2),
          { id: 'searching', label: 'searching sources' },
        ]
      : COMPOSER_STEPS) {
      const chip = document.createElement('span');
      chip.className = 'incident-composer__chip';
      chip.dataset.step = item.id;
      chip.dataset.status = state.steps[item.id] || 'pending';
      chip.textContent = item.label;
      chips.appendChild(chip);
    }
    root.setAttribute(
      'data-state',
      error ? 'error' : done ? 'done' : active ? 'busy' : 'idle',
    );
    updateStackHeight();
  }
  function step(id, status, run) {
    checkCurrent(run);
    if (status === 'active') run.stage = id;
    state.steps[id] = status;
    setChips(true);
    if (status === 'active' && id !== 'locating' && STEP_STATUS_TEXT[id]) {
      const label = result.querySelector?.(
        '[data-kind="pending"] [data-role="label"]',
      );
      if (label) label.textContent = `${STEP_STATUS_TEXT[id]}…`;
    }
    onStatus?.({ step: id, status });
    checkCurrent(run);
  }
  function resetSteps() {
    state.steps = {};
    chips.replaceChildren();
    root.setAttribute('data-state', 'idle');
  }
  function showResult(node) {
    result.replaceChildren(node);
    result.hidden = false;
    updateStackHeight();
  }
  function hideResult() {
    result.replaceChildren();
    result.hidden = true;
    updateStackHeight();
  }
  function message(text, kind = 'info') {
    const p = document.createElement('p');
    p.className = `incident-composer__message incident-composer__message--${kind}`;
    p.textContent = text;
    return p;
  }
  function notice(detail, run) {
    const p = document.createElement('p');
    p.className =
      'incident-composer__message incident-composer__message--notice';
    p.dataset.kind = 'retry-notice';
    p.setAttribute('role', 'status');
    p.setAttribute('title', String(detail || '').slice(0, 400));
    p.dataset.detail = String(detail || '').slice(0, 400);
    const label =
      run?.stage === 'locating'
        ? 'Couldn’t reach the location service.'
        : run?.extraction?.intent === 'incident_search'
          ? 'Incident search didn’t complete — no conclusion can be drawn.'
          : 'Scene build didn’t complete.';
    const lead = document.createElement('span');
    lead.textContent = `${label} Press Retry to resend “${(run?.text || '').slice(0, 60)}”. `;
    const small = document.createElement('small');
    small.className = 'incident-composer__detail';
    small.textContent = String(detail || '');
    p.append(lead, small);
    return p;
  }
  function pending(text) {
    const p = document.createElement('p');
    p.className =
      'incident-composer__message incident-composer__message--pending';
    p.dataset.kind = 'pending';
    const spinner = document.createElement('span');
    spinner.className = 'incident-composer__spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.dataset.role = 'label';
    label.textContent = text;
    p.append(spinner, label);
    return p;
  }
  function markActive(status) {
    for (const id of Object.keys(state.steps))
      if (state.steps[id] === 'active') state.steps[id] = status;
  }
  function cancelRequest() {
    if (!state.busy || destroyed) return false;
    if (activeRun?.snapshot) {
      lastFailedSnapshot = activeRun.snapshot;
    }
    // Invalidate first: even a transport/callback that ignores AbortSignal may
    // resolve later, but it cannot publish into this or a newer submission.
    invalidate();
    clearScene();
    markActive('cancelled');
    setChips(false);
    root.setAttribute('data-state', 'cancelled');
    retry.hidden = false;
    showResult(
      message(
        'Cancelled. Draft kept; late results are ignored. Upstream provider work may continue.',
      ),
    );
    const WindowEvent =
      document.defaultView?.CustomEvent || globalThis.CustomEvent;
    if (WindowEvent)
      document.defaultView?.dispatchEvent?.(
        new WindowEvent('gev:incident-command-cancelled'),
      );
    setBusy(false);
    return true;
  }
  async function failed(error, run) {
    if (
      destroyed ||
      run?.id !== state.generation ||
      run?.revision !== state.promptRevision
    )
      return;
    if (run.snapshot) {
      lastFailedSnapshot = run.snapshot;
    }
    if (run.signal?.aborted || error?.name === 'AbortError') {
      cancelRequest();
      return;
    }
    if (run.stage === 'locating') {
      try {
        await bounded(run, () =>
          invoke(run, onUnresolved, {
            text: run.text,
            extraction: run.extraction,
            status: 'error',
          }),
        );
      } catch {}
      if (!current(run)) return;
    }
    markActive('error');
    const detail = error?.message || String(error);
    const text =
      run.stage === 'locating'
        ? `Locate failed: ${detail}`
        : run.extraction?.intent === 'incident_search'
          ? `Request failed: ${detail}. No conclusion about incidents can be drawn.`
          : `Scene request failed: ${detail}`;
    // Discreet notice: a short, calm line plus Retry. The full provider detail
    // stays available (title/data attribute) without shouting raw errors.
    showResult(notice(text, run));
    retry.hidden = false;
    setChips(false, { error: true });
    if (error?.name === 'TimeoutError') {
      // Invalidate before abort: a late callback cannot replace this error or
      // the next request's scene, even if it ignores AbortSignal.
      invalidate();
      setBusy(false);
    }
  }
  function candidateRow(candidate, onChoose) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'incident-composer__candidate';
    btn.dataset.inside = String(Boolean(candidate.aoi_membership?.inside));
    const name = document.createElement('strong');
    name.textContent = candidate.name;
    const meta = document.createElement('span');
    meta.className = 'incident-composer__candidate-meta';
    meta.textContent = `${candidate.lat.toFixed(3)}, ${candidate.lon.toFixed(3)} · ${candidate.aoi_membership?.inside ? 'in AOI' : 'OUT OF AOI'} · ${Math.round((candidate.confidence || 0) * 100)}% · ${candidate.source || ''}`;
    btn.append(name, meta);
    btn.addEventListener('click', () => onChoose(candidate));
    return btn;
  }

  function geographicOnly(run) {
    const extraction = run.extraction;
    // The integrated prompt composer always constructs illustrative validated
    // plans; it must never ingest generated police/event staging as an incident.
    if (structuredPlanning && typeof createGeographicScene === 'function')
      return true;
    if (buildResearchScene && extraction?.intent === 'incident_search')
      return true;
    if (extraction?.intent !== 'build_scene') return false;
    // Prefer the shared parser's metadata; the fallback preserves compatibility
    // with older /locate extraction payloads that only expose intent/place.
    const describesEvent =
      extraction.hasEventDescription ??
      extraction.describesEvent ??
      /\b(?:crash|collision|accident|fire|explosion|strike|rupture|incursion|flood|attack|bomb|threat|hotspot|seizure|protest)\b/i.test(
        run.text,
      );
    return !describesEvent;
  }
  // Composer Play is a real transport control: Play → Pause → Resume, driven by
  // the scene director's clock (setPlaybackState) so a second press never
  // silently no-ops against a run that is already playing.
  let playButton = null;
  let playPlace = '';
  function renderPlayButton() {
    if (!playButton) return;
    const s = state.playback;
    const label =
      s === 'playing' ? 'Pause' : s === 'paused' ? 'Resume' : 'Play';
    playButton.dataset.playback = s;
    playButton.setAttribute('aria-pressed', String(s === 'playing'));
    playButton.setAttribute('aria-label', `${label} scene: ${playPlace}`);
    playButton.title = `${label} the camera scene · footage verified separately · UTC recording filter`;
    setIconContent(
      playButton,
      s === 'playing' ? 'pause' : 'play',
      { text: label },
      document,
    );
  }
  function setPlaybackState(next) {
    const value = ['playing', 'paused'].includes(next) ? next : 'idle';
    if (value === state.playback) return;
    state.playback = value;
    renderPlayButton();
  }
  function sceneSuccess(payload, run, reused = false) {
    checkCurrent(run);
    step('building', 'done', run);
    checkCurrent(run);
    state.lastScene = payload.scene;
    lastPayload = payload;
    lastFailedSnapshot = null;
    retry.hidden = true;
    setChips(false, { done: true });
    const fullName = String(payload.candidate.name || '');
    const wrap = document.createElement('div');
    wrap.className = 'incident-composer__done';
    wrap.dataset.kind = 'scene-ready';
    const play = document.createElement('button');
    play.type = 'button';
    play.id = `${COMPOSER_ID}-play`;
    play.className = 'incident-composer__play';
    playButton = play;
    playPlace = shortPlaceLabel(fullName);
    renderPlayButton();
    play.addEventListener('click', () => {
      if (!current(run)) return;
      if (state.playback === 'playing' && onPlaybackControl) {
        void playbackControl('pause', payload, run);
        return;
      }
      if (state.playback === 'paused' && onPlaybackControl) {
        void playbackControl('resume', payload, run);
        return;
      }
      if (state.busy) return;
      void replayScene(payload, run, reused);
    });
    const text = document.createElement('p');
    text.className =
      'incident-composer__message incident-composer__message--ok incident-composer__done-text';
    const lead = document.createElement('span');
    lead.className = 'incident-composer__done-lead';
    lead.textContent = reused ? 'Existing scene ready' : 'Scene ready';
    const place = document.createElement('strong');
    place.className = 'incident-composer__place';
    place.textContent = shortPlaceLabel(fullName);
    place.title = fullName;
    text.append(lead, place);
    if (fullName && fullName !== place.textContent) {
      const addr = document.createElement('span');
      addr.className = 'incident-composer__address';
      addr.textContent = fullName;
      addr.title = fullName;
      text.append(addr);
    }
    text.title = `${lead.textContent} at ${fullName}`;
    wrap.append(play, text);
    showResult(wrap);
  }
  async function playbackControl(action, payload, run) {
    try {
      await bounded(run, () =>
        invoke(run, onPlaybackControl, { action, scene: payload.scene }),
      );
    } catch (error) {
      await failed(error, run);
    }
  }
  async function replayScene(payload, run, reused) {
    if (!current(run)) return;
    setBusy(true);
    retry.hidden = true;
    try {
      checkCurrent(run);
      step('building', 'active', run);
      const outcome = await bounded(run, () =>
        invoke(run, onScene, { ...payload, play: true }),
      );
      checkCurrent(run);
      if (
        outcome &&
        outcome.started === false &&
        outcome.reason !== 'already-running'
      )
        throw new Error(
          `Playback did not start (${outcome.reason || 'refused'})`,
        );
      sceneSuccess(payload, run, reused);
    } catch (error) {
      await failed(error, run);
    } finally {
      if (current(run)) setBusy(false);
    }
  }
  async function build(candidate, run) {
    step('verifying', 'done', run);
    step('building', 'active', run);
    showResult(pending(`Building scene · ${shortPlaceLabel(candidate.name)}…`));
    let scene,
      inserted = null,
      ingest = null,
      reused = false;
    const geographic = geographicOnly(run);
    if (geographic) {
      // Legacy standalone callers retain the deterministic geographic builder.
      // An injected planner is authoritative: rejection never falls back.
      scene = await invoke(run, createGeographicScene ?? buildGeographicScene, {
        candidate,
        extraction: run.extraction,
        text: run.text,
        signal: run.signal,
      });
      checkCurrent(run);
    } else {
      const raw = incidentFromText(run.text, candidate);
      ingest = await client.ingest(raw, { signal: run.signal });
      checkCurrent(run);
      inserted = ingest?.inserted?.[0] || ingest?.existing?.[0] || null;
      scene = ingest?.scenes?.[0] || null;
      reused = !ingest?.inserted?.length && ingest?.duplicates?.length > 0;
      if (!reused && !inserted && ingest?.rejected?.length) {
        if (/OUT_OF_AOI/i.test(ingest.rejected[0].reason || ''))
          return externalContext(
            { ...candidate, reason: ingest.rejected[0].reason },
            run,
          );
        throw new Error(ingest.rejected[0].reason || 'Incident rejected.');
      }
      if (!scene && inserted && typeof buildScene === 'function') {
        scene = await buildScene([inserted], { signal: run.signal });
        checkCurrent(run);
      }
    }
    if (!scene) throw new Error('No scene could be built from this request.');
    checkCurrent(run);
    const payload = {
      scene,
      incident: inserted,
      candidate,
      override: false,
      ingest,
      extraction: run.extraction,
      text: run.text,
      signal: run.signal,
      ...callbackContext(run),
      source: geographic ? 'geographic' : 'incident',
      selectedTime: {
        windowHours: run.extraction.windowHours,
        timeMode: run.extraction.timeMode,
        windowStart: run.extraction.windowStart,
        windowEnd: run.extraction.windowEnd,
      },
    };
    await invoke(run, onScene, payload);
    checkCurrent(run);
    sceneSuccess(payload, run, reused);
    return scene;
  }

  async function searchAt(candidate, run) {
    step('verifying', 'done', run);
    step('searching', 'active', run);
    await invoke(run, onLocated, {
      candidate,
      extraction: run.extraction,
      text: run.text,
      signal: run.signal,
    });
    checkCurrent(run);
    showResult(
      message(
        `Searching sources within 5 km of ${candidate.name} (${candidate.lat.toFixed(5)}, ${candidate.lon.toFixed(5)})…`,
      ),
    );
    const out = await client.search(run.text, candidate, {
      signal: run.signal,
    });
    checkCurrent(run);
    if (
      !out ||
      !['complete', 'empty', 'partial', 'unavailable'].includes(out.status) ||
      !out.scope ||
      !Array.isArray(out.reports)
    )
      throw new Error(
        'Invalid incident-search response; coverage could not be verified.',
      );
    state.lastSearch = out;
    const wrap = document.createElement('section');
    wrap.className = 'incident-composer__search';
    wrap.setAttribute('aria-label', 'Scoped incident search results');
    wrap.dataset.searchStatus = out.status;
    wrap.dataset.lat = String(out.scope.lat);
    wrap.dataset.lon = String(out.scope.lon);
    wrap.dataset.intent = 'incident_search';
    wrap.append(
      message(
        `${out.scope.place} · ${out.scope.lat.toFixed(5)}, ${out.scope.lon.toFixed(5)} · within ${out.scope.radiusKm} km`,
        'ok',
      ),
    );
    wrap.append(
      message(
        `${out.scope.startUtc} → ${out.scope.endUtc} · ${out.scope.geocodeSource}${out.scope.geocodeVerified ? '' : ' (estimated coordinates)'}`,
      ),
    );
    wrap.append(
      message(out.message, out.status === 'unavailable' ? 'error' : 'info'),
    );
    for (const report of out.reports) {
      const item = document.createElement('article');
      item.className = 'incident-composer__report';
      item.append(message(`${report.title} · ${report.distanceKm} km`));
      item.append(message(report.summary));
      item.append(
        message(
          `Incident time: ${report.incident_time_utc || 'unknown — publication time is not incident time'}`,
        ),
      );
      for (const source of report.sources || []) {
        const link = document.createElement('a');
        link.textContent = `${source.title || 'Open source'} · published ${source.published_at || 'date unavailable'}`;
        link.setAttribute('href', source.url);
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        item.append(link);
      }
      item.append(message(`${report.provider} · ${report.confidence}`));
      wrap.append(item);
    }
    for (const source of out.sources || [])
      wrap.append(
        message(
          `${source.contract}: ${source.status}${source.error ? ' — ' + source.error : ''}${source.excluded?.length ? ` · ${source.excluded.length} unqualified reports excluded` : ''}${source.note ? ' · ' + source.note : ''}`,
        ),
      );
    wrap.append(message(out.scope.coverage));
    showResult(wrap);
    step(
      'searching',
      out.status === 'unavailable'
        ? 'error'
        : out.status === 'partial'
          ? 'partial'
          : 'done',
      run,
    );
    retry.hidden = !['unavailable', 'partial'].includes(out.status);
    root.setAttribute(
      'data-state',
      out.status === 'complete' ? 'done' : out.status,
    );
    return out;
  }

  async function externalContext(candidate, run) {
    checkCurrent(run);
    state.lastScene = null;
    state.lastSearch = null;
    markActive('skipped');
    step('verifying', 'error', run);
    const wrap = document.createElement('div');
    wrap.className = 'incident-composer__reject';
    wrap.append(message('Outside UAE AOI — external context only', 'info'));
    if (candidate.reason) wrap.append(message(candidate.reason));
    showResult(wrap);
    root.setAttribute('data-state', 'external');
    if (document.defaultView?.CustomEvent)
      document.defaultView.dispatchEvent(
        new document.defaultView.CustomEvent('gev:incident-external'),
      );
    await invoke(run, onExternal, {
      candidate,
      extraction: run.extraction,
      text: run.text,
      signal: run.signal,
    });
    checkCurrent(run);
    return null;
  }
  async function perform(candidate, run) {
    checkCurrent(run);
    if (!candidate.aoi_membership?.inside)
      return externalContext(candidate, run);
    // BUILD always constructs the geographic scene; an incident question is
    // research intent, never evidence that an incident actually occurred.
    return run.extraction?.intent === 'incident_search' && !buildResearchScene
      ? searchAt(candidate, run)
      : build(candidate, run);
  }
  async function choose(candidate, run) {
    if (!current(run) || state.busy) return;
    setBusy(true);
    hideResult();
    retry.hidden = true;
    try {
      await bounded(run, () => perform(candidate, run));
    } catch (error) {
      await failed(error, run);
    } finally {
      if (current(run)) setBusy(false);
    }
  }
  function offerPicker(candidates, run) {
    checkCurrent(run);
    const wrap = document.createElement('div');
    wrap.className = 'incident-composer__picker';
    wrap.id = `${COMPOSER_ID}-picker`;
    wrap.append(message('Several places match — pick one:', 'info'));
    for (const candidate of candidates)
      wrap.appendChild(
        candidateRow(candidate, (chosen) => void choose(chosen, run)),
      );
    showResult(wrap);
    step('verifying', 'active', run);
    root.setAttribute('data-state', 'pick');
  }

  function selectedTime() {
    const historical = timeSelect.value === 'historical';
    const utc = (value) =>
      value
        ? `${value.replace(/Z$/, '')}${value.length === 16 ? ':00' : ''}Z`
        : null;
    return {
      windowHours: Number(timeSelect.value) || 1,
      timeMode: historical ? 'historical' : 'recent',
      ...(historical
        ? {
            windowStart: utc(historicalStart.value),
            windowEnd: utc(historicalEnd.value),
          }
        : {}),
    };
  }
  function validTime(selection) {
    return (
      selection.timeMode !== 'historical' ||
      (Number.isFinite(Date.parse(selection.windowStart)) &&
        Number.isFinite(Date.parse(selection.windowEnd)) &&
        Date.parse(selection.windowStart) < Date.parse(selection.windowEnd) &&
        Date.parse(selection.windowEnd) <= Date.now())
    );
  }
  function showLocalPrompt(text) {
    const slots = unresolvedPromptTokens(text);
    if (slots.length) {
      showResult(
        message(
          `Replace the prompt placeholders before building: ${slots.join(', ')}`,
          'hint',
        ),
      );
      root.setAttribute('data-state', 'unresolved');
      return {
        plan: { kind: 'unresolved', placeholders: slots },
        scene: null,
        search: null,
      };
    }
    if (
      !text ||
      parseIncidentQuery(text, { defaultIntent: 'build_scene' }).kind ===
        'conversational'
    ) {
      showResult(message(CONVERSATIONAL_HINT, 'hint'));
      root.setAttribute('data-state', 'hint');
      return {
        plan: { kind: 'hint' },
        scene: null,
        search: null,
        hint: CONVERSATIONAL_HINT,
      };
    }
    return null;
  }

  async function submitText(
    text,
    {
      timeChange = false,
      origin = 'explicit',
      selectedTime: explicitSelectedTime = null,
      intentionalVoice = false,
    } = {},
  ) {
    if (timeChange) return updateTime();
    if (destroyed) return null;

    // Origin allowlist check: Every draft update, input, paste, focus, time change,
    // programmatic or speech update MUST NOT generate. Explicit Build scene or Ctrl/Cmd+Enter only.
    if (!['explicit', 'refinement', 'retry'].includes(origin)) {
      // Voice can seed an empty, unfocused draft only after an intentional interaction.
      // No transcript/end/silence event is a construction admission path.
      if (
        (origin === 'speech' || origin === 'voice') &&
        intentionalVoice &&
        !input.value &&
        document.activeElement !== input
      ) {
        input.value = String(text ?? '').slice(0, 6000);
        editPrompt();
      }
      return null;
    }

    const trimmed = String(text ?? '')
      .trim()
      .slice(0, 6000);

    const parsedPrompt = parseIncidentQuery(trimmed, {
      defaultIntent: 'build_scene',
    });
    const selected = selectedTime();
    const promptHasRecentWindow =
      /\b(?:last|past)\s+\d+\s*(?:h|hour|hr|day)/i.test(trimmed);
    const currentTimeSelection =
      explicitSelectedTime ||
      (selected.timeMode !== 'historical' && promptHasRecentWindow
        ? { ...selected, windowHours: parsedPrompt.windowHours }
        : selected);
    const selectionKey = `${currentTimeSelection.windowHours}|${currentTimeSelection.timeMode}|${currentTimeSelection.windowStart || ''}|${currentTimeSelection.windowEnd || ''}`;

    // Synchronous admission check before first await so rapid click+keyboard only one run:
    if (
      state.busy &&
      activeRun?.kind === 'prompt' &&
      trimmed === (activeRun.snapshot?.text ?? state.text) &&
      selectionKey === (activeRun.snapshot?.scopeKey ?? state.submittedScope)
    ) {
      root.setAttribute('data-duplicate', String(Date.now()));
      return activeRun.promise || null;
    }

    if (admissionOwner && !activeRun) {
      root.setAttribute('data-duplicate', String(Date.now()));
      return activeRun?.promise || null;
    }
    const admission = {};

    try {
      invalidate({
        promptChanged: trimmed !== state.text || state.promptRevision === 0,
      });
      admissionOwner = admission;
      // Busy/admission are synchronous before callbacks or the first await.
      setBusy(true);
      notifyStarted();
      state.text = trimmed;
      state.candidates = [];
      state.lastPlan = null;
      state.extraction = null;
      clearScene();
      resetSteps();
      setBusy(false);
      retry.hidden = true;

      const local = showLocalPrompt(trimmed);
      if (local) {
        if (!trimmed) input.focus?.({ preventScroll: true });
        return trimmed ? local : null;
      }

      const parsed = parsedPrompt;
      if (
        !explicitSelectedTime &&
        currentTimeSelection.timeMode !== 'historical' &&
        promptHasRecentWindow
      ) {
        const value = String(currentTimeSelection.windowHours);
        if (
          ![...timeSelect.children].some((option) => option.value === value)
        ) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = `Last ${value} hours`;
          timeSelect.appendChild(option);
        }
        timeSelect.value = value;
      }
      historicalStart.hidden = historicalEnd.hidden =
        timeSelect.value !== 'historical';
      Object.assign(parsed, currentTimeSelection);
      if (!validTime(parsed)) {
        showResult(
          message(
            'Choose a valid past recording interval in UTC before building.',
            'error',
          ),
        );
        root.setAttribute('data-state', 'error');
        return null;
      }

      const snapshot = Object.freeze({
        text: trimmed,
        selectedTime: Object.freeze({ ...currentTimeSelection }),
        scopeKey: selectionKey,
      });
      lastSubmittedSnapshot = snapshot;
      state.submittedScope = selectionKey;
      state.abort =
        typeof AbortController === 'function' ? new AbortController() : null;
      const run = {
        id: state.generation,
        revision: state.promptRevision,
        kind: 'prompt',
        signal: state.abort?.signal,
        text: trimmed,
        extraction: null,
        stage: 'locating',
        snapshot,
      };
      activeRun = run;
      retry.hidden = true;
      setBusy(true);
      hideResult();
      resetSteps();
      // Immediate, visible acknowledgement before any network round-trip.
      showResult(
        pending(`Locating “${(parsed.place || trimmed).slice(0, 80)}”…`),
      );
      root.setAttribute('data-state', 'busy');

      run.promise = (async () => {
        try {
          state.extraction = run.extraction = parsed;
          step('locating', 'active', run);
          const located = await bounded(run, () =>
            client.locate(trimmed, { signal: run.signal }),
          );
          checkCurrent(run);
          // Geocoding supplies coordinates, not the form's intent. An older server
          // may classify a bare AOI as a search; retain the explicit BUILD default.
          state.extraction = run.extraction = {
            ...located?.extraction,
            ...run.extraction,
          };
          state.candidates = located?.candidates || [];
          const plan = planFromCandidates(state.candidates);
          state.lastPlan = plan;
          step('locating', plan.kind === 'none' ? 'error' : 'done', run);
          let outcome = null;
          if (plan.kind === 'none') {
            showResult(
              message(
                located?.status === 'unavailable'
                  ? `Location lookup unavailable (${(located.steps || [])
                      .filter((s) => s.error)
                      .map((s) => s.error)
                      .join('; ')}). Incident search was not performed.`
                  : 'No place could be identified in that text. Name a city, port, strait or coordinates inside the UAE areas of interest.',
                'error',
              ),
            );
            retry.hidden = false;
            setChips(false, { error: true });
            lastFailedSnapshot = snapshot;
            // Never leave the operator on the boot view after an AOI request.
            try {
              await bounded(run, () =>
                invoke(run, onUnresolved, {
                  text: trimmed,
                  extraction: run.extraction,
                  status: located?.status || 'none',
                }),
              );
            } catch {}
          } else if (plan.kind === 'single' || plan.kind === 'out-of-aoi') {
            outcome = await bounded(run, () => perform(plan.candidate, run));
          } else {
            offerPicker(plan.candidates, run);
          }
          checkCurrent(run);
          return {
            plan,
            scene:
              run.extraction?.intent === 'incident_search' ? null : outcome,
            search: state.lastSearch,
          };
        } catch (error) {
          await failed(error, run);
          return null;
        } finally {
          if (current(run)) setBusy(false);
        }
      })();

      return await run.promise;
    } finally {
      if (admissionOwner === admission) admissionOwner = null;
    }
  }

  function editPrompt() {
    if (destroyed) return;
    // Synchronously invalidate any in-flight runs without initiating expensive work or auto-submitting
    invalidate({ promptChanged: true });
    notifyStarted();
    state.text = String(input.value || '')
      .trim()
      .slice(0, 6000);
    state.candidates = [];
    state.lastPlan = null;
    state.extraction = null;
    clearScene();
    resetSteps();
    setBusy(false);
    retry.hidden = !lastFailedSnapshot;
    if (lastFailedSnapshot)
      retry.title =
        'Retry the previous submitted prompt and recording window; keep this draft unchanged';
    if (showLocalPrompt(state.text)) return;
    hideResult();
    root.setAttribute('data-state', 'idle');
    // NOTE: Removed automatic submit debounce (previously 300ms bug).
    // Submission is explicit only (Build scene button or Ctrl/Cmd+Enter).
  }

  async function updateTime() {
    if (destroyed) return null;
    const selection = selectedTime();
    historicalStart.hidden = historicalEnd.hidden =
      selection.timeMode !== 'historical';
    updateStackHeight();
    // A recording-window change is never a construction trigger.
    // Without an existing scene there is nothing to filter.
    if (!state.lastScene || typeof onTimeChange !== 'function') return null;
    const scene = state.lastScene?.scene ?? state.lastScene;
    const payload = lastPayload;
    invalidate();
    state.abort =
      typeof AbortController === 'function' ? new AbortController() : null;
    const run = {
      id: state.generation,
      revision: state.promptRevision,
      kind: 'time',
      signal: state.abort?.signal,
      text: state.text,
      extraction: state.extraction,
      stage: 'time',
    };
    activeRun = run;
    setBusy(false);
    if (!validTime(selection)) {
      showResult(
        message(
          'Choose a valid past recording interval in UTC before updating.',
          'error',
        ),
      );
      root.setAttribute('data-state', 'error');
      return null;
    }
    retry.hidden = true;
    setBusy(true);
    showResult(pending('Updating recording window…'));
    root.setAttribute('data-state', 'busy');
    try {
      const outcome = await bounded(run, () =>
        invoke(run, onTimeChange, {
          scene,
          selectedTime: selection,
          text: state.text,
        }),
      );
      checkCurrent(run);
      state.extraction = run.extraction = { ...state.extraction, ...selection };
      state.submittedScope = `${timeSelect.value}|${historicalStart.value || ''}|${historicalEnd.value || ''}`;
      if (payload)
        sceneSuccess(
          { ...payload, selectedTime: selection, ...callbackContext(run) },
          run,
        );
      else {
        showResult(message('Recording window updated.', 'ok'));
        root.setAttribute('data-state', 'done');
      }
      return outcome;
    } catch (error) {
      await failed(error, run);
      return null;
    } finally {
      if (current(run)) setBusy(false);
    }
  }

  function restorePrompt(text, { selectedTime: selection } = {}) {
    if (destroyed) return;
    invalidate({ promptChanged: true });
    input.value = String(text ?? '').slice(0, 6000);
    lastFailedSnapshot = null;
    state.text = input.value.trim();
    state.extraction = null;
    state.lastPlan = null;
    state.candidates = [];
    clearScene();
    if (selection) {
      const value =
        selection.timeMode === 'historical'
          ? 'historical'
          : String(selection.windowHours || 1);
      if (![...timeSelect.children].some((option) => option.value === value)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = `Last ${value} hours`;
        timeSelect.appendChild(option);
      }
      timeSelect.value = value;
      historicalStart.value = String(selection.windowStart || '')
        .replace(/Z$/, '')
        .slice(0, 16);
      historicalEnd.value = String(selection.windowEnd || '')
        .replace(/Z$/, '')
        .slice(0, 16);
    }
    historicalStart.hidden = historicalEnd.hidden =
      timeSelect.value !== 'historical';
    setBusy(false);
    retry.hidden = true;
    resetSteps();
    hideResult();
    if (unresolvedPromptTokens(state.text).length) showLocalPrompt(state.text);
    else root.setAttribute('data-state', 'idle');
    updateStackHeight();
  }

  timeSelect.addEventListener('change', () => {
    void updateTime();
  });
  for (const field of [historicalStart, historicalEnd]) {
    field.addEventListener('change', () => {
      void updateTime();
    });
    // Enter in a date/time field edits the range; it never builds a scene.
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') event.preventDefault?.();
    });
  }
  cancelButton.addEventListener('click', cancelRequest);
  retry.addEventListener('click', () => {
    if (!state.busy && !destroyed) {
      if (activeRun?.kind === 'time') {
        void updateTime();
      } else {
        const retrySnapshot = lastFailedSnapshot || lastSubmittedSnapshot;
        const retryText = retrySnapshot?.text ?? (state.text || input.value);
        const retryTime = retrySnapshot?.selectedTime ?? null;
        void submitText(retryText, {
          origin: 'explicit',
          selectedTime: retryTime,
        });
      }
    }
  });
  // Explicit admission: one click/tap (pointer or keyboard activation) of the
  // Build scene button. A same-tick repeat (double click, click + form submit)
  // is coalesced by the synchronous admission owner inside submitText.
  // Identical repeats while busy return the in-flight run (no second request);
  // an edited prompt explicitly supersedes the pending one.
  const explicitSubmit = (event) => {
    event?.preventDefault?.();
    if (composing || event?.isComposing || destroyed) return null;
    return submitText(input.value, { origin: 'explicit' });
  };
  submit.addEventListener('click', (event) => {
    void explicitSubmit(event);
  });
  // The form still owns accessible requestSubmit() calls (programmatic or AT);
  // native implicit submission is impossible because no submit button exists.
  root.addEventListener('submit', (event) => {
    void explicitSubmit(event);
  });
  input.addEventListener('input', editPrompt);
  input.addEventListener('paste', () => {
    editPrompt();
  });
  input.addEventListener('compositionstart', () => {
    composing = true;
  });
  input.addEventListener('compositionend', () => {
    composing = false;
    editPrompt();
  });
  input.addEventListener('keydown', (event) => {
    event.stopPropagation?.();
    const isComposing = event.isComposing || composing || event.keyCode === 229;
    if (event.key === 'Enter') {
      if (isComposing) {
        return;
      }
      if (event.repeat) {
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault?.();
        }
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault?.();
        void submitText(input.value, { origin: 'explicit' });
        return;
      }
      // Plain Enter (and Shift/Alt+Enter) is the textarea's native newline, never a submit.
    }
  });

  return {
    element: root,
    input,
    evidenceSlot,
    setPlaybackState,
    submit: submitText,
    restorePrompt,
    attachStoredScene(scene) {
      state.lastScene = scene;
    },
    cancel: cancelRequest,
    state,
    destroy() {
      destroyed = true;
      invalidate();
      state.busy = false;
      admissionOwner = null;
      resizeObserver?.disconnect();
      view?.removeEventListener?.('resize', updateDockClearance);
      layoutHost?.style?.removeProperty?.('--incident-composer-height');
      root.remove?.();
    },
  };
}
