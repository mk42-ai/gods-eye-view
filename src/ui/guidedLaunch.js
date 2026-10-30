/**
 * Guided launch (cycle 21, 2026-10-30) — replaces the four-card first-launch
 * modal (#first-run-launcher, removed from the markup) with:
 *   1. the calm launch (globe + AOI box only until a scene is built), and
 *   2. the Driver.js walkthrough (src/ui/walkthrough.js), which is loaded by
 *      dynamic import only when it actually runs, is skippable at every step,
 *      honours "Don't show this again" and can be replayed from the help button.
 * Share links skip the auto-start (their author already chose the view) but
 * keep the help button.
 */
import { installCalmLaunch } from './calmLaunch.js';
import { installWalkthrough } from './walkthrough.js';

export function initGuidedLaunch({
  styleManager,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  storage,
} = {}) {
  const hasShareState = Boolean(styleManager?.hasShareState);
  // Camera URL hashes persist across reloads (27 keys), so a restored camera is
  // NOT treated as a built scene: telemetry still waits for Build scene.
  const calm = installCalmLaunch({ document: documentRef, window: windowRef });
  let resolvedStorage = storage;
  if (resolvedStorage === undefined) {
    try {
      resolvedStorage = windowRef?.localStorage ?? null;
    } catch {
      resolvedStorage = null;
    }
  }
  const tour = installWalkthrough({
    document: documentRef,
    window: windowRef,
    storage: resolvedStorage,
    autoStart: !hasShareState,
  });
  return {
    calm,
    tour,
    destroy() {
      calm?.destroy();
      tour?.destroy();
    },
  };
}
