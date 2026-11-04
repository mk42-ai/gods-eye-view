import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Parse the TS mirror without a TS toolchain: the value objects are plain
// literals, so strip the `as const` / type-only lines and evaluate them.
const tsSource = readFileSync(new URL('./designTokens.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('./design-tokens.css', import.meta.url), 'utf8');

function literal(name) {
  const match = tsSource.match(new RegExp(`export const ${name} = (\\{[\\s\\S]*?\\}) as const;`));
  assert.ok(match, `${name} literal present in designTokens.ts`);
  return Function(`return (${match[1]});`)();
}

function cssValue(prop) {
  const match = css.match(new RegExp(`--${prop}:\\s*([^;]+);`));
  assert.ok(match, `--${prop} defined in design-tokens.css`);
  return match[1].trim();
}

const kebab = (role) => role.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`);

test('every TS colour role equals its CSS custom property', () => {
  for (const [role, value] of Object.entries(literal('colors'))) {
    assert.equal(cssValue(`ui-${kebab(role)}`), value, role);
  }
});

test('z-index scale matches and is strictly ascending', () => {
  const z = literal('zIndex');
  let previous = -Infinity;
  for (const [role, value] of Object.entries(z)) {
    assert.equal(Number(cssValue(`ui-z-${kebab(role)}`)), value, role);
    assert.ok(value > previous, `${role} above the previous layer`);
    previous = value;
  }
});

test('exactly one chromatic accent hue outside the two status colours', () => {
  const hues = new Set();
  for (const [role, value] of Object.entries(literal('colors'))) {
    if (role === 'success' || role === 'error') continue;
    const hex = value.startsWith('#') ? value.slice(1) : null;
    const rgb = hex
      ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
      : value.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const [r, g, b] = rgb.map((v) => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    if (s < 0.12) continue; // neutral
    let h;
    if (max === r) h = ((g - b) / (max - min)) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    hues.add(Math.round(((h * 60 + 360) % 360) / 4)); // 4° buckets
  }
  assert.equal(hues.size, 1, `one accent hue, saw buckets ${[...hues]}`);
});

test('the telemetry monospace is the only mono family and sans is Inter-first', () => {
  const fonts = literal('fonts');
  assert.match(fonts.sans, /^'Inter'/);
  assert.match(fonts.mono, /^'JetBrains Mono'/);
  assert.equal(cssValue('ui-font-sans'), fonts.sans);
  assert.equal(cssValue('ui-font-mono'), fonts.mono);
});
