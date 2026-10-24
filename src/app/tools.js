import { SceneDirector } from '../scenes/director.js';
import { createAoiScenePolicy } from '../scenes/aoiScenePolicy.js';
import { getUaeAoiIndex } from '../aoi/uaeInterest.js';
import { installIncidentScenes } from '../incidents/ui/index.js';
import { installGodsEye } from '../gods-eye/orchestrator.js';
import * as Cesium from 'cesium';
import { initAnnotations } from '../annotations/index.js';
import { initDrawTool } from '../annotations/drawTool.js';
import { createGevActionRunner } from '../voice/gevActions.js';
import { installScopeMask, destroyScopeMask } from '../scopeMask.js';
import { installEntityChat } from '../ondemand/entityChat.js';
import { installMiniChat } from '../ondemand/miniChat.js';
import { installPluginPanel } from '../ondemand/pluginPanel.js';
import {
  installRenderGovernor,
  getRenderGovernorDiagnostics,
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';

/** Attach scene tools, rendering listeners and the application debug handle. */
export function createApplicationTools({
  scene,
  controls,
  data,
  loadingScreen,
  placeSearch,
  voice = {},
  startChrome,
  onSceneDirector,
  sceneDataPacks,
  signal,
  defer,
}) {
  const { viewer, tileset, mapStackController, operations } = scene;
  const { styleManager, weatherEffects, cockpitCloudEffects } = controls;
  const { dataManager } = data;
  const sceneDirector = new SceneDirector(viewer, styleManager, dataManager, {
    dataPacks: sceneDataPacks,
    isMapStackAvailable: (id) =>
      mapStackController?.isStackAvailable(id) === true,
    // UAE AOI restriction (2026-10-22): only scenes inside Iran / Yemen /
    // Somalia / Hormuz / Bab el-Mandeb / UAE borders+waters / presence nodes
    // reach the panel and playback; the rest stay in storage with a reason.
    aoiPolicy: createAoiScenePolicy(getUaeAoiIndex()),
  });
  dataManager.layers
    .get('bhote-koshi-2026')
    ?.module.attachSceneController(sceneDirector);
  defer(() => sceneDirector.destroy());
  onSceneDirector?.(sceneDirector);
  const annotations = initAnnotations({
    viewer,
    tileset,
    placeSearch,
    resolver: operations.annotationResolver,
  });
  defer(() => {
    if (window.__gevAnnotations === annotations) delete window.__gevAnnotations;
    annotations.destroy();
  });
  // DISPLAY > Draw: the same whiteboard, drawn by hand. It claims the pointer
  // while a session is open, so its teardown belongs to the application
  // lifetime rather than to whoever last pressed the button.
  const drawTool = initDrawTool({ viewer, annotations });
  defer(() => drawTool?.destroy());
  if (startChrome)
    defer(startChrome({ loadingScreen, styleManager, dataManager, signal }));
  // Idle render governor: flips the scene into requestRenderMode whenever
  // nothing animates per frame. Installed AFTER every module above has had
  // its chance to register pre-install holds. (perf wave 2)
  installRenderGovernor(viewer);

  // Install the explicit scope mask used by the DISPLAY controls.
  installScopeMask(viewer);
  defer(() => destroyScopeMask());

  // The follow camera recomputes the tracked target's dead-reckon position
  // every frame — tracking anything is a per-frame animation. (perf wave 2)
  const removeTrackingListener = viewer.trackedEntityChanged.addEventListener(
    () => {
      if (viewer.trackedEntity) holdContinuousRender('tracked-entity');
      else releaseContinuousRender('tracked-entity');
    },
  );

  // Hidden-state suspension (perf wave 2): when the window/tab is hidden,
  // stop the default render loop outright — a hidden canvas repaints for
  // nobody, and browser rAF throttling still lets throttled frames burn
  // GPU. Holder/data state is untouched, so return is seamless: restore
  // the loop, refresh the one DOM surface we gated, render a frame.
  const syncVisibilitySuspension = () => {
    const hidden = document.hidden;
    viewer.useDefaultRenderLoop =
      !hidden && document.documentElement.dataset.renderState !== 'fallback';
    cockpitCloudEffects?.setSuspended?.(hidden);
    if (!hidden) {
      data.presentation.flushVisible();
      governorRequestRender('visibility-restore');
    }
  };
  document.addEventListener('visibilitychange', syncVisibilitySuspension);
  defer(() =>
    document.removeEventListener('visibilitychange', syncVisibilitySuspension),
  );
  defer(() => {
    removeTrackingListener();
    releaseContinuousRender('tracked-entity');
  });
  // Apply the CURRENT state too — bootstrap can complete while the tab is
  // already hidden, and waiting for the next transition would leave the
  // loop burning behind a hidden tab. (perf wave 2 fix)
  syncVisibilitySuspension();

  window.__godsEyeView = {
    viewer,
    styleManager,
    tileset,
    dataManager,
    sceneDirector,
    mapStackController,
    annotations,
    weatherEffects,
    cockpitCloudEffects,
    getRenderGovernorDiagnostics,
    surfaceServices: operations.surface,
    requestRender: governorRequestRender,
  };
  const debug = window.__godsEyeView;
  defer(() => {
    if (window.__godsEyeView === debug) delete window.__godsEyeView;
  });
  // ASK ONDEMAND — per-entity mini chatbot on a selected aircraft / vessel /
  // satellite (src/ondemand/entityChat.js, docs/ENTITY_CHAT.md). Follows the
  // tracking layers' selection lanes; tears itself down on the app signal.
  // `__godsEyeView.entityChat.openFirstVisible('aircraft')` drives it headless.
  debug.entityChat = installEntityChat({ viewer, dataManager, signal });
  // ASK ONDEMAND for every other object type (earthquake, fire, traffic,
  // regional brief, HUD summary, provider badge, graph node/edge, …) on the
  // server-key-only /api/ondemand/v2 foundation (src/ondemand/miniChat.js).
  // Any widget opens it with `gev:ask-object` or createAskOnDemandButton().
  debug.miniChat = window.__workstation?.chat || installMiniChat({ signal });
  // PLUGINS panel (src/ondemand/pluginPanel.js): honest lifecycle badges from
  // GET /api/ondemand/v2/plugins and per-turn plugin selection consumed by the
  // mini chat (`getPluginIds`) and the voice pipeline. Mounted after the mini
  // chat so it can dock into the panel's header slot.
  debug.pluginPanel = installPluginPanel({ signal });
  // AOI incident scenes (2026-10-22): live incident ledger → scenes, map
  // markers + popovers with ASK ONDEMAND, AOI layer toggles + legend, and the
  // bottom "Type an incident…" composer (src/incidents/ui/*).
  debug.incidentScenes = installIncidentScenes({
    viewer,
    sceneDirector,
    signal,
  });
  // GODS-EYE scene engine (2026-10-23): prompt → AOI register → route agent →
  // S0..S4 fly-in → footage pipeline → ranked rail/timeline/player. Nothing
  // fetches, plays or flies until a prompt is built (HARD RULE §0); the
  // always-on LIVE FOOTAGE dock was removed. See docs/gods-eye/CONTRACTS.md.
  // A 2D-recovery engine (installed by the workstation while WebGL was not
  // ready) is replaced by the full 3D engine; stored scenes re-hydrate.
  if (window.__godsEye?.is2d) window.__godsEye.destroy();
  debug.godsEye = installGodsEye({
    viewer,
    Cesium,
    signal,
    sceneDirector,
    readShareLinks: () => styleManager?.shareLinkManager || null,
  });
  const runner = createGevActionRunner({
    ...voice,
    floorServices: operations.surface.groundFloor,
    annotationResolver: operations.annotationResolver,
    searchNavigation: operations.searchAndFlyTo,
    placeSearch,
    viewer,
    styleManager,
    dataManager,
    sceneDirector,
    annotations,
  });
  const voiceCommands = {
    runner,
    protocol: 'ondemand-voice',
    stop() {},
  };
  window.__gevVoiceCommands = voiceCommands;
  defer(() => {
    voiceCommands.stop();
    if (window.__gevVoiceCommands === voiceCommands)
      delete window.__gevVoiceCommands;
  });
  debug.voiceCommands = voiceCommands;
  return { sceneDirector, annotations, voiceCommands };
}
