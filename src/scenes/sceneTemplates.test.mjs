import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSceneSpec, SCENARIO_TYPES } from './sceneSpec.js';
import {
  SCENARIO_TEMPLATES,
  REQUIRED_ELEMENTS,
  classifyPrompt,
  promptHints,
  focalNameFromPrompt,
  templateSpec,
  repairSceneSpec,
} from './sceneTemplates.js';

const QA_PROMPTS = [
  ['police raid at Burj Al Arab', 'police_raid'],
  ['kanes boxing gym abu dhabi police raid', 'police_raid'],
  ['im doing a raid in the dubai marina', 'police_raid'],
  ['Dubai Run on Sheikh Zayed Road', 'crowd_event'],
];

test('classifyPrompt handles the four live QA prompts', () => {
  for (const [prompt, expected] of QA_PROMPTS)
    assert.equal(classifyPrompt(prompt), expected, prompt);
});

test('classifyPrompt covers the remaining scenarios and defaults to observation', () => {
  assert.equal(
    classifyPrompt('VIP motorcade through Downtown Dubai'),
    'motorcade',
  );
  assert.equal(classifyPrompt('road closure on Al Wasl Road'), 'route_closure');
  assert.equal(
    classifyPrompt('set up a cordon around Mall of the Emirates'),
    'perimeter_cordon',
  );
  assert.equal(
    classifyPrompt('monitor the Dubai Frame with CCTV'),
    'observation',
  );
  assert.equal(classifyPrompt('just show me the place'), 'observation');
  assert.equal(classifyPrompt(''), 'observation');
  assert.equal(classifyPrompt(undefined), 'observation');
});

test('every scenario template validates and contains the required elements', () => {
  for (const type of SCENARIO_TYPES) {
    assert.ok(SCENARIO_TEMPLATES[type], `template missing for ${type}`);
    const spec = templateSpec(
      `something at Example Place`,
      type,
      'Example Place',
    );
    const parsed = parseSceneSpec(spec);
    assert.equal(parsed.ok, true, `${type}: ${JSON.stringify(parsed.issues)}`);
    assert.deepEqual(parsed.rejected, []);
    assert.equal(parsed.spec.scenarioType, type);
    const present = new Set(parsed.spec.elements.map((e) => e.type));
    for (const required of REQUIRED_ELEMENTS[type])
      assert.ok(present.has(required), `${type} template lacks ${required}`);
  }
  assert.deepEqual(
    Object.keys(SCENARIO_TEMPLATES).sort(),
    [...SCENARIO_TYPES].sort(),
  );
  assert.deepEqual(
    Object.keys(REQUIRED_ELEMENTS).sort(),
    [...SCENARIO_TYPES].sort(),
  );
});

test('promptHints extracts cordon radius, approach route count and direction', () => {
  const hints = promptHints(
    'Raid with 4 approach routes and a 300 m cordon, staging from the north-east',
  );
  assert.deepEqual(hints, {
    cordonRadiusM: 300,
    approachRoutes: 4,
    direction: 'NE',
  });
  assert.deepEqual(promptHints('police raid at Burj Al Arab'), {});
  assert.equal(promptHints('egress toward the south').direction, 'S');
  assert.equal(
    promptHints('99 routes').approachRoutes,
    6,
    'approach count is capped at 6',
  );
  assert.equal(
    promptHints('9000 m perimeter').cordonRadiusM,
    5000,
    'radius capped',
  );
});

test('templateSpec applies prompt hints to the police_raid template', () => {
  const spec = templateSpec(
    'Raid with 4 approach routes and a 300 m cordon, staging from the north-east',
    'police_raid',
    'Example Tower',
  );
  const byType = Object.fromEntries(
    spec.elements.map((e) => [e.type, e.params]),
  );
  assert.equal(byType.outer_cordon.radius_m, 300);
  assert.equal(
    byType.inner_cordon.radius_m,
    120,
    'inner cordon is 40% of outer',
  );
  assert.equal(byType.approach_route.count, 4);
  assert.equal(byType.staging_point.direction, 'NE');
  assert.equal(byType.egress_route.direction, 'NE');
  assert.deepEqual(spec.focalEntity, {
    name: 'Example Tower',
    kind: 'unknown',
  });
  assert.equal(spec.confidence, 0.35);
  assert.equal(parseSceneSpec(spec).ok, true);
});

test('templateSpec falls back to observation for an unknown scenario type', () => {
  const spec = templateSpec('look at the harbour', 'heist', 'Harbour');
  assert.equal(spec.scenarioType, 'observation');
  assert.equal(parseSceneSpec(spec).ok, true);
});

test('templateSpec does not mutate the frozen SCENARIO_TEMPLATES', () => {
  const before = JSON.stringify(SCENARIO_TEMPLATES.police_raid);
  templateSpec(
    'raid with 2 approach routes and 500 m cordon',
    'police_raid',
    'X',
  );
  assert.equal(JSON.stringify(SCENARIO_TEMPLATES.police_raid), before);
});

test('focalNameFromPrompt strips scenario verbs and honours Location: lines', () => {
  assert.equal(
    focalNameFromPrompt('police raid at Burj Al Arab'),
    'Burj Al Arab',
  );
  assert.equal(
    focalNameFromPrompt('im doing a raid in the dubai marina'),
    'dubai marina',
  );
  assert.equal(
    focalNameFromPrompt('kanes boxing gym abu dhabi police raid'),
    'kanes boxing gym abu dhabi',
  );
  assert.equal(
    focalNameFromPrompt(
      'Objective: observe\nLocation: Burj Khalifa\nNotes: none',
    ),
    'Burj Khalifa',
  );
  assert.equal(
    focalNameFromPrompt('first line here\nsecond line'),
    'first line here',
  );
  assert.equal(focalNameFromPrompt(''), 'Requested place');
  assert.ok(focalNameFromPrompt('x'.repeat(500)).length <= 120);
});

const goodSpec = () => ({
  scenarioType: 'police_raid',
  focalEntity: { name: 'Burj Al Arab', kind: 'building' },
  elements: [
    { type: 'inner_cordon', params: { radius_m: 80 } },
    { type: 'outer_cordon', params: { radius_m: 220 } },
    { type: 'approach_route', params: { count: 3 } },
    { type: 'egress_route', params: { count: 1, direction: 'NE' } },
    { type: 'staging_point', params: { direction: 'N' } },
    { type: 'perimeter_unit', params: { count: 6 } },
  ],
  confidence: 0.9,
});

test('repairSceneSpec replaces an unparseable input with the template', () => {
  const out = repairSceneSpec(
    'not even an object',
    'police raid at Burj Al Arab',
  );
  assert.equal(out.repaired, true);
  assert.ok(out.reasons[0].startsWith('invalid spec'));
  assert.equal(out.spec.scenarioType, 'police_raid');
  assert.equal(out.spec.focalEntity.name, 'Burj Al Arab');
  assert.equal(parseSceneSpec(out.spec).ok, true);
  assert.deepEqual(out.rejected, []);

  const partial = repairSceneSpec(
    {
      scenarioType: 'crowd_event',
      focalEntity: { name: 'Dubai Run', kind: 'event' },
    },
    'Dubai Run on Sheikh Zayed Road',
  );
  assert.equal(partial.repaired, true);
  assert.ok(partial.reasons[0].startsWith('invalid spec'));
  assert.equal(partial.spec.scenarioType, 'crowd_event');
  assert.equal(partial.spec.focalEntity.name, 'Dubai Run', 'raw name is kept');
});

test('repairSceneSpec drops an unknown element and records the reason', () => {
  const raw = goodSpec();
  raw.elements.push({ type: 'sniper_nest', params: { count: 1 } });
  const out = repairSceneSpec(raw, 'police raid at Burj Al Arab');
  assert.equal(out.repaired, true);
  assert.ok(
    out.reasons.some((r) =>
      r.startsWith('dropped unknown elements: sniper_nest'),
    ),
  );
  assert.equal(out.rejected.length, 1);
  assert.equal(out.rejected[0].type, 'sniper_nest');
  assert.ok(!out.spec.elements.some((e) => e.type === 'sniper_nest'));
  assert.equal(out.spec.elements.length, 6);
});

test('repairSceneSpec appends missing required elements from the template', () => {
  const raw = goodSpec();
  raw.elements = raw.elements.filter(
    (e) => e.type !== 'staging_point' && e.type !== 'egress_route',
  );
  const out = repairSceneSpec(raw, 'police raid at Burj Al Arab');
  assert.equal(out.repaired, true);
  assert.ok(out.reasons.includes('added missing egress_route from template'));
  assert.ok(out.reasons.includes('added missing staging_point from template'));
  const present = new Set(out.spec.elements.map((e) => e.type));
  for (const required of REQUIRED_ELEMENTS.police_raid)
    assert.ok(present.has(required));
  const egress = out.spec.elements.find((e) => e.type === 'egress_route');
  assert.deepEqual(egress.params, { count: 1, direction: 'NE' });
  assert.equal(parseSceneSpec(out.spec).ok, true);
});

test('repairSceneSpec overrides observation when the prompt says raid', () => {
  const raw = {
    scenarioType: 'observation',
    focalEntity: { name: 'Dubai Marina', kind: 'area' },
    elements: [{ type: 'cctv_signal', params: { count: 3 } }],
    confidence: 0.8,
  };
  const out = repairSceneSpec(raw, 'im doing a raid in the dubai marina');
  assert.equal(out.repaired, true);
  assert.equal(out.spec.scenarioType, 'police_raid');
  assert.ok(
    out.reasons.some((r) => /overridden by prompt keyword rule/.test(r)),
  );
  assert.equal(out.spec.focalEntity.name, 'Dubai Marina');
  const present = new Set(out.spec.elements.map((e) => e.type));
  for (const required of REQUIRED_ELEMENTS.police_raid)
    assert.ok(present.has(required));
});

test('repairSceneSpec applies the focalName override', () => {
  const out = repairSceneSpec(goodSpec(), 'police raid at Burj Al Arab', {
    focalName: 'Burj Al Arab Jumeirah',
  });
  assert.equal(out.spec.focalEntity.name, 'Burj Al Arab Jumeirah');
  assert.equal(out.spec.focalEntity.kind, 'building');
  assert.equal(out.repaired, false, 'a name override alone is not a repair');
  const invalid = repairSceneSpec({}, 'police raid at Burj Al Arab', {
    focalName: 'Override Name',
  });
  assert.equal(invalid.spec.focalEntity.name, 'Override Name');
});

test('repairSceneSpec passes a fully valid spec through untouched', () => {
  const raw = goodSpec();
  const out = repairSceneSpec(raw, 'police raid at Burj Al Arab');
  assert.equal(out.repaired, false);
  assert.deepEqual(out.reasons, []);
  assert.deepEqual(out.rejected, []);
  assert.deepEqual(out.spec, goodSpec());
});
