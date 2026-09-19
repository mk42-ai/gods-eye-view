/**
 * Boundary: the UI renders inline Lucide SVG icons, never emoji or text
 * glyphs. Fails when an emoji code point or an icon-glyph appears in UI
 * source (JS / HTML templates / CSS / index.html / public HTML), when a layer
 * declares an icon name the registry does not know, or when the rendered
 * DATA LAYERS panel carries a glyph in any text node or a row without an
 * inline <svg>. Mapping and evidence: docs/brand/ICON_SOURCE.md.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandApplicationHtml } from '../build/application-html.js';
import {
  ICON_CLASS,
  ICON_FALLBACK,
  LUCIDE_VERSION,
  createIcon,
  hasIcon,
  iconMarkup,
  iconNames,
} from './ui/icons/layerIcon.js';

const SRC_ROOT = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = path.resolve(SRC_ROOT, '..');

/**
 * The scanner itself lives in scripts/check-icon-glyphs.mjs so that
 * `npm run check:boundaries` runs the identical scan; this file adds the
 * assembled-markup, registry and rendered-DOM checks on top. Block Elements
 * (U+2580-259F) stay allowed: the chat caret is a text cursor, not an icon.
 */
import {
  CODE_ONLY_BLOCKS,
  FORBIDDEN_BLOCKS,
  checkIconGlyphs,
  findForbiddenGlyphs,
  uiSourceFiles as scanFiles,
} from '../scripts/check-icon-glyphs.mjs';

export { findForbiddenGlyphs };

function uiSourceFiles() {
  return scanFiles(REPO_ROOT);
}

test('UI source files carry no emoji or icon-glyph code points (boundaries gate scanner)', () => {
  const { files, offenders } = checkIconGlyphs(REPO_ROOT);
  assert.ok(files > 400, `scanned ${files} UI source files`);
  assert.equal(FORBIDDEN_BLOCKS.length, 9);
  assert.equal(CODE_ONLY_BLOCKS.length, 1);
  assert.deepEqual(
    offenders,
    [],
    `Emoji / glyph icons in UI source (use src/ui/icons/layerIcon.js):\n${offenders.join('\n')}`,
  );
  // The scanner catches every encoding a glyph can hide behind.
  assert.deepEqual(findForbiddenGlyphs('plain text · — … ° 1×'), []);
  assert.equal(findForbiddenGlyphs('a \u{1F6F0}\uFE0F b').length, 2);
  assert.equal(
    findForbiddenGlyphs('&#x1F6F0; &#9650; \\u{1F6F0} \\u25B2 \\uD83D\\uDEF0')
      .length,
    5,
  );
  // Arrows: an icon glyph in code fails, a comment or the → separator does not.
  assert.equal(
    findForbiddenGlyphs("label: '\u21C4'", { file: 'x.js' }).length,
    1,
  );
  assert.equal(
    findForbiddenGlyphs("// A \u2194 B\nconst r = 'AUS \u2192 LAX';", {
      file: 'x.js',
    }).length,
    0,
  );
  assert.equal(
    findForbiddenGlyphs('<!-- \u21BB --><span>\u21BB</span>', {
      file: 'x.html',
    }).length,
    1,
  );
});

test('the assembled application markup renders icons, not glyphs', () => {
  const html = expandApplicationHtml(
    readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8'),
  );
  assert.deepEqual(findForbiddenGlyphs(html), []);
  // Every former glyph slot is an inline Lucide icon.
  const icons = [...html.matchAll(/<svg [^>]*data-icon="([a-z0-9-]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(icons.length >= 30, `expected inline icons, found ${icons.length}`);
  for (const name of icons)
    assert.ok(hasIcon(name), `unregistered icon ${name}`);
  for (const expected of [
    'chevron-left',
    'skip-back',
    'play',
    'skip-forward',
    'plus',
    'map-pin',
    'search',
    'link',
    'moon',
    'thermometer',
    'snowflake',
  ])
    assert.ok(icons.includes(expected), `template lacks ${expected}`);
});

test('every layer icon declared in source is a registered Lucide icon', () => {
  const declared = new Map();
  for (const file of uiSourceFiles()) {
    if (!/\.(?:js|mjs)$/.test(file)) continue;
    const source = readFileSync(file, 'utf8');
    // Icon-name shaped values only; a glyph value is caught by the code-point
    // scan above and a data: URL is an image, not a registry name.
    for (const match of source.matchAll(
      /\bicon(?:\s*[:=]|\s*\?\?)\s*'([a-z0-9-]+)'/g,
    ))
      declared.set(`${path.relative(REPO_ROOT, file)} → ${match[1]}`, match[1]);
    for (const match of source.matchAll(
      /icon(?:Markup|Content)?\(\s*'([a-z0-9-]+)'/g,
    ))
      declared.set(`${path.relative(REPO_ROOT, file)} → ${match[1]}`, match[1]);
  }
  assert.ok(declared.size >= 20, 'layer icon declarations were not found');
  const unknown = [...declared].filter(([, name]) => !hasIcon(name));
  assert.deepEqual(
    unknown.map(([where]) => where),
    [],
    'icon names must exist in src/ui/icons/lucide-manifest.json',
  );
});

test('manifest, generated registry and public/icons agree', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(SRC_ROOT, 'ui/icons/lucide-manifest.json'), 'utf8'),
  );
  assert.equal(manifest.version, LUCIDE_VERSION);
  assert.equal(manifest.license, 'ISC');
  const names = manifest.icons.map((entry) => entry.name);
  assert.deepEqual(iconNames(), names, 'registry order follows the manifest');
  assert.ok(names.includes(ICON_FALLBACK));
  const iconsDir = path.join(REPO_ROOT, 'public/icons');
  assert.ok(
    existsSync(path.join(iconsDir, 'LICENSE')),
    'LICENSE ships with the icons',
  );
  const shipped = readdirSync(iconsDir)
    .filter((file) => file.endsWith('.svg'))
    .map((file) => file.replace(/\.svg$/, ''))
    .sort();
  assert.deepEqual(shipped, [...names].sort());
  for (const name of names) {
    const svg = readFileSync(path.join(iconsDir, `${name}.svg`), 'utf8');
    for (const attribute of [
      'viewBox="0 0 24 24"',
      'fill="none"',
      'stroke="currentColor"',
      'stroke-width="2"',
      'stroke-linecap="round"',
      'stroke-linejoin="round"',
    ])
      assert.ok(svg.includes(attribute), `${name}.svg lacks ${attribute}`);
    assert.doesNotMatch(svg, /\bclass=/, `${name}.svg keeps a class attribute`);
  }
  const pkg = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
  );
  assert.equal(
    pkg.devDependencies['lucide-static'],
    manifest.version,
    'exact pin',
  );
});

test('iconMarkup is accessible by construction', () => {
  const decorative = iconMarkup('satellite');
  assert.match(decorative, /^<svg /);
  assert.match(decorative, /aria-hidden="true"/);
  assert.match(decorative, /focusable="false"/);
  assert.doesNotMatch(decorative, /<title>/);
  assert.match(
    decorative,
    new RegExp(`class="${ICON_CLASS} ${ICON_CLASS}--satellite"`),
  );
  const labelled = iconMarkup('circle', {
    label: 'Recording',
    className: 'od-icon--solid',
  });
  assert.match(labelled, /role="img"/);
  assert.match(labelled, /aria-label="Recording"/);
  assert.match(labelled, /<title>Recording<\/title>/);
  assert.match(labelled, /od-icon--solid/);
  assert.deepEqual(findForbiddenGlyphs(iconMarkup('layers')), []);
});

test('every mapped icon renders an <svg> on currentColor with a <title>/aria-label', async () => {
  const documentRef = fakeDocument();
  for (const name of iconNames()) {
    // Standalone form: role="img" + aria-label + <title> carrying the same name.
    const labelled = iconMarkup(name, { label: `${name} icon` });
    assert.match(labelled, /^<svg [^>]*\bstroke="currentColor"[^>]*>/, name);
    assert.match(labelled, /\bfill="none"/, name);
    assert.match(labelled, /\bstroke-width="2"/, name);
    assert.match(labelled, /\bviewBox="0 0 24 24"/, name);
    assert.match(labelled, /\brole="img"/, name);
    assert.match(labelled, new RegExp(`aria-label="${name} icon"`), name);
    assert.match(labelled, new RegExp(`<title>${name} icon</title>`), name);
    assert.match(labelled, /<\/svg>$/, name);
    assert.doesNotMatch(
      labelled,
      /\b(?:fill|stroke)="#[0-9a-f]{3,6}"/i,
      `${name}: hard-coded colour`,
    );
    assert.deepEqual(findForbiddenGlyphs(labelled), [], name);
    // Decorative form beside a visible label: hidden from the tree, no <title>.
    const decorative = iconMarkup(name);
    assert.match(decorative, /\baria-hidden="true"/, name);
    assert.doesNotMatch(decorative, /<title>/, name);
    // Live element form (createIcon): same contract on a real namespaced element.
    const element = createIcon(name, { label: `${name} icon` }, documentRef);
    assert.ok(element, name);
    assert.equal(element.tagName, 'svg');
    assert.equal(element.namespace, 'http://www.w3.org/2000/svg');
    assert.equal(element.getAttribute('stroke'), 'currentColor');
    assert.equal(element.getAttribute('fill'), 'none');
    assert.equal(element.getAttribute('data-icon'), name);
    assert.equal(element.getAttribute('role'), 'img');
    assert.equal(element.getAttribute('aria-label'), `${name} icon`);
    const title = element.children.find((node) => node.tagName === 'title');
    assert.ok(title, `${name}: <title> element`);
    assert.equal(title.textContent, `${name} icon`);
    assert.ok(element.innerHTML.length > 0, `${name}: icon body`);
  }
});

// ── Rendered DATA LAYERS panel ───────────────────────────────────────────────

class FakeNode {
  constructor(tagName, namespace = null) {
    this.tagName = tagName;
    this.namespace = namespace;
    this.childNodes = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.parentNode = null;
    this.nodeValue = null;
    this._className = '';
    this._hidden = false;
    const classes = () => new Set(this._className.split(/\s+/).filter(Boolean));
    this.classList = {
      toggle: (name, force) => {
        const set = classes();
        const on = force === undefined ? !set.has(name) : Boolean(force);
        if (on) set.add(name);
        else set.delete(name);
        this._className = [...set].join(' ');
        return on;
      },
      add: (...names) => {
        const set = classes();
        for (const name of names) set.add(name);
        this._className = [...set].join(' ');
      },
      contains: (name) => classes().has(name),
    };
  }
  get className() {
    return this._className;
  }
  set className(value) {
    this._className = String(value);
  }
  get hidden() {
    return this._hidden;
  }
  set hidden(value) {
    this._hidden = Boolean(value);
  }
  get children() {
    return this.childNodes.filter((node) => node instanceof FakeNode);
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  append(...nodes) {
    for (const node of nodes)
      this.appendChild(typeof node === 'string' ? new FakeText(node) : node);
  }
  insertBefore(node, reference) {
    const at = this.childNodes.indexOf(reference);
    if (at < 0) return this.appendChild(node);
    node.parentNode = this;
    this.childNodes.splice(at, 0, node);
    return node;
  }
  removeChild(node) {
    this.childNodes = this.childNodes.filter((child) => child !== node);
    node.parentNode = null;
    return node;
  }
  replaceChildren(...nodes) {
    for (const child of [...this.childNodes]) this.removeChild(child);
    for (const node of nodes) this.appendChild(node);
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  addEventListener() {}
  removeEventListener() {}
  get textContent() {
    return this.childNodes.map((node) => node.textContent).join('');
  }
  set textContent(value) {
    this.replaceChildren(new FakeText(String(value ?? '')));
  }
  set innerHTML(value) {
    // Only the icon registry writes markup here (into an <svg>); a container
    // is only ever cleared. Keep the markup as a text-free marker.
    this.replaceChildren();
    if (value) this._innerHTML = String(value);
  }
  get innerHTML() {
    return this._innerHTML || '';
  }
  matchesSelector(selector) {
    const byClass = /^\.([\w-]+)$/.exec(selector);
    if (byClass) return this.classList.contains(byClass[1]);
    const byData = /^\[data-([\w-]+)="([^"]*)"\]$/.exec(selector);
    if (byData) {
      const key = byData[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return this.dataset[key] === byData[2];
    }
    return this.tagName === selector;
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matchesSelector(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

class FakeText {
  constructor(text) {
    this.nodeValue = text;
    this.parentNode = null;
  }
  get textContent() {
    return this.nodeValue;
  }
}

function fakeDocument() {
  return {
    hidden: false,
    createElement: (tag) => new FakeNode(tag),
    createElementNS: (namespace, tag) => new FakeNode(tag, namespace),
    createTextNode: (text) => new FakeText(text),
  };
}

function textNodes(node, out = []) {
  for (const child of node.childNodes) {
    if (child instanceof FakeText) out.push(child.nodeValue);
    else textNodes(child, out);
  }
  return out;
}

const MOVEMENT_LAYERS = [
  [
    'satellites',
    'Satellites',
    'satellite',
    'CelesTrak',
    { status: 'unavailable', error: 'CelesTrak unreachable' },
  ],
  [
    'flights',
    'Live Flights',
    'plane',
    'OpenSky',
    { count: 412, lastUpdate: Date.now(), providerStatus: 'live' },
  ],
  [
    'military',
    'Military Flights',
    'shield',
    'adsb.lol',
    { count: 9, lastUpdate: Date.now(), stale: true },
  ],
  [
    'ais-live-vessels',
    'Live Vessels',
    'ship',
    'AISStream',
    { status: 'degraded', providerError: 'demo replay' },
  ],
  [
    'traffic',
    'Street Traffic',
    'car',
    'TomTom',
    { count: 120, lastUpdate: Date.now() },
  ],
  ['transit', 'Transit', 'bus', 'MBTA', { count: 30, lastUpdate: Date.now() }],
  [
    'bikeshare',
    'Bike Share',
    'bike',
    'GBFS',
    { count: 44, lastUpdate: Date.now() },
  ],
];

async function renderPanel(layers) {
  const documentRef = fakeDocument();
  const previous = globalThis.document;
  globalThis.document = documentRef;
  try {
    const { LayerPanel } = await import('./ui/layerPanel.js');
    const panel = new LayerPanel({
      getLayers: () => layers,
      isEnabled: (id) => layers.find((layer) => layer.id === id)?.enabled,
      setEnabled: async () => {},
      setLayerParams: () => {},
      getRowControls: () => null,
      hasRowControls: () => false,
      subscribeRowControls: () => null,
    });
    const container = new FakeNode('div');
    panel.mount(container);
    return { panel, container };
  } finally {
    globalThis.document = previous;
  }
}

test('DATA LAYERS rows render an inline <svg> icon and no glyph text', async () => {
  const layers = MOVEMENT_LAYERS.map(([id, name, icon, source, stats]) => ({
    id,
    name,
    icon,
    source,
    enabled: true,
    showInTogglePanel: true,
    stats,
  }));
  const { container } = await renderPanel(layers);
  const rows = container.querySelectorAll('.data-toggle-row');
  assert.equal(rows.length, MOVEMENT_LAYERS.length);
  for (const [index, row] of rows.entries()) {
    const [id, , icon] = MOVEMENT_LAYERS[index];
    assert.equal(row.dataset.layerId, id);
    const slot = row.querySelector('.data-icon');
    assert.ok(slot, `${id}: icon slot`);
    const svg = slot.children.find((node) => node.tagName === 'svg');
    assert.ok(svg, `${id}: inline <svg>`);
    assert.equal(svg.namespace, 'http://www.w3.org/2000/svg');
    assert.equal(svg.getAttribute('data-icon'), icon);
    assert.equal(svg.getAttribute('stroke'), 'currentColor');
    assert.equal(svg.getAttribute('fill'), 'none');
    assert.equal(svg.getAttribute('stroke-width'), '2');
    assert.equal(
      svg.getAttribute('aria-hidden'),
      'true',
      'decorative beside the visible name',
    );
    assert.equal(
      textNodes(slot).join(''),
      '',
      'no glyph text in the icon slot',
    );
    assert.ok(
      row.dataset.feedState,
      `${id}: row carries its feed state for the icon colour`,
    );
  }
  // Status colour hooks: unavailable / live / stale / degraded rows are distinguishable.
  const state = Object.fromEntries(
    rows.map((row) => [row.dataset.layerId, row.dataset.feedState]),
  );
  assert.equal(state.satellites, 'unavailable');
  assert.equal(state.flights, 'nominal');
  assert.equal(state.military, 'stale');
  assert.equal(state['ais-live-vessels'], 'degraded');
  const glyphs = textNodes(container).flatMap((text) =>
    findForbiddenGlyphs(text),
  );
  assert.deepEqual(
    glyphs,
    [],
    'rendered DATA LAYERS text carries no emoji / glyphs',
  );
});

test('a legacy emoji icon value still renders an <svg>, never the glyph', async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const { container } = await renderPanel([
      {
        id: 'legacy',
        name: 'Legacy layer',
        icon: '\u{1F6F0}\uFE0F',
        source: 'test',
        enabled: false,
        showInTogglePanel: true,
        stats: {},
      },
    ]);
    const slot = container.querySelector('.data-icon');
    const svg = slot.children.find((node) => node.tagName === 'svg');
    assert.ok(svg, 'fallback icon rendered');
    assert.equal(svg.getAttribute('data-icon'), ICON_FALLBACK);
    assert.deepEqual(textNodes(slot), []);
    assert.equal(
      container.querySelector('.data-toggle-row').dataset.feedState,
      'off',
    );
    assert.ok(
      warnings.some((line) => line.includes('not a registered Lucide icon')),
    );
  } finally {
    console.warn = originalWarn;
  }
});
