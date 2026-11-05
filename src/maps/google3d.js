const clean = (value) => String(value || '').trim();

const DEFAULT_TILESET_CACHE_BYTES = 768 * 1024 * 1024;
const DEFAULT_MAXIMUM_CACHE_OVERFLOW_BYTES = 256 * 1024 * 1024;

/**
 * Decide which map provider can deliver the best startup experience.
 * @param {{googleApiKey?: string, cesiumToken?: string}} credentials
 * @returns {'google-direct'|'google-ion'|'osm'}
 */
export function selectMapStartupRoute({
  googleApiKey = '',
  cesiumToken = '',
} = {}) {
  if (clean(googleApiKey)) return 'google-direct';
  if (clean(cesiumToken)) return 'google-ion';
  return 'osm';
}

/**
 * Load Google Photorealistic 3D Tiles through direct Google access when
 * configured, otherwise through Cesium ion's hosted Google asset. If the
 * direct request fails and an ion token is available, ion is the recovery path.
 *
 * @param {object} Cesium
 * @param {{googleApiKey?: string, cesiumToken?: string, tilesetOptions?: object}} credentials
 * @returns {Promise<{tileset: object|null, route: 'google-direct'|'google-ion'|'osm', errors: Error[]}>}
 */
export async function loadPhotorealisticTileset(
  Cesium,
  { googleApiKey = '', cesiumToken = '', tilesetOptions = {} } = {},
) {
  const googleKey = clean(googleApiKey);
  const ionToken = clean(cesiumToken);
  const errors = [];

  const attempts = [];
  if (googleKey) attempts.push({ route: 'google-direct', googleKey });
  if (ionToken) attempts.push({ route: 'google-ion', googleKey: undefined });

  for (const attempt of attempts) {
    try {
      const tileset = attempt.googleKey
        ? await createGoogleDirectTileset(
            Cesium,
            attempt.googleKey,
            tilesetOptions,
          )
        : await createGoogleIonTileset(Cesium, ionToken, { tilesetOptions });
      return { tileset, route: attempt.route, errors };
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  return { tileset: null, route: 'osm', errors };
}

/** Pass credentials to the source instead of changing SDK-wide defaults. */
export async function createGoogleDirectTileset(
  Cesium,
  key,
  tilesetOptions = {},
) {
  key = clean(key);
  if (!key) throw new Error('Google 3D requires an explicit browser key');
  const cacheBytes = tilesetOptions.cacheBytes ?? DEFAULT_TILESET_CACHE_BYTES;
  const maximumCacheOverflowBytes =
    tilesetOptions.maximumCacheOverflowBytes ??
    DEFAULT_MAXIMUM_CACHE_OVERFLOW_BYTES;
  const opts = {
    cacheBytes,
    maximumCacheOverflowBytes,
    enableCollision: true,
    ...tilesetOptions,
  };
  const tileset = await Cesium.createGooglePhotorealistic3DTileset(
    {
      key,
      onlyUsingWithGoogleGeocoder: true,
    },
    opts,
  );
  if (tileset) {
    tileset.cacheBytes = cacheBytes;
    tileset.maximumCacheOverflowBytes = maximumCacheOverflowBytes;
  }
  return tileset;
}

export async function createGoogleIonTileset(
  Cesium,
  accessToken,
  { signal, tilesetOptions = {} } = {},
) {
  accessToken = clean(accessToken);
  if (!accessToken)
    throw new Error('Google 3D through ion requires an explicit token');
  signal?.throwIfAborted();
  const resource = await Cesium.IonResource.fromAssetId(2275207, {
    accessToken,
  });
  signal?.throwIfAborted();
  const cacheBytes = tilesetOptions.cacheBytes ?? DEFAULT_TILESET_CACHE_BYTES;
  const maximumCacheOverflowBytes =
    tilesetOptions.maximumCacheOverflowBytes ??
    DEFAULT_MAXIMUM_CACHE_OVERFLOW_BYTES;
  const tileset = await Cesium.Cesium3DTileset.fromUrl(resource, {
    cacheBytes,
    maximumCacheOverflowBytes,
    enableCollision: true,
    ...tilesetOptions,
  });
  if (tileset) {
    tileset.cacheBytes = cacheBytes;
    tileset.maximumCacheOverflowBytes = maximumCacheOverflowBytes;
  }
  return tileset;
}
