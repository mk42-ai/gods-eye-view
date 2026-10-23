/**
 * LIVE FOOTAGE dock — tactical-HUD panel that streams clips from the footage
 * service (/footage/stream) for the current scene and auto-plays them.
 *
 *  • auto-triggers on scene build / camera (lat,lon,alt) / keyword / hash
 *    change, debounced 800 ms, aborting the previous stream
 *  • progressive playlist: items are appended as each source answers; the
 *    first playable clip starts immediately
 *  • players: YouTube Shorts via iframe embed (IFrame API `onStateChange`
 *    ENDED → next), TikTok via /embed/v2 with a timed advance, Instagram /
 *    direct MP4 via <video muted autoplay playsinline> (`ended` → next),
 *    Instagram login-walled posts via the /embed/ iframe with a timed advance
 *  • PiP: Document Picture-in-Picture when available, else a draggable
 *    mini-player anchored beside the globe
 *  • per-clip SOURCE + freshness badge (LIVE / RECENT / ARCHIVE) with the
 *    absolute ISO timestamp, keyword chips, a command box for natural
 *    language rebuilds ("rebuild the car crash reported in Umm Suqeim")
 *  • persistent archive banner when results are predominantly ARCHIVE or
 *    mode=rebuild; posters for loading / archive / empty states
 *  • URL state fv/fk/fm/fs + `ui=` f.c token (src/footage/model.js)
 *
 * Pure DOM over an injected document/window + fetch; the Cesium viewer is
 * only touched through `flyTo` / `readCamera` callbacks so node:test can
 * drive the whole state machine headless (see dock.test.mjs).
 */
import {
  FOOTAGE_UI_TOKEN,
  parseCommand,
  findPlace,
  freshnessOf,
  formatUtc,
  archiveBannerFor,
  playerKindFor,
  youtubeIdOf,
  appendToPlaylist,
  playableItems,
  decodeFootageParams,
  encodeFootageParams,
  fixturesFor,
  debounce,
} from '../model.js';
import { createFootageClient } from '../client.js';

export const FOOTAGE_DOCK_ID = 'footage-dock';
export const FOOTAGE_COMMAND_ID = 'footage-command';
export const FOOTAGE_PLAYER_ID = 'footage-player';
export const FOOTAGE_BANNER_ID = 'footage-archive-banner';
export const FOOTAGE_EVENTS = Object.freeze({
  stateChanged: 'gev:footage-state',
  playing: 'gev:footage-playing',
});
export const POSTERS = Object.freeze({
  acquiring: '/assets/footage/poster-acquiring.png',
  archive: '/assets/footage/poster-archive.png',
  empty: '/assets/footage/poster-empty.png',
});
const DEBOUNCE_MS = 800;
const EXACT = 'exact';
const FOOTAGE_WORD = 'footage';
const TIKTOK_ADVANCE_MS = 20_000;
const IG_EMBED_ADVANCE_MS = 18_000;
const LINK_ADVANCE_MS = 6_000;
const MAX_ITEMS = 40;
const SOURCE_LABELS = {
  youtube: 'YOUTUBE',
  tiktok: 'TIKTOK',
  instagram: 'INSTAGRAM',
  reddit: 'REDDIT',
  x: 'X',
  web: 'WEB',
  facebook: 'FACEBOOK',
  'instagram+web': 'INSTAGRAM',
  'instagram-plugin': 'INSTAGRAM',
};

function el(doc, tag, { id, className, text, attrs, html } = {}) {
  const node = doc.createElement(tag);
  if (id) node.id = id;
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (html !== undefined) node.innerHTML = html;
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  return node;
}

/** Load the YouTube IFrame API once; resolves with window.YT (or null when blocked). */
function loadYouTubeApi(doc, win) {
  if (win.YT?.Player) return Promise.resolve(win.YT);
  if (win.__gevYtApiPromise) return win.__gevYtApiPromise;
  win.__gevYtApiPromise = new Promise((resolve) => {
    const prev = win.onYouTubeIframeAPIReady;
    win.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(win.YT || null);
    };
    const s = doc.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => resolve(null);
    (doc.head || doc.body).appendChild(s);
    win.setTimeout(() => resolve(win.YT || null), 8000);
  });
  return win.__gevYtApiPromise;
}

export function installFootageDock({
  document: doc = globalThis.document,
  window: win = globalThis.window,
  fetch: fetchImpl,
  signal,
  readCamera, // () => ({lat, lon, alt}) | null
  flyTo, // (lat, lon, {altitude, duration}) => void
  readHud, // () => ({ variant, visible, incidentType }) | null
  readShareLinks, // () => ShareLinkManager | null
  host, // element to append the dock into (defaults to body)
  autoStart = true,
  client: injectedClient,
  setTimeoutImpl = (fn, ms) => win.setTimeout(fn, ms),
  clearTimeoutImpl = (h) => win.clearTimeout(h),
  now = () => Date.now(),
} = {}) {
  if (!doc) return null;
  const client = injectedClient || createFootageClient({ fetch: fetchImpl });
  const initial = decodeFootageParams(
    (win.location && win.location.hash) || '',
  );

  const state = {
    visible: initial.visible === null ? true : initial.visible,
    collapsed: initial.collapsed === true,
    keywords: initial.keywords || '',
    mode: initial.mode || 'live',
    since: initial.since || null,
    place: null, // {name, lat, lon}
    items: [],
    activeChips: new Set(),
    current: -1,
    sources: {}, // source → {status, count, error}
    streaming: false,
    query: null,
    done: null,
    banner: null,
    lastTrigger: null,
    pip: false,
    allFailed: false,
    fixturesUsed: false,
    error: null,
    cameraKey: null,
    cameraMoved: false,
    commandAt: 0,
  };

  // ------------------------------------------------------------------ DOM
  const dock = el(doc, 'section', {
    id: FOOTAGE_DOCK_ID,
    className: 'footage-dock',
    attrs: {
      'aria-label': 'Live footage',
      'data-mode': state.mode,
      'data-state': 'idle',
    },
  });
  const header = el(doc, 'div', { className: 'footage-dock__header' });
  const title = el(doc, 'span', {
    className: 'footage-dock__title',
    text: 'LIVE FOOTAGE',
  });
  const modeBadge = el(doc, 'span', {
    id: `${FOOTAGE_DOCK_ID}-mode`,
    className: 'footage-dock__mode',
    text: 'LIVE',
  });
  const counts = el(doc, 'span', {
    id: `${FOOTAGE_DOCK_ID}-counts`,
    className: 'footage-dock__counts',
    text: 'standing by',
  });
  const pipBtn = el(doc, 'button', {
    id: `${FOOTAGE_DOCK_ID}-pip`,
    className: 'footage-btn',
    text: 'PIP',
    attrs: { type: 'button', title: 'Picture-in-picture mini player' },
  });
  const collapseBtn = el(doc, 'button', {
    id: `${FOOTAGE_DOCK_ID}-collapse`,
    className: 'footage-btn',
    text: '−',
    attrs: {
      type: 'button',
      'aria-label': 'Collapse live footage',
      'aria-expanded': 'true',
    },
  });
  const closeBtn = el(doc, 'button', {
    id: `${FOOTAGE_DOCK_ID}-close`,
    className: 'footage-btn',
    text: '×',
    attrs: { type: 'button', 'aria-label': 'Hide live footage' },
  });
  header.append(title, modeBadge, counts, pipBtn, collapseBtn, closeBtn);

  const body = el(doc, 'div', { className: 'footage-dock__body' });
  const banner = el(doc, 'div', {
    id: FOOTAGE_BANNER_ID,
    className: 'footage-banner',
    attrs: { role: 'status', hidden: '' },
  });
  const playerWrap = el(doc, 'div', {
    id: FOOTAGE_PLAYER_ID,
    className: 'footage-player',
    attrs: { 'data-kind': 'poster' },
  });
  const poster = el(doc, 'img', {
    className: 'footage-player__poster',
    attrs: { src: POSTERS.acquiring, alt: 'Acquiring live footage' },
  });
  const posterLabel = el(doc, 'div', {
    className: 'footage-player__poster-label',
    text: 'ACQUIRING…',
  });
  const stage = el(doc, 'div', { className: 'footage-player__stage' });
  playerWrap.append(poster, posterLabel, stage);
  const meta = el(doc, 'div', {
    id: `${FOOTAGE_DOCK_ID}-meta`,
    className: 'footage-meta',
  });
  const metaBadges = el(doc, 'div', { className: 'footage-meta__badges' });
  const metaTitle = el(doc, 'a', {
    className: 'footage-meta__title',
    attrs: { target: '_blank', rel: 'noopener noreferrer' },
  });
  const metaTime = el(doc, 'time', { className: 'footage-meta__time' });
  meta.append(metaBadges, metaTitle, metaTime);
  const controls = el(doc, 'div', { className: 'footage-controls' });
  const prevBtn = el(doc, 'button', {
    className: 'footage-btn',
    text: 'PREV',
    attrs: { type: 'button' },
  });
  const nextBtn = el(doc, 'button', {
    className: 'footage-btn',
    text: 'NEXT',
    attrs: { type: 'button' },
  });
  const refreshBtn = el(doc, 'button', {
    id: `${FOOTAGE_DOCK_ID}-refresh`,
    className: 'footage-btn',
    text: 'REFRESH',
    attrs: { type: 'button' },
  });
  const liveBtn = el(doc, 'button', {
    id: `${FOOTAGE_DOCK_ID}-live`,
    className: 'footage-btn footage-btn--toggle',
    text: 'LIVE',
    attrs: { type: 'button', 'aria-pressed': 'true' },
  });
  const rebuildBtn = el(doc, 'button', {
    id: `${FOOTAGE_DOCK_ID}-rebuild`,
    className: 'footage-btn footage-btn--toggle',
    text: 'REBUILD',
    attrs: { type: 'button', 'aria-pressed': 'false' },
  });
  controls.append(prevBtn, nextBtn, refreshBtn, liveBtn, rebuildBtn);
  const chips = el(doc, 'div', {
    id: `${FOOTAGE_DOCK_ID}-chips`,
    className: 'footage-chips',
    attrs: { 'aria-label': 'Keyword filters' },
  });
  const sourcesRow = el(doc, 'div', {
    id: `${FOOTAGE_DOCK_ID}-sources`,
    className: 'footage-sources',
    attrs: { 'aria-live': 'polite' },
  });
  const list = el(doc, 'ol', {
    id: `${FOOTAGE_DOCK_ID}-list`,
    className: 'footage-list',
  });
  const command = el(doc, 'form', {
    id: FOOTAGE_COMMAND_ID,
    className: 'footage-command',
    attrs: { role: 'search', 'aria-label': 'Footage command' },
  });
  const commandInput = el(doc, 'input', {
    id: `${FOOTAGE_COMMAND_ID}-input`,
    className: 'footage-command__input',
    attrs: {
      type: 'text',
      placeholder: 'rebuild the car crash reported in Umm Suqeim',
      autocomplete: 'off',
      enterkeyhint: 'go',
      maxlength: '240',
      'aria-label': 'Footage command',
    },
  });
  const commandSend = el(doc, 'button', {
    id: `${FOOTAGE_COMMAND_ID}-send`,
    className: 'footage-btn footage-command__send',
    text: 'GO',
    attrs: { type: 'submit' },
  });
  const commandStatus = el(doc, 'div', {
    id: `${FOOTAGE_COMMAND_ID}-status`,
    className: 'footage-command__status',
    attrs: { role: 'status' },
  });
  command.append(commandInput, commandSend, commandStatus);
  body.append(
    banner,
    playerWrap,
    meta,
    controls,
    chips,
    sourcesRow,
    list,
    command,
  );
  dock.append(header, body);
  const reopen = el(doc, 'button', {
    id: `${FOOTAGE_DOCK_ID}-reopen`,
    className: 'footage-reopen',
    text: 'LIVE FOOTAGE',
    attrs: { type: 'button', hidden: '' },
  });
  (host || doc.body || doc.documentElement).append(dock, reopen);

  // ---------------------------------------------------------------- state
  let abort = null;
  let advanceTimer = null;
  let ytPlayer = null;
  let pipWindow = null;
  let pipMini = null;

  const emit = () => {
    dock.dataset.items = String(state.items.length);
    dock.dataset.playing = String(state.current >= 0);
    win.dispatchEvent?.(
      new (win.CustomEvent || CustomEvent)(FOOTAGE_EVENTS.stateChanged, {
        detail: snapshot(),
      }),
    );
  };
  function snapshot() {
    return {
      visible: state.visible,
      collapsed: state.collapsed,
      keywords: state.keywords,
      mode: state.mode,
      since: state.since,
      place: state.place,
      items: state.items.length,
      current: state.current,
      currentItem: state.items[state.current] || null,
      sources: { ...state.sources },
      streaming: state.streaming,
      banner: state.banner,
      allFailed: state.allFailed,
      fixturesUsed: state.fixturesUsed,
      pip: state.pip,
    };
  }

  function shareState() {
    return {
      visible: state.visible,
      keywords: state.keywords,
      mode: state.mode,
      since: state.since,
      collapsed: state.collapsed,
    };
  }
  function syncHash() {
    const share = readShareLinks?.();
    if (share?.onFootageStateChange) {
      share.onFootageStateChange();
      return;
    }
    // Fallback when the share-link manager is not wired: merge into the hash directly.
    try {
      const params = new URLSearchParams(
        String(win.location.hash || '').replace(/^#/, ''),
      );
      encodeFootageParams(params, shareState());
      win.history.replaceState(null, '', `#${params.toString()}`);
    } catch {
      /* non-browser host */
    }
  }

  function setVisible(visible) {
    state.visible = visible;
    dock.hidden = !visible;
    reopen.hidden = visible;
    if (!visible) stopPlayback();
    syncHash();
    emit();
  }
  function setCollapsed(collapsed) {
    state.collapsed = collapsed;
    dock.classList.toggle('collapsed', collapsed);
    collapseBtn.textContent = collapsed ? '+' : '−';
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    body.hidden = collapsed;
    syncHash();
    emit();
  }
  function setMode(mode, { refresh = true } = {}) {
    state.mode = mode === 'rebuild' ? 'rebuild' : 'live';
    dock.dataset.mode = state.mode;
    modeBadge.textContent = state.mode.toUpperCase();
    liveBtn.setAttribute('aria-pressed', String(state.mode === 'live'));
    rebuildBtn.setAttribute('aria-pressed', String(state.mode === 'rebuild'));
    syncHash();
    if (refresh) trigger('mode');
  }

  // --------------------------------------------------------------- render
  function setPoster(kind, label) {
    playerWrap.dataset.kind = 'poster';
    poster.src = POSTERS[kind] || POSTERS.empty;
    poster.alt = label;
    posterLabel.textContent = label;
    poster.hidden = false;
    posterLabel.hidden = false;
    stage.replaceChildren();
  }
  function renderBanner() {
    const b = state.banner;
    if (!b) {
      banner.hidden = true;
      banner.textContent = '';
      dock.dataset.archive = '0';
      return;
    }
    banner.hidden = false;
    banner.textContent =
      b.text + (state.query?.place?.name ? ` · ${state.query.place.name}` : '');
    dock.dataset.archive = '1';
  }
  function badge(doc2, text, cls, titleText) {
    const s = el(doc2, 'span', { className: `footage-badge ${cls}`, text });
    if (titleText) s.title = titleText;
    return s;
  }
  function renderMeta(item) {
    metaBadges.replaceChildren();
    if (!item) {
      metaTitle.textContent = '';
      metaTitle.removeAttribute('href');
      metaTime.textContent = '';
      return;
    }
    const fresh = item.freshness || freshnessOf(item.published_at, now());
    metaBadges.append(
      badge(
        doc,
        SOURCE_LABELS[item.source] ||
          String(item.source || 'WEB').toUpperCase(),
        'footage-badge--source',
        item.author ? `@${item.author}` : undefined,
      ),
      badge(
        doc,
        fresh,
        `footage-badge--${fresh.toLowerCase()}`,
        formatUtc(item.published_at),
      ),
    );
    if (item.fixture)
      metaBadges.append(
        badge(
          doc,
          'CLIENT FIXTURE',
          'footage-badge--fixture',
          'Backend sources all failed — curated fallback',
        ),
      );
    if (item.seeded)
      metaBadges.append(
        badge(
          doc,
          'VERIFIED SEED',
          'footage-badge--seed',
          'Curated incident post, live-resolved',
        ),
      );
    metaTitle.textContent = item.title || item.url;
    metaTitle.href = item.url;
    const precision = item.published_precision;
    const approx = precision && precision !== EXACT ? ` (~${precision})` : '';
    const timeLabel = item.published_at
      ? `${formatUtc(item.published_at)}${approx}`
      : 'published: unknown';
    metaTime.textContent = timeLabel;
    metaTime.setAttribute('datetime', item.published_at || '');
  }
  function renderList() {
    list.replaceChildren();
    state.items.forEach((item, idx) => {
      const li = el(doc, 'li', { className: 'footage-list__item' });
      li.dataset.index = String(idx);
      li.dataset.source = item.source;
      const fresh = item.freshness || freshnessOf(item.published_at, now());
      li.dataset.freshness = fresh;
      if (idx === state.current) li.classList.add('is-active');
      const btn = el(doc, 'button', {
        className: 'footage-list__play',
        attrs: { type: 'button', title: item.url },
      });
      if (item.thumb) {
        const img = el(doc, 'img', {
          className: 'footage-list__thumb',
          attrs: {
            src: item.thumb,
            alt: '',
            loading: 'lazy',
            referrerpolicy: 'no-referrer',
          },
        });
        btn.appendChild(img);
      }
      const col = el(doc, 'span', { className: 'footage-list__col' });
      const badges = el(doc, 'span', { className: 'footage-list__badges' });
      badges.append(
        badge(
          doc,
          SOURCE_LABELS[item.source] ||
            String(item.source || 'WEB').toUpperCase(),
          'footage-badge--source',
        ),
        badge(doc, fresh, `footage-badge--${fresh.toLowerCase()}`),
      );
      if (item.fixture)
        badges.append(badge(doc, 'FIXTURE', 'footage-badge--fixture'));
      const t = el(doc, 'span', {
        className: 'footage-list__title',
        text: item.title || item.url,
      });
      const ts = el(doc, 'time', {
        className: 'footage-list__time',
        text: formatUtc(item.published_at),
      });
      ts.setAttribute('datetime', item.published_at || '');
      col.append(badges, t, ts);
      btn.append(col);
      btn.addEventListener('click', () => play(idx));
      li.appendChild(btn);
      list.appendChild(li);
    });
    counts.textContent = state.streaming
      ? `${state.items.length} clip${state.items.length === 1 ? '' : 's'} · streaming…`
      : state.items.length
        ? `${state.items.length} clip${state.items.length === 1 ? '' : 's'}${state.query?.place?.name ? ` · ${state.query.place.name}` : ''}`
        : state.allFailed
          ? 'all sources failed'
          : 'no footage';
  }
  function renderSources() {
    sourcesRow.replaceChildren();
    for (const [name, st] of Object.entries(state.sources)) {
      if (name.includes('+') || name.endsWith('-plugin')) continue;
      const s = el(doc, 'span', {
        className: `footage-source footage-source--${st.status || 'pending'}`,
        text: `${SOURCE_LABELS[name] || name.toUpperCase()} ${st.status === 'pending' ? '…' : st.status === 'ok' ? `OK ${st.count ?? 0}` : st.status === 'quota' ? 'QUOTA' : st.status === 'unavailable' ? 'N/A' : '!'}`,
      });
      s.dataset.source = name;
      s.dataset.status = st.status || 'pending';
      s.title = st.error
        ? `${name}: ${st.error}`
        : `${name}: ${st.status}${st.ms ? ` · ${st.ms} ms` : ''}`;
      sourcesRow.appendChild(s);
    }
  }
  function renderChips() {
    chips.replaceChildren();
    const words = new Set();
    for (const w of String(state.keywords || '')
      .toLowerCase()
      .split(/\s+/))
      if (w.length > 2) words.add(w);
    for (const v of state.query?.query_variants || [])
      for (const w of v.toLowerCase().split(/\s+/))
        if (w.length > 3 && words.size < 10) words.add(w);
    if (state.query?.place?.name)
      words.add(state.query.place.name.toLowerCase());
    for (const w of words) {
      const chip = el(doc, 'button', {
        className: 'footage-chip',
        text: w,
        attrs: {
          type: 'button',
          'aria-pressed': String(state.activeChips.has(w)),
        },
      });
      chip.dataset.keyword = w;
      chip.addEventListener('click', () => {
        if (state.activeChips.has(w)) state.activeChips.delete(w);
        else state.activeChips.add(w);
        chip.setAttribute('aria-pressed', String(state.activeChips.has(w)));
        applyChipFilter();
      });
      chips.appendChild(chip);
    }
  }
  function applyChipFilter() {
    if (!state.activeChips.size) {
      for (const li of list.querySelectorAll('.footage-list__item'))
        li.hidden = false;
      return;
    }
    state.items.forEach((item, idx) => {
      const text =
        `${item.title || ''} ${item.author || ''} ${item.url}`.toLowerCase();
      const li = list.querySelector(`[data-index="${idx}"]`);
      if (li) li.hidden = ![...state.activeChips].some((w) => text.includes(w));
    });
  }
  function renderAll() {
    renderBanner();
    renderList();
    renderSources();
    renderChips();
    applyChipFilter();
    emit();
  }

  // ------------------------------------------------------------- playback
  function clearAdvance() {
    if (advanceTimer) clearTimeoutImpl(advanceTimer);
    advanceTimer = null;
  }
  function scheduleAdvance(ms) {
    clearAdvance();
    advanceTimer = setTimeoutImpl(() => next(), ms);
  }
  function stopPlayback() {
    clearAdvance();
    try {
      ytPlayer?.destroy?.();
    } catch {
      /* ignore */
    }
    ytPlayer = null;
    stage.replaceChildren();
    state.current = -1;
  }
  function mountTarget() {
    return state.pip && pipWindow?.document
      ? pipWindow.document.getElementById('footage-pip-stage') || stage
      : state.pip && pipMini
        ? pipMini.querySelector('.footage-pip__stage')
        : stage;
  }
  async function play(index) {
    const item = state.items[index];
    if (!item) return;
    clearAdvance();
    try {
      ytPlayer?.destroy?.();
    } catch {
      /* ignore */
    }
    ytPlayer = null;
    state.current = index;
    const kind = playerKindFor(item);
    playerWrap.dataset.kind = kind;
    poster.hidden = true;
    posterLabel.hidden = true;
    const target = mountTarget();
    target.replaceChildren();
    const d = target.ownerDocument || doc;
    if (kind === 'youtube') {
      const id = youtubeIdOf(item);
      const holder = el(d, 'div', {
        className: 'footage-yt',
        attrs: { id: `footage-yt-${Date.now().toString(36)}` },
      });
      target.appendChild(holder);
      const YT = await loadYouTubeApi(
        d,
        target.ownerDocument?.defaultView || win,
      );
      if (state.current !== index) return;
      if (YT?.Player) {
        ytPlayer = new YT.Player(holder, {
          videoId: id,
          host: 'https://www.youtube.com',
          playerVars: {
            autoplay: 1,
            mute: 1,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            controls: 1,
            enablejsapi: 1,
            origin: win.location?.origin,
          },
          events: {
            onReady: (e) => {
              try {
                e.target.mute();
                e.target.playVideo();
              } catch {
                /* ignore */
              }
            },
            onStateChange: (e) => {
              if (e.data === 0) next();
            },
            onError: () => scheduleAdvance(1500),
          },
        });
        // Shorts rarely exceed 60 s; a safety advance covers an embed that never reports ENDED.
        scheduleAdvance(Math.max(20_000, ((item.duration_s || 60) + 8) * 1000));
      } else {
        const iframe = el(d, 'iframe', {
          className: 'footage-iframe',
          attrs: {
            src:
              item.embed_url ||
              `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1&enablejsapi=1&rel=0`,
            allow: 'autoplay; encrypted-media; picture-in-picture',
            allowfullscreen: '',
            referrerpolicy: 'strict-origin-when-cross-origin',
            title: item.title || 'YouTube Shorts',
          },
        });
        holder.replaceWith(iframe);
        scheduleAdvance(Math.max(20_000, ((item.duration_s || 60) + 5) * 1000));
      }
    } else if (kind === 'tiktok') {
      const iframe = el(d, 'iframe', {
        className: 'footage-iframe',
        attrs: {
          src: item.embed_url,
          allow: 'autoplay; encrypted-media; picture-in-picture',
          allowfullscreen: '',
          referrerpolicy: 'strict-origin-when-cross-origin',
          title: item.title || 'TikTok',
        },
      });
      target.appendChild(iframe);
      scheduleAdvance(TIKTOK_ADVANCE_MS);
    } else if (kind === 'video') {
      const video = el(d, 'video', {
        className: 'footage-video',
        attrs: {
          src: item.play_url,
          muted: '',
          autoplay: '',
          playsinline: '',
          controls: '',
          preload: 'auto',
          crossorigin: 'anonymous',
        },
      });
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      if (item.thumb) video.poster = item.thumb;
      video.addEventListener('ended', () => next());
      video.addEventListener('error', () => {
        // CDN URL expired or CORS-blocked → fall back to the Instagram embed when we have one, else skip.
        if (
          item.embed_url &&
          /instagram\.com/.test(item.embed_url) &&
          !video.dataset.fallback
        ) {
          video.dataset.fallback = '1';
          const iframe = el(d, 'iframe', {
            className: 'footage-iframe',
            attrs: {
              src: item.embed_url,
              allow: 'autoplay; encrypted-media',
              allowfullscreen: '',
              title: item.title || 'Instagram',
            },
          });
          video.replaceWith(iframe);
          scheduleAdvance(IG_EMBED_ADVANCE_MS);
        } else scheduleAdvance(1200);
      });
      target.appendChild(video);
      try {
        const p = video.play?.();
        if (p?.catch) p.catch(() => {});
      } catch {
        /* autoplay policy */
      }
      scheduleAdvance(Math.max(30_000, ((item.duration_s || 60) + 10) * 1000));
    } else if (kind === 'instagram') {
      const iframe = el(d, 'iframe', {
        className: 'footage-iframe',
        attrs: {
          src: item.embed_url || `${item.url.replace(/\/?$/, '/')}embed/`,
          allow: 'autoplay; encrypted-media',
          allowfullscreen: '',
          title: item.title || 'Instagram',
        },
      });
      target.appendChild(iframe);
      scheduleAdvance(IG_EMBED_ADVANCE_MS);
    } else {
      const card = el(d, 'a', {
        className: 'footage-linkcard',
        text: `${SOURCE_LABELS[item.source] || 'LINK'} · ${item.title || item.url}`,
        attrs: { href: item.url, target: '_blank', rel: 'noopener noreferrer' },
      });
      target.appendChild(card);
      scheduleAdvance(LINK_ADVANCE_MS);
    }
    renderMeta(item);
    for (const li of list.querySelectorAll('.footage-list__item'))
      li.classList.toggle('is-active', li.dataset.index === String(index));
    dock.dataset.playing = 'true';
    win.dispatchEvent?.(
      new (win.CustomEvent || CustomEvent)(FOOTAGE_EVENTS.playing, {
        detail: { index, item },
      }),
    );
  }
  function next() {
    const n = state.items.length;
    if (!n) return;
    const playable = playableItems(state.items);
    for (let step = 1; step <= n; step++) {
      const idx = (state.current + step) % n;
      if (playable.includes(state.items[idx]) || state.items[idx]) {
        void play(idx);
        return;
      }
    }
  }
  function prev() {
    const n = state.items.length;
    if (!n) return;
    void play((state.current - 1 + n) % n);
  }

  // ------------------------------------------------------------------ PiP
  async function togglePip() {
    if (state.pip) {
      closePip();
      return;
    }
    const current = state.items[state.current];
    state.pip = true;
    pipBtn.setAttribute('aria-pressed', 'true');
    if (win.documentPictureInPicture?.requestWindow) {
      try {
        pipWindow = await win.documentPictureInPicture.requestWindow({
          width: 360,
          height: 640,
        });
        const pd = pipWindow.document;
        pd.body.style.cssText =
          'margin:0;background:#06100f;color:#e7fff6;font-family:JetBrains Mono,monospace;font-size:11px;display:flex;flex-direction:column;height:100vh';
        pd.body.innerHTML =
          '<div style="padding:6px 8px;letter-spacing:.08em;color:#3bb795">LIVE FOOTAGE · PIP</div><div id="footage-pip-stage" style="flex:1;min-height:0"></div>';
        for (const sheet of doc.querySelectorAll(
          'link[rel="stylesheet"],style',
        ))
          pd.head.appendChild(sheet.cloneNode(true));
        pipWindow.addEventListener(
          'pagehide',
          () => closePip({ fromWindow: true }),
          { once: true },
        );
      } catch {
        pipWindow = null;
      }
    }
    if (!pipWindow) {
      pipMini = el(doc, 'div', {
        className: 'footage-pip',
        attrs: { role: 'dialog', 'aria-label': 'Live footage mini player' },
      });
      const bar = el(doc, 'div', {
        className: 'footage-pip__bar',
        text: 'LIVE FOOTAGE · PIP',
      });
      const close = el(doc, 'button', {
        className: 'footage-btn',
        text: '×',
        attrs: { type: 'button', 'aria-label': 'Close mini player' },
      });
      close.addEventListener('click', () => closePip());
      bar.appendChild(close);
      const st = el(doc, 'div', { className: 'footage-pip__stage' });
      pipMini.append(bar, st);
      (doc.body || doc.documentElement).appendChild(pipMini);
      makeDraggable(pipMini, bar);
    }
    if (current) void play(state.current);
    dock.dataset.pip = '1';
    emit();
  }
  function closePip({ fromWindow = false } = {}) {
    state.pip = false;
    pipBtn.setAttribute('aria-pressed', 'false');
    const idx = state.current;
    if (pipWindow && !fromWindow) {
      try {
        pipWindow.close();
      } catch {
        /* ignore */
      }
    }
    pipWindow = null;
    pipMini?.remove();
    pipMini = null;
    dock.dataset.pip = '0';
    if (idx >= 0) void play(idx);
    emit();
  }
  function makeDraggable(node, handle) {
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    const move = (e) => {
      node.style.left = `${ox + (e.clientX - sx)}px`;
      node.style.top = `${oy + (e.clientY - sy)}px`;
      node.style.right = 'auto';
      node.style.bottom = 'auto';
    };
    const up = () => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointerdown', (e) => {
      if (e.target?.tagName === 'BUTTON') return;
      const r = node.getBoundingClientRect();
      sx = e.clientX;
      sy = e.clientY;
      ox = r.left;
      oy = r.top;
      doc.addEventListener('pointermove', move);
      doc.addEventListener('pointerup', up);
    });
  }

  // ----------------------------------------------------------------- fetch
  function hashCamera() {
    try {
      const p = new URLSearchParams(
        String(win.location?.hash || '').replace(/^#/, ''),
      );
      const lat = Number(p.get('lat'));
      const lon = Number(p.get('lon'));
      const alt = Number(p.get('alt'));
      if (Number.isFinite(lat) && Number.isFinite(lon))
        return { lat, lon, alt: Number.isFinite(alt) ? alt : 5000 };
    } catch {
      /* no hash */
    }
    return null;
  }
  function currentQuery() {
    // The URL hash is the shared scene; the live camera only takes over once
    // it has actually moved away from that scene (startup flights land late).
    const live = readCamera?.() || null;
    const fromHash = hashCamera();
    const cam = fromHash && !state.cameraMoved ? fromHash : live || fromHash;
    const hud = readHud?.() || null;
    const place = state.place;
    let keywords = state.keywords;
    if (!keywords && hud?.incidentType)
      keywords = String(hud.incidentType).replace(/_/g, ' ');
    return {
      lat: place?.lat ?? cam?.lat ?? null,
      lon: place?.lon ?? cam?.lon ?? null,
      radiusKm: cam?.alt
        ? Math.max(1, Math.min(50, Math.round(cam.alt / 25_000)))
        : 5,
      keywords,
      since: state.since,
      mode: state.mode,
      limit: 16,
      place: place?.name || null,
    };
  }

  async function run(reason) {
    abort?.abort();
    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    abort = controller;
    const q = currentQuery();
    if (q.lat === null && !q.keywords && !q.place) return null;
    state.lastTrigger = reason;
    state.streaming = true;
    state.items = [];
    state.sources = {};
    state.banner = null;
    state.allFailed = false;
    state.fixturesUsed = false;
    state.error = null;
    state.query = null;
    state.done = null;
    stopPlayback();
    dock.dataset.state = 'acquiring';
    setPoster(
      'acquiring',
      state.mode === 'rebuild'
        ? 'REBUILDING FROM ARCHIVE…'
        : 'ACQUIRING LIVE FOOTAGE…',
    );
    renderMeta(null);
    renderAll();
    let firstPlayed = false;
    let done = null;
    try {
      done = await client.stream(
        q,
        {
          onQuery: (query) => {
            state.query = query;
            if (!state.place && query?.place)
              state.place = {
                name: query.place.name,
                lat: query.place.lat,
                lon: query.place.lon,
                derived: true,
              };
            renderChips();
          },
          onSourceStart: (s) => {
            if (s?.source) state.sources[s.source] = { status: 'pending' };
            renderSources();
          },
          onItem: (item) => {
            if (state.items.length >= MAX_ITEMS) return;
            const before = state.items.length;
            state.items = appendToPlaylist(state.items, item);
            if (state.items.length === before) return;
            state.banner = archiveBannerFor(state.items, state.mode, {
              reportedAt: state.query?.reported_at || state.done?.reported_at,
            });
            renderAll();
            if (
              !firstPlayed &&
              ['youtube', 'tiktok', 'video', 'instagram'].includes(
                playerKindFor(item),
              )
            ) {
              firstPlayed = true;
              void play(state.items.length - 1);
            }
          },
          onSourceDone: (s) => {
            if (s?.source)
              state.sources[s.source] = {
                status: s.status || 'ok',
                count: s.count,
                error: s.error,
                ms: s.ms,
              };
            renderSources();
          },
          onDone: (payload) => {
            state.done = payload;
          },
          onError: (err) => {
            state.error = err?.message || String(err);
          },
        },
        { signal: controller?.signal },
      );
    } catch (err) {
      if (controller?.signal?.aborted) return null;
      state.error = err?.message || String(err);
    }
    if (controller?.signal?.aborted) return null;
    state.streaming = false;
    const payload = done || state.done;
    state.allFailed =
      Boolean(payload?.all_sources_failed) ||
      (!state.items.length && Boolean(state.error));
    if (!state.items.length && state.allFailed) {
      const fx = fixturesFor(q.keywords, state.place || state.query?.place);
      if (fx.length) {
        state.fixturesUsed = true;
        state.items = fx.map((f) => ({ ...f, canonical: f.url }));
      }
    }
    state.banner = archiveBannerFor(state.items, state.mode, {
      reportedAt: payload?.reported_at || state.query?.reported_at,
    });
    if (!state.items.length) {
      dock.dataset.state = 'empty';
      setPoster(
        'empty',
        state.error
          ? `NO FOOTAGE · ${state.error}`
          : 'NO FOOTAGE FOR THIS SCENE',
      );
    } else {
      dock.dataset.state = state.banner ? 'archive' : 'live';
      if (state.current < 0) {
        if (state.banner) setPoster('archive', 'REBUILT FROM ARCHIVE');
        next();
      }
    }
    renderAll();
    return payload;
  }
  const trigger = debounce((reason) => void run(reason), DEBOUNCE_MS, {
    setTimeoutImpl,
    clearTimeoutImpl,
  });

  // -------------------------------------------------------------- command
  async function runCommand(text) {
    const parsed = parseCommand(text);
    if (!parsed) {
      commandStatus.textContent =
        'Say what to show, e.g. "rebuild the car crash reported in Umm Suqeim".';
      commandStatus.dataset.kind = 'error';
      return null;
    }
    let place = parsed.place;
    if (!place && parsed.placeText) {
      commandStatus.textContent = `Geocoding "${parsed.placeText}"…`;
      commandStatus.dataset.kind = 'info';
      place = await geocodeFallback(parsed.placeText);
    }
    if (!place) {
      commandStatus.textContent = parsed.placeText
        ? `No place found for "${parsed.placeText}" — try a Dubai neighbourhood or a city.`
        : 'Name a place (e.g. "… in Umm Suqeim").';
      commandStatus.dataset.kind = 'error';
      return null;
    }
    state.place = { name: place.name, lat: place.lat, lon: place.lon };
    state.keywords = parsed.incident || state.keywords;
    state.since = parsed.mode === 'rebuild' ? '2y' : null;
    state.commandAt = now();
    // From here on the live camera (which we are flying to the place) is the
    // scene; the shared hash camera is stale.
    state.cameraMoved = true;
    setMode(parsed.mode, { refresh: false });
    const modeLabel = parsed.mode === 'rebuild' ? 'REBUILDING' : 'LIVE';
    const subject = state.keywords || FOOTAGE_WORD;
    commandStatus.textContent = `${modeLabel} · ${subject} · ${place.name} (${place.lat.toFixed(3)}, ${place.lon.toFixed(3)})`;
    commandStatus.dataset.kind = 'ok';
    try {
      flyTo?.(place.lat, place.lon, {
        altitude: 2600,
        heading: 0,
        pitch: -55,
        duration: 2.4,
      });
    } catch {
      /* viewer not ready */
    }
    syncHash();
    trigger.cancel();
    const payload = await run('command');
    return { parsed, place, payload };
  }
  async function geocodeFallback(text) {
    const local = findPlace(text);
    if (local) return local;
    try {
      const res = await (fetchImpl || win.fetch)(
        `/api/tools/geocode_place?q=${encodeURIComponent(text)}`,
        { headers: { Accept: 'application/json' } },
      );
      if (res.ok) {
        const j = await res.json();
        const c = j?.data?.candidates?.[0];
        const lat = Number(c?.geometry?.location?.lat);
        const lon = Number(c?.geometry?.location?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lon))
          return {
            name: String(c.formatted_address || text).slice(0, 80),
            lat,
            lon,
          };
      }
    } catch {
      /* fall through */
    }
    return null;
  }

  // --------------------------------------------------------------- events
  command.addEventListener('submit', (e) => {
    e.preventDefault?.();
    void runCommand(commandInput.value);
  });
  commandInput.addEventListener('keydown', (e) => e.stopPropagation?.());
  prevBtn.addEventListener('click', prev);
  nextBtn.addEventListener('click', next);
  refreshBtn.addEventListener('click', () => {
    trigger.cancel();
    void run('refresh');
  });
  liveBtn.addEventListener('click', () => {
    state.since = null;
    setMode('live');
  });
  rebuildBtn.addEventListener('click', () => {
    state.since = '2y';
    setMode('rebuild');
  });
  pipBtn.addEventListener('click', () => void togglePip());
  collapseBtn.addEventListener('click', () => setCollapsed(!state.collapsed));
  closeBtn.addEventListener('click', () => setVisible(false));
  reopen.addEventListener('click', () => {
    setVisible(true);
    if (!state.items.length) trigger('reopen');
  });

  const onSceneBuilt = (e) => {
    const detail = e?.detail || {};
    // A scene built by the composer's own rebuild command (≤ 20 s ago) is the
    // same scene the command already fetched footage for — do not refetch
    // against a camera that is still mid-flight.
    if (state.commandAt && now() - state.commandAt < 20_000) return;
    state.place = null;
    if (detail.keywords) state.keywords = detail.keywords;
    if (Number.isFinite(detail.lat) && Number.isFinite(detail.lon)) {
      state.place = {
        name:
          detail.place || `${detail.lat.toFixed(3)}, ${detail.lon.toFixed(3)}`,
        lat: detail.lat,
        lon: detail.lon,
        derived: true,
      };
    }
    state.cameraMoved = true;
    trigger('scene');
  };
  const onHash = () => {
    const p = decodeFootageParams(win.location?.hash || '');
    let changed = false;
    if (p.mode && p.mode !== state.mode) {
      state.mode = p.mode;
      changed = true;
    }
    if (p.keywords !== state.keywords) {
      state.keywords = p.keywords;
      changed = true;
    }
    if ((p.since || null) !== state.since) {
      state.since = p.since || null;
      changed = true;
    }
    if (p.visible !== null && p.visible !== state.visible)
      setVisible(p.visible);
    if (p.collapsed !== null && p.collapsed !== state.collapsed)
      setCollapsed(p.collapsed);
    if (changed) {
      setMode(state.mode, { refresh: false });
      trigger('hash');
    }
  };
  let cameraTimer = null;
  let cameraSettled = 0;
  const watchCamera = () => {
    const cam = readCamera?.();
    if (!cam) return;
    const key = `${cam.lat.toFixed(2)}|${cam.lon.toFixed(2)}|${Math.round(cam.alt / 5000)}`;
    if (key === state.cameraKey) {
      cameraSettled += 1;
      return;
    }
    const target = hashCamera();
    const nearHash =
      target &&
      Math.abs(cam.lat - target.lat) < 0.5 &&
      Math.abs(cam.lon - target.lon) < 0.5;
    // Only count a move once the viewer has rested on a position (two ticks)
    // AND it is not the startup flight landing on the shared hash camera.
    if (state.cameraKey && cameraSettled >= 2 && !nearHash) {
      state.cameraMoved = true;
      if (state.place?.derived || !state.place) {
        state.place = null;
        trigger('camera');
      }
    }
    cameraSettled = 0;
    state.cameraKey = key;
  };
  win.addEventListener?.('gev:incident-scene-built', onSceneBuilt);
  win.addEventListener?.('hashchange', onHash);
  if (readCamera) cameraTimer = win.setInterval?.(watchCamera, 1500);

  // ------------------------------------------------------------------ boot
  setMode(state.mode, { refresh: false });
  setCollapsed(state.collapsed);
  dock.hidden = !state.visible;
  reopen.hidden = state.visible;
  renderAll();
  const share = readShareLinks?.();
  share?.setFootageStateProvider?.(() => shareState());
  if (autoStart && state.visible) trigger('boot');

  const api = {
    element: dock,
    state,
    snapshot,
    run: (reason = 'api') => {
      trigger.cancel();
      return run(reason);
    },
    runCommand,
    play,
    next,
    prev,
    setMode,
    setVisible,
    setCollapsed,
    setKeywords(k) {
      state.keywords = String(k || '');
      syncHash();
      trigger('keywords');
    },
    setPlace(p) {
      state.place = p ? { name: p.name, lat: p.lat, lon: p.lon } : null;
      trigger('place');
    },
    togglePip,
    elements: {
      dock,
      banner,
      player: playerWrap,
      stage,
      list,
      command,
      commandInput,
      commandStatus,
      sourcesRow,
      chips,
      metaBadges,
      metaTime,
      metaTitle,
    },
    destroy() {
      abort?.abort();
      trigger.cancel();
      stopPlayback();
      closePip();
      win.removeEventListener?.('gev:incident-scene-built', onSceneBuilt);
      win.removeEventListener?.('hashchange', onHash);
      if (cameraTimer) win.clearInterval?.(cameraTimer);
      share?.setFootageStateProvider?.(null);
      dock.remove?.();
      reopen.remove?.();
      if (win.__gevFootage === api) delete win.__gevFootage;
    },
  };
  win.__gevFootage = api;
  if (signal?.aborted) api.destroy();
  else signal?.addEventListener?.('abort', () => api.destroy(), { once: true });
  return api;
}
