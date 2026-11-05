import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneCamera } from './sceneCamera.js';

function makeDocument() {
  const timers = new Map();
  let timerId = 0;
  function element(tag) {
    const handlers = new Map();
    let content = '';
    return {
      tagName: tag.toUpperCase(),
      children: [],
      attrs: {},
      get textContent() {
        return content + this.children.map((c) => c.textContent).join(' ');
      },
      set textContent(value) {
        content = String(value);
        this.children = [];
      },
      setAttribute(k, v) {
        this.attrs[k] = String(v);
      },
      append(...nodes) {
        for (const n of nodes) {
          this.children.push(n);
          n.parentNode = this;
        }
      },
      replaceChildren(...nodes) {
        this.children = [];
        content = '';
        this.append(...nodes);
      },
      remove() {
        if (this.parentNode)
          this.parentNode.children = this.parentNode.children.filter(
            (n) => n !== this,
          );
      },
      addEventListener(type, fn) {
        handlers.set(type, fn);
      },
      removeEventListener(type, fn) {
        if (handlers.get(type) === fn) handlers.delete(type);
      },
      click() {
        handlers.get('click')?.();
      },
      find(tag) {
        return this.children.flatMap((c) => [
          ...(c.tagName === tag ? [c] : []),
          ...c.find(tag),
        ]);
      },
    };
  }
  return {
    createElement: element,
    timers,
    defaultView: {
      setInterval(fn) {
        timers.set(++timerId, fn);
        return timerId;
      },
      clearInterval(id) {
        timers.delete(id);
      },
    },
  };
}
const NOW = Date.parse('2026-10-31T12:00:00Z');
const proof = { verified: true, sourceUrl: 'https://fixture.example/camera' };
const camera = () => ({
  id: 'test-cam',
  name: '<img onerror=alert(1)>',
  provider: 'Fixture provider',
  lat: 0,
  lon: 0,
  locationEvidence: { ...proof, kind: 'provider-coordinate' },
  coverage: { radiusM: 500, evidence: proof },
  permissions: { view: true, embed: true, evidence: proof },
  availabilityEvidence: { ...proof, kind: 'live-stream', checkedAt: NOW },
  mediaUrl: '/api/cctv/media/test-cam',
});
const scene = { id: 'scene-a', anchor: { lat: 0, lon: 0.001 } };

test('empty state is honest and initializes without a camera or scene', () => {
  const doc = makeDocument();
  const panel = createSceneCamera({ document: doc, now: () => NOW });
  assert.equal(panel.getState().selected, null);
  assert.match(panel.element.textContent, /No relevant accessible camera/);
  assert.equal(
    panel.element.attrs['data-state'],
    'no-relevant-accessible-camera',
  );
  assert.equal(panel.element.find('IFRAME').length, 0);
  panel.destroy();
  assert.equal(doc.timers.size, 0);
});

test('display includes identity/location/distance/source/status with no media or automatic selection effects', () => {
  let calls = 0;
  const panel = createSceneCamera({
    document: makeDocument(),
    cameras: [camera()],
    scene,
    now: () => NOW,
    onSelect: () => calls++,
  });
  const text = panel.element.textContent;
  for (const re of [
    /test-cam/,
    /0\.000000, 0\.000000/,
    /111 m/,
    /Fixture provider/,
    /LIVE/,
    /line of sight is not independently confirmed/,
  ])
    assert.match(text, re);
  assert.equal(calls, 0);
  assert.equal(panel.element.find('IMG').length, 0);
  assert.equal(panel.element.find('IFRAME').length, 0);
  assert.equal(panel.element.find('VIDEO').length, 0);
  assert.match(text, /<img onerror=alert\(1\)>/); // text only, never parsed as HTML
  panel.element.find('BUTTON')[0].click();
  assert.equal(calls, 1);
  panel.destroy();
});

test('updating cameras removes restricted/offline/stale selection and exposes reasons', () => {
  const panel = createSceneCamera({
    document: makeDocument(),
    cameras: [camera()],
    scene,
    now: () => NOW,
  });
  panel.updateCameras([{ ...camera(), status: 'offline' }]);
  assert.equal(panel.getState().selected, null);
  assert.match(panel.element.textContent, /OFFLINE/);
  assert.match(panel.element.textContent, /not selected/i);
  panel.updateCameras([{ ...camera(), coverage: undefined }]);
  assert.match(panel.element.textContent, /Coverage: unknown/);
  panel.setScene(null);
  assert.equal(panel.getState().reason, 'scene-target-missing');
  panel.setScene(scene, { cameras: [camera()] });
  assert.equal(panel.getState().selected.id, 'test-cam');
  panel.destroy();
});

test('LIVE expires on clock tick; a previously displayed button cannot activate stale media', () => {
  const doc = makeDocument();
  let time = NOW,
    calls = 0;
  const panel = createSceneCamera({
    document: doc,
    cameras: [camera()],
    scene,
    now: () => time,
    onSelect: () => calls++,
  });
  const oldButton = panel.element.find('BUTTON')[0];
  time += 120001;
  oldButton.click();
  assert.equal(calls, 0);
  assert.equal(panel.getState().selected, null);
  assert.match(panel.element.textContent, /UNKNOWN/);
  for (const tick of doc.timers.values()) tick();
  panel.destroy();
  assert.equal(doc.timers.size, 0);
  panel.updateCameras([camera()]);
  assert.equal(panel.getState().selected, null);
});

test('destroy removes the component and detaches old button handlers', () => {
  const doc = makeDocument(),
    host = doc.createElement('div');
  let calls = 0;
  const panel = createSceneCamera({
    document: doc,
    cameras: [camera()],
    scene,
    now: () => NOW,
    onSelect: () => calls++,
  });
  host.append(panel.element);
  const button = panel.element.find('BUTTON')[0];
  panel.destroy();
  panel.destroy();
  button.click();
  assert.equal(calls, 0);
  assert.equal(host.children.length, 0);
  assert.equal(doc.timers.size, 0);
});
