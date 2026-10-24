import { PRODUCT_NAME } from './brand/productName.js';
import { describeAisAvailability } from './hudSummaryResponse.js';

/** True only in a build produced with VITE_SERVERLESS_MODE=true. */
function isServerlessBuild() {
  return ['true', '1', 'yes'].includes(
    String(import.meta.env?.VITE_SERVERLESS_MODE ?? '').toLowerCase(),
  );
}

/**
 * Compact, closed-by-default availability disclosure, never a dismiss-and-forget
 * warning. Prefer the Layers rail; the small floating fallback lasts only until
 * that asynchronously mounted rail exists. Serverless alone proves neither
 * that AIS works nor that it is unavailable (a snapshot collector may exist).
 *
 * getAisStats is optional and must return actual provider/accepted-data stats.
 * Without it, rendered layer health can report failures but cannot prove live.
 */
function installServerlessNotice(
  doc = globalThis.document,
  { serverless = isServerlessBuild(), getAisStats } = {},
) {
  if (!serverless || !doc?.createElement) return null;
  const existing = doc.querySelector?.('[data-gev-serverless-notice]');
  if (existing) return existing;

  const banner = doc.createElement('details');
  banner.className = 'serverless-notice';
  banner.setAttribute('data-gev-serverless-notice', '');
  banner.setAttribute('aria-label', 'AIS availability details');
  banner.open = false;
  banner.style.cssText =
    'position:fixed;left:12px;bottom:12px;z-index:100;' +
    'max-width:calc(100vw - 24px);width:20rem;box-sizing:border-box;' +
    'max-height:40vh;overflow:auto;padding:8px 12px;border-radius:6px;' +
    'background:#141418;color:#f2f2f2;font:12px/1.45 system-ui,sans-serif';
  const summary = doc.createElement('summary');
  summary.style.cursor = 'pointer';
  const badge = doc.createElement('span');
  badge.setAttribute('role', 'status');
  badge.setAttribute('aria-live', 'polite');
  badge.setAttribute('aria-atomic', 'true');
  summary.appendChild(badge);
  const explanation = doc.createElement('p');
  const deployment = doc.createElement('p');
  deployment.textContent = `${PRODUCT_NAME} is running serverlessly. AIS depends on the configured provider and accepted data; serverless mode does not imply live or global coverage. Layer controls and provider details remain available in Layers.`;
  banner.append(summary, explanation, deployment);
  (doc.body || doc.documentElement).appendChild(banner);

  let stopped = false;
  let inline = false;
  const setText = (node, text) => {
    if (node && node.textContent !== text) node.textContent = text;
  };
  const sync = () => {
    if (stopped) return;
    const host = doc.querySelector?.('#data-panel .data-panel-inner');
    if (host && banner.parentNode !== host) {
      host.appendChild(banner);
      inline = true;
      banner.classList.add('serverless-notice--inline');
      banner.style.position = 'static';
      banner.style.width = 'auto';
      banner.style.margin = '8px 0';
    }
    // Keep the feature name neutral even before the first request completes.
    // Only presentation changes: preserve toggle/ASK controls and listeners.
    const row = doc.querySelector?.('[data-layer-id="ais-live-vessels"]');
    setText(row?.querySelector?.('.data-name'), 'AIS vessels');
    const toggle = row?.querySelector?.('.data-toggle-btn');
    const renderedState = toggle?.dataset?.feedState || row?.dataset?.feedState;
    const stats =
      typeof getAisStats === 'function'
        ? getAisStats()
        : {
            feedState: renderedState,
            enabled: renderedState === 'off' ? false : undefined,
            error: ['unavailable', 'degraded', 'stale', 'fallback'].includes(
              renderedState,
            )
              ? row?.querySelector?.('.data-toggle-meta')?.textContent
              : undefined,
          };
    const availability = describeAisAvailability(stats || {});
    setText(badge, availability.label);
    setText(explanation, availability.detail);
    if (banner.dataset.aisStatus !== availability.status)
      banner.dataset.aisStatus = availability.status;
    const hidden = !inline && chatPanelOpen(doc);
    if (banner.hidden !== hidden) banner.hidden = hidden;
  };
  sync();
  const Observer =
    doc.defaultView?.MutationObserver || globalThis.MutationObserver;
  const observer = typeof Observer === 'function' ? new Observer(sync) : null;
  observer?.observe(doc.body || doc.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-feed-state', 'data-open', 'hidden'],
  });
  // Attribute/text writes are conditional so observing the disclosure itself
  // settles after a change instead of spinning a MutationObserver feedback loop.
  const destroy = () => {
    if (stopped) return;
    stopped = true;
    observer?.disconnect();
    banner.remove();
  };
  banner.destroy = destroy;
  banner.update = sync;
  banner.addEventListener('gev:serverless-notice-dismissed', destroy, {
    once: true,
  });
  return banner;
}

/** Selectors of the chat surfaces the notice must never cover. */
const CHAT_PANEL_SELECTORS = ['#ondemand-mini-chat', '#ondemand-entity-chat'];

/**
 * True when an ASK ONDEMAND panel is currently open (`data-open="true"` or
 * simply not hidden).
 * @param {Document} doc
 */
function chatPanelOpen(doc) {
  for (const selector of CHAT_PANEL_SELECTORS) {
    const panel = doc.querySelector?.(selector);
    if (!panel) continue;
    if (panel.getAttribute?.('data-open') === 'true') return true;
    if (panel.getAttribute?.('data-open') === null && panel.hidden === false)
      return true;
  }
  return false;
}

/**
 * Hide the banner while a chat panel is open and restore it when the panel
 * closes. The panels are appended lazily to <body>, so one observer watches
 * the body's direct children (not the whole subtree — the HUD rewrites text
 * every frame) and attaches an attribute observer (`hidden`, `data-open`) to
 * each panel the first time it appears; `gev:ask-object` is the fast path.
 * Exported for unit tests.
 * @param {HTMLElement} banner
 * @param {Document} [doc]
 * @returns {() => void} disconnect
 */
function syncWithChatPanels(banner, doc = document) {
  const apply = () => {
    banner.hidden = chatPanelOpen(doc);
  };
  apply();
  const observers = [];
  const Observer = globalThis.MutationObserver;
  const root = doc.body || doc.documentElement;
  const watched = new Set();
  const watchPanels = () => {
    for (const selector of CHAT_PANEL_SELECTORS) {
      const panel = doc.querySelector?.(selector);
      if (!panel || watched.has(panel)) continue;
      watched.add(panel);
      if (typeof Observer === 'function') {
        const o = new Observer(apply);
        o.observe(panel, {
          attributes: true,
          attributeFilter: ['hidden', 'data-open'],
        });
        observers.push(o);
      }
    }
    apply();
  };
  watchPanels();
  if (typeof Observer === 'function' && root) {
    const bodyObserver = new Observer(watchPanels);
    bodyObserver.observe(root, { childList: true });
    observers.push(bodyObserver);
  }
  const onAsk = () => {
    // The panel flips data-open inside the listener that runs after ours;
    // defer one tick so apply() sees the new state.
    setTimeout(watchPanels, 0);
  };
  globalThis.addEventListener?.('gev:ask-object', onAsk);
  return () => {
    for (const o of observers) o.disconnect?.();
    globalThis.removeEventListener?.('gev:ask-object', onAsk);
  };
}

export {
  installServerlessNotice,
  isServerlessBuild,
  chatPanelOpen,
  syncWithChatPanels,
};
