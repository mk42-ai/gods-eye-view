/**
 * Scene evidence panel — the footage rail, player, timeline, source-status,
 * filters, profile popup and evidence summary shown when a scene builds.
 *
 * DOM is built over an injected document (unit-testable); map pins are an
 * injected adapter ({set(items, selectedId), focus(item), clear()}) so Cesium
 * stays out of this module. Streams POST /api/ondemand/v2/scene/evidence (SSE).
 */
import { createSceneSseParser } from '../sceneVideos/rail.js';
import { FRESHNESS, GEO_PRECISION, GEO_LABEL } from './model.js';
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
};
export const LIMITS_NOTE =
  'Public data only. Profiles show just the fields an official API or oEmbed returned (name, handle, avatar, bio, followers) with a link to the public profile. ' +
  'No private data, no login or rate-limit bypass, no Instagram media download, no identity resolution or cross-platform tracking of individuals. ' +
  'Instagram metadata is not stored in caches (Meta oEmbed terms). TEXT-INFERRED means the place is named in the post text — not a confirmed recording location.';

const CACHE_REUSE_MS = 10 * 60_000;
const STREAM_TIMEOUT_MS = 60_000;

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

  // ------------------------------------------------------------ skeleton
  const root = el(doc, 'aside', {
    id: PANEL_ID,
    className: 'sev',
    attrs: { 'aria-label': 'Scene evidence', 'data-phase': 'idle' },
  });
  root.hidden = true;
  const head = el(doc, 'div', { className: 'sev__head' });
  const title = el(doc, 'span', {
    id: `${PANEL_ID}-title`,
    className: 'sev__title',
    text: 'SCENE EVIDENCE',
  });
  const timing = el(doc, 'span', {
    id: `${PANEL_ID}-timing`,
    className: 'sev__timing',
    text: '',
  });
  const rebuildBtn = el(doc, 'button', {
    id: `${PANEL_ID}-rebuild`,
    className: 'sev__btn',
    text: 'REBUILD',
    attrs: {
      type: 'button',
      title: 'Fetch fresh results and diff against the cached scene',
    },
  });
  const shareBtn = el(doc, 'button', {
    id: `${PANEL_ID}-share`,
    className: 'sev__btn',
    text: 'SHARE',
    attrs: {
      type: 'button',
      title: 'Copy a link that reopens this evidence scene',
    },
  });
  const hideBtn = el(doc, 'button', {
    id: `${PANEL_ID}-hide`,
    className: 'sev__btn',
    text: 'HIDE',
    attrs: { type: 'button', 'aria-expanded': 'true' },
  });
  const closeBtn = el(doc, 'button', {
    id: `${PANEL_ID}-close`,
    className: 'sev__btn',
    text: '×',
    attrs: { type: 'button', 'aria-label': 'Close scene evidence' },
  });
  head.append(title, timing, rebuildBtn, shareBtn, hideBtn, closeBtn);
  const body = el(doc, 'div', {
    id: `${PANEL_ID}-body`,
    className: 'sev__body',
  });
  const status = el(doc, 'div', {
    id: `${PANEL_ID}-status`,
    className: 'sev__status',
    attrs: { 'aria-live': 'polite', role: 'status' },
  });
  const diffLine = el(doc, 'div', {
    id: `${PANEL_ID}-diff`,
    className: 'sev__diff',
  });
  diffLine.hidden = true;
  const sourcesBox = el(doc, 'details', {
    id: `${PANEL_ID}-sources`,
    className: 'sev__sources',
  });
  const sourcesSummary = el(doc, 'summary', {
    className: 'sev__sources-summary',
    text: 'SOURCE STATUS',
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
  for (const f of FRESHNESS) addFilter('freshness', f, f);
  for (const g of GEO_PRECISION) addFilter('precisions', g, GEO_SHORT[g]);
  const player = el(doc, 'div', {
    id: `${PANEL_ID}-player`,
    className: 'sev__player',
    attrs: { 'data-embed-loaded': 'false' },
  });
  const playerEmpty = el(doc, 'p', {
    className: 'sev__player-empty',
    text: 'Select a card to load its official embed.',
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
  const summaryBox = el(doc, 'section', {
    id: `${PANEL_ID}-summary`,
    className: 'sev__summary',
    attrs: { 'aria-label': 'Evidence summary' },
  });
  const summaryText = el(doc, 'p', { className: 'sev__summary-text' });
  const summaryEngine = el(doc, 'span', { className: 'sev__summary-engine' });
  const signalsList = el(doc, 'ul', {
    id: `${PANEL_ID}-signals`,
    className: 'sev__signals',
  });
  summaryBox.append(
    el(doc, 'h3', {
      className: 'sev__h',
      text: 'EVIDENCE SUMMARY · PUBLIC INCIDENT & CONTEXT SIGNALS',
    }),
    summaryText,
    summaryEngine,
    signalsList,
  );
  const limits = el(doc, 'p', {
    id: `${PANEL_ID}-limits`,
    className: 'sev__limits',
    text: LIMITS_NOTE,
  });
  body.append(
    status,
    diffLine,
    sourcesBox,
    filters,
    player,
    nowLine,
    timeline,
    list,
    summaryBox,
    limits,
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
    sourcesSummary.textContent = `SOURCE STATUS · ${counts.ok || 0} ok · ${counts.running || 0} running · ${counts.credentials_required || 0} credentials required · ${(counts.error || 0) + (counts.timeout || 0) + (counts.unavailable || 0)} failed`;
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
        if (s.note && s.state !== 'ok') li.title = s.note;
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
        'data-embed-status': item.embedStatus || 'pending',
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
        `${item.geo.precision === 'exact' ? '' : '~'}${GEO_LABEL[item.geo.precision]} ${Math.round(item.geo.confidence * 100)}%`,
        `sev-badge--geo-${item.geo.precision}`,
        { 'data-geo-badge': item.geo.precision, title: item.geo.basis },
      ),
      el(doc, 'span', {
        className: 'sev-card__plat',
        text: PLATFORM_NAME[item.platform] || item.platform,
      }),
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
      text: `${formatWhen(item)}${item.ageHours !== null ? ` · ${formatAge(item.ageHours)}` : ''}`,
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
      text: item.kind === 'video' ? 'PLAY' : 'VIEW',
      attrs: { type: 'button' },
    });
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
      openProfile(item);
    });
    const orig = el(doc, 'a', {
      className: 'sev-card__orig',
      text: 'ORIGINAL POST',
      attrs: { href: item.url, target: '_blank', rel: 'noopener noreferrer' },
    });
    actions.append(play, prof, orig);
    li.append(top, t, meta, attribution, actions);
    li.addEventListener('click', () => select(item.id));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') select(item.id);
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
            text: `${sig.kind === 'official' ? 'OFFICIAL · ' : ''}${sig.outlet || sig.source?.name || ''} · ${sig.publishedAt ? `${sig.publishedAt.slice(0, 16).replace('T', ' ')} UTC` : 'undated'} · ${sig.source?.name || ''} · ${sig.geo?.precision === 'text' ? 'names the place' : 'area context'}`,
          }),
        );
        return li;
      }),
    );
  }

  function phaseText() {
    const n = state.items.length;
    const vis = visibleItems(state).length;
    const shown = vis === n ? `${n}` : `${vis}/${n}`;
    switch (state.phase) {
      case 'streaming':
        return `Streaming ${state.place || 'AOI'} — ${shown} item(s), ${state.signals.length} signal(s) so far…`;
      case 'done':
        return `${shown} item(s) · ${state.signals.length} signal(s) for ${state.place}. Ranked by geo precision, then freshness.`;
      case 'cached':
        return `Reopened from cache (${state.cachedAt ? state.cachedAt.slice(0, 16).replace('T', ' ') : ''} UTC) — no provider calls. ${shown} item(s). REBUILD to refresh and diff.`;
      case 'timeout':
        return `Timed out: ${state.error}. Partial results kept — press REBUILD to retry.`;
      case 'error':
        return `Evidence request failed: ${state.error}. Press REBUILD to retry.`;
      default:
        return '';
    }
  }

  function render() {
    root.dataset.phase = state.phase;
    root.dataset.items = String(state.items.length);
    root.dataset.signals = String(state.signals.length);
    root.dataset.key = state.key || '';
    title.textContent = `SCENE EVIDENCE${state.place ? ` · ${state.place}` : ''}`;
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
    if (!item.embedUrl) {
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
    if (!item) return;
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
      text: 'CLOSE',
      attrs: { type: 'button' },
    });
    close.addEventListener('click', () => {
      popover.hidden = true;
    });
    popover.appendChild(close);
    popover.hidden = false;
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
    if (event === 'item' && !state.selectedId)
      select(data.id, { focusMap: false });
  }

  async function stream(request) {
    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    timer = setTimeout(() => {
      controller.abort();
      if (!['done', 'cached'].includes(state.phase))
        dispatch('timeout', {
          error: `no complete result within ${STREAM_TIMEOUT_MS / 1000} s`,
        });
    }, STREAM_TIMEOUT_MS);
    try {
      const res = await fetchImpl(EVIDENCE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify({
          text: request.text,
          place: request.place,
          lat: request.lat,
          lon: request.lon,
          radiusKm: request.radiusKm,
          windowHours: request.windowHours,
          sceneId: request.sceneId,
          fresh: request.fresh ? '1' : undefined,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        let detail = '';
        try {
          detail = (await res.text()).slice(0, 160);
        } catch {
          /* none */
        }
        dispatch('error', {
          error: `HTTP ${res.status}${detail ? ` ${detail}` : ''}`,
        });
        return;
      }
      const parser = createSceneSseParser();
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const ev of parser.push(dec.decode(value, { stream: true })))
          dispatch(ev.event, ev.data);
      }
      for (const ev of parser.flush()) dispatch(ev.event, ev.data);
      if (state.phase === 'streaming')
        dispatch('error', { error: 'stream ended before completion' });
    } catch (err) {
      if (controller.signal.aborted) return;
      dispatch('error', { error: String(err?.message || err).slice(0, 160) });
    } finally {
      if (abort === controller) abort = null;
    }
  }

  /**
   * Open the panel for a scene request.
   *  opts.preferCache — saved-scene reopen: use the local cache with NO network.
   *  request.fresh    — bypass both caches (REBUILD).
   */
  function open(request, { preferCache = false } = {}) {
    clearTimeout(timer);
    abort?.abort();
    state = initialState(request);
    state.client.startedAt = now();
    root.hidden = false;
    root.dataset.collapsed = 'false';
    diffLine.hidden = true;
    popover.hidden = true;
    player.replaceChildren(playerEmpty);
    player.dataset.embedLoaded = 'false';
    nowLine.textContent = '';
    if (!request.fresh) {
      const cached = loadSceneEvidence(storage, state.key, new Date(now()));
      if (
        cached &&
        (preferCache || now() - Date.parse(cached.cachedAt) < CACHE_REUSE_MS)
      ) {
        dispatch('cached', { ...cached, key: state.key });
        return Promise.resolve(state);
      }
    }
    state.phase = 'streaming';
    render();
    return stream(request).then(() => state);
  }

  rebuildBtn.addEventListener('click', () => {
    if (!state.request) return;
    void open({ ...state.request, fresh: true });
  });
  shareBtn.addEventListener('click', async () => {
    const href = `${win?.location?.origin || ''}${win?.location?.pathname || '/'}?evidence=${encodeShare(state.request)}`;
    shareBtn.dataset.href = href;
    try {
      await win?.navigator?.clipboard?.writeText?.(href);
      shareBtn.textContent = 'COPIED';
    } catch {
      shareBtn.textContent = 'LINK READY';
    }
    root.dataset.shareHref = href;
    setTimeout(() => {
      shareBtn.textContent = 'SHARE';
    }, 2500);
  });
  hideBtn.addEventListener('click', () => {
    const collapsed = root.dataset.collapsed !== 'true';
    root.dataset.collapsed = String(collapsed);
    hideBtn.textContent = collapsed ? 'SHOW' : 'HIDE';
    hideBtn.setAttribute('aria-expanded', String(!collapsed));
  });
  closeBtn.addEventListener('click', () => close());

  function close() {
    abort?.abort();
    clearTimeout(timer);
    root.hidden = true;
    player.replaceChildren(playerEmpty);
    pins?.clear?.();
  }

  // YouTube IFrame API infoDelivery → currentTime (playback proof for QA + UI).
  const onMessage = (event) => {
    const origin = String(event.origin || '');
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
    if (!/youtube(-nocookie)?\.com$/.test(origin.replace(/^https?:\/\//, '')))
      return;
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

  return {
    element: root,
    open,
    close,
    select,
    openProfile,
    dispatch,
    get state() {
      return state;
    },
    destroy() {
      close();
      win?.removeEventListener?.('message', onMessage);
      root.remove?.();
    },
  };
}
