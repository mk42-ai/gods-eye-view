import { test, expect } from '@playwright/test';
import {
  gotoApp,
  collectMedia,
  countVideos,
  installFixtureRoutes,
  saveJson,
  attachAndSaveScreenshot,
} from './_helpers.mjs';

test.describe('01 load-no-prompt', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop only'); });

  test('loads share hash without prompt and stays zero-network with no media or cards', async ({ page }, testInfo) => {
    await installFixtureRoutes(page);
    const mediaRequests = collectMedia(page);

    const shareHash =
      'v=2&lat=13.9425&lon=48.9231&alt=712168&heading=0&pitch=-55&roll=360&style=normal&hud=tactical&hv=1&dm=OFF&dd=50&da=elastic&kf=7&ko=1&cr=0&sc=1&scf=11&map=esri-imagery&l=&lo=f.e.1&ui=c.c.1_c.p.0_l.c.1_l.p.0_d.c.1_v.c.1_r.c.1_s.c.0_g.c.1_p.c.1_m.c.0';

    await gotoApp(page, { hash: shareHash, query: 'fixtures=1' });

    // Wait 8 seconds as required by spec
    await page.waitForTimeout(8000);

    // Pan the globe via mouse drag on canvas
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 10_000 });
    const bbox = await canvas.boundingBox();
    if (bbox) {
      const startX = bbox.x + bbox.width / 2;
      const startY = bbox.y + bbox.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 120, startY + 80, { steps: 5 });
      await page.mouse.up();
    }

    await page.waitForTimeout(1000);

    // Assert 0 media/footage requests
    expect(mediaRequests.length).toBe(0);

    // Assert 0 <video> elements
    const videoCount = await countVideos(page);
    expect(videoCount).toBe(0);

    // Assert #ge-rail hidden or absent
    const rail = page.locator('#ge-rail');
    const railCount = await rail.count();
    if (railCount > 0) {
      const isHidden = (await rail.isHidden()) || (await rail.getAttribute('hidden')) !== null;
      expect(isHidden).toBe(true);
    }

    // Assert geStage is ''
    const geStage = await page.evaluate(() => document.documentElement.dataset.geStage || '');
    expect(geStage).toBe('');

    // Save network log to tests/report/network-01.json
    await saveJson('report/network-01.json', mediaRequests);

    // Attach and save screenshot
    await attachAndSaveScreenshot(page, testInfo, '01-load-no-prompt');
  });
});
