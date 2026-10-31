import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createGeographicOverlay } from './geographicOverlay.js';
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

function setup(t) {
  const document = makeDoc();
  let source;
  const listeners = new Set();
  let removed = false;
  const viewer = {
    canvas: { clientWidth: 500, clientHeight: 500 },
    scene: {
      requestRender() {},
      postRender: {
        addEventListener(fn) {
          listeners.add(fn);
        },
        removeEventListener(fn) {
          listeners.delete(fn);
        },
      },
    },
    dataSources: {
      add(value) {
        source = value;
      },
      remove(value, destroy) {
        removed = value === source && destroy;
      },
    },
    isDestroyed: () => false,
  };
  const overlay = createGeographicOverlay(viewer, {
    document,
    projectToWindow: () => ({ x: 120, y: 120 }),
  });
  t.after(() => overlay.destroy());
  return { overlay, source, document, listeners, removed: () => removed };
}
const fixture = () => ({
  anchor: { name: 'Synthetic place', lat: 25, lon: 55 },
  durationSec: 12,
  keyframes: [
    { lat: 25, lon: 55, label: 'Opening' },
    { lat: 25.001, lon: 55, label: 'Closer' },
  ],
  plan: {
    beats: [
      { atSec: 0, title: 'Runners', entityIds: ['runners'] },
      { atSec: 6, title: 'Vehicles', entityIds: ['cars'] },
    ],
  },
  placements: [
    ...[
      'runner',
      'police',
      'person',
      'organizer',
      'vehicle',
      'police_vehicle',
      'barrier',
      'start_line',
      'finish_line',
    ].map((type, i) => ({
      id: `${type}-${i}`,
      entityId: ['vehicle', 'police_vehicle'].includes(type)
        ? 'cars'
        : 'runners',
      type,
      index: 0,
      label: type,
      lat: 25 + i * 0.0001,
      lon: 55,
      heading: i * 20,
    })),
  ],
});

test('renders every planned quantity as real Cesium geometry at supplied coordinates, including person heads', (t) => {
  const { overlay, source, document } = setup(t);
  const scene = fixture();
  overlay.setScene(scene);
  assert.equal(overlay.getState().actorCount, 9);
  for (const p of scene.placements) {
    const entity = source.entities.getById(`planned-${p.id}`);
    assert.ok(entity);
    assert.match(
      entity.name,
      ['police', 'police_vehicle'].includes(p.type)
        ? /^Suggested \/ illustrative – not verified deployment/
        : /Illustrative/,
    );
    assert.equal(entity.label.showBackground.getValue(), false);
    assert.match(entity.label.text.getValue(), /^ILLUSTRATIVE · /);
    assert.ok(entity.label.text.getValue().length <= 72);
    assert.equal(entity.properties.illustrative.getValue(), true);
    assert.equal(entity.properties.incidentConfirmed.getValue(), false);
    const point = Cesium.Cartographic.fromCartesian(entity.position.getValue());
    assert.ok(Math.abs(Cesium.Math.toDegrees(point.latitude) - p.lat) < 1e-8);
    assert.ok(Math.abs(Cesium.Math.toDegrees(point.longitude) - p.lon) < 1e-8);
    if (['person', 'runner', 'police', 'organizer'].includes(p.type)) {
      assert.ok(entity.cylinder);
      assert.ok(source.entities.getById(`planned-${p.id}-head`).ellipsoid);
    } else assert.ok(entity.box);
  }
  // anchor + 9 bodies + 4 heads; camera targets/path are no longer drawn as map dots/lines
  assert.equal(source.entities.values.length, 14);
  assert.equal(source.entities.getById('geographic-camera-orbit'), undefined);
  assert.equal(source.entities.getById('geographic-camera-0'), undefined);
  assert.match(
    document.getElementById('scene-anchor-label').textContent,
    /ILLUSTRATIVE STAGING/,
  );
});
test('beat updates highlight only authored focus; seeking clamps safely and does not invent entity movement', (t) => {
  const { overlay, source, document } = setup(t);
  const scene = fixture();
  overlay.setScene(scene);
  const runner = source.entities.getById('planned-runner-0');
  const car = source.entities.getById('planned-vehicle-4');
  const before = runner.position.getValue();
  assert.equal(runner.label.show.getValue(), true);
  assert.equal(car.label.show.getValue(), false);
  overlay.setPlaybackPosition(0.75);
  assert.equal(overlay.getState().beatIndex, 1);
  assert.equal(overlay.getState().timeSec, 9);
  assert.equal(runner.label.show.getValue(), false);
  assert.equal(car.label.show.getValue(), true);
  assert.equal(runner.cylinder.material.getValue().color.alpha, 0.4);
  assert.ok(Cesium.Cartesian3.equals(before, runner.position.getValue()));
  // Beat titles no longer render as a strip over the imagery.
  assert.doesNotMatch(
    document.getElementById('scene-anchor-label').textContent,
    /Vehicles/,
  );
  assert.equal(
    document.getElementById('scene-anchor-label').dataset.beatTitle,
    'Vehicles',
  );
  overlay.setTime(999);
  assert.equal(overlay.getState().timeSec, 12);
  overlay.setTime(-9);
  assert.equal(overlay.getState().timeSec, 0);
  overlay.setTime(NaN);
  assert.equal(overlay.getState().timeSec, 0);
});
test('external context and legacy selection remove all authored actors; destroy detaches listener and source', (t) => {
  const state = setup(t);
  state.overlay.setScene(fixture());
  state.overlay.setExternal({ name: 'External', lat: 45, lon: -70 });
  assert.equal(state.source.entities.values.length, 1);
  assert.equal(state.overlay.getState().actorCount, 0);
  assert.equal(state.overlay.getState().external, true);
  const legacy = fixture();
  delete legacy.placements;
  delete legacy.plan;
  state.overlay.setScene(legacy);
  assert.equal(state.source.entities.values.length, 1);
  assert.equal(state.overlay.getState().illustrative, false);
  state.overlay.destroy();
  assert.equal(state.listeners.size, 0);
  assert.equal(state.removed(), true);
});
