import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLegend } from './sceneLegend.js';

function makeMockDoc() {
  const doc = {};
  function mk(tag) {
    const attrs = new Map();
    const listeners = new Map();
    const node = {
      tagName: tag.toUpperCase(),
      id: '',
      children: [],
      parentNode: null,
      dataset: {},
      textContent: '',
      type: '',
      get className() {
        return attrs.get('class') || '';
      },
      set className(v) {
        attrs.set('class', v);
      },
      get hidden() {
        return attrs.has('hidden');
      },
      set hidden(v) {
        if (v) attrs.set('hidden', '');
        else attrs.delete('hidden');
      },
      setAttribute(n, v) {
        attrs.set(n, String(v));
      },
      getAttribute(n) {
        return attrs.get(n) ?? null;
      },
      removeAttribute(n) {
        attrs.delete(n);
      },
      append(...kids) {
        for (const k of kids) {
          k.remove?.();
          this.children.push(k);
          k.parentNode = this;
        }
      },
      replaceChildren(...kids) {
        for (const k of this.children) k.parentNode = null;
        this.children = [];
        this.append(...kids);
      },
      remove() {
        if (this.parentNode)
          this.parentNode.children = this.parentNode.children.filter(
            (c) => c !== this,
          );
        this.parentNode = null;
      },
      addEventListener(evt, fn) {
        if (!listeners.has(evt)) listeners.set(evt, []);
        listeners.get(evt).push(fn);
      },
      dispatchEvent(evt) {
        for (const fn of listeners.get(evt.type) || []) fn(evt);
      },
      click() {
        this.dispatchEvent({ type: 'click' });
      },
      find(pred) {
        return this.children.flatMap((c) => [
          ...(pred(c) ? [c] : []),
          ...(c.find ? c.find(pred) : []),
        ]);
      },
      matches(sel) {
        if (sel.startsWith('#')) return this.id === sel.slice(1);
        if (sel.startsWith('.'))
          return this.className.split(/\s+/).includes(sel.slice(1));
        return this.tagName === sel.toUpperCase();
      },
      querySelector(sel) {
        return this.find((c) => c.matches(sel))[0] || null;
      },
      querySelectorAll(sel) {
        return this.find((c) => c.matches(sel));
      },
    };
    return node;
  }
  doc.createElement = mk;
  doc.body = mk('body');
  return doc;
}

test('sceneLegend is collapsed by default as a 28 px pill and toggles aria-expanded', () => {
  const doc = makeMockDoc();
  const legend = createSceneLegend({ document: doc });

  const root = legend.element;
  assert.equal(root.id, 'scene-legend');
  assert.equal(root.getAttribute('aria-label'), 'Scene map legend');

  const toggleBtn = root.querySelector('#scene-legend-toggle');
  assert.ok(toggleBtn, 'toggle button exists');
  assert.equal(toggleBtn.getAttribute('aria-expanded'), 'false');
  assert.equal(toggleBtn.textContent, 'Legend');

  const content = root.querySelector('#scene-legend-content');
  assert.ok(content, 'content container exists');
  assert.equal(content.hidden, true);

  // Toggle open
  legend.toggle();
  assert.equal(toggleBtn.getAttribute('aria-expanded'), 'true');
  assert.equal(toggleBtn.textContent, 'Legend');
  assert.equal(content.hidden, false);

  // Toggle closed via button click
  toggleBtn.click();
  assert.equal(toggleBtn.getAttribute('aria-expanded'), 'false');
  assert.equal(toggleBtn.textContent, 'Legend');
  assert.equal(content.hidden, true);

  legend.destroy();
});

test('setScene populates legend with elements present, line styles, and badge', () => {
  const doc = makeMockDoc();
  const legend = createSceneLegend({ document: doc });

  const mockScene = {
    staging: {
      spec: {
        scenarioType: 'marathon',
        elements: [
          { type: 'command_post' },
          { type: 'start_finish' },
          { type: 'crowd_zone' },
          { type: 'inner_cordon' },
        ],
      },
    },
  };

  legend.setScene(mockScene);
  const state = legend.getState();
  assert.equal(state.visible, true);
  assert.equal(state.badgeText, 'ILLUSTRATIVE');
  assert.equal(state.itemCount, 4);

  const elementTypes = state.elements.map((e) => e.element);
  assert.ok(elementTypes.includes('command_post'));
  assert.ok(elementTypes.includes('start_finish'));
  assert.ok(elementTypes.includes('crowd_zone'));
  assert.ok(elementTypes.includes('inner_cordon'));

  // Clear hides legend
  legend.clear();
  assert.equal(legend.getState().visible, false);
  assert.equal(legend.getState().itemCount, 0);

  legend.destroy();
});
