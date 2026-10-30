import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMediaUrl,
  mediaFileName,
  renderAnswer,
  renderDeliverables,
  tokenizeAnswer,
} from './miniChat.js';

/**
 * Deliverable media rendering (sandbox-verify-2026-10-21/retry-0917 Scenario A
 * DEFECT: media deliverables rendered as plain anchors). Pure-DOM-stand-in
 * tests: documents side by side, images as thumbnails that open the lightbox,
 * videos as a poster that opens the side pane, NO autoplay in the transcript.
 */

function makeDoc() {
  function mk(tag) {
    const attrs = new Map();
    const listeners = new Map();
    const node = {
      tagName: tag.toUpperCase(),
      children: [],
      attrs,
      textContent: '',
      autoplay: undefined,
      controls: undefined,
      get className() {
        return attrs.get('class') || '';
      },
      set className(v) {
        attrs.set('class', v);
      },
      set href(v) {
        attrs.set('href', v);
      },
      get href() {
        return attrs.get('href');
      },
      set target(v) {
        attrs.set('target', v);
      },
      set rel(v) {
        attrs.set('rel', v);
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      removeAttribute: (k) => attrs.delete(k),
      appendChild(c) {
        node.children.push(c);
        return c;
      },
      append(...cs) {
        node.children.push(...cs);
      },
      replaceChildren(...cs) {
        node.children = [...cs];
      },
      addEventListener(type, fn) {
        listeners.set(type, fn);
      },
      click() {
        listeners.get('click')?.({ target: node });
      },
      all() {
        const out = [];
        const walk = (n) => {
          for (const c of n.children || []) {
            out.push(c);
            walk(c);
          }
        };
        walk(node);
        return out;
      },
    };
    return node;
  }
  return {
    createElement: mk,
    createTextNode: (t) => ({ tagName: '#text', textContent: t, children: [] }),
  };
}

const ANSWER =
  'Report: https://example.com/brief.pdf Image: https://example.com/figure.png Video: https://example.com/clip.mp4 and a citation https://example.com/article';

describe('classifyMediaUrl / tokenizeAnswer', () => {
  test('classifies by extension and ignores query strings', () => {
    assert.equal(classifyMediaUrl('https://x.test/a.PNG?x=1'), 'image');
    assert.equal(classifyMediaUrl('https://x.test/a.webm#t=1'), 'video');
    assert.equal(classifyMediaUrl('https://x.test/a.pdf'), 'document');
    assert.equal(classifyMediaUrl('https://x.test/a.xlsx'), 'document');
    assert.equal(classifyMediaUrl('https://x.test/article'), null);
    assert.equal(classifyMediaUrl('not a url'), null);
  });
  test('mediaFileName returns the last path segment', () => {
    assert.equal(mediaFileName('https://x.test/dir/brief%20v2.pdf'), 'brief v2.pdf');
    assert.equal(mediaFileName('https://x.test/'), 'x.test');
  });
  test('tokenizeAnswer keeps text and tags links with their media kind', () => {
    const toks = tokenizeAnswer(ANSWER);
    const links = toks.filter((t) => t.kind === 'link');
    assert.deepEqual(
      links.map((l) => l.media),
      ['document', 'image', 'video', null],
    );
    assert.equal(toks[0].kind, 'text');
  });
});

describe('renderAnswer deliverables', () => {
  test('renders a side-by-side deliverables grid: doc preview, image thumbnail, video poster; citations stay anchors', () => {
    const doc = makeDoc();
    const node = doc.createElement('div');
    const opened = [];
    renderAnswer(node, ANSWER, doc, { onOpen: (i) => opened.push(i) });
    const all = node.all();
    const anchors = all.filter((n) => n.tagName === 'A' && n.className.includes('od-chat__cite'));
    assert.equal(anchors.length, 4, 'every URL is still an anchor');
    assert.equal(anchors[0].getAttribute('data-media'), 'document');
    assert.equal(anchors[3].getAttribute('data-media'), null, 'citation has no media kind');
    const grid = node.children.find((c) => c.className === 'od-chat__deliverables');
    assert.ok(grid, 'deliverables grid rendered under the message');
    assert.equal(grid.getAttribute('data-count'), '3');
    const cards = grid.children;
    assert.deepEqual(
      cards.map((c) => c.getAttribute('data-media')),
      ['document', 'image', 'video'],
    );
    // image → <img loading=lazy> inside a button
    const img = all.find((n) => n.tagName === 'IMG');
    assert.ok(img, 'image thumbnail rendered');
    assert.equal(img.getAttribute('loading'), 'lazy');
    assert.equal(img.getAttribute('src'), 'https://example.com/figure.png');
    // video → poster <video> with NO autoplay / NO controls, muted, metadata only
    const video = all.find((n) => n.tagName === 'VIDEO');
    assert.ok(video, 'video poster rendered');
    assert.equal(video.getAttribute('autoplay'), null, 'no autoplay attribute');
    assert.equal(video.autoplay, false, 'autoplay property forced false');
    assert.equal(video.getAttribute('controls'), null, 'no controls in the transcript');
    assert.equal(video.getAttribute('preload'), 'metadata');
    assert.equal(video.getAttribute('muted'), '');
    assert.ok(all.some((n) => n.className === 'od-chat__poster-play'), 'play affordance');
    // document → extension chip + name
    const ext = all.find((n) => n.className === 'od-chat__doc-ext');
    assert.equal(ext.textContent, 'PDF');
    // clicking opens through the callback (lightbox / side pane wiring)
    all.find((n) => n.className === 'od-chat__thumb').click();
    all.find((n) => n.className === 'od-chat__poster').click();
    all.find((n) => n.className === 'od-chat__doc').click();
    assert.deepEqual(
      opened.map((i) => i.media),
      ['image', 'video', 'document'],
    );
  });

  test('deduplicates repeated deliverable URLs and caps at 12 cards', () => {
    const doc = makeDoc();
    const node = doc.createElement('div');
    const urls = Array.from({ length: 15 }, (_, i) => `https://x.test/f${i}.png`);
    renderAnswer(node, [...urls, urls[0]].join(' '), doc);
    const grid = node.children.find((c) => c.className === 'od-chat__deliverables');
    assert.equal(grid.getAttribute('data-count'), '15');
    assert.equal(grid.children.length, 12);
  });

  test('no grid when the answer carries no deliverable URLs or media is disabled', () => {
    const doc = makeDoc();
    const node = doc.createElement('div');
    renderAnswer(node, 'See https://example.com/article for details', doc);
    assert.ok(!node.children.some((c) => c.className === 'od-chat__deliverables'));
    const node2 = doc.createElement('div');
    renderAnswer(node2, ANSWER, doc, { media: false });
    assert.ok(!node2.children.some((c) => c.className === 'od-chat__deliverables'));
  });

  test('renderDeliverables never emits markup from the URL (no HTML injection)', () => {
    const doc = makeDoc();
    const grid = renderDeliverables(
      [{ url: 'https://x.test/<img onerror=1>.png', label: '<b>x</b>', media: 'image' }],
      doc,
    );
    const img = grid.all().find((n) => n.tagName === 'IMG');
    assert.equal(img.getAttribute('alt'), '<b>x</b>', 'label is set as text, not parsed');
  });
});
