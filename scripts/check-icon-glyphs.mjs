#!/usr/bin/env node
/**
 * Boundary gate: UI source must carry no emoji or icon-glyph code points.
 *
 *   node scripts/check-icon-glyphs.mjs          # part of `npm run check:boundaries`
 *
 * Scans every non-test `src/**` JS/MJS/CJS/HTML/CSS file, `index.html`,
 * `style.css` and `public/*.html` for the ranges below — as literal
 * characters, as HTML numeric entities (`&#x1F6F0;`) and as JS escapes
 * (`\u{1F6F0}`, surrogate pairs, `\u25B2`). A hit is a glyph pretending to
 * be an icon; the inline Lucide set (src/ui/icons/layerIcon.js) is the only
 * sanctioned way to draw one. `src/iconGlyphBoundary.test.mjs` runs the same
 * scanner under node:test and adds the rendered-DOM checks.
 *
 * Retained on purpose (never flagged): typography such as `·` `—` `…` `°`,
 * `×` as a multiplication sign, arrows in prose/comments, and the `▍` typing
 * caret (Block Elements) — see docs/brand/ICON_SOURCE.md §5.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN_BLOCKS = Object.freeze([
  Object.freeze({
    label: 'U+1F000-U+1FAFF emoji (incl. regional indicators U+1F1E6-U+1F1FF)',
    from: 0x1f000,
    to: 0x1faff,
  }),
  Object.freeze({
    label: 'U+2600-U+27BF misc symbols & dingbats',
    from: 0x2600,
    to: 0x27bf,
  }),
  Object.freeze({
    label: 'U+2B00-U+2BFF misc symbols and arrows',
    from: 0x2b00,
    to: 0x2bff,
  }),
  Object.freeze({ label: 'U+FE0F variation selector-16', from: 0xfe0f, to: 0xfe0f }),
  Object.freeze({ label: 'U+200D zero width joiner', from: 0x200d, to: 0x200d }),
  Object.freeze({
    label: 'U+25A0-U+25FF geometric shapes',
    from: 0x25a0,
    to: 0x25ff,
  }),
  Object.freeze({
    label: 'U+2300-U+23FF miscellaneous technical',
    from: 0x2300,
    to: 0x23ff,
  }),
  Object.freeze({
    label: 'U+2160-U+216F roman numerals used as glyphs',
    from: 0x2160,
    to: 0x216f,
  }),
  Object.freeze({ label: 'U+224B triple tilde', from: 0x224b, to: 0x224b }),
]);

const UI_EXTENSIONS = /\.(?:js|mjs|cjs|html|css)$/;
const ENTITY = /&#(x[0-9a-f]+|[0-9]+);/gi;
const JS_ESCAPE =
  /\\u\{([0-9a-f]{1,6})\}|\\u(d83[0-9a-f])\\u(d[c-f][0-9a-f]{2})|\\u([0-9a-f]{4})/gi;

/** The forbidden block a code point falls in, or undefined. */
export function forbiddenBlock(codePoint) {
  return FORBIDDEN_BLOCKS.find(
    ({ from, to }) => codePoint >= from && codePoint <= to,
  );
}

/** Every forbidden occurrence in `text` as `line:col <what> (<block>)`. */
export function findForbiddenGlyphs(text) {
  const hits = [];
  const hex = (codePoint) =>
    `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
  text.split('\n').forEach((line, index) => {
    let column = 0;
    for (const character of line) {
      column += 1;
      const codePoint = character.codePointAt(0);
      const block = forbiddenBlock(codePoint);
      if (block)
        hits.push(`${index + 1}:${column} ${hex(codePoint)} (${block.label})`);
    }
    for (const match of line.matchAll(ENTITY)) {
      const value = match[1];
      const codePoint = /^x/i.test(value)
        ? Number.parseInt(value.slice(1), 16)
        : Number.parseInt(value, 10);
      const block = forbiddenBlock(codePoint);
      if (block)
        hits.push(
          `${index + 1}:${match.index + 1} entity ${match[0]} (${block.label})`,
        );
    }
    for (const match of line.matchAll(JS_ESCAPE)) {
      let codePoint;
      if (match[1]) codePoint = Number.parseInt(match[1], 16);
      else if (match[2])
        codePoint =
          (Number.parseInt(match[2], 16) - 0xd800) * 0x400 +
          (Number.parseInt(match[3], 16) - 0xdc00) +
          0x10000;
      else codePoint = Number.parseInt(match[4], 16);
      const block = forbiddenBlock(codePoint);
      if (block)
        hits.push(
          `${index + 1}:${match.index + 1} escape ${match[0]} (${block.label})`,
        );
    }
  });
  return hits;
}

/** UI source files under `root`, sorted, tests excluded. */
export function uiSourceFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (
        entry.isFile() &&
        UI_EXTENSIONS.test(entry.name) &&
        !/\.test\.mjs$/.test(entry.name)
      )
        files.push(absolute);
    }
  };
  visit(path.join(root, 'src'));
  for (const file of ['index.html', 'style.css'])
    files.push(path.join(root, file));
  const publicRoot = path.join(root, 'public');
  for (const entry of readdirSync(publicRoot, { withFileTypes: true })) {
    if (entry.isFile() && /\.html$/.test(entry.name))
      files.push(path.join(publicRoot, entry.name));
  }
  return files.sort();
}

/**
 * Scan the repository. Returns `{ files, offenders }` where each offender is
 * `<repo-relative file>:<line>:<col> <what> (<block>)`.
 */
export function checkIconGlyphs(root) {
  const files = uiSourceFiles(root);
  const offenders = [];
  for (const file of files) {
    for (const hit of findForbiddenGlyphs(readFileSync(file, 'utf8')))
      offenders.push(`${path.relative(root, file).split(path.sep).join('/')}:${hit}`);
  }
  return { files: files.length, offenders };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { files, offenders } = checkIconGlyphs(root);
  if (offenders.length) {
    console.error(
      `Emoji / glyph icons in UI source (use src/ui/icons/layerIcon.js):\n${offenders.join('\n')}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify({ iconGlyphScan: 'clean', files, blocks: FORBIDDEN_BLOCKS.length }),
    );
  }
}
