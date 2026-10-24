import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCommand,
  findPlace,
  decodeFootageParams,
  encodeFootageParams,
  archiveBannerFor,
  freshnessOf,
  playerKindFor,
  youtubeIdOf,
  appendToPlaylist,
  fixturesFor,
  debounce,
} from './model.js';

describe('footage command parser', () => {
  test('rebuild the car crash reported in Umm Suqeim → place + keywords + rebuild mode', () => {
    const c = parseCommand('rebuild the car crash reported in Umm Suqeim');
    assert.equal(c.mode, 'rebuild');
    assert.equal(c.incident, 'car crash');
    assert.equal(c.place.name, 'Umm Suqeim');
    assert.ok(Math.abs(c.place.lat - 25.147) < 0.01 && Math.abs(c.place.lon - 55.199) < 0.01);
  });
  test('show footage of the fire in JVC → live mode, JVC alias', () => {
    const c = parseCommand('show footage of the fire in JVC');
    assert.equal(c.mode, 'live');
    assert.equal(c.place.name, 'Jumeirah Village Circle');
    assert.match(c.incident, /fire/);
  });
  test('Arabic place alias resolves', () => {
    assert.equal(findPlace('حادث أم سقيم').name, 'Umm Suqeim');
  });
  test('unknown place keeps placeText for geocoding', () => {
    const c = parseCommand('replay the flood reported in Timbuktu');
    assert.equal(c.place, null);
    assert.equal(c.placeText, 'Timbuktu');
    assert.equal(c.incident, 'flood');
  });
  test('empty → null', () => {
    assert.equal(parseCommand('   '), null);
  });
});

describe('footage hash params', () => {
  test('round-trip fv/fk/fm/fs and the ui f.c token without touching other panels', () => {
    const params = new URLSearchParams('v=2&lat=1&ui=c.c.1_s.c.0');
    encodeFootageParams(params, { visible: true, keywords: 'car crash', mode: 'rebuild', since: '2y', collapsed: false });
    assert.equal(params.get('fv'), '1');
    assert.equal(params.get('fk'), 'car crash');
    assert.equal(params.get('fm'), 'rebuild');
    assert.equal(params.get('fs'), '2y');
    assert.equal(params.get('ui'), 'c.c.1_s.c.0_f.c.0');
    const back = decodeFootageParams(params);
    assert.deepEqual(back, { visible: true, keywords: 'car crash', mode: 'rebuild', since: '2y', collapsed: false });
    assert.equal(params.get('lat'), '1');
  });
  test('legacy hash without footage params decodes to defaults', () => {
    const back = decodeFootageParams('#v=2&lat=25&lon=55&hud=tactical&ui=c.c.1_c.p.0');
    assert.deepEqual(back, { visible: null, keywords: '', mode: null, since: null, collapsed: null });
  });
});

describe('footage freshness + banner', () => {
  test('freshness windows', () => {
    const now = Date.parse('2026-10-23T12:00:00Z');
    assert.equal(freshnessOf('2026-10-23T11:50:00Z', now), 'LIVE');
    assert.equal(freshnessOf('2026-10-23T01:00:00Z', now), 'RECENT');
    assert.equal(freshnessOf('2026-09-26T11:46:39Z', now), 'ARCHIVE');
    assert.equal(freshnessOf(null, now), 'ARCHIVE');
  });
  test('archive banner names the earliest published date', () => {
    const b = archiveBannerFor(
      [
        { published_at: '2026-09-27T07:00:10Z', freshness: 'ARCHIVE' },
        { published_at: '2026-09-26T11:46:39Z', freshness: 'ARCHIVE' },
      ],
      'rebuild',
    );
    assert.equal(b.text, 'REBUILT FROM ARCHIVAL FOOTAGE — originally reported 2026-09-26');
    const r = archiveBannerFor([{ published_at: '2026-04-03T11:09:18Z', freshness: 'ARCHIVE' }], 'rebuild', { reportedAt: '2026-09-26T00:00:00Z' });
    assert.equal(r.text, 'REBUILT FROM ARCHIVAL FOOTAGE — originally reported 2026-09-26');
  });
  test('no banner for a fresh live playlist', () => {
    const now = new Date().toISOString();
    assert.equal(archiveBannerFor([{ published_at: now, freshness: 'LIVE' }], 'live'), null);
  });
});

describe('footage players + playlist', () => {
  test('player kinds', () => {
    assert.equal(playerKindFor({ url: 'https://www.youtube.com/shorts/pu6shIJmb5s' }), 'youtube');
    assert.equal(youtubeIdOf({ url: 'https://www.youtube.com/shorts/pu6shIJmb5s' }), 'pu6shIJmb5s');
    assert.equal(playerKindFor({ url: 'https://www.tiktok.com/@x/video/123', embed_url: 'https://www.tiktok.com/embed/v2/123' }), 'tiktok');
    assert.equal(playerKindFor({ url: 'https://www.instagram.com/reel/DW8khmCg4CY/', play_url: 'https://scontent.cdninstagram.com/o1/v/x.mp4?a=1' }), 'video');
    assert.equal(playerKindFor({ url: 'https://www.instagram.com/p/DdyBfSdl-zh/' }), 'instagram');
    assert.equal(playerKindFor({ url: 'https://www.facebook.com/x/posts/1' }), 'link');
  });
  test('playlist dedupes by canonical', () => {
    let list = [];
    list = appendToPlaylist(list, { canonical: 'yt:a', url: 'u1' });
    list = appendToPlaylist(list, { canonical: 'yt:a', url: 'u2' });
    list = appendToPlaylist(list, { url: 'u3' });
    assert.equal(list.length, 2);
  });
  test('fixtures only for the Umm Suqeim crash', () => {
    assert.ok(fixturesFor('car crash', { name: 'Umm Suqeim' }).length >= 3);
    assert.equal(fixturesFor('car crash', { name: 'Deira' }).length, 0);
  });
  test('debounce collapses bursts', () => {
    let calls = 0;
    const timers = [];
    const d = debounce(() => calls++, 800, { setTimeoutImpl: (fn) => (timers.push(fn), timers.length), clearTimeoutImpl: (h) => (timers[h - 1] = null) });
    d();
    d();
    d();
    timers.filter(Boolean).forEach((fn) => fn());
    assert.equal(calls, 1);
  });
});
