"""Bounded Copernicus DSM sampling; never replace unavailable data with zero.

Host: await fetch_terrain(patch, non_commercial=True), with httpx/pyproj/shapely.
Blender: import this file and use height_at() with ONLY the Python stdlib.
The free endpoint is for non-commercial use; acknowledgement is required.
Grid vertices cover localBounds. Use clippedMesh for the actual patch boundary.
See TERRAIN_INTEGRATION.md for datum, mesh interpolation and DSM limitations.
"""
from __future__ import annotations

import asyncio
from bisect import bisect_right
from collections import OrderedDict
import copy
from datetime import datetime, timezone
import hashlib
import json
import math
import threading
import time

SCHEMA = "copernicus-dsm-local-grid-v1"
ENDPOINT = "https://api.open-meteo.com/v1/elevation"
DOCUMENTATION_URL = "https://open-meteo.com/en/docs/elevation-api"
DATASET_URL = ("https://dataspace.copernicus.eu/explore-data/data-collections/"
               "copernicus-contributing-missions/collections-description/COP-DEM")
TERMS_URL = "https://open-meteo.com/en/terms"
DATASET = "Copernicus DEM GLO-90"
# The API advertises a year, not a subrelease/tile version. Do not infer 2021_1.
DATASET_VERSION = "2021 release (as advertised by Open-Meteo)"
DOCS_VERIFIED_DATE = "2026-11-05"
NATIVE_RESOLUTION_M = 90
MAX_GRID_SIDE = 9
MAX_PATCH_SIDE_M = 2500  # bounded 1200 m radius plus projection tolerance.
MAX_RESPONSE_BYTES = 65536
MAX_ATTEMPTS = 2
REQUEST_TIMEOUT_S = 20.0
QUEUE_TIMEOUT_S = 15.0
MAX_CONCURRENT_REQUESTS = 2
MAX_PENDING_REQUESTS = 8
CACHE_TTL_S = 3600.0
CACHE_MAX_ENTRIES = 32
# This is terrestrial DSM, not bathymetry. Bounds include the Dead Sea
# depression and Everest while rejecting common finite nodata -9999/+9999.
_MIN_ELEVATION_M = -1000.0
_MAX_ELEVATION_M = 9000.0

# Process-wide, memory-only, bounded. No disk files, credentials or env changes.
_LOCK = threading.RLock()
_CACHE = OrderedDict()
_FLIGHTS = {}  # (event loop, exact request hash) -> asyncio.Task
_ACTIVE_REQUESTS = 0


class TerrainError(ValueError):
    """No usable source terrain, invalid geometry, or unsupported usage."""


class _TransientError(TerrainError):
    pass


def _utc():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode("utf-8")).hexdigest()


def _number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TerrainError("invalid_terrain_number: " + name)
    try:
        value = float(value)
    except (OverflowError, ValueError):
        raise TerrainError("invalid_terrain_number: " + name) from None
    if not math.isfinite(value):
        raise TerrainError("invalid_terrain_number: " + name)
    return value


def _dimensions(rows, cols):
    if any(type(n) is not int or not 2 <= n <= MAX_GRID_SIDE for n in (rows, cols)):
        raise TerrainError("grid_size: rows and cols must be integers in 2..9")


def _prepare(patch, rows, cols):
    """Validate the actual metric frame; sample a regular XY covering rectangle."""
    _dimensions(rows, cols)
    try:
        from pyproj import CRS, Transformer
        from shapely.geometry import Point, Polygon
    except ImportError as exc:
        raise TerrainError("terrain_host_dependencies_missing: pyproj and shapely required") from exc
    try:
        if not isinstance(patch, dict) or len(patch["bounds"]) != 4:
            raise TerrainError("invalid_patch_bounds")
        w, s, e, n = [_number(v, "bounds") for v in patch["bounds"]]
        lat = _number(patch["origin"]["lat"], "origin.lat")
        lon = _number(patch["origin"]["lon"], "origin.lon")
        if not (-180 < w < e < 180 and -80 <= s < n <= 80 and w <= lon <= e and s <= lat <= n):
            raise TerrainError("invalid_patch_bounds: geographic extent/origin")
        lb = {k: _number(patch["localBounds"][k], k) for k in ("minX", "minY", "maxX", "maxY")}
        x0, y0, x1, y1 = [lb[k] for k in ("minX", "minY", "maxX", "maxY")]
        if not (0 < x1-x0 <= MAX_PATCH_SIDE_M and 0 < y1-y0 <= MAX_PATCH_SIDE_M
                and x0 <= 0 <= x1 and y0 <= 0 <= y1):
            raise TerrainError("invalid_patch_bounds: local extent must contain origin and be <=2500 m per side")
        if patch["crs"]["geographic"] != "EPSG:4326" or patch["crs"].get("units") != "metres":
            raise TerrainError("invalid_patch_crs: expected WGS84 and local metres")
        definition = patch["crs"]["local"]
        local = CRS.from_user_input(definition)
        if (not local.is_projected or not local.coordinate_operation
                or "azimuthal equidistant" not in local.coordinate_operation.method_name.lower()
                or len(local.axis_info) != 2
                or [a.direction for a in local.axis_info] != ["east", "north"]
                or any(not math.isclose(a.unit_conversion_factor, 1.0) for a in local.axis_info)):
            raise TerrainError("invalid_patch_crs: expected local east/north azimuthal-equidistant metre frame")
        forward = Transformer.from_crs("EPSG:4326", local, always_xy=True)
        inverse = Transformer.from_crs(local, "EPSG:4326", always_xy=True)
        ox, oy = forward.transform(lon, lat, errcheck=True)
        if math.hypot(ox, oy) > 0.005:
            raise TerrainError("invalid_patch_crs: projection origin does not match selected coordinate")
        boundary = patch["boundary"]
        if not isinstance(boundary, (list, tuple)) or not 4 <= len(boundary) <= 512:
            raise TerrainError("invalid_patch_boundary")
        if any(not isinstance(p, (list, tuple)) or len(p) != 2 for p in boundary):
            raise TerrainError("invalid_patch_boundary: expected XY pairs")
        boundary = [[_number(p[0], "boundary.x"), _number(p[1], "boundary.y")] for p in boundary]
        if boundary[0] != boundary[-1]:
            boundary.append(list(boundary[0]))
        polygon = Polygon(boundary)
        if not polygon.is_valid or polygon.is_empty or polygon.area <= 0 or not polygon.buffer(1e-6).covers(Point(0, 0)):
            raise TerrainError("invalid_patch_boundary: non-simple or excludes origin")
        if any(abs(a-b) > 1e-5 for a, b in zip(polygon.bounds, (x0, y0, x1, y1))):
            raise TerrainError("invalid_patch_boundary: localBounds do not match boundary")
        geographic_boundary = [inverse.transform(x, y, errcheck=True) for x, y in boundary]
        actual = (min(p[0] for p in geographic_boundary), min(p[1] for p in geographic_boundary),
                  max(p[0] for p in geographic_boundary), max(p[1] for p in geographic_boundary))
        if any(abs(a-b) > 1e-7 for a, b in zip(actual, (w, s, e, n))):
            raise TerrainError("invalid_patch_boundary: geographic bounds do not match metric boundary")
        xs = [x0+(x1-x0)*c/(cols-1) for c in range(cols)]
        ys = [y0+(y1-y0)*r/(rows-1) for r in range(rows)]
        # Row-major, south -> north, west -> east. The bounding rectangle has
        # a small halo outside the quadrilateral; only clippedMesh is visible.
        coordinates = [list(inverse.transform(x, y, errcheck=True)) for y in ys for x in xs]
        coordinates.append([lon, lat])  # independently sample the exact selected origin
        if any(not (-180 < a < 180 and -80 <= b <= 80) for a, b in coordinates):
            raise TerrainError("invalid_patch_sampling_coordinates")
        return {"bounds": [w, s, e, n], "origin": {"lat": lat, "lon": lon},
                "localBounds": lb, "boundary": boundary,
                "crs": {"geographic": "EPSG:4326", "local": definition,
                        "axes": ["east X", "north Y", "up Z"], "units": "metres"},
                "rows": rows, "cols": cols, "x": xs, "y": ys,
                "dxM": (x1-x0)/(cols-1), "dyM": (y1-y0)/(rows-1),
                "coordinates": coordinates}
    except TerrainError:
        raise
    except (KeyError, TypeError, ValueError, OverflowError, IndexError) as exc:
        raise TerrainError("invalid_terrain_patch: " + type(exc).__name__) from exc
    except Exception as exc:
        # PROJ/GEOS errors have library-specific exception classes. Never use
        # guessed degrees-to-metres math as a projection fallback.
        raise TerrainError("terrain_projection_failed: " + type(exc).__name__) from exc


def _request_key(request):
    # Exact, unrounded geometry, axes, spacing, source and advertised version.
    return _hash({"schema": SCHEMA, "source": ENDPOINT, "dataset": DATASET,
                  "version": DATASET_VERSION, "request": request})


async def _request_once(client, request):
    coordinates = request["coordinates"]
    params = {"latitude": ",".join(repr(p[1]) for p in coordinates),
              "longitude": ",".join(repr(p[0]) for p in coordinates)}
    async with client.stream("GET", ENDPOINT, params=params,
                             headers={"User-Agent": "GodsEyeView/0.3 bounded-noncommercial-DSM"},
                             timeout=REQUEST_TIMEOUT_S, follow_redirects=False) as response:
        if response.status_code == 429 or 500 <= response.status_code < 600:
            raise _TransientError("terrain_http_transient: HTTP " + str(response.status_code))
        if response.status_code != 200:
            raise TerrainError("terrain_http_error: HTTP " + str(response.status_code))
        media_type = response.headers.get("content-type", "").split(";", 1)[0].lower().strip()
        if media_type != "application/json" and not media_type.endswith("+json"):
            raise TerrainError("terrain_invalid_content_type: expected JSON")
        content = bytearray()
        async for chunk in response.aiter_bytes(chunk_size=8192):
            content.extend(chunk)
            if len(content) > MAX_RESPONSE_BYTES:
                raise TerrainError("terrain_response_too_large")
        try:
            payload = json.loads(content)
        except (ValueError, UnicodeError):
            raise TerrainError("terrain_malformed_json") from None
        if not isinstance(payload, dict) or payload.get("error"):
            raise TerrainError("terrain_provider_error_or_invalid_payload")
        elevations = payload.get("elevation")
        if not isinstance(elevations, list) or len(elevations) != len(coordinates):
            raise TerrainError("terrain_incomplete_samples: expected " + str(len(coordinates)))
        result = []
        for index, value in enumerate(elevations):
            value = _number(value, "elevation[" + str(index) + "] (no-data is not zero)")
            if not _MIN_ELEVATION_M <= value <= _MAX_ELEVATION_M:
                raise TerrainError("terrain_invalid_elevation_or_nodata: index " + str(index))
            result.append(value)
        return result, hashlib.sha256(content).hexdigest(), str(response.url)


async def _download(client, request):
    import httpx  # Host-only dependency; not imported by Blender's sampler.
    last = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            return await asyncio.wait_for(_request_once(client, request), timeout=REQUEST_TIMEOUT_S)
        except (_TransientError, httpx.RequestError, asyncio.TimeoutError) as exc:
            last = exc
            if attempt+1 < MAX_ATTEMPTS:
                await asyncio.sleep(0.25)
    detail = str(last) if isinstance(last, _TransientError) else type(last).__name__
    raise TerrainError("terrain_source_unavailable_after_2_attempts: " + detail) from last


async def _acquire_slot():
    global _ACTIVE_REQUESTS
    deadline = time.monotonic()+QUEUE_TIMEOUT_S
    while True:
        with _LOCK:
            if _ACTIVE_REQUESTS < MAX_CONCURRENT_REQUESTS:
                _ACTIVE_REQUESTS += 1
                return
        if time.monotonic() >= deadline:
            raise TerrainError("terrain_queue_timeout")
        await asyncio.sleep(0.02)


def _provenance(request, source_hash, source_url, key, retrieved):
    return {
        "provider": "Open-Meteo", "endpoint": ENDPOINT, "sourceUrl": source_url,
        "documentationUrl": DOCUMENTATION_URL, "documentationVerifiedDate": DOCS_VERIFIED_DATE,
        "dataset": DATASET, "datasetVersion": DATASET_VERSION, "datasetSubrelease": None,
        "datasetUrl": DATASET_URL, "datasetDoi": "https://doi.org/10.5270/ESA-c5d3d65",
        "sourceType": "DSM (includes buildings, infrastructure and vegetation)",
        "nativeResolutionM": NATIVE_RESOLUTION_M, "nativeLatitudeSpacingArcSeconds": 3.0,
        "datasetAcquisition": "Primarily TanDEM-X 2011-2015; older infill may be present",
        "horizontalCrs": "EPSG:4326", "localCrs": request["crs"]["local"], "verticalUnit": "metres",
        "verticalDatum": None,
        "verticalDatumStatus": "API documentation/response does not specify output vertical datum or conversion",
        "datasetVerticalDatum": {"name": "EGM2008 height", "epsg": "EPSG:3855", "sourceUrl": DATASET_URL},
        "verticalUncertaintyM": None,
        "verticalUncertaintyStatus": "No per-point error, quality mask or datum confirmation supplied by API",
        "datasetAbsoluteVerticalAccuracy": {"description": "<4 m at 90% linear error (dataset specification, not point guarantee)",
                                            "sourceUrl": DATASET_URL},
        "providerResampling": "Not specified by API documentation; not assumed to be nearest or bilinear",
        "localInterpolation": "Bilinear interpolation of returned DSM point samples; no added terrain detail",
        "isSurveyedRoadElevation": False, "isBareEarthDTM": False,
        "queryBounds": request["bounds"], "queryOrigin": request["origin"],
        "queryPointOrder": "row-major west-to-east / south-to-north, then exact selected origin",
        "queryCoordinatesLonLat": request["coordinates"], "sampleCount": len(request["coordinates"]),
        "gridSpacingM": {"x": request["dxM"], "y": request["dyM"]},
        "retrievedUtc": retrieved, "responseSha256": source_hash, "requestSha256": key,
        "hashBasis": "SHA-256 of complete decoded HTTP response body, before JSON parsing",
        "license": {"name": "CC BY 4.0 (Open-Meteo API data)",
                    "url": "https://creativecommons.org/licenses/by/4.0/",
                    "providerLicenseUrl": "https://open-meteo.com/en/licence",
                    "datasetLicenseUrl": DATASET_URL,
                    "termsUrl": TERMS_URL,
                    "serviceRestriction": "Free API is non-commercial only; data licence and service terms are distinct",
                    "attribution": "Elevation data: Open-Meteo and Copernicus DEM GLO-90.",
                    "modifiedDatasetNotice": "produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved",
                    "changes": "Reprojected sampling grid, origin subtraction, bilinear interpolation and boundary clipping"},
    }


def _assemble(request, response, key):
    elevations, source_hash, source_url = response
    rows, cols = request["rows"], request["cols"]
    origin_elevation = elevations[-1]
    raw = [elevations[r*cols:(r+1)*cols] for r in range(rows)]
    relative = [[z-origin_elevation for z in row] for row in raw]
    vertices = [[x, y, relative[r][c]] for r, y in enumerate(request["y"]) for c, x in enumerate(request["x"])]
    faces = []
    for r in range(rows-1):
        for c in range(cols-1):
            a = r*cols+c
            faces.extend([[a, a+1, a+cols+1], [a, a+cols+1, a+cols]])
    retrieved = _utc()
    terrain = {
        "schema": SCHEMA, "id": "terrain_"+_hash([key, source_hash])[:24],
        "bounds": request["bounds"], "localBounds": request["localBounds"],
        "origin": request["origin"], "boundary": request["boundary"], "crs": request["crs"],
        "vertices": vertices, "faces": faces,
        "meshCoverage": "local bounding rectangle; use clippedMesh for actual patch boundary",
        "grid": {"rows": rows, "cols": cols, "x": request["x"], "y": request["y"],
                 "dxM": request["dxM"], "dyM": request["dyM"],
                 "order": "row-major; x east; y north", "heightsM": relative, "elevationsM": raw},
        "originElevationM": origin_elevation,
        "originElevationBasis": "Separate API sample at exact selected origin; absolute in provider's unspecified output datum",
        "elevation": {"status": "available", "type": "DSM", "units": "metres", "source": ENDPOINT,
                      "verticalDatum": None, "nativeResolutionM": NATIVE_RESOLUTION_M,
                      "isSurveyed": False, "minAbsoluteM": min(elevations[:-1]),
                      "maxAbsoluteM": max(elevations[:-1]),
                      "minRelativeM": min(v[2] for v in vertices), "maxRelativeM": max(v[2] for v in vertices)},
        "provenance": _provenance(request, source_hash, source_url, key, retrieved),
        "cache": {"key": key, "ttlSeconds": CACHE_TTL_S, "scope": "bounded per-process memory; no stale-on-error"},
        "limitations": [
            "Copernicus GLO-90 is a coarse DSM, not bare-earth or surveyed road geometry.",
            "Returned heights may include roofs/trees; modelled building extrusion can double-count surface height.",
            "Grid densification and interpolation do not increase native ~90 m resolution.",
            "Output vertical datum, per-point uncertainty, masks and dataset subrelease are not supplied by API.",
            "No bridge deck, tunnel, kerb, lane, water-level or contemporary construction elevations are resolved.",
            "Triangle meshes approximate the bilinear sampler between vertices; they are not an exact bilinear surface.",
        ],
    }
    # Do not distort the entire measured grid merely to force h(0,0)==0.
    # With off-centre patches, independently sampled origin and interpolated
    # origin can legitimately differ. Expose that residual to the caller.
    terrain["originGridResidualM"] = height_at(terrain, 0.0, 0.0)
    terrain["clippedMesh"] = clipped_mesh(terrain)
    return terrain


async def _produce(request, key, client):
    global _ACTIVE_REQUESTS
    await _acquire_slot()
    try:
        if client is None:
            try:
                import httpx
            except ImportError as exc:
                raise TerrainError("terrain_host_dependencies_missing: httpx required") from exc
            async with httpx.AsyncClient(follow_redirects=False) as owned:
                response = await _download(owned, request)
        else:
            response = await _download(client, request)
        terrain = _assemble(request, response, key)
        with _LOCK:
            _CACHE[key] = (time.monotonic()+CACHE_TTL_S, terrain)
            _CACHE.move_to_end(key)
            while len(_CACHE) > CACHE_MAX_ENTRIES:
                _CACHE.popitem(last=False)
        return terrain
    finally:
        with _LOCK:
            _ACTIVE_REQUESTS -= 1


def _flight_done(flight_key, task):
    with _LOCK:
        if _FLIGHTS.get(flight_key) is task:
            _FLIGHTS.pop(flight_key, None)
    # Retrieve exceptions even if the sole waiter was cancelled. Awaiting the
    # same task still raises; this only prevents unobserved-task warnings.
    if not task.cancelled():
        task.exception()


async def fetch_terrain(patch, client=None, *, rows=9, cols=9, non_commercial=False):
    """Fetch up to 81 grid points + the exact origin in ONE API request.

    non_commercial=True acknowledges the free service's usage restriction.
    client can be an existing httpx.AsyncClient (not closed by this function).
    Equal concurrent requests coalesce per event loop; successes cache 1 hour.
    Two upstream calls process-wide; <=8 pending keys; <=2 transient attempts.
    Failures, malformed/no-data samples, and expired successes never become a
    flat fallback. Cancellation of a waiter does not cancel shared acquisition.
    """
    if non_commercial is not True:
        raise TerrainError("terrain_service_terms: free Open-Meteo API is non-commercial only; explicitly acknowledge non_commercial=True for eligible use")
    request = _prepare(patch, rows, cols)
    key = _request_key(request)
    loop = asyncio.get_running_loop()
    with _LOCK:
        now = time.monotonic()
        for expired in [k for k, (expiry, _) in _CACHE.items() if expiry <= now]:
            del _CACHE[expired]
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return copy.deepcopy(_CACHE[key][1])
        flight_key = (loop, key)
        task = _FLIGHTS.get(flight_key)
        if task is None:
            if len(_FLIGHTS) >= MAX_PENDING_REQUESTS:
                raise TerrainError("terrain_busy: bounded in-flight queue is full")
            task = loop.create_task(_produce(request, key, client))
            _FLIGHTS[flight_key] = task
            task.add_done_callback(lambda t: _flight_done(flight_key, t))
    return copy.deepcopy(await asyncio.shield(task))


def fetch_terrain_sync(patch, client=None, **kwargs):
    """For existing synchronous host pipelines; never call inside an event loop."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(fetch_terrain(patch, client=client, **kwargs))
    raise TerrainError("terrain_async_context: use await fetch_terrain instead of sync wrapper")


def clear_cache():
    """Clear successes only; do not cancel requests belonging to other callers."""
    with _LOCK:
        _CACHE.clear()


def _sampler_grid(terrain):
    try:
        if terrain["schema"] != SCHEMA:
            raise TerrainError("invalid_terrain_schema")
        grid = terrain["grid"]
        rows, cols = grid["rows"], grid["cols"]
        _dimensions(rows, cols)
        xs, ys, heights = grid["x"], grid["y"], grid["heightsM"]
        if len(xs) != cols or len(ys) != rows or len(heights) != rows:
            raise TerrainError("invalid_terrain_grid_shape")
        for axis in (xs, ys):
            values = [_number(v, "grid.axis") for v in axis]
            step = values[1]-values[0]
            if step <= 0 or any(not math.isclose(b-a, step, rel_tol=1e-10, abs_tol=1e-7)
                                for a, b in zip(values, values[1:])):
                raise TerrainError("invalid_terrain_grid_spacing")
        for row in heights:
            if len(row) != cols:
                raise TerrainError("invalid_terrain_grid_shape")
            for value in row:
                _number(value, "grid.height")
        return xs, ys, heights
    except TerrainError:
        raise
    except (KeyError, TypeError, ValueError, IndexError) as exc:
        raise TerrainError("invalid_terrain_grid: " + type(exc).__name__) from exc


def height_at(terrain, x, y, *, absolute=False):
    """Stdlib-only bilinear DSM sampling in metres, including exact grid edges.

    No extrapolation and no fallback. Samples outside the actual boundary but
    inside the covering rectangle are valid halo samples, NOT renderable area.
    Default is Z relative to originElevationM; absolute=True adds that origin.
    """
    x, y = _number(x, "sample.x"), _number(y, "sample.y")
    xs, ys, heights = _sampler_grid(terrain)
    tolerance = 1e-7  # only sub-micrometre GEOS rounding, not external clamping
    if x < xs[0]-tolerance or x > xs[-1]+tolerance or y < ys[0]-tolerance or y > ys[-1]+tolerance:
        raise TerrainError("terrain_sample_out_of_bounds")
    x, y = min(max(x, xs[0]), xs[-1]), min(max(y, ys[0]), ys[-1])
    c = min(len(xs)-2, max(0, bisect_right(xs, x)-1))
    r = min(len(ys)-2, max(0, bisect_right(ys, y)-1))
    u, v = (x-xs[c])/(xs[c+1]-xs[c]), (y-ys[r])/(ys[r+1]-ys[r])
    z = ((1-u)*(1-v)*heights[r][c] + u*(1-v)*heights[r][c+1]
         + (1-u)*v*heights[r+1][c] + u*v*heights[r+1][c+1])
    if absolute:
        try:
            z += _number(terrain["originElevationM"], "originElevationM")
        except (KeyError, TypeError):
            raise TerrainError("invalid_origin_elevation") from None
    return z


def clipped_mesh(terrain):
    """Host-only exact XY boundary clipping, with interpolated intersection Z.

    Returns JSON-serializable vertices/faces for Blender's from_pydata(). Does
    not cut corners via centroid inclusion or assume axis-aligned boundaries.
    A triangle mesh is a piecewise-linear approximation of height_at().
    """
    try:
        from shapely import constrained_delaunay_triangles, set_precision
        from shapely.geometry import Polygon
    except ImportError as exc:
        raise TerrainError("terrain_host_dependencies_missing: shapely >=2.1 required for clipping") from exc
    _sampler_grid(terrain)
    try:
        # Shared sub-nanometre precision prevents near-identical GEOS edge
        # intersections producing unwelded seams. This is not DEM rounding.
        precision_m = 1e-10
        boundary = set_precision(Polygon(terrain["boundary"]), precision_m)
        if boundary.is_empty or not boundary.is_valid or boundary.area <= 0:
            raise TerrainError("invalid_terrain_clip_boundary")
        vertices, faces, seen = [], [], {}

        def parts(geometry):
            if geometry.geom_type == "Polygon":
                if geometry.area > 1e-12:
                    yield geometry
            elif hasattr(geometry, "geoms"):
                for child in geometry.geoms:
                    yield from parts(child)

        for face in terrain["faces"]:
            triangle = set_precision(Polygon([terrain["vertices"][i][:2] for i in face]), precision_m)
            for piece in parts(triangle.intersection(boundary)):
                for tri in constrained_delaunay_triangles(piece).geoms:
                    points = list(tri.exterior.coords)[:3]
                    # Upward-facing winding, independent of GEOS output order.
                    a, b, c = points
                    if (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]) < 0:
                        points.reverse()
                    indices = []
                    for x, y in points:
                        key = (x, y)
                        if key not in seen:
                            seen[key] = len(vertices)
                            vertices.append([x, y, height_at(terrain, x, y)])
                        indices.append(seen[key])
                    faces.append(indices)
        if not faces:
            raise TerrainError("terrain_clip_has_no_surface")
        return {"vertices": vertices, "faces": faces, "clippedToBoundary": True,
                "interpolation": "Triangle mesh with bilinear DSM heights at clipped vertices"}
    except TerrainError:
        raise
    except Exception as exc:
        raise TerrainError("terrain_clip_failed: " + type(exc).__name__) from exc


def surface_height(terrain, x, y):
    """Height of the actual piecewise-triangular Blender mesh, not bilinear proxy."""
    mesh = terrain["clippedMesh"]
    for face in mesh["faces"]:
        a,b,c=[mesh["vertices"][i] for i in face]
        if x < min(a[0],b[0],c[0])-1e-6 or x > max(a[0],b[0],c[0])+1e-6 or y < min(a[1],b[1],c[1])-1e-6 or y > max(a[1],b[1],c[1])+1e-6:continue
        den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(den)<1e-14:continue
        u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den
        v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den
        w=1-u-v
        if min(u,v,w)>=-1e-7:return u*a[2]+v*b[2]+w*c[2]
    raise TerrainError("point_outside_rendered_terrain")

def ray_hit(terrain, origin, direction):
    """Nearest positive ray / rendered-terrain intersection (mesh-exact)."""
    hits=[];mesh=terrain["clippedMesh"]
    for face in mesh["faces"]:
        a,b,c=[mesh["vertices"][i] for i in face]
        u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)]
        n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
        denom=sum(n[i]*direction[i] for i in range(3))
        if abs(denom)<1e-12:continue
        t=sum(n[i]*(a[i]-origin[i]) for i in range(3))/denom
        if t<0:continue
        p=[origin[i]+t*direction[i] for i in range(3)]
        den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(den)<1e-14:continue
        aa=((b[1]-c[1])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[1]))/den
        bb=((c[1]-a[1])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[1]))/den
        if min(aa,bb,1-aa-bb)>=-1e-8:hits.append((t,p))
    return min(hits,key=lambda x:x[0]) if hits else None
