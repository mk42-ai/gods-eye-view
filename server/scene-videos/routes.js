/** Retired legacy archival/downloader endpoints.
 * This route intentionally performs zero upstream requests, including HEAD,
 * Range, redirects, DNS resolution and expired-URL refresh. Live research goes
 * through /scene/evidence and playback uses validated official embeds only.
 * Historical fixture orchestrators remain available to isolated unit tests;
 * they are not imported into the production request graph here.
 */
import { sendJson } from '../ondemand/http.js';
export function allowedMediaUrl() { return null; }
export function createSceneVideoRoutes() {
  return async function sceneVideoHandler(req, res, { path, method }) {
    if (!['/scene/videos', '/scene/media'].includes(path) || !['GET', 'POST', 'HEAD'].includes(method)) return false;
    sendJson(res, 410, {
      error: 'legacy_media_path_retired',
      replacement: '/api/ondemand/v2/scene/evidence',
      reason: 'Unverified archival fixtures, downloaders and arbitrary media proxying are disabled. Use source-backed recording evidence and official embeds.',
    });
    return true;
  };
}
