/**
 * Grounded Q&A command contract — shared by the server Q&A service
 * (server/scene-plans/qa.js: model → validated commands) and the browser
 * executor (src/cinematic/qaExecutor.js: commands → runtime → confirmed diff).
 *
 * The model NEVER emits JavaScript; it emits one JSON object:
 *   { "answer": string, "commands": QaCommand[] }
 * Every command is validated here before execution, and success is reported
 * only after the runtime confirms the state change (scene-graph diff /
 * playback state / camera state read back).
 */
import { z } from 'zod';
import { ASSET_IDS } from './assetIds.js';
import { EntitySchema, ShotSchema, SHOT_TYPES } from './sceneSchema.js';

const id = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/);
const sec = z.number().finite().min(0).max(86400);

export const QA_COMMANDS = Object.freeze([
  'show_route_closed', // highlight closed routes + fly camera to the first one
  'follow_entity', // playback.follow(entityId) (e.g. "follow the lead runners")
  'camera_above_entity', // overhead_intelligence shot above an entity / selection
  'camera_above_selection',
  'replay_last_seconds', // seek(position - n) + play
  'replay_section', // seek(startSec) + play until endSec
  'show_evidence_source', // highlight entities whose provenance.sourceRef/evidence source matches
  'add_entity', // validated entity (illustrative, labelled)
  'remove_entity',
  'highlight_entity',
  'wide_aerial', // aerial_establishing shot over the scene bounds
  'change_camera', // arbitrary validated shot
  'set_camera_mode', // cinematic|follow|free
  'play',
  'pause',
  'seek',
  'set_speed',
  'explain_change', // no mutation: answer derived from history/provenance
  'none',
]);

const cmd = (name, shape = {}) =>
  z.object({ command: z.literal(name), ...shape }).strict();

export const QaCommandSchema = z.discriminatedUnion('command', [
  cmd('show_route_closed', { routeId: id.optional() }),
  cmd('follow_entity', {
    entityId: id,
    distanceM: z.number().min(5).max(5000).optional(),
  }),
  cmd('camera_above_entity', {
    entityId: id,
    heightM: z.number().min(20).max(5000).optional(),
  }),
  cmd('camera_above_selection', {
    heightM: z.number().min(20).max(5000).optional(),
  }),
  cmd('replay_last_seconds', { seconds: z.number().min(1).max(3600) }),
  cmd('replay_section', {
    startSec: sec,
    endSec: sec.optional(),
    shotType: z.enum(SHOT_TYPES).optional(),
    perspective: z
      .enum(['helicopter', 'street', 'overhead', 'default'])
      .optional(),
  }),
  cmd('show_evidence_source', {
    source: z.enum([
      'snapchat',
      'perplexity',
      'overpass',
      'osrm',
      'cctv',
      'generated',
      'user',
      'test_injection',
    ]),
  }),
  cmd('add_entity', {
    entity: EntitySchema,
    reason: z.string().max(200).optional(),
  }),
  cmd('remove_entity', { entityId: id }),
  cmd('highlight_entity', {
    entityId: id,
    alertState: z.number().int().min(1).max(4).optional(),
  }),
  cmd('wide_aerial', { heightM: z.number().min(100).max(20000).optional() }),
  cmd('change_camera', { shot: ShotSchema }),
  cmd('set_camera_mode', { mode: z.enum(['cinematic', 'follow', 'free']) }),
  cmd('play'),
  cmd('pause'),
  cmd('seek', { positionSec: sec }),
  cmd('set_speed', { speed: z.number().min(0.1).max(16) }),
  cmd('explain_change', { sinceVersion: z.number().int().min(0).optional() }),
  cmd('none', { reason: z.string().max(200).optional() }),
]);

export const QaResponseSchema = z
  .object({
    answer: z.string().min(1).max(2000),
    commands: z.array(QaCommandSchema).max(6).default([]),
  })
  .strict();

export function validateQaResponse(raw) {
  return QaResponseSchema.safeParse(raw);
}

/** Prompt fragment describing the JSON contract to the model. */
export const QA_COMMAND_SPEC = `Return ONE JSON object: {"answer": string (<=2000 chars, plain language, grounded ONLY in the supplied context; say when something is illustrative/hypothetical vs sourced), "commands": [ ...up to 6 ]}.
Allowed commands (exact shapes, no other keys):
{"command":"show_route_closed","routeId"?:id}
{"command":"follow_entity","entityId":id,"distanceM"?:5..5000}
{"command":"camera_above_entity","entityId":id,"heightM"?:20..5000}
{"command":"camera_above_selection","heightM"?:20..5000}
{"command":"replay_last_seconds","seconds":1..3600}
{"command":"replay_section","startSec":n,"endSec"?:n,"perspective"?:"helicopter|street|overhead|default"}
{"command":"show_evidence_source","source":"snapchat|perplexity|overpass|osrm|cctv|generated|user|test_injection"}
{"command":"add_entity","entity":{"id":"^[a-z][a-z0-9_.-]*$","assetId":one of [${ASSET_IDS.join(', ')}],"label":string<=48,"category":"person|crowd|police|responder|vehicle|aircraft|barrier|signage|sensor|effect|route|marker|alert|vessel","position":{"eastM":-5000..5000,"northM":-5000..5000},"behavior"?:{"type":"static|walk|run|drive|brake|turn|arrive|crowd_flow|fly|hover|orbit|patrol","speedMps"?:n,"path"?:[{"eastM","northM"}]},"uncertainty":"illustrative"},"reason"?:string}
{"command":"remove_entity","entityId":id}
{"command":"highlight_entity","entityId":id,"alertState"?:1..4}
{"command":"wide_aerial","heightM"?:100..20000}
{"command":"change_camera","shot":{"id","type":"${SHOT_TYPES.join('|')}","title","startSec","durationSec","subjectIds":[id],"distanceM"?,"pitchDeg"?,"headingDeg"?}}
{"command":"set_camera_mode","mode":"cinematic|follow|free"}
{"command":"play"} {"command":"pause"} {"command":"seek","positionSec":n} {"command":"set_speed","speed":0.1..16}
{"command":"explain_change","sinceVersion"?:n}
{"command":"none","reason"?:string}
Only reference entity/route ids that exist in the context. Never invent evidence or claim a command succeeded; the runtime confirms execution.`;

/**
 * Structured context sent with every question. Built in the browser from the
 * live runtime; kept compact (entities summarised, history tail).
 */
export function buildQaContext({
  scene,
  playback,
  camera,
  selectedEntityIds = [],
  toolResults = [],
  availableActions = QA_COMMANDS,
  evidenceLimit = 25,
  historyLimit = 20,
} = {}) {
  if (!scene) return null;
  const ent = (e) => ({
    id: e.id,
    label: e.label,
    category: e.category,
    assetId: e.assetId,
    count: e.count,
    position: {
      eastM: Math.round(e.position.eastM),
      northM: Math.round(e.position.northM),
    },
    behavior: e.behavior?.type || 'static',
    uncertainty: e.uncertainty,
    source:
      e.provenance?.kind +
      (e.provenance?.sourceRef ? `:${e.provenance.sourceRef}` : ''),
    ...(e.hypothetical ? { hypothetical: true } : {}),
    ...(e.highlight ? { highlight: true } : {}),
  });
  return {
    location: {
      name: scene.origin.name,
      lat: scene.origin.lat,
      lon: scene.origin.lon,
      approximate: scene.origin.approximate === true,
    },
    sceneId: scene.sceneId,
    sceneVersion: scene.sceneVersion,
    mode: scene.mode,
    title: scene.title,
    classification: scene.classification,
    durationSec: scene.timeline.durationSec,
    entities: scene.entities.slice(0, 120).map(ent),
    routes: scene.routes.map((r) => ({
      id: r.id,
      label: r.label,
      kind: r.kind,
      closed: r.closed,
      closedReason: r.closedReason || null,
      points: r.coordinates.length,
      uncertainty: r.uncertainty,
      source: r.provenance?.kind,
    })),
    shots: scene.shots.map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      startSec: s.startSec,
      durationSec: s.durationSec,
      subjectIds: s.subjectIds,
    })),
    beats: scene.timeline.beats.map((b) => ({
      atSec: b.atSec,
      title: b.title,
      entityIds: b.entityIds,
    })),
    effects: scene.effects.map((f) => ({
      id: f.id,
      type: f.type,
      entityId: f.entityId || null,
      hypothetical: f.hypothetical,
    })),
    evidence: scene.evidence.slice(0, evidenceLimit).map((v) => ({
      id: v.id,
      source: v.source,
      tier: v.tier,
      title: v.title || null,
      url: v.url || null,
      capturedAt: v.capturedAt || null,
      publishedAt: v.publishedAt || null,
      entityIds: v.entityIds,
    })),
    history: scene.history.slice(-historyLimit),
    selectedEntityIds,
    playback: playback || scene.playback,
    camera: camera || null,
    toolResults: toolResults.slice(0, 10),
    availableActions,
    citations: scene.provenance?.citations?.slice(0, 20) || [],
  };
}
