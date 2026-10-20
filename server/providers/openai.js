import { defaultSourceRoot } from './common/source-root.js';
import { createDebugLogHandler } from './openai/debug-log.js';
import { createRealtimeTokenHandler } from './openai/realtime.js';

/**
 * Vite plugin: OpenAI Realtime ephemeral client secret.
 *
 * Keeps OPENAI_API_KEY server-side while the browser connects to the
 * Realtime API over WebRTC with a short-lived secret.
 */
function openAiRealtimeProxy({
  sourceRoot = defaultSourceRoot,
  annotationGuidance,
  realtime = {},
} = {}) {
  function install(middlewares) {
    // /api/openai/hud-summary RETIRED 2026-10-20 (BLOCKERS B-7): the HUD
    // summary is served by /api/ondemand/v2/summaries/hud on the OnDemand
    // fulfilment endpoint (server/ondemand/foundation/proxy-route.js).
    middlewares.use('/api/openai/hud-summary', (req, res) => {
      res.statusCode = 410;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(
        JSON.stringify({
          error: 'gone',
          replacement: '/api/ondemand/v2/summaries/hud',
        }),
      );
    });

    middlewares.use(
      '/api/realtime/debug-log',
      createDebugLogHandler({ sourceRoot }),
    );

    middlewares.use(
      '/api/realtime/token',
      createRealtimeTokenHandler({ ...realtime, annotationGuidance }),
    );
  }

  return {
    name: 'openai-realtime-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

export { openAiRealtimeProxy };
