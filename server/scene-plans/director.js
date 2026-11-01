/**
 * Cinematic Director — generates structured cinematic scene specifications
 * by streaming NDJSON lines from OnDemand models, validating each line
 * incrementally, normalizing asset IDs, emitting typed SSE events,
 * and performing bounded repair rounds.
 *
 * Contract: src/cinematic/CONTRACT.md §A
 */
import { randomUUID } from 'node:crypto';
import {
  DIRECTOR_LINE_SPEC,
  parseDirectorLine,
  emptyScene,
  safeValidateCinematicScene,
  SCENARIO_TYPES,
  ENTITY_CATEGORIES,
  BEHAVIOR_TYPES,
  SHOT_TYPES,
  EFFECT_TYPES,
  EASINGS,
  DirectorLineSchema,
} from '../../src/cinematic/sceneSchema.js';
import {
  CINEMATIC_ASSETS,
  resolveAssetId,
} from '../../src/cinematic/assetIds.js';
import { RUNTIME_MODES } from '../../src/cinematic/events.js';
import {
  streamQuery as defaultStreamQuery,
  createNdjsonAccumulator,
} from '../ondemand/runtime/stream-adapter.js';

export class DirectorError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'DirectorError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Builds the grouped registered asset IDs string for the prompt.
 */
export function formatRegisteredAssetsByGroup() {
  const groups = {};
  for (const asset of CINEMATIC_ASSETS) {
    if (!groups[asset.category]) {
      groups[asset.category] = [];
    }
    groups[asset.category].push(asset.id);
  }
  return Object.entries(groups)
    .map(([cat, ids]) => `• ${cat}: ${ids.join(', ')}`)
    .join('\n');
}

/**
 * Builds the prompt for the Cinematic Director.
 */
export function buildDirectorPrompt({
  prompt,
  origin,
  researchedRoutes = [],
  scenarioHint,
  mode = RUNTIME_MODES.SIMULATION,
  durationHint = 60,
}) {
  const registeredAssets = formatRegisteredAssetsByGroup();

  const routeConstraint =
    researchedRoutes.length > 0
      ? `RESEARCHED ROUTES AVAILABLE:\n${JSON.stringify(researchedRoutes, null, 2)}\nRule: route.coordinates may ONLY be copied verbatim from these supplied researched routes.`
      : 'NO RESEARCHED ROUTES SUPPLIED: Do NOT emit any route lines. Entities must use local metre waypoints in `behavior.path` instead.';

  return [
    'You are the Live Cinematic Intelligence Director. You construct an incremental 3D cinematic scene by emitting streaming NDJSON lines.',
    '',
    'FRAMING & ETHICAL RULES:',
    '- ALL SCENES ARE ILLUSTRATIVE OR HYPOTHETICAL STAGING. Never present generated content as factual intelligence.',
    '- Police scenes must be NON-OPERATIONAL: show cordon perimeters, barriers, command post, and units arriving; do NOT depict tactical breach details, room layouts, or operational weapons tactics.',
    '- Air raid / conflict scenes: MUST be labelled "HYPOTHETICAL" on EVERY entity and effect label, and set `hypothetical: true` on every entity and effect line.',
    '- Uncertainty: set `uncertainty: "illustrative"` on all entities.',
    '',
    'SCENARIO SHAPE RULES:',
    '- marathon / crowd_event: runners with `run` behavior along path, spectators category `crowd` (sprite.crowd.spectators or sprite.crowd_zone), crowd barriers (sprite.barrier.crowd / sprite.barrier), cone clusters at closures (sprite.cone_cluster), moving traffic (sprite.vehicle.civilian_sedan / sprite.vehicle.city_bus with `drive` behavior), police motorcycles escorting (sprite.vehicle.police_motorcycle).',
    '- police_response: units with `drive` + `arrive` behaviors (sprite.vehicle.police_car, sprite.vehicle.police_motorcycle), officers/responders (sprite.person.police_officer, sprite.person.responder), cordon barriers (sprite.barrier or sprite.cordon_node), command post (sprite.command_post); waterfront scenes may add a marine patrol boat (sprite.vessel.marine_patrol, category vessel).',
    '- air_raid_hypothetical: aircraft (sprite.aircraft.fixed_wing or model.jet) with `fly` paths, simulated impact markers (sprite.marker.air_raid_impact_sim), smoke/fire effects (sprite.effect.smoke_fire), `hypothetical: true` on every entity and effect, labels must contain "HYPOTHETICAL".',
    '- Evidence: a verified social/CCTV record is a `marker` entity using sprite.evidence.pin_verified (verified) or sprite.sensor.cctv_feed (camera feed); never invent evidence entities without an evidence ref.',
    '',
    `ORIGIN: ${JSON.stringify(origin)}`,
    routeConstraint,
    '',
    'MANDATORY MINIMUMS:',
    '- At least 3 entities',
    '- At least 1 camera shot (first shot must be type "aerial_establishing" starting at startSec: 0)',
    '- At least 1 narrative beat',
    `- Timeline duration: approximately ${durationHint} seconds`,
    '',
    'REGISTERED ASSET IDS (Grouped by category — only use these IDs):',
    registeredAssets,
    '',
    'LINE SPECIFICATION:',
    DIRECTOR_LINE_SPEC,
    '',
    scenarioHint ? `SCENARIO HINT: ${scenarioHint}` : '',
    `USER REQUEST: ${prompt}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Normalizes entity parameters before schema validation.
 */
function normalizeEntity(entity, assetSubstitutions) {
  if (!entity || typeof entity !== 'object') return entity;
  const e = { ...entity };

  // Asset ID resolution
  const resolved = resolveAssetId(e.assetId);
  if (resolved.substituted) {
    assetSubstitutions.push({
      requested: resolved.requested,
      used: resolved.asset.id,
      reason: resolved.reason || `mapped to ${resolved.asset.id}`,
    });
    e.assetId = resolved.asset.id;
  } else {
    e.assetId = resolved.asset.id;
  }

  // ID & Label
  if (typeof e.id !== 'string' || !/^[a-z][a-z0-9_.-]{0,63}$/.test(e.id)) {
    e.id = `ent_${Math.random().toString(36).slice(2, 8)}`;
  }
  if (typeof e.label !== 'string' || !e.label.trim()) {
    e.label = 'Entity';
  } else if (e.label.length > 48) {
    e.label = e.label.slice(0, 48);
  }

  // Position clamping
  e.position = {
    eastM: Math.max(-5000, Math.min(5000, Number(e.position?.eastM) || 0)),
    northM: Math.max(-5000, Math.min(5000, Number(e.position?.northM) || 0)),
    ...(e.position?.heightM != null
      ? {
          heightM: Math.max(
            -100,
            Math.min(5000, Number(e.position.heightM) || 0),
          ),
        }
      : {}),
    ...(e.position?.clampToGround != null
      ? { clampToGround: Boolean(e.position.clampToGround) }
      : {}),
  };

  // Defaults
  e.uncertainty = e.uncertainty || 'illustrative';
  e.provenance = e.provenance || { kind: 'generated' };
  if (e.scale != null) e.scale = Math.max(0.05, Math.min(50, Number(e.scale)));
  if (e.count != null)
    e.count = Math.max(1, Math.min(500, Math.round(Number(e.count))));
  if (e.spreadM != null)
    e.spreadM = Math.max(0, Math.min(500, Number(e.spreadM)));
  if (e.headingDeg != null)
    e.headingDeg = Math.max(-360, Math.min(360, Number(e.headingDeg)));
  if (e.startSec != null)
    e.startSec = Math.max(0, Math.min(86400, Number(e.startSec)));
  if (e.endSec != null)
    e.endSec = Math.max(0, Math.min(86400, Number(e.endSec)));

  if (e.behavior && typeof e.behavior === 'object') {
    const b = { ...e.behavior };
    if (b.speedMps != null)
      b.speedMps = Math.max(0, Math.min(400, Number(b.speedMps)));
    if (b.orbitRadiusM != null)
      b.orbitRadiusM = Math.max(1, Math.min(5000, Number(b.orbitRadiusM)));
    if (b.altitudeM != null)
      b.altitudeM = Math.max(0, Math.min(5000, Number(b.altitudeM)));
    if (b.headingDeg != null)
      b.headingDeg = Math.max(-360, Math.min(360, Number(b.headingDeg)));
    if (Array.isArray(b.path)) {
      b.path = b.path.map((wp) => ({
        eastM: Math.max(-5000, Math.min(5000, Number(wp.eastM) || 0)),
        northM: Math.max(-5000, Math.min(5000, Number(wp.northM) || 0)),
        ...(wp.heightM != null
          ? { heightM: Math.max(-100, Math.min(5000, Number(wp.heightM) || 0)) }
          : {}),
        ...(wp.atSec != null
          ? { atSec: Math.max(0, Math.min(86400, Number(wp.atSec) || 0)) }
          : {}),
      }));
    }
    e.behavior = b;
  }

  return e;
}

export function createCinematicDirector({
  registry,
  sessions,
  streamQuery = defaultStreamQuery,
  now = () => Date.now(),
  log = (entry) => console.info('[cinematic-director]', JSON.stringify(entry)),
} = {}) {
  async function direct({
    prompt,
    origin,
    researchedRoutes = [],
    scenarioHint,
    mode = RUNTIME_MODES.SIMULATION,
    durationHint = 60,
    sceneId: callerSceneId,
    runId: callerRunId,
    endpointId: callerEndpointId,
    signal,
    emit = () => {},
    repairBudget = 1,
  }) {
    const runId = callerRunId || `run-${randomUUID()}`;
    const sceneId = callerSceneId || `scene-${randomUUID()}`;

    // 1. Pick or verify model
    let modelInfo = null;
    if (callerEndpointId) {
      const avail = await registry.isAvailable(callerEndpointId);
      if (avail) {
        const listRes = await registry.list();
        modelInfo =
          listRes.models?.find((m) => m.endpointId === callerEndpointId) ||
          null;
      }
      // An explicit selection that the LIVE registry does not list as active
      // is a hard failure: never silently substitute another model (the UI
      // would otherwise report success with a model the user did not pick).
      if (!modelInfo) {
        throw new DirectorError(
          'model_unavailable',
          `Requested endpoint ${String(callerEndpointId).slice(0, 80)} is not available in the live OnDemand registry.`,
          { endpointId: String(callerEndpointId).slice(0, 80) },
        );
      }
    }

    if (!modelInfo) {
      modelInfo = await registry.pickForTask('scene_direction');
    }

    if (!modelInfo) {
      throw new DirectorError(
        'model_unavailable',
        'No scene direction model is available.',
      );
    }

    emit('model.selected', {
      endpointId: modelInfo.endpointId,
      modelId: modelInfo.modelId,
      provider: modelInfo.provider,
      cerebras: Boolean(modelInfo.cerebras),
      reason: callerEndpointId ? 'caller_override' : 'task_default',
    });

    const reasoningEffort =
      Array.isArray(modelInfo.reasoningEfforts) &&
      modelInfo.reasoningEfforts.includes('low')
        ? 'low'
        : undefined;

    // 2. Acquire session
    const session = await sessions.acquire({
      purpose: 'director',
      signal,
    });

    const assetSubstitutions = [];
    const invalidLines = [];
    let receivedTitle = null;
    let receivedClassification = null;
    let receivedTimeline = null;
    const collectedEntities = [];
    const collectedRoutes = [];
    const collectedShots = [];
    const collectedBeats = [];
    const collectedEffects = [];
    let firstDeltaEmitted = false;

    function processParsedLine(parsedLine) {
      switch (parsedLine.kind) {
        case 'classification':
          receivedClassification = parsedLine.classification;
          receivedTitle = parsedLine.title;
          emit('scene.patch', {
            patch: {
              patchId: `patch-${randomUUID()}`,
              sceneId,
              baseVersion: 0,
              ops: [
                {
                  op: 'set_classification',
                  classification: parsedLine.classification,
                },
                { op: 'set_title', title: parsedLine.title },
              ],
              reason: 'director classification',
              source: 'director',
            },
          });
          break;
        case 'timeline':
          receivedTimeline = parsedLine.durationSec;
          break;
        case 'entity':
          collectedEntities.push(parsedLine.entity);
          emit('scene.object.created', { entity: parsedLine.entity });
          break;
        case 'route':
          collectedRoutes.push(parsedLine.route);
          emit('scene.object.created', { route: parsedLine.route });
          break;
        case 'effect':
          collectedEffects.push(parsedLine.effect);
          emit('scene.object.created', { effect: parsedLine.effect });
          break;
        case 'shot':
          collectedShots.push(parsedLine.shot);
          emit('scene.patch', {
            patch: {
              patchId: `patch-${randomUUID()}`,
              sceneId,
              baseVersion: 0,
              ops: [{ op: 'add_shot', shot: parsedLine.shot }],
              reason: 'director shot',
              source: 'director',
            },
          });
          break;
        case 'beat':
          collectedBeats.push(parsedLine.beat);
          emit('scene.patch', {
            patch: {
              patchId: `patch-${randomUUID()}`,
              sceneId,
              baseVersion: 0,
              ops: [{ op: 'add_timeline_event', beat: parsedLine.beat }],
              reason: 'director beat',
              source: 'director',
            },
          });
          break;
        case 'note':
        case 'end':
          break;
      }
    }

    function handleRawLine(rawLineText) {
      let rawObj;
      try {
        rawObj = JSON.parse(rawLineText);
      } catch (err) {
        invalidLines.push({
          error: `invalid JSON: ${err.message}`,
          line: rawLineText,
        });
        return;
      }

      if (rawObj?.kind === 'entity' && rawObj.entity) {
        rawObj.entity = normalizeEntity(rawObj.entity, assetSubstitutions);
      }

      const parseRes = DirectorLineSchema.safeParse(rawObj);
      if (parseRes.success) {
        processParsedLine(parseRes.data);
      } else {
        invalidLines.push({
          error: parseRes.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
          line: rawObj,
        });
      }
    }

    let streamResult;
    try {
      const directorPrompt = buildDirectorPrompt({
        prompt,
        origin,
        researchedRoutes,
        scenarioHint,
        mode,
        durationHint,
      });

      const accumulator = createNdjsonAccumulator((line) => {
        handleRawLine(line);
      });

      streamResult = await streamQuery({
        sessionId: session.id,
        query: directorPrompt,
        endpointId: modelInfo.endpointId,
        fulfillmentOnly: true,
        reasoningEffort,
        modelConfigs: {
          temperature: 0.2,
        },
        signal,
        onDelta: (text) => {
          if (!firstDeltaEmitted) {
            firstDeltaEmitted = true;
            emit('scene.planning', { prompt, origin, mode });
          }
          emit('answer.delta', { text });
          accumulator.feed(text);
        },
      });

      accumulator.flush();
      emit('answer.completed', { deltas: streamResult.deltas });

      // 3. Check for repair requirement
      let repairs = 0;
      const needsRepair =
        repairBudget > 0 &&
        (collectedEntities.length < 3 ||
          collectedShots.length < 1 ||
          collectedBeats.length < 1 ||
          invalidLines.length > 0);

      if (needsRepair) {
        repairs++;
        const missing = [];
        if (collectedEntities.length < 3) {
          missing.push(
            `At least ${3 - collectedEntities.length} more entity lines`,
          );
        }
        if (collectedShots.length < 1) {
          missing.push(
            'At least 1 shot line (aerial_establishing at startSec: 0)',
          );
        }
        if (collectedBeats.length < 1) {
          missing.push('At least 1 beat line');
        }
        if (invalidLines.length > 0) {
          missing.push(
            `Fix ${invalidLines.length} invalid line(s): ${invalidLines
              .map((i) => i.error)
              .join(' | ')
              .slice(0, 300)}`,
          );
        }

        const repairPrompt = [
          'Re-emit ONLY the following corrected/missing lines in strict NDJSON format (one JSON object per line, no prose, no markdown fences):',
          ...missing.map((m) => `- ${m}`),
          'Follow the DIRECTOR_LINE_SPEC exactly.',
        ].join('\n');

        const repairAccumulator = createNdjsonAccumulator((line) => {
          handleRawLine(line);
        });

        await streamQuery({
          sessionId: session.id,
          query: repairPrompt,
          endpointId: modelInfo.endpointId,
          fulfillmentOnly: true,
          reasoningEffort,
          modelConfigs: {
            temperature: 0.2,
          },
          signal,
          onDelta: (text) => {
            emit('answer.delta', { text });
            repairAccumulator.feed(text);
          },
        });

        repairAccumulator.flush();
      }

      // 4. Build and validate final scene document
      const scene = emptyScene({
        sceneId,
        runId,
        origin,
        mode,
        title:
          receivedTitle || (prompt ? prompt.slice(0, 100) : 'Cinematic Scene'),
        durationSec: receivedTimeline || durationHint,
      });

      if (receivedClassification) {
        scene.classification = {
          ...scene.classification,
          ...receivedClassification,
        };
      }

      scene.entities = collectedEntities;
      scene.routes = collectedRoutes;
      scene.effects = collectedEffects;
      scene.shots = collectedShots.sort((a, b) => a.startSec - b.startSec);
      scene.timeline.beats = collectedBeats.sort((a, b) => a.atSec - b.atSec);

      if (receivedTimeline) {
        scene.timeline.durationSec = receivedTimeline;
      } else if (scene.shots.length > 0) {
        const maxEnd = Math.max(
          ...scene.shots.map((s) => s.startSec + s.durationSec),
        );
        scene.timeline.durationSec = Math.max(
          scene.timeline.durationSec,
          maxEnd,
        );
      }

      // Collect registered asset IDs
      scene.assetIds = Array.from(
        new Set(scene.entities.map((e) => e.assetId)),
      );

      scene.provenance = {
        model: {
          endpointId: modelInfo.endpointId,
          modelId: modelInfo.modelId,
          provider: modelInfo.provider,
          latencyMs: streamResult.totalMs,
          ttftMs: streamResult.ttftMs,
          tokensPerSec: streamResult.tokensPerSec ?? undefined,
          outputTokens: streamResult.outputTokens ?? undefined,
        },
        citations: [],
        generatedAt: new Date(now()).toISOString(),
        assetSubstitutions,
        validationRepairs: repairs,
      };

      const validResult = safeValidateCinematicScene(scene);
      if (!validResult.success) {
        const issuesSummary = validResult.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw new DirectorError(
          'director_invalid',
          `Cinematic scene validation failed: ${issuesSummary}`,
          { issues: validResult.error.issues },
        );
      }

      return {
        scene: validResult.data,
        model: {
          endpointId: modelInfo.endpointId,
          modelId: modelInfo.modelId,
          provider: modelInfo.provider,
          ttftMs: streamResult.ttftMs,
          tokensPerSec: streamResult.tokensPerSec,
          outputTokens: streamResult.outputTokens,
          visibleChars: streamResult.visibleChars,
          visibleTokensEst: streamResult.visibleTokensEst,
          visibleTokensPerSecEst: streamResult.visibleTokensPerSecEst,
          deltas: streamResult.deltas,
          ...(streamResult.estimated ? { estimated: true } : {}),
          latencyMs: streamResult.totalMs,
        },
        invalidLines,
        repairs,
        assetSubstitutions,
      };
    } finally {
      sessions.release(session.id);
    }
  }

  return {
    direct,
  };
}
