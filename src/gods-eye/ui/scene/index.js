/**
 * @fileoverview Main orchestrator and installer for Gods-Eye scene UI components.
 * @module gods-eye/ui/scene/index
 */

import { formatDate } from '../../../footage/model.js';
import { POSTERS, posterForState, applyPosterTokens } from './posters.js';
import { createSceneHeader } from './header.js';
import { createFootageRail } from './rail.js';
import { formatDistanceText, formatDeltaText } from './railFormat.js';
import { createTimeline } from './timeline.js';
import { createScenePlayer } from './player.js';
import { createEvidenceStrip } from './evidence.js';
import { createMapLayers } from './mapLayers.js';

export {
  POSTERS,
  posterForState,
  createSceneHeader,
  createFootageRail,
  createTimeline,
  createScenePlayer,
  createEvidenceStrip,
  createMapLayers,
};

/**
 * Format rebuild archival banner text per spec.
 * @param {any} scene
 * @returns {string}
 */
export function formatRebuildBannerText(scene) {
  let earliest = scene?.tRef;
  if (Array.isArray(scene?.footage) && scene.footage.length > 0) {
    const dates = scene.footage
      .map((f) => f.uploadedAt || f.published_at)
      .filter(Boolean)
      .map((d) => Date.parse(d))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b);
    if (dates.length > 0) earliest = new Date(dates[0]).toISOString();
  }
  const dateStr = formatDate(earliest) || 'unknown';
  return `REBUILT FROM ARCHIVAL FOOTAGE — originally reported ${dateStr}`;
}

/**
 * Installs the Gods-Eye scene UI components into the DOM.
 * @param {object} params
 */
export function installSceneUi({
  document,
  window: win,
  store,
  viewer,
  Cesium,
  host,
  onSelectItem,
  onScrub,
  onHover,
}) {
  const root = document.createElement('section');
  root.id = 'ge-scene-root';
  root.className = 'ge-scene-root';
  root.hidden = true;
  // Poster artwork paths live in posters.js only; publish them as CSS tokens
  // (--ge-poster-*) so stylesheets never hard-code a path either.
  applyPosterTokens(document.documentElement);

  const mapLayers = createMapLayers({ viewer, Cesium });
  const header = createSceneHeader({ document });
  const evidence = createEvidenceStrip({ document });

  let currentScene = null;
  let currentStage = 'S2';
  let playlist = [];
  let playlistIndex = -1;

  const player = createScenePlayer({
    document,
    window: win,
    onEnded: () => {
      if (playlist.length > 0 && playlistIndex < playlist.length - 1) {
        playlistIndex++;
        handleSelectItem(playlist[playlistIndex]);
      }
    },
  });

  const timeline = createTimeline({
    document,
    onScrub: (scrubWindow) => {
      onScrub?.(scrubWindow);
      if (scrubWindow) {
        const fromMs = Date.parse(scrubWindow.from);
        const toMs = Date.parse(scrubWindow.to);
        const filterFn = (it) => {
          const t = Date.parse(it.uploadedAt || it.published_at || 0);
          return t >= fromMs && t <= toMs;
        };
        rail.setFilter(filterFn);
        mapLayers.setFilter(filterFn);
      } else {
        rail.setFilter(null);
        mapLayers.setFilter(null);
      }
    },
    onPlay: (ordered) => {
      playlist = ordered;
      playlistIndex = 0;
      if (playlist.length > 0) handleSelectItem(playlist[0]);
    },
  });

  let armedItem = null;
  const playerEl = player.element;
  const playArmed = () => {
    if (armedItem && playerEl.dataset.playing !== '1')
      handleSelectItem(armedItem);
  };
  playerEl.addEventListener?.('click', playArmed);
  playerEl.addEventListener?.('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') playArmed();
  });
  if (playerEl.setAttribute) playerEl.setAttribute('tabindex', '0');

  const rail = createFootageRail({
    document,
    window: win,
    onSelect: (item) => handleSelectItem(item),
    onHover: (id) => {
      onHover?.(id);
      mapLayers.pulse(id);
    },
  });

  root.append(
    header.element,
    player.element,
    timeline.element,
    evidence.element,
    rail.element,
  );
  (host || document.body).appendChild(root);

  function handleSelectItem(item) {
    if (!item) return;
    rail.setSelected(item.id);
    onSelectItem?.(item);
    player.playNow(item, currentScene);
    player.setOverlay({
      distanceText: formatDistanceText(item.distanceKm),
      deltaText: formatDeltaText(
        item.timeDelta,
        currentScene?.kind,
        item.uploadedAt,
      ),
      recency: item.recency,
      uploadedAt: item.uploadedAt,
    });
  }

  function applyStageGating(stage, scene) {
    currentStage = stage;
    mapLayers.setStage(stage);
    header.element.dataset.stage = stage;

    if (['S2', 'S3', 'S4'].includes(stage)) {
      header.update(scene);
      evidence.update(scene);
    }
    if (stage === 'S4') {
      rail.show();
      timeline.setScene(scene, scene.footage);
    } else {
      rail.hide();
    }
  }

  let posterOverride = null;
  let lastSceneId = null;
  function updateScene(scene) {
    const previous = currentScene;
    currentScene = scene;
    if (!scene) {
      root.hidden = true;
      player.stop();
      if (previous?.id) mapLayers.clear(previous.id);
      lastSceneId = null;
      currentStage = 'S0';
      return;
    }
    root.hidden = false;
    if (scene.id !== lastSceneId) {
      // scene switch: scene A artefacts never survive into scene B
      if (lastSceneId) mapLayers.clear(lastSceneId);
      player.stop();
      posterOverride = null;
      playlist = [];
      playlistIndex = -1;
      currentStage = 'S0';
      lastSceneId = scene.id;
    }
    // The live stage comes from the camera controller (setStage); a stored
    // scene opened straight at S4 carries it in scene.camera.stage.
    const stage =
      currentStage === 'S0' && scene.camera?.stage && scene.status !== 'flying'
        ? scene.camera.stage
        : currentStage;

    player.setPoster(posterOverride || posterForState(scene));
    player.showBanner(
      scene.kind === 'rebuild' ? formatRebuildBannerText(scene) : null,
    );

    const visible = (scene.footage || []).filter((f) => !f.hidden);
    rail.setItems(visible, scene.kind);
    timeline.setScene(scene, visible);
    timeline.setAlerts?.(scene.route?.alerts || []);
    mapLayers.setScene(scene);
    mapLayers.setRoutes?.(scene.route?.groundRoutes || []);
    mapLayers.setItems(visible);

    applyStageGating(stage, scene);
  }

  function handleStoreChange() {
    if (!store?.getState) return;
    const state = store.getState();
    const activeId = state?.activeId;
    if (!activeId || !state?.scenes?.[activeId]) {
      updateScene(null);
      return;
    }
    updateScene(state.scenes[activeId]);
  }

  const unsubscribe = store?.subscribe
    ? store.subscribe(handleStoreChange)
    : () => {};
  if (store?.getState) handleStoreChange();

  return {
    destroy() {
      unsubscribe();
      player.stop();
      if (currentScene?.id) mapLayers.clear(currentScene.id);
      root.remove();
    },
    elements: {
      root,
      header: header.element,
      rail: rail.element,
      timeline: timeline.element,
      player: player.element,
      evidence: evidence.element,
    },
    mapLayers,
    playNow(item) {
      handleSelectItem(item);
      return player.playNow(item, currentScene);
    },
    /** Select + arm a clip with no media request (Open / share restore). */
    arm(item) {
      if (!item) return;
      armedItem = item;
      rail.setSelected(item.id);
      player.arm(item);
      player.setOverlay({
        distanceText: formatDistanceText(item.distanceKm),
        deltaText: formatDeltaText(
          item.timeDelta,
          currentScene?.kind,
          item.uploadedAt,
        ),
        recency: item.recency,
        uploadedAt: item.uploadedAt,
      });
    },
    setStage(stage) {
      if (currentScene) applyStageGating(stage, currentScene);
    },
    setBanner(text) {
      player.showBanner(text);
    },
    /** Force a poster (loading / routeFallback / outsideRegister …); null resets. */
    setPoster(key, label) {
      posterOverride = key || null;
      player.setPoster(
        posterOverride || posterForState(currentScene || {}),
        label,
      );
    },
    setFilter(predicate) {
      rail.setFilter(predicate);
      mapLayers.setFilter(predicate);
    },
    stop() {
      player.stop();
    },
    currentStage: () => currentStage,
  };
}
