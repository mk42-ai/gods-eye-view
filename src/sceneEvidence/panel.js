/**
 * Scene evidence panel — the footage rail, player, timeline, source-status,
 * filters, profile popup and evidence summary shown when a scene builds.
 *
 * DOM is built over an injected document (unit-testable); map pins are an
 * injected adapter ({set(items, selectedId), focus(item), clear()}) so Cesium
 * stays out of this module. Streams POST /api/ondemand/v2/scene/evidence (SSE).
 */
import { createSceneSseParser } from '../sceneVideos/rail.js';
import { setIconContent, appendIcon } from '../ui/icons/layerIcon.js';
import { createPlatformLogo } from '../ui/icons/platformLogos.js';
import { GEO_PRECISION, GEO_LABEL, parsePostUrl } from './model.js';
import {
  initialState,
  applyEvent,
  visibleItems,
  toggleFilter,
  saveSceneEvidence,
  loadSceneEvidence,
  diffAgainstCache,
  encodeShare,
} from './store.js';

export const PANEL_ID = 'scene-evidence';
export const EVIDENCE_URL = '/api/ondemand/v2/scene/evidence';
export const PLATFORM_NAME = Object.freeze({
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  x: 'X',
});
const GEO_SHORT = {
  exact: 'EXACT',
  place: 'PLACE',
  text: 'TEXT',
  none: 'NONE',
};
const STATE_LABEL = {
  running: 'running…',
  ok: 'ok',
  empty: 'no results',
  error: 'error',
  timeout: 'timed out',
  unavailable: 'unavailable',
  credentials_required: 'credentials required',
  unsupported: 'not configured', quota: 'quota restricted', cancelled: 'cancelled',
};
export const LIMITS_NOTE =
  'Public data only. Profiles show just the fields an official API or oEmbed returned (name, handle, avatar, bio, followers) with a link to the public profile. ' +
  'No private data, no login or rate-limit bypass, no Instagram media download, no identity resolution or cross-platform tracking of individuals. ' +
  'Instagram metadata is not stored in caches (Meta oEmbed terms). TEXT-INFERRED means the place is named in the post text — not a confirmed recording location.';

const STREAM_TIMEOUT_MS = 60_000;

const SMALL_WORDS = new Set(['of', 'and', 'the', 'in', 'at', 'on', 'for', 'de', 'la']);
/**
 * Split a geocoder display name into a short one-line label and the full
 * address. "American University Of Sharjah, Bobyan Street, …" →
 * { short: 'American University of Sharjah', full: '<unchanged>' }.
 */
export function shortPlaceName(name) {
  const full = String(name || '').replace(/\s+/g, ' ').trim();
  if (!full) return { short: '', full: '' };
  const first = full.split(',')[0].trim() || full;
  const short = first
    .split(' ')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w))
    .join(' ');
  return { short, full };
}

/** Compact stat counts shown on the evidence chip and in the drawer header. */
export function evidenceStats(state) {
  const verified = (state.items || []).filter((x) => x.eligible === true).length;
  const candidates = (state.candidates || []).length;
  const timedOut = (state.sources || []).filter((x) => x.state === 'timeout').length;
  const failed = (state.sources || []).filter((x) => ['error', 'unavailable'].includes(x.state)).length;
  return { verified, candidates, timedOut, failed };
}

/** Chip label: 'Evidence · 0 verified · 18 candidates' (never wraps mid-word). */
export function evidenceChipLabel(state) {
  const { verified, candidates } = evidenceStats(state);
  if (state.phase === 'streaming') return `Evidence · searching… · ${verified} verified`;
  if (state.phase === 'error' || state.phase === 'timeout') return `Evidence · ${verified} verified · retry`;
  return `Evidence · ${verified} verified · ${candidates} candidate${candidates === 1 ? '' : 's'}`;
}

function el(doc, tag, { id, className, text, attrs } = {}) {
  const n = doc.createElement(tag);
  if (id) n.id = id;
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  for (const [k, v] of Object.entries(attrs || {}))
    if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  return n;
}

export function formatWhen(item) {
  if (!item.publishedAt) return 'undated';
  const d = new Date(item.publishedAt);
  const s = `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const src =
    item.dateSource === 'id-derived'
      ? ' · from post id'
      : item.dateSource === 'search-reported'
        ? ' · search-reported'
        : '';
  return `${s}${src}`;
}
export function formatAge(h) {
  if (h === null || h === undefined) return '';
  if (h < 1) return `${Math.round(h * 60)} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
/** Timeline x-position (0..100, now at the right), log scale up to 1 year. */
export function timelinePosition(ageHours, maxHours = 8760) {
  if (!Number.isFinite(ageHours)) return null;
  const a = Math.min(Math.max(0, ageHours), maxHours);
  return (
    Math.round((1 - Math.log10(1 + a) / Math.log10(1 + maxHours)) * 1000) / 10
  );
}

export function createSceneEvidencePanel({
  document: doc = globalThis.document,
  window: win = globalThis.window,
  fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = globalThis.window?.localStorage,
  pins = null,
  now = () => Date.now(),
} = {}) {
  let state = initialState();
  let abort = null;
  let timer = null;
  let generation = 0;
  let profileInvoker = null;

  // ------------------------------------------------------------ skeleton
  const root = el(doc, 'aside', {
    id: PANEL_ID,
    className: 'sev',
    attrs: { 'aria-label': 'Scene evidence', 'data-phase': 'idle' },
  });
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-labelledby', `${PANEL_ID}-title`);
  root.dataset.open = 'false';
  // Cycle 22: the evidence panel is ON DEMAND. A build only reveals this chip;
  // the chip opens the panel as a slide-over drawer (bottom sheet on phones).
  const chip = el(doc, 'button', {
    id: `${PANEL_ID}-chip`,
    className: 'sev-chip',
    attrs: {
      type: 'button',
      'aria-controls': PANEL_ID,
      'aria-expanded': 'false',
      'aria-haspopup': 'dialog',
      'aria-label': 'Evidence — open scene evidence',
      title: 'Open scene evidence',
    },
  });
  chip.hidden = true;
  const chipIcon = el(doc, 'span', { className: 'sev-chip__icon', attrs: { 'aria-hidden': 'true' } });
  setIconContent(chipIcon, 'film', {}, doc);
  const chipLabel = el(doc, 'span', { className: 'sev-chip__label', text: 'Evidence' });
  chip.append(chipIcon, chipLabel);
  const head = el(doc, 'div', { className: 'sev__head' });
  const titleWrap = el(doc, 'div', { className: 'sev__titles' });
  const title = el(doc, 'h2', {
    id: `${PANEL_ID}-title`,
    className: 'sev__title',
    text: 'Scene evidence',
  });
  const address = el(doc, 'p', {
    id: `${PANEL_ID}-address`,
    className: 'sev__address',
    text: '',
  });
  titleWrap.append(title, address);
  const timing = el(doc, 'span', {
    id: `${PANEL_ID}-timing`,
    className: 'sev__timing',
    text: '',
  });
  const iconButton = (id, icon, label) => {
    const b = el(doc, 'button', {
      id: `${PANEL_ID}-${id}`,
      className: 'sev__icon-btn',
      attrs: { type: 'button', 'aria-label': label, title: label },
    });
    setIconContent(b, icon, {}, doc);
    return b;
  };
  const rebuildBtn = iconButton('rebuild', 'refresh-cw', 'Rebuild: fetch fresh results and diff against the cache');
  const shareBtn = iconButton('share', 'link', 'Copy a link that reopens this evidence scene');
  const closeBtn = iconButton('close', 'x', 'Close evidence (Esc)');
  const actions = el(doc, 'div', { className: 'sev__actions', attrs: { role: 'toolbar', 'aria-label': 'Evidence actions' } });
  actions.append(rebuildBtn, shareBtn, closeBtn);
  head.append(titleWrap, actions);
  const stats = el(doc, 'div', {
    id: `${PANEL_ID}-stats`,
    className: 'sev__stats',
    attrs: { role: 'group', 'aria-label': 'Evidence counts' },
  });
  const statChip = (key, label) => {
    const n = el(doc, 'span', { className: 'sev__stat', attrs: { 'data-stat': key } });
    const v = el(doc, 'strong', { className: 'sev__stat-value', text: '0' });
    n.append(v, el(doc, 'span', { className: 'sev__stat-label', text: label }));
    stats.appendChild(n);
    return { n, v };
  };
  const statVerified = statChip('verified', 'verified');
  const statCandidates = statChip('candidates', 'candidates');
  const statTimeout = statChip('timeout', 'timed out');
  const meta = el(doc, 'div', { id: `${PANEL_ID}-meta`, className: 'sev__meta' });
  const body = el(doc, 'div', {
    id: `${PANEL_ID}-body`,
    className: 'sev__body',
  });
  const status = el(doc, 'div', {
    id: `${PANEL_ID}-status`,
    className: 'sev__status',
    attrs: { 'aria-live': 'polite', role: 'status' },
  });
  const emptyState = el(doc, 'section', {
    id: 'scene-evidence-empty', className: 'sev__empty', attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const timeScope = el(doc, 'p', { id: 'scene-evidence-window', className: 'sev__scope' });
  const diagnostics = el(doc, 'details', { id: `${PANEL_ID}-diagnostics`, className: 'sev__section sev__diagnostics' });
  const diagnosticsSummary = el(doc, 'summary', { className: 'sev__section-summary', text: 'Diagnostics' });
  const candidatesBox = el(doc, 'details', { id: 'scene-evidence-candidates', className: 'sev__section sev__candidates' });
  const candidatesSummary = el(doc, 'summary', { className: 'sev__section-summary', text: 'Unverified candidates' });
  const candidatesList = el(doc, 'ol', { className: 'sev__list' });
  candidatesBox.append(candidatesSummary, candidatesList);
  const diffLine = el(doc, 'div', {
    id: `${PANEL_ID}-diff`,
    className: 'sev__diff',
  });
  diffLine.hidden = true;
  const sourcesBox = el(doc, 'details', {
    id: `${PANEL_ID}-sources`,
    className: 'sev__section sev__sources',
  });
  const sourcesSummary = el(doc, 'summary', {
    className: 'sev__section-summary sev__sources-summary',
    text: 'Source status',
  });
  const sourcesList = el(doc, 'ul', { className: 'sev__sources-list' });
  sourcesBox.append(sourcesSummary, sourcesList);
  const filters = el(doc, 'div', {
    id: `${PANEL_ID}-filters`,
    className: 'sev__filters',
    attrs: { role: 'group', 'aria-label': 'Filters' },
  });
  const filterButtons = [];
  const addFilter = (kind, value, label) => {
    const b = el(doc, 'button', {
      className: 'sev__chip',
      text: label,
      attrs: {
        type: 'button',
        'data-filter-kind': kind,
        'data-filter-value': value,
        'aria-pressed': 'false',
      },
    });
    b.addEventListener('click', () => {
      state = toggleFilter(state, kind, value);
      render();
    });
    filterButtons.push(b);
    filters.appendChild(b);
  };
  for (const f of ['RECENT', 'HISTORICAL']) addFilter('freshness', f, f);
  for (const g of GEO_PRECISION) addFilter('precisions', g, GEO_SHORT[g]);
  const player = el(doc, 'div', {
    id: `${PANEL_ID}-player`,
    className: 'sev__player',
    attrs: { 'data-embed-loaded': 'false' },
  });
  const playerEmpty = el(doc, 'p', {
    className: 'sev__player-empty',
    text: 'No eligible video selected. Only source-verified recordings are playable.',
  });
  player.appendChild(playerEmpty);
  const nowLine = el(doc, 'div', {
    id: `${PANEL_ID}-now`,
    className: 'sev__now',
  });
  const timeline = el(doc, 'div', {
    id: `${PANEL_ID}-timeline`,
    className: 'sev__timeline',
    attrs: { 'aria-label': 'Evidence timeline (log scale, now at right)' },
  });
  const list = el(doc, 'ol', {
    id: `${PANEL_ID}-list`,
    className: 'sev__list',
  });
  const summaryBox = el(doc, 'details', {
    id: `${PANEL_ID}-summary`,
    className: 'sev__section sev__summary',
    attrs: { 'aria-label': 'Evidence summary' },
  });
  const summaryToggle = el(doc, 'summary', { className: 'sev__section-summary', text: 'Summary & context signals' });
  const summaryText = el(doc, 'p', { className: 'sev__summary-text' });
  const summaryEngine = el(doc, 'span', { className: 'sev__summary-engine' });
  const signalsList = el(doc, 'ul', {
    id: `${PANEL_ID}-signals`,
    className: 'sev__signals',
  });
  summaryBox.append(
    summaryToggle,
    summaryText,
    summaryEngine,
    signalsList,
  );
  const limits = el(doc, 'p', {
    id: `${PANEL_ID}-limits`,
    className: 'sev__limits',
    text: LIMITS_NOTE,
  });
  diagnostics.append(diagnosticsSummary, timeScope, timing, diffLine, limits);
  body.append(
    stats,
    meta,
    status,
    emptyState,
    filters,
    player,
    nowLine,
    timeline,
    list,
    summaryBox,
    sourcesBox,
    candidatesBox,
    diagnostics,
  );
  const popover = el(doc, 'div', {
    id: `${PANEL_ID}-profile`,
    className: 'sev__profile',
    attrs: { role: 'dialog', 'aria-label': 'Public profile' },
  });
  popover.hidden = true;
  root.append(head, body, popover);

  // ------------------------------------------------------------ rendering
  function renderSources() {
    const counts = state.sources.reduce(
      (m, s) => ((m[s.state] = (m[s.state] || 0) + 1), m),
      {},
    );
    const failedCount = (counts.error || 0) + (counts.timeout || 0) + (counts.unavailable || 0);
    sourcesSummary.textContent = [
      `Source status · ${counts.ok || 0} ok`,
      counts.running ? `${counts.running} running` : '',
      counts.credentials_required ? `${counts.credentials_required} need keys` : '',
      failedCount ? `${failedCount} failed` : '',
    ].filter(Boolean).join(' · ');
    sourcesList.replaceChildren(
      ...state.sources.map((s) => {
        const li = el(doc, 'li', {
          className: 'sev__source',
          attrs: { 'data-source-id': s.id, 'data-state': s.state },
        });
        li.append(
          el(doc, 'span', {
            className: 'sev__source-state',
            text: STATE_LABEL[s.state] || s.state,
          }),
          el(doc, 'span', {
            className: 'sev__source-name',
            text: s.name || s.id,
          }),
          el(doc, 'span', {
            className: 'sev__source-meta',
            text:
              s.state === 'credentials_required'
                ? (s.credentials || []).join(' + ')
                : `${s.count || 0}${Number.isFinite(s.ms) ? ` · ${(s.ms / 1000).toFixed(1)} s` : ''}`,
          }),
        );
        if (s.note) { li.title = s.note; li.append(el(doc, 'small', { className: 'sev__source-note', text: s.note })); }
        return li;
      }),
    );
  }

  function badge(text, cls, extra = {}) {
    return el(doc, 'span', {
      className: `sev-badge ${cls}`,
      text,
      attrs: extra,
    });
  }

  function card(item) {
    const li = el(doc, 'li', {
      className: 'sev-card',
      attrs: {
        'data-evidence-id': item.id,
        'data-platform': item.platform,
        'data-freshness': item.freshness,
        'data-geo': item.geo.precision,
        'data-selected': String(item.id === state.selectedId),
        'data-embed-status': item.embedStatus || 'unverified',
        'data-eligible': String(item.eligible === true),
        tabindex: '0',
      },
    });
    const top = el(doc, 'div', { className: 'sev-card__top' });
    top.append(
      badge(item.freshness, `sev-badge--${item.freshness.toLowerCase()}`, {
        'data-freshness-badge': item.freshness,
        title:
          item.ageHours !== null
            ? formatAge(item.ageHours)
            : 'undated → ARCHIVAL',
      }),
      badge(
        `${item.geo.precision === 'exact' ? '' : '~'}${GEO_LABEL[item.geo.precision]}`,
        `sev-badge--geo-${item.geo.precision}`,
        { 'data-geo-badge': item.geo.precision, title: item.geo.basis },
      ),
      (() => {
        const platSpan = el(doc, 'span', { className: 'sev-card__plat' });
        const logo = createPlatformLogo(item.platform, { size: 14 }, doc);
        if (logo) {
          platSpan.append(logo);
          if (typeof doc.createTextNode === 'function') platSpan.append(doc.createTextNode(' '));
        }
        if (typeof doc.createTextNode === 'function') {
          platSpan.append(doc.createTextNode(PLATFORM_NAME[item.platform] || item.platform));
        } else {
          platSpan.textContent = PLATFORM_NAME[item.platform] || item.platform;
        }
        return platSpan;
      })(),
      el(doc, 'span', {
        className: 'sev-card__rank',
        text: `#${item.rank || ''}`,
      }),
    );
    const t = el(doc, 'div', {
      className: 'sev-card__title',
      text: item.title,
    });
    const meta = el(doc, 'div', {
      className: 'sev-card__meta',
      text: `Recorded: ${item.recordedAt || 'unknown'} (${item.recordingTimePrecision || 'unknown'}; ${item.recordingTimeSource || 'no source field'}) · Published: ${formatWhen(item)} · Retrieved: ${item.retrievedAt || item.source?.at || 'unknown'} · AOI distance: ${item.distanceKm === null || item.distanceKm === undefined ? 'unknown' : item.distanceKm.toFixed(3) + ' km (' + item.distanceMethod + ')'}`,
    });
    const attribution = el(doc, 'div', {
      className: 'sev-card__src',
      text: `${PLATFORM_NAME[item.platform]} · found via ${item.source?.name || item.source?.id}${item.alsoFrom?.length ? ` (+${item.alsoFrom.length})` : ''}`,
      attrs: {
        title: `${item.source?.via || ''} · "${item.source?.query || ''}" · ${item.source?.at || ''}`,
      },
    });
    const actions = el(doc, 'div', { className: 'sev-card__actions' });
    const play = el(doc, 'button', {
      className: 'sev__btn sev-card__play',
      attrs: { type: 'button' },
    });
    setIconContent(play, item.kind === 'video' ? 'play' : 'eye', { text: item.kind === 'video' ? 'Play' : 'View' }, doc);
    play.addEventListener('click', (e) => {
      e?.stopPropagation?.();
      select(item.id);
    });
    const who =
      item.author?.name ||
      (item.author?.handle ? `@${item.author.handle}` : 'profile');
    const prof = el(doc, 'button', {
      className: 'sev__btn sev-card__profile',
      text: who.slice(0, 28),
      attrs: {
        type: 'button',
        'aria-haspopup': 'dialog',
        title: 'Public profile fields',
      },
    });
    prof.addEventListener('click', (e) => {
      e?.stopPropagation?.();
      profileInvoker = prof;
      openProfile(item);
    });
    const orig = el(doc, 'a', {
      className: 'sev-card__orig',
      text: 'Original post',
      attrs: { href: item.url, target: '_blank', rel: 'noopener noreferrer' },
    });
    appendIcon(orig, 'external-link', { size: 12 }, doc);
    if (item.eligible === true && item.embedUrl) actions.append(play);
    if (item.author?.fields?.length) actions.append(prof);
    actions.append(orig);
    if (item.eligible !== true) li.append(el(doc, 'p', { className: 'sev-card__rejection', text: (item.qualification?.labels || ['Unverified source metadata']).join('; ') }));
    li.append(top, t, meta, attribution, actions);
    if (item.eligible === true) li.addEventListener('click', () => select(item.id));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && item.eligible === true) select(item.id);
    });
    return li;
  }

  function renderTimeline(items) {
    const ticks = [];
    for (const [label, h] of [
      ['now', 0],
      ['1h', 1],
      ['72h', 72],
      ['30d', 720],
      ['1y', 8760],
    ]) {
      const m = el(doc, 'span', { className: 'sev__tl-mark', text: label });
      m.style.left = `${timelinePosition(h)}%`;
      ticks.push(m);
    }
    let undated = 0;
    for (const it of items) {
      const x = timelinePosition(it.ageHours);
      if (x === null) {
        undated += 1;
        continue;
      }
      const b = el(doc, 'button', {
        className: 'sev__tl-tick',
        attrs: {
          type: 'button',
          'data-evidence-id': it.id,
          'data-freshness': it.freshness,
          'data-selected': String(it.id === state.selectedId),
          title: `${it.freshness} · ${formatWhen(it)} · ${it.title.slice(0, 60)}`,
          'aria-label': `${it.freshness} ${it.title.slice(0, 40)}`,
        },
      });
      b.style.left = `${x}%`;
      b.addEventListener('click', () => select(it.id));
      ticks.push(b);
    }
    if (undated)
      ticks.push(
        el(doc, 'span', {
          className: 'sev__tl-undated',
          text: `${undated} undated`,
        }),
      );
    timeline.replaceChildren(...ticks);
  }

  function renderSummary() {
    const s = state.summary;
    summaryText.textContent =
      s?.text || (state.phase === 'streaming' ? 'Waiting for sources…' : '');
    summaryEngine.textContent = s
      ? `summary: ${s.engine}${s.ms ? ` · ${(s.ms / 1000).toFixed(1)} s` : ''}${s.fallback ? ` (fallback: ${s.fallback})` : ''}`
      : '';
    signalsList.replaceChildren(
      ...state.signals.slice(0, 12).map((sig) => {
        const li = el(doc, 'li', {
          className: 'sev__signal',
          attrs: {
            'data-signal-id': sig.id,
            'data-freshness': sig.freshness,
            'data-kind': sig.kind,
          },
        });
        li.append(
          badge(sig.freshness, `sev-badge--${sig.freshness.toLowerCase()}`),
          el(doc, 'a', {
            className: 'sev__signal-title',
            text: sig.title,
            attrs: {
              href: sig.url,
              target: '_blank',
              rel: 'noopener noreferrer',
            },
          }),
          el(doc, 'span', {
            className: 'sev__signal-meta',
            text: `${sig.kind === 'official' ? 'Official · ' : ''}${sig.outlet || sig.source?.name || ''} · ${sig.publishedAt ? `${sig.publishedAt.slice(0, 16).replace('T', ' ')} UTC` : 'undated'} · ${sig.source?.name || ''} · ${sig.geo?.precision === 'text' ? 'names the place' : 'area context'}`,
          }),
        );
        return li;
      }),
    );
  }

  function metaLine(st) {
    const w = st.window;
    const radius = `${st.request?.radiusKm || 5} km`;
    if (w?.startUtc && w?.endUtc) {
      const fmt = (v) => String(v).slice(5, 16).replace('T', ' ');
      return `${fmt(w.startUtc)} → ${fmt(w.endUtc)} UTC · ${radius} · ${w.mode || 'recent'}`;
    }
    const h = st.request?.windowHours || 1;
    return `Last ${h >= 24 && h % 24 === 0 ? `${h / 24} d` : `${h} h`} · ${radius} · UTC`;
  }

  function phaseText() {
    const n = state.items.length;
    const vis = visibleItems(state).length;
    const shown = vis === n ? `${n}` : `${vis}/${n}`;
    switch (state.phase) {
      case 'streaming':
        return `Searching sources… ${shown} verified so far.`;
      case 'done':
        return '';
      case 'cached':
        return `Reopened from cache (${state.cachedAt ? state.cachedAt.slice(0, 16).replace('T', ' ') : ''} UTC) — no provider calls. ${shown} item(s). Rebuild to refresh and diff.`;
      case 'timeout':
        return `Timed out: ${state.error}. Partial results kept — press Rebuild to retry.`;
      case 'error':
        return `Evidence request failed: ${state.error}. Press Rebuild to retry.`;
      default:
        return '';
    }
  }

  function render() {
    root.dataset.phase = state.phase;
    root.dataset.items = String(state.items.length);
    root.dataset.candidates = String(state.candidates.length);
    root.dataset.requestId = state.requestId || '';
    root.dataset.verifiedVideos = String(state.items.filter((x) => x.eligible === true).length);
    root.dataset.signals = String(state.signals.length);
    root.dataset.key = state.key || '';
    const names = shortPlaceName(state.place);
    title.textContent = names.short || 'Scene evidence';
    title.setAttribute('title', names.full || 'Scene evidence');
    address.textContent = names.full && names.full !== names.short ? names.full : '';
    address.setAttribute('title', names.full || '');
    address.hidden = !address.textContent;
    const counts = evidenceStats(state);
    statVerified.v.textContent = String(counts.verified);
    statCandidates.v.textContent = String(counts.candidates);
    statTimeout.v.textContent = String(counts.timedOut);
    statTimeout.n.hidden = counts.timedOut === 0;
    statVerified.n.dataset.zero = String(counts.verified === 0);
    chipLabel.textContent = evidenceChipLabel(state);
    chip.dataset.phase = state.phase;
    chip.setAttribute('aria-label', `${evidenceChipLabel(state)} — open scene evidence`);
    root.dataset.verified = String(counts.verified);
    const c = state.client;
    timing.textContent = [
      c.firstCardMs !== null
        ? `1st card ${(c.firstCardMs / 1000).toFixed(1)} s`
        : '',
      c.doneMs !== null ? `full ${(c.doneMs / 1000).toFixed(1)} s` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    status.textContent = phaseText();
    status.hidden = !status.textContent;
    status.dataset.phase = state.phase;
    for (const b of filterButtons)
      b.setAttribute(
        'aria-pressed',
        String(
          (state.filters[b.dataset.filterKind] || []).includes(
            b.dataset.filterValue,
          ),
        ),
      );
    timeScope.textContent = state.window ? `Recording time: ${state.window.startUtc} → ${state.window.endUtc} · ${state.request.radiusKm || 5} km · ${state.window.mode}. No automatic widening.` : `Recording window: ${state.request.windowHours || 1} hour(s), ending at server execution time (UTC).`;
    meta.textContent = metaLine(state);
    meta.setAttribute('title', timeScope.textContent);
    emptyState.hidden = state.items.length > 0;
    emptyState.textContent = state.phase === 'streaming'
      ? 'Waiting for source-verified recordings…'
      : 'No verified footage in this window. Candidates below are unverified and not playable.';
    player.hidden = state.items.length === 0;
    timeline.hidden = state.items.length === 0;
    filters.hidden = state.items.length === 0;
    candidatesSummary.textContent = `Unverified candidates (${state.candidates.length})`;
    candidatesBox.hidden = state.candidates.length === 0;
    summaryToggle.textContent = `Summary & context signals${state.signals.length ? ` (${state.signals.length})` : ''}`;
    candidatesList.replaceChildren(...state.candidates.map(card));
    renderSources();
    const items = visibleItems(state);
    list.replaceChildren(...items.map(card));
    renderTimeline(items);
    renderSummary();
    pins?.set?.(items, state.selectedId);
  }

  // ------------------------------------------------------------ player + selection
  function loadEmbed(item) {
    player.dataset.embedLoaded = 'false';
    player.dataset.evidenceId = item.id;
    player.dataset.platform = item.platform;
    delete player.dataset.currentTime;
    const expectedEmbed = parsePostUrl(item.url)?.embedUrl;
    if (item.eligible !== true || !expectedEmbed || expectedEmbed !== item.embedUrl) {
      player.replaceChildren(
        el(doc, 'p', {
          className: 'sev__player-empty',
          text: 'No official embed for this post — open the original.',
        }),
      );
      return;
    }
    const frame = el(doc, 'iframe', {
      className: 'sev__iframe',
      attrs: {
        src: item.embedUrl,
        title: `${PLATFORM_NAME[item.platform]} embed: ${item.title.slice(0, 60)}`,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        referrerpolicy: 'strict-origin-when-cross-origin',
        loading: 'lazy',
        sandbox: 'allow-scripts allow-same-origin allow-presentation',
        'data-evidence-id': item.id,
        'data-platform': item.platform,
      },
    });
    frame.addEventListener('load', () => {
      player.dataset.embedLoaded = 'true';
      if (item.platform === 'tiktok') {
        // TikTok Embed Player host→player API (developers.tiktok.com/doc/embed-player).
        for (const delay of [400, 1500, 3000]) {
          setTimeout(() => {
            for (const type of ['mute', 'play']) {
              try {
                frame.contentWindow?.postMessage(
                  { 'x-tiktok-player': true, type, value: null },
                  'https://www.tiktok.com',
                );
              } catch {
                /* cross-origin restrictions */
              }
            }
          }, delay);
        }
      }
      if (item.platform === 'youtube') {
        // YouTube IFrame API handshake (enablejsapi=1): ask for infoDelivery events.
        // Nested cross-origin frames (chat canvas → app → YouTube) often lose
        // autoplay delegation, so explicitly mute + play via the IFrame API.
        const post = (msg) => {
          try {
            frame.contentWindow?.postMessage(
              JSON.stringify(msg),
              'https://www.youtube-nocookie.com',
            );
          } catch {
            /* cross-origin restrictions */
          }
        };
        post({ event: 'listening', id: 1, channel: 'widget' });
        for (const delay of [300, 1200, 2500]) {
          setTimeout(() => {
            post({ event: 'command', func: 'mute', args: [] });
            post({ event: 'command', func: 'playVideo', args: [] });
          }, delay);
        }
      }
    });
    player.replaceChildren(frame);
  }

  function select(id, { focusMap = true } = {}) {
    const item = state.items.find((x) => x.id === id);
    if (!item || item.eligible !== true) return;
    state = { ...state, selectedId: id };
    root.dataset.selected = id;
    nowLine.textContent = `${item.freshness} · ${GEO_LABEL[item.geo.precision]} · ${PLATFORM_NAME[item.platform]} · ${formatWhen(item)}`;
    loadEmbed(item);
    render();
    // Keep the player in view (lazy iframes only load when visible).
    try {
      player.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    } catch {
      /* non-DOM test double */
    }
    if (focusMap) pins?.focus?.(item);
  }

  function openProfile(item) {
    const a = item.author || {};
    popover.replaceChildren();
    popover.dataset.evidenceId = item.id;
    const head2 = el(doc, 'div', { className: 'sev__profile-head' });
    if (a.avatar)
      head2.appendChild(
        el(doc, 'img', {
          className: 'sev__profile-avatar',
          attrs: {
            src: a.avatar,
            alt: '',
            width: '40',
            height: '40',
            loading: 'lazy',
            referrerpolicy: 'no-referrer',
          },
        }),
      );
    head2.append(
      el(doc, 'div', {
        className: 'sev__profile-name',
        text: a.name || (a.handle ? `@${a.handle}` : 'Unknown author'),
      }),
    );
    popover.appendChild(head2);
    if (a.handle)
      popover.appendChild(
        el(doc, 'div', {
          className: 'sev__profile-handle',
          text: `@${a.handle}`,
        }),
      );
    if (a.bio)
      popover.appendChild(
        el(doc, 'p', { className: 'sev__profile-bio', text: a.bio }),
      );
    if (Number.isFinite(a.followers))
      popover.appendChild(
        el(doc, 'div', {
          className: 'sev__profile-followers',
          text: `${a.followers.toLocaleString?.('en') || a.followers} followers`,
        }),
      );
    if (a.url)
      popover.appendChild(
        el(doc, 'a', {
          className: 'sev__profile-link',
          text: 'Open public profile',
          attrs: { href: a.url, target: '_blank', rel: 'noopener noreferrer' },
        }),
      );
    popover.appendChild(
      el(doc, 'p', {
        className: 'sev__profile-note',
        text: `Fields shown: ${(a.fields || []).join(', ') || 'none returned'} — from ${a.source || PLATFORM_NAME[item.platform] + ' post URL'}. Only public fields an official API/oEmbed returns are displayed; nothing is scraped or cross-linked.`,
      }),
    );
    const close = el(doc, 'button', {
      className: 'sev__btn sev__profile-close',
      attrs: { type: 'button', 'aria-label': 'Close profile', title: 'Close profile' },
    });
    setIconContent(close, 'x', { text: 'Close' }, doc);
    close.addEventListener('click', () => {
      popover.hidden = true;
      profileInvoker?.focus?.();
    });
    popover.appendChild(close);
    popover.hidden = false;
    close.focus?.();
  }

  // ------------------------------------------------------------ data flow
  function dispatch(event, data) {
    state = applyEvent(state, event, data, now());
    if (event === 'done') {
      const d = state.request?.fresh ? diffAgainstCache(storage, state) : null;
      if (d) {
        state = { ...state, diff: d };
        diffLine.hidden = false;
        diffLine.textContent = `Rebuilt vs cache of ${d.cachedAt.slice(0, 16).replace('T', ' ')} UTC: +${d.added.length} new · −${d.removed.length} gone · ${d.changed.length} changed · ${d.unchanged} unchanged`;
        diffLine.dataset.added = String(d.added.length);
      }
      saveSceneEvidence(storage, state, now());
    }
    if (event === 'done' || event === 'cached' || event === 'error')
      clearTimeout(timer);
    render();
    // An arriving card is not playback. Only an explicit operator Play loads it.
  }

  async function stream(request, run) {
    const controller = new AbortController();
    abort = controller;
    const current = () => run === generation && abort === controller && !controller.signal.aborted;
    const dispatchCurrent = (event, data) => {
      if (!current() || (data?.requestId && data.requestId !== request.requestId)) return;
      dispatch(event, data);
    };
    const localTimer = setTimeout(() => {
      if (!current()) return;
      dispatchCurrent('timeout', { error: 'Evidence deadline exceeded; no fresh result asserted' });
      controller.abort();
    }, STREAM_TIMEOUT_MS);
    timer = localTimer;
    let reader;
    try {
      const res = await fetchImpl(EVIDENCE_URL, {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ ...request, fresh: '1' }), signal: controller.signal,
      });
      if (!current()) return;
      if (!res.ok || !res.body) {
        dispatchCurrent('error', { error: `HTTP ${res.status}: evidence retrieval unavailable` }); return;
      }
      const parser = createSceneSseParser(), dec = new TextDecoder();
      reader = res.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (!current()) return;
        if (done) break;
        for (const ev of parser.push(dec.decode(value, { stream: true }))) dispatchCurrent(ev.event, ev.data);
      }
      for (const ev of parser.flush()) dispatchCurrent(ev.event, ev.data);
      if (current() && state.phase === 'streaming') dispatchCurrent('error', { error: 'Stream ended without a completed result' });
    } catch (err) {
      if (current()) dispatchCurrent('error', { error: 'Evidence connection failed; retry this AOI' });
    } finally {
      clearTimeout(localTimer);
      try { reader?.releaseLock?.(); } catch { /* already closed */ }
      if (abort === controller) abort = null;
    }
  }

  function open(request, { preferCache = false, reveal = false } = {}) {
    const keepOpen = reveal || isOpen();
    generation += 1;
    clearTimeout(timer); abort?.abort();
    const run = generation;
    const scoped = { ...request, windowHours: request.windowHours || 1, requestId: `sev-${now().toString(36)}-${generation}`, fresh: true };
    state = initialState(scoped);
    state.client.startedAt = now();
    chip.hidden = false;
    if (!keepOpen) setOpen(false);
    diffLine.hidden = true; popover.hidden = true;
    player.replaceChildren(playerEmpty); player.dataset.embedLoaded = 'false'; nowLine.textContent = '';
    const cached = loadSceneEvidence(storage, state.key, new Date(now()));
    if (cached) {
      state.snapshotAt = cached.cachedAt;
      diffLine.hidden = false;
      diffLine.textContent = `Previous retrieval ${cached.cachedAt} · revalidating now; cached leads are not fresh footage.`;
    }
    void preferCache; // Saving a camera scene does not save freshness of external evidence.
    state.phase = 'streaming'; render();
    if (reveal) setOpen(true);
    return stream(scoped, run).then(() => state);
  }

  // ------------------------------------------------------------ drawer state
  let lastFocus = null;
  function isOpen() {
    return root.dataset.open === 'true' && !root.hidden;
  }
  function setOpen(next, { focus = true } = {}) {
    const openNow = Boolean(next) && !chip.hidden;
    root.hidden = !openNow;
    root.dataset.open = String(openNow);
    chip.setAttribute('aria-expanded', String(openNow));
    chip.dataset.open = String(openNow);
    doc.body?.classList?.toggle?.('sev-open', openNow);
    if (openNow) {
      lastFocus = doc.activeElement || chip;
      if (focus) closeBtn.focus?.({ preventScroll: true });
    } else if (focus && lastFocus) {
      if (root.contains?.(doc.activeElement)) chip.focus?.({ preventScroll: true });
      lastFocus = null;
    }
    return openNow;
  }
  function toggle() {
    return setOpen(!isOpen());
  }
  chip.addEventListener('click', (e) => {
    e?.stopPropagation?.();
    toggle();
  });

  rebuildBtn.addEventListener('click', () => {
    if (!state.request) return;
    void open({ ...state.request, fresh: true });
  });
  shareBtn.addEventListener('click', async () => {
    const href = `${win?.location?.origin || ''}${win?.location?.pathname || '/'}?evidence=${encodeShare(state.request)}`;
    shareBtn.dataset.href = href;
    try {
      await win?.navigator?.clipboard?.writeText?.(href);
      setIconContent(shareBtn, 'check', {}, doc);
      shareBtn.title = 'Link copied';
    } catch {
      setIconContent(shareBtn, 'link', {}, doc);
      shareBtn.title = 'Link ready — copy it from the address';
    }
    root.dataset.shareHref = href;
    setTimeout(() => {
      setIconContent(shareBtn, 'link', {}, doc);
      shareBtn.title = 'Copy a link that reopens this evidence scene';
    }, 2500);
  });
  // X / Esc / click outside only HIDE the drawer: results stay behind the chip.
  closeBtn.addEventListener('click', () => setOpen(false));

  /** Tear down the evidence scene (new AOI, cancel, external refusal). */
  function close() {
    generation += 1;
    abort?.abort();
    clearTimeout(timer);
    setOpen(false, { focus: false });
    chip.hidden = true;
    player.replaceChildren(playerEmpty);
    pins?.clear?.();
  }

  // YouTube IFrame API infoDelivery → currentTime (playback proof for QA + UI).
  const onMessage = (event) => {
    const origin = String(event.origin || '');
    const currentFrame = player.querySelector?.('iframe');
    if (!currentFrame || event.source !== currentFrame.contentWindow) return;
    if (origin === 'https://www.tiktok.com') {
      const m = event.data;
      if (
        m &&
        m['x-tiktok-player'] &&
        m.type === 'onCurrentTime' &&
        Number.isFinite(m.value?.currentTime)
      )
        player.dataset.currentTime = String(m.value.currentTime);
      if (m && m['x-tiktok-player'] && m.type === 'onStateChange')
        player.dataset.playerState = String(m.value);
      return;
    }
    if (!['https://www.youtube-nocookie.com', 'https://www.youtube.com'].includes(origin)) return;
    let d = event.data;
    try {
      d = typeof d === 'string' ? JSON.parse(d) : d;
    } catch {
      return;
    }
    const t = d?.info?.currentTime;
    if (Number.isFinite(t)) player.dataset.currentTime = String(t);
    if (Number.isFinite(d?.info?.playerState))
      player.dataset.playerState = String(d.info.playerState);
  };
  win?.addEventListener?.('message', onMessage);
  const onEscape = (event) => {
    if (event.key !== 'Escape') return;
    if (!popover.hidden) { popover.hidden = true; profileInvoker?.focus?.(); event.stopPropagation?.(); return; }
    if (isOpen()) { setOpen(false); event.stopPropagation?.(); }
  };
  root.addEventListener('keydown', onEscape);
  const onDocKey = (event) => {
    if (event.key === 'Escape' && isOpen() && popover.hidden && !event.defaultPrevented) setOpen(false);
  };
  const onDocPointer = (event) => {
    if (!isOpen()) return;
    const t = event.target;
    if (!t || root.contains?.(t) || chip.contains?.(t)) return;
    // Clicks on the globe / other chrome close the drawer; the walkthrough overlay is ignored.
    if (t.closest?.('.driver-popover, .driver-overlay')) return;
    setOpen(false, { focus: false });
  };
  doc.addEventListener?.('keydown', onDocKey);
  doc.addEventListener?.('pointerdown', onDocPointer, true);

  return {
    element: root,
    chip,
    open,
    close,
    show: () => setOpen(true),
    hide: () => setOpen(false),
    toggle,
    isOpen,
    select,
    openProfile,
    dispatch,
    get state() {
      return state;
    },
    destroy() {
      close();
      win?.removeEventListener?.('message', onMessage);
      doc.removeEventListener?.('keydown', onDocKey);
      doc.removeEventListener?.('pointerdown', onDocPointer, true);
      root.remove?.();
      chip.remove?.();
    },
  };
}
