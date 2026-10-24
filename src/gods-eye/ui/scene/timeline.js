/**
 * @fileoverview Gods-Eye timeline scrubber, per-clip ticks, alert markers, and chronological playback.
 * @module gods-eye/ui/scene/timeline
 */

import { formatUtc } from '../../../footage/model.js';

/**
 * Calculates percentage along timeline from start to end.
 * @param {string|number} time
 * @param {string|number} start
 * @param {string|number} end
 * @returns {number}
 */
export function calculateTimelinePercent(time, start, end) {
  const t = typeof time === 'string' ? Date.parse(time) : Number(time);
  const s = typeof start === 'string' ? Date.parse(start) : Number(start);
  const e = typeof end === 'string' ? Date.parse(end) : Number(end);
  if (Number.isNaN(t) || Number.isNaN(s) || Number.isNaN(e) || e <= s)
    return 50;
  const pct = ((t - s) / (e - s)) * 100;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Creates the timeline scrubber component.
 * @param {object} params
 * @param {Document} params.document
 * @param {(window: { from: string, to: string } | null) => void} [params.onScrub]
 * @param {(orderedItems: any[]) => void} [params.onPlay]
 */
export function createTimeline({ document, onScrub, onPlay }) {
  const root = document.createElement('div');
  root.id = 'ge-timeline';
  root.className = 'ge-timeline';

  const controlsRow = document.createElement('div');
  controlsRow.className = 'ge-tl-controls';

  const playBtn = document.createElement('button');
  playBtn.id = 'ge-timeline-play';
  playBtn.className = 'ge-tl-play';
  playBtn.type = 'button';
  playBtn.textContent = 'PLAY';

  const resetBtn = document.createElement('button');
  resetBtn.id = 'ge-timeline-reset';
  resetBtn.className = 'ge-tl-reset';
  resetBtn.type = 'button';
  resetBtn.textContent = 'RESET';

  const labelStart = document.createElement('span');
  labelStart.className = 'ge-tl-label-start';
  const labelCursor = document.createElement('span');
  labelCursor.className = 'ge-tl-label-cursor';
  const labelEnd = document.createElement('span');
  labelEnd.className = 'ge-tl-label-end';

  controlsRow.append(playBtn, resetBtn, labelStart, labelCursor, labelEnd);

  const trackWrap = document.createElement('div');
  trackWrap.className = 'ge-tl-track-wrap';

  const bandsWrap = document.createElement('div');
  bandsWrap.className = 'ge-tl-bands';

  const markersWrap = document.createElement('div');
  markersWrap.className = 'ge-tl-markers';

  const t0Marker = document.createElement('span');
  t0Marker.className = 'ge-tl-t0';
  t0Marker.textContent = 'T0';

  const scrubInput = document.createElement('input');
  scrubInput.type = 'range';
  scrubInput.id = 'ge-timeline-scrub';
  scrubInput.className = 'ge-timeline-scrub';
  scrubInput.min = '0';
  scrubInput.max = '1000';
  scrubInput.value = '500';

  trackWrap.append(bandsWrap, markersWrap, t0Marker, scrubInput);
  root.append(controlsRow, trackWrap);

  let currentScene = null;
  let currentItems = [];
  let currentAlerts = [];
  let windowMinutes = 15;
  let startMs = 0;
  let endMs = 0;
  let tRefMs = 0;

  function recalculateBounds() {
    if (!currentScene) return;
    if (currentScene.timeline?.start && currentScene.timeline?.end) {
      startMs = Date.parse(currentScene.timeline.start);
      endMs = Date.parse(currentScene.timeline.end);
    } else {
      tRefMs = Date.parse(currentScene.tRef || new Date().toISOString());
      startMs = tRefMs - 12 * 3600 * 1000;
      endMs = tRefMs + 12 * 3600 * 1000;
    }
    tRefMs = currentScene.tRef
      ? Date.parse(currentScene.tRef)
      : startMs + (endMs - startMs) / 2;

    labelStart.textContent = formatUtc(new Date(startMs).toISOString());
    labelEnd.textContent = formatUtc(new Date(endMs).toISOString());
    t0Marker.style.left = `${calculateTimelinePercent(tRefMs, startMs, endMs)}%`;

    renderBands();
    renderMarkers();
  }

  function renderBands() {
    bandsWrap.innerHTML = '';
    if (endMs <= startMs) return;
    if (currentScene?.kind === 'rebuild') {
      const b = document.createElement('div');
      b.className = 'ge-tl-band';
      b.dataset.recency = 'ARCHIVE';
      b.style.left = '0%';
      b.style.width = '100%';
      bandsWrap.appendChild(b);
      return;
    }
    const now = Date.now();
    const cuts = [
      {
        recency: 'ARCHIVE',
        from: startMs,
        to: Math.min(endMs, now - 24 * 3600 * 1000),
      },
      {
        recency: 'RECENT',
        from: Math.max(startMs, now - 24 * 3600 * 1000),
        to: Math.min(endMs, now - 15 * 60 * 1000),
      },
      {
        recency: 'LIVE',
        from: Math.max(startMs, now - 15 * 60 * 1000),
        to: endMs,
      },
    ];
    for (const cut of cuts) {
      if (cut.to > cut.from) {
        const left = calculateTimelinePercent(cut.from, startMs, endMs);
        const right = calculateTimelinePercent(cut.to, startMs, endMs);
        const band = document.createElement('div');
        band.className = 'ge-tl-band';
        band.dataset.recency = cut.recency;
        band.style.left = `${left}%`;
        band.style.width = `${Math.max(0, right - left)}%`;
        bandsWrap.appendChild(band);
      }
    }
  }

  function renderMarkers() {
    markersWrap.innerHTML = '';
    for (const item of currentItems) {
      const itemTime = item.uploadedAt
        ? Date.parse(item.uploadedAt)
        : tRefMs + (item.timeDelta || 0) * 1000;
      const pct = calculateTimelinePercent(itemTime, startMs, endMs);
      const tick = document.createElement('span');
      tick.className = 'ge-tl-tick';
      tick.dataset.itemId = item.id || '';
      tick.style.left = `${pct}%`;
      tick.title = item.caption || item.id || '';
      markersWrap.appendChild(tick);
    }
    for (const alert of currentAlerts) {
      const alertTime = alert.at ? Date.parse(alert.at) : startMs;
      const pct = calculateTimelinePercent(alertTime, startMs, endMs);
      const alertEl = document.createElement('span');
      alertEl.className = 'ge-tl-alert';
      alertEl.dataset.alertId = alert.id || '';
      alertEl.style.left = `${pct}%`;
      alertEl.title = alert.text || '';
      markersWrap.appendChild(alertEl);
    }
  }

  function emitScrubAt(val) {
    const fraction = Number(val) / 1000;
    const cursorMs = startMs + fraction * (endMs - startMs);
    const halfWindowMs = (windowMinutes * 60 * 1000) / 2;
    const fromIso = new Date(cursorMs - halfWindowMs).toISOString();
    const toIso = new Date(cursorMs + halfWindowMs).toISOString();
    labelCursor.textContent = formatUtc(new Date(cursorMs).toISOString());
    onScrub?.({ from: fromIso, to: toIso });
  }

  scrubInput.addEventListener('input', (e) => emitScrubAt(e.target.value));
  resetBtn.addEventListener('click', () => {
    scrubInput.value = '500';
    labelCursor.textContent = '';
    onScrub?.(null);
  });
  playBtn.addEventListener('click', () => {
    const sorted = currentItems
      .slice()
      .sort(
        (a, b) => Date.parse(a.uploadedAt || 0) - Date.parse(b.uploadedAt || 0),
      );
    onPlay?.(sorted);
  });

  return {
    element: root,
    setScene(scene, items = []) {
      currentScene = scene;
      currentItems = Array.isArray(items) ? items : scene?.footage || [];
      recalculateBounds();
    },
    setAlerts(alerts) {
      currentAlerts = Array.isArray(alerts) ? alerts : [];
      renderMarkers();
    },
    setWindowMinutes(n = 15) {
      windowMinutes = n;
    },
    setCursor(iso) {
      const ms = Date.parse(iso);
      if (Number.isFinite(ms) && endMs > startMs) {
        const pct = calculateTimelinePercent(ms, startMs, endMs);
        scrubInput.value = String(Math.round((pct / 100) * 1000));
        labelCursor.textContent = formatUtc(iso);
      }
    },
  };
}
