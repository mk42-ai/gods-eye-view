import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Embeddability (cycle 8 → 9): the served document must be loadable inside an
 * iframe on a host page, so neither the Vite dev/preview server
 * (build/vite.js, asserted in viteBuild.test.mjs) nor the Vercel edge
 * (vercel.json) may emit X-Frame-Options or a frame-ancestors CSP for `/` or
 * `/index.html`. The key-setup JSON endpoint keeps its own DENY — it is a
 * loopback-only credential surface, not the document.
 */
test('vercel.json emits no framing headers for the document', () => {
  const config = JSON.parse(
    readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'),
  );
  for (const rule of config.headers || []) {
    for (const header of rule.headers || []) {
      assert.notEqual(
        header.key.toLowerCase(),
        'x-frame-options',
        `${rule.source} must not set X-Frame-Options`,
      );
      assert.ok(
        !/frame-ancestors\s+'none'/i.test(String(header.value)),
        `${rule.source} must not block the authorized OnDemand frame parent`,
      );
    }
  }
  // Cache rules for immutable assets stay in place.
  assert.ok(
    config.headers.some((rule) => rule.source === '/assets/(.*)'),
    'asset cache header retained',
  );
});

test('framing allowlist admits OnDemand but not arbitrary parents', () => {
  const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const csp = config.headers.flatMap(x => x.headers).find(x => x.key === 'Content-Security-Policy').value;
  assert.match(csp, /frame-src 'self' https:\/\/www.youtube-nocookie.com/);
  assert.match(csp, /frame-ancestors 'self' https:\/\/on-demand.io https:\/\/\*.on-demand.io/);
  assert.doesNotMatch(csp, /frame-ancestors \*/);
});
