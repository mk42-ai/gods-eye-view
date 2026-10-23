/**
 * Minimal DOM stub for node:test suites.
 * @module ui/scenes-panel/testDom
 */

export class DomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.key = init.key || '';
    this.shiftKey = Boolean(init.shiftKey);
    this.target = null;
    this.defaultPrevented = false;
    this._immediateStopped = false;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {
    this._stopped = true;
  }
  stopImmediatePropagation() {
    this._immediateStopped = true;
  }
}

function matchesCompound(el, part) {
  const m = part.match(
    /^([a-z0-9-]+)?((?:#[a-z0-9-_]+)?(?:\.[a-z0-9-_]+)*)((?:\[[^\]]+\])*)$/i,
  );
  if (!m) return false;
  const [, tag, idClass, attrs] = m;
  if (tag && tag !== '*' && el.tagName.toLowerCase() !== tag.toLowerCase())
    return false;
  if (idClass) {
    const idM = idClass.match(/#([a-z0-9-_]+)/i);
    if (idM && el.id !== idM[1]) return false;
    const cls = idClass.match(/\.([a-z0-9-_]+)/gi);
    if (cls && !cls.every((c) => el.classList.contains(c.slice(1))))
      return false;
  }
  if (attrs) {
    const r = /\[([a-z0-9-_]+)(?:=([^\]]+))?\]/gi;
    let am;
    while ((am = r.exec(attrs)) !== null) {
      const act = el.getAttribute(am[1]);
      if (act === null) return false;
      if (am[2] && act !== am[2].replace(/^["']|["']$/g, '')) return false;
    }
  }
  return true;
}

function matchesSelector(el, sel) {
  const parts = sel.trim().split(/\s+/);
  if (parts.length === 1) return matchesCompound(el, parts[0]);
  let curr = el;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!curr) return false;
    if (i === parts.length - 1) {
      if (!matchesCompound(curr, parts[i])) return false;
    } else {
      let f = false;
      while (curr.parentNode) {
        curr = curr.parentNode;
        if (matchesCompound(curr, parts[i])) {
          f = true;
          break;
        }
      }
      if (!f) return false;
    }
  }
  return true;
}

export class DomElement {
  constructor(tagName = 'div', ownerDocument = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = new Proxy(
      {},
      {
        get: (_, p) =>
          this.getAttribute(
            `data-${String(p).replace(/[A-Z]/g, '-$&').toLowerCase()}`,
          ),
        set: (_, p, v) => {
          this.setAttribute(
            `data-${String(p).replace(/[A-Z]/g, '-$&').toLowerCase()}`,
            v,
          );
          return true;
        },
      },
    );
    this.classList = {
      add: (...cls) => {
        const cur = (this.className || '').split(/\s+/).filter(Boolean);
        for (const c of cls) if (!cur.includes(c)) cur.push(c);
        this.className = cur.join(' ');
      },
      remove: (...cls) => {
        const cur = (this.className || '').split(/\s+/).filter(Boolean);
        this.className = cur.filter((c) => !cls.includes(c)).join(' ');
      },
      contains: (c) =>
        (this.className || '').split(/\s+/).filter(Boolean).includes(c),
      toggle: (c, force) => {
        const set =
          force !== undefined ? Boolean(force) : !this.classList.contains(c);
        if (set) this.classList.add(c);
        else this.classList.remove(c);
        return set;
      },
    };
  }
  get id() {
    return this.getAttribute('id') || '';
  }
  set id(v) {
    this.setAttribute('id', v);
  }
  get className() {
    return this.getAttribute('class') || '';
  }
  set className(v) {
    this.setAttribute('class', v);
  }
  get src() {
    return this.getAttribute('src') || '';
  }
  set src(v) {
    this.setAttribute('src', v);
  }
  get value() {
    return this.getAttribute('value') || '';
  }
  set value(v) {
    this.setAttribute('value', v);
  }
  get type() {
    return this.getAttribute('type') || '';
  }
  set type(v) {
    this.setAttribute('type', v);
  }
  setAttribute(k, v) {
    this.attributes.set(k.toLowerCase(), String(v));
  }
  getAttribute(k) {
    const v = this.attributes.get(k.toLowerCase());
    return v !== undefined ? v : null;
  }
  removeAttribute(k) {
    this.attributes.delete(k.toLowerCase());
  }
  appendChild(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  append(...nodes) {
    for (const n of nodes) this.appendChild(n);
  }
  removeChild(c) {
    const idx = this.children.indexOf(c);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      c.parentNode = null;
    }
    return c;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  replaceWith(n) {
    const p = this.parentNode;
    if (!p) return;
    const idx = p.children.indexOf(this);
    if (idx !== -1) {
      if (n.parentNode) n.parentNode.removeChild(n);
      p.children[idx] = n;
      n.parentNode = p;
      this.parentNode = null;
    }
  }
  replaceChildren(...nodes) {
    for (const c of [...this.children]) this.removeChild(c);
    this.append(...nodes);
  }
  get textContent() {
    return (
      (this._text ?? '') + this.children.map((c) => c.textContent).join('')
    );
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  addEventListener(t, fn, cap = false) {
    if (!this.listeners.has(t)) this.listeners.set(t, []);
    this.listeners.get(t).push({ fn, capture: Boolean(cap) });
  }
  removeEventListener(t, fn, cap = false) {
    const l = this.listeners.get(t);
    if (l)
      this.listeners.set(
        t,
        l.filter((i) => i.fn !== fn || i.capture !== Boolean(cap)),
      );
  }
  dispatchEvent(ev) {
    ev.target = this;
    for (const l of this.listeners.get(ev.type) || []) {
      if (ev._immediateStopped) break;
      l.fn.call(this, ev);
    }
    return !ev.defaultPrevented;
  }
  click() {
    this.dispatchEvent(new DomEvent('click'));
  }
  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  select() {}
  contains(o) {
    let p = o;
    while (p) {
      if (p === this) return true;
      p = p.parentNode;
    }
    return false;
  }
  querySelector(s) {
    for (const c of this.children) {
      if (matchesSelector(c, s)) return c;
      const f = c.querySelector(s);
      if (f) return f;
    }
    return null;
  }
  querySelectorAll(s) {
    const r = [];
    for (const c of this.children) {
      if (matchesSelector(c, s)) r.push(c);
      r.push(...c.querySelectorAll(s));
    }
    return r;
  }
}

export function createTestDom() {
  const listeners = new Map();
  const doc = {
    activeElement: null,
    createElement: (tag) => new DomElement(tag, doc),
    addEventListener: (t, fn, c) => {
      if (!listeners.has(t)) listeners.set(t, []);
      listeners.get(t).push({ fn, capture: Boolean(c) });
    },
    removeEventListener: (t, fn, c) => {
      const l = listeners.get(t);
      if (l)
        listeners.set(
          t,
          l.filter((i) => i.fn !== fn || i.capture !== Boolean(c)),
        );
    },
    dispatchEvent: (ev) => {
      for (const l of listeners.get(ev.type) || []) l.fn(ev);
      return !ev.defaultPrevented;
    },
    querySelector: (s) => doc.body.querySelector(s),
    querySelectorAll: (s) => doc.body.querySelectorAll(s),
  };
  doc.body = new DomElement('body', doc);
  doc.documentElement = new DomElement('html', doc);
  const win = {
    document: doc,
    addEventListener: doc.addEventListener,
    removeEventListener: doc.removeEventListener,
    dispatchEvent: doc.dispatchEvent,
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
  return { document: doc, window: win };
}
