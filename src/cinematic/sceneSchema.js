/**
 * Cinematic Scene Runtime schema (zod) — the authoritative, versioned scene
 * document that the Cinematic Director produces, the SSE reducer maintains,
 * the Cesium runtime renders and the Q&A commands mutate.
 *
 * Shared browser + Node (zod is already a dependency of src/scenes/sceneSpec.js).
 *
 * Design rules
 *  • Positions are LOCAL ENU metres from `origin` (eastM/northM/heightM) so the
 *    model never emits raw coordinates; GeoSceneContext converts them with
 *    Cesium.Transforms.eastNorthUpToFixedFrame. Real routes/evidence may carry
 *    WGS84 `coordinates` because they come from data sources, not the model.
 *  • Every asset reference is a registered id (src/cinematic/assetIds.js);
 *    unknown ids are substituted by `resolveAssetId` and logged — never invented.
 *  • `uncertainty` is mandatory on entities: 'illustrative' (generated staging),
 *    'approximate' (derived from a source with an inexact position),
 *    'verified' (sourced position + time). The renderer labels them differently.
 *  • Patches are the ONLY way the scene changes after `scene.initialized`.
 */
import { z } from 'zod';
import { ASSET_IDS } from './assetIds.js';
import { RUNTIME_MODES, RUN_STATES } from './events.js';

export const CINEMATIC_SCHEMA = 'gev-cinematic-scene';
export const CINEMATIC_SCHEMA_VERSION = 1;

const M = 5000; // radial placement bound (metres)
const label = (max) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .transform((s) => s.replace(/[\u0000-\u001f<>]/g, ''));
const id = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/);
const finite = (lo, hi) => z.number().finite().min(lo).max(hi);
const url = z
  .string()
  .url()
  .max(2000)
  .refine((u) => /^https?:/i.test(u));

export const SCENARIO_TYPES = Object.freeze([
  'police_response',
  'marathon',
  'traffic_incident',
  'crowd_event',
  'air_raid_hypothetical',
  'emergency_response',
  'motorcade',
  'observation',
  'custom',
]);
export const ENTITY_CATEGORIES = Object.freeze([
  'person',
  'crowd',
  'police',
  'responder',
  'vehicle',
  'aircraft',
  'barrier',
  'signage',
  'sensor',
  'effect',
  'route',
  'marker',
  'alert',
  'vessel',
]);
export const BEHAVIOR_TYPES = Object.freeze([
  'static',
  'walk',
  'run',
  'drive',
  'brake',
  'turn',
  'arrive',
  'crowd_flow',
  'fly',
  'hover',
  'orbit',
  'patrol',
]);
export const SHOT_TYPES = Object.freeze([
  'aerial_establishing',
  'street_level',
  'orbit',
  'tracking',
  'vehicle_follow',
  'overhead_intelligence',
  'close_up',
  'dolly',
  'pan',
  'tilt',
  'fly_through',
]);
export const EASINGS = Object.freeze([
  'linear',
  'ease_in_out',
  'ease_out',
  'ease_in',
]);
export const EFFECT_TYPES = Object.freeze([
  'dust',
  'smoke',
  'fire',
  'emergency_lights',
  'haze',
  'weather_rain',
  'weather_fog',
  'lighting_transition',
  'highlight_pulse',
]);
export const UNCERTAINTY = Object.freeze([
  'illustrative',
  'approximate',
  'verified',
]);
export const EVIDENCE_SOURCES = Object.freeze([
  'snapchat',
  'perplexity',
  'overpass',
  'osrm',
  'nominatim',
  'cctv',
  'user',
  'test_injection',
  'other',
]);

export const LocalPositionSchema = z
  .object({
    eastM: finite(-M, M),
    northM: finite(-M, M),
    heightM: finite(-100, 5000).optional(), // above local ground; omitted = clamp
    clampToGround: z.boolean().optional(),
  })
  .strict();

export const WaypointSchema = LocalPositionSchema.extend({
  atSec: finite(0, 86400).optional(),
}).strict();

export const BehaviorSchema = z
  .object({
    type: z.enum(BEHAVIOR_TYPES),
    speedMps: finite(0, 400).optional(),
    path: z.array(WaypointSchema).max(400).optional(),
    loop: z.boolean().optional(),
    followEntityId: id.optional(),
    orbitRadiusM: finite(1, M).optional(),
    altitudeM: finite(0, 5000).optional(),
    headingDeg: finite(-360, 360).optional(),
  })
  .strict();

export const ProvenanceSchema = z
  .object({
    kind: z.enum(['generated', 'evidence', 'research', 'user', 'test']),
    sourceRef: z.string().max(200).optional(),
    evidenceId: id.optional(),
    url: url.optional(),
    tier: z.enum(['verified', 'candidate']).optional(),
    note: z.string().max(240).optional(),
  })
  .strict();

export const EntitySchema = z
  .object({
    id,
    assetId: z.enum(ASSET_IDS),
    label: label(48),
    category: z.enum(ENTITY_CATEGORIES),
    role: z.string().max(40).optional(),
    position: LocalPositionSchema,
    headingDeg: finite(-360, 360).default(0),
    scale: finite(0.05, 50).default(1),
    count: z.number().int().min(1).max(500).default(1),
    spreadM: finite(0, 500).default(0),
    behavior: BehaviorSchema.default({ type: 'static' }),
    startSec: finite(0, 86400).default(0),
    endSec: finite(0, 86400).nullable().default(null),
    uncertainty: z.enum(UNCERTAINTY).default('illustrative'),
    provenance: ProvenanceSchema.default({ kind: 'generated' }),
    highlight: z.boolean().default(false),
    alertState: z.number().int().min(1).max(4).optional(),
    hypothetical: z.boolean().default(false),
    tags: z.array(z.string().max(32)).max(12).default([]),
  })
  .strict();

export const RouteSchema = z
  .object({
    id,
    label: label(48),
    kind: z.enum([
      'race_route',
      'approach',
      'egress',
      'cordon',
      'road_segment',
      'flight_path',
      'other',
    ]),
    coordinates: z
      .array(z.tuple([finite(-180, 180), finite(-90, 90)]))
      .min(2)
      .max(5000),
    closed: z.boolean().default(false),
    closedReason: z.string().max(240).optional(),
    provenance: ProvenanceSchema.default({ kind: 'generated' }),
    uncertainty: z.enum(UNCERTAINTY).default('illustrative'),
  })
  .strict();

export const ShotSchema = z
  .object({
    id,
    type: z.enum(SHOT_TYPES),
    title: label(60),
    startSec: finite(0, 86400),
    durationSec: finite(0.5, 3600),
    subjectIds: z.array(id).max(20).default([]),
    focus: LocalPositionSchema.optional(),
    distanceM: finite(2, 50000).default(400),
    pitchDeg: finite(-89.9, 10).default(-35),
    headingDeg: finite(-360, 360).default(0),
    headingDeltaDeg: finite(-720, 720).default(0),
    heightM: finite(1, 20000).optional(),
    easing: z.enum(EASINGS).default('ease_in_out'),
    priority: z.number().int().min(0).max(100).default(50),
    interruptible: z.boolean().default(true),
  })
  .strict();

export const BeatSchema = z
  .object({
    atSec: finite(0, 86400),
    title: label(80),
    narration: z.string().max(600).default(''),
    entityIds: z.array(id).max(50).default([]),
    evidenceIds: z.array(id).max(20).default([]),
  })
  .strict();

export const EffectSchema = z
  .object({
    id,
    type: z.enum(EFFECT_TYPES),
    entityId: id.optional(),
    position: LocalPositionSchema.optional(),
    startSec: finite(0, 86400).default(0),
    endSec: finite(0, 86400).nullable().default(null),
    intensity: finite(0, 1).default(0.6),
    hypothetical: z.boolean().default(false),
  })
  .strict();

export const EvidenceSchema = z
  .object({
    id,
    source: z.enum(EVIDENCE_SOURCES),
    title: z.string().max(300).optional(),
    url: url.optional(),
    tier: z.enum(['verified', 'candidate']).default('candidate'),
    capturedAt: z.string().max(80).nullable().optional(),
    publishedAt: z.string().max(80).nullable().optional(),
    retrievedAt: z.string().max(80).optional(),
    lat: finite(-90, 90).nullable().optional(),
    lon: finite(-180, 180).nullable().optional(),
    locationText: z.string().max(200).optional(),
    entityIds: z.array(id).max(50).default([]),
    sourceId: z.string().max(200).optional(),
    note: z.string().max(400).optional(),
  })
  .strict();

export const OriginSchema = z
  .object({
    name: label(200),
    lat: finite(-90, 90),
    lon: finite(-180, 180),
    heightM: finite(-500, 9000).default(0),
    terrainSampled: z.boolean().default(false),
    approximate: z.boolean().default(false),
    precision: z.string().max(40).optional(),
    confidence: finite(0, 1).optional(),
    sourceUrl: url.optional(),
    geocoder: z.string().max(120).optional(),
  })
  .strict();

export const ClassificationSchema = z
  .object({
    scenarioType: z.enum(SCENARIO_TYPES),
    intent: z.string().max(400),
    hypothetical: z.boolean().default(false),
    geographicConstraints: z.array(z.string().max(160)).max(12).default([]),
    labels: z.array(z.string().max(60)).max(12).default([]),
    uncertaintyNote: z.string().max(400).default(''),
  })
  .strict();

export const PlaybackSchema = z
  .object({
    state: z.enum(['stopped', 'playing', 'paused']).default('stopped'),
    positionSec: finite(0, 86400).default(0),
    speed: finite(0.1, 16).default(1),
    cameraMode: z.enum(['cinematic', 'follow', 'free']).default('cinematic'),
    followEntityId: id.nullable().default(null),
    live: z.boolean().default(false),
  })
  .strict();

export const HistoryEntrySchema = z
  .object({
    sceneVersion: z.number().int().min(0),
    at: z.string().max(80),
    op: z.string().max(60),
    reason: z.string().max(400).optional(),
    source: z.string().max(60).optional(),
    patchId: z.string().max(80).optional(),
  })
  .strict();

export const CinematicSceneSchema = z
  .object({
    schema: z.literal(CINEMATIC_SCHEMA),
    schemaVersion: z.literal(CINEMATIC_SCHEMA_VERSION),
    sceneId: z.string().min(4).max(120),
    sceneVersion: z.number().int().min(0),
    runId: z.string().max(120).optional(),
    mode: z.enum(Object.values(RUNTIME_MODES)),
    title: label(120),
    origin: OriginSchema,
    boundsRadiusM: finite(50, 20000).default(1500),
    classification: ClassificationSchema,
    assetIds: z.array(z.enum(ASSET_IDS)).max(64).default([]),
    entities: z.array(EntitySchema).max(400).default([]),
    routes: z.array(RouteSchema).max(60).default([]),
    shots: z.array(ShotSchema).max(40).default([]),
    timeline: z
      .object({
        durationSec: finite(5, 3600),
        beats: z.array(BeatSchema).max(60).default([]),
      })
      .strict(),
    effects: z.array(EffectSchema).max(60).default([]),
    evidence: z.array(EvidenceSchema).max(500).default([]),
    provenance: z
      .object({
        model: z
          .object({
            endpointId: z.string().max(120).optional(),
            modelId: z.string().max(120).optional(),
            provider: z.string().max(60).optional(),
            latencyMs: z.number().int().min(0).optional(),
            ttftMs: z.number().int().min(0).optional(),
            tokensPerSec: z.number().min(0).optional(),
            outputTokens: z.number().int().min(0).optional(),
          })
          .strict()
          .optional(),
        citations: z
          .array(
            z.object({ url, title: z.string().max(300).optional() }).strict(),
          )
          .max(60)
          .default([]),
        generatedAt: z.string().max(80).optional(),
        assetSubstitutions: z
          .array(
            z
              .object({
                requested: z.string().max(120),
                used: z.string().max(120),
                reason: z.string().max(240),
              })
              .strict(),
          )
          .max(200)
          .default([]),
        validationRepairs: z.number().int().min(0).default(0),
      })
      .strict()
      .default({}),
    history: z.array(HistoryEntrySchema).max(500).default([]),
    playback: PlaybackSchema.default({}),
    illustrative: z.literal(true).default(true),
  })
  .strict();

// ----------------------------------------------------------------- patches

const op = (name, shape) =>
  z.object({ op: z.literal(name), ...shape }).strict();

export const PatchOpSchema = z.discriminatedUnion('op', [
  op('add_entity', { entity: EntitySchema }),
  op('remove_entity', { entityId: id }),
  op('update_entity', {
    entityId: id,
    changes: EntitySchema.partial().omit({ id: true }),
  }),
  op('animate_entity', { entityId: id, behavior: BehaviorSchema }),
  op('reposition_entity', {
    entityId: id,
    position: LocalPositionSchema,
    headingDeg: finite(-360, 360).optional(),
  }),
  op('highlight_entity', {
    entityId: id,
    highlight: z.boolean().default(true),
    alertState: z.number().int().min(1).max(4).optional(),
  }),
  op('change_camera', {
    shot: ShotSchema,
    immediate: z.boolean().default(false),
  }),
  op('add_shot', { shot: ShotSchema }),
  op('adjust_route', {
    routeId: id,
    closed: z.boolean().optional(),
    closedReason: z.string().max(240).optional(),
    coordinates: RouteSchema.shape.coordinates.optional(),
    label: label(48).optional(),
  }),
  op('add_route', { route: RouteSchema }),
  op('add_effect', { effect: EffectSchema }),
  op('remove_effect', { effectId: id }),
  op('add_timeline_event', { beat: BeatSchema }),
  op('add_evidence', { evidence: EvidenceSchema }),
  op('set_classification', { classification: ClassificationSchema.partial() }),
  op('set_mode', { mode: z.enum(Object.values(RUNTIME_MODES)) }),
  op('set_title', { title: label(120) }),
]);

export const PATCH_OPS = Object.freeze(
  PatchOpSchema.options.map((o) => o.shape.op.value),
);

export const ScenePatchSchema = z
  .object({
    patchId: z.string().min(4).max(80),
    sceneId: z.string().min(4).max(120),
    baseVersion: z.number().int().min(0),
    ops: z.array(PatchOpSchema).min(1).max(200),
    reason: z.string().max(400),
    source: z.enum([
      'director',
      'intelligence',
      'qa',
      'user',
      'test_injection',
      'system',
    ]),
    evidenceIds: z.array(id).max(50).default([]),
    priority: z.enum(['low', 'normal', 'high']).default('normal'),
    label: z.string().max(80).optional(), // e.g. "TEST PATCH — illustrative road closure"
    createdAt: z.string().max(80).optional(),
  })
  .strict();

// -------------------------------------------------- director NDJSON lines
/**
 * The Cinematic Director streams ONE JSON object per line (NDJSON). Each line
 * is validated on arrival and converted to runtime events immediately — this
 * is what makes scene direction incremental while the model is still
 * generating. Order: classification → timeline → entities/routes/effects in
 * any order → shots → beats → end.
 */
export const DirectorLineSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('classification'),
      classification: ClassificationSchema,
      title: label(120),
    })
    .strict(),
  z
    .object({ kind: z.literal('timeline'), durationSec: finite(5, 3600) })
    .strict(),
  z.object({ kind: z.literal('entity'), entity: EntitySchema }).strict(),
  z.object({ kind: z.literal('route'), route: RouteSchema }).strict(),
  z.object({ kind: z.literal('shot'), shot: ShotSchema }).strict(),
  z.object({ kind: z.literal('beat'), beat: BeatSchema }).strict(),
  z.object({ kind: z.literal('effect'), effect: EffectSchema }).strict(),
  z.object({ kind: z.literal('note'), text: z.string().max(400) }).strict(),
  z
    .object({
      kind: z.literal('end'),
      summary: z.string().max(600).default(''),
    })
    .strict(),
]);

/** JSON-schema-ish prose for the director prompt (kept short; zod is authoritative). */
export const DIRECTOR_LINE_SPEC = `Emit NDJSON: exactly one JSON object per line, no prose, no code fences, no arrays at top level.
Line kinds, in this order: classification, timeline, then any number of entity/route/effect lines, then shot lines, then beat lines, then one end line.
{"kind":"classification","title":string<=120,"classification":{"scenarioType":one of ${SCENARIO_TYPES.join('|')},"intent":string<=400,"hypothetical":boolean,"geographicConstraints":[string],"labels":[string],"uncertaintyNote":string}}
{"kind":"timeline","durationSec":number 5..3600}
{"kind":"entity","entity":{"id":"^[a-z][a-z0-9_.-]*$","assetId":one of the REGISTERED ASSET IDS,"label":string<=48,"category":one of ${ENTITY_CATEGORIES.join('|')},"role"?:string,"position":{"eastM":-5000..5000,"northM":-5000..5000,"heightM"?:number},"headingDeg"?:number,"scale"?:number,"count"?:int 1..500,"spreadM"?:0..500,"behavior"?:{"type":one of ${BEHAVIOR_TYPES.join('|')},"speedMps"?:number,"path"?:[{"eastM","northM","heightM"?,"atSec"?}],"loop"?:boolean,"followEntityId"?:id,"orbitRadiusM"?:number,"altitudeM"?:number},"startSec"?:number,"endSec"?:number|null,"uncertainty":"illustrative","hypothetical"?:boolean,"tags"?:[string]}}
{"kind":"route","route":{"id","label","kind":"race_route|approach|egress|cordon|road_segment|flight_path|other","coordinates":[[lon,lat],...] ONLY copied from supplied researched routes,"closed"?:boolean}}
{"kind":"shot","shot":{"id","type":one of ${SHOT_TYPES.join('|')},"title"<=60,"startSec","durationSec">=0.5,"subjectIds":[id],"focus"?:{"eastM","northM"},"distanceM"?:2..50000,"pitchDeg"?:-89.9..10,"headingDeg"?,"headingDeltaDeg"?,"easing"?:"${EASINGS.join('|')}","priority"?:0..100}}
{"kind":"beat","beat":{"atSec","title"<=80,"narration"<=600,"entityIds":[id]}}
{"kind":"effect","effect":{"id","type":one of ${EFFECT_TYPES.join('|')},"entityId"?,"position"?,"startSec"?,"endSec"?,"intensity"?:0..1,"hypothetical"?:boolean}}
{"kind":"end","summary":string<=600}`;

// ------------------------------------------------------------- utilities

export function emptyScene({
  sceneId,
  runId,
  origin,
  mode = RUNTIME_MODES.SIMULATION,
  title = 'Scene',
  durationSec = 60,
} = {}) {
  return CinematicSceneSchema.parse({
    schema: CINEMATIC_SCHEMA,
    schemaVersion: CINEMATIC_SCHEMA_VERSION,
    sceneId,
    sceneVersion: 0,
    ...(runId ? { runId } : {}),
    mode,
    title,
    origin,
    classification: { scenarioType: 'custom', intent: '', hypothetical: false },
    timeline: { durationSec, beats: [] },
  });
}

export function validateCinematicScene(raw) {
  return CinematicSceneSchema.parse(raw);
}
export function safeValidateCinematicScene(raw) {
  return CinematicSceneSchema.safeParse(raw);
}
export function validateScenePatch(raw) {
  return ScenePatchSchema.parse(raw);
}
export function safeValidateScenePatch(raw) {
  return ScenePatchSchema.safeParse(raw);
}
export function parseDirectorLine(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${error.message}`, line: text };
  }
  const parsed = DirectorLineSchema.safeParse(data);
  return parsed.success
    ? { ok: true, line: parsed.data }
    : {
        ok: false,
        error: parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')
          .slice(0, 500),
        line: data,
      };
}

/**
 * Apply a validated patch to a validated scene. Pure: returns a NEW scene
 * (sceneVersion + 1) plus `applied[]` / `rejected[]` per op. A patch whose
 * `baseVersion` is older than `scene.sceneVersion` is still applied op-by-op
 * when its ops do not touch something that changed after `baseVersion`
 * (tracked via `history`); otherwise that op is rejected as `stale`.
 */
export function applyScenePatch(
  scene,
  patch,
  { now = new Date().toISOString() } = {},
) {
  const base = CinematicSceneSchema.parse(scene);
  const p = ScenePatchSchema.parse(patch);
  if (p.sceneId !== base.sceneId)
    return {
      scene: base,
      applied: [],
      rejected: p.ops.map((o) => ({ op: o.op, reason: 'scene_mismatch' })),
      stale: true,
    };
  const touchedSince = new Set(
    base.history
      .filter((h) => h.sceneVersion > p.baseVersion && h.op.includes(':'))
      .map((h) => h.op.split(':')[1]),
  );
  const next = structuredClone(base);
  const applied = [];
  const rejected = [];
  const find = (arr, key) => arr.findIndex((x) => x.id === key);
  for (const o of p.ops) {
    const target =
      o.entityId ||
      o.routeId ||
      o.effectId ||
      o.entity?.id ||
      o.route?.id ||
      o.effect?.id ||
      o.shot?.id ||
      null;
    if (
      target &&
      touchedSince.has(target) &&
      p.baseVersion < base.sceneVersion
    ) {
      rejected.push({ op: o.op, target, reason: 'stale' });
      continue;
    }
    switch (o.op) {
      case 'add_entity': {
        if (find(next.entities, o.entity.id) !== -1) {
          rejected.push({ op: o.op, target, reason: 'duplicate_id' });
          continue;
        }
        if (next.entities.length >= 400) {
          rejected.push({ op: o.op, target, reason: 'entity_limit' });
          continue;
        }
        next.entities.push(o.entity);
        if (!next.assetIds.includes(o.entity.assetId))
          next.assetIds.push(o.entity.assetId);
        break;
      }
      case 'remove_entity': {
        const i = find(next.entities, o.entityId);
        if (i === -1) {
          rejected.push({ op: o.op, target, reason: 'not_found' });
          continue;
        }
        next.entities.splice(i, 1);
        break;
      }
      case 'update_entity':
      case 'animate_entity':
      case 'reposition_entity':
      case 'highlight_entity': {
        const i = find(next.entities, o.entityId);
        if (i === -1) {
          rejected.push({ op: o.op, target, reason: 'not_found' });
          continue;
        }
        const e = next.entities[i];
        if (o.op === 'update_entity')
          next.entities[i] = { ...e, ...o.changes, id: e.id };
        else if (o.op === 'animate_entity')
          next.entities[i] = { ...e, behavior: o.behavior };
        else if (o.op === 'reposition_entity')
          next.entities[i] = {
            ...e,
            position: o.position,
            ...(o.headingDeg != null ? { headingDeg: o.headingDeg } : {}),
          };
        else
          next.entities[i] = {
            ...e,
            highlight: o.highlight,
            ...(o.alertState ? { alertState: o.alertState } : {}),
          };
        break;
      }
      case 'change_camera':
      case 'add_shot': {
        const i = find(next.shots, o.shot.id);
        if (i === -1) next.shots.push(o.shot);
        else next.shots[i] = o.shot;
        next.shots.sort((a, b) => a.startSec - b.startSec);
        break;
      }
      case 'adjust_route': {
        const i = find(next.routes, o.routeId);
        if (i === -1) {
          rejected.push({ op: o.op, target, reason: 'not_found' });
          continue;
        }
        const r = next.routes[i];
        next.routes[i] = {
          ...r,
          ...(o.closed != null ? { closed: o.closed } : {}),
          ...(o.closedReason ? { closedReason: o.closedReason } : {}),
          ...(o.coordinates ? { coordinates: o.coordinates } : {}),
          ...(o.label ? { label: o.label } : {}),
        };
        break;
      }
      case 'add_route': {
        if (find(next.routes, o.route.id) !== -1) {
          rejected.push({ op: o.op, target, reason: 'duplicate_id' });
          continue;
        }
        next.routes.push(o.route);
        break;
      }
      case 'add_effect': {
        if (find(next.effects, o.effect.id) !== -1)
          next.effects[find(next.effects, o.effect.id)] = o.effect;
        else next.effects.push(o.effect);
        break;
      }
      case 'remove_effect': {
        const i = find(next.effects, o.effectId);
        if (i === -1) {
          rejected.push({ op: o.op, target, reason: 'not_found' });
          continue;
        }
        next.effects.splice(i, 1);
        break;
      }
      case 'add_timeline_event':
        next.timeline.beats.push(o.beat);
        next.timeline.beats.sort((a, b) => a.atSec - b.atSec);
        if (o.beat.atSec > next.timeline.durationSec)
          next.timeline.durationSec = Math.min(3600, o.beat.atSec + 5);
        break;
      case 'add_evidence': {
        const i = find(next.evidence, o.evidence.id);
        if (i === -1) next.evidence.push(o.evidence);
        else next.evidence[i] = { ...next.evidence[i], ...o.evidence };
        break;
      }
      case 'set_classification':
        next.classification = { ...next.classification, ...o.classification };
        break;
      case 'set_mode':
        next.mode = o.mode;
        break;
      case 'set_title':
        next.title = o.title;
        break;
      default:
        rejected.push({ op: o.op, reason: 'unsupported' });
        continue;
    }
    applied.push({ op: o.op, ...(target ? { target } : {}) });
  }
  if (!applied.length)
    return {
      scene: base,
      applied,
      rejected,
      stale: rejected.some((r) => r.reason === 'stale'),
    };
  next.sceneVersion = base.sceneVersion + 1;
  next.history = [
    ...next.history.slice(-499 + applied.length),
    ...applied.map((a) => ({
      sceneVersion: next.sceneVersion,
      at: now,
      op: a.target ? `${a.op}:${a.target}` : a.op,
      reason: p.reason,
      source: p.source,
      patchId: p.patchId,
    })),
  ].slice(-500);
  return {
    scene: CinematicSceneSchema.parse(next),
    applied,
    rejected,
    stale: false,
  };
}

/** Compact scene-graph diff for Q&A confirmations and evidence reports. */
export function diffScenes(before, after) {
  const key = (arr) => new Map(arr.map((x) => [x.id, x]));
  const out = {
    entities: { added: [], removed: [], changed: [] },
    routes: { changed: [] },
    shots: { added: [] },
    version: [before.sceneVersion, after.sceneVersion],
  };
  const b = key(before.entities),
    a = key(after.entities);
  for (const [k, v] of a)
    if (!b.has(k)) out.entities.added.push(k);
    else if (JSON.stringify(b.get(k)) !== JSON.stringify(v))
      out.entities.changed.push(k);
  for (const k of b.keys()) if (!a.has(k)) out.entities.removed.push(k);
  const br = key(before.routes),
    ar = key(after.routes);
  for (const [k, v] of ar)
    if (JSON.stringify(br.get(k)) !== JSON.stringify(v))
      out.routes.changed.push(k);
  const bs = new Set(before.shots.map((s) => s.id));
  for (const s of after.shots) if (!bs.has(s.id)) out.shots.added.push(s.id);
  return out;
}

export { RUNTIME_MODES, RUN_STATES };
