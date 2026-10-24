/**
 * Agent 18: caller-owned Puppeteer Page assertions. No browser/context lifecycle.
 *
 * Caller MUST set {width:375,height:739,isMobile:true,hasTouch:true} before use.
 * await runMobile(page, { url, out: '.ui-proof/marina', record: async row => {} });
 * await runIframe(page, { url, out: '.ui-proof/marina', record: async row => {} });
 *
 * Both return {ok, completed, checks, screenshots, ...}. record(row) is optional.
 * Every assertion is timestamped and gets a viewport PNG; reports are also written
 * incrementally to out. Failed prerequisites stop the dependent flow, not the
 * caller's process. The caller owns its browser cleanup and wall-clock deadline.
 *
 * The iframe case is a SAME-ORIGIN EMBED HARNESS, NOT the inaccessible host chat.
 * All input/buttons use native touchscreen events + keyboard typing. evaluate()
 * only reads DOM, public diagnostic state, geometry, and localStorage evidence.
 * No DOM injection, dispatchEvent, mocks, fake timers, or overlay removal.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MARINA_PROMPT = 'Create a waterfront orbit scene around Dubai Marina';
export const MOBILE_VIEWPORT = Object.freeze({
  width: 375, height: 739, isMobile: true, hasTouch: true,
});
const EXPECTED_ANCHOR = { lat: 25.0786415, lon: 55.1352524 };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const utc = () => new Date().toISOString();

function assert(ok, message, data) {
  if (!ok) {
    const error = new Error(message);
    error.data = data;
    throw error;
  }
}
async function until(read, predicate, label, timeout = 20000) {
  const end = Date.now() + timeout;
  let last;
  do {
    last = await read();
    if (predicate(last)) return last;
    await pause(150);
  } while (Date.now() < end);
  assert(false, `Timed out: ${label}`, last);
}

// Read-only browser function. Coordinates are local to this document/frame.
function targetGeometry(selector) {
  const element = document.querySelector(selector);
  if (!element) return { exists: false, selector };
  const rect = element.getBoundingClientRect();
  const shape = r => ({ x: r.x, y: r.y, width: r.width, height: r.height,
    left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  const style = getComputedStyle(element);
  let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
  let visible = rect.width > 0 && rect.height > 0 && style.visibility === 'visible'
    && style.display !== 'none' && Number(style.opacity) > 0;
  let scroll = null;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent);
    const box = parent.getBoundingClientRect();
    visible = visible && css.display !== 'none' && css.visibility === 'visible'
      && Number(css.opacity) > 0 && !parent.hidden && !parent.inert;
    if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) {
      left = Math.max(left, box.left); right = Math.min(right, box.right);
    }
    if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) {
      top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom);
    }
    if (!scroll && /(auto|scroll)/.test(css.overflowY)
        && parent.scrollHeight > parent.clientHeight + 1) {
      scroll = { id: parent.id, box: shape(box),
        canUp: parent.scrollTop > 1,
        canDown: parent.scrollTop + parent.clientHeight < parent.scrollHeight - 1 };
    }
  }
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  const centerInside = x >= left && x < right && y >= top && y < bottom;
  const hitOK = !!hit && (hit === element || element.contains(hit));
  return { exists: true, selector, visible: visible && !element.hidden,
    disabled: !!element.disabled || element.getAttribute('aria-disabled') === 'true' || !!element.closest('[inert]'),
    rect: shape(rect), center: { x, y }, clip: { left, top, right, bottom },
    centerInside, fullyInside: rect.left >= left && rect.right <= right
      && rect.top >= top && rect.bottom <= bottom, hitOK, hit: hit && { tag: hit.tagName, id: hit.id, className: String(hit.className || '') },
    focused: document.activeElement === element, value: element.value,
    text: element.textContent?.trim(), scroll };
}

function uiState() {
  const composer = window.__gevIncidents?.composer?.state;
  const lastScene = composer?.lastScene;
  const text = selector => document.querySelector(selector)?.textContent?.trim() || '';
  const shown = selector => {
    const el = document.querySelector(selector);
    if (!el) return false;
    const r = el.getBoundingClientRect(), css = getComputedStyle(el);
    return !el.hidden && r.width > 0 && r.height > 0 && css.display !== 'none'
      && css.visibility === 'visible';
  };
  return {
    href: location.href, state: document.querySelector('#incident-composer')?.dataset.state,
    busy: composer?.busy, prompt: composer?.text,
    anchor: lastScene?.anchor ?? null, sceneId: lastScene?.id ?? null,
    sceneTitle: lastScene?.title ?? null, result: text('#incident-composer-result'),
    running: window.__godsEyeView?.sceneDirector?.running ?? null,
    clock: text('#incident-playback-clock'),
    scrub: Number(document.querySelector('#incident-playback-scrub')?.value),
    drawerExpanded: document.querySelector('#scene-drawer-toggle')?.getAttribute('aria-expanded'),
    drawerLabel: document.querySelector('#scene-drawer-toggle')?.getAttribute('aria-label'),
    scenesSelected: document.querySelector('#sidebar-scenes-tab')?.getAttribute('aria-selected'),
    layersSelected: document.querySelector('#sidebar-layers-tab')?.getAttribute('aria-selected'),
    scenesShown: shown('#scene-panel'), layersShown: shown('#data-panel'),
    name: document.querySelector('#scene-library-name')?.value,
    meta: text('#scene-library .scene-library__meta'),
    activeTitle: text('#scene-library .scene-library__active-title'),
    saveStatus: text('#scene-library-status'),
    savedOptions: Array.from(document.querySelectorAll('#scene-library-saved option'),
      option => ({ value: option.value, title: option.textContent?.trim() })),
  };
}

async function run(page, { url, out = '.ui-proof/marina', record } = {}, mode) {
  assert(typeof url === 'string' && /^https?:\/\//.test(url), 'An absolute live http(s) app URL is required');
  assert(!record || typeof record === 'function', 'record must be an async-capable function accepting one row');
  assert(page?.touchscreen?.tap && page?.keyboard?.type, 'Supply a caller-owned Puppeteer Page with touchscreen + keyboard');
  const output = path.resolve(out);
  await mkdir(output, { recursive: true });
  const runTag = utc().replace(/[^0-9TZ]/g, '');
  const prefix = `marina-${mode}-${runTag}`;
  const reportPath = path.join(output, `${prefix}-assertions.json`);
  const report = {
    agent: 18, mode,
    scope: mode === 'iframe' ? 'Same-origin /embed-harness.html; NOT the user host chat' : 'Standalone mobile workstation',
    hostChatTested: false, url, prompt: MARINA_PROMPT, expectedAnchor: EXPECTED_ANCHOR,
    expectedViewport: MOBILE_VIEWPORT, startedUtc: utc(), finishedUtc: null,
    completed: false, ok: false, checks: [], screenshots: [], reportPath,
  };
  let root = page;
  const read = () => root.evaluate(uiState);
  const flush = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  const step = async (id, action) => {
    const row = { id: `${mode}.${id}`, mode, scope: report.scope, startedUtc: utc(),
      finishedUtc: null, pass: false, status: 'FAIL', detail: '', data: null, screenshot: null };
    try {
      row.data = (await action()) ?? null;
      row.pass = true; row.status = 'PASS'; row.detail = id;
    } catch (error) {
      row.detail = error?.message || String(error);
      row.data = error?.data ?? null;
    }
    const filename = `${prefix}-${String(report.checks.length + 1).padStart(2, '0')}-${id}.png`;
    try {
      row.screenshot = path.join(output, filename);
      await page.screenshot({ path: row.screenshot, type: 'png', captureBeyondViewport: false });
      report.screenshots.push(row.screenshot);
    } catch (error) {
      row.screenshot = null;
      row.pass = false; row.status = 'FAIL';
      row.detail += `; PNG capture failed: ${error.message}`;
    }
    row.finishedUtc = utc();
    report.checks.push(row);
    await flush();
    if (record) await record(row);
    return row.pass;
  };
  class PrerequisiteFailed extends Error {}
  const must = async (id, action) => {
    if (!await step(id, action)) throw new PrerequisiteFailed(id);
  };
  const acquireRoot = async () => {
    if (mode !== 'iframe') { root = page; return; }
    const handle = await page.waitForSelector('#app', { visible: true, timeout: 30000 });
    try { root = await handle.contentFrame(); } finally { await handle.dispose(); }
    assert(root, 'The existing #app iframe must expose its actual content frame');
  };
  const offset = async () => {
    if (mode !== 'iframe') return { x: 0, y: 0 };
    return page.evaluate(() => {
      const el = document.querySelector('#app'), r = el.getBoundingClientRect();
      return { x: r.left + el.clientLeft, y: r.top + el.clientTop };
    });
  };
  const topHit = async (x, y) => page.evaluate((px, py) => {
    const hit = document.elementFromPoint(px, py);
    return { frameHit: hit?.id === 'app', hitId: hit?.id, tag: hit?.tagName };
  }, x, y);
  const swipe = async (geometry, forward) => {
    const port = geometry.scroll;
    assert(port, `No user-scrollable ancestor for ${geometry.selector}`, geometry);
    assert(forward ? port.canDown : port.canUp, `Cannot scroll further to ${geometry.selector}`, geometry);
    const box = port.box;
    const left = Math.max(0, box.left), right = Math.min(375, box.right);
    const top = Math.max(0, box.top, geometry.clip.top);
    const bottom = Math.min(box.bottom, geometry.clip.bottom);
    assert(bottom - top >= 45 && right - left >= 24, 'Scrollable touch area is clipped', geometry);
    const o = await offset(), x = o.x + right - Math.min(12, (right - left) / 4);
    const high = o.y + top + (bottom - top) * .2;
    const low = o.y + top + (bottom - top) * .8;
    const start = forward ? low : high, end = forward ? high : low;
    if (mode === 'iframe') assert((await topHit(x, start)).frameHit, 'Iframe swipe start is covered');
    const touch = await page.touchscreen.touchStart(x, start);
    try {
      for (let i = 1; i <= 12; i++) {
        const y = start + (end - start) * i / 12;
        if (touch?.move) await touch.move(x, y);
        else await page.touchscreen.touchMove(x, y);
        await pause(16);
      }
    } finally {
      if (touch?.end) await touch.end();
      else await page.touchscreen.touchEnd();
    }
    await pause(200);
  };
  const touchable = async (selector, requireFull = false) => {
    await root.waitForSelector(selector, { visible: true, timeout: 20000 });
    for (let attempt = 0; attempt < 10; attempt++) {
      const g = await root.evaluate(targetGeometry, selector);
      assert(g.exists && g.visible && !g.disabled, `${selector} is missing, hidden, or disabled`, g);
      if (g.centerInside && g.hitOK && (!requireFull || g.fullyInside)) return g;
      assert(g.scroll, `${selector} center is clipped/covered (no real scroll recovery)`, g);
      const forward = requireFull
        ? g.rect.bottom > g.clip.bottom && g.scroll.canDown
        : g.center.y >= g.clip.bottom || (g.center.y >= g.clip.top && g.scroll.canDown);
      await swipe(g, forward);
    }
    assert(false, `${selector} remained untappable after bounded real touch scrolling`, await root.evaluate(targetGeometry, selector));
  };
  const tap = async selector => {
    const g = await touchable(selector), o = await offset();
    const screen = { x: o.x + g.center.x, y: o.y + g.center.y };
    const outer = mode === 'iframe' ? await topHit(screen.x, screen.y) : null;
    if (outer) assert(outer.frameHit, `${selector} is covered in the embedding document`, outer);
    await page.touchscreen.tap(screen.x, screen.y);
    return { ...g, screen, outer, method: 'page.touchscreen.tap at verified elementFromPoint center' };
  };
  const typeInto = async (selector, value) => {
    const hit = await tap(selector);
    await until(() => root.evaluate(targetGeometry, selector), g => g.focused,
      `native touch focuses ${selector}`);
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(value, { delay: 15 });
    const g = await root.evaluate(targetGeometry, selector);
    assert(g.focused && g.value === value, 'Actual keyboard input did not reach the touched field', g);
    return { hit, typed: g.value, focused: g.focused };
  };
  const layout = async () => {
    const dimensions = await root.evaluate(() => ({
      innerWidth, innerHeight, clientWidth: document.documentElement.clientWidth,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
      visualWidth: visualViewport?.width, maxTouchPoints: navigator.maxTouchPoints,
    }));
    assert(dimensions.innerWidth === 375 && dimensions.clientWidth === 375
      && dimensions.scrollWidth <= 375 && Math.abs((dimensions.visualWidth || 375) - 375) < 1,
    'Horizontal overflow or a non-375px document viewport', dimensions);
    assert(dimensions.maxTouchPoints > 0, 'Document lacks real touch emulation', dimensions);
    const host = mode === 'iframe' ? await page.evaluate(() => ({ innerWidth,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) })) : null;
    if (host) assert(host.innerWidth === 375 && host.scrollWidth <= 375, 'Embed host has horizontal overflow', host);
    return { document: dimensions, host };
  };
  const ready = async () => until(read, s => s.state !== undefined
    && s.drawerExpanded !== undefined && s.running !== null,
  'real composer, sidebar, and scene director initialized', 90000);
  const selectedScenes = async () => {
    const hit = await tap('#sidebar-scenes-tab');
    const state = await until(read, s => s.scenesSelected === 'true' && s.scenesShown && !s.layersShown,
      'Scenes tab is visibly selected');
    return { hit, state, layout: await layout() };
  };
  const savedName = `Dubai Marina waterfront orbit ${mode} ${runTag}`;
  report.savedName = savedName;
  try {
    await must('exact-touch-viewport', async () => {
      const configured = page.viewport();
      assert(configured && Object.entries(MOBILE_VIEWPORT).every(([k, v]) => configured[k] === v),
        'Caller must configure exact 375x739, isMobile:true, hasTouch:true; runner will not change it', configured);
      return configured;
    });
    await must('load-live-workstation', async () => {
      const destination = mode === 'iframe' ? new URL('/embed-harness.html', url).href : url;
      report.navigatedUrl = destination;
      const response = await page.goto(destination, { waitUntil: 'domcontentloaded', timeout: 90000 });
      assert(response && response.status() >= 200 && response.status() < 400,
        'Live document did not load successfully', { status: response?.status(), destination });
      await acquireRoot();
      const state = await ready();
      if (mode === 'iframe') {
        const harness = await page.evaluate(() => {
          const frame = document.querySelector('#app');
          return { href: location.href, title: document.title, frameSrc: frame?.src,
            sandbox: frame?.getAttribute('sandbox'), frameTitle: frame?.title,
            frameWidth: frame?.clientWidth, frameHeight: frame?.clientHeight };
        });
        assert(new URL(harness.href).pathname === '/embed-harness.html'
          && new URL(harness.frameSrc).origin === new URL(harness.href).origin
          && harness.frameWidth === 375 && harness.frameHeight > 0,
        'Existing harness is not a suitable same-origin, 375px embed', harness);
        report.harness = harness;
      }
      return { state, layout: await layout(), harness: report.harness || null };
    });
    await must('touch-input-and-type-prompt', () => typeInto('#incident-composer-input', MARINA_PROMPT));
    await must('touch-build-resolves-marina-anchor', async () => {
      const hit = await tap('#incident-composer-submit');
      const state = await until(read, s => !s.busy && ['done', 'error', 'external', 'pick', 'partial', 'unavailable'].includes(s.state),
        'Build scene completes without mocked responses', 90000);
      const lat = state.anchor?.lat ?? state.anchor?.latitude;
      const lon = state.anchor?.lon ?? state.anchor?.lng ?? state.anchor?.longitude;
      assert(state.state === 'done' && state.prompt === MARINA_PROMPT && state.sceneId
        && Number.isFinite(lat) && Number.isFinite(lon)
        && Math.abs(lat - EXPECTED_ANCHOR.lat) < 1e-6 && Math.abs(lon - EXPECTED_ANCHOR.lon) < 1e-6,
      'lastScene.anchor did not resolve to Dubai Marina 25.07864,55.13525', state);
      return { hit, state, layout: await layout() };
    });
    await must('composer-play-center-hit-and-touch', async () => {
      const hit = await tap('#incident-composer-play');
      const state = await until(read, s => s.running === true && s.state === 'done' && !s.busy,
        'Composer Play actually starts the director');
      return { hit, state };
    });
    await must('scenes-tab-touch', selectedScenes);
    await must('drawer-collapse-touch', async () => {
      const before = await read();
      assert(before.drawerExpanded === 'true' && /collapse/i.test(before.drawerLabel), 'Collapse control not exposed', before);
      const hit = await tap('#scene-drawer-toggle');
      const state = await until(read, s => s.drawerExpanded === 'false' && !s.scenesShown && !s.layersShown,
        'drawer collapse hides both panels');
      assert(/expand/i.test(state.drawerLabel), 'Collapsed drawer lacks Expand label', state);
      return { hit, state, layout: await layout() };
    });
    await must('drawer-expand-touch', async () => {
      const hit = await tap('#scene-drawer-toggle');
      const state = await until(read, s => s.drawerExpanded === 'true' && s.scenesShown,
        'drawer expand restores Scenes');
      assert(/collapse/i.test(state.drawerLabel), 'Expanded drawer lacks Collapse label', state);
      return { hit, state };
    });
    await must('layers-tab-touch', async () => {
      const hit = await tap('#sidebar-layers-tab');
      const state = await until(read, s => s.layersSelected === 'true' && s.scenesSelected === 'false'
        && s.layersShown && !s.scenesShown, 'Layers tab visibly switches the panel');
      return { hit, state, layout: await layout() };
    });
    await must('scenes-tab-return-touch', selectedScenes);
    await step('all-playback-controls-contained', async () => {
      await touchable('#incident-playback', true);
      const data = await root.evaluate(() => {
        const host = document.querySelector('#incident-playback');
        const rect = r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
        const box = rect(host.getBoundingClientRect());
        const controls = Array.from(host.children, el => {
          const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
          const hit = document.elementFromPoint(x, y), css = getComputedStyle(el);
          return { id: el.id, box: rect(r), visible: css.display !== 'none' && css.visibility === 'visible'
            && r.width > 0 && r.height > 0,
          hit: hit?.id, centerHit: hit === el || el.contains(hit),
          inside: r.left >= box.left - .5 && r.right <= box.right + .5
            && r.top >= box.top - .5 && r.bottom <= box.bottom + .5
            && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
        });
        return { box, controls };
      });
      const required = ['play', 'pause', 'prev', 'next', 'scrub', 'clock'].map(s => `incident-playback-${s}`);
      assert(required.every(id => data.controls.some(c => c.id === id))
        && data.controls.every(c => c.visible && c.inside && c.centerHit),
      'Playback controls must all fit inside their bar AND the 375px viewport with unobstructed centers', data);
      return { ...data, layout: await layout() };
    });
    await must('playback-pause-touch', async () => {
      const hit = await tap('#incident-playback-pause');
      const state = await until(read, s => s.running === false && /paused/i.test(s.clock), 'Pause really pauses playback');
      return { hit, state };
    });
    await must('playback-resume-touch-and-real-clock', async () => {
      const hit = await tap('#incident-playback-play');
      const running = await until(read, s => s.running === true, 'Play resumes playback');
      const advanced = await until(read, s => s.running === true && s.clock !== running.clock,
        'Real playback clock advances without timer manipulation', 10000);
      return { hit, before: running, after: advanced };
    });
    await must('type-real-scene-library-name', () => typeInto('#scene-library-name', savedName));
    await must('touch-save-and-visible-saved-status', async () => {
      const hit = await tap('#scene-library-save');
      const state = await until(read, s => s.activeTitle === savedName && /\bSaved\b/.test(s.meta)
        && /^Scene saved\./i.test(s.saveStatus)
        && s.savedOptions.some(o => o.title === savedName), 'Scene saved visibly after actual name typing');
      const storage = await root.evaluate(name => {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if ((localStorage.getItem(key) || '').includes(name)) keys.push(key);
        }
        return { keysContainingExactSavedName: keys };
      }, savedName);
      assert(storage.keysContainingExactSavedName.length > 0, 'Saved name has no localStorage persistence evidence', { state, storage });
      return { hit, state, storage };
    });
    await must('full-reload-and-find-saved-option', async () => {
      const response = await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
      assert(response && response.status() >= 200 && response.status() < 400, 'Full reload failed', { status: response?.status() });
      await acquireRoot(); await ready();
      await selectedScenes();
      const state = await until(read, s => s.savedOptions.some(o => o.title === savedName),
        'Saved scene survives full reload in real UI', 30000);
      return { state, layout: await layout() };
    });
    await must('select-persisted-scene-and-visible-saved-status', async () => {
      // Native select: real touchscreen focus/open, then real keyboard navigation.
      // No select(), .value assignment, dispatchEvent, or storage restoration.
      const options = (await read()).savedOptions;
      const index = options.findIndex(option => option.title === savedName);
      assert(index > 0, 'Named persisted scene is absent from the user-facing select', options);
      const hit = await tap('#scene-library-saved');
      await page.keyboard.press('Home');
      for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      const state = await until(read, s => s.name === savedName && s.activeTitle === savedName
        && /\bSaved\b/.test(s.meta), 'Persisted selection exposes visible Saved status after reload');
      await touchable('#scene-library .scene-library__meta');
      const visibleStatus = await root.evaluate(targetGeometry, '#scene-library .scene-library__meta');
      assert(visibleStatus.visible && visibleStatus.centerInside && visibleStatus.hitOK
        && /\bSaved\b/.test(visibleStatus.text), 'Post-reload Saved status is not actually visible', visibleStatus);
      return { hit, state, visibleStatus, layout: await layout() };
    });
    await step('final-no-horizontal-overflow', layout);
    report.completed = true;
  } catch (error) {
    report.stoppedEarly = error.message;
    if (!(error instanceof PrerequisiteFailed)) {
      await step('unexpected-runner-error', () => { throw error; });
    }
  } finally {
    report.finishedUtc = utc();
    report.ok = report.completed && report.checks.length > 0 && report.checks.every(row => row.pass);
    report.summary = { passed: report.checks.filter(row => row.pass).length,
      failed: report.checks.filter(row => !row.pass).length, completed: report.completed };
    await flush();
  }
  return report;
}

/** Standalone 375x739 real-touch flow. Does not launch or close the supplied Page. */
export async function runMobile(page, options) { return run(page, options, 'mobile'); }
/** Same mobile flow inside the existing /embed-harness.html, explicitly NOT host chat. */
export async function runIframe(page, options) { return run(page, options, 'iframe'); }
