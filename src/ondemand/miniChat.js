/**
 * ASK ONDEMAND — contextual mini chat for ANY workstation object (Phase E).
 *
 * One panel, many object types. Every turn goes to the server-key-only
 * foundation route (`/api/ondemand/v2/chat`, server/ondemand/ foundation/
 * proxy-route.js) — the browser never holds an OnDemand key and sends no
 * `x-ondemand-key` header. Sessions are keyed server-side by
 * (externalUserId, objectType:objectId); the browser remembers its own
 * externalUserId per workspace in localStorage so a reload resumes the same
 * conversation and `GET /messages` replays history.
 *
 *   installMiniChat({ document, window, fetch, storage })  → controller
 *   controller.open({ objectType, objectId, label, fields, position,
 *                     timeWindow, provenance, filters, relatedIds,
 *                     sourceRefs, permissions, starters })
 *   controller.openInvestigation()   // "expand to full investigation"
 *
 * Any component can also dispatch
 *   window.dispatchEvent(new CustomEvent('gev:ask-object', { detail: objectContext }))
 * and `createAskOnDemandButton(objectContext)` returns a ready button.
 *
 * Supported object types (OBJECT_TYPES): organization/entity, intelligence
 * card, map marker, timeline event, graph node, graph edge ("Explain
 * connection"), chart ("Ask about this pattern"), table row, news article,
 * alert, plus the globe object types (earthquake, fire, trafficLayer,
 * regionalBrief, hudSummary, providerBadge …). Unknown types still work with
 * a generic label.
 *
 * Rendering performance (FRONTEND_RECON §1): SSE deltas are coalesced into
 * ONE DOM write per animation frame; the activity/thinking list is capped
 * and virtualised at ACTIVITY_WINDOW rows; the transcript keeps the user's
 * scroll position when they scrolled up (scroll anchoring) and pins to the
 * bottom otherwise. Abort propagates: closing the panel or pressing STOP
 * aborts the fetch, which aborts the upstream OnDemand stream server-side.
 */

import { setIconContent } from '../ui/icons/layerIcon.js';

export const MINI_CHAT_ID = 'ondemand-mini-chat';
export const ASK_OBJECT_EVENT = 'gev:ask-object';
export const USER_STORAGE_KEY = 'ondemand.v2.externalUserId';
export const WORKSPACE_STORAGE_KEY = 'ondemand.v2.workspace';
export const DEV_DETAILS_STORAGE_KEY = 'ondemand.miniChat.devDetails';
export const V2_BASE = '/api/ondemand/v2';
export const ACTIVITY_WINDOW = 200;
export const MAX_CONTEXT_BYTES = 48 * 1024;

/** Object types with their panel labels + default starter prompts. */
export const OBJECT_TYPES = Object.freeze({
  organization: {
    label: 'ORGANIZATION',
    starters: [
      'Who runs this organization and what is it known for?',
      'Any recent news or filings?',
    ],
  },
  entity: {
    label: 'ENTITY',
    starters: [
      'Summarize what is known about this entity.',
      'What sources mention it recently?',
    ],
  },
  intelligenceCard: {
    label: 'INTEL CARD',
    starters: [
      'Explain this card in plain language.',
      'What evidence supports it?',
    ],
  },
  mapMarker: {
    label: 'MAP MARKER',
    starters: [
      'What is at this location right now?',
      'Any reports from this area today?',
    ],
  },
  timelineEvent: {
    label: 'TIMELINE EVENT',
    starters: [
      'What happened here and what preceded it?',
      'Has anything changed since?',
    ],
  },
  graphNode: {
    label: 'GRAPH NODE',
    starters: [
      'Who is this node connected to and why?',
      'Which connections are confirmed vs inferred?',
    ],
  },
  graphEdge: {
    label: 'CONNECTION',
    starters: ['Explain connection', 'What evidence links these two?'],
  },
  chart: {
    label: 'CHART',
    starters: [
      'Ask about this pattern',
      'What explains the trend in this chart?',
    ],
  },
  tableRow: {
    label: 'TABLE ROW',
    starters: ['Explain this row.', 'How does it compare with the others?'],
  },
  newsArticle: {
    label: 'NEWS ARTICLE',
    starters: [
      'Summarize this article and its reliability.',
      'Who else is reporting this?',
    ],
  },
  alert: {
    label: 'ALERT',
    starters: [
      'Why did this alert fire?',
      'Is this a real incident or a data artefact?',
    ],
  },
  earthquake: {
    label: 'EARTHQUAKE',
    starters: [
      'Was this quake felt widely — any damage reports?',
      'Is this part of a swarm or aftershock sequence?',
    ],
  },
  fire: {
    label: 'FIRE HOTSPOT',
    starters: [
      'Is this an active wildfire or agricultural burn?',
      'Which communities are downwind?',
    ],
  },
  trafficLayer: {
    label: 'TRAFFIC',
    starters: [
      'Why is this corridor slow right now?',
      'Explain the DEGRADED status.',
    ],
  },
  regionalBrief: {
    label: 'REGIONAL BRIEF',
    starters: [
      'Give me a 3-line situational brief for this region.',
      "What's driving the headlines here today?",
    ],
  },
  hudSummary: {
    label: 'HUD SUMMARY',
    starters: [
      'Expand this summary into a full SITREP.',
      'What changed in the scene since the last summary?',
    ],
  },
  providerBadge: {
    label: 'PROVIDER STATUS',
    starters: [
      'Explain this status in plain language.',
      'Is this an upstream outage?',
    ],
  },
  layerPanel: {
    label: 'DATA LAYERS',
    starters: ['Which enabled layers currently have data in view?'],
  },
  aircraft: {
    label: 'AIRCRAFT',
    starters: [
      'Where is this flight going?',
      'Any news about this operator today?',
    ],
  },
  vessel: {
    label: 'VESSEL',
    starters: ["What is this vessel's recent port history?"],
  },
  satellite: {
    label: 'SATELLITE',
    starters: ['What mission does this satellite serve?'],
  },
  camera: {
    label: 'CAMERA',
    starters: ['What is visible in this frame right now?'],
  },
  installation: {
    label: 'INSTALLATION',
    starters: ['What is the strategic role of this base?'],
  },
  launch: {
    label: 'LAUNCH',
    starters: ['What is the payload and who is the customer?'],
  },
  transitVehicle: {
    label: 'TRANSIT',
    starters: ['Is this route delayed system-wide today?'],
  },
});

export const SELECTORS = Object.freeze({
  panel: `#${MINI_CHAT_ID}`,
  title: `#${MINI_CHAT_ID}-title`,
  kind: `#${MINI_CHAT_ID}-kind`,
  status: `#${MINI_CHAT_ID}-status`,
  transcript: `#${MINI_CHAT_ID}-transcript`,
  activity: `#${MINI_CHAT_ID}-activity`,
  sources: `#${MINI_CHAT_ID}-sources`,
  input: `#${MINI_CHAT_ID}-input`,
  send: `#${MINI_CHAT_ID}-send`,
  stop: `#${MINI_CHAT_ID}-stop`,
  close: `#${MINI_CHAT_ID}-close`,
  expand: `#${MINI_CHAT_ID}-expand`,
  starters: `#${MINI_CHAT_ID}-starters`,
  dev: `#${MINI_CHAT_ID}-dev`,
  message: '.od-chat__msg',
  assistantMessage: '.od-chat__msg--assistant',
});

/**
 * Select the CSS modifier class for an empty state kind.
 * @param {'no-sessions'|'no-results'|'source-unavailable'|string} kind
 * @returns {string|null}
 */
export function emptyStateFor(kind) {
  switch (kind) {
    case 'no-sessions':
    case 'noSessions':
      return 'od-empty-state--no-sessions';
    case 'no-results':
    case 'noResults':
      return 'od-empty-state--no-results';
    case 'source-unavailable':
    case 'sourceUnavailable':
      return 'od-empty-state--source-unavailable';
    default:
      return null;
  }
}

/**
 * Pure helper summarizing developer/debug details into string lines.
 * @param {{
 *   provenance?: { provider?: string, endpointId?: string, pluginIds?: string[], keySource?: string, fetchedAt?: string },
 *   metrics?: { ttfb?: number, tokens?: number, latency?: number },
 *   frames?: number,
 *   request?: { method?: string, path?: string, objectType?: string, objectId?: string|number, sessionId?: string }
 * }} [input]
 * @returns {string[]}
 */
export function summarizeDevDetails({
  provenance,
  metrics,
  frames,
  request,
} = {}) {
  const lines = [];

  if (request) {
    const parts = [];
    if (request.method || request.path) {
      parts.push(`${request.method || 'POST'} ${request.path || ''}`.trim());
    }
    if (request.objectType || request.objectId) {
      parts.push(
        `object: ${request.objectType || ''}/${request.objectId || ''}`,
      );
    }
    if (request.sessionId) {
      parts.push(`session: ${request.sessionId}`);
    }
    if (parts.length) {
      lines.push(`Request: ${parts.join(' · ')}`);
    }
  }

  if (provenance) {
    const keySource = provenance.keySource || 'server';
    lines.push(`Key source: ${keySource}`);
    if (provenance.provider) {
      lines.push(`Provider: ${provenance.provider}`);
    }
    if (provenance.endpointId) {
      lines.push(`Endpoint: ${provenance.endpointId}`);
    }
    if (Array.isArray(provenance.pluginIds) && provenance.pluginIds.length) {
      lines.push(`Plugins: ${provenance.pluginIds.join(', ')}`);
    }
    if (provenance.fetchedAt) {
      lines.push(`Fetched at: ${provenance.fetchedAt}`);
    }
    lines.push(
      `Provenance: ${JSON.stringify({
        provider: provenance.provider ?? null,
        endpointId: provenance.endpointId ?? null,
        pluginIds: provenance.pluginIds ?? [],
        keySource,
        fetchedAt: provenance.fetchedAt ?? null,
      })}`,
    );
  }

  if (metrics) {
    const metricParts = [];
    if (metrics.ttfb != null) metricParts.push(`ttfb ${metrics.ttfb} ms`);
    if (metrics.tokens != null) metricParts.push(`tokens ${metrics.tokens}`);
    if (metrics.latency != null)
      metricParts.push(`latency ${metrics.latency} ms`);
    if (metricParts.length) {
      lines.push(`Metrics: ${metricParts.join(' · ')}`);
    }
  }

  if (frames != null) {
    lines.push(`SSE frames: ${frames}`);
  }

  return lines;
}

const PRINTABLE = /[^\x21-\x7e]/g;

/** Stable per-browser user id (printable ASCII ≤128) — never a secret. */
export function resolveExternalUserId(
  storage,
  { workspace = 'default', random = Math.random } = {},
) {
  const key = `${USER_STORAGE_KEY}.${workspace}`;
  let id = null;
  try {
    id = storage?.getItem?.(key) || null;
  } catch {
    id = null;
  }
  if (id && /^[\x21-\x7e]{8,128}$/.test(id)) return id;
  const rand = Math.floor(random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0');
  id = `ws-${workspace.replace(PRINTABLE, '_').slice(0, 32)}-${Date.now().toString(36)}-${rand}`;
  try {
    storage?.setItem?.(key, id);
  } catch {
    /* storage unavailable */
  }
  return id;
}

export function resolveWorkspace(storage) {
  try {
    const v = storage?.getItem?.(WORKSPACE_STORAGE_KEY);
    if (v && /^[A-Za-z0-9_.-]{1,64}$/.test(v)) return v;
  } catch {
    /* ignore */
  }
  return 'default';
}

/** Trim a context payload to the server cap, keeping identity fields. */
export function boundContext(ctx) {
  const base = {
    schema: 'ondemand-workstation/object-chat/1',
    objectType: String(ctx?.objectType || 'entity'),
    objectId: String(ctx?.objectId ?? 'unknown'),
    label: ctx?.label ?? null,
    position: ctx?.position ?? null,
    timeWindow: ctx?.timeWindow ?? null,
    fields: ctx?.fields ?? null,
    filters: ctx?.filters ?? null,
    relatedIds: Array.isArray(ctx?.relatedIds)
      ? ctx.relatedIds.slice(0, 50)
      : null,
    sourceRefs: Array.isArray(ctx?.sourceRefs)
      ? ctx.sourceRefs.slice(0, 20)
      : null,
    provenance: ctx?.provenance ?? null,
    permissions: ctx?.permissions ?? null,
    workspace: ctx?.workspace ?? null,
    viewport: ctx?.viewport ?? null,
    capturedAt: new Date().toISOString(),
  };
  let json = JSON.stringify(base);
  if (json.length <= MAX_CONTEXT_BYTES) return base;
  base.fields = { truncated: true };
  base.viewport = null;
  json = JSON.stringify(base);
  if (json.length <= MAX_CONTEXT_BYTES) return base;
  base.relatedIds = null;
  base.sourceRefs = null;
  return base;
}

export function objectKeyOf(ctx) {
  return `${ctx.objectType}:${ctx.objectId}`
    .replace(PRINTABLE, '_')
    .slice(0, 128);
}

/** Parse the foundation's SSE relay (event: + data: blocks). */
export function createV2SseParser() {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      const out = [];
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const evt = parseBlock(block);
        if (evt) out.push(evt);
      }
      return out;
    },
    flush() {
      const rest = buffer;
      buffer = '';
      const evt = rest.trim() ? parseBlock(rest) : null;
      return evt ? [evt] : [];
    },
  };
}

function parseBlock(block) {
  let event = 'message';
  const data = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value.trim();
    else if (field === 'data') data.push(value);
  }
  if (!data.length) return null;
  const raw = data.join('\n');
  let payload = raw;
  try {
    payload = JSON.parse(raw);
  } catch {
    /* raw */
  }
  if (event === 'message' && payload && typeof payload === 'object') {
    if (
      payload.eventType === 'fulfillment' &&
      typeof payload.answer === 'string'
    )
      return { type: 'delta', text: payload.answer, payload };
    if (payload.eventType === 'statusLog')
      return {
        type: 'activity',
        text:
          payload.currentStatusLog?.statusMessage ||
          payload.currentStatusLog?.statusType ||
          'working',
        payload,
      };
    if (payload.eventType === 'metricsLog') return { type: 'metrics', payload };
    if (typeof payload.answer === 'string')
      return { type: 'delta', text: payload.answer, payload };
    return { type: 'other', payload };
  }
  if (event === 'session') return { type: 'session', payload };
  if (event === 'provenance') return { type: 'provenance', payload };
  if (event === 'done') return { type: 'done', payload };
  if (event === 'error')
    return {
      type: 'error',
      message: payload?.error || payload?.message || 'stream error',
      payload,
    };
  if (event === 'heartbeat') return { type: 'heartbeat' };
  return { type: event, payload };
}

/** Render markdown-ish links as anchors, everything else as text (no HTML injection). */
export function renderAnswer(node, text, document) {
  node.replaceChildren();
  const parts = String(text).split(
    /(\[[^\]]{1,200}\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)\]>"']+)/g,
  );
  for (const part of parts) {
    if (!part) continue;
    const md = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
    if (md || /^https?:\/\//.test(part)) {
      const a = document.createElement('a');
      a.href = md ? md[2] : part;
      a.textContent = md
        ? md[1]
        : part.replace(/^https?:\/\//, '').slice(0, 60);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'od-chat__cite';
      node.appendChild(a);
    } else node.appendChild(document.createTextNode(part));
  }
}

function el(document, tag, { id, className, text, attrs } = {}) {
  const node = document.createElement(tag);
  if (id) node.id = id;
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (attrs)
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * @param {{document?:Document, window?:Window, fetch?:typeof fetch, storage?:Storage,
 *   raf?:(cb:FrameRequestCallback)=>number, apiBase?:string, now?:()=>number}} [deps]
 */
export function createMiniChat(deps = {}) {
  const document = deps.document ?? globalThis.document;
  const win = deps.window ?? globalThis.window;
  const fetchImpl = deps.fetch ?? ((...a) => globalThis.fetch(...a));
  const storage =
    deps.storage ??
    (() => {
      try {
        return win?.localStorage ?? null;
      } catch {
        return null;
      }
    })();
  // Per-turn plugin selection (src/ondemand/pluginPanel.js): the panel owns
  // the checkboxes, this reads them at send time; nothing is pre-selected.
  const getPluginIds =
    typeof deps.getPluginIds === 'function'
      ? deps.getPluginIds
      : () => {
          try {
            const ids = win?.__odPlugins?.getSelectedPluginIds?.();
            return Array.isArray(ids) ? ids : [];
          } catch {
            return [];
          }
        };
  const raf =
    deps.raf ??
    ((cb) =>
      typeof win?.requestAnimationFrame === 'function'
        ? win.requestAnimationFrame(cb)
        : setTimeout(() => cb(Date.now()), 16));
  const apiBase = deps.apiBase ?? '';
  const workspace = resolveWorkspace(storage);
  const externalUserId = resolveExternalUserId(storage, { workspace });

  const state = {
    open: false,
    context: null,
    objectKey: null,
    sessionId: null,
    busy: false,
    turns: [],
    activity: [],
    citations: [],
    history: { loaded: false, rows: 0, error: null },
    error: null,
    lastProvenance: null,
    firstTokenMs: null,
    metricsLog: [],
  };
  const ui = {};
  let abortController = null;
  let destroyed = false;
  // rAF coalescing state
  let pendingText = null;
  let pendingNode = null;
  let frameScheduled = false;
  let userScrolledUp = false;

  const headers = (extra = {}) => ({
    'X-Workstation-User': externalUserId,
    'X-Workstation-Workspace': workspace,
    ...extra,
  });

  function build() {
    if (ui.panel) return;
    const panel = el(document, 'aside', {
      id: MINI_CHAT_ID,
      className: 'od-chat od-chat--mini',
      attrs: {
        role: 'dialog',
        'aria-labelledby': `${MINI_CHAT_ID}-title`,
        'aria-modal': 'false',
        'data-open': 'false',
      },
    });
    panel.hidden = true;
    const header = el(document, 'header', {
      className: 'od-chat__header od-chat__header--mini',
    });
    header.appendChild(
      el(document, 'span', {
        className: 'od-chat__brand',
        text: 'ASK ONDEMAND',
      }),
    );
    const titles = el(document, 'div', { className: 'od-chat__titles' });
    ui.title = el(document, 'strong', {
      id: `${MINI_CHAT_ID}-title`,
      className: 'od-chat__title',
      text: 'NO OBJECT',
    });
    ui.kind = el(document, 'span', {
      id: `${MINI_CHAT_ID}-kind`,
      className: 'od-chat__mgrs',
      text: '—',
    });
    titles.append(ui.title, ui.kind);
    header.appendChild(titles);
    ui.expand = el(document, 'button', {
      id: `${MINI_CHAT_ID}-expand`,
      className: 'od-chat__icon-btn',
      text: 'INVESTIGATE',
      attrs: {
        type: 'button',
        title: 'Expand to a full multi-source investigation',
      },
    });
    header.appendChild(ui.expand);
    ui.close = el(document, 'button', {
      id: `${MINI_CHAT_ID}-close`,
      className: 'od-chat__icon-btn od-chat__close',
      attrs: { type: 'button', 'aria-label': 'Close ASK ONDEMAND' },
    });
    setIconContent(ui.close, 'x', {}, document);
    header.appendChild(ui.close);
    panel.appendChild(header);

    const statusRow = el(document, 'div', { className: 'od-chat__status-row' });
    ui.status = el(document, 'span', {
      id: `${MINI_CHAT_ID}-status`,
      className: 'od-chat__status',
      text: 'IDLE',
    });
    ui.keyState = el(document, 'span', {
      className: 'od-chat__key-state',
      text: 'server key',
    });
    statusRow.append(ui.status, ui.keyState);
    panel.appendChild(statusRow);

    ui.starters = el(document, 'div', {
      id: `${MINI_CHAT_ID}-starters`,
      className: 'od-chat__starters',
    });
    panel.appendChild(ui.starters);

    ui.transcript = el(document, 'div', {
      id: `${MINI_CHAT_ID}-transcript`,
      className: 'od-chat__transcript',
      attrs: {
        role: 'log',
        'aria-live': 'polite',
        'aria-relevant': 'additions text',
      },
    });
    ui.transcript.addEventListener?.('scroll', () => {
      const t = ui.transcript;
      userScrolledUp = t.scrollHeight - t.scrollTop - t.clientHeight > 40;
    });
    panel.appendChild(ui.transcript);

    ui.sources = el(document, 'div', {
      id: `${MINI_CHAT_ID}-sources`,
      className: 'od-chat__sources',
    });
    ui.sources.hidden = true;
    panel.appendChild(ui.sources);

    let devOpen = false;
    try {
      devOpen = storage?.getItem?.(DEV_DETAILS_STORAGE_KEY) === '1';
    } catch {
      /* storage unavailable */
    }
    ui.devDetails = el(document, 'details', {
      id: `${MINI_CHAT_ID}-dev`,
      className: 'od-chat__dev',
    });
    if (devOpen) ui.devDetails.open = true;
    ui.devDetails.addEventListener?.('toggle', () => {
      try {
        storage?.setItem?.(
          DEV_DETAILS_STORAGE_KEY,
          ui.devDetails.open ? '1' : '0',
        );
      } catch {
        /* storage unavailable */
      }
    });

    const devSummary = el(document, 'summary', {
      text: 'Developer details',
    });
    ui.devDetails.appendChild(devSummary);

    const devBody = el(document, 'div', {
      id: `${MINI_CHAT_ID}-dev-body`,
      className: 'od-chat__dev-body',
    });

    ui.devLines = el(document, 'div', {
      id: `${MINI_CHAT_ID}-dev-lines`,
      className: 'od-chat__dev-lines',
    });
    devBody.appendChild(ui.devLines);

    ui.activity = el(document, 'ul', {
      id: `${MINI_CHAT_ID}-activity`,
      className: 'od-chat__activity',
      attrs: { 'aria-label': 'OnDemand activity' },
    });
    ui.activity.hidden = true;
    devBody.appendChild(ui.activity);

    ui.devDetails.appendChild(devBody);
    panel.appendChild(ui.devDetails);

    const composer = el(document, 'form', { className: 'od-chat__composer' });
    ui.input = el(document, 'input', {
      id: `${MINI_CHAT_ID}-input`,
      className: 'od-chat__input',
      attrs: {
        type: 'text',
        autocomplete: 'off',
        placeholder: 'Ask about this object…',
        'aria-label': 'Message OnDemand about this object',
      },
    });
    ui.send = el(document, 'button', {
      id: `${MINI_CHAT_ID}-send`,
      className: 'od-chat__btn od-chat__send',
      text: 'SEND',
      attrs: { type: 'submit' },
    });
    ui.stop = el(document, 'button', {
      id: `${MINI_CHAT_ID}-stop`,
      className: 'od-chat__btn od-chat__btn--ghost',
      text: 'STOP',
      attrs: { type: 'button' },
    });
    ui.stop.hidden = true;
    composer.append(ui.input, ui.send, ui.stop);
    composer.addEventListener('submit', (event) => {
      event.preventDefault?.();
      const text = ui.input.value;
      if (!text?.trim()) return;
      ui.input.value = '';
      void ask(text.trim());
    });
    panel.appendChild(composer);
    ui.close.addEventListener('click', () => close());
    ui.stop.addEventListener('click', () => abortController?.abort());
    ui.expand.addEventListener('click', () => void openInvestigation());
    ui.panel = panel;
    (document.body || document.documentElement).appendChild(panel);
  }

  function setStatus(text) {
    if (ui.status) ui.status.textContent = text;
  }

  function pinScroll(force = false) {
    if (!ui.transcript) return;
    if (force || !userScrolledUp) ui.transcript.scrollTop = 1e9;
  }

  function showEmptyState(kind, text) {
    clearEmptyState();
    if (!ui.transcript) return;
    const modifier = emptyStateFor(kind);
    const node = el(document, 'div', {
      className: `od-empty-state ${modifier || ''}`.trim(),
      text,
      attrs: { 'data-empty-state': kind },
    });
    ui.emptyState = node;
    ui.transcript.appendChild(node);
    pinScroll();
  }

  function clearEmptyState() {
    if (ui.emptyState) {
      ui.emptyState.remove?.();
      ui.emptyState = null;
    }
    const existing = ui.transcript?.querySelector?.('.od-empty-state');
    if (existing) existing.remove?.();
  }

  function appendMessage(role, text, extra = {}) {
    clearEmptyState();
    const node = el(document, 'div', {
      className: `od-chat__msg od-chat__msg--${role}`,
      attrs: { 'data-role': role, ...(extra.attrs || {}) },
    });
    if (role === 'assistant') renderAnswer(node, text, document);
    else node.textContent = text;
    ui.transcript.appendChild(node);
    pinScroll();
    return { node, role, text };
  }

  /** rAF-coalesced streaming write: many deltas → one DOM write per frame. */
  function scheduleWrite(message, text) {
    pendingNode = message;
    pendingText = text;
    if (frameScheduled) return;
    frameScheduled = true;
    raf(() => {
      frameScheduled = false;
      if (pendingNode && pendingText !== null) {
        pendingNode.text = pendingText;
        renderAnswer(pendingNode.node, pendingText, document);
        pinScroll();
      }
    });
  }

  function flushWrite() {
    if (pendingNode && pendingText !== null) {
      pendingNode.text = pendingText;
      renderAnswer(pendingNode.node, pendingText, document);
      pinScroll();
    }
    pendingNode = null;
    pendingText = null;
  }

  /** Capped + virtualised activity list: keep ACTIVITY_WINDOW rows in memory, render the last 6. */
  function pushActivity(text) {
    state.activity.push({ at: Date.now(), text: String(text).slice(0, 160) });
    if (state.activity.length > ACTIVITY_WINDOW)
      state.activity.splice(0, state.activity.length - ACTIVITY_WINDOW);
    renderActivity();
    renderDevDetails();
  }
  function renderActivity() {
    if (!ui.activity) return;
    const visible = state.activity.slice(-6);
    ui.activity.hidden = visible.length === 0;
    ui.activity.replaceChildren(
      ...visible.map((row) =>
        el(document, 'li', {
          className: 'od-chat__activity-row',
          text: row.text,
        }),
      ),
    );
    if (state.activity.length > 6) {
      ui.activity.setAttribute(
        'data-hidden-rows',
        String(state.activity.length - 6),
      );
    } else ui.activity.removeAttribute('data-hidden-rows');
  }

  function renderDevDetails() {
    if (!ui.devLines) return;
    const request = state.context
      ? {
          method: 'POST',
          path: `${apiBase}${V2_BASE}/chat`,
          objectType: state.context.objectType,
          objectId: state.context.objectId,
          sessionId: state.sessionId,
        }
      : null;
    const lastTurn = state.turns.at(-1);
    const metrics = lastTurn
      ? {
          ttfb: lastTurn.firstTokenMs,
          tokens: lastTurn.tokens ?? null,
          latency: lastTurn.totalMs,
        }
      : null;
    const frames = lastTurn?.events ?? 0;
    const provenance = state.lastProvenance
      ? {
          provider: state.lastProvenance.provider || null,
          endpointId: state.lastProvenance.endpointId || null,
          pluginIds: state.lastProvenance.pluginIds || [],
          keySource: state.lastProvenance.keySource || 'server',
          fetchedAt: state.lastProvenance.fetchedAt || null,
        }
      : {
          keySource: 'server',
        };

    const lines = summarizeDevDetails({ provenance, metrics, frames, request });
    ui.devLines.replaceChildren(
      ...lines.map((line) =>
        el(document, 'div', {
          className: 'od-chat__dev-line',
          text: line,
        }),
      ),
    );
  }

  function renderSources() {
    if (!ui.sources) return;
    const cites = state.citations.slice(-12);
    ui.sources.hidden = cites.length === 0;
    ui.sources.replaceChildren(
      el(document, 'span', {
        className: 'od-chat__sources-label',
        text: `SOURCES · ${cites.length}`,
      }),
      ...cites.map((c) => {
        const a = el(document, 'a', {
          className: 'od-chat__cite',
          text: (c.title || c.url).slice(0, 48),
          attrs: { href: c.url, target: '_blank', rel: 'noopener noreferrer' },
        });
        return a;
      }),
    );
  }

  function renderStarters() {
    if (!ui.starters) return;
    const meta = OBJECT_TYPES[state.context?.objectType];
    const starters = (
      state.context?.starters ||
      meta?.starters ||
      OBJECT_TYPES.entity.starters
    ).slice(0, 3);
    ui.starters.replaceChildren(
      ...starters.map((s) => {
        const b = el(document, 'button', {
          className: 'od-chat__starter',
          text: s,
          attrs: { type: 'button' },
        });
        b.addEventListener('click', () => void ask(s));
        return b;
      }),
    );
    ui.starters.hidden = state.turns.length > 0 || state.history.rows > 0;
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async function loadHistory() {
    state.history = { loaded: false, rows: 0, error: null };
    try {
      const params = new URLSearchParams({
        externalUserId,
        objectContextKey: state.objectKey,
        limit: '20',
        sort: 'asc',
      });
      const response = await fetchImpl(
        `${apiBase}${V2_BASE}/messages?${params}`,
        { headers: headers() },
      );
      if (response.status === 404) {
        state.history.loaded = true;
        if (
          state.turns.length === 0 &&
          !ui.transcript?.querySelector?.('.od-chat__msg')
        ) {
          showEmptyState(
            'no-sessions',
            'No prior investigation for this object',
          );
        }
        renderStarters();
        renderDevDetails();
        return;
      }
      if (!response.ok) throw new Error(`history ${response.status}`);
      const body = await readJson(response);
      const rows = Array.isArray(body?.data) ? body.data : [];
      state.sessionId = body?.sessionId || state.sessionId;
      for (const row of rows) {
        if (row.query)
          appendMessage('user', row.query, {
            attrs: { 'data-history': 'true' },
          });
        if (row.answer)
          appendMessage('assistant', row.answer, {
            attrs: { 'data-history': 'true' },
          });
      }
      state.history.rows = rows.length;
      state.history.loaded = true;
      if (
        rows.length === 0 &&
        state.turns.length === 0 &&
        !ui.transcript?.querySelector?.('.od-chat__msg')
      ) {
        showEmptyState('no-sessions', 'No prior investigation for this object');
      }
      setStatus('READY');
    } catch (error) {
      state.history.error = error?.message || String(error);
      state.history.loaded = true;
    }
    renderStarters();
    renderDevDetails();
  }

  function open(context) {
    if (destroyed) return;
    build();
    clearEmptyState();
    const bounded = boundContext(context);
    const key = objectKeyOf(bounded);
    const switching = key !== state.objectKey;
    if (switching) {
      abortController?.abort();
      state.context = bounded;
      state.objectKey = key;
      state.turns = [];
      state.activity = [];
      state.citations = [];
      state.sessionId = null;
      state.firstTokenMs = null;
      ui.transcript.replaceChildren();
      renderActivity();
      renderSources();
    } else if (context?.fields) {
      state.context = bounded; // refresh displayed attributes, same session
    }
    const meta = OBJECT_TYPES[bounded.objectType];
    ui.title.textContent = String(bounded.label || bounded.objectId)
      .slice(0, 80)
      .toUpperCase();
    ui.kind.textContent =
      `${meta?.label || bounded.objectType.toUpperCase()} · ${bounded.objectId}`.slice(
        0,
        96,
      );
    ui.panel.setAttribute('data-object-type', bounded.objectType);
    ui.panel.hidden = false;
    ui.panel.setAttribute('data-open', 'true');
    state.open = true;
    setStatus('READY');
    renderStarters();
    renderDevDetails();
    if (switching) void loadHistory();
    ui.input?.focus?.();
    return state;
  }

  async function ask(text, { pluginIds } = {}) {
    if (!state.context || state.busy) return null;
    if (!Array.isArray(pluginIds)) pluginIds = getPluginIds().slice(0, 4);
    state.busy = true;
    ui.send.disabled = true;
    ui.stop.hidden = false;
    ui.starters.hidden = true;
    appendMessage('user', text);
    const turn = {
      at: new Date().toISOString(),
      query: text,
      status: null,
      firstTokenMs: null,
      totalMs: null,
      tokens: 0,
      events: 0,
      ok: false,
    };
    state.turns.push(turn);
    const assistant = appendMessage('assistant', '');
    assistant.node.setAttribute('data-streaming', 'true');
    setStatus('STREAMING…');
    abortController =
      typeof AbortController === 'function' ? new AbortController() : null;
    const started = Date.now();
    let answer = '';
    try {
      const response = await fetchImpl(`${apiBase}${V2_BASE}/chat`, {
        method: 'POST',
        headers: headers({
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        }),
        body: JSON.stringify({
          externalUserId,
          objectContext: state.context,
          query: text,
          responseMode: 'stream',
          ...(pluginIds?.length ? { pluginIds } : {}),
        }),
        signal: abortController?.signal,
      });
      turn.status = response.status;
      if (!response.ok) {
        const body = await readJson(response);
        throw new Error(
          body?.error
            ? `${body.error}${body.message ? ` · ${body.message}` : ''} (HTTP ${response.status})`
            : `HTTP ${response.status}`,
        );
      }
      const parser = createV2SseParser();
      const decoder = new TextDecoder();
      let done = false;
      let streamError = null;
      const handle = (events) => {
        for (const evt of events) {
          if (evt.type === 'heartbeat') continue;
          turn.events += 1;
          if (evt.type === 'session') {
            state.sessionId = evt.payload?.sessionId || state.sessionId;
            if (evt.payload?.keySource)
              ui.keyState.textContent = `${evt.payload.keySource} key`;
          } else if (evt.type === 'delta') {
            if (turn.firstTokenMs === null) {
              turn.firstTokenMs = Date.now() - started;
              state.firstTokenMs = turn.firstTokenMs;
            }
            turn.tokens += 1;
            answer += evt.text;
            scheduleWrite(assistant, answer);
          } else if (evt.type === 'activity') {
            pushActivity(evt.text);
          } else if (evt.type === 'provenance') {
            state.lastProvenance = evt.payload;
            for (const c of evt.payload?.citations || [])
              if (!state.citations.some((x) => x.url === c.url))
                state.citations.push(c);
            renderSources();
            renderDevDetails();
          } else if (evt.type === 'done') done = true;
          else if (evt.type === 'error') streamError = evt.message;
        }
      };
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        for (;;) {
          const { value, done: finished } = await reader.read();
          if (finished) break;
          handle(parser.push(decoder.decode(value, { stream: true })));
          if (done || streamError) break;
        }
        handle(parser.push(decoder.decode()));
      } else handle(parser.push(await response.text()));
      handle(parser.flush());
      flushWrite();
      turn.totalMs = Date.now() - started;
      if (streamError) throw new Error(`stream error · ${streamError}`);
      if (!answer) {
        renderAnswer(
          assistant.node,
          done ? '(empty answer)' : '(no answer received)',
          document,
        );
      }
      turn.ok = true;
      state.metricsLog.push({
        ttfb: turn.firstTokenMs,
        tokens: turn.tokens,
        latency: turn.totalMs,
      });
      const basis = state.lastProvenance?.confidenceBasis;
      setStatus(basis ? `READY · ${basis}` : 'READY');
      if (basis) assistant.node.setAttribute('data-confidence', basis);
      if (!answer || !answer.trim()) {
        showEmptyState('no-results', 'No results from the selected sources');
      }
      renderDevDetails();
    } catch (error) {
      flushWrite();
      const aborted = error?.name === 'AbortError';
      turn.error = aborted ? 'cancelled' : error?.message || String(error);
      turn.totalMs = Date.now() - started;
      if (!answer) {
        assistant.node.classList.remove('od-chat__msg--assistant');
        assistant.node.classList.add('od-chat__msg--error');
        assistant.node.setAttribute('data-role', 'error');
      }
      renderAnswer(
        assistant.node,
        answer ? `${answer}\n\n[${turn.error}]` : turn.error,
        document,
      );
      setStatus(aborted ? 'CANCELLED' : 'TURN FAILED');

      if (!aborted) {
        const status = turn.status;
        const msg = String(turn.error || '');
        const isUnavailable =
          status === 503 ||
          status === 502 ||
          status === 504 ||
          msg.includes('503') ||
          msg.includes('502') ||
          msg.includes('504') ||
          msg.includes('not_configured') ||
          error?.name === 'TypeError' ||
          /network|failed to fetch/i.test(msg);
        if (isUnavailable) {
          showEmptyState('source-unavailable', turn.error);
        }
      }
      renderDevDetails();
    } finally {
      assistant.node.removeAttribute('data-streaming');
      abortController = null;
      state.busy = false;
      ui.send.disabled = false;
      ui.stop.hidden = true;
      ui.input?.focus?.();
    }
    return turn;
  }

  /** Expand to a full multi-plugin investigation (POST /investigate). */
  async function openInvestigation(question) {
    if (!state.context || state.busy) return null;
    const q =
      question ||
      `Investigate ${state.context.label || state.context.objectId}: what is confirmed, what is inferred, and what changed recently?`;
    state.busy = true;
    ui.send.disabled = true;
    ui.stop.hidden = false;
    appendMessage('user', `INVESTIGATE · ${q}`);
    const card = appendMessage(
      'assistant',
      'Running multi-source investigation…',
    );
    card.node.setAttribute('data-streaming', 'true');
    setStatus('INVESTIGATING…');
    abortController =
      typeof AbortController === 'function' ? new AbortController() : null;
    const started = Date.now();
    try {
      const response = await fetchImpl(`${apiBase}${V2_BASE}/investigate`, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          externalUserId,
          objectContext: state.context,
          question: q,
          ...(getPluginIds().length
            ? { pluginIds: getPluginIds().slice(0, 4) }
            : {}),
        }),
        signal: abortController?.signal,
      });
      const report = await readJson(response);
      if (!response.ok)
        throw new Error(
          report?.error
            ? `${report.error} (HTTP ${response.status})`
            : `HTTP ${response.status}`,
        );
      const lines = [];
      if (report.synthesis?.summary) lines.push(report.synthesis.summary);
      for (const c of report.synthesis?.claims || [])
        lines.push(
          `• [${c.status}] ${c.text}${c.sources?.length ? ` ${c.sources.join(' ')}` : ''}`,
        );
      lines.push(
        `Sources: ${report.sources.map((s) => `${s.contract} ${s.status}${s.ms ? ` ${s.ms} ms` : ''}`).join(' · ')}`,
      );
      lines.push(
        `Objects ${report.counts.objects} (confirmed ${report.counts.confirmed}, inferred ${report.counts.inferred}, unverified ${report.counts.unverified}) · entities ${report.entities.length} · relationships ${report.relationships.length}`,
      );
      if (report.synthesisError)
        lines.push(`Synthesis unavailable: ${report.synthesisError}`);
      renderAnswer(card.node, lines.join('\n'), document);
      for (const o of report.objects || [])
        for (const c of o.citations || [])
          if (!state.citations.some((x) => x.url === c.url))
            state.citations.push(c);
      renderSources();
      for (const s of report.sources || [])
        pushActivity(
          `${s.contract}: ${s.status}${s.error ? ` (${s.error})` : ''}`,
        );
      setStatus('READY');
      state.lastInvestigation = report;
      const sourcesEmpty = !report.sources || report.sources.length === 0;
      if (sourcesEmpty) {
        showEmptyState('no-results', 'No results from the selected sources');
      }
      renderDevDetails();
      return report;
    } catch (error) {
      const aborted = error?.name === 'AbortError';
      renderAnswer(
        card.node,
        aborted
          ? 'Investigation cancelled.'
          : `Investigation failed: ${error?.message || error}`,
        document,
      );
      card.node.classList.add('od-chat__msg--error');
      setStatus(aborted ? 'CANCELLED' : 'INVESTIGATION FAILED');
      renderDevDetails();
      return null;
    } finally {
      card.node.removeAttribute('data-streaming');
      abortController = null;
      state.busy = false;
      ui.send.disabled = false;
      ui.stop.hidden = true;
    }
  }

  function close() {
    if (!ui.panel) return;
    state.open = false;
    ui.panel.hidden = true;
    ui.panel.setAttribute('data-open', 'false');
    abortController?.abort();
  }

  function destroy() {
    destroyed = true;
    close();
    ui.panel?.parentNode?.removeChild?.(ui.panel);
  }

  return {
    open,
    close,
    ask,
    openInvestigation,
    destroy,
    getState: () => ({ ...state, externalUserId, workspace }),
    externalUserId,
    workspace,
  };
}

/** A ready-made ASK ONDEMAND button for any object. */
export function createAskOnDemandButton(
  objectContext,
  {
    document = globalThis.document,
    window: win = globalThis.window,
    label = 'ASK ONDEMAND',
    className = 'ask-ondemand-btn ask-ondemand-btn--inline',
  } = {},
) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.setAttribute(
    'data-ask-object',
    `${objectContext.objectType}:${objectContext.objectId}`,
  );
  button.title = `Ask OnDemand about ${objectContext.label || objectContext.objectId}`;
  button.addEventListener('click', (event) => {
    event.stopPropagation?.();
    win.dispatchEvent(
      new CustomEvent(ASK_OBJECT_EVENT, {
        detail:
          typeof objectContext === 'function' ? objectContext() : objectContext,
      }),
    );
  });
  return button;
}

/** Install the panel and listen for `gev:ask-object`. */
export function installMiniChat({
  document = globalThis.document,
  window: win = globalThis.window,
  fetch: fetchImpl,
  storage,
  signal,
  raf,
  getPluginIds,
} = {}) {
  const controller = createMiniChat({
    document,
    window: win,
    fetch: fetchImpl,
    storage,
    raf,
    getPluginIds,
  });
  const onAsk = (event) => {
    if (event?.detail?.objectType) controller.open(event.detail);
  };
  win?.addEventListener?.(ASK_OBJECT_EVENT, onAsk);
  const teardown = () => {
    win?.removeEventListener?.(ASK_OBJECT_EVENT, onAsk);
    controller.destroy();
  };
  if (signal?.aborted) teardown();
  else signal?.addEventListener?.('abort', teardown, { once: true });
  return controller;
}
