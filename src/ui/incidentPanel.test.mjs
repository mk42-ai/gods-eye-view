import test from 'node:test';
import assert from 'node:assert/strict';
import {
  badgeFor,
  cardMetaFor,
  decorateSceneRow,
  tickTimeSince,
  groupOptions,
  scenesForGroup,
  incidentFromResolution,
  installIncidentPanel,
  COMPOSER_PLACEHOLDER,
} from './incidentPanel.js';
import { incidentToShot } from '../data/uaeIncidents.js';

/** Tiny DOM double: enough tree/query/event behaviour for the panel. */
class Element extends EventTarget {
  constructor(tag, doc) {
    super();
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this._text = '';
    this._classes = new Set();
    const self = this;
    this.classList = {
      add: (...n) => n.forEach((c) => self._classes.add(c)),
      remove: (...n) => n.forEach((c) => self._classes.delete(c)),
      toggle(name, force) {
        const on = force === undefined ? !self._classes.has(name) : !!force;
        if (on) self._classes.add(name);
        else self._classes.delete(name);
        return on;
      },
      contains: (c) => self._classes.has(c),
    };
  }
  get className() {
    return [...this._classes].join(' ');
  }
  set className(v) {
    this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get id() {
    return this.attributes.id || '';
  }
  set id(v) {
    this.attributes.id = v;
    this.ownerDocument._ids.set(v, this);
  }
  setAttribute(n, v) {
    this.attributes[n] = String(v);
  }
  getAttribute(n) {
    return this.attributes[n] ?? null;
  }
  appendChild(el) {
    el.remove();
    this.children.push(el);
    el.parentNode = this;
    return el;
  }
  append(...n) {
    n.forEach((e) => this.appendChild(e));
  }
  insertBefore(el, ref) {
    el.remove();
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(el);
    else this.children.splice(i, 0, el);
    el.parentNode = this;
    return el;
  }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      this.parentNode = null;
    }
  }
  get nextSibling() {
    const i = this.parentNode?.children.indexOf(this) ?? -1;
    return i >= 0 ? this.parentNode.children[i + 1] || null : null;
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  focus() {}
  click() {
    this.dispatchEvent(new Event('click'));
  }
  *walk() {
    for (const c of this.children) {
      yield c;
      yield* c.walk();
    }
  }
  _matches(sel) {
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    if (sel.startsWith('.')) {
      const [cls, attr] = sel.slice(1).split('[');
      if (!this._classes.has(cls)) return false;
      if (attr) {
        const name = attr.replace(']', '').replace(/^data-/, '');
        const key = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return this.dataset[key] !== undefined;
      }
      return true;
    }
    return this.tagName === sel.toUpperCase();
  }
  querySelectorAll(sel) {
    return [...this.walk()].filter((e) => e._matches(sel));
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
}
function makeDocument() {
  const doc = Object.assign(new EventTarget(), { _ids: new Map() });
  doc.createElement = (tag) => new Element(tag, doc);
  doc.getElementById = (id) => doc._ids.get(id) || null;
  doc.body = doc.createElement('body');
  return doc;
}

function fixture({ fetchQueue = [], incidents = [] } = {}) {
  const doc = makeDocument();
  const saved = { document: globalThis.document, Node: globalThis.Node, MutationObserver: globalThis.MutationObserver };
  globalThis.document = doc;
  delete globalThis.MutationObserver;
  const panel = doc.createElement('div');
  panel.id = 'scene-panel';
  const inner = doc.createElement('div');
  inner.className = 'scene-panel-inner';
  panel.appendChild(inner);
  const controls = doc.createElement('div');
  controls.className = 'scene-controls';
  const select = doc.createElement('select');
  select.id = 'scene-select';
  controls.appendChild(select);
  inner.appendChild(controls);
  const shots = doc.createElement('div');
  shots.id = 'scene-shot-list';
  inner.appendChild(shots);
  doc.body.appendChild(panel);

  const scenes = [
    { id: 'uae-aoi-yemen', title: 'YEMEN', shots: [] },
    { id: 'uae-aoi-iran', title: 'IRAN', shots: [] },
  ];
  for (const scene of scenes) {
    const o = doc.createElement('option');
    o.value = scene.id;
    select.appendChild(o);
  }
  select.value = 'uae-aoi-yemen';
  const calls = { fetch: [], load: [], add: [], sync: [] };
  const listeners = new Set();
  const director = {
    listScenes: () => scenes.map((s) => ({ id: s.id, title: s.title, shots: s.shots.length })),
    getSceneById: (id) => scenes.find((s) => s.id === id) || null,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    addIncidentScene(incident, shot) {
      calls.add.push(incident);
      const target = scenes.find((s) => s.title === (incident.group || 'OUTSIDE UAE AOI')) || scenes[0];
      target.shots.unshift(shot);
      return { sceneId: target.id, shotId: shot.id, created: false };
    },
    async loadShot(sceneId, shotId, options) {
      calls.load.push([sceneId, shotId, options]);
      return { started: true };
    },
    syncIncidentLibrary(list) {
      calls.sync.push(list.length);
    },
  };
  const fetchImpl = async (url, init = {}) => {
    calls.fetch.push([url, init.method || 'GET', init.body ? JSON.parse(init.body) : undefined]);
    const next = fetchQueue.shift();
    if (!next) return { ok: true, status: 200, json: async () => ({ incidents, counts: {}, state: 'SEED', lastRefreshUtc: null }) };
    if (next instanceof Error) throw next;
    return { ok: next.status ? next.status < 400 : true, status: next.status || 200, json: async () => next.body };
  };
  let clock = Date.parse('2026-10-22T08:00:00Z');
  const panelApi = installIncidentPanel({
    director,
    documentRef: doc,
    fetchImpl,
    now: () => clock,
    setIntervalImpl: () => 1,
    clearIntervalImpl: () => {},
  });
  return {
    doc,
    panelApi,
    calls,
    scenes,
    select,
    shots,
    director,
    advance: (ms) => (clock += ms),
    restore() {
      panelApi?.destroy();
      Object.assign(globalThis, saved);
      if (saved.MutationObserver === undefined) delete globalThis.MutationObserver;
    },
  };
}
const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};
const BAB = 'Houthi drone strike on tanker near Bab el-Mandeb';
const RESOLVED_BAB = {
  lat: 12.6,
  lon: 43.3,
  placeName: 'Bab el-Mandeb',
  country: 'YEMEN',
  matchedAoi: { id: 'bab-el-mandeb', group: 'YEMEN', country: 'YEMEN', name: 'Bab el-Mandeb' },
  insideAoi: true,
  summary: 'Houthi drone strike on a tanker near Bab el-Mandeb',
  incident_type: 'drone_strike',
  severity: 'HIGH',
  entities: ['Houthi'],
  sources: [],
  provenance: { provider: 'ondemand' },
};

test('badgeFor reports LIVE / SEED / NO KEY honestly with the last-refresh stamp', () => {
  assert.deepEqual(badgeFor({ state: 'LIVE', lastRefreshUtc: '2026-10-22T08:05:00Z' }), { state: 'LIVE', detail: 'LAST REFRESH 2026-10-22 08:05Z', modifier: 'live' });
  assert.equal(badgeFor({ state: 'SEED', lastRefreshUtc: null }).detail, 'SEED DATA · NOT YET REFRESHED');
  assert.equal(badgeFor({ state: 'NO KEY' }).modifier, 'no-key');
  assert.equal(badgeFor(null).state, 'OFFLINE');
});

test('card meta + decorateSceneRow render country, severity, live time-since and the source link', () => {
  const doc = makeDocument();
  const shot = incidentToShot({ id: 'ir-01', headline: 'h', lat: 26.5, lon: 56.4, country: 'IRAN', group: 'IRAN', severity: 'CRITICAL', event_time_utc: '2026-10-19T22:00:00Z', source_url: 'https://gulfnews.com/x', source_name: 'Gulf News', incident_type: 'maritime_attack' });
  const meta = cardMetaFor(shot);
  assert.equal(meta.country, 'IRAN');
  assert.equal(meta.severity, 'CRITICAL');
  assert.equal(cardMetaFor({ title: 'plain' }), null);
  const row = doc.createElement('div');
  row.className = 'scene-shot-row';
  const top = doc.createElement('div');
  top.className = 'scene-shot-top';
  const metaLine = doc.createElement('div');
  metaLine.className = 'scene-shot-meta';
  metaLine.textContent = 'NORMAL · OFF · 4.2s + 13.0s';
  row.append(top, metaLine);
  const now = () => Date.parse('2026-10-22T08:00:00Z');
  const el = decorateSceneRow(row, shot, { now, documentRef: doc });
  assert.equal(row.children[1], el, 'inserted right after the title row, before the preset line');
  assert.equal(row.children[2].textContent, 'NORMAL · OFF · 4.2s + 13.0s');
  const chips = el.children;
  assert.deepEqual(chips.map((c) => c.textContent), ['IRAN', 'CRITICAL', '2d', 'Gulf News']);
  assert.ok(chips[1].classList.contains('scene-chip-severity-critical'));
  assert.equal(chips[3].target, '_blank');
  assert.equal(chips[3].rel, 'noopener noreferrer');
  assert.equal(chips[3].href, 'https://gulfnews.com/x');
  decorateSceneRow(row, shot, { now, documentRef: doc });
  assert.equal(row.querySelectorAll('.scene-card-meta').length, 1, 'idempotent');
  tickTimeSince(row, Date.parse('2026-10-29T22:00:00Z'));
  assert.equal(row.querySelector('.scene-chip-time').textContent, '10d');
  decorateSceneRow(row, { title: 'plain' }, { now, documentRef: doc });
  assert.equal(row.querySelector('.scene-card-meta'), null);
});

test('group options and scene filtering follow the four AOI groups', () => {
  assert.deepEqual(groupOptions().map((o) => o.label), ['UAE AOI (all)', 'IRAN', 'YEMEN', 'SOMALIA', 'UAE HOME BORDER']);
  const scenes = [{ id: 'uae-aoi-iran' }, { id: 'uae-aoi-yemen' }, { id: 'scene-user' }];
  assert.deepEqual(scenesForGroup(scenes, 'YEMEN').map((s) => s.id), ['uae-aoi-yemen', 'scene-user']);
  assert.equal(scenesForGroup(scenes, 'ALL').length, 3);
});

test('incidentFromResolution builds a persistable incident tagged with group/severity/type and now()', () => {
  const inc = incidentFromResolution(BAB, RESOLVED_BAB, { now: () => new Date('2026-10-22T08:00:00Z') });
  assert.equal(inc.group, 'YEMEN');
  assert.equal(inc.aoi_id, 'bab-el-mandeb');
  assert.equal(inc.severity, 'HIGH');
  assert.equal(inc.incident_type, 'drone_strike');
  assert.equal(inc.event_time_utc, '2026-10-22T08:00:00.000Z');
  assert.equal(inc.insideAoi, true);
  assert.equal(inc.provenance.via, 'composer');
  assert.ok(inc.camera.altitude_m > 0);
  const outside = incidentFromResolution('earthquake in Lima', { ...RESOLVED_BAB, lat: -12.05, lon: -77.03, matchedAoi: null, insideAoi: false, country: 'Peru', placeName: 'Lima' });
  assert.equal(outside.group, null);
  assert.equal(outside.insideAoi, false);
});

test('panel mounts the group select, LIVE badge, REFRESH and the composer with the exact placeholder; GET on mount', async () => {
  const f = fixture({ fetchQueue: [{ body: { incidents: [], counts: {}, state: 'LIVE', lastRefreshUtc: '2026-10-22T07:00:00Z' } }] });
  try {
    await flush();
    assert.equal(f.calls.fetch[0][0], '/api/incidents');
    assert.equal(f.doc.getElementById('scene-incident-input').placeholder, COMPOSER_PLACEHOLDER);
    assert.equal(f.doc.getElementById('scene-group-select').children.length, 5);
    assert.equal(f.doc.getElementById('scene-live-badge').dataset.state, 'LIVE');
    assert.match(f.doc.getElementById('scene-live-badge').textContent, /LAST REFRESH 2026-10-22 07:00Z/);
    assert.equal(f.doc.getElementById('scene-refresh-btn').textContent, 'REFRESH');
    assert.deepEqual(f.calls.sync, [0]);
    const inner = f.doc.getElementById('scene-panel').children[0];
    assert.equal(inner.children.at(-1).id, 'scene-incident-composer', 'composer docked last');
  } finally {
    f.restore();
  }
});

test('composer submit: resolve → fly camera → new scene card → persist via the composer proxy', async () => {
  const f = fixture({
    fetchQueue: [
      { body: { incidents: [], state: 'SEED', lastRefreshUtc: null } },
      { body: RESOLVED_BAB },
      { body: { ok: true, incident: { id: 'inc-abc', headline: BAB, lat: 12.6, lon: 43.3, country: 'YEMEN', group: 'YEMEN', severity: 'HIGH', event_time_utc: '2026-10-22T08:00:00Z', camera: { dwell_in_s: 4, dwell_hold_s: 12, altitude_m: 60000, ona_deg: 50 } }, via: 'composer-proxy' } },
      { body: { incidents: [], state: 'SEED', lastRefreshUtc: null } },
    ],
  });
  try {
    await flush();
    const input = f.doc.getElementById('scene-incident-input');
    input.value = BAB;
    input.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter', preventDefault() {}, stopPropagation() {} }));
    await flush(12);
    const [, resolveCall, composerCall] = f.calls.fetch;
    assert.deepEqual(resolveCall.slice(0, 2), ['/api/incidents/resolve', 'POST']);
    assert.deepEqual(resolveCall[2], { text: BAB });
    assert.deepEqual(composerCall.slice(0, 2), ['/api/incidents/composer', 'POST']);
    assert.equal(composerCall[2].incident.group, 'YEMEN');
    assert.equal('x-ingest-secret' in (composerCall[2] || {}), false, 'browser never sends an ingest secret');
    assert.equal(f.calls.add.length, 1);
    assert.equal(f.calls.add[0].id, 'inc-abc');
    assert.equal(f.calls.load.length, 1);
    assert.equal(f.calls.load[0][0], 'uae-aoi-yemen');
    assert.equal(f.scenes[0].shots[0].incident.id, 'inc-abc');
    assert.equal(f.scenes[0].shots[0].camera.lat, 12.6);
    assert.equal(input.value, '');
    assert.match(f.doc.getElementById('scene-incident-status').textContent, /ADDED · YEMEN · HIGH · inc-abc/);
    assert.equal(f.doc.getElementById('scene-incident-warning').hidden, true);
  } finally {
    f.restore();
  }
});

test('composer: out-of-AOI resolution shows the warning; ADD ANYWAY persists, CANCEL keeps the text', async () => {
  const lima = { ...RESOLVED_BAB, lat: -12.05, lon: -77.03, placeName: 'Lima', country: 'Peru', matchedAoi: null, insideAoi: false, summary: 'Earthquake in Lima', incident_type: 'earthquake', severity: 'MEDIUM' };
  const f = fixture({
    fetchQueue: [
      { body: { incidents: [], state: 'SEED' } },
      { body: lima },
      { body: lima },
      { body: { ok: true, incident: { id: 'inc-lima', headline: 'Earthquake in Lima', lat: -12.05, lon: -77.03, group: null, country: 'Peru', severity: 'MEDIUM', event_time_utc: '2026-10-22T08:00:00Z', insideAoi: false } } },
      { body: { incidents: [], state: 'SEED' } },
    ],
  });
  try {
    await flush();
    const input = f.doc.getElementById('scene-incident-input');
    const warning = f.doc.getElementById('scene-incident-warning');
    input.value = 'earthquake in Lima';
    f.panelApi.elements.send.dispatchEvent(new Event('click'));
    f.panelApi.elements.composer.dispatchEvent(Object.assign(new Event('submit'), { preventDefault() {} }));
    await flush(8);
    assert.equal(warning.hidden, false);
    assert.equal(warning.children[0].textContent, 'OUTSIDE UAE AOI - Lima');
    assert.equal(f.calls.add.length, 0, 'nothing added before the user decides');
    f.panelApi.elements.cancel.click();
    assert.equal(warning.hidden, true);
    assert.equal(input.value, 'earthquake in Lima', 'text kept on CANCEL');
    assert.match(f.doc.getElementById('scene-incident-status').textContent, /CANCELLED/);
    await f.panelApi.submit();
    await flush(4);
    assert.equal(warning.hidden, false);
    f.panelApi.elements.addAnyway.click();
    await flush(12);
    assert.equal(f.calls.add.length, 1);
    assert.equal(f.calls.add[0].insideAoi, false);
    assert.equal(f.calls.fetch.filter((c) => c[0] === '/api/incidents/composer').length, 1);
    assert.equal(f.calls.load.length, 1);
    assert.equal(input.value, '');
  } finally {
    f.restore();
  }
});

test('composer: resolve failure is reported honestly and the text is kept', async () => {
  const f = fixture({ fetchQueue: [{ body: { incidents: [], state: 'NO KEY' } }, new Error('network down')] });
  try {
    await flush();
    assert.equal(f.doc.getElementById('scene-live-badge').dataset.state, 'NO KEY');
    const input = f.doc.getElementById('scene-incident-input');
    input.value = BAB;
    await f.panelApi.submit();
    await flush(4);
    assert.match(f.doc.getElementById('scene-incident-status').textContent, /RESOLVE FAILED: network down/);
    assert.equal(input.value, BAB);
    assert.equal(f.calls.add.length, 0);
    assert.equal(f.panelApi.elements.send.disabled, false);
  } finally {
    f.restore();
  }
});

test('REFRESH posts to /api/incidents/refresh, re-reads the library and reports the real outcome (incl. NO KEY)', async () => {
  const f = fixture({
    fetchQueue: [
      { body: { incidents: [], state: 'SEED' } },
      { body: { ok: true, state: 'LIVE', added: 2, duplicates: 1, aoisOk: 11, aoisQueried: 12, lastRefreshUtc: '2026-10-22T08:10:00Z' } },
      { body: { incidents: [{ id: 'x' }], state: 'LIVE', lastRefreshUtc: '2026-10-22T08:10:00Z' } },
      { body: { ok: false, state: 'NO KEY' } },
      { body: { incidents: [{ id: 'x' }], state: 'NO KEY', lastRefreshUtc: null } },
    ],
  });
  try {
    await flush();
    f.panelApi.elements.refreshBtn.click();
    await flush(8);
    assert.deepEqual(f.calls.fetch[1].slice(0, 2), ['/api/incidents/refresh', 'POST']);
    const badge = f.doc.getElementById('scene-live-badge');
    assert.equal(badge.dataset.state, 'LIVE');
    assert.match(badge.textContent, /LAST REFRESH 2026-10-22 08:10Z · \+2 new · 1 dup · 11\/12 AOIs/);
    assert.deepEqual(f.calls.sync, [0, 1]);
    f.panelApi.elements.refreshBtn.click();
    await flush(8);
    assert.equal(badge.dataset.state, 'NO KEY');
    assert.match(badge.textContent, /NO REFRESH ATTEMPTED/);
    assert.equal(f.panelApi.elements.refreshBtn.disabled, false);
  } finally {
    f.restore();
  }
});
