/** Shared, dependency-free boundary for generated illustrative geographic scenes. */
export const SCENE_PLAN_VERSION = 1;
export const SCENE_ENTITY_TYPES = Object.freeze([
  'person',
  'runner',
  'police',
  'organizer',
  'vehicle',
  'police_vehicle',
  'barrier',
  'start_line',
  'finish_line',
]);
const string = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const record = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});
const cameraSchema = record({
  distanceM: number(10, 20000),
  heading: number(0, 360),
  pitch: number(-89, -5),
  framing: { enum: ['wide', 'medium', 'close'] },
});
const citationSchema = record(
  {
    url: { type: 'string', format: 'uri', maxLength: 2048 },
    title: string(300),
    publishedAt: string(40),
  },
  ['url'],
);
export const SCENE_PLAN_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  ...record({
    version: { const: SCENE_PLAN_VERSION },
    title: string(200),
    illustrative: { const: true },
    durationSec: number(5, 180),
    location: record(
      {
        name: string(300),
        lat: number(-90, 90),
        lon: number(-180, 180),
        sourceUrl: citationSchema.properties.url,
      },
      ['name', 'lat', 'lon'],
    ),
    camera: cameraSchema,
    entities: {
      type: 'array',
      minItems: 1,
      maxItems: 300,
      items: record({
        id: { ...string(80), pattern: '^[A-Za-z][A-Za-z0-9_-]*$' },
        type: { enum: SCENE_ENTITY_TYPES },
        label: string(160),
        quantity: { type: 'integer', minimum: 1, maximum: 100 },
        position: record({
          eastM: number(-5000, 5000),
          northM: number(-5000, 5000),
        }),
        heading: number(0, 360),
      }),
    },
    relationships: {
      type: 'array',
      maxItems: 600,
      items: record({
        from: string(80),
        to: string(80),
        relation: string(160),
      }),
    },
    beats: {
      type: 'array',
      minItems: 1,
      maxItems: 90,
      items: record(
        {
          atSec: number(0, 180),
          title: string(200),
          narration: string(2000),
          entityIds: {
            type: 'array',
            maxItems: 300,
            uniqueItems: true,
            items: string(80),
          },
          camera: cameraSchema,
        },
        ['atSec', 'title', 'narration', 'entityIds'],
      ),
    },
    citations: { type: 'array', maxItems: 40, items: citationSchema },
    verification: record(
      {
        status: { enum: ['location_verified', 'event_verified'] },
        locationSource: string(200),
        checkedAt: string(40),
        eventName: string(200),
        edition: string(120),
        eventDate: string(40),
        limitations: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: string(600),
        },
      },
      ['status', 'locationSource', 'checkedAt', 'limitations'],
    ),
  }),
});

export class ScenePlanValidationError extends Error {
  constructor(path, reason) {
    super(`${path}: ${reason}`);
    this.name = 'ScenePlanValidationError';
    this.code = 'invalid_scene_plan';
    this.path = path;
  }
}
const fail = (path, reason) => {
  throw new ScenePlanValidationError(path, reason);
};

/** Public URLs only: rejects credentials, local/private hosts, protocols and secret-like parameters. */
export function validatePublicUrl(value, path = 'url') {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    /[\s\u0000-\u001f]/u.test(value)
  )
    fail(path, 'must be a public HTTP(S) URL');
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(path, 'must be a public HTTP(S) URL');
  }
  const host = url.hostname.toLowerCase();
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !host.includes('.') ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^(?:\d+\.){3}\d+$/.test(host) ||
    host.includes(':') ||
    [...url.searchParams.keys()].some((key) =>
      /^(?:api[-_]?key|authorization|password|secret)$/i.test(key),
    )
  )
    fail(path, 'must be a public HTTP(S) URL without credentials');
  return value;
}

function check(value, schema, path) {
  if (schema.const !== undefined && value !== schema.const)
    fail(path, `must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value))
    fail(path, `must be one of ${schema.enum.join(', ')}`);
  if (schema.type === 'object') {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      fail(path, 'must be a plain object');
    for (const key of Object.keys(value))
      if (!Object.hasOwn(schema.properties, key))
        fail(`${path}.${key}`, 'unknown field');
    for (const key of schema.required || [])
      if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'required');
    for (const [key, item] of Object.entries(value))
      check(item, schema.properties[key], `${path}.${key}`);
  } else if (schema.type === 'array') {
    if (
      !Array.isArray(value) ||
      value.length < (schema.minItems || 0) ||
      value.length > schema.maxItems
    )
      fail(path, `invalid array length (maximum ${schema.maxItems})`);
    value.forEach((item, index) =>
      check(item, schema.items, `${path}[${index}]`),
    );
    if (schema.uniqueItems && new Set(value).size !== value.length)
      fail(path, 'duplicate references');
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < schema.minimum ||
      value > schema.maximum ||
      (schema.type === 'integer' && !Number.isInteger(value))
    )
      fail(
        path,
        `must be ${schema.type} in [${schema.minimum}, ${schema.maximum}]`,
      );
  } else if (schema.type === 'string') {
    if (
      typeof value !== 'string' ||
      value.trim().length < (schema.minLength || 0) ||
      value.length > schema.maxLength ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
    )
      fail(path, `must be non-empty text (maximum ${schema.maxLength})`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      fail(path, 'invalid identifier');
    if (schema.format === 'uri') validatePublicUrl(value, path);
  }
}

/** Returns a fresh validated JSON plan, never mutates input, never clamps or fabricates values. */
export function validateScenePlan(plan) {
  check(plan, SCENE_PLAN_SCHEMA, 'plan');
  const ids = new Set();
  let quantity = 0;
  for (const entity of plan.entities) {
    if (ids.has(entity.id)) fail('plan.entities', 'IDs must be unique');
    ids.add(entity.id);
    quantity += entity.quantity;
    if (Math.hypot(entity.position.eastM, entity.position.northM) > 5000)
      fail(`plan.entities.${entity.id}.position`, 'local radius exceeds 5000m');
  }
  if (quantity > 300) fail('plan.entities', 'total quantity exceeds 300');
  for (const relation of plan.relationships)
    for (const key of ['from', 'to'])
      if (!ids.has(relation[key]))
        fail('plan.relationships', 'unknown entity reference');
  let prior = -1;
  for (const beat of plan.beats) {
    if (
      beat.atSec <= prior ||
      beat.atSec >= plan.durationSec ||
      (prior >= 0 && beat.atSec - prior < 0.2) ||
      plan.durationSec - beat.atSec < 0.2
    )
      fail(
        'plan.beats',
        'times must be increasing, within duration, and allow at least 0.2 seconds per shot',
      );
    prior = beat.atSec;
    for (const id of beat.entityIds)
      if (!ids.has(id))
        fail('plan.beats.entityIds', 'unknown entity reference');
  }
  if (plan.beats[0].atSec !== 0)
    fail('plan.beats[0].atSec', 'first beat must start at 0');
  if (!Number.isFinite(Date.parse(plan.verification.checkedAt)))
    fail('plan.verification.checkedAt', 'invalid timestamp');
  if (
    plan.verification.status === 'event_verified' &&
    (!plan.verification.edition ||
      !plan.verification.eventName ||
      !plan.citations.length)
  )
    fail(
      'plan.verification',
      'verified event requires edition, name and citations',
    );
  for (const citation of plan.citations)
    if (
      citation.publishedAt &&
      !Number.isFinite(Date.parse(citation.publishedAt))
    )
      fail('plan.citations.publishedAt', 'invalid date');
  return JSON.parse(JSON.stringify(plan));
}
