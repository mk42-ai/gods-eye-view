import { test, expect } from '@playwright/test';
import {
  gotoApp,
  buildPrompt,
  waitStage,
  installFixtureRoutes,
  saveJson,
  attachAndSaveScreenshot,
} from './_helpers.mjs';

test.describe('18 bundle-secret-scan', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop only'); });

  test('scans frontend scripts for exposed secrets and ensures zero unexpected console/page errors', async ({
    page,
  }, testInfo) => {
    const consoleErrors = [];
    const pageErrors = [];

    // Filter out known benign errors
    const isBenign = (msg) => {
      return /favicon|ERR_BLOCKED_BY_CLIENT|Failed to obtain image tile|third-party|embed/i.test(msg);
    };

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const url = msg.location?.()?.url || msg.location?.url || '';
        // Third-party tile/CDN responses (ArcGIS 429 rate limits, NASA GIBS,
        // Google 3D tiles, YouTube/Instagram embeds) are network noise from
        // hosts we do not control, not application errors. Our own origin's
        // failures (the preview host, /footage/*) are kept.
        const thirdParty =
          /arcgis|gibs\.earthdata|googleapis|gstatic|youtube|ytimg|instagram|cdninstagram|tiktok|tile\.openstreetmap|nominatim/i.test(url) ||
          (/Failed to load resource/i.test(text) && url && !url.includes(new URL(page.url()).host));
        if (!isBenign(text) && !thirdParty) {
          consoleErrors.push({ text, url });
        }
      }
    });

    page.on('pageerror', (err) => {
      const text = err.message || String(err);
      if (!isBenign(text)) {
        pageErrors.push(text);
      }
    });

    await installFixtureRoutes(page);
    await gotoApp(page);

    // Collect all script src and modulepreload links from document
    const assetUrls = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[src]')).map((s) => s.src);
      const preloads = Array.from(
        document.querySelectorAll('link[rel=modulepreload][href], link[rel=preload][as=script][href]')
      ).map((l) => l.href);
      return Array.from(new Set([...scripts, ...preloads])).filter(Boolean);
    });

    // The live server key is read from the runner's environment (never from
    // the repo) so the scan can assert the exact value is absent too.
    const liveKey = (process.env.ONDEMAND_API_KEY || '').trim();
    const liveKeyPattern =
      liveKey.length >= 16 ? liveKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '|' : '';
    const secretRegex = new RegExp(
      liveKeyPattern +
        'ONDEMAND_API_KEY=|apikey["\']?\\s*:\\s*["\'][A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|vcp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{30,}',
    );

    const matchedSecrets = [];

    for (const url of assetUrls) {
      try {
        const res = await page.request.get(url);
        if (res.ok()) {
          const body = await res.text();
          const match = secretRegex.exec(body);
          if (match) {
            matchedSecrets.push({
              url,
              match: match[0],
            });
          }
        }
      } catch (err) {
        // Skip assets that cannot be reached offline
      }
    }

    // Execute complete Burj Khalifa build
    await buildPrompt(page, 'Burj Khalifa');
    await waitStage(page, 'S4', 60_000);

    // Save scan artifacts
    await saveJson('report/console-18.json', {
      consoleErrors,
      pageErrors,
    });

    await saveJson('report/bundle-scan-18.json', {
      scannedCount: assetUrls.length,
      scannedUrls: assetUrls,
      matchedSecrets,
    });

    // Assert no leaked credentials found
    expect(matchedSecrets).toHaveLength(0);

    // Assert zero unexpected console and page errors
    expect(consoleErrors).toHaveLength(0);
    expect(pageErrors).toHaveLength(0);

    await attachAndSaveScreenshot(page, testInfo, '18-bundle-secret-scan');
  });
});
