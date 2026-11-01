/**
 * Scenario templates — the deterministic last line of the fast-model fallback
 * chain. A scene ALWAYS builds: if every model fails, times out, or returns an
 * invalid spec, the prompt is classified with these keyword rules and the
 * matching template becomes the Scene Spec. Templates also repair partially
 * valid specs (unknown element types, missing mandatory elements).
 *
 * Browser + Node, dependency-free apart from the DSL.
 */
import {
  parseSceneSpec,
  SCENARIO_TYPES,
  ELEMENT_TYPES,
  SPEC_LIMITS,
} from './sceneSpec.js';

const el = (type, params = {}) => ({ type, params });

/** Canonical element lists per scenario. Numbers are illustrative defaults. */
export const SCENARIO_TEMPLATES = Object.freeze({
  police_raid: Object.freeze([
    el('inner_cordon', { radius_m: 80 }),
    el('outer_cordon', { radius_m: 220 }),
    el('approach_route', { count: 3 }),
    el('egress_route', { count: 1, direction: 'NE' }),
    el('staging_point', { direction: 'N' }),
    el('perimeter_unit', { count: 6 }),
    el('checkpoint', { count: 2 }),
    el('cones', { spacing_m: 8 }),
    el('barriers', { spacing_m: 25 }),
    el('cctv_signal', { count: 3 }),
  ]),
  perimeter_cordon: Object.freeze([
    el('inner_cordon', { radius_m: 100 }),
    el('outer_cordon', { radius_m: 300 }),
    el('perimeter_unit', { count: 8 }),
    el('checkpoint', { count: 3 }),
    el('barriers', { spacing_m: 30 }),
    el('cctv_signal', { count: 3 }),
    el('staging_point', { direction: 'N' }),
  ]),
  route_closure: Object.freeze([
    el('route_line', { radius_m: 1500 }),
    el('cones', { spacing_m: 12 }),
    el('barriers', { spacing_m: 60 }),
    el('checkpoint', { count: 2 }),
    el('egress_route', { count: 1, direction: 'S' }),
    el('cctv_signal', { count: 3 }),
  ]),
  crowd_event: Object.freeze([
    el('route_line', { radius_m: 2000 }),
    el('start_finish', { count: 1 }),
    el('crowd_zone', { radius_m: 120, count: 2 }),
    el('barriers', { spacing_m: 40 }),
    el('perimeter_unit', { count: 4 }),
    el('staging_point', { direction: 'N' }),
    el('cctv_signal', { count: 3 }),
  ]),
  motorcade: Object.freeze([
    el('route_line', { radius_m: 2500 }),
    el('approach_route', { count: 1 }),
    el('egress_route', { count: 1, direction: 'E' }),
    el('checkpoint', { count: 3 }),
    el('cones', { spacing_m: 20 }),
    el('perimeter_unit', { count: 4 }),
    el('cctv_signal', { count: 2 }),
  ]),
  observation: Object.freeze([
    el('cctv_signal', { count: 3 }),
    el('perimeter_unit', { count: 2 }),
    el('crowd_zone', { radius_m: 80, count: 1 }),
  ]),
});

/** Elements a scenario must contain for the renderer to show a complete scene. */
export const REQUIRED_ELEMENTS = Object.freeze({
  police_raid: Object.freeze([
    'inner_cordon',
    'outer_cordon',
    'approach_route',
    'egress_route',
    'staging_point',
    'perimeter_unit',
  ]),
  perimeter_cordon: Object.freeze([
    'inner_cordon',
    'outer_cordon',
    'perimeter_unit',
  ]),
  route_closure: Object.freeze(['route_line', 'cones']),
  crowd_event: Object.freeze(['route_line', 'start_finish']),
  motorcade: Object.freeze(['route_line', 'checkpoint']),
  observation: Object.freeze(['cctv_signal']),
});

/** Human readable labels (no bracketed citations, no "ILLUSTRATIVE" prefix). */
export const SCENARIO_LABELS = Object.freeze({
  police_raid: 'Police raid (illustrative)',
  route_closure: 'Route closure (illustrative)',
  crowd_event: 'Crowd / mass-participation event (illustrative)',
  perimeter_cordon: 'Perimeter cordon (illustrative)',
  motorcade: 'Motorcade (illustrative)',
  observation: 'Observation (illustrative)',
});

const RULES = [
  [
    'police_raid',
    /\b(raid|raided|raiding|bust|swat|tactical entry|warrant|arrest operation|sting)\b/i,
  ],
  [
    'motorcade',
    /\b(motorcade|convoy|vip movement|presidential route|escort(ed)? route)\b/i,
  ],
  [
    'crowd_event',
    /\b(marathon|run|race|parade|festival|concert|rally|fun run|10k|5k|half[- ]marathon|triathlon|cycle (race|ride)|crowd)\b/i,
  ],
  [
    'route_closure',
    /\b(road closure|closed road|closure|detour|diversion|lane closure|roadblock|road block)\b/i,
  ],
  [
    'perimeter_cordon',
    /\b(cordon|perimeter|lockdown|secure(d)? area|exclusion zone|bomb threat|evacuat\w+)\b/i,
  ],
  [
    'observation',
    /\b(observe|observation|watch|monitor|surveil\w*|cctv|camera)\b/i,
  ],
];

/** Deterministic keyword classifier (the reference fallback). */
export function classifyPrompt(prompt) {
  const text = String(prompt || '');
  for (const [type, rx] of RULES) if (rx.test(text)) return type;
  return 'observation';
}

/** Numbers the user typed ("4 approach routes", "200 m cordon") refine the template. */
export function promptHints(prompt) {
  const text = String(prompt || '').toLowerCase();
  const hints = {};
  const m = text.match(
    /(\d{2,4})\s*(?:m|metre|meter)s?\b[^.]{0,20}\b(cordon|perimeter)/,
  );
  if (m) hints.cordonRadiusM = Math.min(SPEC_LIMITS.radiusM.max, Number(m[1]));
  const r = text.match(
    /(\d{1,2})\s*(?:approach )?(?:routes?|roads?|entry points?)\b/,
  );
  if (r) hints.approachRoutes = Math.max(1, Math.min(6, Number(r[1])));
  const d = text.match(
    /\b(?:from|via|toward|towards|to) the (north[- ]?east|north[- ]?west|south[- ]?east|south[- ]?west|north|south|east|west)\b/,
  );
  if (d)
    hints.direction = d[1]
      .replace(/[- ]/g, '')
      .replace(/north/, 'N')
      .replace(/south/, 'S')
      .replace(/east/, 'E')
      .replace(/west/, 'W')
      .toUpperCase();
  return hints;
}

/** First line / explicit "Location:" / strip scenario verbs → focal entity name. */
export function focalNameFromPrompt(prompt) {
  const text = String(prompt || '').trim();
  const explicit = text.match(/^\s*(?:location|place)\s*:\s*([^\r\n]+)/im);
  const line = (
    explicit ? explicit[1] : text.split(/\r?\n/)[0] || 'Requested place'
  )
    .replace(
      /\b(i'?m|im|we'?re|doing|planning|a|an|the|police|raid|at|in|near|around|on|for|of|operation|scene|build|cordon|closure|motorcade|observation|event)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return (line || text.split(/\r?\n/)[0] || 'Requested place').slice(
    0,
    SPEC_LIMITS.nameMax,
  );
}

/** Build a full spec from the template for `scenarioType` and the prompt. */
export function templateSpec(
  prompt,
  scenarioType = classifyPrompt(prompt),
  focalName,
) {
  const type = SCENARIO_TYPES.includes(scenarioType)
    ? scenarioType
    : 'observation';
  const hints = promptHints(prompt);
  const elements = SCENARIO_TEMPLATES[type].map((e) => ({
    type: e.type,
    params: { ...e.params },
  }));
  for (const e of elements) {
    if (hints.cordonRadiusM && e.type === 'outer_cordon')
      e.params.radius_m = hints.cordonRadiusM;
    if (hints.cordonRadiusM && e.type === 'inner_cordon')
      e.params.radius_m = Math.max(
        SPEC_LIMITS.radiusM.min,
        Math.round(hints.cordonRadiusM * 0.4),
      );
    if (hints.approachRoutes && e.type === 'approach_route')
      e.params.count = hints.approachRoutes;
    if (hints.direction && ['staging_point', 'egress_route'].includes(e.type))
      e.params.direction = hints.direction;
  }
  return {
    scenarioType: type,
    focalEntity: {
      name: focalName || focalNameFromPrompt(prompt),
      kind: 'unknown',
    },
    elements,
    confidence: 0.35,
  };
}

/**
 * Repair a (possibly invalid) model output using the template:
 * - unknown element types are already dropped by the parser (reported);
 * - missing REQUIRED elements are appended from the template;
 * - an unparseable spec is replaced wholesale by the template.
 * Returns `{spec, repaired:boolean, reasons:string[], rejected:[]}`.
 */
export function repairSceneSpec(raw, prompt, { focalName } = {}) {
  const parsed = parseSceneSpec(raw);
  const reasons = [];
  if (!parsed.ok) {
    const scenario =
      raw &&
      typeof raw === 'object' &&
      SCENARIO_TYPES.includes(raw.scenarioType)
        ? raw.scenarioType
        : classifyPrompt(prompt);
    const name =
      focalName ||
      (raw &&
      typeof raw.focalEntity?.name === 'string' &&
      raw.focalEntity.name.trim()
        ? raw.focalEntity.name.trim().slice(0, SPEC_LIMITS.nameMax)
        : undefined);
    reasons.push(
      `invalid spec: ${parsed.issues
        .map((i) => `${i.path || 'spec'} ${i.message}`)
        .join('; ')
        .slice(0, 300)}`,
    );
    return {
      spec: templateSpec(prompt, scenario, name),
      repaired: true,
      reasons,
      rejected: parsed.rejected,
    };
  }
  const spec = parsed.spec;
  if (parsed.rejected.length)
    reasons.push(
      `dropped unknown elements: ${parsed.rejected.map((r) => r.type).join(', ')}`,
    );
  const present = new Set(spec.elements.map((e) => e.type));
  const template = SCENARIO_TEMPLATES[spec.scenarioType];
  for (const required of REQUIRED_ELEMENTS[spec.scenarioType] || []) {
    if (present.has(required)) continue;
    const t = template.find((e) => e.type === required);
    if (t && spec.elements.length < SPEC_LIMITS.maxElements) {
      spec.elements.push({ type: t.type, params: { ...t.params } });
      present.add(required);
      reasons.push(`added missing ${required} from template`);
    }
  }
  // A prompt that is unmistakably a raid must not be downgraded to observation.
  const keyword = classifyPrompt(prompt);
  if (keyword === 'police_raid' && spec.scenarioType !== 'police_raid') {
    reasons.push(
      `scenario ${spec.scenarioType} overridden by prompt keyword rule`,
    );
    return {
      spec: templateSpec(
        prompt,
        'police_raid',
        focalName || spec.focalEntity.name,
      ),
      repaired: true,
      reasons,
      rejected: parsed.rejected,
    };
  }
  if (focalName && spec.focalEntity.name !== focalName)
    spec.focalEntity = { ...spec.focalEntity, name: focalName };
  return {
    spec,
    repaired: reasons.length > 0,
    reasons,
    rejected: parsed.rejected,
  };
}

export { ELEMENT_TYPES, SCENARIO_TYPES };
