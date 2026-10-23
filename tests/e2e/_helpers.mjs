import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAAElFTkSuQmCC',
  'base64'
);

function loadFixture(name) {
  const filePath = path.resolve(__dirname, '../fixtures', name);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const burjFixture = loadFixture('burj-khalifa-live.json');
const ummFixture = loadFixture('umm-suqeim-rebuild.json');
const routeFallbackFixture = loadFixture('route-plan-fallback.json');

export { burjFixture, ummFixture, routeFallbackFixture };

/**
 * Navigates to the app and waits for initial globe & UI readiness.
 */
export async function gotoApp(page, { hash = '', query = 'fixtures=1', reducedMotion = false } = {}) {
  if (reducedMotion) {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  }

  const q = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  const h = hash ? (hash.startsWith('#') ? hash : `#${hash}`) : '';
  const url = `/${q}${h}`;

  // The first-run mission launcher (#first-run-launcher) is a modal <aside>
  // that intercepts pointer events on narrow viewports; suppress it the way
  // a returning visitor would have (its own storage keys).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
      sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
    } catch {}
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Wait for loading screen to hide or be removed, and __godsEye to exist
  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading-screen');
    const loadingDone =
      !loading ||
      loading.hidden ||
      loading.classList.contains('hidden') ||
      window.getComputedStyle(loading).display === 'none' ||
      window.getComputedStyle(loading).visibility === 'hidden' ||
      window.getComputedStyle(loading).opacity === '0';

    const hasGodsEye = Boolean(window.__godsEye || window.__godsEyeView?.godsEye);
    return hasGodsEye && loadingDone;
  }, null, { timeout: 60_000 });

  // Belt and braces: close the first-run launcher if it still rendered.
  await page.evaluate(() => {
    const aside = document.querySelector('#first-run-launcher');
    if (aside && aside.classList.contains('visible')) {
      const btn = aside.querySelector('[data-first-run-dismiss], button[aria-label*="lose"], button');
      if (btn) btn.click();
      aside.classList.remove('visible');
      aside.hidden = true;
    }
  });

  // Ensure window.__godsEye is top-level reference if exposed via __godsEyeView
  await page.evaluate(() => {
    if (!window.__godsEye && window.__godsEyeView?.godsEye) {
      window.__godsEye = window.__godsEyeView.godsEye;
    }
  });
}

/**
 * Fills #incident-composer-input and clicks #incident-composer-submit
 */
export async function buildPrompt(page, text) {
  const input = page.locator('#incident-composer-input');
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  await input.fill(text);
  const submit = page.locator('#incident-composer-submit');
  await submit.click();
}

/**
 * Polls documentElement.dataset.geStage until it matches the requested stage
 */
export async function waitStage(page, targetStage, timeout = 30_000) {
  await page.waitForFunction(
    (st) => {
      if (document.documentElement.dataset.geStage === st) return true;
      if (Array.isArray(window.__geStages) && window.__geStages.some((e) => e.stage === st)) return true;
      return false;
    },
    targetStage,
    { timeout }
  );
}

/**
 * Listens to page requests matching media hosts or footage endpoints
 */
export function collectMedia(page) {
  const list = [];
  const regex = /youtube|tiktok|instagram|googlevideo|cdninstagram|\.mp4|\/footage\//i;
  // Platform glyphs (/icons/platforms/instagram.svg …) and posters are UI
  // chrome, not media; HARD RULE §0 is about clips and footage fetches.
  // The scene DOCUMENT (/footage/scenes/<id>, IndexedDB mirror) is state,
  // not footage: a fresh profile has no IndexedDB, so a share restore may
  // read it once; it never streams clips or media.
  const chrome = /\/icons\/platforms\/|\/posters\/|\/footage\/scenes\//i;
  page.on('request', (req) => {
    const url = req.url();
    if (regex.test(url) && !chrome.test(url)) {
      list.push({
        url,
        method: req.method(),
        resourceType: req.resourceType(),
        timestamp: Date.now(),
      });
    }
  });
  return list;
}

/**
 * Counts <video> elements in DOM
 */
export async function countVideos(page) {
  return await page.locator('video').count();
}

/**
 * Parses location.hash into a plain object
 */
export async function hashParams(page) {
  return await page.evaluate(() => {
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const result = {};
    for (const [k, v] of params.entries()) {
      result[k] = v;
    }
    return result;
  });
}

/**
 * Helper to install stage event listener pushing to window.__geStages
 */
export async function installStageCollector(page) {
  await page.addInitScript(() => {
    window.__geStages = window.__geStages || [];
    window.addEventListener('gev:scene-stage', (e) => {
      let alt = null;
      try {
        const viewer = window.__godsEyeView?.viewer;
        if (viewer?.camera?.positionCartographic) {
          alt = viewer.camera.positionCartographic.height;
        }
      } catch {}
      window.__geStages.push({
        time: Date.now(),
        stage: e.detail?.stage,
        sceneId: e.detail?.sceneId,
        revealLayers: e.detail?.revealLayers,
        altitude: alt,
      });
    });
  });
}

/**
 * Intercepts footage streaming, routing, and third-party media requests
 */
export async function installFixtureRoutes(page, opts = {}) {
  // 1. Intercept third-party media and imagery hosts
  await page.route(/(youtube|tiktok|instagram|googlevideo|cdninstagram|gibs\.earthdata)/i, async (route) => {
    const req = route.request();
    const type = req.resourceType();
    if (type === 'image') {
      await route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!DOCTYPE html><html><body></body></html>',
      });
    }
  });

  // 2. Intercept /footage/route/alerts
  await page.route('**/footage/route/alerts**', async (route) => {
    const url = route.request().url();
    const isUmm = /umm|crash|suqeim/i.test(url);
    const fixture = isUmm ? ummFixture : burjFixture;
    const alerts = opts.mockAlerts ? (opts.alerts || fixture.alerts || []) : (fixture.alerts || []);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ alerts }),
    });
  });

  // 3. Intercept /footage/route/plan
  await page.route('**/footage/route/plan**', async (route) => {
    if (opts.route500) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify(routeFallbackFixture.body || { error: 'route_agent_failed', message: 'mocked 500' }),
      });
      return;
    }

    const postData = route.request().postDataJSON() || {};
    const target = postData.target || { lat: 25.1972, lon: 55.2744, name: 'Target' };
    const isUmm = /umm|crash|suqeim/i.test(target.name || '');
    const fixture = isUmm ? ummFixture : burjFixture;

    const lat = target.lat || fixture.target.lat;
    const lon = target.lon || fixture.target.lon;

    const plan = {
      scenePath: [
        { lat, lon, alt: 8_000_000, heading: 0, pitch: -90, durationMs: 1200, easing: 'quadInOut', stage: 'S0', revealLayers: ['viirs'] },
        { lat, lon, alt: 1_200_000, heading: 0, pitch: -70, durationMs: 2200, easing: 'quadInOut', stage: 'S1', revealLayers: ['viirs'] },
        { lat, lon, alt: 18_000, heading: 135, pitch: -60, durationMs: 2600, easing: 'quadInOut', stage: 'S2', revealLayers: ['pins', 'rings'] },
        { lat, lon, alt: 2_000, heading: 135, pitch: -45, durationMs: 2200, easing: 'quadInOut', stage: 'S3', revealLayers: ['routes', 'pins'] },
        { lat, lon, alt: 300, heading: 135, pitch: -30, durationMs: 2300, easing: 'quadInOut', stage: 'S4', revealLayers: ['routes', 'pins', 'evidence'] },
      ],
      approachBearing: 135,
      groundRoutes: fixture.groundRoutes || [],
      alerts: fixture.alerts || [],
      confidence: 0.8,
      basis: 'route-agent-plan',
      fallback: false,
    };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(plan),
    });
  });

  // 4. Intercept /footage/stream
  await page.route('**/footage/stream**', async (route) => {
    const url = route.request().url();
    let fixture = burjFixture;

    if (/umm|crash|suqeim/i.test(url)) {
      fixture = ummFixture;
    } else if (/hodeidah/i.test(url)) {
      // Shifted Burj items for Hodeidah
      fixture = {
        ...burjFixture,
        target: { name: 'Hodeidah', lat: 14.7978, lon: 42.9545 },
        items: burjFixture.items.map((it, idx) => ({
          ...it,
          lat: 14.7978 + (idx * 0.002),
          lon: 42.9545 + (idx * 0.002),
        })),
      };
    }

    const now = Date.now();
    let items = (opts.streamItems || fixture.items).map((it, idx) => {
      let pub = it.published_at;
      if (typeof pub === 'string' && pub.startsWith('__NOW-') && pub.endsWith('__')) {
        const sec = parseInt(pub.replace('__NOW-', '').replace('__', ''), 10) || 600;
        pub = new Date(now - sec * 1000).toISOString();
      }
      return {
        ...it,
        id: it.id || `item_${idx}_${Date.now()}`,
        published_at: pub,
      };
    });

    if (opts.duplicateCount && opts.duplicateCount > items.length) {
      const base = [...items];
      while (items.length < opts.duplicateCount) {
        const copyIdx = items.length;
        const sourceItem = base[copyIdx % base.length];
        items.push({
          ...sourceItem,
          id: `item_dup_${copyIdx}_${Date.now()}`,
          url: `${sourceItem.url}_dup_${copyIdx}`,
          canonical: `${sourceItem.canonical || 'item'}:dup:${copyIdx}`,
        });
      }
    }

    let sse = '';
    sse += `event: query\ndata: ${JSON.stringify(fixture.query || {})}\n\n`;

    for (const src of fixture.sources || []) {
      sse += `event: source_start\ndata: ${JSON.stringify({ source: src.source })}\n\n`;
    }

    for (const item of items) {
      sse += `event: item\ndata: ${JSON.stringify(item)}\n\n`;
    }

    for (const src of fixture.sources || []) {
      sse += `event: source_done\ndata: ${JSON.stringify(src)}\n\n`;
    }

    const earliest = items.length > 0 ? items[items.length - 1].published_at : new Date().toISOString();
    sse += `event: done\ndata: ${JSON.stringify({
      reported_at: fixture.tRef || fixture.query?.reported_at || null,
      earliest_published_at: earliest,
      all_sources_failed: false,
    })}\n\n`;

    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      body: sse,
    });
  });
}

/**
 * Clock mock helper
 */
export async function mockClock(page, offsetMs = 0) {
  await page.addInitScript((offset) => {
    window.__clockOffset = offset;
    if (typeof window.__realDateNow !== 'function') {
      window.__realDateNow = Date.now.bind(Date);
      Date.now = () => window.__realDateNow() + (window.__clockOffset || 0);
    }
    if (window.__godsEye && typeof window.__godsEye.setNow === 'function') {
      window.__godsEye.setNow(() => Date.now());
    }
  }, offsetMs);

  await page.evaluate((offset) => {
    window.__clockOffset = offset;
    if (typeof window.__realDateNow !== 'function') {
      window.__realDateNow = Date.now.bind(Date);
      Date.now = () => window.__realDateNow() + (window.__clockOffset || 0);
    }
    if (window.__godsEye && typeof window.__godsEye.setNow === 'function') {
      window.__godsEye.setNow(() => Date.now());
    }
  }, offsetMs).catch(() => {});
}

/**
 * Saves JSON artifact into tests/report/
 */
export async function saveJson(relPath, data) {
  const fullPath = path.isAbsolute(relPath) ? relPath : path.resolve(__dirname, '..', relPath);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Captures screenshot, attaches it to testInfo, and saves to tests/report/screenshots/
 */
export async function attachAndSaveScreenshot(page, testInfo, slug) {
  const projectName = testInfo.project.name || 'desktop';
  const fileName = `${slug}-${projectName}.png`;
  const reportDir = path.resolve(__dirname, '..', 'report', 'screenshots');
  await fs.promises.mkdir(reportDir, { recursive: true });
  const diskPath = path.join(reportDir, fileName);

  const buffer = await page.screenshot({ fullPage: true });
  await fs.promises.writeFile(diskPath, buffer);
  await testInfo.attach(fileName, {
    body: buffer,
    contentType: 'image/png',
  });
  return diskPath;
}


/**
 * Expand the existing SCENES panel (#scene-panel is collapsed by default) so
 * the Gods-Eye scenes tab, cards and START/NEXT/STOP are visible + clickable.
 */
export async function openScenesPanel(page) {
  await page.evaluate(() => {
    const panel = document.querySelector('#scene-panel');
    if (!panel) return;
    if (panel.classList.contains('collapsed')) {
      const btn = panel.querySelector('.panel-collapse-btn');
      if (btn) btn.click();
      else panel.classList.remove('collapsed');
    }
  });
  await page.waitForTimeout(300);
  const tab = page.locator('#ge-scenes-tab-active');
  if (await tab.count()) await tab.click({ force: true }).catch(() => {});
  await page.waitForTimeout(200);
}
