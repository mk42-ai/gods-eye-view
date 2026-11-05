import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasIcon, iconMarkup, iconNames, LUCIDE_VERSION } from './layerIcon.js';
import { LUCIDE_PACKAGE_VERSION } from './lucideNodes.js';
import { platformLogoMarkup, createPlatformLogo, PLATFORM_LOGOS } from './platformLogos.js';
import { siTiktok, siInstagram, siX, siSnapchat } from 'simple-icons';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

test('every manifest name and every extra name resolves via hasIcon', () => {
  const manifest = JSON.parse(readFileSync(path.join(THIS_DIR, 'lucide-manifest.json'), 'utf8'));
  const extra = [
    'x', 'play', 'pause', 'refresh-cw', 'rotate-ccw', 'chevron-down', 'chevron-up',
    'chevron-left', 'chevron-right', 'circle-help', 'mic', 'mic-off', 'save',
    'map-pin', 'clapperboard', 'film', 'puzzle', 'panel-left-close', 'panel-left-open',
    'external-link', 'clock', 'check', 'triangle-alert', 'loader-circle', 'eye',
    'eye-off', 'link', 'layers', 'search',
  ];

  for (const item of manifest.icons) {
    assert.equal(hasIcon(item.name), true, `manifest icon "${item.name}" should resolve via hasIcon`);
  }
  for (const name of extra) {
    assert.equal(hasIcon(name), true, `extra icon "${name}" should resolve via hasIcon`);
  }
});

test('iconMarkup output contains stroke="currentColor" and no fill colour other than none', () => {
  const names = iconNames();
  assert.ok(names.length >= 88);

  for (const name of names) {
    const markup = iconMarkup(name);
    assert.match(markup, /stroke="currentColor"/, `${name} lacks stroke="currentColor"`);
    const fillMatches = [...markup.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]);
    for (const fill of fillMatches) {
      assert.equal(fill, 'none', `${name} has fill="${fill}" which is not "none"`);
    }
  }
});

test('lucideNodes.js source contains no import * and imports from lucide by name', () => {
  const source = readFileSync(path.join(THIS_DIR, 'lucideNodes.js'), 'utf8');
  assert.doesNotMatch(source, /import\s+\*\s+as/, 'must not contain import * as');
  assert.match(source, /from\s+['"]lucide['"]/, "must import from 'lucide'");
  assert.doesNotMatch(source, /\bicons\./, 'must not use icons object from lucide');
  assert.equal(LUCIDE_VERSION, LUCIDE_PACKAGE_VERSION, 'LUCIDE_VERSION must match package version');
});

test('platformLogoMarkup uses fill="currentColor" and contains none of the brand hex values', () => {
  const brands = [
    { key: 'tiktok', icon: siTiktok },
    { key: 'instagram', icon: siInstagram },
    { key: 'x', icon: siX },
    { key: 'snapchat', icon: siSnapchat },
  ];

  for (const { key, icon } of brands) {
    const markup = platformLogoMarkup(key);
    assert.ok(markup.length > 0, `platformLogoMarkup("${key}") returned empty string`);
    assert.match(markup, /fill="currentColor"/, `${key} logo must have fill="currentColor"`);
    if (icon.hex !== '000000') {
      assert.doesNotMatch(markup, new RegExp(icon.hex, 'i'), `${key} logo must not contain brand hex ${icon.hex}`);
    }
    assert.match(markup, new RegExp(`class="od-platform-logo od-platform-logo--${key}"`));
  }
});

test('platformLogoMarkup returns empty string and createPlatformLogo returns null for unknown platform', () => {
  assert.equal(platformLogoMarkup('unknown'), '');
  assert.equal(platformLogoMarkup('youtube'), '');
  assert.equal(platformLogoMarkup(''), '');

  const fakeDoc = {
    createElementNS: () => ({ setAttribute() {}, appendChild() {} }),
  };
  assert.equal(createPlatformLogo('unknown', {}, fakeDoc), null);
  assert.equal(createPlatformLogo('youtube', {}, fakeDoc), null);
  assert.equal(createPlatformLogo('tiktok', {}, null), null);
});
