import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLibrary } from './sceneLibrary.js';
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

const basic = () => ({
  id: 'fixture',
  title: 'Fixture scene',
  geographic: true,
  illustrative: true,
  anchor: { name: 'Synthetic place', lat: 25, lon: 55 },
  keyframes: [{}],
  originalPrompt: 'Source <b>text</b>',
  refinedPrompt: 'Refined text',
  durationSec: 12,
  plan: { beats: [{ atSec: 0 }] },
  placements: [{}, {}],
  citations: [{ url: 'https://example.org/story', title: 'Reference' }],
});
const flush = async () => {
  for (let i = 0; i < 24; i++) await Promise.resolve();
};
function setup(t, options = {}) {
  const document = makeDoc();
  const library = createSceneLibrary({ document, ...options });
  document.body.append(library.element);
  t.after(() => library.destroy());
  return { document, library, node: (id) => document.getElementById(id) };
}

test('library explicitly discloses browser-local scope and displays illustrative sources safely', (t) => {
  const { library, node } = setup(t);
  library.setScene(basic());
  assert.match(node('scene-library-storage-notice').text(), /browser only/);
  assert.match(
    node('scene-library-storage-notice').text(),
    /not synced or backed up/,
  );
  assert.equal(library.element.dataset.persistence, 'browser-local');
  assert.match(node('scene-library-active').text(), /Illustrative staging/);
  assert.match(node('scene-library-active').text(), /2 illustrative actors/);
  assert.equal(
    node('scene-library-original-prompt').value,
    'Source <b>text</b>',
  );
  assert.equal(node('scene-library-original-prompt').readOnly, true);
  const links = node('scene-library-active').find((n) => n.tagName === 'A');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://example.org/story');
});
test('refined prompt notes save without mutating source or rebuilding plan; store-result envelope is accepted', async (t) => {
  let submitted;
  const { library, node } = setup(t, {
    storage: {
      save(scene) {
        submitted = scene;
        return { saved: true, scene };
      },
    },
  });
  const source = basic();
  library.setScene(source);
  node('scene-library-refined-prompt').value = 'Edited note';
  node('scene-library-refined-prompt').fire('input');
  assert.match(node('scene-library-status').text(), /staging is unchanged/);
  node('scene-library-save').parentNode.fire('submit');
  await flush();
  assert.equal(submitted.refinedPrompt, 'Edited note');
  assert.equal(submitted.originalPrompt, source.originalPrompt);
  assert.deepEqual(submitted.plan, source.plan);
  assert.equal(source.refinedPrompt, 'Refined text');
  assert.match(node('scene-library-status').text(), /Scene saved/);
  assert.equal(node('scene-library-saved').children[1].text(), 'Fixture scene');
});
test('failed store-result envelope cannot claim a save and reports corruption without overwriting', async (t) => {
  const { library, node } = setup(t, {
    storage: {
      save() {
        return { saved: false, reason: 'corrupt-storage' };
      },
    },
  });
  library.setScene(basic());
  node('scene-library-save').parentNode.fire('submit');
  await flush();
  assert.match(node('scene-library-status').text(), /corrupt/);
  assert.match(node('scene-library-status').text(), /not overwritten/);
  assert.equal(node('scene-library-saved').disabled, true);
});
test('old scenes hide prompt editor; initial corrupt-storage status is visible', async (t) => {
  const { library, node } = setup(t, {
    storage: {
      list: () => [],
      getStatus: () => ({ available: false, reason: 'corrupt-storage' }),
    },
  });
  const scene = basic();
  delete scene.originalPrompt;
  delete scene.refinedPrompt;
  library.setScene(scene);
  assert.equal(node('scene-library-prompts').hidden, true);
  await flush();
  assert.match(
    node('scene-library-status').text(),
    /corrupt.*not been overwritten/,
  );
});
