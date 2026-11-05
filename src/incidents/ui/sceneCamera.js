/** Isolated, metadata-only camera panel. Parent owns mounting, CSS and playback.
 * Never fetches/embeds media, flies the globe, enables a layer, or auto-selects
 * an existing CCTV control. onSelect is called only by an explicit button click.
 */
import {
  selectSceneCamera,
  DEFAULT_MAX_DISTANCE_M,
  DEFAULT_MAX_LIVE_AGE_MS,
} from '../../scenes/cameraCoverage.js';

export function createSceneCamera({
  document: doc = globalThis.document,
  cameras = [],
  scene = null,
  onSelect,
  now = () => Date.now(),
  maxDistanceM = DEFAULT_MAX_DISTANCE_M,
  maxLiveAgeMs = DEFAULT_MAX_LIVE_AGE_MS,
  refreshIntervalMs = 15000,
} = {}) {
  if (!doc?.createElement)
    throw new TypeError('createSceneCamera requires a document');
  let records = Array.isArray(cameras) ? cameras.slice() : [];
  let currentScene = scene,
    state,
    destroyed = false,
    disposeButton = null;
  const make = (tag, className, value) => {
    const node = doc.createElement(tag);
    node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  };
  const root = make('section', 'scene-camera');
  root.setAttribute('aria-label', 'Relevant scene camera');
  const title = make('h3', 'scene-camera__title', 'Scene camera');
  const status = make('p', 'scene-camera__status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const content = make('div', 'scene-camera__content');
  root.append(title, status, content);
  const options = () => ({
    maxDistanceM,
    maxLiveAgeMs,
    now: typeof now === 'function' ? now() : now,
  });
  const distance = (m) =>
    m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;

  function render() {
    if (destroyed) return state;
    disposeButton?.();
    disposeButton = null;
    state = selectSceneCamera(currentScene, records, options());
    root.setAttribute('data-state', state.status);
    root.setAttribute('data-camera-status', state.selected?.status || 'none');
    content.replaceChildren();
    const selected = state.selected;
    if (!selected) {
      status.textContent = 'No relevant accessible camera';
      content.append(
        make(
          'p',
          'scene-camera__empty',
          !state.target
            ? 'No explicit scene location is available. No camera has been selected.'
            : 'No camera has verified location, coverage, access and usable media for this scene. Nearby does not mean covered.',
        ),
      );
      const near = state.candidates
        .filter((c) => c.distanceM !== null && c.distanceM <= maxDistanceM)
        .slice(0, 3);
      if (near.length) {
        content.append(
          make('p', 'scene-camera__note', 'Nearby candidates — not selected:'),
        );
        const list = make('ul', 'scene-camera__candidates');
        for (const c of near) {
          const item = make(
            'li',
            'scene-camera__candidate',
            `${c.name} (${c.id || 'no ID'}) · ${distance(c.distanceM)} · ${c.status.toUpperCase()} · ${c.provider}. ` +
              `Coverage: ${c.coverage.status}. Not selected: ${c.reasons.join(', ')}.`,
          );
          item.setAttribute('data-camera-status', c.status);
          list.append(item);
        }
        content.append(list);
      }
      return state;
    }
    status.textContent =
      selected.status === 'live'
        ? 'LIVE — recently verified'
        : 'RECORDED — not live';
    content.append(make('h4', 'scene-camera__name', selected.name));
    const details = make('dl', 'scene-camera__details');
    const rows = [
      ['Camera ID', selected.id],
      [
        'Location',
        `${selected.location.lat.toFixed(6)}, ${selected.location.lon.toFixed(6)}`,
      ],
      ['Distance to scene', distance(selected.distanceM)],
      ['Source', selected.provider],
      [
        'Status',
        selected.status === 'live'
          ? 'Live — current media activity verified'
          : 'Recorded media — not live',
      ],
      [
        'Coverage',
        'Within explicit verified coverage; line of sight is not independently confirmed',
      ],
      ['Access', 'Viewing and embedding explicitly permitted'],
      [
        'Last checked',
        selected.availability.checkedAt == null
          ? 'Not supplied'
          : String(selected.availability.checkedAt),
      ],
    ];
    for (const [label, value] of rows)
      details.append(
        make('dt', 'scene-camera__label', label),
        make('dd', 'scene-camera__value', value),
      );
    content.append(details);
    if (selected.sourceUrl) {
      const link = make(
        'a',
        'scene-camera__source',
        'Camera source / provenance',
      );
      link.setAttribute('href', selected.sourceUrl);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      content.append(link);
    }
    if (typeof onSelect === 'function') {
      const button = make('button', 'scene-camera__open', 'Open this camera');
      button.setAttribute('type', 'button');
      const click = () => {
        // Freshness/access can change while a button is displayed. Recheck first.
        const refreshed = render();
        if (refreshed.selected?.id === selected.id)
          onSelect(refreshed.selected, currentScene);
      };
      button.addEventListener('click', click);
      disposeButton = () => button.removeEventListener('click', click);
      content.append(button);
    }
    return state;
  }

  render();
  // Expire the LIVE label even when no new layer snapshot arrives. No network.
  const win = doc.defaultView;
  const interval =
    Number.isFinite(refreshIntervalMs) &&
    refreshIntervalMs > 0 &&
    win?.setInterval
      ? win.setInterval(render, refreshIntervalMs)
      : null;
  return {
    element: root,
    setScene(next, { cameras: nextCameras } = {}) {
      if (destroyed) return state;
      currentScene = next;
      if (nextCameras !== undefined)
        records = Array.isArray(nextCameras) ? nextCameras.slice() : [];
      return render();
    },
    updateCameras(next) {
      if (destroyed) return state;
      records = Array.isArray(next) ? next.slice() : [];
      return render();
    },
    getState: () => (destroyed ? state : render()),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (interval !== null) win.clearInterval(interval);
      disposeButton?.();
      disposeButton = null;
      records = [];
      currentScene = null;
      root.remove();
    },
  };
}
