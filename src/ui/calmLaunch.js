/**
 * Calm launch (cycle 21, 2026-10-30).
 *
 * First load shows only the globe and the AOI box. Telemetry (VIIRS / EL / AIS
 * HUD readouts), the visual-preset and location trays, the right context rail
 * and the sync chips stay hidden until a scene has actually been built. CSS
 * keys off `body[data-scene-ready="true"]` (src/ui/styles/calm-launch.css).
 *
 * A scene counts as built when the incident composer dispatches either
 *   - `gev:scene-evidence`        (every in-AOI geographic scene build / reopen)
 *   - `gev:incident-scene-built`  (live incident ledger scene)
 * A share link that restores a camera state is treated as an already-built
 * view so its author's telemetry is not hidden.
 */
export const SCENE_READY_EVENTS = Object.freeze([
  'gev:scene-evidence',
  'gev:incident-scene-built',
]);

export function markSceneReady(documentRef = globalThis.document) {
  const body = documentRef?.body;
  if (!body || body.dataset.sceneReady === 'true') return false;
  body.dataset.sceneReady = 'true';
  return true;
}

export function installCalmLaunch({
  document: documentRef = globalThis.document,
  window: windowRef = globalThis.window,
  hasShareState = false,
  signal,
} = {}) {
  const body = documentRef?.body;
  if (!body) return null;
  body.dataset.calmLaunch = 'true';
  if (hasShareState) markSceneReady(documentRef);
  else if (body.dataset.sceneReady !== 'true') body.dataset.sceneReady = 'false';
  const onReady = () => markSceneReady(documentRef);
  for (const type of SCENE_READY_EVENTS) {
    windowRef?.addEventListener?.(type, onReady, signal ? { signal } : undefined);
  }
  return {
    isSceneReady: () => body.dataset.sceneReady === 'true',
    destroy() {
      for (const type of SCENE_READY_EVENTS) windowRef?.removeEventListener?.(type, onReady);
    },
  };
}
