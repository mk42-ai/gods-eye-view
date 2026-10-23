import { test, expect } from '@playwright/test';
import {
  gotoApp,
  buildPrompt,
  waitStage,
  collectMedia,
  installFixtureRoutes,
  attachAndSaveScreenshot,
} from './_helpers.mjs';

test.describe('04 outside-register', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'Desktop only'); });

  test('prompts registration modal for places outside register, handles decline and accept', async ({ page }, testInfo) => {
    await installFixtureRoutes(page);
    await gotoApp(page);

    const mediaRequests = collectMedia(page);

    // 1. Build prompt with place outside register (Lisbon)
    await buildPrompt(page, 'Lisbon');

    // Expect #ge-register-modal visible
    const modal = page.locator('#ge-register-modal');
    await expect(modal).toBeVisible({ timeout: 15_000 });

    // Click #ge-reg-decline
    const declineBtn = page.locator('#ge-reg-decline');
    await declineBtn.click();
    await expect(modal).toBeHidden({ timeout: 10_000 });

    // Assert 0 footage/media requests and no scene created
    expect(mediaRequests.length).toBe(0);
    const sceneCountAfterDecline = await page.evaluate(() => {
      const list = window.__godsEye?.listScenes?.() || [];
      return list.length;
    });
    expect(sceneCountAfterDecline).toBe(0);

    // 2. Build prompt 'Lisbon' again
    await buildPrompt(page, 'Lisbon');
    await expect(modal).toBeVisible({ timeout: 15_000 });

    // Fill nothing (use defaults), click #ge-reg-accept
    const acceptBtn = page.locator('#ge-reg-accept');
    await acceptBtn.click();
    await expect(modal).toBeHidden({ timeout: 10_000 });

    // Scene builds: wait for at least S2 or S4
    await waitStage(page, 'S2', 25_000);

    // Assert window.__godsEye.listScenes() has a Lisbon scene with aoi.inRegister === true
    const lisbonScene = await page.evaluate(() => {
      const list = window.__godsEye?.listScenes?.() || [];
      return list.find(
        (s) =>
          String(s.target?.name || '').toLowerCase().includes('lisbon') ||
          String(s.title || '').toLowerCase().includes('lisbon') ||
          String(s.prompt || '').toLowerCase().includes('lisbon')
      );
    });

    expect(lisbonScene).toBeTruthy();
    expect(lisbonScene.aoi?.inRegister).toBe(true);

    await attachAndSaveScreenshot(page, testInfo, '04-outside-register');
  });
});
