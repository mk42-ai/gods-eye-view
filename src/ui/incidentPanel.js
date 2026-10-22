/**
 * UAE AOI incident panel — the live-incident additions to the SCENES panel:
 *   • group dropdown entries (UAE AOI (all) / IRAN / YEMEN / SOMALIA / UAE HOME BORDER)
 *   • LIVE · SEED · NO KEY badge with LAST REFRESH <UTC> and a REFRESH button
 *   • scene-card decoration (country chip, severity chip, live time-since,
 *     source link) rendered beside the existing preset line + LOAD/DEL
 *   • the docked bottom composer ("Type an incident...") → POST
 *     /api/incidents/resolve → fly camera → new scene card → persist through
 *     the same-origin /api/incidents/composer proxy (secret stays server-side)
 *   • the OUTSIDE UAE AOI warning with ADD ANYWHERE / CANCEL
 *
 * Pure DOM + fetch; every network call is injectable so node:test can drive
 * it with doubles. No simulated progress: the inline status only reflects the
 * real in-flight request.
 */
import {
  UAE_AOI_GROUP_IDS,
  UAE_AOI_GROUP_LABELS,
  groupArtwork,
} from '../data/uaeAoi.js';
import {
  incidentToShot,
  groupSceneFor,
  timeSince,
  cameraPresetFor,
  normaliseSeverity,
} from '../data/uaeIncidents.js';

export const INCIDENTS_API = '/api/incidents';
export const COMPOSER_PLACEHOLDER = 'Type an incident...';
const TICK_MS = 30_000;

/** Badge text + modifier from a GET /api/incidents payload. */
export function badgeFor(payload) {
  const state = payload?.state || (payload ? 'SEED' : 'OFFLINE');
  const last = payload?.lastRefreshUtc
    ? `LAST REFRESH ${formatUtc(payload.lastRefreshUtc)}`
    : state === 'NO KEY'
      ? 'ONDEMAND_API_KEY NOT SET'
      : 'SEED DATA · NOT YET REFRESHED';
  return {
    state,
    detail: last,
    modifier: state.toLowerCase().replace(/\s+/g, '-'),
  };
}

export function formatUtc(iso) {
  const d = new Date(iso || NaN);
  if (!Number.isFinite(d.getTime())) return '—';
  return `${d.toISOString().slice(0, 16).replace('T', ' ')}Z`;
}

/** Scene-card chips for one incident shot (null for ordinary shots). */
export function cardMetaFor(shot) {
  const inc = shot?.incident;
  if (!inc) return null;
  return {
    country: inc.country || (inc.insideAoi === false ? 'OUTSIDE AOI' : '—'),
    severity: normaliseSeverity(inc.severity),
    eventTimeUtc: inc.event_time_utc || null,
    sourceUrl: inc.source_url || null,
    sourceName:
      inc.source_name || (inc.source_url ? hostOf(inc.source_url) : null),
    incidentType: inc.incident_type || null,
    outside: inc.insideAoi === false,
  };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

/** Decorate a rendered scene row with the incident chips (idempotent). */
export function decorateSceneRow(
  row,
  shot,
  { now = () => Date.now(), documentRef = document } = {},
) {
  const meta = cardMetaFor(shot);
  const existing = row.querySelector?.('.scene-card-meta');
  if (!meta) {
    existing?.remove();
    return null;
  }
  const el = existing || documentRef.createElement('div');
  el.className = 'scene-card-meta';
  el.textContent = '';
  const chip = (text, cls, title) => {
    const span = documentRef.createElement('span');
    span.className = `scene-chip ${cls}`;
    span.textContent = text;
    if (title) span.title = title;
    el.appendChild(span);
    return span;
  };
  chip(
    meta.country,
    meta.outside
      ? 'scene-chip-country scene-chip-outside'
      : 'scene-chip-country',
    meta.incidentType || undefined,
  );
  chip(
    meta.severity,
    `scene-chip-severity scene-chip-severity-${meta.severity.toLowerCase()}`,
  );
  const since = chip(
    timeSince(meta.eventTimeUtc, now()),
    'scene-chip-time',
    meta.eventTimeUtc ? `event ${formatUtc(meta.eventTimeUtc)}` : undefined,
  );
  since.dataset.eventTimeUtc = meta.eventTimeUtc || '';
  if (meta.sourceUrl) {
    const a = documentRef.createElement('a');
    a.className = 'scene-chip scene-chip-source';
    a.href = meta.sourceUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = meta.sourceName || 'SOURCE';
    a.title = meta.sourceUrl;
    el.appendChild(a);
  }
  if (!existing) {
    const top = row.querySelector?.('.scene-shot-top');
    if (top && top.nextSibling) row.insertBefore(el, top.nextSibling);
    else row.appendChild(el);
  }
  return el;
}

/** Refresh every live time-since chip under `root`. */
export function tickTimeSince(root, now = Date.now()) {
  for (const el of root?.querySelectorAll?.(
    '.scene-chip-time[data-event-time-utc]',
  ) || [])
    el.textContent = timeSince(el.dataset.eventTimeUtc || null, now);
}

/** Group dropdown model: 'ALL' + the four groups, in order. */
export function groupOptions() {
  return [
    { id: 'ALL', label: UAE_AOI_GROUP_LABELS.ALL },
    ...UAE_AOI_GROUP_IDS.map((id) => ({
      id,
      label: UAE_AOI_GROUP_LABELS[id],
      artwork: groupArtwork(id),
    })),
  ];
}

/** Which library scenes are visible for a group filter. */
export function scenesForGroup(scenes, group) {
  if (!group || group === 'ALL') return scenes;
  const wanted = groupSceneFor(group).id;
  return scenes.filter(
    (scene) => scene.id === wanted || !scene.id?.startsWith('uae-aoi-'),
  );
}

/** Build the incident object the composer persists from a resolve response. */
export function incidentFromResolution(
  text,
  resolution,
  { now = () => new Date() } = {},
) {
  const lat = Number(resolution.lat);
  const lon = Number(resolution.lon);
  const headline = (
    resolution.summary && resolution.summary.length <= 140
      ? resolution.summary
      : text
  )
    .trim()
    .slice(0, 240);
  return {
    headline:
      resolution.placeName &&
      !headline.toLowerCase().includes(resolution.placeName.toLowerCase())
        ? `${headline} — ${resolution.placeName}`
        : headline,
    country: resolution.country || resolution.matchedAoi?.country || null,
    group: resolution.matchedAoi?.group || null,
    aoi_id: resolution.matchedAoi?.id || null,
    lat,
    lon,
    incident_type: resolution.incident_type || 'unclassified',
    severity: normaliseSeverity(resolution.severity),
    event_time_utc: now().toISOString(),
    summary: resolution.summary || text,
    source_url: resolution.sources?.[0]?.url || null,
    source_name:
      resolution.sources?.[0]?.title ||
      (resolution.provenance?.provider
        ? `resolved via ${resolution.provenance.provider}`
        : null),
    camera: cameraPresetFor({
      aoiId: resolution.matchedAoi?.id,
      severity: normaliseSeverity(resolution.severity),
    }),
    provenance: {
      via: 'composer',
      resolver: resolution.provenance?.provider || null,
      entities: resolution.entities || [],
      text,
    },
    insideAoi: resolution.insideAoi === true,
  };
}

/**
 * Mount the incident additions onto the SCENES panel.
 * @param {object} options
 * @param {object} options.director  SceneDirector (uses addIncidentScene, loadShot, listScenes, subscribe)
 * @param {Document} [options.documentRef]
 * @param {typeof fetch} [options.fetchImpl]
 */
export function installIncidentPanel({
  director,
  documentRef = document,
  fetchImpl = (...a) => globalThis.fetch(...a),
  now = () => Date.now(),
  setIntervalImpl = (...a) => globalThis.setInterval(...a),
  clearIntervalImpl = (...a) => globalThis.clearInterval(...a),
} = {}) {
  const panel = documentRef.getElementById('scene-panel');
  const select = documentRef.getElementById('scene-select');
  const shots = documentRef.getElementById('scene-shot-list');
  if (!panel || !select || !shots) return null;
  const inner = panel.querySelector('.scene-panel-inner') || panel;
  const el = (tag, className, text) => {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // --- group filter --------------------------------------------------------
  const groupRow = el('div', 'scene-controls scene-group-row');
  const groupSelect = el('select', 'scene-group-select');
  groupSelect.id = 'scene-group-select';
  groupSelect.setAttribute('aria-label', 'AOI group');
  for (const opt of groupOptions()) {
    const o = el('option', null, opt.label);
    o.value = opt.id;
    groupSelect.appendChild(o);
  }
  const art = el('img', 'scene-group-art');
  art.alt = '';
  art.hidden = true;
  art.loading = 'lazy';
  const badge = el('div', 'scene-live-badge');
  badge.id = 'scene-live-badge';
  const badgeState = el('span', 'scene-live-state', 'LOADING');
  const badgeDetail = el('span', 'scene-live-detail', 'GET /api/incidents');
  badge.append(badgeState, badgeDetail);
  const refreshBtn = el('button', 'scene-btn scene-refresh-btn', 'REFRESH');
  refreshBtn.id = 'scene-refresh-btn';
  refreshBtn.type = 'button';
  groupRow.append(groupSelect, refreshBtn);
  const badgeRow = el('div', 'scene-live-row');
  badgeRow.append(art, badge);
  const firstControls = inner.querySelector('.scene-controls');
  inner.insertBefore(groupRow, firstControls || shots);
  inner.insertBefore(badgeRow, firstControls || shots);

  const state = {
    group: 'ALL',
    payload: null,
    refreshing: false,
    resolving: false,
  };

  function applyGroup(group) {
    state.group = group;
    const artwork = groupArtwork(group === 'ALL' ? 'UAE_HOME_BORDER' : group);
    art.hidden = !artwork;
    if (artwork) art.src = artwork;
    for (const option of select.querySelectorAll?.('option') || []) {
      const scene = director.listScenes().find((s) => s.id === option.value);
      const visible = !scene || scenesForGroup([scene], group).length > 0;
      option.hidden = !visible;
      option.disabled = !visible;
    }
    if (group !== 'ALL') {
      const target = groupSceneFor(group).id;
      if (
        director.listScenes().some((s) => s.id === target) &&
        select.value !== target
      ) {
        select.value = target;
        select.dispatchEvent(new Event('change'));
      }
    }
  }
  groupSelect.addEventListener('change', () => applyGroup(groupSelect.value));

  function renderBadge(payload, extra) {
    const b = badgeFor(payload);
    badge.className = `scene-live-badge scene-live-badge--${b.modifier}`;
    badgeState.textContent = b.state;
    badgeDetail.textContent = extra || b.detail;
    badge.dataset.state = b.state;
  }

  async function loadIncidents() {
    try {
      const res = await fetchImpl(`${INCIDENTS_API}`, {
        headers: { Accept: 'application/json' },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
      state.payload = payload;
      renderBadge(payload);
      director.syncIncidentLibrary?.(payload.incidents || []);
      return payload;
    } catch (error) {
      renderBadge(
        { state: 'OFFLINE', lastRefreshUtc: null },
        `GET /api/incidents failed: ${error?.message || error}`,
      );
      return null;
    }
  }

  refreshBtn.addEventListener('click', async () => {
    if (state.refreshing) return;
    state.refreshing = true;
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'REFRESHING…';
    renderBadge(state.payload, 'POST /api/incidents/refresh in flight');
    try {
      const res = await fetchImpl(`${INCIDENTS_API}/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(
          state.group === 'ALL' ? {} : { group: state.group },
        ),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);
      await loadIncidents();
      const summary =
        payload.state === 'LIVE'
          ? `LAST REFRESH ${formatUtc(payload.lastRefreshUtc)} · +${payload.added || 0} new · ${payload.duplicates || 0} dup · ${payload.aoisOk || 0}/${payload.aoisQueried || 0} AOIs`
          : payload.state === 'NO KEY'
            ? 'ONDEMAND_API_KEY NOT SET · NO REFRESH ATTEMPTED'
            : `${payload.state || 'ERROR'}`;
      renderBadge(state.payload, summary);
    } catch (error) {
      renderBadge(state.payload, `REFRESH FAILED: ${error?.message || error}`);
    } finally {
      state.refreshing = false;
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'REFRESH';
    }
  });

  // --- card decoration (runs after every SceneControls render) -------------
  const decorateAll = () => {
    const scene = director.getSceneById?.(select.value) || null;
    for (const row of shots.querySelectorAll?.('.scene-shot-row') || []) {
      const shot = scene?.shots.find((s) => s.id === row.dataset.sceneShotId);
      decorateSceneRow(row, shot, { now, documentRef });
    }
    const empty = shots.querySelector?.('.scene-shot-empty');
    if (empty && !empty.classList.contains('scene-shot-empty--calm')) {
      empty.classList.add('scene-shot-empty--calm');
      empty.textContent =
        'No incidents in this AOI group. Type an incident below or press REFRESH.';
    }
  };
  const unsubscribe = director.subscribe?.(() => queueMicrotask(decorateAll));
  const observer =
    typeof MutationObserver === 'function' && shots instanceof Node
      ? new MutationObserver(() => decorateAll())
      : null;
  observer?.observe(shots, { childList: true });
  const timer = setIntervalImpl(() => tickTimeSince(shots, now()), TICK_MS);

  // --- bottom composer -----------------------------------------------------
  const composer = el('form', 'scene-composer');
  composer.id = 'scene-incident-composer';
  composer.setAttribute('aria-label', 'Incident composer');
  const input = el('input', 'scene-composer-input');
  input.id = 'scene-incident-input';
  input.type = 'text';
  input.placeholder = COMPOSER_PLACEHOLDER;
  input.autocomplete = 'off';
  input.maxLength = 2048;
  input.setAttribute('aria-label', COMPOSER_PLACEHOLDER);
  const send = el('button', 'scene-btn scene-composer-send', 'SEND');
  send.id = 'scene-incident-send';
  send.type = 'submit';
  const status = el('div', 'scene-composer-status');
  status.id = 'scene-incident-status';
  status.setAttribute('role', 'status');
  const warning = el('div', 'scene-composer-warning');
  warning.id = 'scene-incident-warning';
  warning.hidden = true;
  const warningText = el('span', 'scene-composer-warning-text');
  const addAnyway = el('button', 'scene-btn scene-composer-add', 'ADD ANYWAY');
  addAnyway.type = 'button';
  const cancel = el(
    'button',
    'scene-btn scene-btn-danger scene-composer-cancel',
    'CANCEL',
  );
  cancel.type = 'button';
  warning.append(warningText, addAnyway, cancel);
  const row = el('div', 'scene-composer-row');
  row.append(input, send);
  composer.append(warning, row, status);
  inner.appendChild(composer);

  let pending = null;
  const setStatus = (text, kind = '') => {
    status.textContent = text;
    status.className = `scene-composer-status${kind ? ` scene-composer-status--${kind}` : ''}`;
  };
  const setBusy = (busy, label) => {
    state.resolving = busy;
    send.disabled = busy;
    input.readOnly = busy;
    send.textContent = busy ? label || 'RESOLVING…' : 'SEND';
  };

  async function commit(text, resolution) {
    const incident = incidentFromResolution(text, resolution, {
      now: () => new Date(now()),
    });
    setBusy(true, 'SAVING…');
    setStatus(
      `FLYING TO ${incident.headline.slice(0, 60)} · POST /api/incidents/composer`,
    );
    let persisted = null;
    try {
      const res = await fetchImpl(`${INCIDENTS_API}/composer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ incident, allowOutside: true }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(
          payload?.rejected?.[0]?.reason ||
            payload?.error ||
            `HTTP ${res.status}`,
        );
      persisted = payload.incident || null;
      if (!persisted && payload.duplicateOf) {
        // Already in the library (same headline + 0.1° cell within 24 h):
        // select and fly to the existing card instead of adding a twin.
        const existing = director.findIncidentShot?.(payload.duplicateOf);
        setStatus(
          `ALREADY IN LIBRARY · duplicate of ${payload.duplicateOf}`,
          'warn',
        );
        if (existing) {
          if (select.value !== existing.sceneId) {
            select.value = existing.sceneId;
            select.dispatchEvent(new Event('change'));
          }
          await director.loadShot?.(existing.sceneId, existing.shotId);
        }
        input.value = '';
        pending = null;
        warning.hidden = true;
        setBusy(false);
        return;
      }
    } catch (error) {
      setStatus(
        `SAVE FAILED: ${error?.message || error} — scene kept locally only`,
        'error',
      );
    }
    const record = persisted || {
      ...incident,
      id: incident.id || `local-${Date.now().toString(36)}`,
    };
    const shot = incidentToShot(record);
    const added = director.addIncidentScene?.(record, shot);
    if (added?.sceneId) {
      applyGroup(state.group);
      if (select.value !== added.sceneId) {
        select.value = added.sceneId;
        select.dispatchEvent(new Event('change'));
      }
      await director.loadShot?.(added.sceneId, added.shotId, {
        flyDuration: Math.max(2.2, Number(incident.camera.dwell_in_s) || 4),
      });
    }
    if (persisted)
      setStatus(
        `ADDED · ${record.country || 'OUTSIDE AOI'} · ${record.severity} · ${record.id}`,
        'ok',
      );
    input.value = '';
    pending = null;
    warning.hidden = true;
    setBusy(false);
    loadIncidents();
  }

  async function submit() {
    const text = input.value.trim();
    if (!text || state.resolving) return;
    warning.hidden = true;
    pending = null;
    setBusy(true);
    const started = now();
    setStatus(
      'POST /api/incidents/resolve · entity extraction + geocoding via OnDemand',
    );
    let resolution;
    try {
      const res = await fetchImpl(`${INCIDENTS_API}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ text }),
      });
      resolution = await res.json().catch(() => null);
      if (!res.ok || !resolution)
        throw new Error(
          resolution?.message || resolution?.error || `HTTP ${res.status}`,
        );
    } catch (error) {
      setBusy(false);
      setStatus(`RESOLVE FAILED: ${error?.message || error}`, 'error');
      return;
    }
    const ms = now() - started;
    if (
      !Number.isFinite(Number(resolution.lat)) ||
      !Number.isFinite(Number(resolution.lon))
    ) {
      setBusy(false);
      setStatus(
        `NO LOCATION FOUND (${resolution.provenance?.provider || 'resolver'}, ${ms} ms) — name a place and try again`,
        'error',
      );
      return;
    }
    setStatus(
      `RESOLVED ${resolution.placeName || `${resolution.lat.toFixed(2)}, ${resolution.lon.toFixed(2)}`} · ${resolution.provenance?.provider || 'resolver'} · ${ms} ms`,
    );
    if (resolution.insideAoi) {
      await commit(text, resolution);
      return;
    }
    pending = { text, resolution };
    warningText.textContent = `OUTSIDE UAE AOI - ${resolution.placeName || `${Number(resolution.lat).toFixed(2)}, ${Number(resolution.lon).toFixed(2)}`}`;
    warning.hidden = false;
    setBusy(false);
  }
  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
    event.stopPropagation();
  });
  addAnyway.addEventListener('click', () => {
    if (pending) commit(pending.text, pending.resolution);
  });
  cancel.addEventListener('click', () => {
    pending = null;
    warning.hidden = true;
    setStatus('CANCELLED — text kept', 'warn');
  });

  // --- boot ----------------------------------------------------------------
  applyGroup('ALL');
  decorateAll();
  loadIncidents();

  return {
    get state() {
      return state;
    },
    loadIncidents,
    submit,
    setGroup: applyGroup,
    elements: {
      groupSelect,
      badge,
      refreshBtn,
      composer,
      input,
      send,
      status,
      warning,
      addAnyway,
      cancel,
    },
    destroy() {
      unsubscribe?.();
      observer?.disconnect();
      clearIntervalImpl(timer);
      groupRow.remove();
      badgeRow.remove();
      composer.remove();
    },
  };
}
