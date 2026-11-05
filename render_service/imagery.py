"""Ortho imagery for the bounded patch (CPU side, render host).

BlenderGIS-style basemap import: XYZ tiles are fetched for the patch bounds,
stitched into one JPEG and registered to the per-origin local metre frame
with an affine (local X/Y -> normalised U/V). The image is a *ground texture*
only — geometry still comes exclusively from OSM + Copernicus DSM.

Providers (first that answers wins, provenance recorded):
  1. Esri World Imagery (the BlenderGIS default basemap). Attribution required;
     NOT an open licence — visual context only, never evidence.
  2. EOX Sentinel-2 cloudless 2020 (CC BY-NC-SA 4.0, ~10 m) as an open fallback.
A wider, coarser "context" image is produced for the scenery skirt around the
patch so the geographic tile blends into its surroundings.
"""
from __future__ import annotations
import hashlib, io, json, math, os, time
from concurrent.futures import ThreadPoolExecutor
import requests
from PIL import Image
import geography as G

ROOT = os.environ.get("GEV_ROOT", "/localstorage/mk.thomas/gev")
CACHE = os.path.join(ROOT, "cache", "imagery")
PROVIDERS = [
    {"id": "esri-world-imagery", "name": "Esri World Imagery",
     "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
     "attribution": "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
     "licence": "Esri World Imagery terms of use (attribution required; not an open licence; visual context only)",
     "maxZoom": 19},
    {"id": "eox-s2cloudless-2020", "name": "EOX Sentinel-2 cloudless 2020",
     "url": "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg",
     "attribution": "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2020)",
     "licence": "CC BY-NC-SA 4.0", "maxZoom": 15},
]

class ImageryError(RuntimeError):
    pass

def _tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n
    return x, y

def _fetch(url, timeout=12):
    r = requests.get(url, timeout=timeout, headers=G.UA)
    if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image"):
        raise ImageryError(f"tile http {r.status_code}")
    return r.content

def mosaic(bounds, zoom, tag, max_tiles=144):
    """Return dict(file, width, height, x0, y0, zoom, provider...) for lon/lat bounds."""
    w, s, e, n = bounds
    os.makedirs(CACHE, exist_ok=True)
    for provider in PROVIDERS:
        z = min(zoom, provider["maxZoom"])
        x0f, y0f = _tile_xy(w, n, z); x1f, y1f = _tile_xy(e, s, z)
        tx0, ty0, tx1, ty1 = int(x0f), int(y0f), int(x1f), int(y1f)
        while (tx1 - tx0 + 1) * (ty1 - ty0 + 1) > max_tiles and z > 10:
            z -= 1
            x0f, y0f = _tile_xy(w, n, z); x1f, y1f = _tile_xy(e, s, z)
            tx0, ty0, tx1, ty1 = int(x0f), int(y0f), int(x1f), int(y1f)
        key = hashlib.sha256(json.dumps([provider["id"], z, tx0, ty0, tx1, ty1]).encode()).hexdigest()[:24]
        path = os.path.join(CACHE, f"{tag}_{key}.jpg")
        meta_path = path + ".json"
        if os.path.isfile(path) and os.path.isfile(meta_path):
            with open(meta_path) as f:
                return json.load(f)
        tiles = [(x, y) for y in range(ty0, ty1 + 1) for x in range(tx0, tx1 + 1)]
        started = time.time()
        try:
            with ThreadPoolExecutor(max_workers=8) as pool:
                data = list(pool.map(lambda t: _fetch(provider["url"].format(z=z, x=t[0], y=t[1])), tiles))
        except Exception:
            continue
        size = 256
        img = Image.new("RGB", ((tx1 - tx0 + 1) * size, (ty1 - ty0 + 1) * size))
        hasher = hashlib.sha256()
        for (x, y), blob in zip(tiles, data):
            hasher.update(blob)
            with Image.open(io.BytesIO(blob)) as tile:
                img.paste(tile.convert("RGB").resize((size, size)), ((x - tx0) * size, (y - ty0) * size))
        tmp = path + ".tmp.jpg"
        img.save(tmp, "JPEG", quality=88)
        os.replace(tmp, path)
        meta = {"file": path, "width": img.width, "height": img.height, "zoom": z, "tileX0": tx0, "tileY0": ty0,
                "tiles": len(tiles), "provider": provider["id"], "providerName": provider["name"],
                "attribution": provider["attribution"], "licence": provider["licence"],
                "tileUrlTemplate": provider["url"], "bounds": bounds, "sourceSha256": hasher.hexdigest(),
                "retrievedUtc": G.utc(), "fetchSeconds": round(time.time() - started, 2),
                "use": "ground texture draped on DSM/OSM geometry; visual context only, not evidence"}
        with open(meta_path, "w") as f:
            json.dump(meta, f)
        return meta
    raise ImageryError("no imagery provider answered for patch bounds")

def affine(meta, origin):
    """Affine local metres (x east, y north) -> normalised UV (v up) for this mosaic."""
    frame = G.Frame(origin["lat"], origin["lon"])
    z = meta["zoom"]
    def uv(x, y):
        lon, lat = frame.inverse.transform(x, y)
        px, py = _tile_xy(lon, lat, z)
        return ((px - meta["tileX0"]) * 256 / meta["width"], 1 - (py - meta["tileY0"]) * 256 / meta["height"])
    u0, v0 = uv(0, 0); ux, vx = uv(100, 0); uy, vy = uv(0, 100)
    return [(ux - u0) / 100, (uy - u0) / 100, u0, (vx - v0) / 100, (vy - v0) / 100, v0]

def patch_imagery(patch, skirt_m=2500):
    """Fine imagery for the patch + coarse context imagery for the scenery skirt."""
    w, s, e, n = patch["bounds"]
    width_m = abs(G.GEOD.inv(w, (s + n) / 2, e, (s + n) / 2)[2])
    zoom = 18 if width_m <= 900 else 17
    fine = mosaic([w, s, e, n], zoom, "patch")
    lat = (s + n) / 2
    dlat = skirt_m / 111320.0; dlon = skirt_m / (111320.0 * math.cos(math.radians(lat)))
    context = mosaic([w - dlon, s - dlat, e + dlon, n + dlat], 15, "context", max_tiles=100)
    origin = patch["origin"]
    return {"fine": {**fine, "affine": affine(fine, origin)},
            "context": {**context, "affine": affine(context, origin)}, "skirtM": skirt_m,
            "limitations": ["Ortho imagery is draped as a ground/roof texture only; it is not used to create or move geometry.",
                            "Imagery capture date is unknown/provider-defined; it may not reflect current conditions."]}
