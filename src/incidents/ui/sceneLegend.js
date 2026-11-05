/**
 * src/incidents/ui/sceneLegend.js
 *
 * Compact, interactive map legend for Scene Spec and legacy plans.
 *
 * Requirements:
 * - COLLAPSED by default (a 28 px pill "Legend" bottom-left of map, #scene-legend, aria-expanded="false").
 * - Expands to list of 24 px backplated icon + label for element types present in current scene.
 * - Shows line styles: routes (glow), cordons (dash), AOI/focal footprint (fill).
 * - Displays the single illustrative badge note ("ILLUSTRATIVE · Not an operational plan").
 * - Methods: setScene(staging|plan), clear(), toggle(), destroy(), getState().
 */
import { STAGING_BADGE_TEXT } from '../../scenes/sceneStaging.js';
import { ELEMENT_LABELS } from './scenePanel.js';
import { ELEMENT_TYPE_ICONS } from '../../scenes/iconBillboard.js';

const DEFAULT_ICON_BASE_URL = '/scene-icons/png/';

export function createSceneLegend({
  document: doc = globalThis.document,
  viewerContainer = null,
  iconBaseUrl = DEFAULT_ICON_BASE_URL,
} = {}) {
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const root = el('aside', 'scene-legend');
  root.id = 'scene-legend';
  root.setAttribute('aria-label', 'Scene map legend');
  root.hidden = true;

  // 28 px pill toggle button (collapsed by default)
  const toggleBtn = el('button', 'scene-legend__toggle', 'Legend');
  toggleBtn.id = 'scene-legend-toggle';
  toggleBtn.type = 'button';
  toggleBtn.setAttribute('aria-expanded', 'false');
  toggleBtn.setAttribute('aria-controls', 'scene-legend-content');

  // Content pane (hidden when collapsed)
  const content = el('div', 'scene-legend__content');
  content.id = 'scene-legend-content';
  content.hidden = true;

  // Header with illustrative badge
  const header = el('div', 'scene-legend__header');
  const badge = el('span', 'scene-legend__badge', 'ILLUSTRATIVE');
  const title = el('strong', 'scene-legend__title', 'Map Legend');
  header.append(badge, title);

  // Dynamic elements list
  const list = el('ul', 'scene-legend__list');
  list.id = 'scene-legend-list';

  // Line styles section
  const linesSection = el('div', 'scene-legend__section');
  const linesTitle = el('span', 'scene-legend__section-title', 'Line Styles');
  const linesList = el('ul', 'scene-legend__lines');

  const lineStyles = [
    {
      role: 'route',
      label: 'Route corridor (glowing teal/mint)',
      cls: 'route',
    },
    {
      role: 'cordon',
      label: 'Cordon boundary (dashed line)',
      cls: 'cordon',
    },
    {
      role: 'aoi',
      label: 'Focal footprint / AOI zone',
      cls: 'aoi',
    },
  ];

  for (const ls of lineStyles) {
    const li = el('li', `scene-legend__line scene-legend__line--${ls.cls}`);
    const swatch = el(
      'span',
      `scene-legend__swatch scene-legend__swatch--${ls.cls}`,
    );
    const label = el('span', 'scene-legend__label', ls.label);
    li.append(swatch, label);
    linesList.append(li);
  }
  linesSection.append(linesTitle, linesList);

  // Footer caveat
  const caveat = el(
    'p',
    'scene-legend__caveat',
    'Illustrative staging derived from OpenStreetMap — not verified deployment.',
  );

  content.append(header, list, linesSection, caveat);
  root.append(toggleBtn, content);

  if (viewerContainer && typeof viewerContainer.append === 'function') {
    viewerContainer.append(root);
  } else if (doc.body && typeof doc.body.append === 'function') {
    doc.body.append(root);
  }

  let isExpanded = false;
  let activeScene = null;

  function toggle(force) {
    isExpanded = typeof force === 'boolean' ? force : !isExpanded;
    toggleBtn.setAttribute('aria-expanded', String(isExpanded));
    toggleBtn.textContent = isExpanded ? 'Legend' : 'Legend';
    content.hidden = !isExpanded;
  }

  toggleBtn.addEventListener?.('click', () => toggle());

  function iconKeyFor(type) {
    return ELEMENT_TYPE_ICONS[type] || type || 'generic';
  }

  function setScene(scene) {
    activeScene = scene || null;
    const staging = scene?.staging || (scene?.spec ? scene : null);
    const plan = scene?.plan || null;

    if (!staging && !plan) {
      root.hidden = true;
      list.replaceChildren();
      return;
    }

    root.hidden = false;
    list.replaceChildren();

    // Determine present element types
    const presentTypes = new Set();

    if (staging?.spec?.elements) {
      for (const el of staging.spec.elements) {
        if (el?.type) presentTypes.add(el.type);
      }
    } else if (staging?.layers?.points?.features) {
      for (const f of staging.layers.points.features) {
        if (f.properties?.element) presentTypes.add(f.properties.element);
      }
    }

    if (scene?.placements) {
      for (const p of scene.placements) {
        if (p?.type) presentTypes.add(p.type);
      }
    }

    if (presentTypes.size === 0) {
      presentTypes.add('generic');
    }

    for (const type of presentTypes) {
      const key = iconKeyFor(type);
      const li = el('li', 'scene-legend__item');
      li.dataset.element = type;
      li.dataset.iconKey = key;

      // 24 px backplated icon
      const iconWrap = el('span', 'scene-legend__icon-wrap');
      const img = el('img', 'scene-legend__icon');
      img.src = `${iconBaseUrl}${key}.png`;
      img.alt = '';
      img.width = 24;
      img.height = 24;
      iconWrap.append(img);

      const labelText = ELEMENT_LABELS[type] || type.replace(/_/g, ' ');
      const label = el('span', 'scene-legend__label', labelText);

      li.append(iconWrap, label);
      list.append(li);
    }
  }

  function clear() {
    activeScene = null;
    root.hidden = true;
    list.replaceChildren();
    if (isExpanded) {
      toggle(false);
    }
  }

  return {
    element: root,
    toggle,
    setScene,
    clear,
    getState: () => ({
      visible: !root.hidden,
      expanded: isExpanded,
      toggleText: toggleBtn.textContent,
      itemCount: list.children?.length || 0,
      badgeText: badge.textContent,
      elements: Array.from(list.children || []).map((li) => ({
        element: li.dataset.element,
        iconKey: li.dataset.iconKey,
        label: li.querySelector?.('.scene-legend__label')?.textContent || '',
      })),
    }),
    destroy: () => root.remove(),
  };
}
