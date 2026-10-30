import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFootageController,
  mergeClips,
  formatAgo,
  clipTimeLines,
  FOOTAGE_URL,
} from './controller.js';
import { createSceneFootagePanel } from './panel.js';
import { locationIdFor, findPlaceByName, buildLadder } from './places.js';

const NOW = Date.parse('2026-10-26T23:50:00Z');
const clip = (id, extra = {}) => ({
  id: `snap-${id}`,
  storyId: id,
  sourcePlatform: 'snapchat',
  mediaUrl: `https://a.blob.core.windows.net/c/${id}.mp4?se=2026-11-02T15%3A21%3A45Z&sig=s1`,
  embedUrl: null,
  thumbnail: null,
  sourceUrl: `https://www.snapchat.com/spotlight/${id}`,
  attribution: null,
  matchedPlaceName: 'Dubai Marina',
  coverageLevel: 'district',
  locationEvidence: 'hashtag-match',
  locationEvidenceDetail: 'hashtag #dubaimarina',
  captureTime: null,
  publicationTime: '2026-09-09T17:13:12.000Z',
  publicationTimeRaw: 'September 9, 2026 at 5:13:12 PM',
  retrievalTime: '2026-10-26T23:49:00.000Z',
  isLive: false,
  liveConfirmedBy: null,
  mediaExpiresAt: '2026-11-02T15:21:45.000Z',
  mediaHash: null,
  caption: '#dubaimarina',
  hashtags: ['#dubaimarina'],
  durationMs: 16100,
  ...extra,
});
const response = (locationId, clips, extra = {}) => ({
  state: clips.length ? 'ok' : 'empty',
  locationId,
  clips,
  coverageLevel: 'district',
  coverageLabel: 'Dubai Marina',
  expanded: false,
  retrievalTime: new Date(NOW).toISOString(),
  lastCheckedAt: new Date(NOW).toISOString(),
  refresh: { defaultMs: 120000, minMs: 30000 },
  ...extra,
});
const okRes = (json, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => json,
});

function timers() {
  const q = new Map();
  let id = 0;
  return {
    set: (fn, ms) => (q.set(++id, { fn, ms }), id),
    clear: (i) => q.delete(i),
    fire() {
      const e = [...q.entries()];
      q.clear();
      for (const [, t] of e) t.fn();
    },
    pending: () => [...q.values()],
  };
}
const deferred = () => {
  let resolve;
  const p = new Promise((r) => (resolve = r));
  return { p, resolve };
};

test('formatAgo / honest time lines (capture unknown, not live, publication ≠ retrieval)', () => {
  assert.equal(
    formatAgo(new Date(NOW - 3 * 3600_000).toISOString(), NOW),
    '3h ago',
  );
  assert.equal(
    formatAgo(new Date(NOW - 20_000).toISOString(), NOW),
    'just now',
  );
  assert.equal(formatAgo('2025-11-16T00:05:00Z', NOW), '11mo ago');
  assert.equal(formatAgo(null, NOW), null);
  const tl = clipTimeLines(clip('a'), NOW);
  assert.equal(tl.cap, 'capture time unknown');
  assert.equal(tl.live, 'not live');
  assert.match(tl.pub, /^published 47d ago \(2026-09-09 17:13 UTC\)$/);
  assert.equal(tl.ret, 'retrieved 1m ago');
  assert.equal(
    clipTimeLines({ ...clip('b'), isLive: true, liveConfirmedBy: null }, NOW)
      .live,
    'not live',
    'isLive without confirmation is never shown as LIVE',
  );
  assert.equal(
    clipTimeLines({ ...clip('c'), publicationTime: null }, NOW).pub,
    'publication time unknown',
  );
});

test('mergeClips: no duplicates (id, sourceUrl, blob path), playing clip keeps its media URL', () => {
  const a = clip('AAAAAAAAAA');
  const newSas = { ...a, mediaUrl: a.mediaUrl.replace('sig=s1', 'sig=s2') };
  const sameBlob = {
    ...clip('BBBBBBBBBB'),
    sourceUrl: null,
    mediaUrl: a.mediaUrl.replace('sig=s1', 'sig=zz'),
  };
  const c = clip('CCCCCCCCCC', { publicationTime: '2026-10-01T11:55:30.000Z' });
  const m = mergeClips([a], [newSas, sameBlob, c], { selectedId: a.id });
  assert.deepEqual(
    m.clips.map((x) => x.id),
    [c.id, a.id],
  );
  assert.equal(m.added, 1);
  assert.equal(
    m.clips.find((x) => x.id === a.id).mediaUrl,
    a.mediaUrl,
    'currently playing element src preserved',
  );
});

test('controller: open → POST to /api/scenes/:locationId/footage/snapchat with scene payload', async () => {
  const calls = [];
  const t = timers();
  const ctl = createFootageController({
    now: () => NOW,
    setTimer: t.set,
    clearTimer: t.clear,
    document: null,
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return okRes(response('snap-dubai-marina', [clip('AAAAAAAAAA')]));
    },
  });
  await ctl.open(
    { lat: 25.0786415, lon: 55.1352524, placeName: 'Dubai Marina' },
    { trigger: 'build-scene' },
  );
  assert.equal(calls[0].url, '/api/scenes/snap-dubai-marina/footage/snapchat');
  assert.deepEqual(Object.keys(calls[0].body).sort(), [
    'bbox',
    'clientTimeIso',
    'fresh',
    'lat',
    'locationId',
    'lon',
    'placeName',
  ]);
  assert.equal(ctl.state.phase, 'ready');
  assert.equal(ctl.state.selectedId, 'snap-AAAAAAAAAA');
  assert.equal(ctl.state.trigger, 'build-scene');
  assert.equal(t.pending()[0].ms, 120000, 'server default refresh interval');
  assert.equal(FOOTAGE_URL('a b'), '/api/scenes/a%20b/footage/snapchat');
});

test('controller: rapid A→B→A→C — stale responses are discarded; rendered clips always match active locationId', async () => {
  const pending = [];
  const ctl = createFootageController({
    now: () => NOW,
    setTimer: () => 0,
    clearTimer: () => {},
    document: null,
    fetch: (url, init) => {
      const d = deferred();
      pending.push({
        url,
        d,
        signal: init.signal,
        body: JSON.parse(init.body),
      });
      return d.p;
    },
  });
  const A = { lat: 25.0786415, lon: 55.1352524, placeName: 'Dubai Marina' };
  const B = { lat: 25.1970336, lon: 55.2741329, placeName: 'Burj Khalifa' };
  const C = { lat: 24.474, lon: 54.329, placeName: 'Abu Dhabi Corniche' };
  const seen = [];
  ctl.subscribe((s) => {
    for (const c of s.clips) seen.push([s.locationId, c.matchedPlaceName]);
  });
  const pA1 = ctl.open(A);
  const pB = ctl.open(B);
  const pA2 = ctl.open(A);
  const pC = ctl.open(C);
  assert.equal(pending.length, 4);
  assert.ok(
    pending.slice(0, 3).every((p) => p.signal.aborted),
    'superseded requests aborted',
  );
  // Late replies arrive out of order.
  pending[1].d.resolve(
    okRes(
      response('snap-burj-khalifa', [
        clip('BURJAAAAAA', { matchedPlaceName: 'Burj Khalifa' }),
      ]),
    ),
  );
  pending[0].d.resolve(
    okRes(response('snap-dubai-marina', [clip('MARINAAAAA')])),
  );
  pending[3].d.resolve(okRes(response('snap-abu-dhabi-corniche', [])));
  pending[2].d.resolve(
    okRes(response('snap-dubai-marina', [clip('MARINAAAAA')])),
  );
  await Promise.all([pA1, pB, pA2, pC]);
  assert.equal(ctl.state.locationId, 'snap-abu-dhabi-corniche');
  assert.equal(ctl.state.phase, 'empty');
  assert.equal(ctl.state.clips.length, 0);
  assert.equal(seen.length, 0, 'no stale clip was ever rendered');
  assert.equal(ctl.state.history.filter((h) => h.discarded).length, 3);
});

test('controller: response for a different locationId is never applied even with a current generation', async () => {
  const ctl = createFootageController({
    now: () => NOW,
    setTimer: () => 0,
    clearTimer: () => {},
    document: null,
    fetch: async () =>
      okRes(response('snap-burj-khalifa', [clip('BURJAAAAAA')])),
  });
  await ctl.open({
    lat: 25.0786415,
    lon: 55.1352524,
    placeName: 'Dubai Marina',
  });
  assert.equal(ctl.state.clips.length, 0);
  assert.equal(ctl.state.phase, 'loading');
});

test('controller: refresh tick updates last-checked, preserves the playing clip, merges without duplicates; pauses when hidden', async () => {
  const t = timers();
  let n = 0;
  const listeners = {};
  const doc = {
    hidden: false,
    addEventListener: (k, f) => (listeners[k] = f),
    removeEventListener() {},
  };
  let clock = NOW;
  const ctl = createFootageController({
    now: () => clock,
    setTimer: t.set,
    clearTimer: t.clear,
    document: doc,
    fetch: async (url, init) => {
      n += 1;
      const body = JSON.parse(init.body);
      if (n === 1)
        return okRes(
          response(
            body.locationId,
            [
              clip('AAAAAAAAAA'),
              clip('BBBBBBBBBB', {
                publicationTime: '2026-08-01T00:00:00.000Z',
              }),
            ],
            { lastCheckedAt: new Date(clock).toISOString() },
          ),
        );
      assert.equal(body.fresh, true, 'refresh bypasses the server cache');
      return okRes(
        response(
          body.locationId,
          [
            clip('AAAAAAAAAA', {
              mediaUrl:
                'https://a.blob.core.windows.net/c/AAAAAAAAAA.mp4?se=x&sig=NEW',
            }),
            clip('CCCCCCCCCC', { publicationTime: '2026-10-20T00:00:00.000Z' }),
          ],
          { lastCheckedAt: new Date(clock).toISOString() },
        ),
      );
    },
  });
  await ctl.open({
    lat: 25.0786415,
    lon: 55.1352524,
    placeName: 'Dubai Marina',
  });
  ctl.select('snap-BBBBBBBBBB');
  const before = ctl.state.lastCheckedAt;
  clock += 120_000;
  t.fire();
  await new Promise((r) => setTimeout(r, 0));
  assert.notEqual(ctl.state.lastCheckedAt, before);
  assert.equal(
    ctl.state.selectedId,
    'snap-BBBBBBBBBB',
    'current clip preserved',
  );
  assert.deepEqual(ctl.state.clips.map((c) => c.id).sort(), [
    'snap-AAAAAAAAAA',
    'snap-BBBBBBBBBB',
    'snap-CCCCCCCCCC',
  ]);
  assert.equal(ctl.state.refreshCount, 1);
  assert.equal(ctl.state.lastAdded, 1);
  doc.hidden = true;
  listeners.visibilitychange();
  assert.equal(ctl.state.paused, true);
  assert.equal(t.pending().length, 0, 'no refresh timer while hidden');
  doc.hidden = false;
  listeners.visibilitychange();
  assert.equal(ctl.state.paused, false);
  assert.equal(t.pending().length, 1);
});

test('controller: refresh interval control clamps to the server minimum; 0 turns it off', async () => {
  const t = timers();
  const ctl = createFootageController({
    now: () => NOW,
    setTimer: t.set,
    clearTimer: t.clear,
    document: null,
    fetch: async () =>
      okRes(
        response('snap-dubai-marina', [clip('AAAAAAAAAA')], {
          refresh: { defaultMs: 120000, minMs: 45000 },
        }),
      ),
  });
  await ctl.open({
    lat: 25.0786415,
    lon: 55.1352524,
    placeName: 'Dubai Marina',
  });
  ctl.setRefreshMs(5000);
  assert.equal(ctl.state.refreshMs, 45000);
  ctl.setRefreshMs(0);
  assert.equal(ctl.state.refreshMs, 0);
  assert.equal(t.pending().length, 0);
});

test('controller: expired media link → exactly one re-fetch, then a message (no loop)', async () => {
  let n = 0;
  const ctl = createFootageController({
    now: () => NOW,
    setTimer: () => 0,
    clearTimer: () => {},
    document: null,
    fetch: async () => (
      n++,
      okRes(
        response('snap-dubai-marina', [
          clip('AAAAAAAAAA', {
            mediaUrl: `https://a.blob.core.windows.net/c/AAAAAAAAAA.mp4?se=x&sig=v${n}`,
          }),
        ]),
      )
    ),
  });
  await ctl.open({
    lat: 25.0786415,
    lon: 55.1352524,
    placeName: 'Dubai Marina',
  });
  assert.equal(await ctl.mediaFailed('snap-AAAAAAAAAA'), 'refetched');
  assert.equal(n, 2);
  assert.match(
    ctl.state.clips[0].mediaUrl,
    /sig=v2$/,
    'the re-fetched link replaces the expired one for the selected clip',
  );
  assert.equal(await ctl.mediaFailed('snap-AAAAAAAAAA'), 'gave-up');
  assert.equal(n, 2);
  assert.equal(ctl.state.error, 'media_expired');
  assert.match(ctl.state.message, /expired again/);
});

test('controller: error states (credentials, plugin error, rate limit) and refresh failure keeps last results', async () => {
  for (const [status, st] of [
    [503, 'credentials_required'],
    [502, 'plugin_error'],
    [429, 'rate_limited'],
    [504, 'timeout'],
  ]) {
    const ctl = createFootageController({
      now: () => NOW,
      setTimer: () => 0,
      clearTimer: () => {},
      document: null,
      fetch: async () =>
        okRes(
          { state: st, error: st, locationId: 'snap-dubai-marina', clips: [] },
          status,
        ),
    });
    await ctl.open({
      lat: 25.0786415,
      lon: 55.1352524,
      placeName: 'Dubai Marina',
    });
    assert.equal(ctl.state.phase, st);
    assert.equal(ctl.state.clips.length, 0);
  }
  let n = 0;
  const ctl = createFootageController({
    now: () => NOW,
    setTimer: () => 0,
    clearTimer: () => {},
    document: null,
    fetch: async () =>
      ++n === 1
        ? okRes(response('snap-dubai-marina', [clip('AAAAAAAAAA')]))
        : okRes(
            {
              state: 'plugin_error',
              error: 'upstream_500',
              locationId: 'snap-dubai-marina',
            },
            502,
          ),
  });
  await ctl.open({
    lat: 25.0786415,
    lon: 55.1352524,
    placeName: 'Dubai Marina',
  });
  await ctl.refresh();
  assert.equal(ctl.state.phase, 'ready');
  assert.equal(ctl.state.clips.length, 1);
  assert.match(ctl.state.message, /Refresh failed/);
});

test('places: stable ids + name lookup shared with the server', () => {
  assert.equal(
    locationIdFor({
      lat: 25.0786415,
      lon: 55.1352524,
      placeName: 'Dubai Marina',
    }),
    'snap-dubai-marina',
  );
  assert.equal(
    locationIdFor({
      lat: 25.0775,
      lon: 55.1327,
      placeName: 'Jumeirah Beach Residence',
    }),
    'snap-jumeirah-beach-residence',
  );
  assert.equal(
    findPlaceByName('Jumeirah Beach Residence, Dubai').id,
    'jumeirah-beach-residence',
  );
  assert.equal(findPlaceByName('hi'), null);
  assert.equal(buildLadder({ placeName: 'Burj Khalifa' })[0].level, 'landmark');
});

function makeDoc() {
  const mk = (tag) => {
    const listeners = new Map();
    return {
      tagName: tag.toUpperCase(),
      children: [],
      attrs: new Map(),
      dataset: {},
      style: {},
      textContent: '',
      hidden: false,
      options: [],
      value: '',
      set className(v) {
        this.attrs.set('class', v);
      },
      get className() {
        return this.attrs.get('class') || '';
      },
      set id(v) {
        this.attrs.set('id', v);
      },
      get id() {
        return this.attrs.get('id');
      },
      setAttribute(k, v) {
        this.attrs.set(k, String(v));
        if (k.startsWith('data-'))
          this.dataset[
            k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
          ] = String(v);
      },
      getAttribute(k) {
        return this.attrs.get(k) ?? null;
      },
      append(...k) {
        for (const c of k) this.appendChild(c);
      },
      appendChild(c) {
        this.children.push(c);
        c.parentNode = this;
        if (this.tagName === 'SELECT') this.options = this.children;
        return c;
      },
      replaceChildren(...k) {
        this.children = [];
        for (const c of k) this.appendChild(c);
      },
      addEventListener(t, f) {
        listeners.set(t, [...(listeners.get(t) || []), f]);
      },
      dispatch(t, e = {}) {
        for (const f of listeners.get(t) || []) f(e);
      },
      canPlayType: () => 'maybe',
      play: () => Promise.resolve(),
      remove() {},
    };
  };
  return {
    createElement: mk,
    createTextNode: (t) => ({ textContent: t, children: [] }),
    body: mk('body'),
  };
}
const find = (n, pred) => {
  if (pred(n)) return n;
  for (const c of n.children || []) {
    const r = find(c, pred);
    if (r) return r;
  }
  return null;
};
const text = (n) =>
  (n.textContent || '') + (n.children || []).map(text).join('');

test('panel: renders native muted inline <video>, scene/match labels, honest times, original link and expanded-coverage notice', async () => {
  const doc = makeDoc();
  const ctl = createFootageController({
    now: () => NOW,
    setTimer: () => 0,
    clearTimer: () => {},
    document: null,
    fetch: async () =>
      okRes(
        response(
          'snap-jumeirah-beach-residence',
          [
            clip('AAAAAAAAAA', {
              matchedPlaceName: 'Dubai',
              coverageLevel: 'city',
            }),
          ],
          {
            expanded: true,
            coverageLevel: 'city',
            coverageLabel: 'Dubai',
            ladder: [
              {
                label: 'Jumeirah Beach Residence',
                level: 'neighborhood',
                queried: true,
              },
              { label: 'Dubai', level: 'city', queried: true },
            ],
          },
        ),
      ),
  });
  const panel = createSceneFootagePanel({
    document: doc,
    controller: ctl,
    now: () => NOW,
    window: {},
  });
  await ctl.open({
    lat: 25.0775,
    lon: 55.1327,
    placeName: 'Jumeirah Beach Residence',
  });
  const root = panel.element;
  assert.equal(root.hidden, false);
  assert.equal(root.dataset.phase, 'ready');
  const video = find(root, (n) => n.tagName === 'VIDEO');
  assert.ok(video);
  assert.equal(video.muted, true);
  assert.equal(video.playsInline, true);
  assert.equal(video.getAttribute('muted'), '');
  assert.equal(video.getAttribute('playsinline'), '');
  assert.equal(video.dataset.locationId, 'snap-jumeirah-beach-residence');
  const all = text(root);
  assert.match(all, /Scene: Jumeirah Beach Residence \(25\.0775, 55\.1327\)/);
  assert.match(all, /Matched place: “Dubai” · coverage: city/);
  assert.match(
    all,
    /Coverage expanded: no relevant clips for “Jumeirah Beach Residence”/,
  );
  assert.match(all, /capture time unknown/);
  assert.match(all, /published 47d ago/);
  assert.match(all, /author handle not returned/);
  assert.match(all, /last checked/);
  assert.ok(
    !/\bLIVE\b/.test(all.replace('not live', '')),
    'nothing labelled LIVE',
  );
  const link = find(
    root,
    (n) => n.tagName === 'A' && n.textContent === 'open original',
  );
  assert.equal(
    link.getAttribute('href'),
    'https://www.snapchat.com/spotlight/AAAAAAAAAA',
  );
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
});

test('panel: empty and unsupported-playback states', async () => {
  const doc = makeDoc();
  const ctl = createFootageController({
    now: () => NOW,
    setTimer: () => 0,
    clearTimer: () => {},
    document: null,
    fetch: async () =>
      okRes(
        response('snap-abu-dhabi-corniche', [], {
          ladder: [
            {
              label: 'Abu Dhabi Corniche',
              level: 'neighborhood',
              queried: true,
            },
            { label: 'Abu Dhabi', level: 'city', capped: true },
          ],
        }),
      ),
  });
  const panel = createSceneFootagePanel({
    document: doc,
    controller: ctl,
    now: () => NOW,
    window: {},
  });
  await ctl.open({ lat: 24.474, lon: 54.329, placeName: 'Abu Dhabi Corniche' });
  const all = text(panel.element);
  assert.match(all, /No relevant Snapchat footage found for this area/);
  assert.match(all, /not searched \(beyond coverage limit\): Abu Dhabi/);
  assert.equal(
    find(panel.element, (n) => n.tagName === 'VIDEO'),
    null,
  );

  const doc2 = makeDoc();
  const orig = doc2.createElement;
  doc2.createElement = (t) => {
    const n = orig(t);
    if (t === 'video') n.canPlayType = () => '';
    return n;
  };
  const ctl2 = createFootageController({
    now: () => NOW,
    setTimer: () => 0,
    clearTimer: () => {},
    document: null,
    fetch: async () =>
      okRes(response('snap-dubai-marina', [clip('AAAAAAAAAA')])),
  });
  const panel2 = createSceneFootagePanel({
    document: doc2,
    controller: ctl2,
    now: () => NOW,
    window: {},
  });
  await ctl2.open({
    lat: 25.0786415,
    lon: 55.1352524,
    placeName: 'Dubai Marina',
  });
  assert.match(text(panel2.element), /cannot play the clip inline/);
  assert.ok(
    find(
      panel2.element,
      (n) => n.tagName === 'A' && /Open the original/.test(n.textContent),
    ),
  );
});

test('places: narrowest of operator text / geocoder label / coordinate wins (Corniche regression)', async () => {
  const { narrowestPlace, findPlaceByName, placeForPoint } =
    await import('./places.js');
  const geocoderLabel =
    'Corniche Beach - Phase 2, Al Markaziyah West, Abu Dhabi, Abu Dhabi Emirate, Unit';
  assert.equal(
    findPlaceByName(geocoderLabel).id,
    'abu-dhabi',
    'the long label alone only names the city',
  );
  const pick = narrowestPlace([
    findPlaceByName('Abu Dhabi Corniche'),
    findPlaceByName(geocoderLabel),
    placeForPoint(24.4857606, 54.3479952),
  ]);
  assert.equal(pick.id, 'abu-dhabi-corniche');
  assert.equal(
    placeForPoint(24.4857606, 54.3479952).id,
    'abu-dhabi-corniche',
    'geocoded Corniche Beach point is inside the Corniche planning radius',
  );
});

test('mergeClips skips a near-identical re-upload on refresh (cycle 20)', () => {
  const cur = [{ id: 'snap-a1', caption: 'Dubai Marina sunset walk', durationMs: 16100, publicationTime: '2026-09-09T17:13:12.000Z' }];
  const inc = [{ id: 'snap-b2', caption: 'dubai marina — sunset walk!', durationMs: 16300, publicationTime: '2026-09-10T10:00:00.000Z' }];
  const { clips, added } = mergeClips(cur, inc, { selectedId: 'snap-a1' });
  assert.equal(added, 0);
  assert.deepEqual(clips.map((c) => c.id), ['snap-a1']);
});
