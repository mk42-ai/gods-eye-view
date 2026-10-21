import { PRODUCT_NAME } from './brand/productName.js';
/**
 * Serverless-deployment notice banner.
 *
 * `VITE_SERVERLESS_MODE` is a Vite build-time flag (set for the build the
 * Vercel deployment runs — see vercel.json's `buildCommand`). When it is on,
 * a couple of features that need a persistent server process instead of a
 * Vercel Function — the live-vessel AISStream relay
 * (src/sources/live/standalone.js `createAisStreamSource`) —
 * is short-circuited at its source rather than left to
 * fail per-request against an endpoint that can only ever answer 501
 * (see server/serverless/app.js). Voice control is routed through OnDemand.
 * This module is the user-visible half
 * of that: a small, dismissible, non-blocking banner naming what is off.
 *
 * Deliberately imported ONLY from src/main.js. Nothing else in the app
 * reaches this module, so it never has to satisfy
 * scripts/check-import-directions.mjs's portable-export / browser-global
 * rules for any Node-reachable graph (package.json's `exports` map has no
 * entry pointing here) — see that script's `portableExport` roots.
 */

const DISMISSED_KEY = 'gev.serverlessNoticeDismissed';

/** True only in a build produced with VITE_SERVERLESS_MODE=true (see vercel.json). */
function isServerlessBuild() {
  return ['true', '1', 'yes'].includes(
    String(import.meta.env?.VITE_SERVERLESS_MODE ?? '').toLowerCase(),
  );
}

/**
 * Inject the notice banner, once, when this is a serverless build. No-op
 * (returns null) otherwise, or if the visitor already dismissed it this
 * session.
 * @param {Document} [doc]
 * @returns {HTMLElement|null}
 */
function installServerlessNotice(doc = document) {
  if (!isServerlessBuild()) return null;
  try {
    if (window.sessionStorage?.getItem(DISMISSED_KEY) === '1') return null;
  } catch {
    /* storage may be unavailable (private browsing); show the notice anyway */
  }

  const banner = doc.createElement('div');
  banner.setAttribute('role', 'status');
  banner.setAttribute('data-gev-serverless-notice', '');
  // Stacking: the notice is informational and must never intercept input
  // meant for the ASK ONDEMAND panels (#ondemand-mini-chat z-index 186,
  // #ondemand-entity-chat 185, src/ui/styles/ondemand-chat.css) or the key
  // setup dialog (190). It used to sit at z-index 2147483000, which at
  // 390×844 covered the mini chat's composer (input + SEND) so real taps never
  // reached it (sandbox-verify-2026-10-21/retry-0917, agents 1–3). It now
  // stacks BELOW those surfaces; when a chat panel is open the banner is
  // hidden outright (see `syncWithChatPanels`) and comes back once it closes.
  banner.style.cssText = [
    'position:fixed',
    'left:12px',
    'right:12px',
    'bottom:12px',
    'z-index:180',
    'max-width:640px',
    'margin:0 auto',
    'padding:10px 14px',
    'border-radius:8px',
    'background:rgba(20,20,24,0.92)',
    'color:#f2f2f2',
    'font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
    'box-shadow:0 4px 18px rgba(0,0,0,0.35)',
    'display:flex',
    'align-items:flex-start',
    'gap:10px',
  ].join(';');

  const text = doc.createElement('span');
  text.style.cssText = 'flex:1 1 auto';
  text.textContent =
    `${PRODUCT_NAME} is running as a serverless deployment: live vessels ` +
    '(AISStream relay) need a persistent server and are turned off here. ' +
    'Voice control is available through OnDemand.';
  banner.appendChild(text);

  const dismiss = doc.createElement('button');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.textContent = '\u00d7';
  dismiss.style.cssText =
    'flex:0 0 auto;background:transparent;border:0;color:inherit;' +
    'font-size:16px;line-height:1;cursor:pointer;padding:0 2px';
  dismiss.addEventListener('click', () => {
    banner.remove();
    banner.dispatchEvent?.(new Event('gev:serverless-notice-dismissed'));
    try {
      window.sessionStorage?.setItem(DISMISSED_KEY, '1');
    } catch {
      /* ignore */
    }
  });
  banner.appendChild(dismiss);

  (doc.body || doc.documentElement).appendChild(banner);
  const stopSync = syncWithChatPanels(banner, doc);
  banner.addEventListener('gev:serverless-notice-dismissed', stopSync, {
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
