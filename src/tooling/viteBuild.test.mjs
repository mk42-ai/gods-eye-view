import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBrowserViteConfig } from '../../build/vite.js';
import standaloneConfig, * as compatibility from '../../vite.config.js';
import * as providers from '../../server/providers/local.js';

test('explicit build inputs preserve browser-only defines, plugin order and loopback protections', () => {
  const plugin = { name: 'fixture-provider' };
  const config = createBrowserViteConfig({
    plugins: [plugin],
    googleApiKey: 'browser-fixture',
    cesiumToken: 'ion-fixture',
  });
  // cesium, application-html, product-name-tokens (cycle 2, 132fced),
  // gev-build-id (2026-10-24), then providers
  assert.equal(config.plugins[2].name, 'product-name-tokens');
  assert.equal(config.plugins[3].name, 'gev-build-id');
  assert.equal(config.plugins[4], plugin);
  assert.equal(config.server.host, 'localhost');
  assert.equal(config.server.port, 4173);
  assert.deepEqual(config.server.allowedHosts, [
    'localhost',
    '127.0.0.1',
    '.local',
  ]);
  assert.ok(config.server.fs.deny.includes('**/ENVIRONMENT'));
  assert.ok(config.server.fs.deny.includes('.env.*'));
  // The dev/preview server must be embeddable (cycle 8): no X-Frame-Options and no
  // frame-ancestors 'none' on the document the browser loads.
  assert.equal(config.server.headers, undefined);
  assert.deepEqual(config.define, {
    'import.meta.env.GOOGLE_MAPS_API_KEY': '"browser-fixture"',
    'import.meta.env.CESIUM_ION_TOKEN': '"ion-fixture"',
    // Served-revision label (2026-10-24): empty when no build id is given,
    // never derived from the environment inside createBrowserViteConfig.
    'import.meta.env.GEV_BUILD_ID': '""',
  });
  assert.equal(
    createBrowserViteConfig({ buildId: 'abc123def' }).define[
      'import.meta.env.GEV_BUILD_ID'
    ],
    '"abc123def"',
  );
  assert.equal(
    createBrowserViteConfig({ host: '0.0.0.0', port: '4800' }).server
      .allowedHosts,
    true,
  );
  assert.equal(
    createBrowserViteConfig({ host: '::', port: '4800' }).server.port,
    4800,
  );
});

test('build id is stamped into the document and assets are content-hashed', () => {
  const config = createBrowserViteConfig({ buildId: 'abc123def' });
  const plugin = config.plugins.find((p) => p.name === 'gev-build-id');
  const html = plugin.transformIndexHtml.handler(
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n</head></html>',
  );
  assert.match(html, /<html lang="en" data-build="abc123def">/);
  assert.match(html, /<meta name="build-id" content="abc123def" \/>/);
  assert.equal(config.build.emptyOutDir, true);
  assert.equal(
    config.build.rollupOptions.output.entryFileNames,
    'assets/[name]-[hash].js',
  );
  assert.equal(
    config.build.rollupOptions.output.assetFileNames,
    'assets/[name]-[hash][extname]',
  );
});

test('build helper does not discover environment values or construct local providers', () => {
  const before = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'environment-fixture';
  try {
    const config = createBrowserViteConfig();
    assert.equal(
      config.define['import.meta.env.GOOGLE_MAPS_API_KEY'],
      undefined,
    );
    assert.equal(config.plugins.length, 4);
  } finally {
    if (before === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = before;
  }
});

test('root config retains existing named exports and standalone provider order', () => {
  for (const [name, value] of Object.entries(providers))
    assert.equal(compatibility[name], value, name);
  const config = standaloneConfig({ mode: 'test' });
  assert.deepEqual(
    config.plugins.slice(4, -1).map((plugin) => plugin.name),
    providers.localProviderPlugins().map((plugin) => plugin.name),
  );
  assert.equal(config.plugins.at(-2).name, 'gev-key-setup');
  assert.equal(config.plugins.at(-1).name, 'api-not-found');
});

test('build export resolves in Node and has no browser fallback', async () => {
  const exported = await import('ondemand-spatial/build/vite');
  assert.equal(exported.createBrowserViteConfig, createBrowserViteConfig);
  const pkg = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url)),
  );
  assert.deepEqual(pkg.exports['./build/vite'], { node: './build/vite.js' });
});
