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
export const DYNAMIC_ELEMENT_TYPES = Object.freeze([
  ...ELEMENT_TYPES,
  'threat_zone',
  'interest_zone',
  'overwatch',
  'command_post',
  'cordon_node',
  'crowd_density_zone',
  'cctv_pick',
  'intel_note',
  'timeline_event',
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
      e.params?.radius_m ?? null,
      e.params?.count ?? null,
      e.params?.spacing_m ?? null,
      e.params?.direction ?? null,
    ]),
  ]);
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Strip control characters, HTML tags, and bracketed citations like [1], [1, 2]. */
export function sanitizeString(val, maxLen) {
  if (typeof val !== 'string') return '';
  let s = val
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (maxLen && s.length > maxLen) {
    s = s.slice(0, maxLen).trim();
  }
  return s;
}

/** Check whether a citation URL is valid HTTP/HTTPS and <= 2000 chars. */
export function isValidCitationUrl(url) {
  if (typeof url !== 'string' || !url.trim() || url.length > 2000) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Dynamic JSON Schema (draft 2020-12) for fast models:
 * Open enum where type is a string with documented vocabulary in the description.
 */
export const SCENE_SPEC_DYNAMIC_JSON_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['scenarioType', 'focalEntity', 'elements', 'confidence'],
  properties: {
    scenarioType: {
      type: 'string',
      enum: [...SCENARIO_TYPES],
      description: 'Scenario classification',
    },
    focalEntity: {
      type: 'object',
      required: ['name', 'kind'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: SPEC_LIMITS.nameMax },
        kind: { type: 'string', enum: [...FOCAL_KINDS] },
      },
    },
    elements: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type'],
        properties: {
          type: {
            type: 'string',
            description:
              'Dynamic element type: threat_zone, interest_zone, approach_route, egress_route, overwatch, command_post, checkpoint, cordon_node, crowd_density_zone, cctv_pick, intel_note, timeline_event, inner_cordon, outer_cordon, staging_point, perimeter_unit, cones, barriers, cctv_signal, crowd_zone, route_line, start_finish, or custom type',
          },
          label: { type: 'string', maxLength: 48 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          source: { type: 'string', maxLength: 120 },
          offset: {
            type: 'object',
            properties: {
              eastM: { type: 'number', minimum: -5000, maximum: 5000 },
              northM: { type: 'number', minimum: -5000, maximum: 5000 },
            },
          },
          params: {
            type: 'object',
            properties: {
              radius_m: { type: 'number', minimum: 5, maximum: 5000 },
              count: { type: 'integer', minimum: 1, maximum: 200 },
              spacing_m: { type: 'number', minimum: 2, maximum: 500 },
              direction: { type: 'string', enum: [...DIRECTIONS] },
            },
          },
          relevance: { type: 'number', minimum: 0, maximum: 1 },
          evidenceTier: {
            type: 'string',
            enum: ['sourced', 'inferred', 'generated'],
          },
          citations: {
            type: 'array',
            items: {
              type: 'object',
              required: ['url'],
              properties: {
                url: { type: 'string', maxLength: 2000 },
                title: { type: 'string', maxLength: 300 },
              },
            },
          },
          atSec: { type: 'number', minimum: 0 },
          title: { type: 'string', maxLength: 80 },
        },
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
});

/**
 * Permissive-but-safe dynamic parser:
 * - Accepts both closed ELEMENT_TYPES and dynamic DYNAMIC_ELEMENT_TYPES
 * - Accepts unknown element types and marks them `generic: true`
 * - Reports rejected[] ONLY for structurally invalid entries (non-object, missing type)
 * - Tracks coerced[] modifications (clamped bounds, normalized strings)
 */
export function parseDynamicSceneSpec(raw, { bbox } = {}) {
  const rejected = [];
  const coerced = [];

  if (!plainObject(raw)) {
    rejected.push({ element: String(raw), reason: 'not an object' });
    return {
      spec: {
        scenarioType: 'observation',
        focalEntity: { name: 'Requested place', kind: 'unknown' },
        elements: [],
        confidence: 0.5,
      },
      rejected,
      coerced,
    };
  }

  // 1. Scenario type
  let scenarioType =
    typeof raw.scenarioType === 'string'
      ? raw.scenarioType
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, '_')
      : 'observation';
  if (!SCENARIO_TYPES.includes(scenarioType)) {
    coerced.push({
      path: 'scenarioType',
      from: raw.scenarioType,
      to: 'observation',
      reason: 'unknown scenarioType defaulted to observation',
    });
    scenarioType = 'observation';
  }

  // 2. Focal entity
  let focalName = 'Requested place';
  let focalKind = 'unknown';
  if (plainObject(raw.focalEntity)) {
    if (typeof raw.focalEntity.name === 'string') {
      focalName =
        sanitizeString(raw.focalEntity.name, SPEC_LIMITS.nameMax) ||
        'Requested place';
    }
    if (typeof raw.focalEntity.kind === 'string') {
      const k = raw.focalEntity.kind.trim().toLowerCase();
      focalKind = FOCAL_KINDS.includes(k) ? k : 'unknown';
    }
  }

  // 3. Overall confidence
  let confidence = 0.5;
  if (raw.confidence !== undefined && raw.confidence !== null) {
    const c = Number(raw.confidence);
    if (Number.isFinite(c)) {
      confidence = Math.min(1, Math.max(0, c));
      if (confidence !== c) {
        coerced.push({
          path: 'confidence',
          from: c,
          to: confidence,
          reason: 'confidence clamped to [0, 1]',
        });
      }
    } else {
      coerced.push({
        path: 'confidence',
        from: raw.confidence,
        to: 0.5,
        reason: 'non-numeric confidence defaulted to 0.5',
      });
    }
  }

  // 4. BBox bounds for offset clamping
  let minEastM = -5000;
  let maxEastM = 5000;
  let minNorthM = -5000;
  let maxNorthM = 5000;
  if (bbox) {
    if (Array.isArray(bbox) && bbox.length === 4) {
      if (Number.isFinite(bbox[0])) minEastM = Math.max(-5000, bbox[0]);
      if (Number.isFinite(bbox[1])) minNorthM = Math.max(-5000, bbox[1]);
      if (Number.isFinite(bbox[2])) maxEastM = Math.min(5000, bbox[2]);
      if (Number.isFinite(bbox[3])) maxNorthM = Math.min(5000, bbox[3]);
    } else if (plainObject(bbox)) {
      const bMinE = bbox.minEastM ?? bbox.eastMin ?? bbox.westM ?? bbox.minX;
      const bMaxE = bbox.maxEastM ?? bbox.eastMax ?? bbox.eastM ?? bbox.maxX;
      const bMinN = bbox.minNorthM ?? bbox.northMin ?? bbox.southM ?? bbox.minY;
      const bMaxN = bbox.maxNorthM ?? bbox.northMax ?? bbox.northM ?? bbox.maxY;
      if (Number.isFinite(bMinE)) minEastM = Math.max(-5000, bMinE);
      if (Number.isFinite(bMaxE)) maxEastM = Math.min(5000, bMaxE);
      if (Number.isFinite(bMinN)) minNorthM = Math.max(-5000, bMinN);
      if (Number.isFinite(bMaxN)) maxNorthM = Math.min(5000, bMaxN);
    }
  }

  // 5. Elements
  const rawElements = Array.isArray(raw.elements) ? raw.elements : [];
  const validElements = [];

  for (let idx = 0; idx < rawElements.length; idx++) {
    const el = rawElements[idx];
    if (!plainObject(el)) {
      rejected.push({ element: el, reason: 'not an object' });
      continue;
    }
    if (
      el.type === undefined ||
      el.type === null ||
      typeof el.type !== 'string' ||
      !el.type.trim()
    ) {
      rejected.push({ element: el, reason: 'missing element type' });
      continue;
    }

    const type = el.type
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    const isKnown = DYNAMIC_ELEMENT_TYPES.includes(type);
    const generic = !isKnown || el.generic === true;

    if (!isKnown) {
      coerced.push({
        path: `elements.${idx}.generic`,
        from: type,
        to: true,
        reason: 'unknown element marked generic: true',
      });
    }

    const normEl = {
      type,
      params: {},
    };
    if (generic) normEl.generic = true;

    // Radius (5 - 5000 m)
    const rawRadius = el.radius_m ?? el.params?.radius_m;
    if (rawRadius !== undefined && rawRadius !== null && rawRadius !== '') {
      const r = Number(rawRadius);
      if (Number.isFinite(r)) {
        const clampedR = Math.min(5000, Math.max(5, r));
        if (clampedR !== r) {
          coerced.push({
            path: `elements.${idx}.radius_m`,
            from: r,
            to: clampedR,
            reason: 'radius clamped to [5, 5000]',
          });
        }
        normEl.params.radius_m = clampedR;
        if (el.radius_m !== undefined) normEl.radius_m = clampedR;
      }
    }

    // Count (1 - 200)
    const rawCount = el.count ?? el.params?.count;
    if (rawCount !== undefined && rawCount !== null && rawCount !== '') {
      const c = Math.round(Number(rawCount));
      if (Number.isFinite(c)) {
        const clampedC = Math.min(200, Math.max(1, c));
        if (clampedC !== c) {
          coerced.push({
            path: `elements.${idx}.count`,
            from: c,
            to: clampedC,
            reason: 'count clamped to [1, 200]',
          });
        }
        normEl.params.count = clampedC;
        if (el.count !== undefined) normEl.count = clampedC;
      }
    }

    // Spacing (2 - 500 m)
    const rawSpacing = el.spacing_m ?? el.params?.spacing_m;
    if (rawSpacing !== undefined && rawSpacing !== null && rawSpacing !== '') {
      const s = Number(rawSpacing);
      if (Number.isFinite(s)) {
        const clampedS = Math.min(500, Math.max(2, s));
        normEl.params.spacing_m = clampedS;
        if (el.spacing_m !== undefined) normEl.spacing_m = clampedS;
      }
    }

    // Direction
    const rawDir = el.direction ?? el.params?.direction;
    if (typeof rawDir === 'string') {
      const d = rawDir.trim().toUpperCase();
      if (DIRECTIONS.includes(d)) {
        normEl.params.direction = d;
        if (el.direction !== undefined) normEl.direction = d;
      }
    }

    // Offset { eastM, northM }
    const rawOffset = el.offset ?? el.params?.offset;
    if (plainObject(rawOffset)) {
      let eastM = Number(rawOffset.eastM ?? 0);
      let northM = Number(rawOffset.northM ?? 0);
      if (!Number.isFinite(eastM)) eastM = 0;
      if (!Number.isFinite(northM)) northM = 0;

      const clampedEast = Math.min(maxEastM, Math.max(minEastM, eastM));
      const clampedNorth = Math.min(maxNorthM, Math.max(minNorthM, northM));
      if (clampedEast !== eastM || clampedNorth !== northM) {
        coerced.push({
          path: `elements.${idx}.offset`,
          from: { eastM, northM },
          to: { eastM: clampedEast, northM: clampedNorth },
          reason: 'offset clamped to bounds',
        });
      }
      normEl.offset = { eastM: clampedEast, northM: clampedNorth };
    }

    // Confidence
    if (el.confidence !== undefined && el.confidence !== null) {
      const c = Number(el.confidence);
      if (Number.isFinite(c)) {
        normEl.confidence = Math.min(1, Math.max(0, c));
      }
    }

    // Source (<= 120 chars, sanitized)
    if (typeof el.source === 'string') {
      const s = sanitizeString(el.source, 120);
      if (s) normEl.source = s;
    }

    // Label (<= 48 chars, sanitized)
    if (typeof el.label === 'string') {
      const l = sanitizeString(el.label, 48);
      if (l) normEl.label = l;
    }

    // CCTV pick: relevance (0 - 1)
    if (type === 'cctv_pick') {
      let rel = 0.5;
      if (el.relevance !== undefined && el.relevance !== null) {
        const r = Number(el.relevance);
        if (Number.isFinite(r)) rel = Math.min(1, Math.max(0, r));
      }
      normEl.relevance = rel;
    }

    // Intel note: evidenceTier + citations
    if (type === 'intel_note') {
      let tier = 'inferred';
      if (['sourced', 'inferred', 'generated'].includes(el.evidenceTier)) {
        tier = el.evidenceTier;
      }
      normEl.evidenceTier = tier;

      const citations = [];
      if (Array.isArray(el.citations)) {
        for (const c of el.citations) {
          if (c && typeof c === 'object' && isValidCitationUrl(c.url)) {
            citations.push({
              url: c.url.trim(),
              ...(c.title ? { title: sanitizeString(c.title, 300) } : {}),
            });
          } else if (c?.url) {
            coerced.push({
              path: `elements.${idx}.citations`,
              from: c?.url,
              to: null,
              reason: 'invalid citation URL dropped',
            });
          }
        }
      }
      normEl.citations = citations;
    }

    // Timeline event: atSec >= 0, title <= 80
    if (type === 'timeline_event') {
      let atSec = 0;
      if (el.atSec !== undefined && el.atSec !== null) {
        const s = Number(el.atSec);
        if (Number.isFinite(s)) atSec = Math.max(0, s);
      }
      normEl.atSec = atSec;
      if (typeof el.title === 'string') {
        normEl.title = sanitizeString(el.title, 80);
      }
    }

    validElements.push(normEl);
  }

  return {
    spec: {
      scenarioType,
      focalEntity: { name: focalName, kind: focalKind },
      elements: validElements,
      confidence,
    },
    rejected,
    coerced,
  };
}
