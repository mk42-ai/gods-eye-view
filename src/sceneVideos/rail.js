/**
 * Scene video rail — the side pane (desktop) / top sheet (mobile) that streams
 * VideoEvidence while a scene builds.
 *
 *   • starts automatically when the bottom incident composer is submitted
 *     (and via window.__gevSceneVideos.start(prompt) for voice / tests)
 *   • consumes POST /api/ondemand/v2/scene/videos (SSE) progressively:
 *     "SEARCHING SOURCES" per-platform chips → clips appear as they arrive
 *   • autoplay-muted queue: the first playable clip starts muted, the next
 *     one plays when it ends; mp4 clips go through the same-origin media proxy
 *     and seek to captionStartOffset; YouTube iframes get &start=<offset>
 *   • every clip shows a LIVE / RECENT / ARCHIVAL badge, its recording date,
 *     platform + source link; a persistent banner says when the scene is
 *     REBUILT FROM ARCHIVAL FOOTAGE
 *   • map pins at each clip location (Cesium entities, injected), ASK per clip
 *     opens the OnDemand mini chat with the clip as object context
 *   • graceful fallbacks: proxy 410 (expired CDN URL) → open-source link card;
 *     iframe-only platforms → embed; nothing playable → link out
 *
 * The DOM is built over an injected document so it is unit-testable.
 */
import { ASK_OBJECT_EVENT } from '../ondemand/miniChat.js';
import {
  clipLabel,
  archivalBanner,
  proxiedMediaSrc,
  iframeSrc,
  clipChatContext,
  PLATFORM_LABEL,
  PLATFORM_SHORT,
} from './labels.js';

export const RAIL_ID = 'scene-video-rail';

/**
 * Minimal named-event SSE parser for /scene/videos ({event, data} pairs).
 * (The mini chat's createV2SseParser maps OnDemand chat frames to
 * {type, payload}, which is the wrong shape for these events.)
 */
export function createSceneSseParser() {
  let buffer = '';
  const parse = (block) => {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i === -1 ? line : line.slice(0, i);
      const value = i === -1 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'event') event = value.trim();
      else if (field === 'data') data.push(value);
    }
    if (!data.length) return null;
    let payload = data.join('\n');
    try {
      payload = JSON.parse(payload);
    } catch {
      /* keep raw */
    }
    return { event, data: payload };
  };
  return {
    push(chunk) {
      buffer += String(chunk).replace(/\r\n/g, '\n');
      const out = [];
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const evt = parse(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
        if (evt) out.push(evt);
      }
      return out;
    },
    flush() {
      const rest = buffer;
      buffer = '';
      const evt = rest.trim() ? parse(rest) : null;
      return evt ? [evt] : [];
    },
  };
}
export const SCENE_VIDEOS_URL = '/api/ondemand/v2/scene/videos';
const PLATFORMS = ['youtube', 'tiktok', 'instagram'];

function el(doc, tag, { id, className, text, attrs } = {}) {
  const node = doc.createElement(tag);
  if (id) node.id = id;
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  return node;
}

export function createSceneVideoRail({
  document: doc = globalThis.document,
  window: win = globalThis.window,
  fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
  pins = null, // {set(clips), clear()} — Cesium adapter (optional)
  onClip,
  getHash = () => win?.location?.hash || '',
  externalUserId,
} = {}) {
  const root = el(doc, 'aside', {
    id: RAIL_ID,
    className: 'svr',
    attrs: { 'aria-label': 'Scene video evidence', 'data-state': 'idle' },
  });
  root.hidden = true;
  const head = el(doc, 'div', { className: 'svr__head' });
  const title = el(doc, 'span', {
    className: 'svr__title',
    text: 'SCENE VIDEO EVIDENCE',
  });
  const collapse = el(doc, 'button', {
    className: 'svr__btn svr__collapse',
    text: 'HIDE',
    attrs: {
      type: 'button',
      'aria-expanded': 'true',
      'aria-controls': `${RAIL_ID}-body`,
    },
  });
  const closeBtn = el(doc, 'button', {
    className: 'svr__btn svr__close',
    text: 'CLOSE',
    attrs: { type: 'button', 'aria-label': 'Close scene video evidence' },
  });
  head.append(title, collapse, closeBtn);
  const body = el(doc, 'div', {
    id: `${RAIL_ID}-body`,
    className: 'svr__body',
  });
  const banner = el(doc, 'div', {
    id: `${RAIL_ID}-banner`,
    className: 'svr__banner',
    attrs: { role: 'status' },
  });
  banner.hidden = true;
  const status = el(doc, 'div', {
    id: `${RAIL_ID}-status`,
    className: 'svr__status',
    attrs: { 'aria-live': 'polite' },
  });
  const statusText = el(doc, 'span', {
    className: 'svr__status-text',
    text: '',
  });
  const chips = el(doc, 'span', { className: 'svr__chips' });
  status.append(statusText, chips);
  const player = el(doc, 'div', {
    id: `${RAIL_ID}-player`,
    className: 'svr__player',
  });
  const nowLine = el(doc, 'div', { className: 'svr__now' });
  const list = el(doc, 'ol', { id: `${RAIL_ID}-list`, className: 'svr__list' });
  body.append(banner, status, player, nowLine, list);
  root.append(head, body);

  const state = {
    prompt: '',
    clips: [],
    incident: null,
    sources: {},
    playingId: null,
    played: new Set(),
    abort: null,
    done: false,
    counts: {},
  };

  const chipNodes = new Map();
  function setChip(platform, text, kind) {
    let chip = chipNodes.get(platform);
    if (!chip) {
      chip = el(doc, 'span', {
        className: 'svr__chip',
        attrs: { 'data-platform': platform },
      });
      chipNodes.set(platform, chip);
      chips.appendChild(chip);
    }
    chip.textContent = `${PLATFORM_SHORT[platform] || platform} ${text}`;
    chip.dataset.kind = kind;
  }

  function renderBanner() {
    const b = archivalBanner(state.incident, state.clips);
    if (!b) {
      banner.hidden = true;
      banner.textContent = '';
      return;
    }
    banner.hidden = false;
    banner.textContent = b.text;
    banner.dataset.recorded = b.recorded || '';
  }

  function clipNode(clip) {
    const label = clipLabel(clip);
    const li = el(doc, 'li', {
      className: 'svr__clip',
      attrs: {
        'data-clip-id': clip.id,
        'data-platform': clip.platform,
        'data-tier': label.tier,
        'data-playable': clip.playableKind,
      },
    });
    const top = el(doc, 'div', { className: 'svr__clip-top' });
    const badge = el(doc, 'span', {
      className: `svr-badge ${label.badge.className}`,
      text: label.badge.text,
      attrs: { title: label.badge.title, 'data-tier-badge': label.tier },
    });
    const plat = el(doc, 'span', {
      className: 'svr__plat',
      text: label.platform,
    });
    const score = el(doc, 'span', {
      className: 'svr__score',
      text: `${Math.round((clip.score || 0) * 100)}`,
      attrs: {
        title: `rank score (recency ${clip.scoreParts?.recency}, geo ${clip.scoreParts?.geo}, keyword ${clip.scoreParts?.keyword})`,
      },
    });
    top.append(badge, plat, score);
    const t = el(doc, 'div', {
      className: 'svr__clip-title',
      text: clip.title || clip.caption || clip.sourceUrl,
    });
    const when = el(doc, 'div', {
      className: 'svr__clip-when',
      text: label.dateLine,
    });
    const actions = el(doc, 'div', { className: 'svr__clip-actions' });
    const play = el(doc, 'button', {
      className: 'svr__btn svr__play',
      text: clip.playableKind === 'link' ? 'OPEN' : 'PLAY',
      attrs: { type: 'button' },
    });
    play.addEventListener('click', () => playClip(clip.id, { user: true }));
    const ask = el(doc, 'button', {
      className: 'svr__btn svr__ask',
      text: 'ASK',
      attrs: { type: 'button', title: 'Ask OnDemand about this clip' },
    });
    ask.addEventListener('click', () => askAbout(clip));
    const src = el(doc, 'a', {
      className: 'svr__src',
      text: 'source',
      attrs: {
        href: clip.sourceUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
      },
    });
    const prov = el(doc, 'span', {
      className: 'svr__prov',
      text: `via ${clip.provenance?.pluginId || 'plugin'}`,
      attrs: {
        title: `${clip.provenance?.plugin || ''} · ${clip.provenance?.operation || ''} · "${clip.provenance?.query || ''}" · ${clip.provenance?.timestamp || ''}`,
      },
    });
    actions.append(play, ask, src, prov);
    li.append(top, t, when, actions);
    return li;
  }

  function renderList() {
    const sorted = [...state.clips].sort(
      (a, b) => b.score - a.score || a.id.localeCompare(b.id),
    );
    list.replaceChildren(...sorted.map(clipNode));
    for (const li of list.children)
      if (li.dataset.clipId === state.playingId) li.dataset.playing = 'true';
    root.dataset.clips = String(state.clips.length);
    root.dataset.platforms = PLATFORMS.filter((p) =>
      state.clips.some((c) => c.platform === p),
    ).join(',');
  }

  function fallbackCard(clip, reason) {
    const wrap = el(doc, 'div', { className: 'svr__fallback' });
    wrap.append(
      el(doc, 'p', { text: reason }),
      el(doc, 'a', {
        text: `Open on ${PLATFORM_LABEL[clip.platform] || 'source'}`,
        attrs: {
          href: clip.sourceUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    );
    return wrap;
  }

  function nextPlayable() {
    const sorted = [...state.clips].sort((a, b) => {
      const pa =
        a.playableKind === 'mp4' ? 0 : a.playableKind === 'iframe' ? 1 : 2;
      const pb =
        b.playableKind === 'mp4' ? 0 : b.playableKind === 'iframe' ? 1 : 2;
      return pa - pb || b.score - a.score;
    });
    return (
      sorted.find(
        (c) => !state.played.has(c.id) && c.playableKind !== 'link',
      ) || null
    );
  }

  function playClip(id, { user = false } = {}) {
    const clip = state.clips.find((c) => c.id === id);
    if (!clip) return;
    if (clip.playableKind === 'link') {
      win?.open?.(clip.sourceUrl, '_blank', 'noopener');
      return;
    }
    state.playingId = id;
    state.played.add(id);
    const label = clipLabel(clip);
    nowLine.textContent = `${label.badge.text} · ${label.platform} · ${label.dateLine}`;
    nowLine.dataset.tier = label.tier;
    if (clip.playableKind === 'mp4') {
      const video = el(doc, 'video', {
        className: 'svr__video',
        attrs: {
          playsinline: '',
          muted: '',
          preload: 'auto',
          controls: '',
          'data-clip-id': clip.id,
        },
      });
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      const offset = Number(clip.captionStartOffset) || 0;
      video.addEventListener('loadedmetadata', () => {
        if (offset > 0 && offset < (video.duration || Infinity))
          video.currentTime = offset;
      });
      video.addEventListener('ended', () => {
        const next = nextPlayable();
        if (next) playClip(next.id);
      });
      video.addEventListener('error', () => {
        player.replaceChildren(
          fallbackCard(
            clip,
            'This clip could not be streamed (expired or blocked media URL).',
          ),
        );
        const next = nextPlayable();
        if (next && !user) playClip(next.id);
      });
      video.src = proxiedMediaSrc(clip);
      player.replaceChildren(video);
      const p = video.play?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else {
      const frame = el(doc, 'iframe', {
        className: 'svr__iframe',
        attrs: {
          src: iframeSrc(clip),
          title: clip.title || `${label.platform} clip`,
          allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
          referrerpolicy: 'strict-origin-when-cross-origin',
          loading: 'lazy',
          'data-clip-id': clip.id,
        },
      });
      player.replaceChildren(frame);
    }
    root.dataset.playing = clip.id;
    renderList();
  }

  function askAbout(clip) {
    win?.dispatchEvent?.(
      new (win.CustomEvent || CustomEvent)(ASK_OBJECT_EVENT, {
        detail: clipChatContext(clip, state.incident),
      }),
    );
  }

  function addClip(clip) {
    if (!clip?.id || state.clips.some((c) => c.id === clip.id)) return;
    state.clips.push(clip);
    renderList();
    renderBanner();
    pins?.set?.(state.clips);
    onClip?.(clip);
    // autoplay-muted queue: start as soon as the first mp4 lands; an iframe
    // only starts if nothing mp4 is available once the stream is done.
    if (!state.playingId && clip.playableKind === 'mp4') playClip(clip.id);
  }

  function handle(event, data) {
    if (event === 'plan') {
      root.dataset.anchor = data?.anchor
        ? `${data.anchor.lat},${data.anchor.lon}`
        : '';
    } else if (event === 'incident') {
      state.incident = data;
      renderBanner();
    } else if (event === 'source') {
      state.sources[data.platform] = data;
      if (data.state === 'searching')
        setChip(data.platform, 'searching…', 'busy');
      else if (data.state === 'done')
        setChip(data.platform, `${data.clips}`, data.clips ? 'ok' : 'empty');
      else setChip(data.platform, 'error', 'error');
    } else if (event === 'clip') {
      addClip(data);
    } else if (event === 'done') {
      state.done = true;
      state.counts = data.counts || {};
      root.dataset.state = 'done';
      statusText.textContent = `${data.total} clips · YT ${data.counts?.youtube || 0} · TT ${data.counts?.tiktok || 0} · IG ${data.counts?.instagram || 0}`;
      if (!state.playingId) {
        const next = nextPlayable();
        if (next) playClip(next.id);
        else if (!state.clips.length)
          player.replaceChildren(
            el(doc, 'p', {
              className: 'svr__empty',
              text: 'No video evidence found for this scene.',
            }),
          );
      }
    } else if (event === 'error') {
      root.dataset.state = 'error';
      statusText.textContent = `Source search failed: ${data?.error || 'unknown error'}`;
    }
  }

  async function start(prompt, { anchor } = {}) {
    const text = String(prompt || '').trim();
    if (!text) return null;
    state.abort?.abort();
    state.abort =
      typeof AbortController === 'function' ? new AbortController() : null;
    Object.assign(state, {
      prompt: text,
      clips: [],
      incident: null,
      sources: {},
      playingId: null,
      done: false,
    });
    state.played = new Set();
    root.hidden = false;
    root.dataset.state = 'searching';
    root.dataset.collapsed = 'false';
    statusText.textContent = 'SEARCHING SOURCES';
    chips.replaceChildren();
    chipNodes.clear();
    for (const p of PLATFORMS) setChip(p, 'queued', 'busy');
    player.replaceChildren(
      el(doc, 'div', {
        className: 'svr__searching',
        text: 'Searching YouTube, TikTok and Instagram through OnDemand plugins…',
      }),
    );
    nowLine.textContent = '';
    list.replaceChildren();
    banner.hidden = true;
    pins?.clear?.();
    try {
      const res = await fetchImpl(SCENE_VIDEOS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(externalUserId ? { 'X-Workstation-User': externalUserId } : {}),
        },
        body: JSON.stringify({
          prompt: text,
          hash: getHash(),
          ...(anchor ? { lat: anchor.lat, lon: anchor.lon } : {}),
          ...(externalUserId ? { externalUserId } : {}),
        }),
        signal: state.abort?.signal,
      });
      if (!res.ok || !res.body) {
        handle('error', { error: `HTTP ${res.status}` });
        return state;
      }
      const parser = createSceneSseParser();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const evt of parser.push(decoder.decode(value, { stream: true })))
          handle(evt.event, evt.data);
      }
      for (const evt of parser.flush()) handle(evt.event, evt.data);
      if (!state.done)
        handle('done', { total: state.clips.length, counts: {} });
    } catch (err) {
      if (err?.name !== 'AbortError')
        handle('error', { error: String(err?.message || err) });
    }
    return state;
  }

  collapse.addEventListener('click', () => {
    const collapsed = root.dataset.collapsed !== 'true';
    root.dataset.collapsed = String(collapsed);
    collapse.textContent = collapsed ? 'SHOW' : 'HIDE';
    collapse.setAttribute('aria-expanded', String(!collapsed));
  });
  closeBtn.addEventListener('click', () => {
    state.abort?.abort();
    root.hidden = true;
    pins?.clear?.();
    player.replaceChildren();
  });

  return {
    element: root,
    state,
    start,
    handle,
    playClip,
    destroy() {
      state.abort?.abort();
      pins?.clear?.();
      root.remove?.();
    },
  };
}
