import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { installFootageDock, FOOTAGE_DOCK_ID, FOOTAGE_BANNER_ID } from './ui/dock.js';

/** Minimal DOM stand-in (same style as src/incidents/composer.test.mjs). */
function makeDoc() {
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.attrs = {};
      this.dataset = {};
      this.style = {};
      this.listeners = {};
      this.hidden = false;
      this.textContent = '';
      this.classList = {
        set: new Set(),
        add: (...c) => c.forEach((x) => this.classList.set.add(x)),
        remove: (...c) => c.forEach((x) => this.classList.set.delete(x)),
        toggle: (c, force) => {
          const on = force === undefined ? !this.classList.set.has(c) : force;
          if (on) this.classList.set.add(c);
          else this.classList.set.delete(c);
          return on;
        },
        contains: (c) => this.classList.set.has(c),
      };
    }
    get ownerDocument() {
      return doc;
    }
    set className(v) {
      this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
    }
    get className() {
      return [...this.classList.set].join(' ');
    }
    set id(v) {
      this.attrs.id = v;
      doc.byId.set(v, this);
    }
    get id() {
      return this.attrs.id || '';
    }
    set innerHTML(v) {
      this.children = [];
      this._html = v;
    }
    get innerHTML() {
      return this._html || '';
    }
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'id') doc.byId.set(v, this);
    }
    getAttribute(k) {
      return this.attrs[k] ?? null;
    }
    removeAttribute(k) {
      delete this.attrs[k];
    }
    append(...nodes) {
      nodes.forEach((n) => {
        n.parentNode = this;
        this.children.push(n);
      });
    }
    appendChild(n) {
      this.append(n);
      return n;
    }
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }
    replaceWith(n) {
      const p = this.parentNode;
      if (!p) return;
      p.children[p.children.indexOf(this)] = n;
      n.parentNode = p;
    }
    remove() {
      const p = this.parentNode;
      if (p) p.children = p.children.filter((c) => c !== this);
    }
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    }
    removeEventListener(type, fn) {
      this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
    }
    dispatchEvent(ev) {
      (this.listeners[ev.type] || []).forEach((fn) => fn(ev));
      return true;
    }
    click() {
      this.dispatchEvent({ type: 'click', preventDefault() {} });
    }
    *walk() {
      for (const c of this.children) {
        yield c;
        yield* c.walk();
      }
    }
    querySelectorAll(sel) {
      const out = [];
      const m = sel.match(/^\.([\w-]+)$/);
      const dm = sel.match(/^\[data-index="(\d+)"\]$/);
      for (const n of this.walk()) {
        if (m && n.classList.contains(m[1])) out.push(n);
        else if (dm && n.dataset.index === dm[1]) out.push(n);
      }
      return out;
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 100, height: 100 };
    }
  }
  const doc = {
    byId: new Map(),
    createElement: (t) => new Node(t),
    getElementById: (id) => doc.byId.get(id) || null,
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll: () => [],
  };
  doc.body = new Node('body');
  doc.head = new Node('head');
  doc.documentElement = doc.body;
  return doc;
}

function makeWin(hash = '') {
  const listeners = {};
  const win = {
    location: { hash, origin: 'https://example.test' },
    history: { replaceState: (_s, _t, url) => (win.location.hash = url) },
    addEventListener: (t, fn) => (listeners[t] ||= []).push(fn),
    removeEventListener: (t, fn) => (listeners[t] = (listeners[t] || []).filter((f) => f !== fn)),
    dispatchEvent: (ev) => (listeners[ev.type] || []).forEach((fn) => fn(ev)),
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)),
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
  };
  return win;
}

function fakeClient(items, { done = {}, query = { place: { name: 'Umm Suqeim', lat: 25.147, lon: 55.199 }, query_variants: ['Umm Suqeim car crash'] } } = {}) {
  const calls = [];
  return {
    calls,
    async stream(params, handlers) {
      calls.push(params);
      handlers.onQuery?.(query);
      handlers.onSourceStart?.({ source: 'youtube' });
      handlers.onSourceStart?.({ source: 'tiktok' });
      for (const it of items) handlers.onItem?.(it);
      handlers.onSourceDone?.({ source: 'youtube', status: 'ok', count: items.length });
      handlers.onSourceDone?.({ source: 'tiktok', status: 'unavailable', error: 'not subscribed' });
      const payload = { all_sources_failed: items.length === 0 && done.all_sources_failed, ...done };
      handlers.onDone?.(payload);
      return payload;
    },
  };
}

const ARCHIVE_ITEMS = [
  { source: 'instagram', title: 'Gulf Today: Umm Suqeim crash', url: 'https://www.instagram.com/p/DdyBfSdl-zh/', embed_url: 'https://www.instagram.com/p/DdyBfSdl-zh/embed/', published_at: '2026-09-27T07:00:10Z', freshness: 'ARCHIVE', canonical: 'ig:DdyBfSdl-zh' },
  { source: 'instagram', title: 'Gulf News: Umm Suqeim Street crash', url: 'https://www.instagram.com/p/Ddv9evCDLQp/', embed_url: 'https://www.instagram.com/p/Ddv9evCDLQp/embed/', published_at: '2026-09-26T11:46:39Z', freshness: 'ARCHIVE', canonical: 'ig:Ddv9evCDLQp' },
  { source: 'youtube', title: 'Dubai crash short', url: 'https://www.youtube.com/shorts/pu6shIJmb5s', embed_url: 'https://www.youtube.com/embed/pu6shIJmb5s?autoplay=1', published_at: '2026-03-08T00:00:00Z', freshness: 'ARCHIVE', canonical: 'yt:pu6shIJmb5s' },
];

describe('footage dock', () => {
  test('mounts, streams items, plays the first clip and shows source status', async () => {
    const doc = makeDoc();
    const win = makeWin('#v=2&lat=25.1&lon=55.2');
    const client = fakeClient(ARCHIVE_ITEMS);
    const flights = [];
    const dock = installFootageDock({ document: doc, window: win, client, readCamera: () => ({ lat: 25.1, lon: 55.2, alt: 5000 }), flyTo: (lat, lon) => flights.push([lat, lon]), autoStart: false });
    assert.ok(doc.getElementById(FOOTAGE_DOCK_ID));
    await dock.run('test');
    assert.equal(dock.state.items.length, 3);
    assert.equal(dock.state.current, 0, 'first playable clip starts immediately');
    assert.equal(dock.elements.player.dataset.kind, 'instagram');
    assert.match(dock.elements.sourcesRow.children.map((c) => c.textContent).join(' '), /YOUTUBE OK 3/);
    assert.match(dock.elements.sourcesRow.children.map((c) => c.textContent).join(' '), /TIKTOK N\/A/);
    const banner = doc.getElementById(FOOTAGE_BANNER_ID);
    assert.equal(banner.hidden, false);
    assert.match(banner.textContent, /REBUILT FROM ARCHIVAL FOOTAGE — originally reported 2026-03-08/);
    const times = dock.elements.list.querySelectorAll('.footage-list__time').map((t) => t.textContent);
    assert.deepEqual(times, ['2026-09-27 07:00Z', '2026-09-26 11:46Z', '2026-03-08 00:00Z']);
    const freshness = dock.elements.list.querySelectorAll('.footage-list__item').map((li) => li.dataset.freshness);
    assert.deepEqual(freshness, ['ARCHIVE', 'ARCHIVE', 'ARCHIVE']);
    dock.next();
    assert.equal(dock.state.current, 1);
    dock.destroy();
  });

  test('command "rebuild the car crash reported in Umm Suqeim" flies, sets rebuild mode + keywords, writes fv/fk/fm/fs', async () => {
    const doc = makeDoc();
    const win = makeWin('#v=2&lat=13.9425&lon=48.9231&hud=tactical&ui=c.c.1_c.p.0');
    const client = fakeClient(ARCHIVE_ITEMS.slice(0, 2));
    const flights = [];
    const dock = installFootageDock({ document: doc, window: win, client, readCamera: () => ({ lat: 13.9425, lon: 48.9231, alt: 712168 }), flyTo: (lat, lon, o) => flights.push([lat, lon, o]), autoStart: false });
    const out = await dock.runCommand('rebuild the car crash reported in Umm Suqeim');
    assert.ok(out);
    assert.equal(flights.length, 1);
    assert.ok(Math.abs(flights[0][0] - 25.147) < 0.01 && Math.abs(flights[0][1] - 55.199) < 0.01);
    assert.equal(dock.state.mode, 'rebuild');
    assert.equal(dock.state.keywords, 'car crash');
    assert.equal(client.calls.at(-1).mode, 'rebuild');
    assert.equal(client.calls.at(-1).place, 'Umm Suqeim');
    const p = new URLSearchParams(win.location.hash.replace(/^#/, ''));
    assert.equal(p.get('fv'), '1');
    assert.equal(p.get('fk'), 'car crash');
    assert.equal(p.get('fm'), 'rebuild');
    assert.equal(p.get('fs'), '2y');
    assert.equal(p.get('ui'), 'c.c.1_c.p.0_f.c.0');
    assert.equal(p.get('lat'), '13.9425', 'other hash params preserved');
    assert.match(doc.getElementById(FOOTAGE_BANNER_ID).textContent, /originally reported 2026-09-26/);
    dock.destroy();
  });

  test('all sources failed → labelled client fixtures for the Umm Suqeim crash only', async () => {
    const doc = makeDoc();
    const win = makeWin('#v=2&fk=car%20crash&fm=rebuild');
    const client = fakeClient([], { done: { all_sources_failed: true } });
    const dock = installFootageDock({ document: doc, window: win, client, readCamera: () => ({ lat: 25.147, lon: 55.199, alt: 2600 }), autoStart: false });
    dock.setPlace({ name: 'Umm Suqeim', lat: 25.147, lon: 55.199 });
    await dock.run('test');
    assert.equal(dock.state.fixturesUsed, true);
    assert.ok(dock.state.items.every((i) => i.fixture));
    assert.ok(dock.elements.list.querySelectorAll('.footage-badge--fixture').length >= 1);
    dock.destroy();
  });

  test('hash fv=0 hides the dock and ui f.c.1 collapses it', () => {
    const doc = makeDoc();
    const win = makeWin('#v=2&fv=0&ui=f.c.1');
    const dock = installFootageDock({ document: doc, window: win, client: fakeClient([]), autoStart: false });
    assert.equal(dock.state.visible, false);
    assert.equal(dock.state.collapsed, true);
    assert.equal(dock.element.hidden, true);
    dock.destroy();
  });
});
