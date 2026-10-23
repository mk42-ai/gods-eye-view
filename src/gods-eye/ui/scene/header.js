/**
 * @fileoverview Gods-Eye scene header component.
 * @module gods-eye/ui/scene/header
 */

import { formatUtc } from '../../../footage/model.js';

/**
 * Format latitude and longitude to standard display format: e.g. 25.1470°N 55.1990°E
 * @param {number|null|undefined} lat
 * @param {number|null|undefined} lon
 * @returns {string}
 */
export function formatCoords(lat, lon) {
  if (
    lat == null ||
    lon == null ||
    Number.isNaN(Number(lat)) ||
    Number.isNaN(Number(lon))
  ) {
    return '—';
  }
  const nLat = Number(lat);
  const nLon = Number(lon);
  const latDir = nLat >= 0 ? 'N' : 'S';
  const lonDir = nLon >= 0 ? 'E' : 'W';
  return `${Math.abs(nLat).toFixed(4)}°${latDir} ${Math.abs(nLon).toFixed(4)}°${lonDir}`;
}

/**
 * Format distance in kilometers or meters.
 * @param {number|null|undefined} km
 * @returns {string}
 */
export function formatDistance(km) {
  if (km == null || Number.isNaN(Number(km))) return '— km';
  const val = Number(km);
  if (val < 1) {
    return `${Math.round(val * 1000)} m`;
  }
  return `${val.toFixed(1)} km`;
}

/**
 * Summarize source platform count and clip count.
 * @param {import('../../../scenes/models.js').Scene|null|undefined} scene
 * @returns {string}
 */
export function formatSourcesSummary(scene) {
  let sourceCount = 0;
  if (scene?.sources) {
    if (Array.isArray(scene.sources)) {
      sourceCount = scene.sources.filter(
        (s) => s && (s.status === 'ok' || s.count > 0),
      ).length;
    } else {
      sourceCount = Object.values(scene.sources).filter(
        (s) => s && (s.status === 'ok' || s.count > 0),
      ).length;
    }
  }
  if (
    sourceCount === 0 &&
    Array.isArray(scene?.footage) &&
    scene.footage.length > 0
  ) {
    const platforms = new Set(
      scene.footage.map((f) => f.platform).filter(Boolean),
    );
    sourceCount = platforms.size;
  }
  const clipCount = Array.isArray(scene?.footage) ? scene.footage.length : 0;
  return `${sourceCount} sources · ${clipCount} clips`;
}

/**
 * Creates the scene header DOM element and updater.
 *
 * @param {object} options
 * @param {Document} options.document
 * @returns {{ element: HTMLElement, update: (scene: any, options?: { nearestKm?: number, liveStatus?: string }) => void }}
 */
export function createSceneHeader({ document }) {
  const header = document.createElement('header');
  header.id = 'ge-scene-header';
  header.className = 'ge-scene-header';

  // Sub-elements per §5 DOM contract
  const rowTop = document.createElement('div');
  rowTop.className = 'ge-h-row-top';

  const dot = document.createElement('span');
  dot.className = 'ge-h-dot';
  dot.setAttribute('aria-hidden', 'true');

  const kindBadge = document.createElement('span');
  kindBadge.className = 'ge-h-kind';

  const labelBadge = document.createElement('span');
  labelBadge.className = 'ge-h-label';
  labelBadge.textContent = 'UAE Interest Watch';

  const routeChip = document.createElement('span');
  routeChip.className = 'ge-h-route';

  rowTop.appendChild(dot);
  rowTop.appendChild(kindBadge);
  rowTop.appendChild(labelBadge);
  rowTop.appendChild(routeChip);

  const rowMiddle = document.createElement('div');
  rowMiddle.className = 'ge-h-row-middle';

  const nameEl = document.createElement('h2');
  nameEl.className = 'ge-h-name';

  const coordsEl = document.createElement('span');
  coordsEl.className = 'ge-h-coords';

  rowMiddle.appendChild(nameEl);
  rowMiddle.appendChild(coordsEl);

  const rowBottom = document.createElement('div');
  rowBottom.className = 'ge-h-row-bottom';

  const tRefEl = document.createElement('span');
  tRefEl.className = 'ge-h-tref';

  const aoiEl = document.createElement('span');
  aoiEl.className = 'ge-h-aoi';

  const sourcesEl = document.createElement('span');
  sourcesEl.className = 'ge-h-sources';

  const nearestEl = document.createElement('span');
  nearestEl.className = 'ge-h-nearest';

  rowBottom.appendChild(tRefEl);
  rowBottom.appendChild(aoiEl);
  rowBottom.appendChild(sourcesEl);
  rowBottom.appendChild(nearestEl);

  header.appendChild(rowTop);
  header.appendChild(rowMiddle);
  header.appendChild(rowBottom);

  /**
   * Updates header contents for a given scene.
   * @param {any} scene
   * @param {{ nearestKm?: number, liveStatus?: string }} [opts]
   */
  function update(scene, opts = {}) {
    if (!scene) return;
    const { nearestKm, liveStatus } = opts;

    const isFallback = Boolean(scene.route?.fallback);
    const kind = scene.kind || 'live';
    const stage = scene.camera?.stage || 'S2';
    const computedLiveStatus =
      liveStatus || (kind === 'live' ? 'live' : 'idle');

    header.dataset.kind = kind;
    header.dataset.stage = stage;
    header.dataset.routeFallback = isFallback ? '1' : '0';
    header.dataset.liveStatus = computedLiveStatus;

    nameEl.textContent =
      scene.title || scene.prompt || scene.target?.name || 'Untitled Scene';
    coordsEl.textContent = formatCoords(scene.target?.lat, scene.target?.lon);
    kindBadge.textContent = kind.toUpperCase();
    labelBadge.textContent = scene.label || 'UAE Interest Watch';

    tRefEl.textContent =
      scene.tRefLabel || (scene.tRef ? formatUtc(scene.tRef) : '—');
    aoiEl.textContent = scene.aoi?.name || '';

    if (isFallback) {
      routeChip.textContent = 'ROUTE: FALLBACK';
      routeChip.classList.add('is-fallback');
    } else {
      const conf = Math.round((scene.route?.confidence ?? 1) * 100);
      routeChip.textContent = `ROUTE: ${conf}%`;
      routeChip.classList.remove('is-fallback');
    }

    sourcesEl.textContent = formatSourcesSummary(scene);

    let dist = nearestKm;
    if (dist == null && Array.isArray(scene.footage)) {
      const distances = scene.footage
        .map((f) => f.distanceKm)
        .filter((d) => d != null && !Number.isNaN(Number(d)));
      if (distances.length > 0) {
        dist = Math.min(...distances);
      }
    }
    nearestEl.textContent = formatDistance(dist);
  }

  return {
    element: header,
    update,
  };
}
