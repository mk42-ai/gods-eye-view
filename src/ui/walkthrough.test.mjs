/**
 * Tests for Driver.js guided walkthrough module
 * Using node:test and node:assert/strict with hand-written DOM mocks
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WALKTHROUGH_STORAGE_KEY,
  WALKTHROUGH_STEPS,
  shouldAutoStart,
  setWalkthroughDismissed,
  resolveSteps,
  startWalkthrough,
  installWalkthrough
} from './walkthrough.js';

// ── Hand-written DOM mocks ───────────────────────────────────────────────────

function createMockElement(tagName = 'div') {
  const children = [];
  const attributes = new Map();
  const listeners = new Map();

  const element = {
    tagName: tagName.toUpperCase(),
    nodeType: 1,
    children,
    childNodes: children,
    id: '',
    className: '',
    type: '',
    checked: false,
    textContent: '',
    offsetParent: {},
    parentNode: null,
    dataset: {},

    setAttribute(name, value) {
      attributes.set(name, String(value));
      if (name === 'id') this.id = String(value);
      if (name === 'class') this.className = String(value);
      if (name === 'type') this.type = String(value);
    },
    getAttribute(name) {
      if (name === 'id') return this.id || attributes.get('id') || null;
      if (name === 'class') return this.className || attributes.get('class') || null;
      if (name === 'type') return this.type || attributes.get('type') || null;
      return attributes.has(name) ? attributes.get(name) : null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    removeAttribute(name) {
      attributes.delete(name);
      if (name === 'id') this.id = '';
      if (name === 'class') this.className = '';
      if (name === 'type') this.type = '';
    },
    appendChild(child) {
      child.parentNode = this;
      children.push(child);
      return child;
    },
    prepend(...nodes) {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        node.parentNode = this;
        children.unshift(node);
      }
    },
    insertBefore(newChild, refChild) {
      newChild.parentNode = this;
      const idx = children.indexOf(refChild);
      if (idx === -1) {
        children.push(newChild);
      } else {
        children.splice(idx, 0, newChild);
      }
      return newChild;
    },
    remove() {
      if (this.parentNode) {
        this.parentNode.removeChild(this);
      }
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx !== -1) {
        children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    },
    addEventListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    removeEventListener(event, fn) {
      if (!listeners.has(event)) return;
      const list = listeners.get(event).filter((f) => f !== fn);
      listeners.set(event, list);
    },
    dispatchEvent(event) {
      const type = typeof event === 'string' ? event : event?.type;
      const fns = listeners.get(type) || [];
      for (const fn of fns) {
        fn(event);
      }
    },
    click() {
      this.dispatchEvent({ type: 'click', target: this });
    },
    querySelector(selector) {
      for (const child of children) {
        if (matches(child, selector)) return child;
        if (child.querySelector) {
          const found = child.querySelector(selector);
          if (found) return found;
        }
      }
      return null;
    },
    querySelectorAll(selector) {
      const results = [];
      for (const child of children) {
        if (matches(child, selector)) results.push(child);
        if (child.querySelectorAll) {
          results.push(...child.querySelectorAll(selector));
        }
      }
      return results;
    },
    getClientRects() {
      return [{ width: 100, height: 100 }];
    }
  };

  return element;
}

function matches(el, selector) {
  if (!el || el.nodeType !== 1 || typeof selector !== 'string') return false;
  if (selector.startsWith('#')) {
    return el.id === selector.slice(1);
  }
  if (selector.startsWith('.')) {
    const cls = selector.slice(1);
    return (el.className || '').split(/\s+/).includes(cls);
  }
  if (selector.startsWith('[') && selector.endsWith(']')) {
    const attr = selector.slice(1, -1);
    if (attr.includes('=')) {
      const [k, v] = attr.split('=');
      const val = v.replace(/^["']|["']$/g, '');
      return typeof el.getAttribute === 'function' && el.getAttribute(k) === val;
    }
    return typeof el.hasAttribute === 'function' && el.hasAttribute(attr);
  }
  return (el.tagName || '').toLowerCase() === selector.toLowerCase();
}

function createMockDocument() {
  const body = createMockElement('body');
  return {
    body,
    createElement(tag) {
      return createMockElement(tag);
    },
    createElementNS(ns, tag) {
      const el = createMockElement(tag);
      el.namespaceURI = ns;
      return el;
    },
    createTextNode(text) {
      return {
        nodeType: 3,
        textContent: text
      };
    },
    getElementById(id) {
      return body.querySelector(`#${id}`);
    },
    querySelector(sel) {
      return body.querySelector(sel);
    }
  };
}

function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('WALKTHROUGH_STEPS has exact 7 steps, order, ids and selectors', () => {
  assert.equal(WALKTHROUGH_STORAGE_KEY, 'gev:walkthrough:v1');
  assert.ok(Array.isArray(WALKTHROUGH_STEPS));
  assert.equal(WALKTHROUGH_STEPS.length, 7);
  assert.ok(Object.isFrozen(WALKTHROUGH_STEPS));

  const expectedSteps = [
    {
      id: 'aoi',
      element: '#incident-composer-input',
      title: 'Type a place',
      description: 'Start here. Type a place in the UAE, such as Dubai Marina.'
    },
    {
      id: 'window',
      element: '#incident-composer-window',
      title: 'Recording window',
      description: 'Choose how far back to look for footage (UTC).'
    },
    {
      id: 'build',
      element: '#incident-composer-submit',
      title: 'Build scene',
      description: 'Frames the camera on the place and gathers footage.'
    },
    {
      id: 'footage',
      element: '#scene-footage',
      title: 'Footage panel',
      description: 'Pick a clip, check its source and upload time. Footage appears after a scene is built.'
    },
    {
      id: 'scenes',
      element: '#sidebar-scenes-tab',
      title: 'Scenes drawer',
      description: 'Name and save a scene to reopen it later.'
    },
    {
      id: 'plugins',
      element: '#od-plugins-chip',
      title: 'Plugins',
      description: 'See which data plugins are ready and verify them in one go.'
    },
    {
      id: 'mic',
      element: '#od-voice-button',
      title: 'Mic',
      description: 'Talk to the map instead of typing.'
    }
  ];

  for (let i = 0; i < expectedSteps.length; i++) {
    const expected = expectedSteps[i];
    const actual = WALKTHROUGH_STEPS[i];
    assert.ok(Object.isFrozen(actual), `Step ${i} should be frozen`);
    assert.equal(actual.id, expected.id);
    assert.equal(actual.element, expected.element);
    assert.equal(actual.title, expected.title);
    assert.equal(actual.description, expected.description);
  }
});

test('shouldAutoStart rules handle storage, throwing storage, ?tour=0, and ?tour=1 override', () => {
  // Default without storage or location is true
  assert.equal(shouldAutoStart({}), true);
  assert.equal(shouldAutoStart(), true);

  // Storage dismissed returns false
  const dismissedStorage = createMockStorage({ [WALKTHROUGH_STORAGE_KEY]: 'dismissed' });
  assert.equal(shouldAutoStart({ storage: dismissedStorage }), false);

  // Storage non-dismissed returns true
  const activeStorage = createMockStorage({ [WALKTHROUGH_STORAGE_KEY]: 'other' });
  assert.equal(shouldAutoStart({ storage: activeStorage }), true);

  // Throwing storage means "show" (returns true)
  const throwingStorage = {
    getItem() {
      throw new Error('Access denied in private browsing');
    }
  };
  assert.equal(shouldAutoStart({ storage: throwingStorage }), true);

  // location.search with ?tour=0 returns false
  assert.equal(shouldAutoStart({ location: { search: '?tour=0' } }), false);
  assert.equal(shouldAutoStart({ storage: activeStorage, location: { search: '?tour=0' } }), false);

  // location.search with ?tour=1 returns true even when storage is dismissed (override)
  assert.equal(shouldAutoStart({ storage: dismissedStorage, location: { search: '?tour=1' } }), true);
  assert.equal(shouldAutoStart({ location: { search: '?tour=1&foo=bar' } }), true);
});

test('setWalkthroughDismissed round-trip updates and clears storage', () => {
  const storage = createMockStorage();

  // Set dismissed
  setWalkthroughDismissed(true, storage);
  assert.equal(storage.getItem(WALKTHROUGH_STORAGE_KEY), 'dismissed');

  // Clear dismissed
  setWalkthroughDismissed(false, storage);
  assert.equal(storage.getItem(WALKTHROUGH_STORAGE_KEY), null);

  // Throwing storage does not throw
  const throwingStorage = {
    setItem() {
      throw new Error('QuotaExceeded');
    },
    removeItem() {
      throw new Error('QuotaExceeded');
    }
  };
  assert.doesNotThrow(() => setWalkthroughDismissed(true, throwingStorage));
  assert.doesNotThrow(() => setWalkthroughDismissed(false, throwingStorage));
});

test('resolveSteps drops element for missing or hidden nodes', () => {
  const doc = createMockDocument();

  // Add only the first element to doc
  const aoi = doc.createElement('input');
  aoi.id = 'incident-composer-input';
  aoi.offsetParent = {}; // Visible
  aoi.getClientRects = () => [{ width: 200, height: 36 }];
  doc.body.appendChild(aoi);

  // Add a hidden element (offsetParent === null and getClientRects().length === 0)
  const windowEl = doc.createElement('div');
  windowEl.id = 'incident-composer-window';
  windowEl.offsetParent = null;
  windowEl.getClientRects = () => [];
  doc.body.appendChild(windowEl);

  const resolved = resolveSteps(WALKTHROUGH_STEPS, doc);
  assert.equal(resolved.length, 7);

  // Step 0: element present and visible -> includes element
  assert.equal(resolved[0].element, '#incident-composer-input');
  assert.equal(resolved[0].popover.title, 'Type a place');
  assert.equal(resolved[0].popover.description, 'Start here. Type a place in the UAE, such as Dubai Marina.');

  // Step 1: element present but hidden -> drops element
  assert.equal('element' in resolved[1], false);
  assert.equal(resolved[1].popover.title, 'Recording window');

  // Step 2: element missing from DOM -> drops element
  assert.equal('element' in resolved[2], false);
  assert.equal(resolved[2].popover.title, 'Build scene');

  // Node with offsetParent === null but client rects > 0 (e.g. fixed position) is NOT considered hidden
  const fixedEl = doc.createElement('div');
  fixedEl.id = 'scene-footage';
  fixedEl.offsetParent = null;
  fixedEl.getClientRects = () => [{ width: 100, height: 100 }];
  doc.body.appendChild(fixedEl);

  const resolvedWithFixed = resolveSteps(WALKTHROUGH_STEPS, doc);
  assert.equal(resolvedWithFixed[3].element, '#scene-footage');
});

test('startWalkthrough config, onPopoverRender injection, skip destroy and dismiss storage', async () => {
  const doc = createMockDocument();
  const storage = createMockStorage();

  let capturedConfig = null;
  let destroyed = false;
  let driven = false;

  const fakeDriverInstance = {
    destroy() {
      destroyed = true;
    },
    drive() {
      driven = true;
    },
    isActive() {
      return !destroyed;
    }
  };

  const fakeFactory = (config) => {
    capturedConfig = config;
    return fakeDriverInstance;
  };

  const fakeLoadDriver = () => Promise.resolve([{ driver: fakeFactory }, {}]);

  const driverResult = await startWalkthrough({
    document: doc,
    storage,
    loadDriver: fakeLoadDriver
  });

  assert.equal(driverResult, fakeDriverInstance);
  assert.equal(driven, true);
  assert.equal(doc.body.dataset.tour, 'active');

  // Verify config passed to driver
  assert.ok(capturedConfig);
  assert.equal(capturedConfig.steps.length, 7);
  assert.equal(capturedConfig.popoverClass, 'gev-tour');
  assert.equal(capturedConfig.allowClose, true);
  assert.equal(capturedConfig.showProgress, true);
  assert.equal(capturedConfig.overlayOpacity, 0.55);
  assert.equal(capturedConfig.stagePadding, 6);
  assert.equal(capturedConfig.stageRadius, 8);
  assert.equal(capturedConfig.nextBtnText, 'Next');
  assert.equal(capturedConfig.prevBtnText, 'Back');
  assert.equal(capturedConfig.doneBtnText, 'Done');
  assert.equal(capturedConfig.progressText, '{{current}} of {{total}}');
  assert.equal(typeof capturedConfig.onPopoverRender, 'function');

  // Test onPopoverRender injection
  const fakeFooter = doc.createElement('div');
  fakeFooter.className = 'driver-popover-footer';

  capturedConfig.onPopoverRender({ footer: fakeFooter });

  const dismissCheckbox = fakeFooter.querySelector('[data-tour-dismiss]');
  assert.ok(dismissCheckbox, 'Dismiss checkbox must be injected into footer');
  assert.equal(dismissCheckbox.checked, false);

  const skipBtn = fakeFooter.querySelector('[data-tour-skip]');
  assert.ok(skipBtn, 'Skip button must be injected into footer');
  assert.equal(skipBtn.textContent, 'Skip tour');

  // Test dismiss checkbox change writes to storage
  dismissCheckbox.checked = true;
  dismissCheckbox.dispatchEvent({ type: 'change' });
  assert.equal(storage.getItem(WALKTHROUGH_STORAGE_KEY), 'dismissed');

  // Test clicking skip calls driver destroy
  assert.equal(destroyed, false);
  skipBtn.click();
  assert.equal(destroyed, true);
  assert.equal(doc.body.dataset.tour, undefined, 'Dataset tour must be deleted after destroy');
});

test('startWalkthrough guards against concurrent starts', async () => {
  const doc = createMockDocument();
  let factoryCalls = 0;

  const fakeDriver = {
    destroy() {},
    drive() {},
    isActive() {
      return true;
    }
  };

  const fakeFactory = () => {
    factoryCalls++;
    return fakeDriver;
  };

  const fakeLoadDriver = () => Promise.resolve([{ driver: fakeFactory }, {}]);

  const [d1, d2] = await Promise.all([
    startWalkthrough({ document: doc, loadDriver: fakeLoadDriver }),
    startWalkthrough({ document: doc, loadDriver: fakeLoadDriver })
  ]);

  assert.equal(d1, d2);
  assert.equal(factoryCalls, 1);
});

test('installWalkthrough creates help button and schedules auto-start only when allowed', async () => {
  const doc = createMockDocument();
  const storage = createMockStorage();

  let timeoutScheduled = false;
  let scheduledDelay = null;
  let scheduledFn = null;

  const mockWindow = {
    location: { search: '' },
    setTimeout(fn, delay) {
      timeoutScheduled = true;
      scheduledDelay = delay;
      scheduledFn = fn;
      return 123;
    },
    clearTimeout(id) {
      if (id === 123) {
        timeoutScheduled = false;
      }
    }
  };

  const fakeLoadDriver = () => Promise.resolve([{ driver: () => ({ drive() {}, destroy() {} }) }, {}]);

  const installed = installWalkthrough({
    document: doc,
    window: mockWindow,
    storage,
    autoStartDelayMs: 1200,
    loadDriver: fakeLoadDriver
  });

  // Verify button created
  const helpBtn = doc.getElementById('gev-help-button');
  assert.ok(helpBtn);
  assert.equal(helpBtn.className, 'gev-help-btn');
  assert.equal(helpBtn.getAttribute('aria-label'), 'Replay the guided walkthrough');
  assert.equal(helpBtn.getAttribute('title'), 'Help · replay walkthrough');

  // Verify inline SVG with Lucide CircleHelp
  const svg = helpBtn.querySelector('svg');
  assert.ok(svg);
  assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
  assert.equal(svg.getAttribute('stroke-width'), '1.75');
  assert.equal(svg.getAttribute('fill'), 'none');

  // Verify auto-start was scheduled
  assert.equal(timeoutScheduled, true);
  assert.equal(scheduledDelay, 1200);

  // Verify window.__gevWalkthrough exposed
  assert.ok(mockWindow.__gevWalkthrough);
  assert.equal(mockWindow.__gevWalkthrough.steps, WALKTHROUGH_STEPS);
  assert.equal(typeof mockWindow.__gevWalkthrough.start, 'function');
  assert.equal(typeof mockWindow.__gevWalkthrough.isActive, 'function');

  // Destroy removes button and cleans up
  installed.destroy();
  assert.equal(doc.getElementById('gev-help-button'), null);
  assert.equal(timeoutScheduled, false);

  // When storage is dismissed, auto-start must NOT be scheduled
  storage.setItem(WALKTHROUGH_STORAGE_KEY, 'dismissed');
  let autoStartedWhenDismissed = false;
  const mockWindow2 = {
    location: { search: '' },
    setTimeout() {
      autoStartedWhenDismissed = true;
      return 456;
    },
    clearTimeout() {}
  };

  const installed2 = installWalkthrough({
    document: doc,
    window: mockWindow2,
    storage,
    autoStartDelayMs: 500,
    loadDriver: fakeLoadDriver
  });

  assert.equal(autoStartedWhenDismissed, false, 'Auto-start must not be scheduled when dismissed');
  installed2.destroy();
});
