import test from 'node:test';
import assert from 'node:assert/strict';
import { createIncidentComposer } from './ui/composer.js';
import { createSceneLibrary } from './ui/sceneLibrary.js';

/**
 * DOM-only regression harness, following composer.test.mjs. Events bubble and
 * preserve defaultPrevented independently of propagation. It intentionally
 * supplies NO layout, CSS, implicit Enter submission, native tab traversal, or
 * screen-reader implementation: those require a real browser/accessibility QA.
 */
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

const MARINA = {
  name: 'Dubai Marina',
  lat: 25.0805,
  lon: 55.1403,
  confidence: 1,
  source: 'test fixture',
  aoi_membership: { inside: true, aoi_ids: ['uae'] },
};
const SCENE = {
  id: 'marina-test',
  title: 'Dubai Marina',
  keyframes: [{ lat: 25.0805, lon: 55.1403 }],
};
const QUERY = 'Build a scene of Dubai Marina';
const located = (candidates = [MARINA]) => ({
  candidates,
  extraction: { intent: 'build_scene', hasEventDescription: false },
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 24; i += 1) await Promise.resolve();
}
function nodeById(root, id) {
  const node = root.find((child) => child.id === id)[0];
  assert.ok(node, `Expected actual DOM node #${id}`);
  return node;
}
function composerFixture(t, overrides = {}) {
  const document = makeDoc();
  const composer = createIncidentComposer({
    document,
    client: { locate: async () => located() },
    createGeographicScene: async () => SCENE,
    ...overrides,
  });
  document.body.append(composer.element);
  t.after(() => composer.destroy());
  return { document, composer };
}
function libraryFixture(t, overrides = {}) {
  const document = makeDoc();
  const library = createSceneLibrary({ document, ...overrides });
  document.body.append(library.element);
  t.after(() => library.destroy());
  return { document, library };
}
function assertNativeButton(node, type = 'button') {
  assert.equal(node.tagName, 'BUTTON');
  assert.equal(node.type, type);
  assert.ok(node.text().trim(), 'button has a textual accessible-name source');
  assert.notEqual(node.getAttribute('tabindex'), '-1');
}

test('composer preserves key defaults and handles only the actual form submit', async (t) => {
  const gate = deferred();
  const calls = [];
  const { composer } = composerFixture(t, {
    client: {
      locate(text) {
        calls.push(text);
        return gate.promise;
      },
    },
  });
  assert.equal(composer.element.tagName, 'FORM');
  assert.equal(composer.element.getAttribute('role'), 'search');
  assert.ok(composer.element.getAttribute('aria-label'));
  assert.equal(composer.input.tagName, 'TEXTAREA');
  assert.equal(composer.input.rows, 2);
  assert.equal(composer.input.maxLength, 6000);
  assert.ok(composer.input.getAttribute('aria-label'));
  assert.equal(composer.input.getAttribute('enterkeyhint'), 'enter');
  assertNativeButton(
    nodeById(composer.element, 'incident-composer-submit'),
    'submit',
  );
  assertNativeButton(nodeById(composer.element, 'incident-composer-cancel'));
  assertNativeButton(nodeById(composer.element, 'incident-composer-retry'));
  let bubbled = 0;
  composer.element.addEventListener('keydown', () => {
    bubbled += 1;
  });
  composer.input.value = QUERY;
  for (const key of ['Enter', 'Tab', ' ', 'ArrowLeft', 'Escape']) {
    const event = composer.input.fire('keydown', { key });
    assert.equal(
      event.defaultPrevented,
      false,
      `${key}: native default retained`,
    );
    assert.equal(
      event.propagationStopped,
      true,
      `${key}: local bubble shortcuts isolated`,
    );
  }
  assert.equal(bubbled, 0);
  assert.equal(calls.length, 0, 'keydown is not a second submission pathway');
  const submit = composer.element.fire('submit');
  assert.equal(
    submit.defaultPrevented,
    true,
    'form navigation is prevented at submit, not keydown',
  );
  composer.element.fire('submit');
  assert.deepEqual(
    calls,
    [QUERY],
    'a busy form cannot start a duplicate request',
  );
  gate.resolve(located());
  await flush();
  assert.equal(composer.element.getAttribute('data-state'), 'done');
  assert.equal(
    composer.input.value,
    QUERY,
    'completion retains editable request',
  );
});

test('blank form submission is harmless and does not announce busy', async (t) => {
  let calls = 0;
  const { composer } = composerFixture(t, {
    client: {
      locate() {
        calls += 1;
      },
    },
  });
  composer.input.value = '  ';
  assert.equal(composer.element.fire('submit').defaultPrevented, true);
  await flush();
  assert.equal(calls, 0);
  assert.equal(composer.element.getAttribute('aria-busy'), 'false');
});

test('cancel immediately releases busy UI and a late locate cannot overwrite the cancellation announcement', async (t) => {
  const gate = deferred();
  let signal;
  let built = 0;
  const { composer } = composerFixture(t, {
    client: {
      locate(_text, options) {
        signal = options.signal;
        return gate.promise;
      },
    },
    createGeographicScene: async () => {
      built += 1;
      return SCENE;
    },
  });
  const run = composer.submit(QUERY);
  const cancel = nodeById(composer.element, 'incident-composer-cancel');
  const retry = nodeById(composer.element, 'incident-composer-retry');
  const result = nodeById(composer.element, 'incident-composer-result');
  const chips = nodeById(composer.element, 'incident-composer-chips');
  assert.equal(composer.element.getAttribute('aria-busy'), 'true');
  assert.equal(
    nodeById(composer.element, 'incident-composer-submit').disabled,
    false,
  );
  assert.equal(cancel.hidden, false);
  assert.equal(cancel.disabled, false);
  assert.equal(result.getAttribute('aria-live'), 'polite');
  assert.equal(chips.getAttribute('aria-live'), 'polite');
  cancel.fire('click');
  assert.equal(signal.aborted, true);
  assert.equal(composer.element.getAttribute('aria-busy'), 'false');
  assert.equal(composer.element.getAttribute('data-state'), 'cancelled');
  assert.equal(cancel.hidden, true);
  assert.equal(retry.hidden, false);
  assert.equal(retry.disabled, false);
  assert.equal(result.hidden, false);
  assert.match(result.text(), /Cancelled/);
  assert.equal(composer.state.lastScene, null);
  assert.equal(composer.state.lastSearch, null);
  assert.ok(!chips.find((node) => node.dataset.status === 'active').length);
  const announcement = result.text();
  gate.resolve(located());
  await run;
  assert.equal(built, 0);
  assert.equal(result.text(), announcement);
  assert.equal(composer.element.getAttribute('data-state'), 'cancelled');
});

test('a cancelled callback cannot clear a newer busy request or publish a stale Play control', async (t) => {
  const oldCallback = deferred();
  const newLocate = deferred();
  let calls = 0;
  const { composer } = composerFixture(t, {
    client: {
      locate() {
        calls += 1;
        return calls === 1 ? Promise.resolve(located()) : newLocate.promise;
      },
    },
    onScene: () => oldCallback.promise,
  });
  const oldRun = composer.submit(QUERY);
  await flush();
  assert.equal(composer.state.steps.building, 'active');
  composer.cancel();
  const newRun = composer.submit('Build a scene of Abu Dhabi');
  oldCallback.resolve();
  await oldRun;
  assert.equal(composer.element.getAttribute('aria-busy'), 'true');
  assert.equal(composer.element.getAttribute('data-state'), 'busy');
  assert.equal(
    composer.element.find((node) => node.id === 'incident-composer-play')
      .length,
    0,
  );
  newLocate.resolve(located());
  await newRun;
  assert.equal(composer.element.getAttribute('aria-busy'), 'false');
  assert.equal(composer.element.getAttribute('data-state'), 'done');
  assertNativeButton(nodeById(composer.element, 'incident-composer-play'));
});

test('retry activates the failed request without consuming a subsequently edited draft', async (t) => {
  const texts = [];
  const gate = deferred();
  const { composer } = composerFixture(t, {
    client: {
      locate(text) {
        texts.push(text);
        return texts.length === 1
          ? Promise.reject(new Error('offline'))
          : gate.promise;
      },
    },
  });
  await composer.submit(QUERY);
  const result = nodeById(composer.element, 'incident-composer-result');
  assert.match(result.text(), /Locate failed: offline/);
  assert.equal(composer.element.getAttribute('aria-busy'), 'false');
  composer.input.value = 'unsent edited draft';
  const retry = nodeById(composer.element, 'incident-composer-retry');
  assert.equal(retry.hidden, false);
  retry.fire('click');
  assert.deepEqual(texts, [QUERY, QUERY]);
  assert.equal(composer.element.getAttribute('aria-busy'), 'true');
  gate.resolve(located());
  await flush();
  assert.equal(composer.input.value, 'unsent edited draft');
  assert.equal(composer.element.getAttribute('data-state'), 'done');
});

test('candidate choices are named native buttons and detached stale choices cannot act', async (t) => {
  const gate = deferred();
  let calls = 0;
  let builds = 0;
  const { composer } = composerFixture(t, {
    client: {
      locate() {
        calls += 1;
        return calls === 1
          ? Promise.resolve(
              located([
                { ...MARINA, confidence: 0.7 },
                {
                  ...MARINA,
                  name: 'Other Marina',
                  lat: MARINA.lat + 1,
                  confidence: 0.7,
                },
              ]),
            )
          : gate.promise;
      },
    },
    createGeographicScene: async () => {
      builds += 1;
      return SCENE;
    },
  });
  await composer.submit(QUERY);
  const choices = composer.element.find(
    (node) => node.className === 'incident-composer__candidate',
  );
  assert.equal(choices.length, 2);
  choices.forEach((node) => assertNativeButton(node));
  const currentRun = composer.submit('Build a scene of Abu Dhabi');
  choices[0].fire('click');
  await flush();
  assert.equal(builds, 0);
  gate.resolve(located());
  await currentRun;
  assert.equal(builds, 1);
});

test('scene library exposes associated labels, live statuses, native controls and guarded form saving', async (t) => {
  const gate = deferred();
  const saves = [];
  const { library } = libraryFixture(t, {
    onSave: (scene) => {
      saves.push(scene);
      return gate.promise;
    },
  });
  const input = nodeById(library.element, 'scene-library-name');
  const save = nodeById(library.element, 'scene-library-save');
  const select = nodeById(library.element, 'scene-library-saved');
  const status = nodeById(library.element, 'scene-library-status');
  assertNativeButton(save, 'submit');
  assert.equal(select.tagName, 'SELECT');
  for (const node of [input, select])
    assert.ok(
      library.element.find(
        (label) => label.tagName === 'LABEL' && label.htmlFor === node.id,
      ).length,
    );
  assert.equal(input.getAttribute('aria-describedby'), status.id);
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.equal(
    nodeById(library.element, 'scene-library-active').getAttribute(
      'aria-atomic',
    ),
    'true',
  );
  assert.equal(save.disabled, true);
  library.setScene(SCENE);
  input.value = '  ';
  input.fire('input');
  assert.equal(save.disabled, true);
  input.value = 'Named marina';
  input.fire('input');
  assert.equal(save.disabled, false);
  assert.equal(input.fire('keydown', { key: 'Enter' }).defaultPrevented, false);
  assert.equal(saves.length, 0);
  const form = save.parentNode;
  assert.equal(form.tagName, 'FORM');
  assert.equal(form.fire('submit').defaultPrevented, true);
  form.fire('submit');
  assert.equal(saves.length, 1);
  assert.equal(saves[0].title, 'Named marina');
  assert.equal(form.getAttribute('aria-busy'), 'true');
  assert.equal(save.disabled, true);
  assert.match(status.text(), /Saving/);
  gate.resolve({ ...saves[0], id: 'saved-marina' });
  await flush();
  assert.equal(form.getAttribute('aria-busy'), 'false');
  assert.match(status.text(), /Scene saved/);
  assert.equal(select.disabled, false);
});

test('late scene save does not overwrite a newer active-scene announcement', async (t) => {
  const gate = deferred();
  const { library } = libraryFixture(t, { onSave: () => gate.promise });
  library.setScene(SCENE);
  nodeById(library.element, 'scene-library-save').parentNode.fire('submit');
  library.setScene({ ...SCENE, id: 'new-scene', title: 'New active scene' });
  gate.resolve({ ...SCENE, title: 'Old saved response' });
  await flush();
  assert.equal(
    nodeById(library.element, 'scene-library-name').value,
    'New active scene',
  );
  assert.match(
    nodeById(library.element, 'scene-library-active').text(),
    /New active scene/,
  );
  assert.doesNotMatch(
    nodeById(library.element, 'scene-library-active').text(),
    /Old saved response/,
  );
  assert.equal(nodeById(library.element, 'scene-library-status').text(), '');
});

function sidebarFixture(t) {
  const fixture = libraryFixture(t);
  const { document, library } = fixture;
  const host = document.createElement('aside');
  const scenePanel = document.createElement('section');
  scenePanel.id = 'scene-panel';
  const dataPanel = document.createElement('section');
  dataPanel.id = 'data-panel';
  host.append(scenePanel, dataPanel);
  document.body.append(host);
  const sidebar = library.installSidebar({
    host,
    scenePanel,
    dataPanel,
    advanced: false,
  });
  assert.ok(sidebar);
  const scenes = nodeById(host, 'sidebar-scenes-tab');
  const layers = nodeById(host, 'sidebar-layers-tab');
  const toggle = nodeById(host, 'scene-drawer-toggle');
  return {
    ...fixture,
    host,
    sidebar,
    scenePanel,
    dataPanel,
    scenes,
    layers,
    toggle,
  };
}
function assertTabState(fixture, selected) {
  const { scenes, layers, scenePanel, dataPanel } = fixture;
  for (const [tab, panel, active] of [
    [scenes, scenePanel, selected === 'scenes'],
    [layers, dataPanel, selected === 'layers'],
  ]) {
    assert.equal(tab.getAttribute('aria-selected'), String(active));
    assert.equal(tab.tabIndex, active ? 0 : -1);
    assert.equal(panel.hidden, !active);
    assert.equal(panel.getAttribute('aria-hidden'), String(!active));
  }
}

test('sidebar uses related native tabs, roving tabindex and Arrow/Home/End focus handling', (t) => {
  const fixture = sidebarFixture(t);
  const { scenes, layers, scenePanel, dataPanel, document } = fixture;
  assert.equal(scenes.parentNode.getAttribute('role'), 'tablist');
  assert.ok(scenes.parentNode.getAttribute('aria-label'));
  for (const [tab, panel] of [
    [scenes, scenePanel],
    [layers, dataPanel],
  ]) {
    assert.equal(tab.tagName, 'BUTTON');
    assert.equal(tab.type, 'button');
    assert.equal(tab.getAttribute('role'), 'tab');
    assert.equal(tab.getAttribute('aria-controls'), panel.id);
    assert.equal(panel.getAttribute('role'), 'tabpanel');
    assert.equal(panel.getAttribute('aria-labelledby'), tab.id);
  }
  assertTabState(fixture, 'scenes');
  for (const [target, key, expected, focused] of [
    [scenes, 'ArrowRight', 'layers', layers],
    [layers, 'ArrowRight', 'scenes', scenes],
    [scenes, 'End', 'layers', layers],
    [layers, 'Home', 'scenes', scenes],
    [scenes, 'ArrowLeft', 'layers', layers],
  ]) {
    assert.equal(target.fire('keydown', { key }).defaultPrevented, true);
    assertTabState(fixture, expected);
    assert.equal(
      document.activeElement,
      focused,
      'module calls focus on the newly selected tab',
    );
  }
});

test('Tab and modified arrows keep native defaults; Escape closes the panel and returns focus', (t) => {
  const fixture = sidebarFixture(t);
  const { scenes, scenePanel, dataPanel, toggle, document } = fixture;
  for (const init of [
    { key: 'Tab' },
    { key: 'ArrowRight', ctrlKey: true },
    { key: 'ArrowLeft', altKey: true },
    { key: 'End', metaKey: true },
  ]) {
    assert.equal(scenes.fire('keydown', init).defaultPrevented, false);
    assertTabState(fixture, 'scenes');
  }
  const consumed = scenePanel.fire('keydown', {
    key: 'Escape',
    defaultPrevented: true,
  });
  assert.equal(consumed.propagationStopped, false);
  assert.equal(
    scenePanel.hidden,
    false,
    'already-handled Escape does not close an outer panel',
  );
  const escape = scenePanel.fire('keydown', { key: 'Escape' });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(escape.propagationStopped, true);
  assert.equal(scenePanel.hidden, true);
  assert.equal(dataPanel.hidden, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, toggle);
  assertNativeButton(toggle);
  toggle.fire('click');
  assertTabState(fixture, 'scenes');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
});
