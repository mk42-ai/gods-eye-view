/**
 * Bottom incident composer — fixed input "Type an incident…" on desktop and
 * mobile. Submit → status chips (locating → verifying AOI → building scene)
 * → POST /locate → candidate picker when ambiguous → OUT_OF_AOI reason +
 * "Add anyway (override)" → scene built + flown + auto-played + persisted via
 * the session-scoped /ingest route + added to the scene list.
 *
 * Layout: it sits ABOVE the command dock / serverless banner stack (bottom
 * offset computed in incidents.css) and never overlaps the plugin dock or the
 * mini chat (both right-anchored; the composer is centred and max 640px).
 *
 * `createIncidentComposer` is pure DOM over an injected document so the
 * state machine is unit-testable without a browser.
 */
import {
  COMPOSER_STEPS,
  planFromCandidates,
  incidentFromText,
} from '../client.js';
import { parseCommand } from '../../footage/model.js';

export const COMPOSER_ID = 'incident-composer';
export const COMPOSER_PLACEHOLDER = 'Type an incident…';

export function createIncidentComposer({
  document = globalThis.document,
  client,
  onScene,
  onStatus,
  buildScene,
  onFootageCommand,
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

  const row = document.createElement('div');
  row.className = 'incident-composer__row';
  const icon = document.createElement('span');
  icon.className = 'incident-composer__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'AOI';
  const input = document.createElement('input');
  input.type = 'text';
  input.id = `${COMPOSER_ID}-input`;
  input.className = 'incident-composer__input';
  input.placeholder = COMPOSER_PLACEHOLDER;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', COMPOSER_PLACEHOLDER);
  input.setAttribute('enterkeyhint', 'go');
  input.maxLength = 500;
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.id = `${COMPOSER_ID}-submit`;
  submit.className = 'incident-composer__submit';
  submit.textContent = 'BUILD SCENE';
  row.append(icon, input, submit);

  const chips = document.createElement('div');
  chips.className = 'incident-composer__chips';
  chips.id = `${COMPOSER_ID}-chips`;
  chips.setAttribute('aria-live', 'polite');
  const result = document.createElement('div');
  result.className = 'incident-composer__result';
  result.id = `${COMPOSER_ID}-result`;
  result.hidden = true;
  root.append(row, chips, result);

  const state = {
    busy: false,
    text: '',
    candidates: [],
    steps: {},
    lastPlan: null,
    lastScene: null,
    footage: null,
    abort: null,
  };

  function setChips(active, { error = false, done = false } = {}) {
    chips.replaceChildren();
    for (const step of COMPOSER_STEPS) {
      const chip = document.createElement('span');
      chip.className = 'incident-composer__chip';
      chip.dataset.step = step.id;
      const status = state.steps[step.id] || 'pending';
      chip.dataset.status = status;
      chip.textContent = step.label;
      chips.appendChild(chip);
    }
    if (error) root.setAttribute('data-state', 'error');
    else if (done) root.setAttribute('data-state', 'done');
    else root.setAttribute('data-state', active ? 'busy' : 'idle');
  }
  function step(id, status) {
    state.steps[id] = status;
    setChips(true);
    onStatus?.({ step: id, status });
  }
  function resetSteps() {
    state.steps = {};
    chips.replaceChildren();
    root.setAttribute('data-state', 'idle');
  }
  function showResult(node) {
    result.replaceChildren(node);
    result.hidden = false;
  }
  function hideResult() {
    result.replaceChildren();
    result.hidden = true;
  }
  function message(text, kind = 'info') {
    const p = document.createElement('p');
    p.className = `incident-composer__message incident-composer__message--${kind}`;
    p.textContent = text;
    return p;
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

  async function build(candidate, { override = false } = {}) {
    step(
      'verifying',
      candidate.aoi_membership?.inside || override ? 'done' : 'error',
    );
    step('building', 'active');
    const raw = incidentFromText(state.text, candidate, { override });
    let ingest;
    try {
      ingest = await client.ingest(raw, { signal: state.abort?.signal });
    } catch (err) {
      step('building', 'error');
      showResult(
        message(`Could not persist the incident: ${err.message}`, 'error'),
      );
      setChips(false, { error: true });
      return null;
    }
    const inserted = ingest?.inserted?.[0] || ingest?.existing?.[0] || null;
    let scene = ingest?.scenes?.[0] || null;
    // Same category/cell/6h bucket already in the ledger → the server hands
    // back that incident (`existing`) and its scene; reuse them.
    const reused = !ingest?.inserted?.length && ingest?.duplicates?.length > 0;
    if (!reused && !inserted && ingest?.rejected?.length) {
      step('building', 'error');
      showResult(message(ingest.rejected[0].reason, 'error'));
      setChips(false, { error: true });
      return null;
    }
    if (!scene && inserted && typeof buildScene === 'function')
      scene = buildScene([inserted]);
    if (!scene) {
      step('building', 'error');
      showResult(
        message('No scene could be built from this incident.', 'error'),
      );
      setChips(false, { error: true });
      return null;
    }
    if (override)
      scene = { ...scene, override: true, reason: candidate.reason };
    state.lastScene = scene;
    step('building', 'done');
    setChips(false, { done: true });
    showResult(
      message(
        reused
          ? `An equivalent incident is already in the ledger (same place, category and 6 h window) — reusing scene "${scene.title}" at ${candidate.name} and playing it.`
          : `Scene "${scene.title}" built at ${candidate.name} — playing.`,
        'ok',
      ),
    );
    try {
      await onScene?.({
        scene,
        incident: inserted || null,
        candidate,
        override,
        ingest,
        footage: state.footage,
      });
    } catch (err) {
      showResult(
        message(
          `Scene built but playback failed: ${err?.message || err}`,
          'error',
        ),
      );
    }
    return scene;
  }

  function offerOverride(candidate) {
    const wrap = document.createElement('div');
    wrap.className = 'incident-composer__reject';
    wrap.append(message(candidate.reason || 'OUT_OF_AOI', 'error'));
    const hint = message(
      `"${candidate.name}" is outside the configured UAE areas of interest. Scenes are restricted to the AOI unless you override.`,
      'info',
    );
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = `${COMPOSER_ID}-override`;
    btn.className = 'incident-composer__override';
    btn.textContent = 'Add anyway (override)';
    btn.addEventListener('click', () => {
      hideResult();
      void build(candidate, { override: true });
    });
    wrap.append(hint, btn);
    showResult(wrap);
    setChips(false, { error: true });
  }

  function offerPicker(candidates) {
    const wrap = document.createElement('div');
    wrap.className = 'incident-composer__picker';
    wrap.id = `${COMPOSER_ID}-picker`;
    wrap.append(message('Several places match — pick one:', 'info'));
    for (const c of candidates) {
      wrap.appendChild(
        candidateRow(c, (chosen) => {
          hideResult();
          if (chosen.aoi_membership?.inside) void build(chosen);
          else offerOverride(chosen);
        }),
      );
    }
    showResult(wrap);
    step('verifying', 'active');
    root.setAttribute('data-state', 'pick');
  }

  async function submitText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed || state.busy) return null;
    // "rebuild / replay / show … reported in <place>" is a LIVE FOOTAGE
    // command: route it to the dock (fly-to + footage fetch) and still build
    // the incident scene from the incident words + resolved place.
    // Gods-Eye (2026-10-23): EVERY prompt — a bare place ("Burj Khalifa"),
    // "<incident> in <place>" or "rebuild the <incident> reported in <place>"
    // — is offered to the scene engine first; it parses, checks the AOI
    // register, calls the route agent, flies S0→S4 and fetches footage. The
    // legacy /locate ledger path only runs when the engine is not installed.
    const command = parseCommand(trimmed) || { raw: trimmed };
    command.raw = command.raw || trimmed;
    const footage = onFootageCommand ? onFootageCommand(command) : null;
    if (footage?.handled && footage.managed) {
      // The workstation owns status chips, result AND the button's
      // building/disabled state for engine builds — nothing here may
      // re-enable the button underneath it.
      return { plan: { kind: 'engine' }, scene: null, command };
    }
    if (footage?.handled && !footage.alsoBuildScene) {
      showResult(
        message(
          footage.message ||
            `SCENE · ${command.incident || command.placeText || trimmed}`,
          'ok',
        ),
      );
      setChips(false, { done: true });
      return { plan: { kind: 'footage' }, scene: null, command };
    }
    state.footage = footage?.handled ? { ...footage, command } : null;
    state.busy = true;
    state.text = trimmed;
    state.abort?.abort();
    state.abort =
      typeof AbortController === 'function' ? new AbortController() : null;
    submit.disabled = true;
    hideResult();
    resetSteps();
    step('locating', 'active');
    let located;
    try {
      located = await client.locate(trimmed, { signal: state.abort?.signal });
    } catch (err) {
      step('locating', 'error');
      showResult(message(`Locate failed: ${err.message}`, 'error'));
      setChips(false, { error: true });
      state.busy = false;
      submit.disabled = false;
      return null;
    }
    state.candidates = located?.candidates || [];
    if (!state.candidates.length && command?.place) {
      // Offline neighbourhood dictionary (src/footage/model.js) — the server
      // gazetteer may lag behind it; Dubai neighbourhoods are inside the
      // UAE territorial-waters AOI so they build without an override.
      state.candidates = [
        {
          name: command.place.name,
          lat: command.place.lat,
          lon: command.place.lon,
          country: 'AE',
          confidence: 0.8,
          source: 'footage-dictionary',
          verified: true,
          aoi_membership: { inside: true, aoi_ids: [], nearest: null },
          reason: 'IN_AOI: Dubai neighbourhood dictionary',
        },
      ];
    }
    const plan = planFromCandidates(state.candidates);
    state.lastPlan = plan;
    step('locating', plan.kind === 'none' ? 'error' : 'done');
    let outcome = null;
    if (plan.kind === 'none') {
      showResult(
        message(
          'No place could be identified in that text. Name a city, port, strait or coordinates inside the UAE areas of interest.',
          'error',
        ),
      );
      setChips(false, { error: true });
    } else if (plan.kind === 'single') {
      outcome = await build(plan.candidate);
    } else if (plan.kind === 'out-of-aoi') {
      step('verifying', 'error');
      offerOverride(plan.candidate);
    } else {
      offerPicker(plan.candidates);
    }
    state.busy = false;
    submit.disabled = false;
    return { plan, scene: outcome };
  }

  root.addEventListener('submit', (event) => {
    event.preventDefault?.();
    void submitText(input.value).then(() => {
      if (root.getAttribute('data-state') === 'done') input.value = '';
    });
  });
  input.addEventListener('keydown', (event) => {
    // Keep the workstation's single-key shortcuts (1–8 presets etc.) out of the field.
    event.stopPropagation?.();
  });

  return {
    element: root,
    input,
    submit: submitText,
    state,
    destroy() {
      state.abort?.abort();
      root.remove?.();
    },
  };
}
