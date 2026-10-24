/**
 * @fileoverview Lightweight DOM and Cesium stub for Node test runner.
 * @module gods-eye/ui/scene/testDomStub
 */

/**
 * Creates a minimal DOM element stub.
 * @param {string} tag
 * @param {any} [doc]
 * @returns {any}
 */
export function createStubElement(tag, doc = null) {
  const listeners = {};
  const classes = new Set();
  const attributes = {};

  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    ownerDocument: doc,
    id: '',
    children: [],
    childNodes: [],
    parentElement: null,
    dataset: {},
    style: {},
    hidden: false,
    tabIndex: 0,
    min: '0',
    max: '1000',
    value: '500',
    src: '',
    alt: '',
    href: '',
    target: '',
    rel: '',
    title: '',
    type: 'text',

    get className() {
      return Array.from(classes).join(' ');
    },
    set className(val) {
      classes.clear();
      if (val) (val.match(/\S+/g) || []).forEach((c) => classes.add(c));
    },

    classList: {
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      toggle: (c, f) => {
        const next = f !== undefined ? Boolean(f) : !classes.has(c);
        if (next) classes.add(c);
        else classes.delete(c);
        return next;
      },
      contains: (c) => classes.has(c),
    },

    get textContent() {
      return el._textContent !== undefined
        ? el._textContent
        : el.children.map((c) => c.textContent).join('');
    },
    set textContent(v) {
      el._textContent = String(v ?? '');
      el.children = [];
      el.childNodes = [];
    },

    get innerHTML() {
      return el.children
        .map((c) => `<${c.tagName.toLowerCase()}></${c.tagName.toLowerCase()}>`)
        .join('');
    },
    set innerHTML(v) {
      el.children = [];
      el.childNodes = [];
      el._textContent = '';
    },

    setAttribute(k, v) {
      attributes[k] = String(v);
      if (k === 'id') el.id = String(v);
      if (k === 'class') el.className = String(v);
      if (k === 'hidden') el.hidden = true;
      if (k.startsWith('data-')) {
        const camel = k
          .slice(5)
          .replace(/-([a-z])/g, (_, g) => g.toUpperCase());
        el.dataset[camel] = String(v);
      }
    },
    getAttribute: (k) => attributes[k] ?? null,
    removeAttribute(k) {
      delete attributes[k];
      if (k === 'hidden') el.hidden = false;
      if (k.startsWith('data-')) {
        const camel = k
          .slice(5)
          .replace(/-([a-z])/g, (_, g) => g.toUpperCase());
        delete el.dataset[camel];
      }
    },

    appendChild(child) {
      if (!child) return child;
      child.parentElement = el;
      el.children.push(child);
      el.childNodes.push(child);
      return child;
    },
    append(...nodes) {
      nodes.forEach((n) => el.appendChild(n));
    },
    remove() {
      if (el.parentElement) {
        const idx = el.parentElement.children.indexOf(el);
        if (idx >= 0) el.parentElement.children.splice(idx, 1);
        const cidx = el.parentElement.childNodes.indexOf(el);
        if (cidx >= 0) el.parentElement.childNodes.splice(cidx, 1);
        el.parentElement = null;
      }
    },

    querySelector: (selector) => findDescendant(el, selector),
    querySelectorAll: (selector) => {
      const results = [];
      findAllDescendants(el, selector, results);
      return results;
    },
    closest(selector) {
      let cur = el;
      while (cur) {
        if (matchesSelector(cur, selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },

    addEventListener(event, fn) {
      (listeners[event] ||= []).push(fn);
    },
    removeEventListener(event, fn) {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((f) => f !== fn);
      }
    },
    dispatchEvent(event) {
      const fns = listeners[event.type || event] || [];
      for (const fn of fns) fn(event);
      return true;
    },
    click: () => el.dispatchEvent({ type: 'click', target: el }),
    focus() {},
    blur() {},
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 300,
      bottom: 200,
      width: 300,
      height: 200,
    }),
  };

  return el;
}

function matchesSelector(el, selector) {
  if (!el || !selector) return false;
  if (selector.startsWith('#')) return el.id === selector.slice(1);
  if (selector.startsWith('.')) return el.classList.contains(selector.slice(1));
  if (selector.startsWith('[')) {
    const m = selector.match(/\[([a-zA-Z0-9_-]+)(?:=["']?(.*?)["']?)?\]/);
    if (!m) return false;
    const [, attr, val] = m;
    if (attr.startsWith('data-')) {
      const camel = attr
        .slice(5)
        .replace(/-([a-z])/g, (_, g) => g.toUpperCase());
      return val !== undefined
        ? el.dataset[camel] === val
        : el.dataset[camel] !== undefined;
    }
    return val !== undefined
      ? el.getAttribute(attr) === val
      : el.getAttribute(attr) !== null;
  }
  return el.tagName.toLowerCase() === selector.toLowerCase();
}

function findDescendant(parent, selector) {
  for (const child of parent.children) {
    if (matchesSelector(child, selector)) return child;
    const found = findDescendant(child, selector);
    if (found) return found;
  }
  return null;
}

function findAllDescendants(parent, selector, out) {
  for (const child of parent.children) {
    if (matchesSelector(child, selector)) out.push(child);
    findAllDescendants(child, selector, out);
  }
}

/**
 * Creates a minimal fake Document object.
 */
export function createStubDocument() {
  const doc = {
    createElement: (tag) => createStubElement(tag, doc),
    body: null,
    getElementById: (id) =>
      doc.body ? findDescendant(doc.body, `#${id}`) : null,
    querySelector: (sel) => (doc.body ? findDescendant(doc.body, sel) : null),
    querySelectorAll: (sel) => {
      const results = [];
      if (doc.body) findAllDescendants(doc.body, sel, results);
      return results;
    },
  };
  doc.body = createStubElement('body', doc);
  return doc;
}
