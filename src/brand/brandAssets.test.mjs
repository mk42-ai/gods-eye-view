import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const BRAND_ASSET_FILES = [
  'mark-primary.png',
  'mark-mono.png',
  'empty-no-results.png',
  'empty-no-sessions.png',
  'empty-source-unavailable.png',
  'backdrop-network.png',
  'mark-variant-a.png',
  'mark-variant-b.png',
  'favicon.ico',
  'favicon-16.png',
  'favicon-32.png',
  'favicon-48.png',
  'apple-touch-icon.png',
  'android-chrome-192.png',
  'android-chrome-512.png',
  'og-image.png',
];

describe('Brand assets inventory and head wiring', () => {
  test('every file in the BRAND_ASSETS table exists under public/assets/brand with size > 0', () => {
    const brandDir = new URL('../../public/assets/brand', import.meta.url)
      .pathname;
    for (const filename of BRAND_ASSET_FILES) {
      const filePath = join(brandDir, filename);
      const stat = statSync(filePath);
      assert.ok(stat.isFile(), `${filename} must be a file`);
      assert.ok(stat.size > 0, `${filename} must have non-zero size`);
    }
  });

  test('docs/agent-execution/BRAND_ASSETS.md lists all files and contains 2026-10-21 verification', () => {
    const mdPath = new URL(
      '../../docs/agent-execution/BRAND_ASSETS.md',
      import.meta.url,
    ).pathname;
    const content = readFileSync(mdPath, 'utf8');
    for (const filename of BRAND_ASSET_FILES) {
      assert.ok(
        content.includes(filename),
        `BRAND_ASSETS.md must mention ${filename}`,
      );
    }
    assert.ok(
      content.includes('Verified 2026-10-21'),
      'BRAND_ASSETS.md must include Verified 2026-10-21 section',
    );
  });

  test("index.html's head references favicon and manifest", () => {
    const htmlPath = new URL('../../index.html', import.meta.url).pathname;
    const html = readFileSync(htmlPath, 'utf8');
    const headMatch = html.match(/<head>([\s\S]*?)<\/head>/i);
    assert.ok(headMatch, 'index.html must have a <head>');
    const head = headMatch[1];

    // Favicon references
    assert.match(
      head,
      /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["'][^"']*favicon\.ico["']/i,
      'head must link favicon.ico',
    );
    assert.match(
      head,
      /<link[^>]+rel=["']icon["'][^>]+href=["'][^"']*favicon-16\.png["']/i,
      'head must link favicon-16.png',
    );
    assert.match(
      head,
      /<link[^>]+rel=["']icon["'][^>]+href=["'][^"']*favicon-32\.png["']/i,
      'head must link favicon-32.png',
    );
    assert.match(
      head,
      /<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["'][^"']*apple-touch-icon\.png["']/i,
      'head must link apple-touch-icon.png',
    );

    // Manifest reference
    assert.match(
      head,
      /<link[^>]+rel=["']manifest["'][^>]+href=["'][^"']*site\.webmanifest["']/i,
      'head must link site.webmanifest',
    );

    // Social image reference
    assert.match(
      head,
      /<meta[^>]+property=["']og:image["'][^>]+content=["'][^"']*og-image\.png["']/i,
      'head must define og:image meta',
    );
  });

  test('no /fallbacks/ URL path appears in src/ or index.html', () => {
    const rootDir = resolve(new URL('../../', import.meta.url).pathname);
    const srcDir = join(rootDir, 'src');
    const indexHtml = join(rootDir, 'index.html');

    function scanFiles(dir, fileList = []) {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          scanFiles(full, fileList);
        } else if (entry.isFile()) {
          fileList.push(full);
        }
      }
      return fileList;
    }

    const files = [...scanFiles(srcDir), indexHtml];
    const urlPattern =
      /["'`](?:\/[a-zA-Z0-9_.-]*)*\/fallbacks(?:\/[a-zA-Z0-9_.-]*)?["'`]/;
    const pathPattern = /\/fallbacks\//;

    for (const file of files) {
      if (file.endsWith('brandAssets.test.mjs')) continue;
      const content = readFileSync(file, 'utf8');
      assert.doesNotMatch(
        content,
        pathPattern,
        `File ${file} must not contain a /fallbacks/ URL path`,
      );
      assert.doesNotMatch(
        content,
        urlPattern,
        `File ${file} must not contain a /fallbacks URL reference`,
      );
    }
  });
});
