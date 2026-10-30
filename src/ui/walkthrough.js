/**
 * Driver.js guided walkthrough module for God's Eye View
 *
 * Implements a light, skippable walkthrough of key app interactions:
 * - AOI search box
 * - Recording window
 * - Scene builder submit
 * - Footage drawer
 * - Scenes drawer
 * - Plugins chip
 * - Voice microphone
 */
import { CircleHelp } from 'lucide';

export const WALKTHROUGH_STORAGE_KEY = 'gev:walkthrough:v1';

export const WALKTHROUGH_STEPS = Object.freeze([
  Object.freeze({
    id: 'aoi',
    element: '#incident-composer-input',
    title: 'Type a place',
    description: 'Start here. Type a place in the UAE, such as Dubai Marina.'
  }),
  Object.freeze({
    id: 'window',
    element: '#incident-composer-window',
    title: 'Recording window',
    description: 'Choose how far back to look for footage (UTC).'
  }),
  Object.freeze({
    id: 'build',
    element: '#incident-composer-submit',
    title: 'Build scene',
    description: 'Frames the camera on the place and gathers footage.'
  }),
  Object.freeze({
    id: 'footage',
    element: '#scene-footage',
    title: 'Footage panel',
    description: 'Pick a clip, check its source and upload time. Footage appears after a scene is built.'
  }),
  Object.freeze({
    id: 'scenes',
    element: '#sidebar-scenes-tab',
    title: 'Scenes drawer',
    description: 'Name and save a scene to reopen it later.'
  }),
  Object.freeze({
    id: 'plugins',
    element: '#od-plugins-chip',
    title: 'Plugins',
    description: 'See which data plugins are ready and verify them in one go.'
  }),
  Object.freeze({
    id: 'mic',
    element: '#od-voice-button',
    title: 'Mic',
    description: 'Talk to the map instead of typing.'
  })
]);

export function shouldAutoStart({ storage, location } = {}) {
  if (location && typeof location.search === 'string') {
    try {
      const search = location.search.startsWith('?') ? location.search : `?${location.search}`;
      const params = new URLSearchParams(search);
      if (params.get('tour') === '1') {
        return true;
      }
      if (params.get('tour') === '0') {
        return false;
      }
    } catch {
      // Ignore search parsing errors
    }
  }

  if (storage) {
    try {
      if (typeof storage.getItem === 'function') {
        const value = storage.getItem(WALKTHROUGH_STORAGE_KEY);
        if (value === 'dismissed') {
          return false;
        }
      }
    } catch {
      // Throwing storage means "show", fall through to true
    }
  }

  return true;
}

export function setWalkthroughDismissed(dismissed, storage) {
  const store = storage !== undefined ? storage : (typeof window !== 'undefined' ? window.localStorage : null);
  if (!store) return;
  try {
    if (dismissed) {
      if (typeof store.setItem === 'function') {
        store.setItem(WALKTHROUGH_STORAGE_KEY, 'dismissed');
      }
    } else {
      if (typeof store.removeItem === 'function') {
        store.removeItem(WALKTHROUGH_STORAGE_KEY);
      }
    }
  } catch {
    // Ignore storage write errors (e.g. quota, private browsing)
  }
}

export function resolveSteps(steps, documentRef) {
  const doc = documentRef !== undefined ? documentRef : (typeof document !== 'undefined' ? document : null);
  const stepList = steps || WALKTHROUGH_STEPS;

  return stepList.map((step) => {
    let el = null;
    if (doc && typeof doc.querySelector === 'function' && step.element) {
      try {
        el = doc.querySelector(step.element);
      } catch {
        el = null;
      }
    }

    let isVisible = false;
    if (el) {
      let isHidden = false;
      const hasOffsetParent = 'offsetParent' in el;
      const hasGetClientRects = typeof el.getClientRects === 'function';

      if (hasOffsetParent && el.offsetParent === null) {
        if (hasGetClientRects) {
          if (el.getClientRects().length === 0) {
            isHidden = true;
          }
        }
      }
      isVisible = !isHidden;
    }

    const popover = {
      title: step.title,
      description: step.description
    };

    if (el && isVisible) {
      return {
        element: step.element,
        popover
      };
    }

    return {
      popover
    };
  });
}

// Driver.js (MIT) is code-split: its JS is fetched only when the tour runs.
// Its 4 KB base stylesheet is bundled via src/ui/styles/walkthrough.css.
const defaultLoadDriver = () => Promise.all([import('driver.js'), Promise.resolve({})]);

let activeTourInstance = null;
let activeTourPromise = null;

export async function startWalkthrough({
  document: docRef,
  window: winRef,
  storage: storageRef,
  loadDriver = defaultLoadDriver
} = {}) {
  if (activeTourInstance) {
    const isStillActive = typeof activeTourInstance.isActive === 'function'
      ? activeTourInstance.isActive()
      : true;
    if (isStillActive) {
      return activeTourInstance;
    }
    activeTourInstance = null;
  }

  if (activeTourPromise) {
    return activeTourPromise;
  }

  activeTourPromise = (async () => {
    try {
      const doc = docRef !== undefined ? docRef : (typeof document !== 'undefined' ? document : null);
      const stor = storageRef !== undefined ? storageRef : (typeof window !== 'undefined' ? window.localStorage : null);

      const [driverModule] = await loadDriver();
      const driverFactory = driverModule?.driver || driverModule?.default || driverModule;
      if (typeof driverFactory !== 'function') {
        throw new Error('driver.js failed to load a driver factory');
      }

      const steps = resolveSteps(WALKTHROUGH_STEPS, doc);

      let driverInstance = null;

      const cleanup = () => {
        if (doc?.body?.dataset) {
          delete doc.body.dataset.tour;
        }
        if (activeTourInstance === driverInstance) {
          activeTourInstance = null;
        }
      };

      const config = {
        steps,
        showProgress: true,
        allowClose: true,
        overlayOpacity: 0.55,
        stagePadding: 6,
        stageRadius: 8,
        popoverClass: 'gev-tour',
        nextBtnText: 'Next',
        prevBtnText: 'Back',
        doneBtnText: 'Done',
        progressText: '{{current}} of {{total}}',
        onPopoverRender(popover, hookOpts) {
          if (!popover || !popover.footer || !doc) return;

          const existingDismiss = popover.footer.querySelector
            ? popover.footer.querySelector('[data-tour-dismiss]')
            : null;
          const existingSkip = popover.footer.querySelector
            ? popover.footer.querySelector('[data-tour-skip]')
            : null;
          if (existingDismiss || existingSkip) return;

          const label = doc.createElement('label');
          label.className = 'gev-tour__dismiss';

          const checkbox = doc.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.setAttribute('data-tour-dismiss', '');

          let isDismissed = false;
          try {
            if (stor && typeof stor.getItem === 'function') {
              isDismissed = stor.getItem(WALKTHROUGH_STORAGE_KEY) === 'dismissed';
            }
          } catch {
            isDismissed = false;
          }
          checkbox.checked = Boolean(isDismissed);

          checkbox.addEventListener('change', () => {
            setWalkthroughDismissed(checkbox.checked, stor);
          });

          label.appendChild(checkbox);
          if (typeof doc.createTextNode === 'function') {
            label.appendChild(doc.createTextNode(" Don't show this again"));
          } else {
            const span = doc.createElement('span');
            span.textContent = " Don't show this again";
            label.appendChild(span);
          }

          const skipBtn = doc.createElement('button');
          skipBtn.type = 'button';
          skipBtn.className = 'gev-tour__skip';
          skipBtn.setAttribute('data-tour-skip', '');
          skipBtn.textContent = 'Skip tour';
          skipBtn.addEventListener('click', () => {
            if (driverInstance && typeof driverInstance.destroy === 'function') {
              driverInstance.destroy();
            } else if (hookOpts?.driver && typeof hookOpts.driver.destroy === 'function') {
              hookOpts.driver.destroy();
            } else if (activeTourInstance && typeof activeTourInstance.destroy === 'function') {
              activeTourInstance.destroy();
            }
          });

          if (typeof popover.footer.prepend === 'function') {
            popover.footer.prepend(label, skipBtn);
          } else if (typeof popover.footer.insertBefore === 'function') {
            popover.footer.insertBefore(skipBtn, popover.footer.firstChild || null);
            popover.footer.insertBefore(label, skipBtn);
          } else if (typeof popover.footer.appendChild === 'function') {
            popover.footer.appendChild(label);
            popover.footer.appendChild(skipBtn);
          }
        },
        onDestroyed() {
          cleanup();
        }
      };

      if (doc?.body) {
        if (!doc.body.dataset) {
          doc.body.dataset = {};
        }
        doc.body.dataset.tour = 'active';
      }

      driverInstance = driverFactory(config);
      activeTourInstance = driverInstance;

      if (driverInstance && typeof driverInstance.destroy === 'function') {
        const origDestroy = driverInstance.destroy.bind(driverInstance);
        driverInstance.destroy = (...args) => {
          cleanup();
          return origDestroy(...args);
        };
      }

      if (driverInstance && typeof driverInstance.drive === 'function') {
        try {
          driverInstance.drive();
        } catch (err) {
          cleanup();
          throw err;
        }
      }

      return driverInstance;
    } finally {
      activeTourPromise = null;
    }
  })();

  return activeTourPromise;
}

export function installWalkthrough({
  document: docRef,
  window: winRef,
  storage: storageRef,
  autoStartDelayMs = 1200,
  autoStart = true,
  loadDriver: loadDriverFn
} = {}) {
  const doc = docRef !== undefined ? docRef : (typeof document !== 'undefined' ? document : null);
  const win = winRef !== undefined ? winRef : (typeof window !== 'undefined' ? window : null);
  let stor = storageRef;
  if (stor === undefined) {
    try {
      stor = win?.localStorage ?? (typeof window !== 'undefined' ? window.localStorage : null);
    } catch {
      stor = null;
    }
  }

  const start = () => {
    return startWalkthrough({
      document: doc,
      window: win,
      storage: stor,
      loadDriver: loadDriverFn
    });
  };

  let btn = doc?.getElementById ? doc.getElementById('gev-help-button') : null;
  let onBtnClick = null;

  if (!btn && doc && typeof doc.createElement === 'function') {
    btn = doc.createElement('button');
    btn.id = 'gev-help-button';
    btn.type = 'button';
    btn.className = 'gev-help-btn';
    btn.setAttribute('aria-label', 'Replay the guided walkthrough');
    btn.setAttribute('title', 'Help · replay walkthrough');

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS ? doc.createElementNS(svgNS, 'svg') : doc.createElement('svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.75');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');

    if (Array.isArray(CircleHelp)) {
      for (const [tag, attrs] of CircleHelp) {
        const child = doc.createElementNS ? doc.createElementNS(svgNS, tag) : doc.createElement(tag);
        if (attrs && typeof attrs === 'object') {
          for (const [key, val] of Object.entries(attrs)) {
            child.setAttribute(key, String(val));
          }
        }
        svg.appendChild(child);
      }
    }
    btn.appendChild(svg);
    if (doc.body && typeof doc.body.appendChild === 'function') {
      doc.body.appendChild(btn);
    }
  }

  if (btn && typeof btn.addEventListener === 'function') {
    onBtnClick = () => {
      start();
    };
    btn.addEventListener('click', onBtnClick);
  }

  let timerId = null;
  const setTimeoutFn = (win && typeof win.setTimeout === 'function') ? win.setTimeout.bind(win) : setTimeout;
  const clearTimeoutFn = (win && typeof win.clearTimeout === 'function') ? win.clearTimeout.bind(win) : clearTimeout;

  if (autoStart && shouldAutoStart({ storage: stor, location: win?.location })) {
    timerId = setTimeoutFn(() => {
      timerId = null;
      start();
    }, autoStartDelayMs);
  }

  const isActive = () => {
    if (activeTourInstance) {
      if (typeof activeTourInstance.isActive === 'function') {
        return Boolean(activeTourInstance.isActive());
      }
      return true;
    }
    if (doc?.body?.dataset?.tour === 'active') {
      return true;
    }
    return false;
  };

  if (win) {
    win.__gevWalkthrough = {
      start,
      steps: WALKTHROUGH_STEPS,
      isActive
    };
  }

  const destroy = () => {
    if (timerId !== null) {
      clearTimeoutFn(timerId);
      timerId = null;
    }
    if (btn) {
      if (onBtnClick && typeof btn.removeEventListener === 'function') {
        btn.removeEventListener('click', onBtnClick);
      }
      if (typeof btn.remove === 'function') {
        btn.remove();
      } else if (btn.parentNode && typeof btn.parentNode.removeChild === 'function') {
        btn.parentNode.removeChild(btn);
      }
      btn = null;
    }
    if (activeTourInstance && typeof activeTourInstance.destroy === 'function') {
      activeTourInstance.destroy();
    }
    if (win && win.__gevWalkthrough) {
      delete win.__gevWalkthrough;
    }
  };

  return {
    start,
    destroy
  };
}
