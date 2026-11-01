/**
 * Scene explanation panel (left panel redesign). Pure DOM, no Cesium:
 *   Title · one-line summary · Scenario · Location + confidence badge
 *   (verified / approximate) · Elements list with icon + count · Sources as
 *   numbered link chips · ONE caveat line · "Built with <model> in <ms>".
 * 14–16 px type, line-height 1.5, no raw '[1,2,3]' tokens, no stacked banners.
 */
import { cleanMapLabel, stagingCounts } from '../../scenes/sceneStaging.js';
import { SCENARIO_LABELS } from '../../scenes/sceneTemplates.js';

export const ELEMENT_LABELS = Object.freeze({
  focal: 'Focal footprint',
  inner_cordon: 'Inner cordon',
  outer_cordon: 'Outer cordon',
  approach_route: 'Approach routes',
  egress_route: 'Egress route',
  staging_point: 'Staging point',
  perimeter_unit: 'Perimeter units',
  checkpoint: 'Checkpoints',
  cones: 'Traffic cones',
  barriers: 'Barriers',
  cctv_signal: 'Camera / signal markers',
  crowd_zone: 'Crowd zones',
  route_line: 'Route corridor',
  start_finish: 'Start / finish',
  threat_zone: 'Threat zones',
  interest_zone: 'Interest zones',
  crowd_density_zone: 'Crowd density zones',
  overwatch: 'Overwatch positions',
  command_post: 'Command posts',
  cordon_node: 'Cordon nodes',
  cctv_pick: 'CCTV cameras',
  intel_note: 'Intel notes',
  timeline_event: 'Timeline events',
  generic: 'Generic markers',
});
export const ELEMENT_ICONS = Object.freeze({
  focal: null,
  inner_cordon: 'perimeter_unit',
  outer_cordon: 'perimeter_unit',
  approach_route: 'egress',
  egress_route: 'egress',
  staging_point: 'staging_point',
  perimeter_unit: 'police_unit',
  checkpoint: 'checkpoint',
  cones: 'cone',
  barriers: 'barrier',
  cctv_signal: 'cctv_signal',
  crowd_zone: 'crowd_zone',
  route_line: 'start_finish',
  start_finish: 'start_finish',
  threat_zone: 'checkpoint',
  interest_zone: 'perimeter_unit',
  crowd_density_zone: 'crowd_zone',
  overwatch: 'command_post',
  command_post: 'command_post',
  cordon_node: 'cordon_node',
  cctv_pick: 'cctv',
  intel_note: null,
  timeline_event: null,
  generic: 'generic',
});
const CAVEAT =
  'Illustrative staging derived from OpenStreetMap data and a scenario template — not a verified deployment, operation or incident.';

export function modelLine(model) {
  if (!model) return '';
  const name =
    model.provider === 'template'
      ? 'scenario template (no model)'
      : model.provider === 'cerebras-direct'
        ? `Cerebras ${model.id}`
        : `OnDemand ${model.endpointId || model.id}`;
  const ms = Number.isFinite(model.latencyMs)
    ? Math.round(model.latencyMs)
    : null;
  return `Built with ${name}${ms !== null ? ` in ${ms} ms` : ''}${model.fallback ? ' · fallback' : ''}`;
}

export function locationBadgeText(resolution) {
  if (!resolution) return { kind: 'verified', text: 'Location verified' };
  const pct = Math.round((resolution.confidence || 0) * 100);
  if (resolution.approximate)
    return { kind: 'approximate', text: `Approximate · ${pct}% confidence` };
  return { kind: 'verified', text: `Verified · ${pct}% confidence` };
}

/** Deduplicated source chips: {number, url, title, host}. */
export function sourceChips(citations = [], max = 12) {
  const out = [];
  const seen = new Set();
  for (const c of citations) {
    if (!c?.url || seen.has(c.url)) continue;
    seen.add(c.url);
    let host = '';
    try {
      host = new URL(c.url).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
    out.push({
      number: out.length + 1,
      url: c.url,
      title: cleanMapLabel(c.title || host, 60),
      host,
    });
    if (out.length >= max) break;
  }
  return out;
}

export function createScenePanel({
  document: doc = globalThis.document,
  iconBaseUrl = '/scene-icons/svg/',
} = {}) {
  const el = (tag, className, text) => {
    const n = doc.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const root = el('section', 'scene-panel');
  root.id = 'scene-panel';
  root.hidden = true;
  root.setAttribute('aria-label', 'Scene explanation');
  const title = el('h3', 'scene-panel__title');
  title.id = 'scene-panel-title';
  const summary = el('p', 'scene-panel__summary');
  summary.id = 'scene-panel-summary';
  const facts = el('dl', 'scene-panel__facts');
  const scenarioT = el('dt', '', 'Scenario');
  const scenarioD = el('dd', 'scene-panel__scenario');
  scenarioD.id = 'scene-panel-scenario';
  const locationT = el('dt', '', 'Location');
  const locationD = el('dd', 'scene-panel__location');
  locationD.id = 'scene-panel-location';
  facts.append(scenarioT, scenarioD, locationT, locationD);
  const elementsHead = el('h4', 'scene-panel__head', 'Elements');
  const elements = el('ul', 'scene-panel__elements');
  elements.id = 'scene-panel-elements';
  const sourcesHead = el('h4', 'scene-panel__head', 'Sources');
  const sources = el('ol', 'scene-panel__sources');
  sources.id = 'scene-panel-sources';
  const caveat = el('p', 'scene-panel__caveat', CAVEAT);
  caveat.id = 'scene-panel-caveat';
  const built = el('p', 'scene-panel__built');
  built.id = 'scene-panel-built';
  root.append(
    title,
    summary,
    facts,
    elementsHead,
    elements,
    sourcesHead,
    sources,
    caveat,
    built,
  );

  function setScene(scene) {
    const staging = scene?.staging || null;
    root.hidden = !staging;
    if (!staging) {
      root.removeAttribute('data-scenario');
      return;
    }
    const spec = staging.spec;
    root.dataset.scenario = spec.scenarioType;
    root.dataset.modelProvider = staging.model.provider;
    title.textContent = cleanMapLabel(
      scene.title || spec.focalEntity.name || staging.anchor.name,
      80,
    );
    summary.textContent =
      staging.summary ||
      `${SCENARIO_LABELS[spec.scenarioType]} around ${staging.anchor.name}.`;
    scenarioD.textContent =
      SCENARIO_LABELS[spec.scenarioType] || spec.scenarioType;
    const badge = locationBadgeText(scene.locationResolution);
    locationD.replaceChildren();
    const chip = el(
      'span',
      `scene-panel__badge scene-panel__badge--${badge.kind}`,
      badge.text,
    );
    chip.id = 'scene-panel-location-badge';
    chip.dataset.kind = badge.kind;
    locationD.append(
      el(
        'span',
        'scene-panel__location-name',
        cleanMapLabel(staging.anchor.name.split(',').slice(0, 2).join(','), 80),
      ),
      chip,
    );
    elements.replaceChildren();
    const counts = stagingCounts(staging);
    const present = spec.elements
      .map((e) => e.type)
      .filter((t, i, a) => a.indexOf(t) === i);
    for (const type of present) {
      const li = el('li', 'scene-panel__element');
      li.dataset.element = type;
      const icon = ELEMENT_ICONS[type];
      if (icon) {
        const img = el('img', 'scene-panel__icon');
        img.src = `${iconBaseUrl}${icon}.svg`;
        img.alt = '';
        img.width = 18;
        img.height = 18;
        li.append(img);
      }
      const n =
        type === 'cctv_signal' ? (scene.cameraMarkers ?? 0) : counts[type] || 0;
      const unavailable = staging.unavailable.find((u) => u.element === type);
      li.append(
        el('span', 'scene-panel__element-label', ELEMENT_LABELS[type] || type),
      );
      const count = el(
        'span',
        'scene-panel__count',
        n ? `× ${n}` : unavailable ? 'not derived' : '× 0',
      );
      count.title = unavailable ? unavailable.reason : '';
      li.append(count);
      elements.append(li);
    }
    sources.replaceChildren();
    const chips = sourceChips([
      ...(scene.citations || []),
      ...(scene.geometry?.citations || []),
    ]);
    for (const c of chips) {
      const li = el('li');
      const a = el('a', 'scene-panel__source', `${c.number} · ${c.host}`);
      a.href = c.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = c.title;
      li.append(a);
      sources.append(li);
    }
    sourcesHead.hidden = sources.hidden = chips.length === 0;
    built.textContent = modelLine(staging.model);
    built.dataset.latencyMs = String(Math.round(staging.model.latencyMs || 0));
    built.dataset.totalMs = String(Math.round(staging.timing?.totalMs || 0));
  }
  return {
    element: root,
    setScene,
    getState: () => ({
      visible: !root.hidden,
      title: title.textContent,
      summary: summary.textContent,
      scenario: scenarioD.textContent,
      locationBadge:
        root.querySelector?.('#scene-panel-location-badge')?.textContent ||
        null,
      elements: [...(elements.children || [])].map((li) => li.textContent),
      sources: [...(sources.children || [])].length,
      built: built.textContent,
    }),
    destroy: () => root.remove(),
  };
}
