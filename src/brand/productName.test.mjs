// Product identity — browser + server mirrors share the same defaults and
// the wordmark helper splits the accent word (src/brand/productName.js,
// server/brand/productName.js, build/product-name.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as browser from './productName.js';
import * as server from '../../server/brand/productName.js';
import { stampProductTokens, stampManifest } from '../../build/product-name.js';
import { expandApplicationHtml } from '../../build/application-html.js';

test('defaults are identical on both sides and neutral', () => {
  assert.equal(browser.PRODUCT_NAME_DEFAULT, server.PRODUCT_NAME_DEFAULT);
  assert.equal(browser.PRODUCT_SHORT_NAME_DEFAULT, server.PRODUCT_SHORT_NAME_DEFAULT);
  assert.equal(browser.PRODUCT_TAGLINE_DEFAULT, server.PRODUCT_TAGLINE_DEFAULT);
  assert.equal(browser.PRODUCT_DESCRIPTION_DEFAULT, server.PRODUCT_DESCRIPTION_DEFAULT);
  assert.equal(browser.PRODUCT_NAME_DEFAULT, 'OnDemand Intelligence Workstation');
  assert.doesNotMatch(browser.PRODUCT_NAME_DEFAULT, /Spatial|God's Eye|GEV/);
  assert.ok(browser.PRODUCT_SHORT_NAME_DEFAULT.length <= 12, 'PWA short_name ≤ 12 chars');
});

test('splitProductName renders the last word as the accent', () => {
  assert.deepEqual(browser.splitProductName('OnDemand Intelligence Workstation'), {
    lead: 'OnDemand Intelligence',
    accent: 'Workstation',
  });
  assert.deepEqual(browser.splitProductName('Atlas'), { lead: '', accent: 'Atlas' });
});

test('server identity honours PRODUCT_* env, falls back to VITE_* then defaults', () => {
  assert.equal(server.productIdentity({}).name, 'OnDemand Intelligence Workstation');
  assert.equal(server.productIdentity({ VITE_PRODUCT_NAME: 'Atlas Console' }).name, 'Atlas Console');
  assert.equal(server.productIdentity({ PRODUCT_NAME: 'Atlas', VITE_PRODUCT_NAME: 'x' }).name, 'Atlas');
  assert.equal(server.productIdentity({ PRODUCT_NAME: '   ' }).name, 'OnDemand Intelligence Workstation');
});

test('index.html carries only {{PRODUCT_*}} tokens and stamps to the identity (HTML-escaped)', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /OnDemand Spatial/);
  assert.match(html, /<title>\{\{PRODUCT_NAME\}\}<\/title>/);
  const stamped = stampProductTokens(expandApplicationHtml(html), server.productIdentity({ PRODUCT_NAME: 'A & B "Console"' }));
  assert.match(stamped, /<title>A &amp; B &quot;Console&quot;<\/title>/);
  assert.doesNotMatch(stamped, /\{\{PRODUCT_/);
  // favicons + og image now come from the generated brand set
  assert.match(stamped, /href="\/assets\/brand\/favicon\.ico"/);
  assert.match(stamped, /content="\/assets\/brand\/og-image\.png"/);
});

test('the web manifest is stamped from the identity', () => {
  const src = readFileSync(new URL('../../public/brand/site.webmanifest', import.meta.url), 'utf8');
  const out = JSON.parse(stampManifest(src, server.productIdentity({ PRODUCT_NAME: 'Atlas Console', PRODUCT_SHORT_NAME: 'Atlas' })));
  assert.equal(out.name, 'Atlas Console');
  assert.equal(out.short_name, 'Atlas');
  assert.equal(out.icons[0].src, '/assets/brand/android-chrome-192.png');
});

test('no user-facing legacy brand strings remain in the templates (BRANDING_AUDIT §2 P0)', () => {
  const html = expandApplicationHtml(readFileSync(new URL('../../index.html', import.meta.url), 'utf8'));
  assert.doesNotMatch(html, /God's Eye/);
  assert.doesNotMatch(html, /GEV MIC/);
  assert.doesNotMatch(html, /OnDemand Spatial/);
  assert.match(html, /data-product-wordmark/);
});
