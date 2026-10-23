/**
 * @fileoverview Gods-Eye scene player supporting multiple platforms, lazy media, and PiP.
 * @module gods-eye/ui/scene/player
 */

import { POSTERS, POSTER_LABELS } from './posters.js';
import { formatUtc } from '../../../footage/model.js';
import {
  extractYoutubeId,
  extractTiktokId,
  resolvePlayerKind,
} from './playerResolve.js';

export { extractYoutubeId, extractTiktokId, resolvePlayerKind };

/**
 * Creates the scene player component.
 *
 * @param {object} params
 * @param {Document} params.document
 * @param {Window} [params.window]
 * @param {() => void} [params.onEnded]
 * @param {() => void} [params.onPip]
 * @returns {{
 *   element: HTMLElement,
 *   setPoster: (key: string, label?: string) => void,
 *   showBanner: (text: string|null) => void,
 *   playNow: (item: any, scene?: any) => string,
 *   stop: () => void,
 *   setOverlay: (data: { distanceText?: string, deltaText?: string, recency?: string, uploadedAt?: string }) => void,
 *   togglePip: () => void
 * }}
 */
export function createScenePlayer({ document, window: win, onEnded, onPip }) {
  const root = document.createElement('div');
  root.id = 'ge-player';
  root.className = 'ge-player';
  root.dataset.playing = '0';
  root.dataset.kind = 'poster';

  const posterImg = document.createElement('img');
  posterImg.className = 'ge-player-poster';
  posterImg.src = POSTERS.idle;
  posterImg.alt = '';

  const posterLabel = document.createElement('span');
  posterLabel.className = 'ge-player-poster-label';

  const bannerEl = document.createElement('div');
  bannerEl.id = 'ge-banner';
  bannerEl.className = 'ge-banner';
  bannerEl.hidden = true;

  const mediaContainer = document.createElement('div');
  mediaContainer.className = 'ge-player-media';

  const overlay = document.createElement('div');
  overlay.className = 'ge-player-overlay';

  const overlayDist = document.createElement('span');
  overlayDist.className = 'ge-player-overlay-dist';
  const overlayDelta = document.createElement('span');
  overlayDelta.className = 'ge-player-overlay-delta';
  const overlayRecency = document.createElement('span');
  overlayRecency.className = 'ge-player-overlay-recency';
  const overlayTime = document.createElement('span');
  overlayTime.className = 'ge-player-overlay-time';

  overlay.append(overlayDist, overlayDelta, overlayRecency, overlayTime);

  const pipBtn = document.createElement('button');
  pipBtn.id = 'ge-player-pip';
  pipBtn.className = 'ge-player-pip';
  pipBtn.type = 'button';
  pipBtn.title = 'Picture-in-Picture';
  pipBtn.textContent = 'PiP';

  root.append(
    posterImg,
    posterLabel,
    mediaContainer,
    overlay,
    bannerEl,
    pipBtn,
  );

  let activeTimer = null;

  function clearActiveMedia() {
    if (activeTimer) {
      clearTimeout(activeTimer);
      activeTimer = null;
    }
    mediaContainer.innerHTML = '';
  }

  pipBtn.addEventListener('click', () => togglePip());

  function togglePip() {
    if (win?.documentPictureInPicture?.requestWindow) {
      win.documentPictureInPicture
        .requestWindow({ width: 320, height: 180 })
        .catch(() => {});
      onPip?.();
      return;
    }

    const isMini = root.classList.toggle('is-mini');
    if (isMini) {
      let isDragging = false;
      let startX = 0;
      let startY = 0;
      let initLeft = 0;
      let initTop = 0;

      root.onpointerdown = (e) => {
        if (e.target === pipBtn) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = root.getBoundingClientRect();
        initLeft = rect.left;
        initTop = rect.top;
        root.setPointerCapture?.(e.pointerId);
      };

      root.onpointermove = (e) => {
        if (!isDragging) return;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
        root.style.left = `${initLeft + (e.clientX - startX)}px`;
        root.style.top = `${initTop + (e.clientY - startY)}px`;
      };

      root.onpointerup = (e) => {
        isDragging = false;
        root.releasePointerCapture?.(e.pointerId);
      };
    } else {
      root.onpointerdown = null;
      root.onpointermove = null;
      root.onpointerup = null;
      root.style.left = '';
      root.style.top = '';
    }

    onPip?.();
  }

  function stop() {
    clearActiveMedia();
    root.dataset.playing = '0';
    root.dataset.kind = 'poster';
  }

  /**
   * Arm a clip without starting it: poster = its thumbnail, overlay filled,
   * data-item-id set, playing stays 0. Used by Open / share restore so a
   * restored scene makes ZERO media requests until the user presses play.
   */
  function arm(item) {
    clearActiveMedia();
    root.dataset.playing = '0';
    root.dataset.kind = 'armed';
    root.dataset.itemId = item?.id || '';
    if (item?.thumbUrl || item?.thumb)
      posterImg.src = item.thumbUrl || item.thumb;
    posterLabel.textContent = 'PRESS PLAY · ENTER';
  }

  function playNow(item, scene = null) {
    clearActiveMedia();
    const { kind, src } = resolvePlayerKind(item);
    root.dataset.playing = '1';
    root.dataset.kind = kind;
    root.dataset.itemId = item?.id || '';

    if (kind === 'youtube') {
      const iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
      iframe.allowFullscreen = true;
      mediaContainer.appendChild(iframe);
    } else if (kind === 'tiktok') {
      const iframe = document.createElement('iframe');
      iframe.src = src;
      mediaContainer.appendChild(iframe);
      activeTimer = setTimeout(() => onEnded?.(), 20000);
    } else if (kind === 'video') {
      const video = document.createElement('video');
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.src = src;
      video.addEventListener('ended', () => onEnded?.());
      mediaContainer.appendChild(video);
    } else if (kind === 'embed') {
      const iframe = document.createElement('iframe');
      iframe.src = src;
      mediaContainer.appendChild(iframe);
      activeTimer = setTimeout(() => onEnded?.(), 18000);
    } else {
      if (item?.thumbUrl || item?.thumb) {
        posterImg.src = item.thumbUrl || item.thumb;
      }
      activeTimer = setTimeout(() => onEnded?.(), 6000);
    }

    return kind;
  }

  return {
    element: root,
    setPoster(keyOrUrl, label = '') {
      posterImg.src = POSTERS[keyOrUrl] || keyOrUrl || POSTERS.idle;
      posterLabel.textContent = label || POSTER_LABELS[keyOrUrl] || '';
    },
    showBanner(text) {
      if (text) {
        bannerEl.textContent = text;
        bannerEl.hidden = false;
      } else {
        bannerEl.textContent = '';
        bannerEl.hidden = true;
      }
    },
    playNow,
    arm,
    stop,
    setOverlay({ distanceText, deltaText, recency, uploadedAt }) {
      overlayDist.textContent = distanceText || '';
      overlayDelta.textContent = deltaText || '';
      overlayRecency.textContent = recency || '';
      overlayTime.textContent = uploadedAt ? formatUtc(uploadedAt) : '';
    },
    togglePip,
  };
}
