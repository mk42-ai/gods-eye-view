/**
 * Scene card component for the Gods-Eye scenes director panel.
 * @module ui/scenes-panel/card
 */

const PLATFORMS = ['tiktok', 'instagram', 'youtube', 'x', 'reddit', 'web'];

export function getTopPlatform(scene) {
  const counts = {};
  for (const it of scene?.footage || []) {
    if (it.platform) counts[it.platform] = (counts[it.platform] || 0) + 1;
  }
  let top = 'web',
    max = 0;
  for (const [p, c] of Object.entries(counts)) {
    if (c > max) {
      max = c;
      top = p;
    }
  }
  if (max === 0 && scene?.sources) {
    for (const [p, s] of Object.entries(scene.sources)) {
      if ((s?.count || 0) > max) {
        max = s.count;
        top = p;
      }
    }
  }
  return top;
}

function getNearestDist(scene) {
  let min = Infinity;
  for (const it of scene?.footage || []) {
    if (typeof it.distanceKm === 'number' && !Number.isNaN(it.distanceKm)) {
      if (it.distanceKm < min) min = it.distanceKm;
    }
  }
  if (min === Infinity) return 'nearest -- km';
  return `nearest ${min < 10 ? min.toFixed(1) : Math.round(min)} km`;
}

/**
 * Render a single scene card element.
 * @param {object} params
 * @returns {HTMLElement}
 */
export function renderSceneCard({
  document,
  scene,
  actions = {},
  now = Date.now,
  activeId,
  active,
}) {
  const nowMs = typeof now === 'function' ? now() : (now ?? Date.now());
  const createdMs = scene?.lifecycle?.createdAt
    ? new Date(scene.lifecycle.createdAt).getTime()
    : NaN;
  // Recompute against the injected clock (lifecycle tests mock `now`).
  const isNew = Number.isFinite(createdMs)
    ? nowMs - createdMs < 24 * 3600 * 1000
    : Boolean(scene?.lifecycle?.isNew);
  const archMs = scene?.lifecycle?.archivedAt
    ? new Date(scene.lifecycle.archivedAt).getTime()
    : Infinity;
  const isArchived = archMs <= nowMs;
  const isActive = Boolean(
    active || (activeId && scene?.id && activeId === scene.id),
  );

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  const card = el('article', 'ge-scene-card');
  card.tabIndex = 0;
  card.setAttribute('role', 'article');
  card.setAttribute('data-scene-id', scene?.id || '');
  card.setAttribute('data-kind', scene?.kind || 'live');
  card.setAttribute('data-new', isNew ? '1' : '0');
  card.setAttribute('data-archived', isArchived ? '1' : '0');
  card.setAttribute('data-active', isActive ? '1' : '0');
  if (isActive) card.classList.add('is-active');

  const header = el('header', 'ge-sc-header');
  const badges = el('div', 'ge-sc-badges');
  badges.append(
    el('span', 'ge-sc-kind', String(scene?.kind || 'live').toUpperCase()),
  );
  if (isNew) badges.append(el('span', 'ge-sc-new', 'NEW'));
  if (isArchived) badges.append(el('span', 'ge-sc-archived', 'ARCHIVED'));
  header.appendChild(badges);

  const titleWrap = el('div', 'ge-sc-title-wrap');
  const titleEl = el('h3', 'ge-sc-title', scene?.title || 'Untitled Scene');
  titleWrap.appendChild(titleEl);
  header.appendChild(titleWrap);
  card.appendChild(header);

  const meta = el('div', 'ge-sc-meta');
  meta.append(
    el('span', 'ge-sc-target', scene?.target?.name || 'Unknown target'),
  );
  if (scene?.target?.lat != null && scene?.target?.lon != null) {
    const c = `${scene.target.lat.toFixed(4)}°, ${scene.target.lon.toFixed(4)}°`;
    meta.append(el('span', 'ge-sc-coords', c));
  }
  if (scene?.tRefLabel) meta.append(el('span', 'ge-sc-tref', scene.tRefLabel));
  card.appendChild(meta);

  const stats = el('div', 'ge-sc-stats');
  const count = scene?.footage?.length || 0;
  stats.append(
    el('span', 'ge-sc-clips', `${count} clip${count === 1 ? '' : 's'}`),
    el('span', 'ge-sc-nearest', getNearestDist(scene)),
  );

  const topPlatform = getTopPlatform(scene);
  const platImg = el('img', 'ge-sc-platform-icon');
  platImg.src = `/icons/platforms/${topPlatform}.svg`;
  platImg.alt = topPlatform;
  stats.appendChild(platImg);

  const routeChip = el('span', 'ge-sc-route');
  if (scene?.route?.fallback) {
    routeChip.textContent = 'ROUTE: FALLBACK';
    routeChip.classList.add('is-fallback');
    routeChip.setAttribute('data-fallback', '1');
  } else {
    const conf = Math.round((scene?.route?.confidence ?? 1) * 100);
    routeChip.textContent = `ROUTE: ${conf}%`;
  }
  stats.appendChild(routeChip);
  card.appendChild(stats);

  const sourceDots = el('div', 'ge-sc-source-dots');
  for (const p of PLATFORMS) {
    const dot = el('span', 'ge-sc-source-dot');
    const st = scene?.sources?.[p]?.status || 'idle';
    dot.setAttribute('data-platform', p);
    dot.setAttribute('data-status', st);
    dot.title = `${p}: ${st}`;
    sourceDots.appendChild(dot);
  }
  card.appendChild(sourceDots);

  const thumbs = el('div', 'ge-scene-thumbs');
  let goneCount = 0;
  for (let i = 0; i < 3; i++) {
    const it = scene?.footage?.[i];
    const slot = el('div', 'ge-sc-thumb-slot');
    if (it?.thumbUrl) {
      const img = el('img', 'ge-sc-thumb');
      img.src = it.thumbUrl;
      img.alt = it.caption || `Clip ${i + 1}`;
      if (it.diff === 'new') img.classList.add('is-new');
      if (it.diff === 'removed') {
        img.classList.add('is-gone');
        slot.append(el('span', 'ge-sc-gone-label', 'no longer available'));
      }
      slot.appendChild(img);
    } else slot.appendChild(el('div', 'ge-sc-thumb-empty'));
    thumbs.appendChild(slot);
  }
  card.appendChild(thumbs);

  for (const it of scene?.footage || []) {
    if (it?.diff === 'removed') goneCount++;
  }
  if (goneCount > 0) {
    card.append(
      el('div', 'ge-sc-gone-count', `${goneCount} no longer available`),
    );
  }

  const diffLine = el('div', 'ge-scene-diff');
  if (scene?.lastDiff) {
    const { added = 0, removed = 0, unchanged = 0 } = scene.lastDiff;
    diffLine.textContent = `+${added} new · ${removed} removed · ${unchanged} unchanged`;
  } else diffLine.hidden = true;
  card.appendChild(diffLine);

  const shareFb = el('div', 'ge-sc-share-feedback', 'LINK COPIED');
  shareFb.hidden = true;
  card.appendChild(shareFb);

  const actBar = el('div', 'ge-sc-actions');
  const makeBtn = (cls, text, aria, fn) => {
    const b = el('button', `scene-btn ge-sc-${cls}`, text);
    b.type = 'button';
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', (e) => {
      e.stopPropagation?.();
      fn?.(e);
    });
    return b;
  };

  const startRename = () => {
    if (titleWrap.querySelector('.ge-sc-title-input')) return;
    const inp = el('input', 'ge-sc-title-input');
    inp.type = 'text';
    inp.value = titleEl.textContent || '';
    titleEl.replaceWith(inp);
    inp.focus?.();
    inp.select?.();
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = inp.value.trim() || scene.title;
        titleEl.textContent = v;
        inp.replaceWith(titleEl);
        actions.rename?.(scene.id, v);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        inp.replaceWith(titleEl);
      }
    });
  };

  let copyTimer = null;
  const onShare = async () => {
    try {
      const url = await actions.share?.(scene.id);
      if (url && navigator?.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(url);
        } catch (_) {}
      }
      shareFb.hidden = false;
      const win = document.defaultView || globalThis;
      if (copyTimer) win.clearTimeout(copyTimer);
      copyTimer = win.setTimeout(() => (shareFb.hidden = true), 1500);
    } catch (_) {}
  };

  const btnDefs = [
    ['open', 'OPEN', 'Open scene', () => actions.open?.(scene.id)],
    [
      'recreate',
      'RECREATE',
      'Recreate scene',
      () => actions.recreate?.(scene.id),
    ],
    ['rename', 'RENAME', 'Rename scene', startRename],
    [
      'duplicate',
      'DUPLICATE',
      'Duplicate scene',
      () => actions.duplicate?.(scene.id),
    ],
    [
      'delete',
      'DELETE',
      'Delete scene',
      () => (actions.remove || actions.delete)?.(scene.id),
    ],
    ['share', 'SHARE', 'Share scene', onShare],
  ];
  for (const [cls, txt, aria, fn] of btnDefs) {
    actBar.appendChild(makeBtn(cls, txt, aria, fn));
  }
  card.appendChild(actBar);

  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === card) {
      e.preventDefault();
      actions.open?.(scene.id);
    }
  });

  return card;
}
