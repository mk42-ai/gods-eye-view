/**
 * Browser-safe asset registry wrapping assetIds.js.
 * Handles sprite and model resolution, substitutions, preloading, and asset events.
 */
import {
  ASSET_KIND,
  ASSET_IDS,
  resolveAssetId,
  spriteUrl,
  modelUrl,
  getAsset,
} from './assetIds.js';
import { iconWithBackplate } from '../scenes/iconBillboard.js';

/**
 * Create an asset registry instance.
 *
 * @param {object} [options]
 * @param {Function} [options.fetchImpl]
 * @param {Function} [options.log]
 * @param {Function} [options.onEvent] Callback for SSE/runtime events: (event, data) => void
 */
export function createAssetRegistry({
  fetchImpl = globalThis.fetch,
  log = console.log,
  onEvent,
} = {}) {
  /** @type {Set<string>} */
  const unavailable = new Set();

  /** @type {Array<{requested:string, resolved:string, reason?:string, at:number}>} */
  const substitutionHistory = [];

  function emit(eventName, data) {
    if (typeof onEvent === 'function') {
      try {
        onEvent(eventName, data);
      } catch (err) {
        log?.(`[assetRegistry] onEvent error: ${err.message}`);
      }
    }
  }

  function resolve(id) {
    const result = resolveAssetId(id, { unavailable });
    if (result.substituted) {
      substitutionHistory.push({
        requested: result.requested,
        resolved: result.asset.id,
        reason: result.reason,
        at: Date.now(),
      });
    }
    return result;
  }

  function markUnavailable(id, reason = 'load_failed') {
    unavailable.add(id);
    const resolved = resolve(id);
    emit('asset.ready', {
      assetId: id,
      substituted: true,
      resolvedId: resolved.asset.id,
      reason: reason || resolved.reason,
    });
    return resolved;
  }

  function billboardFor(
    assetId,
    {
      scale = 2,
      document: doc = globalThis.document,
      width = doc ? 36 : 32,
      height = doc ? 36 : 32,
    } = {},
  ) {
    const resolved = resolve(assetId);
    let asset = resolved.asset;
    let substituted = resolved.substituted;

    // If resolved asset is a model, fall back to its sprite fallback
    if (asset && asset.kind === ASSET_KIND.MODEL) {
      const fallbackId = asset.fallback || 'sprite.generic';
      const fallbackResolved = resolve(fallbackId);
      asset = fallbackResolved.asset;
      substituted = true;
    }

    const rawUrl = spriteUrl(asset, scale) || '/scene-icons/png/generic@2x.png';
    let image = rawUrl;

    if (doc && typeof doc.createElement === 'function') {
      const key =
        asset?.key ||
        (asset?.id
          ? asset.id.replace(/^sprite\./, '').replace(/\./g, '_')
          : 'generic');
      const canvas = iconWithBackplate(doc, rawUrl, { sizePx: width, key });
      if (canvas) {
        image = canvas;
      }
    }

    return {
      image,
      width,
      height,
      substituted,
      asset,
    };
  }

  function modelFor(assetId) {
    const resolved = resolve(assetId);
    const asset = resolved.asset;
    if (asset && asset.kind === ASSET_KIND.MODEL) {
      return {
        uri: modelUrl(asset),
        asset,
        substituted: resolved.substituted,
      };
    }
    return null;
  }

  function substitutions() {
    return [...substitutionHistory];
  }

  async function preload(ids = []) {
    const ready = [];
    const failed = [];

    for (const id of ids) {
      emit('asset.loading', { assetId: id });

      const resolved = resolve(id);
      const asset = resolved.asset;
      const targetUrl =
        asset.kind === ASSET_KIND.MODEL ? modelUrl(asset) : spriteUrl(asset, 2);

      let success = false;
      let failureReason = '';

      if (typeof fetchImpl !== 'function') {
        // In environments without fetch, mark ready if known asset
        success = Boolean(asset);
      } else {
        try {
          let res = await fetchImpl(targetUrl, { method: 'HEAD' });
          if (res && (res.status === 405 || res.status === 501)) {
            // Server might not support HEAD
            res = await fetchImpl(targetUrl, { method: 'GET' });
          }
          if (res && (res.ok || res.status === 304)) {
            success = true;
          } else {
            failureReason = `HTTP ${res?.status || 0}`;
          }
        } catch (err) {
          failureReason = err.message || 'fetch_error';
        }
      }

      if (success) {
        ready.push(id);
        emit('asset.ready', {
          assetId: id,
          substituted: resolved.substituted,
          ...(resolved.reason ? { reason: resolved.reason } : {}),
        });
      } else {
        unavailable.add(id);
        failed.push({ id, reason: failureReason });
        const fallbackResolved = resolve(id);
        emit('asset.ready', {
          assetId: id,
          substituted: true,
          resolvedId: fallbackResolved.asset.id,
          reason: failureReason,
        });
      }
    }

    return { ready, failed };
  }

  return {
    resolve,
    billboardFor,
    modelFor,
    substitutions,
    preload,
    markUnavailable,
    isUnavailable: (id) => unavailable.has(id),
    emit,
  };
}
