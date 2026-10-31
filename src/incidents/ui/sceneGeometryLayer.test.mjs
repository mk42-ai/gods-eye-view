import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createSceneGeometryLayer } from './sceneGeometryLayer.js';
import { SUGGESTED_MARKER_LABEL } from '../../scenes/sceneGeometry.js';
import { stagingLabel } from './geographicOverlay.js';
function makeDoc() {
  const doc = { activeElement: null, defaultView: {} };
  function mk(tag) {
    const listeners = new Map();
    const attrs = new Map();
    const node = {
      tagName: tag.toUpperCase(),
      id: '',
      children: [],
      parentNode: null,
      dataset: {},
      textContent: '',
      value: '',
      disabled: false,
      style: { setProperty() {}, removeProperty() {} },
      get className() {
        return attrs.get('class') || '';
      },
      set className(value) {
        attrs.set('class', value);
      },
      get hidden() {
        return attrs.has('hidden');
      },
      set hidden(value) {
        if (value) attrs.set('hidden', '');
        else attrs.delete('hidden');
      },
      setAttribute(name, value) {
        attrs.set(name, String(value));
      },
      getAttribute(name) {
        return attrs.get(name) ?? null;
      },
      removeAttribute(name) {
        attrs.delete(name);
      },
      append(...children) {
        children.forEach((child) => this.appendChild(child));
      },
      appendChild(child) {
        return this.insertBefore(child, null);
      },
      insertBefore(child, before) {
        if (before && before.parentNode !== this)
          throw new Error('Invalid insertion target');
        child.remove();
        const index = before
          ? this.children.indexOf(before)
          : this.children.length;
        this.children.splice(index, 0, child);
        child.parentNode = this;
        return child;
      },
      replaceChildren(...children) {
        this.children.forEach((child) => {
          child.parentNode = null;
        });
        this.children = [];
        this.append(...children);
      },
      remove() {
        if (this.parentNode)
          this.parentNode.children = this.parentNode.children.filter(
            (child) => child !== this,
          );
        this.parentNode = null;
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        listeners.set(
          type,
          (listeners.get(type) || []).filter((entry) => entry !== fn),
        );
      },
      fire(type, init = {}) {
        const event = {
          type,
          target: this,
          bubbles: true,
          defaultPrevented: false,
          propagationStopped: false,
          ...init,
          preventDefault() {
            this.defaultPrevented = true;
          },
          stopPropagation() {
            this.propagationStopped = true;
          },
        };
        for (let target = this; target; target = target.parentNode) {
          event.currentTarget = target;
          for (const fn of [...(target._listeners.get(type) || [])]) fn(event);
          if (!event.bubbles || event.propagationStopped) break;
        }
        return event;
      },
      _listeners: listeners,
      focus() {
        doc.activeElement = this;
      },
      find(predicate) {
        return this.children.flatMap((child) => [
          ...(predicate(child) ? [child] : []),
          ...child.find(predicate),
        ]);
      },
      matches(selector) {
        return selector.split(',').some((part) => {
          const value = part.trim();
          if (value.startsWith('#')) return this.id === value.slice(1);
          if (value.startsWith('.'))
            return this.className.split(/\s+/).includes(value.slice(1));
          return this.tagName === value.toUpperCase();
        });
      },
      querySelector(selector) {
        return this.find((child) => child.matches(selector))[0] || null;
      },
      text() {
        return [this.textContent, ...this.children.map((child) => child.text())]
          .filter(Boolean)
          .join(' ');
      },
      get firstChild() {
        return this.children[0] || null;
      },
      get nextSibling() {
        if (!this.parentNode) return null;
        return (
          this.parentNode.children[
            this.parentNode.children.indexOf(this) + 1
          ] || null
        );
      },
    };
    node.classList = {
      contains(value) {
        return node.className.split(/\s+/).includes(value);
      },
      toggle(value, force) {
        const names = new Set(node.className.split(/\s+/).filter(Boolean));
        const enable = force ?? !names.has(value);
        if (enable) names.add(value);
        else names.delete(value);
        node.className = [...names].join(' ');
        return enable;
      },
    };
    return node;
  }
  doc.createElement = mk;
  doc.documentElement = mk('html');
  doc.body = mk('body');
  doc.documentElement.append(doc.body);
  doc.getElementById = (id) => doc.documentElement.querySelector(`#${id}`);
  return doc;
}

function setup(t, now = Date.parse('2026-10-31T12:00:00Z')) {
  const document = makeDoc();
  let source;
  const renders = [];
  const viewer = {
    scene: { requestRender: () => renders.push(1) },
    dataSources: {
      add(value) {
        source = value;
      },
      remove() {},
    },
    isDestroyed: () => false,
  };
  const layer = createSceneGeometryLayer(viewer, { document, now: () => now });
  t.after(() => layer.destroy());
  return { layer, source: () => source, document, renders };
}
const geometry = (lon = 55.15) => ({
  version: 1,
  status: 'grounded',
  illustrative: true,
  features: [
    {
      id: 'f1',
      kind: 'route',
      name: 'Researched road corridor',
      geometry: {
        type: 'LineString',
        coordinates: [
          [55.14, 25.08],
          [lon, 25.09],
        ],
      },
      citationIds: ['c1'],
      provenance: { source: 'OSRM road routing over OpenStreetMap' },
      activeWindow: {
        startUtc: '2026-10-31T10:00:00Z',
        endUtc: '2026-10-31T11:30:00Z',
      },
    },
    {
      id: 'f2',
      kind: 'point',
      name: 'Researched venue',
      geometry: { type: 'Point', coordinates: [55.141, 25.081] },
      citationIds: ['c1'],
      provenance: { source: 'OpenStreetMap Nominatim geocoder' },
    },
  ],
  citations: [{ id: 'c1', url: 'https://example.org/source', title: 'Source' }],
});
const scene = (g = geometry(), selectedTime = { windowHours: 72 }) => ({
  id: 'scene-1',
  geometry: g,
  selectedTime,
});

test('renders researched lines/dots as ground-clamped Cesium entities at exact coordinates', (t) => {
  const { layer, source, document } = setup(t);
  layer.setScene(scene());
  const route = source().entities.getById('f1');
  assert.ok(route.polyline);
  assert.equal(route.polyline.clampToGround.getValue(), true);
  const positions = route.polyline.positions.getValue();
  const first = Cesium.Cartographic.fromCartesian(positions[0]);
  assert.ok(Math.abs(Cesium.Math.toDegrees(first.longitude) - 55.14) < 1e-9);
  assert.ok(Math.abs(Cesium.Math.toDegrees(first.latitude) - 25.08) < 1e-9);
  const dot = source().entities.getById('f2');
  const p = Cesium.Cartographic.fromCartesian(dot.position.getValue());
  assert.ok(Math.abs(Cesium.Math.toDegrees(p.longitude) - 55.141) < 1e-9);
  assert.equal(
    dot.point.heightReference.getValue(),
    Cesium.HeightReference.CLAMP_TO_GROUND,
  );
  const label = source().entities.getById('f2-label');
  assert.match(
    label.label.text.getValue(),
    /^ILLUSTRATIVE · Researched venue \[1\]$/,
  );
  assert.equal(
    label.label.showBackground.getValue(),
    false,
    'no opaque bar over imagery',
  );
  assert.match(dot.description.getValue(), /\[1\] Source/);
  const legend = document.getElementById('scene-geometry-legend');
  assert.equal(legend.hidden, false);
  assert.match(legend.text(), /ILLUSTRATIVE/);
  assert.match(legend.text(), /Research sources/);
  assert.match(
    legend.text(),
    new RegExp(SUGGESTED_MARKER_LABEL.replace(/[/]/g, '.')),
  );
  assert.equal(layer.getState().lines[0].vertices, 2);
});

test('recording-window change restyles in place without rebuilding geometry', (t) => {
  const { layer, source } = setup(t);
  layer.setScene(scene());
  const before = source().entities.getById('f1');
  const positions = before.polyline.positions.getValue();
  assert.equal(layer.getState().lines[0].timeState, 'in-window');
  layer.setTimeWindow({ windowHours: 0.25 });
  const after = source().entities.getById('f1');
  assert.equal(after, before, 'same entity, not rebuilt');
  assert.equal(after.polyline.positions.getValue(), positions);
  assert.equal(layer.getState().renders, 1);
  assert.equal(layer.getState().restyles, 1);
  assert.equal(layer.getState().lines[0].timeState, 'outside-window');
  assert.equal(layer.getState().windowLabel, 'Last 0.25 hours');
});

test('different research produces different drawn geometry; empty research draws nothing', (t) => {
  const { layer, source, document } = setup(t);
  layer.setScene(scene(geometry(55.15)));
  const a = layer.getState().signature;
  layer.setScene(scene(geometry(55.2)));
  assert.notEqual(layer.getState().signature, a);
  layer.setScene(
    scene({
      version: 1,
      status: 'empty',
      illustrative: true,
      features: [],
      citations: [],
      message: 'No mappable places.',
    }),
  );
  assert.equal(source().entities.values.length, 0);
  assert.match(
    document.getElementById('scene-geometry-legend').text(),
    /nothing drawn/i,
  );
  layer.clear();
  assert.equal(document.getElementById('scene-geometry-legend').hidden, true);
});

test('staging labels are short; police/security markers use the suggested/illustrative label', () => {
  assert.equal(
    stagingLabel({
      type: 'police',
      label: 'Illustrative perimeter officers spaced along the barriers',
    }),
    `ILLUSTRATIVE · ${SUGGESTED_MARKER_LABEL}`,
  );
  const runner = stagingLabel({
    type: 'runner',
    label: 'Illustrative runners in the lead pack heading north',
  });
  assert.match(runner, /^ILLUSTRATIVE · runners in the lead pack/);
  assert.ok(runner.length <= 44);
});
