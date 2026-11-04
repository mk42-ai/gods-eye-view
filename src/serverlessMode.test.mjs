import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { chatPanelOpen, syncWithChatPanels } from './serverlessMode.js';

/**
 * Regression for sandbox-verify-2026-10-21/retry-0917 (agents 1–3): the
 * serverless notice banner sat at z-index 2147483000 and covered the ASK
 * ONDEMAND composer at 390×844, so real taps on SEND never reached it. The
 * banner now hides while a chat panel is open and returns when it closes.
 */

function mockPanel(id, { open = false, hidden = true } = {}) {
  const attrs = new Map();
  if (open !== null) attrs.set('data-open', open ? 'true' : 'false');
  return {
    id,
    hidden,
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => attrs.set(k, String(v)),
  };
}

function mockDoc(panels = {}) {
  return {
    body: {},
    querySelector: (sel) => panels[sel] || null,
  };
}

describe('serverless notice vs ASK ONDEMAND panels', () => {
  test('chatPanelOpen reads data-open="true" on the mini chat', () => {
    const mini = mockPanel('ondemand-mini-chat', { open: false });
    const doc = mockDoc({ '#ondemand-mini-chat': mini });
    assert.equal(chatPanelOpen(doc), false);
    mini.setAttribute('data-open', 'true');
    assert.equal(chatPanelOpen(doc), true);
  });

  test('chatPanelOpen falls back to hidden=false for the entity chat (no data-open)', () => {
    const entity = mockPanel('ondemand-entity-chat', {
      open: null,
      hidden: true,
    });
    const doc = mockDoc({ '#ondemand-entity-chat': entity });
    assert.equal(chatPanelOpen(doc), false);
    entity.hidden = false;
    assert.equal(chatPanelOpen(doc), true);
  });

  test('chatPanelOpen is false when no panel exists yet', () => {
    assert.equal(chatPanelOpen(mockDoc()), false);
  });

  test('syncWithChatPanels hides the banner while a panel is open and restores it on close', () => {
    const callbacks = [];
    const observed = [];
    class FakeObserver {
      constructor(cb) {
        callbacks.push(cb);
        this.disconnected = false;
      }
      observe(target, init) {
        observed.push({ target, init });
      }
      disconnect() {
        this.disconnected = true;
      }
    }
    const prevObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = FakeObserver;
    try {
      const mini = mockPanel('ondemand-mini-chat', { open: true });
      const doc = mockDoc({ '#ondemand-mini-chat': mini });
      const banner = { hidden: false };
      const stop = syncWithChatPanels(banner, doc);
      assert.equal(banner.hidden, true, 'hidden immediately: panel is open');
      assert.ok(
        observed.some((o) => o.target === mini && o.init.attributes === true),
        'the panel itself is observed for hidden/data-open',
      );
      assert.ok(
        observed.some((o) => o.target === doc.body && o.init.childList === true),
        'body children are observed so late-created panels are picked up',
      );
      mini.setAttribute('data-open', 'false');
      for (const cb of callbacks) cb([]);
      assert.equal(banner.hidden, false, 'restored once the panel closes');
      mini.setAttribute('data-open', 'true');
      for (const cb of callbacks) cb([]);
      assert.equal(banner.hidden, true);
      stop();
    } finally {
      globalThis.MutationObserver = prevObserver;
    }
  });

  test('syncWithChatPanels works without MutationObserver (initial state only)', () => {
    const prevObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = undefined;
    try {
      const banner = { hidden: false };
      const stop = syncWithChatPanels(banner, mockDoc());
      assert.equal(banner.hidden, false);
      assert.equal(typeof stop, 'function');
      stop();
    } finally {
      globalThis.MutationObserver = prevObserver;
    }
  });
});
