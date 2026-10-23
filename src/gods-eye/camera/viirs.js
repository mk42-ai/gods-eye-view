/**
 * NASA GIBS VIIRS City Lights night-lights layer.
 * Browser ES module — guarded against missing Cesium / viewer APIs.
 *
 * GIBS' EPSG:4326 "500m" matrix set uses 512-px tiles with a 2×1 root and
 * irregular matrix widths (2,3,5,10,…), which Cesium's GeographicTilingScheme
 * cannot address (TILECOL out of range → HTTP 400 per tile, verified
 * 2026-10-23). The EPSG:3857 `GoogleMapsCompatible_Level8` set is a standard
 * quadtree and matches WebMercatorTilingScheme exactly, so that is the one
 * requested here (RESTful tile template, verified 200 image/jpeg).
 */

export const VIIRS_CONFIG = Object.freeze({
  url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg',
  layer: 'VIIRS_CityLights_2012',
  style: 'default',
  format: 'image/jpeg',
  tileMatrixSetID: 'GoogleMapsCompatible_Level8',
  maximumLevel: 8,
  credit: 'NASA GIBS',
  alpha: 0.85,
});

export function createViirsLayer({ viewer, Cesium } = {}) {
  let imageryLayer = null;

  function show() {
    if (!viewer?.imageryLayers || !Cesium) return null;
    if (!imageryLayer) {
      try {
        const tilingScheme = Cesium.WebMercatorTilingScheme
          ? new Cesium.WebMercatorTilingScheme()
          : undefined;
        let provider = null;
        if (Cesium.WebMapTileServiceImageryProvider) {
          provider = new Cesium.WebMapTileServiceImageryProvider({
            url: VIIRS_CONFIG.url,
            layer: VIIRS_CONFIG.layer,
            style: VIIRS_CONFIG.style,
            format: VIIRS_CONFIG.format,
            tileMatrixSetID: VIIRS_CONFIG.tileMatrixSetID,
            tilingScheme,
            maximumLevel: VIIRS_CONFIG.maximumLevel,
            credit: VIIRS_CONFIG.credit,
          });
        }
        if (provider && viewer.imageryLayers.addImageryProvider) {
          imageryLayer = viewer.imageryLayers.addImageryProvider(provider);
          imageryLayer.alpha = VIIRS_CONFIG.alpha;
        }
      } catch {
        imageryLayer = null;
      }
    }
    if (imageryLayer) {
      imageryLayer.show = true;
    }
    return imageryLayer;
  }

  function hide() {
    if (imageryLayer) {
      imageryLayer.show = false;
    }
  }

  function isShown() {
    return Boolean(imageryLayer && imageryLayer.show);
  }

  function destroy() {
    if (imageryLayer && viewer?.imageryLayers?.remove) {
      try {
        viewer.imageryLayers.remove(imageryLayer);
      } catch {
        // ignore
      }
    }
    imageryLayer = null;
  }

  return {
    show,
    hide,
    isShown,
    destroy,
  };
}
