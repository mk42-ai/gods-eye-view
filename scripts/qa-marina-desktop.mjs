/**
 * Desktop Marina E2E implementation. Import from the coordinator's Puppeteer
 * harness; importing this module never launches a browser or runs a test.
 *
 * await runDesktop(page, { url: previewUrl, out: proofDirectory, record: [] });
 *
 * All application mutations use real mouse/keyboard input. Page evaluation and
 * waitForFunction callbacks only read the DOM, composer, director and camera.
 * The caller owns browser/page creation, isolation, overall timeout and cleanup.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const QUERY = 'Create a waterfront orbit scene around Dubai Marina';
const EXPECTED = { lat: 25.07864, lon: 55.13525, toleranceDeg: 0.01 };
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const now = () => new Date().toISOString();

// Read-only: do not call application methods, attach handlers, or alter rendering.
async function sample(page) {
  return page.evaluate(() => {
    const gev = window.__godsEyeView;
    const director = gev?.sceneDirector;
    const viewer = gev?.viewer || director?.viewer || window.viewer;
    const camera = viewer?.camera;
    const point = camera?.positionCartographic;
    const cartesian = camera?.positionWC || camera?.position;
    const deg = 180 / Math.PI;
    const clock = director?._clock?.snapshot;
    const text = document.querySelector('#incident-playback-clock')?.textContent || '';
    const elapsedText = Number.parseFloat(text);
    return {
      utc: new Date().toISOString(),
      running: Boolean(director?.running),
      paused: Boolean(director?.paused),
      sceneId: director?._selectedSceneId ?? null,
      shotId: director?._selectedShotId ?? null,
      playback: document.querySelector('#incident-panel')?.dataset.playback ?? null,
      elapsed: Number.isFinite(clock?.sceneElapsedSec) ? clock.sceneElapsedSec
        : Number.isFinite(elapsedText) ? elapsedText : null,
      clockText: text,
      camera: point ? {
        lat: point.latitude * deg, lon: point.longitude * deg, height: point.height,
        heading: camera.heading * deg, pitch: camera.pitch * deg, roll: camera.roll * deg,
        x: cartesian?.x ?? null, y: cartesian?.y ?? null, z: cartesian?.z ?? null,
      } : null,
    };
  });
}

function finiteCamera(state) {
  return Boolean(state.camera && ['lat', 'lon', 'height', 'heading', 'pitch', 'roll']
    .every((key) => Number.isFinite(state.camera[key])));
}

function moved(a, b) {
  if (!finiteCamera(a) || !finiteCamera(b)) return false;
  const x = a.camera;
  const y = b.camera;
  const angle = (left, right) => Math.abs(((left - right + 540) % 360) - 180);
  const distance = ['x', 'y', 'z'].every((key) => Number.isFinite(x[key]) && Number.isFinite(y[key]))
    ? Math.hypot(x.x - y.x, x.y - y.y, x.z - y.z) : 0;
  return distance > 1 || Math.abs(x.lat - y.lat) > 0.00001
    || angle(x.lon, y.lon) > 0.00001 || Math.abs(x.height - y.height) > 1
    || angle(x.heading, y.heading) > 0.02 || angle(x.pitch, y.pitch) > 0.02;
}

/**
 * @param {import('puppeteer').Page} page Caller-owned, preferably isolated page.
 * @param {{url:string,out:string,record:Array<object>}} options
 * @returns {Promise<object>} Run metadata, screenshots, scene and camera samples.
 * Pushes {id, pass, detail, data, startedUtc, finishedUtc, utc, viewport} entries
 * into record. The first failed step is recorded and rethrown; no failures skip.
 */
export async function runDesktop(page, { url, out, record }) {
  assert.ok(page && typeof page.goto === 'function', 'A caller-owned Puppeteer Page is required');
  assert.ok(typeof url === 'string' && /^https?:\/\//.test(url), 'url must be an HTTP(S) app URL');
  assert.ok(typeof out === 'string' && out.length, 'out must be a screenshot directory');
  assert.ok(Array.isArray(record), 'record must be the coordinator-owned assertion array');
  const startedUtc = now();
  const target = new URL(url);
  target.searchParams.set('welcome', '0');
  const directory = path.resolve(out);
  await mkdir(directory, { recursive: true });
  const shots = {};
  const cameras = {};
  const runTag = startedUtc.replace(/[:.]/g, '-');
  const sceneName = `Dubai Marina QA ${startedUtc}`;
  let scene;

  async function screenshot(label) {
    const filename = `marina-desktop-${runTag}-${label}.png`;
    const file = path.join(directory, filename);
    // Never pause the render loop or hide UI to make screenshots look better.
    await page.screenshot({ path: file, type: 'png', fullPage: false });
    shots[label] = file;
    return file;
  }

  async function step(id, detail, run) {
    const began = now();
    try {
      const data = await run();
      const finishedUtc = now();
      record.push({ id: `desktop.${id}`, pass: true, detail, data,
        startedUtc: began, finishedUtc, utc: finishedUtc, viewport: '1440x900' });
      return data;
    } catch (error) {
      let failureScreenshot = null;
      let diagnostic = null;
      try { failureScreenshot = await screenshot(`failure-${id}`); } catch { /* Page may be closed. */ }
      try { diagnostic = await sample(page); } catch { /* Preserve the original failure. */ }
      const finishedUtc = now();
      record.push({ id: `desktop.${id}`, pass: false, detail: `${detail}: ${error.message}`,
        data: { diagnostic }, screenshot: failureScreenshot,
        startedUtc: began, finishedUtc, utc: finishedUtc, viewport: '1440x900' });
      throw error;
    }
  }

  // Real mouse wheel scrolling, including inside the sidebar; never scroll via JS.
  async function click(selector) {
    await page.waitForSelector(selector, { visible: true, timeout: 30_000 });
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const box = await page.evaluate((css) => {
        const node = document.querySelector(css);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
        let scrollBox = null;
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY + style.overflowX)) {
            const bounds = parent.getBoundingClientRect();
            left = Math.max(left, bounds.left);
            right = Math.min(right, bounds.right);
            top = Math.max(top, bounds.top);
            bottom = Math.min(bottom, bounds.bottom);
            if (!scrollBox && /(auto|scroll)/.test(style.overflowY)
              && parent.scrollHeight > parent.clientHeight) {
              scrollBox = { x: bounds.left + bounds.width / 2,
                y: bounds.top + Math.min(bounds.height / 2, 100) };
            }
          }
        }
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const visible = x > left && x < right && y > top && y < bottom;
        const hit = visible ? document.elementFromPoint(x, y) : null;
        return { x, y, left, right, top, bottom, visible,
          hit: Boolean(hit && (hit === node || node.contains(hit))),
          disabled: Boolean(node.disabled), scrollBox,
          obscuredBy: hit?.id || hit?.tagName || null };
      }, selector);
      assert.ok(box && !box.disabled, `${selector} is missing or disabled`);
      if (box.visible) {
        assert.ok(box.hit, `${selector} is covered by ${box.obscuredBy || 'another surface'}`);
        await page.mouse.move(box.x, box.y);
        await page.mouse.click(box.x, box.y);
        return;
      }
      assert.ok(box.scrollBox, `${selector} is clipped with no mouse-scrollable ancestor`);
      assert.ok(box.right > box.left && box.bottom > box.top,
        `${selector} has no visible scroll corridor`);
      await page.mouse.move(
        Math.max(box.left + 2, Math.min(box.right - 2, box.scrollBox.x)),
        Math.max(box.top + 2, Math.min(box.bottom - 2, box.scrollBox.y)),
      );
      await page.mouse.wheel({ deltaY: box.y < box.top ? -220 : 220 });
      await sleep(120);
    }
    assert.fail(`Could not reach ${selector} with eight real mouse scrolls`);
  }

  async function replaceText(selector, value) {
    await click(selector);
    const focused = await page.evaluate((css) => document.activeElement === document.querySelector(css), selector);
    assert.ok(focused, `${selector} did not receive keyboard focus`);
    await page.keyboard.press('Home');
    await page.keyboard.down('Shift');
    await page.keyboard.press('End');
    await page.keyboard.up('Shift');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(value, { delay: 12 });
    const actual = await page.evaluate((css) => document.querySelector(css)?.value, selector);
    assert.equal(actual, value, `${selector} did not receive the exact text`);
  }

  await step('baseline', 'Desktop UI is ready at 1440×900; capture an unmodified baseline', async () => {
    await page.setViewport(VIEWPORT);
    const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    assert.ok(!response || response.ok(), `Navigation HTTP ${response?.status()}`);
    await page.waitForSelector('#incident-composer-input', { visible: true, timeout: 120_000 });
    await page.waitForFunction(() => {
      const loading = document.querySelector('#loading-screen');
      return (!loading || loading.classList.contains('hidden') || getComputedStyle(loading).display === 'none')
        && Boolean(window.__gevIncidents?.composer && window.__godsEyeView?.sceneDirector);
    }, { timeout: 120_000 });
    return { url: target.href, screenshot: await screenshot('baseline') };
  });

  await step('compose', 'Submit the exact waterfront orbit request with the Enter key', async () => {
    await replaceText('#incident-composer-input', QUERY);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => {
      const root = document.querySelector('#incident-composer');
      return root?.dataset.state === 'error' || root?.dataset.state === 'done';
    }, { timeout: 120_000 });
    const result = await page.evaluate(() => ({
      state: document.querySelector('#incident-composer')?.dataset.state,
      text: document.querySelector('#incident-composer-result')?.textContent || '',
    }));
    assert.equal(result.state, 'done', `Composer failed: ${result.text}`);
    await page.waitForSelector('#incident-composer-play', { visible: true, timeout: 30_000 });
    // If the user-facing Scenes tab is not selected, open it with a real click.
    const tab = await page.evaluate(() => {
      const el = document.querySelector('#sidebar-scenes-tab');
      return el ? { selected: el.getAttribute('aria-selected') === 'true' } : null;
    });
    if (tab && !tab.selected) await click('#sidebar-scenes-tab');
    await page.waitForSelector('#scene-library-name', { visible: true, timeout: 30_000 });
    return { query: QUERY, ...result };
  });

  scene = await step('anchor', 'The generated scene is geographically anchored near Dubai Marina', async () => {
    const value = await page.evaluate(() => {
      const item = window.__gevIncidents?.composer?.state?.lastScene;
      if (!item) return null;
      const anchor = item.anchor || item.location || item.keyframes?.[0];
      return { id: item.id, title: item.title, geographic: item.geographic,
        anchor: { lat: anchor?.lat ?? anchor?.latitude,
          lon: anchor?.lon ?? anchor?.lng ?? anchor?.longitude },
        keyframes: item.keyframes?.length || 0 };
    });
    assert.ok(value?.id, 'composer.state.lastScene is absent or lacks an id');
    assert.equal(value.geographic, true, 'Expected a geographic scene, not a fabricated incident');
    assert.ok(value.keyframes >= 2, 'Orbit scene needs at least two keyframes');
    assert.ok(Number.isFinite(value.anchor.lat) && Number.isFinite(value.anchor.lon), 'Scene anchor must be numeric');
    assert.ok(Math.abs(value.anchor.lat - EXPECTED.lat) <= EXPECTED.toleranceDeg,
      `Latitude ${value.anchor.lat} is not near ${EXPECTED.lat}`);
    assert.ok(Math.abs(value.anchor.lon - EXPECTED.lon) <= EXPECTED.toleranceDeg,
      `Longitude ${value.anchor.lon} is not near ${EXPECTED.lon}`);
    return { ...value, expected: EXPECTED };
  });

  await step('save', 'Save by the real name input/button and verify visible saved-state feedback', async () => {
    await replaceText('#scene-library-name', sceneName);
    await click('#scene-library-save');
    await page.waitForFunction((name) => {
      const library = document.querySelector('#scene-library');
      return library?.dataset.saved === 'true'
        && document.querySelector('#scene-library-name')?.value === name
        && /\bScene saved\b/i.test(document.querySelector('#scene-library-status')?.textContent || '');
    }, { timeout: 30_000 }, sceneName);
    const saved = await page.evaluate((name) => {
      const status = document.querySelector('#scene-library-status');
      const summary = document.querySelector('#scene-library-active');
      const visible = (el) => Boolean(el && el.getClientRects().length
        && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none');
      return { status: status?.innerText, summary: summary?.innerText,
        visible: visible(status) && visible(summary),
        hasSavedOption: Array.from(document.querySelectorAll('#scene-library-saved option'))
          .some((option) => option.textContent === name) };
    }, sceneName);
    assert.ok(saved.visible, 'Saved feedback must be visible, not just hidden DOM text');
    assert.ok(saved.summary?.includes(sceneName) && /\bSaved\b/.test(saved.summary), 'Active scene summary must show its saved name/state: ' + JSON.stringify(saved));
    assert.ok(saved.hasSavedOption, 'Saved-scene selector must include the named scene');
    return { sceneName, ...saved, screenshot: await screenshot('after') };
  });

  await step('playing', 'The real PLAY control starts playback and moves the live camera', async () => {
    await click('#incident-playback-play');
    await page.waitForFunction((id) => {
      const d = window.__godsEyeView?.sceneDirector;
      return d?.running && d._selectedSceneId === id
        && document.querySelector('#incident-panel')?.dataset.playback === 'playing';
    }, { timeout: 30_000 }, scene.id);
    const before = await sample(page);
    assert.ok(finiteCamera(before), 'Live Cesium camera is unavailable');
    let after = before;
    for (let i = 0; i < 8; i += 1) {
      await sleep(600);
      after = await sample(page);
      if (moved(before, after) && after.elapsed > before.elapsed + 0.05) break;
    }
    assert.ok(after.running && after.sceneId === scene.id, 'Requested scene must remain in playback');
    assert.ok(Number.isFinite(before.elapsed) && after.elapsed > before.elapsed + 0.05, 'Playback clock did not advance');
    assert.ok(moved(before, after), 'Playback did not move the actual camera');
    cameras.playing = { before, after };
    return { ...cameras.playing, screenshot: await screenshot('playing') };
  });

  await step('pause', 'The real PAUSE control stops the clock and settles the camera', async () => {
    await click('#incident-playback-pause');
    await page.waitForFunction(() => {
      const d = window.__godsEyeView?.sceneDirector;
      return !d?.running && Boolean(d?.paused)
        && document.querySelector('#incident-panel')?.dataset.playback === 'paused';
    }, { timeout: 15_000 });
    await sleep(700);
    const before = await sample(page);
    await sleep(650);
    const after = await sample(page);
    assert.ok(!after.running && after.paused, 'Playback resumed without a user action');
    assert.ok(finiteCamera(before) && finiteCamera(after), 'Paused camera samples are unavailable');
    assert.ok(Number.isFinite(before.elapsed) && Number.isFinite(after.elapsed)
      && Math.abs(after.elapsed - before.elapsed) <= 0.12, 'Paused clock kept advancing');
    assert.ok(!moved(before, after), 'Camera kept moving after pause settled');
    cameras.paused = { before, after };
    return cameras.paused;
  });

  const beforeNext = await sample(page);
  await step('next', 'The real NEXT control selects a different keyframe and moves the camera', async () => {
    assert.ok(beforeNext.shotId, 'No selected shot before NEXT');
    await click('#incident-playback-next');
    await page.waitForFunction((previous) => {
      const d = window.__godsEyeView?.sceneDirector;
      return Boolean(d?._selectedShotId) && d._selectedShotId !== previous;
    }, { timeout: 15_000 }, beforeNext.shotId);
    await sleep(2800); // The authored load-shot fly duration is 2.2 seconds.
    const after = await sample(page);
    assert.equal(after.sceneId, scene.id, 'NEXT switched away from the requested scene');
    assert.ok(moved(beforeNext, after), 'NEXT changed the selected shot but not the actual camera');
    cameras.next = { before: beforeNext, after };
    return cameras.next;
  });

  await step('previous', 'The real PREV control returns to the prior keyframe and moves the camera', async () => {
    const before = await sample(page);
    await click('#incident-playback-prev');
    await page.waitForFunction((previous) => window.__godsEyeView?.sceneDirector?._selectedShotId === previous,
      { timeout: 15_000 }, beforeNext.shotId);
    await sleep(2800);
    const after = await sample(page);
    assert.equal(after.sceneId, scene.id, 'PREV switched away from the requested scene');
    assert.equal(after.shotId, beforeNext.shotId, 'PREV did not restore the previous selected shot');
    assert.ok(moved(before, after), 'PREV changed the selected shot but not the actual camera');
    cameras.previous = { before, after };
    return { ...cameras.previous, screenshot: await screenshot('after-controls') };
  });

  return { pass: true, startedUtc, finishedUtc: now(), viewport: VIEWPORT,
    query: QUERY, sceneName, scene, screenshots: shots, cameras };
}
