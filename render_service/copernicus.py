"""Direct free/open Copernicus GLO-90 COG source; no restricted API service.

Primary licence (2025-06 compilation), pp.19-21: GLO-90-F rights of
reproduction, distribution, communication and adaptation. The bundled tile
INFO/eula_F.pdf is for RESTRICTED GLO-30/EEA-10, not this GLO-90 dataset.
This module deliberately does not use the non-commercial Open-Meteo API.
"""
import copy
import hashlib
import io
import json
import math
import os
from pathlib import Path
import threading
import time
import requests
from PIL import Image
import terrain as T

BASE = 'https://copernicus-dem-90m.s3.amazonaws.com'
REGISTRY = 'https://registry.opendata.aws/copernicus-dem/'
LICENSE_URL = 'https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf'
NOTICE = 'produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved'
DISCLAIMER = 'The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-90.'
LOCK = threading.RLock()
TILES = {}
GRIDS = {}


def tile_parts(lat, lon):
    y, x = math.floor(lat), math.floor(lon)
    loc = f"{'N' if y >= 0 else 'S'}{abs(y):02d}_00_{'E' if x >= 0 else 'W'}{abs(x):03d}_00"
    stem = 'Copernicus_DSM_COG_30_' + loc + '_DEM'
    return stem, 'Copernicus_DSM_30_' + loc + '.xml'


def _get(url, limit):
    with requests.get(url, stream=True, timeout=(6, 35), headers={'User-Agent': 'OnDemand-Scene-Workstation/1.0 Copernicus-reader'}) as r:
        r.raise_for_status()
        content = bytearray()
        for chunk in r.iter_content(65536):
            content.extend(chunk)
            if len(content) > limit: raise T.TerrainError('copernicus_source_exceeds_size_limit')
        return bytes(content), {'etag': r.headers.get('ETag'), 'lastModified': r.headers.get('Last-Modified')}


def load_tile(lat, lon):
    stem, metadata = tile_parts(lat, lon)
    with LOCK:
        hit = TILES.get(stem)
        if hit and time.monotonic() - hit['at'] < 86400: return hit
        cache = Path(os.environ.get('GEV_ROOT', '/localstorage/mk.thomas/gev')) / 'cache' / 'copernicus90'
        cache.mkdir(parents=True, exist_ok=True)
        raster_path = cache / (stem + '.tif')
        meta_path = cache / (stem + '.json')
        url = f'{BASE}/{stem}/{stem}.tif'
        xml_url = f'{BASE}/{stem}/{metadata}'
        if raster_path.is_file() and meta_path.is_file() and time.time() - raster_path.stat().st_mtime < 86400:
            raw = raster_path.read_bytes(); info = json.loads(meta_path.read_text())
            if hashlib.sha256(raw).hexdigest() != info['sha256']: raise T.TerrainError('copernicus_cache_hash_mismatch')
        else:
            try:
                raw, headers = _get(url, 32 * 1024 * 1024)
                xml, _ = _get(xml_url, 256 * 1024)
            except requests.RequestException as exc:
                raise T.TerrainError('copernicus_source_unavailable: ' + type(exc).__name__) from exc
            datum = 'EGM2008 height (EPSG:3855)' if b'Geoid EGM08' in xml else None
            info = {'url': url, 'metadataUrl': xml_url, 'sha256': hashlib.sha256(raw).hexdigest(),
                    'metadataSha256': hashlib.sha256(xml).hexdigest(), 'verticalDatum': datum,
                    'retrievedUtc': T._utc(), **headers}
            temp = raster_path.with_suffix('.partial'); temp.write_bytes(raw); os.replace(temp, raster_path)
            meta_path.write_text(json.dumps(info))
        im = Image.open(io.BytesIO(raw))
        if im.format != 'TIFF' or im.mode != 'F' or max(im.size) > 5000: raise T.TerrainError('unsupported_copernicus_raster')
        scale, tie, keys = im.tag_v2.get(33550), im.tag_v2.get(33922), im.tag_v2.get(34735)
        if not scale or not tie or not keys: raise T.TerrainError('missing_copernicus_georeferencing')
        geo = {keys[i]: keys[i+3] for i in range(4, len(keys), 4) if keys[i+1] == 0}
        if geo.get(2048) != 4326 or geo.get(1025) != 2: raise T.TerrainError('copernicus_requires_WGS84_PixelIsPoint')
        im.load()
        hit = {'at': time.monotonic(), 'image': im, 'scale': scale, 'tie': tie, 'info': info,
               'nodata': im.tag_v2.get(42113)}
        TILES[stem] = hit
        while len(TILES) > 8: TILES.pop(next(iter(TILES)))
        files = sorted(cache.glob('*.tif'), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in files[8:]:
            old.unlink(missing_ok=True); old.with_suffix('.json').unlink(missing_ok=True)
        return hit


def sample_tile(tile, lat, lon):
    im, scale, tie = tile['image'], tile['scale'], tile['tie']
    px = (lon - tie[3]) / scale[0] + tie[0]
    py = (tie[4] - lat) / scale[1] + tie[1]
    if not (0 <= px < im.width - 1 and 0 <= py < im.height - 1):
        raise T.TerrainError('copernicus_tile_edge_interpolation_not_supported')
    x, y = math.floor(px), math.floor(py); u, v = px-x, py-y
    values = [float(im.getpixel(p)) for p in [(x,y),(x+1,y),(x,y+1),(x+1,y+1)]]
    if any(not math.isfinite(z) or not -1000 <= z <= 9000 for z in values): raise T.TerrainError('copernicus_nodata_sample')
    return (1-u)*(1-v)*values[0] + u*(1-v)*values[1] + (1-u)*v*values[2] + u*v*values[3]


def fetch_terrain(patch, rows=9, cols=9):
    request = T._prepare(patch, rows, cols)
    key = T._hash({'provider': BASE, 'dataset': 'GLO-90 2021', 'request': request})
    with LOCK:
        hit = GRIDS.get(key)
        if hit and time.monotonic()-hit[0] < 3600: return copy.deepcopy(hit[1])
    samples, sources = [], {}
    for lon, lat in request['coordinates']:
        tile = load_tile(lat, lon)
        samples.append(sample_tile(tile, lat, lon)); sources[tile['info']['url']] = tile['info']
    source_hash = T._hash(list(sources.values()))
    out = T._assemble(request, (samples, source_hash, BASE), key)
    datum = next(iter(sources.values()))['verticalDatum'] if len({v['verticalDatum'] for v in sources.values()}) == 1 else None
    out['originElevationBasis'] = 'Bilinear source-COG sample at the selected origin; subtract same datum from all local heights'
    out['elevation'].update(source=BASE, verticalDatum=datum, interpolation='Bilinear native COG sampling; piecewise triangular rendered surface')
    out['provenance'] = {'provider': 'Copernicus GLO-90 via AWS Open Data / Sinergise', 'url': REGISTRY,
        'dataset': 'Copernicus DEM GLO-90, 2021 release', 'nativeResolutionM': 90, 'sourceType': 'DSM, not bare-earth DTM',
        'sourceTiles': list(sources.values()), 'sourceSha256': source_hash, 'requestSha256': key,
        'retrievedUtc': max(v['retrievedUtc'] for v in sources.values()), 'queryBounds': patch['bounds'],
        'coordinateOrder': 'longitude latitude into WGS84 PixelIsPoint COG; east north up in local metres',
        'verticalDatum': datum, 'localInterpolation': 'bilinear samples, then triangulated DSM grid',
        'license': {'name': 'Copernicus GLO-90-F Free & Open licence', 'url': LICENSE_URL, 'pages': '19-21',
                    'attribution': NOTICE, 'liabilityNotice': DISCLAIMER, 'endorsement': 'No Copernicus endorsement is implied.'}}
    out['limitations'] = ['Coarse historical 90 m DSM includes buildings and vegetation; not surveyed bare-earth or road elevations.',
        'Building bases use surrounding DSM samples; source heights/levels are contributed and may be approximate.',
        'No bridge deck, tunnel, kerb, detailed lane, current construction or interior geometry is inferred.',
        'Densification adds no native resolution. Contact uses the same rendered triangular DSM mesh.', DISCLAIMER]
    with LOCK:
        GRIDS[key] = (time.monotonic(), copy.deepcopy(out))
        while len(GRIDS) > 32: GRIDS.pop(next(iter(GRIDS)))
    return out
