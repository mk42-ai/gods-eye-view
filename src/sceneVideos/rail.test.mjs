import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneVideoRail, RAIL_ID } from './rail.js';

/** Tiny DOM stand-in (createElement / append / listeners / attributes). */
function makeDoc() {
  const mk = (tag) => {
    const listeners = new Map();
    const node = {
      tagName: tag.toUpperCase(),
      children: [],
      attrs: new Map(),
      dataset: {},
      textContent: '',
      hidden: false,
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
        return c;
      },
      replaceChildren(...k) {
        this.children = [];
        this.append(...k);
      },
      remove() {},
      addEventListener(t, fn) {
        listeners.set(t, [...(listeners.get(t) || []), fn]);
      },
      dispatch(t, e = {}) {
        for (const fn of listeners.get(t) || []) fn({ type: t, ...e });
      },
      play() {
        this.playing = true;
        return Promise.resolve();
      },
      find(pred, out = []) {
        for (const c of this.children) {
          if (pred(c)) out.push(c);
          c.find?.(pred, out);
        }
        return out;
      },
    };
    return node;
  };
  return { createElement: mk };
}

const clip = (o) => ({
  id: 'x',
  platform: 'instagram',
  tier: 'ARCHIVAL',
  score: 0.5,
  scoreParts: {},
  title: 't',
  sourceUrl: 'https://www.instagram.com/p/x/',
  playableKind: 'mp4',
  playableUrl: 'https://is.gd/HNpafE',
  published_at: '2026-09-28T00:00:00Z',
  published_at_source: 'instagram-asset-age-days',
  captionStartOffset: 0,
  geo: { lat: 25.14, lon: 55.2, precision: 'incident-anchor' },
  provenance: { pluginId: 'plugin-1762980461' },
  ...o,
});

test('rail: clips render with tier badges, banner, autoplay-muted mp4 through the media proxy, pins', () => {
  const doc = makeDoc();
  const pinCalls = [];
  const rail = createSceneVideoRail({
    document: doc,
    window: { dispatchEvent() {} },
    pins: { set: (c) => pinCalls.push(c.length), clear() {} },
  });
  assert.equal(rail.element.id, RAIL_ID);
  rail.handle('incident', {
    title: 'Umm Suqeim crash',
    reported_at: '2026-09-26T00:00:00Z',
    rebuild: true,
  });
  rail.handle(
    'clip',
    clip({
      id: 'tiktok:1',
      platform: 'tiktok',
      playableKind: 'iframe',
      playableUrl: 'https://www.tiktok.com/player/v1/1?autoplay=1&muted=1',
      score: 0.9,
    }),
  );
  assert.equal(
    rail.state.playingId,
    null,
    'iframe clips do not steal autoplay before the stream ends',
  );
  rail.handle('clip', clip({ id: 'instagram:Ddyb6fvQ-Yn' }));
  assert.equal(rail.state.playingId, 'instagram:Ddyb6fvQ-Yn');
  const video = rail.element.find((n) => n.tagName === 'VIDEO')[0];
  assert.equal(video.muted, true);
  assert.equal(video.autoplay, true);
  assert.equal(
    video.src,
    '/api/ondemand/v2/scene/media?u=https%3A%2F%2Fis.gd%2FHNpafE',
  );
  const banner = rail.element.find((n) => n.id === `${RAIL_ID}-banner`)[0];
  assert.equal(banner.hidden, false);
  assert.equal(
    banner.textContent,
    'REBUILT FROM ARCHIVAL FOOTAGE \u2013 recorded 26 Sep 2026, not live',
  );
  const badges = rail.element.find((n) => n.attrs?.has('data-tier-badge'));
  assert.deepEqual(
    badges.map((b) => b.textContent),
    ['ARCHIVAL', 'ARCHIVAL'],
  );
  assert.equal(rail.element.dataset.platforms, 'tiktok,instagram');
  assert.deepEqual(pinCalls, [1, 2]);
  // ended → queue advances to the next playable (the TikTok iframe)
  video.dispatch('ended');
  assert.equal(rail.state.playingId, 'tiktok:1');
  assert.equal(rail.element.find((n) => n.tagName === 'IFRAME').length, 1);
});

test('rail: duplicate clip ids are ignored; done with nothing playable shows the empty state', () => {
  const rail = createSceneVideoRail({ document: makeDoc(), window: {} });
  rail.handle('clip', clip({ id: 'a', playableKind: 'link' }));
  rail.handle('clip', clip({ id: 'a', playableKind: 'link' }));
  assert.equal(rail.state.clips.length, 1);
  rail.handle('done', { total: 1, counts: { instagram: 1 } });
  assert.equal(rail.element.dataset.state, 'done');
  assert.equal(rail.state.playingId, null);
});

test('scene SSE parser yields {event,data} across chunk boundaries (regression: mini-chat parser shape)', async () => {
  const { createSceneSseParser } = await import('./rail.js');
  const p = createSceneSseParser();
  assert.deepEqual(p.push('event: plan\ndata: {"a":1}\n\n: hb\n\nevent: cl'), [
    { event: 'plan', data: { a: 1 } },
  ]);
  assert.deepEqual(p.push('ip\ndata: {"id":"x"}\n\n'), [
    { event: 'clip', data: { id: 'x' } },
  ]);
  assert.deepEqual(p.flush(), []);
});

test('rail.start consumes a real SSE body end-to-end', async () => {
  const { createSceneSseParser } = await import('./rail.js');
  assert.ok(createSceneSseParser);
  const body = [
    'event: incident\ndata: {"title":"Umm Suqeim crash","reported_at":"2026-09-26T00:00:00Z","rebuild":true}\n\n',
    `event: clip\ndata: ${JSON.stringify(clip({ id: 'instagram:a' }))}\n\n`,
    `event: clip\ndata: ${JSON.stringify(clip({ id: 'youtube:b', platform: 'youtube', playableKind: 'iframe', playableUrl: 'https://www.youtube-nocookie.com/embed/b?autoplay=1' }))}\n\n`,
    'event: done\ndata: {"total":2,"counts":{"instagram":1,"youtube":1}}\n\n',
  ];
  const enc = new TextEncoder();
  const fetch = async () => ({
    ok: true,
    body: new ReadableStream({
      start(c) {
        for (const b of body) c.enqueue(enc.encode(b));
        c.close();
      },
    }),
  });
  const rail = createSceneVideoRail({ document: makeDoc(), window: {}, fetch });
  await rail.start('rebuild the car crash reported in Umm Suqeim');
  assert.equal(rail.state.clips.length, 2);
  assert.equal(rail.state.done, true);
  assert.equal(rail.element.dataset.platforms, 'youtube,instagram');
  assert.equal(rail.state.playingId, 'instagram:a');
});

test('rail rejects EOF without an explicit done instead of inventing successful coverage', async () => {
  const enc = new TextEncoder();
  const rail = createSceneVideoRail({ document: makeDoc(), window: {}, fetch: async () => ({ ok: true, body: new ReadableStream({ start(c) { c.enqueue(enc.encode('event: plan\ndata: {}\n\n')); c.close(); } }) }) });
  await rail.start('fixture incident');
  assert.equal(rail.state.done, false);
  assert.equal(rail.element.dataset.state, 'error');
});

test('rail cancellation is explicit and never claims a successful completed stream', () => {
  const rail = createSceneVideoRail({ document: makeDoc(), window: {} });
  let aborted = false;
  rail.state.abort = { abort() { aborted = true; } };
  rail.cancel();
  assert.equal(aborted, true);
  assert.equal(rail.state.done, false);
  assert.equal(rail.element.dataset.state, 'cancelled');
});
