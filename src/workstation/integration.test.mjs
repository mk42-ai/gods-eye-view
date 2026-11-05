import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('./workstation.css', import.meta.url), 'utf8');
test('one responsive workstation provides acceptance panels and a multiline explicit composer', () => {
  for (const id of ['aoi', 'evidence', 'camera', 'outliner', 'properties']) {
    assert.match(html, new RegExp(`id="ws-${id}"`));
    assert.match(html, new RegExp(`data-panel="${id}"`));
  }
  assert.match(html, /<textarea\b[^>]*\bid="ws-prompt"/);
  assert.equal((html.match(/id="ws-prompt-form"/g) || []).length, 1);
  assert.doesNotMatch(html, /legacy\.html|cesiumContainer|data-mode="wire"/);
  assert.match(html, /OnDemand/);
  assert.match(css, /\.ws-panel\.is-open/);
});
test('no query-string auto build, CSS screenshot navigation, or unchecked live-camera fallback', () => {
  assert.doesNotMatch(
    main,
    /params\.get\('build'\)\s*===|buildBtn\.click|setInterval\(.*build/,
  );
  assert.match(main, /e\.ctrlKey \|\| e\.metaKey/);
  assert.match(main, /form\.requestSubmit\(\)/);
  assert.doesNotMatch(css, /filter\s*:|\.ws-frame[^}]*transform/);
  assert.match(main, /x-cctv-source/);
  assert.match(main, /upstream-image/);
  assert.doesNotMatch(main, /Math\.random/);
});
test('browser boundary commits decoded nodes atomically; retains frames until replacement', () => {
  assert.match(main, /decodeAndCommit\(/);
  assert.match(main, /frameSlot\.replaceChildren\(image\)/);
  assert.doesNotMatch(
    main,
    /frameSlot\.replaceChildren\(\)|\.src\s*=\s*frameUrl/,
  );
  assert.match(main, /event\('frame-presented'/);
  assert.match(main, /performanceMs: performance\.now/);
  assert.match(main, /utc: new Date\(\)\.toISOString/);
});
test('all DOM selectors referenced by main exist in the unified HTML shell', () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  for (const match of main.matchAll(/\$\('#([\w-]+)'\)/g))
    assert.ok(ids.has(match[1]), `Missing #${match[1]}`);
});
