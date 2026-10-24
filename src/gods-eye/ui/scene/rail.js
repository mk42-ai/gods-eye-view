/**
 * @fileoverview Virtualised footage rail list component with keyboard and hover interactions.
 * @module gods-eye/ui/scene/rail
 */

import { formatDistanceText, formatDeltaText } from './railFormat.js';
import { POSTERS } from './posters.js';

export { formatDistanceText, formatDeltaText };

const ROW_HEIGHT = 88;
const BUFFER = 6;

/**
 * Creates the virtualised footage rail component.
 *
 * @param {object} params
 * @param {Document} params.document
 * @param {Window} [params.window]
 * @param {(item: any) => void} [params.onSelect]
 * @param {(itemId: string|null) => void} [params.onHover]
 * @returns {any}
 */
const ANON_HANDLE = 'anon';

export function createFootageRail({
  document,
  window: win,
  onSelect,
  onHover,
}) {
  const rail = document.createElement('ol');
  rail.id = 'ge-rail';
  rail.className = 'ge-rail';
  rail.hidden = true;
  rail.tabIndex = -1;

  let allItems = [];
  let filteredItems = [];
  let filterPredicate = null;
  let currentKind = 'live';
  let selectedId = null;

  function applyFilter() {
    filteredItems = filterPredicate
      ? allItems.filter(filterPredicate)
      : allItems.slice();
    render();
  }

  function render() {
    rail.innerHTML = '';
    const total = filteredItems.length;
    if (total === 0) return;

    const scrollTop = rail.scrollTop || 0;
    const clientH = rail.clientHeight || 700;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
    const end = Math.min(
      total,
      Math.ceil((scrollTop + clientH) / ROW_HEIGHT) + BUFFER,
    );

    const topSpacer = document.createElement('li');
    topSpacer.className = 'ge-rail-spacer';
    topSpacer.style.height = `${start * ROW_HEIGHT}px`;
    topSpacer.setAttribute('aria-hidden', 'true');
    rail.appendChild(topSpacer);

    for (let i = start; i < end; i++) {
      const item = filteredItems[i];
      const card = createCard(item);
      if (item.id === selectedId) {
        card.classList.add('is-selected');
        card.setAttribute('aria-selected', 'true');
      }
      rail.appendChild(card);
    }

    const bottomSpacer = document.createElement('li');
    bottomSpacer.className = 'ge-rail-spacer';
    bottomSpacer.style.height = `${(total - end) * ROW_HEIGHT}px`;
    bottomSpacer.setAttribute('aria-hidden', 'true');
    rail.appendChild(bottomSpacer);
  }

  function createCard(item) {
    const card = document.createElement('li');
    card.className = 'ge-card';
    card.tabIndex = 0;
    card.dataset.itemId = item.id || '';
    card.dataset.platform = item.platform || '';
    card.dataset.recency = item.recency || 'ARCHIVE';
    card.dataset.confidence = item.location?.confidence || 'unknown';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'ge-card-thumb';
    const thumbImg = document.createElement('img');
    thumbImg.src = item.thumbUrl || item.thumb || POSTERS.loading;
    thumbImg.loading = 'lazy';
    thumbImg.alt = '';
    thumbWrap.appendChild(thumbImg);

    const platformWrap = document.createElement('div');
    platformWrap.className = 'ge-card-platform';
    if (item.pluginMeta?.icon) {
      const platImg = document.createElement('img');
      platImg.src = item.pluginMeta.icon;
      platImg.alt = item.platform || '';
      platformWrap.appendChild(platImg);
    }

    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'ge-card-avatar';
    if (item.authorAvatar) {
      const avImg = document.createElement('img');
      avImg.src = item.authorAvatar;
      avImg.alt = '';
      avatarWrap.appendChild(avImg);
    } else {
      const initial = document.createElement('span');
      initial.className = 'ge-card-avatar-initial';
      const handleStr = item.authorHandle || item.author || '?';
      initial.textContent = handleStr[0].toUpperCase();
      avatarWrap.appendChild(initial);
    }

    const handleEl = document.createElement('span');
    handleEl.className = 'ge-card-handle';
    const handle = item.authorHandle || item.author || ANON_HANDLE;
    handleEl.textContent = `@${handle}`;

    const distEl = document.createElement('span');
    distEl.className = 'ge-card-distance';
    distEl.textContent = formatDistanceText(item.distanceKm);

    const deltaEl = document.createElement('span');
    deltaEl.className = 'ge-card-delta';
    deltaEl.textContent = formatDeltaText(
      item.timeDelta,
      currentKind,
      item.uploadedAt,
    );

    const confEl = document.createElement('span');
    confEl.className = 'ge-card-confidence';
    const confidence = item.location?.confidence || card.dataset.confidence;
    confEl.textContent = confidence;

    const recencyEl = document.createElement('span');
    recencyEl.className = 'ge-card-recency';
    recencyEl.textContent = item.recency || 'ARCHIVE';

    const sourceLink = document.createElement('a');
    sourceLink.className = 'ge-card-source';
    sourceLink.href = item.sourceUrl || item.url || '#';
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener';
    sourceLink.textContent = 'SRC';

    card.append(
      thumbWrap,
      platformWrap,
      avatarWrap,
      handleEl,
      distEl,
      deltaEl,
      confEl,
      recencyEl,
      sourceLink,
    );

    card.addEventListener('mouseenter', () => onHover?.(item.id));
    card.addEventListener('mouseleave', () => onHover?.(null));
    card.addEventListener('click', (e) => {
      if (!e.target?.closest?.('a')) onSelect?.(item);
    });

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect?.(item);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = card.nextElementSibling;
        if (next && next.classList.contains('ge-card')) next.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = card.previousElementSibling;
        if (prev && prev.classList.contains('ge-card')) prev.focus();
      }
    });

    return card;
  }

  rail.addEventListener('scroll', () => render(), { passive: true });

  return {
    element: rail,
    setItems(items, sceneKind = 'live') {
      allItems = Array.isArray(items) ? items : [];
      currentKind = sceneKind;
      applyFilter();
    },
    setFilter(predicate) {
      filterPredicate = predicate;
      applyFilter();
    },
    setSelected(id) {
      selectedId = id;
      const prev = rail.querySelector('.ge-card.is-selected');
      if (prev) {
        prev.classList.remove('is-selected');
        prev.removeAttribute('aria-selected');
      }
      if (id) {
        const next = rail.querySelector(`[data-item-id="${id}"]`);
        if (next) {
          next.classList.add('is-selected');
          next.setAttribute('aria-selected', 'true');
        }
      }
    },
    scrollTo(id) {
      const idx = filteredItems.findIndex((it) => it.id === id);
      if (idx >= 0) {
        rail.scrollTop = idx * ROW_HEIGHT;
        render();
      }
    },
    setPulse(id) {
      const card = rail.querySelector(`[data-item-id="${id}"]`);
      if (card) {
        card.classList.add('is-pulse');
        (win || globalThis).setTimeout(
          () => card.classList.remove('is-pulse'),
          600,
        );
      }
    },
    show() {
      rail.hidden = false;
      render();
    },
    hide() {
      rail.hidden = true;
    },
  };
}
