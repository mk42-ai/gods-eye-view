import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamView } from './streamView.js';

function createMockDom() {
  const elements = [];
  function createElement(tag) {
    const listeners = new Map();
    const el = {
      tagName: tag.toUpperCase(),
      className: '',
      id: '',
      hidden: false,
      textContent: '',
      dataset: {},
      attrs: {},
      children: [],
      scrollTop: 0,
      scrollHeight: 100,
      clientHeight: 100,
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      getAttribute(k) {
        return this.attrs[k];
      },
      appendChild(c) {
        this.children.push(c);
      },
      append(...cs) {
        this.children.push(...cs);
      },
      addEventListener(evt, fn) {
        listeners.set(evt, fn);
      },
      removeEventListener(evt, fn) {
        listeners.delete(evt);
      },
      dispatchEvent(evt) {
        listeners.get(evt)?.();
      },
      remove() {},
    };
    elements.push(el);
    return el;
  }
  return { createElement, elements };
}

test('rAF pacing reveals characters smoothly and never exceeds cap per frame', () => {
  const doc = createMockDom();
  let scheduledFn = null;
  let frameCount = 0;
  const mockRaf = (fn) => {
    scheduledFn = fn;
    return ++frameCount;
  };
  const mockCaf = () => {
    scheduledFn = null;
  };

  const maxCap = 10;
  const view = createStreamView({
    document: doc,
    requestAnimationFrame: mockRaf,
    cancelAnimationFrame: mockCaf,
    maxCharsPerFrame: maxCap,
    minCharsPerFrame: 1,
  });

  // Append a large chunk of 100 characters
  const largeText = 'A'.repeat(100);
  view.appendToken(largeText);

  assert.equal(
    view.getDisplayedText(),
    '',
    'Initially no characters displayed before first rAF',
  );
  assert.equal(view.getPendingText(), largeText);
  assert.ok(scheduledFn, 'rAF should be scheduled');

  // Trigger frame 1
  scheduledFn();
  const frame1Chars = view.getDisplayedText().length;
  assert.ok(frame1Chars > 0, 'Frame 1 must reveal some characters');
  assert.ok(
    frame1Chars <= maxCap,
    `Frame 1 must not reveal more than cap ${maxCap}, got ${frame1Chars}`,
  );

  // Trigger frame 2
  assert.ok(scheduledFn, 'Next rAF must be scheduled');
  scheduledFn();
  const frame2Chars = view.getDisplayedText().length - frame1Chars;
  assert.ok(
    frame2Chars <= maxCap,
    `Frame 2 must not reveal more than cap ${maxCap}, got ${frame2Chars}`,
  );

  view.destroy();
});

test('flush() immediately reveals all pending backlog', () => {
  const doc = createMockDom();
  let scheduledFn = null;
  const mockRaf = (fn) => {
    scheduledFn = fn;
    return 1;
  };

  const view = createStreamView({
    document: doc,
    requestAnimationFrame: mockRaf,
    cancelAnimationFrame: () => {},
    maxCharsPerFrame: 5,
  });

  view.appendToken('Hello world, streaming scene builder.');
  assert.ok(view.getPendingText().length > 0);

  // Flush reveals all remaining characters synchronously
  view.flush();
  assert.equal(
    view.getDisplayedText(),
    'Hello world, streaming scene builder.',
  );
  assert.equal(view.getPendingText(), '');

  view.destroy();
});

test('jump-to-latest pill shows when user scrolled up and hides when clicked', () => {
  const doc = createMockDom();
  const view = createStreamView({
    document: doc,
    requestAnimationFrame: () => 1,
  });

  assert.equal(view.jumpPill.hidden, true);

  // Simulate scrolling up: scrollHeight is 200, but scrollTop + clientHeight is only 120 (gap > 24)
  view.scrollArea.scrollHeight = 200;
  view.scrollArea.clientHeight = 100;
  view.scrollArea.scrollTop = 20;

  view.scrollArea.dispatchEvent('scroll');
  assert.equal(view.isScrolledUp(), true);
  assert.equal(view.jumpPill.hidden, false);

  // Jump to latest
  view.jumpToLatest();
  assert.equal(view.isScrolledUp(), false);
  assert.equal(view.jumpPill.hidden, true);
  assert.equal(view.scrollArea.scrollTop, 200);

  view.destroy();
});

test('complete state updates chip and screen reader polite summary line', () => {
  const doc = createMockDom();
  const view = createStreamView({
    document: doc,
    requestAnimationFrame: () => 1,
  });

  view.setModel('qwen-3.8-27b');
  view.appendToken('Three walkers gather.');
  view.setState('complete');

  assert.equal(view.element.dataset.state, 'complete');
  assert.match(view.chip.textContent, /qwen-3\.8-27b/);
  assert.match(view.srSummary.textContent, /Scene build complete/);
  assert.equal(view.srSummary.attrs['aria-live'], 'polite');

  view.destroy();
});

test('setFallback updates status line with compact amber fallback styling', () => {
  const doc = createMockDom();
  const view = createStreamView({
    document: doc,
    requestAnimationFrame: () => 1,
  });

  view.setFallback('Research timed out · continuing with approximate location');
  const statusLine = view.scrollArea.children.find((c) =>
    c.className?.includes('composer-stream-status'),
  );
  assert.ok(statusLine, 'status line must exist');
  assert.equal(statusLine.hidden, false);
  assert.equal(
    statusLine.textContent,
    'Research timed out · continuing with approximate location',
  );
  assert.equal(statusLine.dataset.stage, 'fallback');
  assert.ok(
    statusLine.className.includes('composer-stream-status--fallback'),
    'must carry fallback class',
  );

  view.destroy();
});

test('telemetry pill: accumulates tokens, shows ~0 tok/s initially, and sets QA data attributes', () => {
  const doc = createMockDom();
  const view = createStreamView({
    document: doc,
    requestAnimationFrame: () => 1,
  });

  view.setState('streaming');
  // Initially before any token
  assert.equal(view.chip.getAttribute('data-tokens'), '0');
  assert.ok(view.chip.getAttribute('data-elapsed-ms') !== null);
  assert.match(view.chip.textContent, /~0 tok\/s/);

  // Append token and addTokens from answer.delta
  view.appendToken('Hello ');
  assert.equal(view.chip.getAttribute('data-tokens'), '1');
  view.addTokens(5);
  assert.equal(view.chip.getAttribute('data-tokens'), '6');

  // Authoritative update from usage event
  view.setTokensAuthoritative(12);
  assert.equal(view.chip.getAttribute('data-tokens'), '12');

  view.setModel('cerebras-llama3');
  assert.match(view.chip.textContent, /cerebras-llama3/);

  view.setState('complete');
  assert.equal(view.chip.getAttribute('data-tokens'), '12');
  assert.ok(Number(view.chip.getAttribute('data-elapsed-ms')) >= 0);

  view.destroy();
});
