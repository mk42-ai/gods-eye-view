import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SceneSpecSchema,
  SCENE_SPEC_JSON_SCHEMA,
  SCENE_SPEC_STRICT_JSON_SCHEMA,
  SPEC_LIMITS,
  normalizeSceneSpecInput,
  parseSceneSpec,
  validateSceneSpec,
  sceneSpecSignature,
  SceneSpecError,
} from './sceneSpec.js';

const validSpec = () => ({
  scenarioType: 'police_raid',
  focalEntity: { name: 'Burj Al Arab', kind: 'building' },
  elements: [
    { type: 'inner_cordon', params: { radius_m: 80 } },
    { type: 'outer_cordon', params: { radius_m: 220 } },
    { type: 'approach_route', params: { count: 3 } },
    { type: 'egress_route', params: { count: 1, direction: 'NE' } },
    { type: 'cones', params: { spacing_m: 8 } },
  ],
  confidence: 0.9,
});

const withElements = (elements, extra = {}) => ({
  ...validSpec(),
  elements,
  ...extra,
});

test('valid spec parses and is deep-equal with no extra keys', () => {
  const input = validSpec();
  const parsed = parseSceneSpec(input);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.spec, input);
  assert.deepEqual(parsed.rejected, []);
  assert.deepEqual(Object.keys(parsed.spec).sort(), [
    'confidence',
    'elements',
    'focalEntity',
    'scenarioType',
  ]);
  assert.equal(SceneSpecSchema.safeParse(input).success, true);
});

test('strictObject rejects unknown top-level keys', () => {
  const parsed = parseSceneSpec({ ...validSpec(), coordinates: [25.1, 55.2] });
  assert.equal(parsed.ok, false);
  assert.ok(parsed.issues.some((i) => /coordinates/.test(i.message)));
});

test('strictObject rejects unknown param keys', () => {
  const parsed = SceneSpecSchema.safeParse(
    withElements([{ type: 'cones', params: { spacing_m: 8, lat: 25.1 } }]),
  );
  assert.equal(parsed.success, false);
  assert.ok(
    parsed.error.issues.some(
      (i) => i.path.join('.') === 'elements.0.params' && /lat/.test(i.message),
    ),
  );
});

test('unknown element types are reported in rejected[] and dropped', () => {
  const parsed = parseSceneSpec(
    withElements([
      { type: 'inner_cordon', params: { radius_m: 80 } },
      { type: 'sniper_nest', params: { count: 2 } },
      { type: 'Outer Cordon', params: { radius_m: 220 } },
      'not-an-object',
    ]),
  );
  assert.equal(parsed.ok, true);
  assert.deepEqual(
    parsed.spec.elements.map((e) => e.type),
    ['inner_cordon', 'outer_cordon'],
  );
  assert.equal(parsed.rejected.length, 2);
  assert.deepEqual(parsed.rejected[0], {
    type: 'sniper_nest',
    reason: 'unknown element type',
  });
  assert.equal(parsed.rejected[1].type, 'not-an-object');
  assert.equal(parsed.rejected[1].reason, 'not an object');
});

test('numeric strings and nulls from strict-schema providers are normalised', () => {
  const parsed = parseSceneSpec(
    withElements(
      [
        {
          type: 'inner_cordon',
          params: {
            radius_m: '90',
            count: null,
            spacing_m: '',
            direction: null,
          },
        },
      ],
      { confidence: '0.7' },
    ),
  );
  assert.equal(parsed.ok, true, JSON.stringify(parsed.issues));
  assert.deepEqual(parsed.spec.elements[0].params, { radius_m: 90 });
  assert.equal(parsed.spec.confidence, 0.7);
});

test('count is rounded to an integer', () => {
  const { value } = normalizeSceneSpecInput(
    withElements([{ type: 'perimeter_unit', params: { count: 5.6 } }]),
  );
  assert.equal(value.elements[0].params.count, 6);
  const parsed = parseSceneSpec(
    withElements([{ type: 'perimeter_unit', params: { count: '2.4' } }]),
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.spec.elements[0].params.count, 2);
});

test('out-of-range radius, count and spacing fail with issue paths', () => {
  const parsed = parseSceneSpec(
    withElements([
      {
        type: 'inner_cordon',
        params: { radius_m: SPEC_LIMITS.radiusM.max + 1 },
      },
      { type: 'perimeter_unit', params: { count: 0 } },
      { type: 'cones', params: { spacing_m: 1 } },
    ]),
  );
  assert.equal(parsed.ok, false);
  const paths = parsed.issues.map((i) => i.path);
  assert.ok(paths.includes('elements.0.params.radius_m'));
  assert.ok(paths.includes('elements.1.params.count'));
  assert.ok(paths.includes('elements.2.params.spacing_m'));
});

test('direction is upper-cased and invalid direction fails', () => {
  const ok = parseSceneSpec(
    withElements([{ type: 'staging_point', params: { direction: ' ne ' } }]),
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.spec.elements[0].params.direction, 'NE');
  const bad = parseSceneSpec(
    withElements([{ type: 'staging_point', params: { direction: 'UP' } }]),
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.issues[0].path, 'elements.0.params.direction');
});

test('focalEntity.kind outside the enum becomes unknown', () => {
  const parsed = parseSceneSpec({
    ...validSpec(),
    focalEntity: { name: 'Dubai Marina', kind: 'neighbourhood' },
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.spec.focalEntity.kind, 'unknown');
  const cased = parseSceneSpec({
    ...validSpec(),
    focalEntity: { name: 'Dubai Marina', kind: ' Landmark ' },
  });
  assert.equal(cased.spec.focalEntity.kind, 'landmark');
});

test('confidence bounds are enforced', () => {
  assert.equal(parseSceneSpec({ ...validSpec(), confidence: 0 }).ok, true);
  assert.equal(parseSceneSpec({ ...validSpec(), confidence: 1 }).ok, true);
  const high = parseSceneSpec({ ...validSpec(), confidence: 1.2 });
  assert.equal(high.ok, false);
  assert.equal(high.issues[0].path, 'confidence');
  const low = parseSceneSpec({ ...validSpec(), confidence: -0.1 });
  assert.equal(low.ok, false);
  assert.equal(low.issues[0].path, 'confidence');
});

test('elements are limited to 24 and at least one is required', () => {
  // cones are not merged by type, so 25 distinct entries stay 25 entries
  const many = Array.from({ length: 25 }, () => ({
    type: 'cones',
    params: { spacing_m: 8 },
  }));
  const tooMany = parseSceneSpec(withElements(many));
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.issues[0].path, 'elements');
  assert.equal(parseSceneSpec(withElements(many.slice(0, 24))).ok, true);
  const none = parseSceneSpec(withElements([]));
  assert.equal(none.ok, false);
  assert.equal(none.issues[0].path, 'elements');
});

function walkObjects(node, visit, path = '$') {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((n, i) => walkObjects(n, visit, `${path}[${i}]`));
    return;
  }
  if (node.type === 'object') visit(node, path);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'enum' || key === 'required') continue;
    walkObjects(value, visit, `${path}.${key}`);
  }
}

test('SCENE_SPEC_JSON_SCHEMA has additionalProperties:false on every object node', () => {
  let count = 0;
  walkObjects(SCENE_SPEC_JSON_SCHEMA, (node, path) => {
    count++;
    assert.equal(node.additionalProperties, false, `${path} is not closed`);
  });
  assert.ok(count >= 4, 'expected root, focalEntity, element and params nodes');
  assert.equal(SCENE_SPEC_JSON_SCHEMA.type, 'object');
});

test('SCENE_SPEC_STRICT_JSON_SCHEMA requires every property and is closed', () => {
  let count = 0;
  walkObjects(SCENE_SPEC_STRICT_JSON_SCHEMA, (node, path) => {
    count++;
    assert.equal(node.additionalProperties, false, `${path} is not closed`);
    assert.deepEqual(
      [...(node.required || [])].sort(),
      Object.keys(node.properties || {}).sort(),
      `${path} must require every property`,
    );
  });
  assert.equal(count, 4);
  const params =
    SCENE_SPEC_STRICT_JSON_SCHEMA.properties.elements.items.properties.params;
  for (const key of ['radius_m', 'count', 'spacing_m', 'direction']) {
    assert.ok(
      params.properties[key].anyOf.some((a) => a.type === 'null'),
      `${key} must be nullable in strict mode`,
    );
  }
});

test('sceneSpecSignature is stable and changes when a param changes', () => {
  const a = sceneSpecSignature(validSpec());
  const b = sceneSpecSignature(validSpec());
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{8}$/);
  const changed = validSpec();
  changed.elements[0].params.radius_m = 81;
  assert.notEqual(sceneSpecSignature(changed), a);
  const renamed = validSpec();
  renamed.focalEntity.name = 'BURJ AL ARAB';
  assert.equal(sceneSpecSignature(renamed), a, 'name case is ignored');
});

test('validateSceneSpec throws SceneSpecError with code invalid_scene_spec', () => {
  assert.throws(
    () => validateSceneSpec({ ...validSpec(), scenarioType: 'heist' }),
    (err) => {
      assert.ok(err instanceof SceneSpecError);
      assert.equal(err.code, 'invalid_scene_spec');
      assert.equal(err.name, 'SceneSpecError');
      assert.ok(Array.isArray(err.issues) && err.issues.length > 0);
      assert.equal(err.issues[0].path, 'scenarioType');
      return true;
    },
  );
  assert.deepEqual(validateSceneSpec(validSpec()), validSpec());
});

test('provider shorthand is normalised: flattened params, repeated single elements, missing confidence', () => {
  const live = parseSceneSpec({
    scenarioType: 'police_raid',
    focalEntity: { name: 'Burj Al Arab', kind: 'building' },
    elements: [
      { type: 'inner_cordon', radius_m: 30 },
      { type: 'approach_route', direction: 'N' },
      { type: 'approach_route', direction: 'E' },
      { type: 'perimeter_unit', count: 4 },
      { type: 'cones' },
    ],
  });
  assert.equal(live.ok, true, JSON.stringify(live.issues));
  assert.equal(live.spec.confidence, 0.5);
  assert.deepEqual(
    live.spec.elements.map((e) => [e.type, e.params]),
    [
      ['inner_cordon', { radius_m: 30 }],
      ['approach_route', { count: 2, direction: 'N' }],
      ['perimeter_unit', { count: 4 }],
      ['cones', {}],
    ],
  );
});
