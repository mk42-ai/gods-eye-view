import { expandApplicationHtml } from '../build/application-html.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = expandApplicationHtml(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
const parameters = readFileSync(new URL('./ui/styleParameters.js', import.meta.url), 'utf8');

// Focused markup guards; actual computed names are checked in Chromium.
// Native labels and hidden inputs must not be treated as missing aria-labels.
test('HUD sliders and location search have descriptive explicit names', () => {
  for (const [id, name] of [
    ['scope-feather-slider', 'Scope edge feather'],
    ['bloom-intensity-slider', 'Bloom intensity'],
    ['sharpen-intensity-slider', 'Sharpen intensity'],
    ['location-search', 'Search location by name or coordinates'],
  ]) {
    const input = html.match(new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];
    assert.ok(input, `${id} exists`);
    assert.ok(input.includes(`aria-label="${name}"`), `${id} has its descriptive name`);
  }
});

test('the walkthrough "Don\'t show this again" checkbox keeps a native visible label', () => {
  // Cycle 21: the first-run modal was replaced by the Driver.js walkthrough.
  const module = readFileSync(new URL('./ui/walkthrough.js', import.meta.url), 'utf8');
  assert.match(module, /gev-tour__dismiss/);
  assert.match(module, /Don't show this again/);
});

test('generated style sliders use the visible parameter label as their name', () => {
  assert.match(parameters, /label\.textContent\s*=\s*metadata\.label;/);
  assert.match(parameters, /slider\.setAttribute\(['"]aria-label['"],\s*metadata\.label\)/);
});
