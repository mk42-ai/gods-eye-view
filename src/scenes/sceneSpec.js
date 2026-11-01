/**
 * Scene Spec DSL — the ONLY thing the fast model is allowed to emit.
 *
 * Two-tier architecture: a small fast model classifies the prompt into a
 * strictly validated Scene Spec (scenario type, focal entity, abstract element
 * list with scalar parameters). Every coordinate, polygon, route, placement and
 * label is then produced by deterministic prebuilt code (server/scene-plans/
 * engine.js) from OpenStreetMap / OSRM data. The model NEVER emits raw
 * coordinates or free text that is drawn on the map.
 *
 * zod validates on both the browser and Node sides; unknown element types are
 * rejected (recorded as `rejected`) and the spec is repaired from the scenario
 * template (see `repairSceneSpec`).
 */
import { z } from 'zod';

export const SCENE_SPEC_VERSION = 1;

export const SCENARIO_TYPES = Object.freeze([
  'police_raid',
  'route_closure',
  'crowd_event',
  'perimeter_cordon',
  'motorcade',
  'observation',
]);
export const ELEMENT_TYPES = Object.freeze([
  'inner_cordon',
  'outer_cordon',
  'approach_route',
  'egress_route',
  'staging_point',
  'perimeter_unit',
  'checkpoint',
  'cones',
  'barriers',
  'cctv_signal',
  'crowd_zone',
  'route_line',
  'start_finish',
]);
export const DIRECTIONS = Object.freeze([
  'N',
  'NE',
  'E',
  'SE',
  'S',
  'SW',
  'W',
  'NW',
]);
export const FOCAL_KINDS = Object.freeze([
  'building',
  'venue',
  'road',
  'area',
  'landmark',
  'event',
  'unknown',
]);
/** Hard bounds the deterministic engine relies on (metres / counts). */
export const SPEC_LIMITS = Object.freeze({
  radiusM: { min: 10, max: 5000 },
  count: { min: 1, max: 200 },
  spacingM: { min: 2, max: 500 },
  maxElements: 24,
  nameMax: 120,
});

const shortText = (max) => z.string().trim().min(1).max(max);

export const ElementParamsSchema = z.strictObject({
  radius_m: z
    .number()
    .finite()
    .min(SPEC_LIMITS.radiusM.min)
    .max(SPEC_LIMITS.radiusM.max)
    .optional(),
  count: z
    .number()
    .int()
    .min(SPEC_LIMITS.count.min)
    .max(SPEC_LIMITS.count.max)
    .optional(),
  spacing_m: z
    .number()
    .finite()
    .min(SPEC_LIMITS.spacingM.min)
    .max(SPEC_LIMITS.spacingM.max)
    .optional(),
  direction: z.enum(DIRECTIONS).optional(),
});
export const SceneElementSchema = z.strictObject({
  type: z.enum(ELEMENT_TYPES),
  params: ElementParamsSchema,
});
export const FocalEntitySchema = z.strictObject({
  name: shortText(SPEC_LIMITS.nameMax),
  kind: z.enum(FOCAL_KINDS),
});
export const SceneSpecSchema = z.strictObject({
  scenarioType: z.enum(SCENARIO_TYPES),
  focalEntity: FocalEntitySchema,
  elements: z.array(SceneElementSchema).min(1).max(SPEC_LIMITS.maxElements),
  confidence: z.number().min(0).max(1),
});

/**
 * JSON Schema (draft 2020-12) of the spec with `additionalProperties:false` on
 * every object — the shape handed to providers that support structured output.
 */
export const SCENE_SPEC_JSON_SCHEMA = Object.freeze(
  z.toJSONSchema(SceneSpecSchema),
);

/**
 * Strict-mode variant for OpenAI-compatible `json_schema` with `strict:true`
 * (Cerebras): every property is required, optionals become nullable.
 */
export const SCENE_SPEC_STRICT_JSON_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['scenarioType', 'focalEntity', 'elements', 'confidence'],
  properties: {
    scenarioType: { type: 'string', enum: [...SCENARIO_TYPES] },
    focalEntity: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'kind'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: SPEC_LIMITS.nameMax },
        kind: { type: 'string', enum: [...FOCAL_KINDS] },
      },
    },
    elements: {
      type: 'array',
      minItems: 1,
      maxItems: SPEC_LIMITS.maxElements,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'params'],
        properties: {
          type: { type: 'string', enum: [...ELEMENT_TYPES] },
          params: {
            type: 'object',
            additionalProperties: false,
            required: ['radius_m', 'count', 'spacing_m', 'direction'],
            properties: {
              radius_m: {
                anyOf: [
                  {
                    type: 'number',
                    minimum: SPEC_LIMITS.radiusM.min,
                    maximum: SPEC_LIMITS.radiusM.max,
                  },
                  { type: 'null' },
                ],
              },
              count: {
                anyOf: [
                  {
                    type: 'integer',
                    minimum: SPEC_LIMITS.count.min,
                    maximum: SPEC_LIMITS.count.max,
                  },
                  { type: 'null' },
                ],
              },
              spacing_m: {
                anyOf: [
                  {
                    type: 'number',
                    minimum: SPEC_LIMITS.spacingM.min,
                    maximum: SPEC_LIMITS.spacingM.max,
                  },
                  { type: 'null' },
                ],
              },
              direction: {
                anyOf: [
                  { type: 'string', enum: [...DIRECTIONS] },
                  { type: 'null' },
                ],
              },
            },
          },
        },
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
});

export class SceneSpecError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'SceneSpecError';
    this.code = 'invalid_scene_spec';
    this.issues = issues;
  }
}

const MERGEABLE = new Set([
  'approach_route',
  'perimeter_unit',
  'checkpoint',
  'cctv_signal',
  'crowd_zone',
  'start_finish',
]);
const plainObject = (v) =>
  v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

/**
 * Normalise a raw provider object before strict validation: drop null params
 * (strict-schema providers emit nulls), coerce numeric strings, and split out
 * elements whose type is unknown so the caller can repair from the template.
 * Nothing here invents an element or a coordinate.
 */
export function normalizeSceneSpecInput(raw) {
  const rejected = [];
  if (!plainObject(raw)) return { value: raw, rejected };
  const out = { ...raw };
  if (typeof out.confidence === 'string' && out.confidence.trim() !== '')
    out.confidence = Number(out.confidence);
  // A missing confidence is a provider omission, not a scene fact: default it
  // low rather than discarding an otherwise valid classification.
  if (out.confidence === undefined || out.confidence === null)
    out.confidence = 0.5;
  if (plainObject(out.focalEntity)) {
    const fe = { ...out.focalEntity };
    if (typeof fe.kind === 'string') fe.kind = fe.kind.trim().toLowerCase();
    if (!FOCAL_KINDS.includes(fe.kind)) fe.kind = 'unknown';
    out.focalEntity = fe;
  }
  if (typeof out.scenarioType === 'string')
    out.scenarioType = out.scenarioType
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
  if (Array.isArray(out.elements)) {
    out.elements = out.elements
      .map((el) => {
        if (!plainObject(el)) {
          rejected.push({ type: String(el), reason: 'not an object' });
          return null;
        }
        const type =
          typeof el.type === 'string'
            ? el.type
                .trim()
                .toLowerCase()
                .replace(/[\s-]+/g, '_')
            : el.type;
        if (!ELEMENT_TYPES.includes(type)) {
          rejected.push({ type: String(type), reason: 'unknown element type' });
          return null;
        }
        const params = {};
        // Providers sometimes flatten params onto the element; lift them.
        const src = {
          ...Object.fromEntries(
            Object.entries(el).filter(([k]) =>
              ['radius_m', 'count', 'spacing_m', 'direction'].includes(k),
            ),
          ),
          ...(plainObject(el.params) ? el.params : {}),
        };
        for (const key of ['radius_m', 'count', 'spacing_m', 'direction']) {
          let v = src[key];
          if (v === null || v === undefined || v === '') continue;
          if (key !== 'direction') {
            v = typeof v === 'string' ? Number(v) : v;
            if (!Number.isFinite(v)) continue;
            if (key === 'count') v = Math.round(v);
            params[key] = v;
          } else if (typeof v === 'string') {
            params[key] = v.trim().toUpperCase();
          }
        }
        return { type, params };
      })
      .filter(Boolean);
    // Repeated single-instance elements (e.g. two approach_route entries with
    // directions) are merged into one entry with a count; the engine derives
    // placements from counts, never from duplicated list entries.
    const merged = [];
    for (const el of out.elements) {
      const prior = merged.find((m) => m.type === el.type);
      if (!prior || !MERGEABLE.has(el.type)) {
        merged.push(el);
        continue;
      }
      prior.params.count = Math.min(
        SPEC_LIMITS.count.max,
        (prior.params.count ?? 1) + (el.params.count ?? 1),
      );
      for (const key of ['radius_m', 'spacing_m', 'direction'])
        if (prior.params[key] === undefined && el.params[key] !== undefined)
          prior.params[key] = el.params[key];
    }
    out.elements = merged;
  }
  return { value: out, rejected };
}

/**
 * Validate a candidate spec. Returns `{ok:true, spec, rejected}` or
 * `{ok:false, issues, rejected}`; never throws for data problems.
 */
export function parseSceneSpec(raw) {
  const { value, rejected } = normalizeSceneSpecInput(raw);
  const result = SceneSpecSchema.safeParse(value);
  if (!result.success)
    return {
      ok: false,
      rejected,
      issues: result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    };
  return { ok: true, spec: result.data, rejected };
}

/** Throwing variant for boundaries that must fail closed. */
export function validateSceneSpec(raw) {
  const parsed = parseSceneSpec(raw);
  if (!parsed.ok)
    throw new SceneSpecError('Scene spec failed validation', parsed.issues);
  return parsed.spec;
}

/** Deterministic, stable fingerprint of a spec (cache keys, QA evidence). */
export function sceneSpecSignature(spec) {
  const text = JSON.stringify([
    spec.scenarioType,
    spec.focalEntity?.name?.toLowerCase(),
    spec.elements.map((e) => [
      e.type,
      e.params.radius_m ?? null,
      e.params.count ?? null,
      e.params.spacing_m ?? null,
      e.params.direction ?? null,
    ]),
  ]);
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
