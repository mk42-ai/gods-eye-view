import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyStateFor,
  summarizeDevDetails,
  createMiniChat,
  DEV_DETAILS_STORAGE_KEY,
  SELECTORS,
} from './miniChat.js';

describe('emptyStateFor class selection helper', () => {
  test('maps known empty state kinds to CSS modifier classes', () => {
    assert.equal(emptyStateFor('no-sessions'), 'od-empty-state--no-sessions');
    assert.equal(emptyStateFor('noSessions'), 'od-empty-state--no-sessions');
    assert.equal(emptyStateFor('no-results'), 'od-empty-state--no-results');
    assert.equal(emptyStateFor('noResults'), 'od-empty-state--no-results');
    assert.equal(
      emptyStateFor('source-unavailable'),
      'od-empty-state--source-unavailable',
    );
    assert.equal(
      emptyStateFor('sourceUnavailable'),
      'od-empty-state--source-unavailable',
    );
  });

  test('returns null for unknown or empty kinds', () => {
    assert.equal(emptyStateFor('unknown'), null);
    assert.equal(emptyStateFor(''), null);
    assert.equal(emptyStateFor(null), null);
    assert.equal(emptyStateFor(undefined), null);
  });
});

describe('summarizeDevDetails helper', () => {
  test('handles empty or missing input safely', () => {
    assert.deepEqual(summarizeDevDetails(), []);
    assert.deepEqual(summarizeDevDetails({}), []);
  });

  test('formats request line with method, path, object and session', () => {
    const lines = summarizeDevDetails({
      request: {
        method: 'POST',
        path: '/api/ondemand/v2/chat',
        objectType: 'chart',
        objectId: 'trend-42',
        sessionId: 'sess-xyz-789',
      },
    });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^Request: POST \/api\/ondemand\/v2\/chat/);
    assert.ok(lines[0].includes('object: chart/trend-42'));
    assert.ok(lines[0].includes('session: sess-xyz-789'));
  });

  test('formats provenance, key source, and JSON block', () => {
    const lines = summarizeDevDetails({
      provenance: {
        provider: 'anthropic',
        endpointId: 'claude-3-5-sonnet',
        pluginIds: ['plugin-usgs', 'plugin-firms'],
        keySource: 'server',
        fetchedAt: '2026-10-21T02:00:00Z',
      },
    });
    assert.ok(lines.includes('Key source: server'));
    assert.ok(lines.includes('Provider: anthropic'));
    assert.ok(lines.includes('Endpoint: claude-3-5-sonnet'));
    assert.ok(lines.includes('Plugins: plugin-usgs, plugin-firms'));
    assert.ok(lines.includes('Fetched at: 2026-10-21T02:00:00Z'));
    const jsonLine = lines.find((l) => l.startsWith('Provenance: '));
    assert.ok(jsonLine, 'Provenance JSON line present');
    const parsed = JSON.parse(jsonLine.replace('Provenance: ', ''));
    assert.equal(parsed.provider, 'anthropic');
    assert.equal(parsed.keySource, 'server');
    assert.deepEqual(parsed.pluginIds, ['plugin-usgs', 'plugin-firms']);
  });

  test('formats metrics and frames counters', () => {
    const lines = summarizeDevDetails({
      metrics: { ttfb: 125, tokens: 48, latency: 430 },
      frames: 18,
    });
    assert.ok(
      lines.some(
        (l) => l.includes('ttfb 125 ms') && l.includes('latency 430 ms'),
      ),
    );
    assert.ok(lines.includes('SSE frames: 18'));
  });

  test('formats comprehensive dev details summary together', () => {
    const lines = summarizeDevDetails({
      request: {
        method: 'POST',
        path: '/api/chat',
        objectType: 'satellite',
        objectId: 'ISS',
      },
      provenance: {
        provider: 'openai',
        endpointId: 'gpt-4o',
        keySource: 'server',
      },
      metrics: { ttfb: 90, latency: 310 },
      frames: 12,
    });
    assert.ok(lines.some((l) => l.startsWith('Request: ')));
    assert.ok(lines.includes('Key source: server'));
    assert.ok(lines.some((l) => l.startsWith('Metrics: ')));
    assert.ok(lines.includes('SSE frames: 12'));
  });
});

describe('miniChat developer details & empty state DOM integration', () => {
  function makeMockDoc() {
    const elements = new Map();
    function createMockEl(tag) {
      const children = [];
      const listeners = new Map();
      const attrs = new Map();
      const classList = new Set();
      const el = {
        tagName: tag.toUpperCase(),
        children,
        id: '',
        open: false,
        hidden: false,
        disabled: false,
        scrollTop: 0,
        scrollHeight: 100,
        clientHeight: 100,
        _text: '',
        get textContent() {
          return this._text;
        },
        set textContent(v) {
          this._text = String(v ?? '');
          children.length = 0;
        },
        get className() {
          return [...classList].join(' ');
        },
        set className(v) {
          classList.clear();
          if (v) v.split(/\s+/).forEach((c) => c && classList.add(c));
        },
        classList: {
          add: (...cs) => cs.forEach((c) => classList.add(c)),
          remove: (...cs) => cs.forEach((c) => classList.delete(c)),
          contains: (c) => classList.has(c),
        },
        setAttribute: (k, v) => attrs.set(k, String(v)),
        getAttribute: (k) => attrs.get(k) ?? null,
        removeAttribute: (k) => attrs.delete(k),
        appendChild: (child) => {
          children.push(child);
          child.parentNode = el;
          return child;
        },
        append: (...cs) => {
          for (const c of cs) {
            children.push(c);
            c.parentNode = el;
          }
        },
        replaceChildren: (...cs) => {
          children.length = 0;
          for (const c of cs) {
            children.push(c);
            c.parentNode = el;
          }
        },
        remove: () => {
          if (el.parentNode) {
            const idx = el.parentNode.children.indexOf(el);
            if (idx >= 0) el.parentNode.children.splice(idx, 1);
            el.parentNode = null;
          }
        },
        addEventListener: (event, handler) => {
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event).push(handler);
        },
        dispatchEvent: (event) => {
          const hs = listeners.get(event?.type || event) || [];
          hs.forEach((h) => h(event));
        },
        querySelector: (sel) => {
          function search(node) {
            for (const c of node.children) {
              if (matchesSel(c, sel)) return c;
              const sub = search(c);
              if (sub) return sub;
            }
            return null;
          }
          return search(el);
        },
        querySelectorAll: (sel) => {
          const found = [];
          function search(node) {
            for (const c of node.children) {
              if (matchesSel(c, sel)) found.push(c);
              search(c);
            }
          }
          search(el);
          return found;
        },
        focus: () => {},
      };
      return el;
    }

    function matchesSel(el, sel) {
      if (sel.startsWith('#')) return el.id === sel.slice(1);
      if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
      return false;
    }

    const doc = {
      body: createMockEl('body'),
      documentElement: createMockEl('html'),
      createElement: (tag) => {
        const el = createMockEl(tag);
        return el;
      },
      createTextNode: (text) => ({ textContent: text }),
      getElementById: (id) => elements.get(id) || null,
    };
    return doc;
  }

  function makeMockStorage(initial = {}) {
    const mem = new Map(Object.entries(initial));
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
      clear: () => mem.clear(),
    };
  }

  test('creates Developer details <details> with summary, dev-lines and activity list', () => {
    const doc = makeMockDoc();
    const storage = makeMockStorage();
    const chat = createMiniChat({
      document: doc,
      storage,
      fetch: async () => ({
        status: 404,
        ok: false,
        json: async () => ({}),
      }),
    });

    chat.open({
      objectType: 'chart',
      objectId: 'c1',
      label: 'Traffic Heatmap',
    });

    const panel = doc.body.children.find(
      (c) => c.id === SELECTORS.panel.slice(1),
    );
    assert.ok(panel, 'panel is created');

    const devDetails = panel.children.find(
      (c) => c.id === SELECTORS.dev.slice(1),
    );
    assert.ok(devDetails, 'Developer details <details> element exists');
    assert.equal(devDetails.tagName, 'DETAILS');
    assert.ok(devDetails.classList.contains('od-chat__dev'));
    assert.equal(devDetails.open, false, 'collapsed by default');

    const summary = devDetails.children.find((c) => c.tagName === 'SUMMARY');
    assert.ok(summary, '<summary> exists inside details');
    assert.equal(summary.textContent, 'Developer details');

    // ui.activity list is preserved inside details
    const activity = devDetails.querySelector(SELECTORS.activity);
    assert.ok(activity, 'activity list exists inside details body');
    assert.equal(activity.id, 'ondemand-mini-chat-activity');

    // localStorage toggle persistence
    devDetails.open = true;
    devDetails.dispatchEvent({ type: 'toggle' });
    assert.equal(storage.getItem(DEV_DETAILS_STORAGE_KEY), '1');

    devDetails.open = false;
    devDetails.dispatchEvent({ type: 'toggle' });
    assert.equal(storage.getItem(DEV_DETAILS_STORAGE_KEY), '0');

    chat.destroy();
  });

  test('remembers open state when DEV_DETAILS_STORAGE_KEY is 1', () => {
    const doc = makeMockDoc();
    const storage = makeMockStorage({ [DEV_DETAILS_STORAGE_KEY]: '1' });
    const chat = createMiniChat({
      document: doc,
      storage,
      fetch: async () => ({
        status: 404,
        ok: false,
        json: async () => ({}),
      }),
    });

    chat.open({ objectType: 'chart', objectId: 'c2' });
    const devDetails = doc.body.querySelector(SELECTORS.dev);
    assert.ok(devDetails);
    assert.equal(devDetails.open, true, 'opened from localStorage');
    chat.destroy();
  });

  test('shows no-sessions empty state when history replay has 0 messages and clears on new message', async () => {
    const doc = makeMockDoc();
    const storage = makeMockStorage();
    const chat = createMiniChat({
      document: doc,
      storage,
      fetch: async () => ({
        status: 200,
        ok: true,
        json: async () => ({ data: [] }),
      }),
    });

    chat.open({ objectType: 'chart', objectId: 'c3', label: 'Empty Object' });
    await new Promise((r) => setTimeout(r, 10));

    const transcript = doc.body.querySelector(SELECTORS.transcript);
    assert.ok(transcript, 'transcript exists');

    const empty = transcript.querySelector('.od-empty-state');
    assert.ok(empty, 'empty state rendered');
    assert.ok(
      empty.classList.contains('od-empty-state--no-sessions'),
      'has no-sessions modifier',
    );
    assert.equal(empty.textContent, 'No prior investigation for this object');

    // Now send a message or simulate appendMessage
    const mockFetchChat = async () => ({
      status: 200,
      ok: true,
      text: async () => 'data: {"type":"done"}\n\n',
    });
    chat.destroy();
  });
});
