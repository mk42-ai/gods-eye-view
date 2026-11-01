/**
 * Live Intelligence Director
 *
 * Orchestrates incoming intelligence scene patches:
 *  - Validates patches against ScenePatchSchema
 *  - Applies patches via injected applyPatch or runtime.applyPatch
 *  - High-priority / high-relevance evidence triggers cameraDirector.interrupt
 *    with an 'overhead_intelligence' shot if autoDirect is enabled
 *  - Refused interrupts or lower-priority evidence are queued / annotated
 *  - Highlights newly added entities
 *  - Maintains a feed of intelligence events and queued camera shots
 *  - Never rewinds playback
 *  - Responds to SSE 'intelligence.received' events and emits 'intelligence.validated'
 */
import { safeValidateScenePatch } from './sceneSchema.js';

export function createLiveIntelligenceDirector({
  runtime = null,
  playback = null,
  cameraDirector = null,
  applyPatch = null,
  onEvent = () => {},
  autoDirect = true,
  now = () => Date.now(),
} = {}) {
  let _autoDirect = Boolean(autoDirect);
  let interruptCount = 0;
  const feedEntries = [];
  const queuedShots = [];

  const doApplyPatch =
    applyPatch ||
    ((p) => {
      if (typeof runtime?.applyPatch === 'function') {
        return runtime.applyPatch(p);
      }
      return {
        scene: runtime?.scene?.() || null,
        applied: p.ops || [],
        rejected: [],
      };
    });

  const api = {
    setAutoDirect(bool) {
      _autoDirect = Boolean(bool);
    },

    autoDirect() {
      return _autoDirect;
    },

    receive({ patch, priority, relevance, source } = {}) {
      const valid = safeValidateScenePatch(patch);
      if (!valid.success) {
        return {
          applied: [],
          rejected: [
            {
              reason: 'invalid_patch',
              issues: valid.error.issues,
              message: valid.error.message,
            },
          ],
          camera: 'none',
          eventId: patch?.patchId || null,
          sceneVersion: patch?.baseVersion ?? 0,
        };
      }

      const safePatch = valid.data;
      const effPriority = priority || safePatch.priority || 'normal';
      const effRelevance =
        typeof relevance === 'number'
          ? relevance
          : effPriority === 'high'
            ? 0.9
            : 0.5;
      const effSource = source || safePatch.source || 'intelligence';

      const applyResult = doApplyPatch(safePatch);
      const applied = applyResult?.applied || [];
      const rejected = applyResult?.rejected || [];
      const newScene = applyResult?.scene;
      const sceneVersion = newScene?.sceneVersion ?? safePatch.baseVersion;

      // Extract entity IDs added in this patch
      const addedEntityIds = [];
      for (const op of applied) {
        if (op.op === 'add_entity' && op.entity?.id) {
          addedEntityIds.push(op.entity.id);
        }
      }
      // If ops were applied as safePatch.ops directly
      if (!addedEntityIds.length && applied.length) {
        for (const op of safePatch.ops) {
          if (op.op === 'add_entity' && op.entity?.id) {
            addedEntityIds.push(op.entity.id);
          }
        }
      }

      let camera = 'none';
      const shouldInterrupt =
        _autoDirect &&
        (effPriority === 'high' || effRelevance >= 0.7) &&
        addedEntityIds.length > 0;

      const currentSec =
        typeof playback?.positionSec === 'function'
          ? playback.positionSec()
          : 0;

      if (shouldInterrupt) {
        interruptCount += 1;
        const shot = {
          id: `li-${interruptCount}`,
          type: 'overhead_intelligence',
          title: 'Live intelligence',
          startSec: currentSec,
          durationSec: 8,
          subjectIds: addedEntityIds,
          distanceM: 350,
          pitchDeg: -70,
          priority: 90,
          interruptible: true,
          easing: 'ease_in_out',
          headingDeg: 0,
          headingDeltaDeg: 0,
        };

        const accepted = cameraDirector?.interrupt?.(shot, {
          reason: safePatch.reason || 'Live intelligence',
          priority: effPriority,
        });

        if (accepted) {
          camera = 'interrupted';
        } else {
          camera = 'queued';
          queuedShots.push({ shot, at: currentSec });
          // Still highlight even when interrupt is queued
          for (const id of addedEntityIds) {
            runtime?.setHighlight?.(id, true, 2);
          }
        }
      } else if (addedEntityIds.length > 0) {
        // Lower priority or autoDirect false -> annotate
        for (const id of addedEntityIds) {
          runtime?.setHighlight?.(id, true, 2);
        }
        camera = 'annotated';

        if (!_autoDirect && (effPriority === 'high' || effRelevance >= 0.7)) {
          interruptCount += 1;
          const shot = {
            id: `li-${interruptCount}`,
            type: 'overhead_intelligence',
            title: 'Live intelligence',
            startSec: currentSec,
            durationSec: 8,
            subjectIds: addedEntityIds,
            distanceM: 350,
            pitchDeg: -70,
            priority: 90,
            interruptible: true,
            easing: 'ease_in_out',
            headingDeg: 0,
            headingDeltaDeg: 0,
          };
          queuedShots.push({ shot, at: currentSec });
        }
      }

      // Record feed entry
      const tier =
        safePatch.ops.find((o) => o.evidence?.tier)?.evidence?.tier ||
        (effPriority === 'high' ? 'verified' : 'candidate');
      const summary =
        safePatch.label || safePatch.reason || `Intelligence from ${effSource}`;

      const tNow =
        typeof now === 'function'
          ? typeof now() === 'number'
            ? new Date(now()).toISOString()
            : now()
          : new Date().toISOString();

      const feedEntry = {
        at: tNow,
        source: effSource,
        summary,
        tier,
        camera,
        sceneVersion,
      };
      feedEntries.push(feedEntry);
      if (feedEntries.length > 200) feedEntries.shift();

      return {
        applied,
        rejected,
        camera,
        eventId: safePatch.patchId,
        sceneVersion,
      };
    },

    queue() {
      return [...queuedShots];
    },

    flushQueue() {
      const copy = [...queuedShots];
      queuedShots.length = 0;
      return copy;
    },

    feed() {
      return [...feedEntries];
    },

    onScenePatchEvent(sseEvent) {
      if (!sseEvent) return null;
      const isIntelReceived =
        sseEvent.event === 'intelligence.received' ||
        (sseEvent.event === 'scene.patch' &&
          sseEvent.data?.patch?.source === 'intelligence');

      if (!isIntelReceived) return null;

      const data = sseEvent.data || {};
      const patch = data.patch || data;
      const priority = data.priority;
      const relevance = data.relevance;
      const source = data.source || 'intelligence';

      const result = api.receive({ patch, priority, relevance, source });

      if (typeof onEvent === 'function') {
        onEvent('intelligence.validated', {
          runId: data.runId || null,
          sceneId: data.sceneId || patch?.sceneId || null,
          sceneVersion: result.sceneVersion,
          patchId: result.eventId,
          appliedCount: result.applied.length,
          rejectedCount: result.rejected.length,
          camera: result.camera,
          counts: {
            applied: result.applied.length,
            rejected: result.rejected.length,
          },
        });
      }

      return result;
    },
  };

  return api;
}
