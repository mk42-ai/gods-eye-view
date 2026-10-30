/**
 * Scene footage panel — renders the controller state (src/sceneFootage/controller.js)
 * inside the selected scene: native <video muted playsinline> for the
 * storage-hosted Spotlight MP4, clip selector, scene/match/coverage labels,
 * honest timestamps, attribution + original link, retrieval/last-checked
 * times, refresh control and every non-happy state. Untrusted caption text
 * is only ever assigned through textContent.
 */
import {
  clipTimeLines,
  formatAgo,
  utcStamp,
  REFRESH_CHOICES_MS,
} from './controller.js';
import { setIconContent } from '../ui/icons/layerIcon.js';
import { createPlatformLogo } from '../ui/icons/platformLogos.js';

export const FOOTAGE_PANEL_ID = 'scene-footage';
const LEVEL_LABEL = {
  landmark: 'landmark',
  neighborhood: 'neighborhood',
  district: 'district',
  city: 'city',
};
const EVIDENCE_LABEL = {
  'hashtag-match': 'hashtag text match',
  'place-name-match': 'caption text match',
  'plugin-text-match': 'plugin-reported text match (no caption returned)',
  geotag: 'geotag',
  unknown: 'unknown',
};
const STATE_MESSAGE = {
  empty: 'No relevant Snapchat footage found for this area',
  plugin_error: 'Snapchat plugin error — the footage request failed.',
  credentials_required:
    'Credentials required — the server has no OnDemand key configured for the Snapchat plugin.',
  rate_limited:
    'Rate limited — too many footage requests. Retrying on the next refresh.',
  timeout: 'The Snapchat plugin timed out. Retrying on the next refresh.',
};

function el(doc, tag, { id, className, text, attrs } = {}) {
  const n = doc.createElement(tag);
  if (id) n.id = id;
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  for (const [k, v] of Object.entries(attrs || {}))
    if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  return n;
}
const fmtCoord = (s) =>
  s && Number.isFinite(s.lat) ? `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}` : '';
const refreshLabel = (ms) =>
  !ms ? 'off' : ms < 60_000 ? `${ms / 1000}s` : `${ms / 60_000} min`;

export function createSceneFootagePanel({
  document: doc,
  controller,
  now = () => Date.now(),
  window: win = globalThis.window,
}) {
  const root = el(doc, 'section', {
    id: FOOTAGE_PANEL_ID,
    className: 'sfp',
    attrs: { 'aria-label': 'Snapchat scene footage', 'data-phase': 'idle' },
  });
  root.hidden = true;
  const head = el(doc, 'div', { className: 'sfp__head' });
  const title = el(doc, 'span', {
    className: 'sfp__title',
  });
  const snapLogo = createPlatformLogo('snapchat', { size: 14, className: 'sfp__title-logo' }, doc);
  if (snapLogo) {
    title.append(snapLogo, doc.createTextNode(' '));
  }
  title.append(doc.createTextNode('Snapchat footage'));
  const collapseBtn = el(doc, 'button', {
    id: `${FOOTAGE_PANEL_ID}-collapse`,
    className: 'sfp__btn',
    attrs: { type: 'button', 'aria-expanded': 'true', 'aria-label': 'Hide footage' },
  });
  setIconContent(collapseBtn, 'chevron-up', {}, doc);
  const closeBtn = el(doc, 'button', {
    id: `${FOOTAGE_PANEL_ID}-close`,
    className: 'sfp__btn',
    attrs: { type: 'button', 'aria-label': 'Close scene footage' },
  });
  setIconContent(closeBtn, 'x', {}, doc);
  head.append(title, collapseBtn, closeBtn);
  const body = el(doc, 'div', { className: 'sfp__body' });
  const sceneLine = el(doc, 'div', {
    id: `${FOOTAGE_PANEL_ID}-scene`,
    className: 'sfp__scene',
  });
  const matchLine = el(doc, 'div', {
    id: `${FOOTAGE_PANEL_ID}-match`,
    className: 'sfp__match',
  });
  const coverageNotice = el(doc, 'div', {
    id: `${FOOTAGE_PANEL_ID}-coverage`,
    className: 'sfp__notice',
    attrs: { role: 'note' },
  });
  const status = el(doc, 'div', {
    id: `${FOOTAGE_PANEL_ID}-status`,
    className: 'sfp__status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const player = el(doc, 'div', {
    id: `${FOOTAGE_PANEL_ID}-player`,
    className: 'sfp__player',
  });
  const meta = el(doc, 'div', {
    id: `${FOOTAGE_PANEL_ID}-meta`,
    className: 'sfp__meta',
  });
  const list = el(doc, 'div', {
    id: `${FOOTAGE_PANEL_ID}-clips`,
    className: 'sfp__clips',
    attrs: { role: 'listbox', 'aria-label': 'Footage clips' },
  });
  const foot = el(doc, 'div', { className: 'sfp__foot' });
  const checked = el(doc, 'span', {
    id: `${FOOTAGE_PANEL_ID}-checked`,
    className: 'sfp__checked',
  });
  const refreshSel = el(doc, 'select', {
    id: `${FOOTAGE_PANEL_ID}-refresh`,
    className: 'sfp__select',
    attrs: { 'aria-label': 'Footage refresh interval' },
  });
  const checkBtn = el(doc, 'button', {
    id: `${FOOTAGE_PANEL_ID}-check`,
    className: 'sfp__btn',
    attrs: { type: 'button' },
  });
  setIconContent(checkBtn, 'refresh-cw', { text: 'Check now' }, doc);
  foot.append(checked, refreshSel, checkBtn);
  const disclaimer = el(doc, 'p', {
    className: 'sfp__disclaimer',
    text: 'Snapchat Spotlight clips matched by caption/hashtag text for the place name — not geotagged Snap Map footage. Capture time and author handle are not provided by the plugin. Nothing here is live unless the source confirms it.',
  });
  body.append(
    sceneLine,
    matchLine,
    coverageNotice,
    status,
    player,
    meta,
    list,
    foot,
    disclaimer,
  );
  root.append(head, body);

  let currentVideoKey = null;
  let lastMin = null;

  function renderRefreshOptions(st) {
    if (lastMin === st.minRefreshMs && refreshSel.options.length) {
      refreshSel.value = String(st.refreshMs);
      return;
    }
    lastMin = st.minRefreshMs;
    const values = [
      ...new Set([
        ...REFRESH_CHOICES_MS.filter((v) => v === 0 || v >= st.minRefreshMs),
        st.refreshMs,
      ]),
    ].sort((a, b) => (a || Infinity) - (b || Infinity));
    refreshSel.replaceChildren(
      ...values.map((v) =>
        el(doc, 'option', {
          text: `refresh ${refreshLabel(v)}`,
          attrs: { value: v },
        }),
      ),
    );
    refreshSel.value = String(st.refreshMs);
  }

  function renderPlayer(st, clip) {
    const key = clip ? `${clip.id}|${clip.mediaUrl}` : null;
    if (key === currentVideoKey) return;
    currentVideoKey = key;
    if (!clip) {
      player.replaceChildren();
      player.hidden = true;
      return;
    }
    player.hidden = false;
    const probe = doc.createElement('video');
    const canPlay =
      typeof probe.canPlayType === 'function'
        ? probe.canPlayType('video/mp4')
        : 'maybe';
    if (!clip.mediaUrl || !canPlay) {
      const box = el(doc, 'div', {
        className: 'sfp__unsupported',
        attrs: { 'data-state': 'unsupported' },
      });
      box.append(
        el(doc, 'span', { text: 'This browser cannot play the clip inline. ' }),
      );
      if (clip.sourceUrl)
        box.append(
          el(doc, 'a', {
            text: 'Open the original on Snapchat',
            attrs: {
              href: clip.sourceUrl,
              target: '_blank',
              rel: 'noopener noreferrer',
            },
          }),
        );
      player.replaceChildren(box);
      return;
    }
    const video = el(doc, 'video', {
      id: `${FOOTAGE_PANEL_ID}-video`,
      className: 'sfp__video',
      attrs: {
        'data-clip-id': clip.id,
        'data-location-id': st.locationId,
        preload: 'auto',
        controls: '',
      },
    });
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.loop = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    video.setAttribute('loop', '');
    video.addEventListener('error', () => {
      if (video.dataset.clipId === controller.state.selectedId)
        void controller.mediaFailed(clip.id);
    });
    video.src = clip.mediaUrl;
    player.replaceChildren(video);
    try {
      const p = video.play?.();
      p?.catch?.(() => {});
    } catch {
      /* autoplay may be refused; controls remain */
    }
  }

  function render(st = controller.state) {
    const t = now();
    root.hidden = !st.scene;
    root.dataset.phase = st.phase;
    root.dataset.locationId = st.locationId || '';
    root.dataset.generation = String(st.generation);
    root.dataset.refreshCount = String(st.refreshCount);
    root.dataset.paused = String(Boolean(st.paused));
    if (!st.scene) {
      renderPlayer(st, null);
      return;
    }
    const s = st.scene;
    sceneLine.textContent = `Scene: ${s.placeName || s.label || 'selected location'} (${fmtCoord(s)})`;
    const clip = st.clips.find((c) => c.id === st.selectedId) || null;
    const loading = st.phase === 'loading';
    matchLine.textContent = st.coverageLabel
      ? `Matched place: “${clip?.matchedPlaceName || st.coverageLabel}” · coverage: ${LEVEL_LABEL[st.coverageLevel] || st.coverageLevel}`
      : loading
        ? 'Matched place: resolving…'
        : 'Matched place: —';
    const requested =
      st.ladder?.find((l) => l.queried)?.label || st.requestedLabel;
    coverageNotice.hidden = !(st.expanded && st.clips.length);
    coverageNotice.textContent = st.expanded
      ? `Coverage expanded: no relevant clips for “${requested}”, showing matches for the wider area “${st.coverageLabel}” (${st.coverageLevel}).`
      : '';
    status.dataset.state = st.phase;
    status.replaceChildren();
    if (loading) {
      status.append(
        el(doc, 'span', {
          className: 'sfp__spinner',
          attrs: { 'aria-hidden': 'true' },
        }),
        doc.createTextNode(
          `Searching Snapchat for footage near ${s.placeName || fmtCoord(s)}…`,
        ),
      );
    } else if (STATE_MESSAGE[st.phase]) {
      status.append(doc.createTextNode(STATE_MESSAGE[st.phase]));
      if (st.phase === 'empty' && st.ladder?.length)
        status.append(
          el(doc, 'small', {
            className: 'sfp__ladder',
            text: ` Searched: ${
              st.ladder
                .filter((l) => l.queried)
                .map((l) => `${l.label} (${l.level})`)
                .join(' → ') || '—'
            }${
              st.ladder.some((l) => l.capped)
                ? `; not searched (beyond coverage limit): ${st.ladder
                    .filter((l) => l.capped)
                    .map((l) => l.label)
                    .join(', ')}`
                : ''
            }.`,
          }),
        );
    } else if (st.message) status.append(doc.createTextNode(st.message));
    else if (st.phase === 'ready')
      status.append(
        doc.createTextNode(
          `${st.clips.length} clip${st.clips.length === 1 ? '' : 's'}${st.lastAdded ? ` · +${st.lastAdded} new on last refresh` : ''}`,
        ),
      );
    if (st.phase === 'plugin_error' && st.error)
      status.append(
        el(doc, 'small', {
          className: 'sfp__ladder',
          text:
            st.error === 'plugin-media-download-failed'
              ? ' The plugin found caption matches but failed to download every one of them (plugin-side HTTP 500). No substitute footage is shown.'
              : ` (${st.error})`,
        }),
      );
    if (st.message && st.phase !== 'ready' && STATE_MESSAGE[st.phase])
      status.append(el(doc, 'small', { text: ` ${st.message}` }));

    renderPlayer(st, st.phase === 'ready' || st.clips.length ? clip : null);
    meta.replaceChildren();
    if (clip) {
      const tl = clipTimeLines(clip, t);
      const attr = el(doc, 'div', { className: 'sfp__attr' });
      const attrSpan = el(doc, 'span');
      const attrLogo = createPlatformLogo('snapchat', { size: 14 }, doc);
      if (attrLogo) attrSpan.append(attrLogo, doc.createTextNode(' '));
      const uploadTimeStr = clip.publicationTime ? ` · ${formatAgo(clip.publicationTime, t)}` : '';
      attrSpan.append(doc.createTextNode(`Source: Snapchat Spotlight${uploadTimeStr} · ${clip.attribution ? `@${clip.attribution}` : 'author handle not returned'}`));
      attr.append(attrSpan);
      if (clip.sourceUrl) {
        attr.append(doc.createTextNode(' · '));
        attr.append(
          el(doc, 'a', {
            id: `${FOOTAGE_PANEL_ID}-original`,
            text: 'open original',
            attrs: {
              href: clip.sourceUrl,
              target: '_blank',
              rel: 'noopener noreferrer',
            },
          }),
        );
      }
      const times = el(doc, 'div', {
        id: `${FOOTAGE_PANEL_ID}-times`,
        className: 'sfp__times',
      });
      for (const [k, v] of [
        ['pub', tl.pub],
        ['cap', tl.cap],
        ['ret', tl.ret],
        ['live', tl.live],
      ])
        times.append(
          el(doc, 'span', {
            className: `sfp__time sfp__time--${k}`,
            text: v,
            attrs: { 'data-kind': k },
          }),
        );
      const caption = el(doc, 'div', {
        className: 'sfp__caption',
        text: clip.caption || '(no caption)',
      });
      const evidence = el(doc, 'div', {
        className: 'sfp__evidence',
        text: `Location evidence: ${EVIDENCE_LABEL[clip.locationEvidence]} — ${clip.locationEvidenceDetail}${clip.mediaExpiresAt ? ` · media link expires ${utcStamp(clip.mediaExpiresAt)}` : ''}`,
      });
      meta.append(attr, times, caption, evidence);
    }
    list.replaceChildren(
      ...st.clips.map((c, i) => {
        const b = el(doc, 'button', {
          className: 'sfp__clip',
          attrs: {
            type: 'button',
            role: 'option',
            'aria-selected': String(c.id === st.selectedId),
            'data-clip-id': c.id,
            'data-location-id': st.locationId,
          },
        });
        b.append(
          el(doc, 'b', { text: `#${i + 1}` }),
          el(doc, 'span', {
            className: 'sfp__clip-cap',
            text: c.caption || '(no caption)',
          }),
          el(doc, 'small', {
            text: c.publicationTime
              ? `published ${formatAgo(c.publicationTime, t)}`
              : 'publication time unknown',
          }),
        );
        b.addEventListener('click', () => controller.select(c.id));
        return b;
      }),
    );
    list.hidden = st.clips.length === 0;
    const retrieved = st.retrievalTime
      ? `retrieved ${formatAgo(st.retrievalTime, t)}${st.cached ? ' (server cache)' : ''}`
      : '';
    const last = st.lastCheckedAt
      ? `last checked ${new Date(st.lastCheckedAt).toISOString().slice(11, 19)} UTC (${formatAgo(st.lastCheckedAt, t)})`
      : 'not checked yet';
    checked.textContent = [
      retrieved,
      last,
      st.paused
        ? 'refresh paused (tab hidden)'
        : st.refreshing
          ? 'checking…'
          : '',
    ]
      .filter(Boolean)
      .join(' · ');
    checked.dataset.lastChecked = st.lastCheckedAt || '';
    renderRefreshOptions(st);
    checkBtn.disabled = loading || Boolean(st.refreshing);
  }

  refreshSel.addEventListener('change', () =>
    controller.setRefreshMs(Number(refreshSel.value)),
  );
  checkBtn.addEventListener('click', () => void controller.refresh());
  closeBtn.addEventListener('click', () => controller.close());
  collapseBtn.addEventListener('click', () => {
    const c = root.dataset.collapsed !== 'true';
    root.dataset.collapsed = String(c);
    collapseBtn.setAttribute('aria-expanded', String(!c));
    collapseBtn.setAttribute('aria-label', c ? 'Show footage' : 'Hide footage');
    setIconContent(collapseBtn, c ? 'chevron-down' : 'chevron-up', {}, doc);
    doc.body?.classList?.toggle('sfp-collapsed', c);
  });
  const unsub = controller.subscribe(render);
  const tick = win?.setInterval?.(() => {
    if (controller.state.scene) render();
  }, 15_000);
  render();
  return {
    element: root,
    render,
    destroy() {
      unsub();
      win?.clearInterval?.(tick);
      root.remove();
    },
  };
}
