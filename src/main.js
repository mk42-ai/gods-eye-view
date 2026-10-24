import { installWorkstation } from './ui/workstation.js';
import { purgeStaleServiceWorkers } from './ui/staleServiceWorkers.js';

// 2026-10-24: this app never registers a service worker. Any registration or
// Cache Storage entry left by an older build (or another app on the same
// origin) would pin stale bundles, so it is removed on every start.
purgeStaleServiceWorkers();

// Mount navigation, source preferences, location and the existing standard chat
// BEFORE importing Cesium or waiting for any provider. A graphics failure must
// never hide the only recovery control behind the loading overlay.
const workstation = installWorkstation();
if (new URLSearchParams(location.search).get('fixtures') === '1') {
  const label = document.createElement('span');
  label.className = 'workstation-fixture-label';
  label.textContent = 'TEST FIXTURES — not live data';
  document.getElementById('workstation-header').appendChild(label);
}
let application;
let startupTimer;

async function loadCesium() {
  if (window.Cesium) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/cesium/Cesium.js';
    script.async = true;
    const timer = setTimeout(() => {
      script.remove();
      reject(new Error('Graphics library did not load within 8 seconds'));
    }, 8000);
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Graphics library could not be downloaded'));
    };
    document.head.appendChild(script);
  });
}

async function start() {
  startupTimer = setTimeout(
    () =>
      workstation.useFallback(
        'The 3D map is taking longer than 12 seconds. Continue with the 2D map and standard chat, or retry 3D.',
      ),
    12000,
  );
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) throw new Error('WebGL is unsupported or disabled');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    await loadCesium();
    const { createStandaloneApplication } =
      await import('./standalone/application.js');
    application = createStandaloneApplication({
      // No credentials enter the browser bundle. Keyless imagery/terrain are
      // optional; authenticated providers continue through server routes.
      allowQaRegistration: import.meta.env.DEV,
    });
    const components = await application.start();
    clearTimeout(startupTimer);
    workstation.ready(components);
    const { installOndemandVoice } = await import('./voice/ondemand/index.js');
    installOndemandVoice({ components });
  } catch (error) {
    clearTimeout(startupTimer);
    // Expected capability/network failures are shown to the operator, not an
    // uncaught rejection or a permanent full-screen spinner.
    console.warn(
      '[Workstation] 3D unavailable:',
      error?.message || String(error),
    );
    document.querySelector('.cesium-widget-errorPanel')?.remove();
    workstation.useFallback(
      `3D unavailable: ${error?.message || 'initialization failed'}. Your location tools, Sources and standard chat remain available.`,
    );
  }
}
void start();
export { application };
