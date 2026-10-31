import test from 'node:test';
import assert from 'node:assert/strict';
import {
  snapchatRequestForScene,
  createSceneFootageControls,
} from './ui/sceneFootageControls.js';
const scene = () => ({
  id: 'fixture-scene',
  anchor: { name: 'Burj Khalifa', lat: 25.197, lon: 55.274 },
  selectedTime: { timeMode: 'recent', windowHours: 72 },
});
test('explicit Snapchat strict mode retains the selected capture-time window and exact radius', () => {
  const out = snapchatRequestForScene(scene(), {
    now: () => new Date('2026-10-31T05:00:00Z'),
  });
  assert.equal(out.trigger, 'explicit');
  assert.equal(out.strictBounds, true);
  assert.equal(out.radius, 1);
  assert.deepEqual(out.timeWindow, {
    windowHours: 72,
    strictCaptureTime: true,
  });
});
test('historical scope is not silently replaced with a recent/default window', () => {
  const s = scene();
  s.selectedTime = {
    timeMode: 'historical',
    windowStart: '2026-10-28T01:00:00Z',
    windowEnd: '2026-10-29T01:00:00Z',
  };
  assert.deepEqual(snapchatRequestForScene(s).timeWindow, {
    windowStart: s.selectedTime.windowStart,
    windowEnd: s.selectedTime.windowEnd,
    strictCaptureTime: true,
  });
  s.selectedTime.windowEnd = 'not a date';
  assert.equal(snapchatRequestForScene(s), null);
});
test('only an intentional place-mentions mode removes strict bounds and discloses uncertainty', () => {
  const out = snapchatRequestForScene(scene(), { mode: 'place-mentions' });
  assert.equal(out.timeWindow, null);
  assert.equal(out.strictBounds, false);
  assert.equal(out.radius, undefined);
  assert.match(out.scopeDisclosure, /unverified/);
  assert.equal(snapchatRequestForScene(null), null);
});
function docFixture() {
  const all = [];
  return {
    all,
    createElement(tag) {
      const handlers = new Map();
      const n = {
        tagName: tag.toUpperCase(),
        children: [],
        disabled: false,
        value: '',
        attrs: {},
        setAttribute(k, v) {
          this.attrs[k] = v;
        },
        append(...children) {
          this.children.push(...children);
        },
        appendChild(child) {
          this.children.push(child);
        },
        addEventListener(k, f) {
          handlers.set(k, f);
        },
        removeEventListener(k) {
          handlers.delete(k);
        },
        remove() {},
        emit(k) {
          handlers.get(k)?.();
        },
      };
      all.push(n);
      return n;
    },
  };
}
test('rendering, setting a scene and changing policy issue zero discovery events; only the button submits', () => {
  const doc = docFixture();
  const events = [];
  const win = {
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    dispatchEvent(e) {
      events.push(e);
    },
  };
  const control = createSceneFootageControls({ document: doc, window: win });
  const button = doc.all.find((n) => n.id === 'scene-snapchat-discover');
  const scope = doc.all.find((n) => n.id === 'scene-snapchat-scope');
  button.emit('click');
  assert.equal(events.length, 0);
  control.setScene(scene());
  scope.value = 'place-mentions';
  scope.emit('change');
  assert.equal(events.length, 0);
  button.emit('click');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'gev:scene-footage');
  assert.equal(events[0].detail.timeWindow, null);
  control.setScene(null);
  button.emit('click');
  assert.equal(events.length, 1);
  control.destroy();
});
