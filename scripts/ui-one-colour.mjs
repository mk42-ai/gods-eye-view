#!/usr/bin/env node
/**
 * One-colour codemod for the workstation chrome (cycle 21, 2026-10-30).
 *
 *   node scripts/ui-one-colour.mjs            # rewrite src/ui/styles/*.css in place
 *   node scripts/ui-one-colour.mjs --check    # report remaining chromatic literals, exit 1 if any
 *
 * Maps every chromatic colour literal in the chrome stylesheets onto the single
 * design-token system in src/brand/design-tokens.css:
 *   - glows (box-shadow / text-shadow / drop-shadow layers with a chromatic colour) → removed
 *   - decorative gradients → their chromatic stops become neutral greys (alpha kept)
 *   - teal / cyan / mint / green / blue hues → the ONE accent (#3BB795) when the rule is an
 *     interactive state (active / selected / checked / hover / focus / pressed / link / primary
 *     action), otherwise the neutral ramp at the same lightness and alpha
 *   - red hues → --ui-error, only on error / failure selectors, neutral elsewhere
 *   - "ready / success / verified" selectors → --ui-success
 *   - amber / orange / yellow / purple → neutral (they are not part of the palette)
 * DATA colours are skipped on purpose: legend swatches, map markers, layer dots, severity /
 * category chips, and the immersive cockpit + Bhote Koshi event stylesheets.
 * Uses postcss (already installed as a Vite dependency) — no network, no new package.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STYLE_DIR = path.join(ROOT, 'src/ui/styles');
const SKIP_FILES = new Set(['cockpit.css', 'bhote-koshi.css']);
const DATA_SELECTOR = /swatch|legend|marker|severity|category|-dot\b|\.dot\b|layer-color|data-color|track-color|heat|ironbow|thermal|cable-|transit-line|route-line|mission-replay|celestial/i;
const STATE_SELECTOR = /active|selected|checked|:hover|:focus|pressed|aria-current|\bcurrent\b|\blink\b|\ba\b|primary|submit|\.on\b|\[data-state=['"]?(on|open)|:checked|open\]|is-open|\bplay\b/i;
const SUCCESS_SELECTOR = /ready|success|verified|\bok\b|healthy|connected|\blive\b/i;
const ERROR_SELECTOR = /error|fail|danger|invalid|alert|offline|denied|broken|expired|refus/i;
const COLOR_PROPS = /^(color|background|background-color|background-image|border|border-(top|right|bottom|left)(-color)?|border-color|border-(block|inline)(-start|-end)?(-color)?|outline|outline-color|fill|stroke|accent-color|caret-color|text-decoration-color|column-rule-color|box-shadow|text-shadow|filter|-webkit-text-stroke|-webkit-text-fill-color|scrollbar-color|--.*)$/i;

const ACCENT = [59, 183, 149];
const ERROR = [229, 96, 90];
const SUCCESS = [91, 191, 127];

const COLOR_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\(\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*(?:[,/]\s*[\d.]+%?\s*)?\)|hsla?\([^)]*\)/gi;

function parse(literal) {
  let r, g, b, a = 1;
  if (literal.startsWith('#')) {
    let hex = literal.slice(1);
    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
    [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16) / 255;
  } else if (/^rgb/i.test(literal)) {
    const nums = literal.match(/[\d.]+%?/g);
    [r, g, b] = nums.slice(0, 3).map((n) => (n.endsWith('%') ? (parseFloat(n) * 255) / 100 : parseFloat(n)));
    if (nums[3] !== undefined) a = nums[3].endsWith('%') ? parseFloat(nums[3]) / 100 : parseFloat(nums[3]);
  } else return null; // hsl() is not used in these sheets; leave untouched
  return { r, g, b, a };
}

function hsl({ r, g, b }) {
  const [R, G, B] = [r, g, b].map((v) => v / 255);
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

const fmt = ([r, g, b], a) => (a >= 0.999 ? `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}` : `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${+a.toFixed(3)})`);
const neutral = (l, a) => {
  const v = Math.round(Math.min(242, Math.max(14, l * 255)));
  return fmt([v, v + 1, v + 2].map((x) => Math.min(255, x)), a);
};
const isChromatic = (c) => hsl(c).s >= 0.12 && hsl(c).l > 0.06 && hsl(c).l < 0.97;

function mapColor(literal, { prop, selector, inShadow, inGradient }) {
  const c = parse(literal);
  if (!c || !isChromatic(c)) return literal;
  const { h, l } = hsl(c);
  if (inShadow) return 'transparent';
  if (inGradient) return neutral(Math.max(l, 0.5), Math.min(c.a, 0.18));
  const isText = /^(color|-webkit-text-fill-color|fill|stroke|caret-color)$/i.test(prop);
  const isBorder = /border|outline|column-rule/i.test(prop);
  const isBg = /background/i.test(prop);
  const red = h < 15 || h >= 330;
  const coolOrGreen = h >= 65 && h < 250;
  if (l < 0.2) return neutral(l, c.a); // near-black navy grounds → neutral
  if (red) return ERROR_SELECTOR.test(selector) ? fmt(ERROR, c.a) : neutral(isText ? 0.72 : l, c.a);
  if (SUCCESS_SELECTOR.test(selector) && coolOrGreen && h < 175 && !STATE_SELECTOR.test(selector)) return fmt(SUCCESS, c.a);
  if (ERROR_SELECTOR.test(selector) && (isText || isBorder)) return fmt(ERROR, c.a);
  if (coolOrGreen) {
    if (STATE_SELECTOR.test(selector)) return fmt(ACCENT, c.a);
    if (isBg && c.a >= 0.9 && hsl(c).s > 0.35 && l > 0.3 && l < 0.7) return fmt(ACCENT, c.a); // solid accent fill (primary button)
    if (l > 0.85) return neutral(0.93, c.a);
    if (isText) return neutral(0.74, c.a);
    if (isBorder) return neutral(0.6, Math.min(c.a, 0.22));
    return neutral(0.6, Math.min(c.a, 0.12));
  }
  // amber / orange / yellow / purple: not in the palette
  if (isText) return neutral(0.74, c.a);
  if (isBorder) return neutral(0.6, Math.min(c.a, 0.22));
  return neutral(0.6, Math.min(c.a, 0.12));
}

/** Rewrite one declaration value, tracking whether a colour sits inside a gradient. */
function rewriteValue(value, ctx) {
  const shadowProp = /^(box-shadow|text-shadow)$/i.test(ctx.prop) || /drop-shadow/i.test(value) && /^filter$/i.test(ctx.prop);
  let out = '';
  let i = 0;
  const gradientRanges = [];
  const gre = /(?:repeating-)?(?:linear|radial|conic)-gradient\(/gi;
  let m;
  while ((m = gre.exec(value))) {
    let depth = 0;
    let j = m.index + m[0].length - 1;
    for (; j < value.length; j += 1) {
      if (value[j] === '(') depth += 1;
      else if (value[j] === ')') { depth -= 1; if (depth === 0) break; }
    }
    gradientRanges.push([m.index, j]);
  }
  value.replace(COLOR_RE, (lit, offset) => {
    out += value.slice(i, offset);
    // A literal that is only the fallback of a var() keeps its value: the token wins at runtime.
    const before = value.slice(0, offset);
    const varOpen = before.lastIndexOf('var(');
    if (varOpen !== -1 && before.indexOf(')', varOpen) === -1 && /,\s*$/.test(before.slice(varOpen))) {
      out += lit;
      i = offset + lit.length;
      return lit;
    }
    const inGradient = gradientRanges.some(([s, e]) => offset > s && offset < e);
    // Any chromatic colour in a shadow layer is a glow: drop it (neutral black shadows stay).
    out += mapColor(lit, { ...ctx, inGradient, inShadow: shadowProp });
    i = offset + lit.length;
    return lit;
  });
  return out + value.slice(i);
}

function transform(css, file) {
  const root = postcss.parse(css, { from: file });
  let changes = 0;
  root.walkDecls((decl) => {
    const prop = decl.prop;
    if (!COLOR_PROPS.test(prop)) return;
    const rule = decl.parent;
    const selector = rule?.selector || (rule?.parent?.selector ?? '');
    if (DATA_SELECTOR.test(selector)) return;
    if (prop.startsWith('--') && DATA_SELECTOR.test(prop)) return;
    const next = rewriteValue(decl.value, { prop: prop.startsWith('--') ? guessPropFromName(prop) : prop, selector });
    if (next !== decl.value) { decl.value = next; changes += 1; }
  });
  return { css: root.toString(), changes };
}

function guessPropFromName(name) {
  if (/glow|shadow/i.test(name)) return 'box-shadow';
  if (/border/i.test(name)) return 'border-color';
  if (/bg|background|surface|fill/i.test(name)) return 'background';
  return 'color';
}

function report(css, file) {
  const root = postcss.parse(css, { from: file });
  const hits = [];
  root.walkDecls((decl) => {
    if (!COLOR_PROPS.test(decl.prop)) return;
    const selector = decl.parent?.selector || '';
    if (DATA_SELECTOR.test(selector)) return;
    const bare = decl.value.replace(/var\(\s*--[\w-]+\s*,[^()]*\)/g, '');
    for (const lit of bare.match(COLOR_RE) || []) {
      const c = parse(lit);
      if (!c || !isChromatic(c)) continue;
      const { h } = hsl(c);
      const isAccent = Math.abs(h - 163.5) < 4;
      const isStatus = [ERROR, SUCCESS].some(([r, g, b]) => Math.round(c.r) === r && Math.round(c.g) === g && Math.round(c.b) === b);
      if (!isAccent && !isStatus) hits.push(`${path.basename(file)} ${selector} { ${decl.prop}: ${lit} }`);
    }
  });
  return hits;
}

const check = process.argv.includes('--check');
let total = 0;
const remaining = [];
for (const name of readdirSync(STYLE_DIR).sort()) {
  if (!name.endsWith('.css') || SKIP_FILES.has(name)) continue;
  const file = path.join(STYLE_DIR, name);
  const css = readFileSync(file, 'utf8');
  if (check) { remaining.push(...report(css, file)); continue; }
  const { css: next, changes } = transform(css, file);
  if (changes) { writeFileSync(file, next); total += changes; console.log(`${name}: ${changes} declaration(s) rewritten`); }
}
if (check) {
  console.log(remaining.length ? remaining.join('\n') : 'one-colour check: no off-palette chromatic literals in chrome stylesheets');
  process.exit(remaining.length ? 1 : 0);
} else console.log(`total: ${total} declaration(s) rewritten`);
