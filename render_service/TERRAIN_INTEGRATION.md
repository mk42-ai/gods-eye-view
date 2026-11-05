# Real elevation grid — integration handoff

Implemented only `terrain.py`, `test_terrain.py`, and this file. **Not yet wired into the renderer.** No shared Python files, credentials, `.env`, Git operations, SSH, or deployment were changed/performed.

## API and source contract

```python
import terrain as Terrain

# Host process only. Acknowledgement is required; do not assert this for a
# commercial application. client, when supplied, is an httpx.AsyncClient.
t = await Terrain.fetch_terrain(patch, client=None, non_commercial=True)
# A synchronous host pipeline can instead call:
# t = Terrain.fetch_terrain_sync(patch, non_commercial=True)

# Blender's bundled Python: importing terrain and sampling require only stdlib.
z_relative = Terrain.height_at(t, x, y)
z_absolute = Terrain.height_at(t, x, y, absolute=True)
mesh = t["clippedMesh"]  # mesh["vertices"], mesh["faces"] -> from_pydata
```

- `patch` is the unmodified result of `geography.make_patch`. The selected origin, WGS84 bounds, actual local boundary, metric bounds and azimuthal-equidistant CRS must agree. Invalid/missing input raises `TerrainError` before networking.
- Default grid: **9 × 9**, row-major west→east, south→north. Optional `rows`/`cols`: integers 2–9. One request contains all grid coordinates **plus an independent sample at the exact selected origin**: at most 82 locations, below the documented 100-location limit.
- XY is regular in the existing **local east/north metre frame**, not a degree grid. Coordinates are inverse-projected with pyproj. No coordinate rounding, degree-to-metre guess, elevation rounding or relief exaggeration is applied.
- `grid.x`, `grid.y`, `grid.dxM`, `grid.dyM`; `grid.elevationsM[row][col]` preserves every returned absolute sample; `grid.heightsM` and `vertices` use `sample - originElevationM`. `faces` has upward-wound triangles.
- The rectangular grid may have a small sampling halo outside the actual quadrilateral. **Render `clippedMesh`, not the uncut `vertices`/`faces`.** It clips every grid triangle to the real boundary, triangulates the intersections and samples their Z. GEOS operations share a 1e-10 m precision model to avoid floating-point sliver/seam artifacts; this does not round DEM samples.
- `height_at` is bilinear, rejects invalid grids/nonfinite numbers and points outside the covering rectangle, and does **not** assert that a halo point is inside the patch. Keep the existing boundary checks. Only <=1e-7 m edge roundoff is tolerated.
- A separately sampled origin need not equal the gridded/interpolated origin, particularly for noncentral origins/coarse DSM cells. `originGridResidualM = height_at(t, 0, 0)` exposes the discrepancy; the module **does not silently rebase the samples** to hide it.
- `provenance` retains the exact query URL and coordinates, bounds, source/version description, UTC retrieval time, SHA-256 of the complete decoded response body and SHA-256 of the full request definition. `id` depends on request and source-response hashes.

## Live primary documentation, verified 2026-11-05

1. [Open-Meteo elevation API](https://open-meteo.com/en/docs/elevation-api), HTTP 200: endpoint `/v1/elevation`; multiple latitude/longitude pairs; up to 100 points; response is an `elevation` array. It explicitly identifies **Copernicus DEM 2021 release GLO-90, 90 m resolution**. No tile/subrelease version or resampling method is documented, so neither is invented.
2. [Open-Meteo licence](https://open-meteo.com/en/licence), HTTP 200: API data are **CC BY 4.0**, attribution and indication of modification required. The elevation documentation also requires attribution to **Copernicus and Open-Meteo**, and cites DOI `10.5270/ESA-c5d3d65`.
3. [Open-Meteo terms](https://open-meteo.com/en/terms), HTTP 200: **the no-key free service is NON-COMMERCIAL ONLY**, with limits below 10,000 calls/day, 5,000/hour, 600/minute. Data licensing does not remove service restrictions. `non_commercial=True` is an explicit caller acknowledgement, not a licence grant. A commercial deployment needs an authorized provider/plan or appropriately licensed self-hosted data; no paid endpoint/credentials were configured here.
4. [Copernicus official collection description](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM), HTTP 200: **DSM**, not bare-earth DTM; includes buildings, infrastructure and vegetation; primarily TanDEM-X 2011–2015 with older infill possible. GLO-90 is worldwide, nominal 90 m / 3 arcseconds latitude spacing. Dataset vertical reference is **EGM2008 height (EPSG:3855), metres**. Published absolute vertical accuracy is **<4 m at 90% linear error**, a dataset specification, **not a guarantee/error estimate for these samples**.

**Datum honesty:** Open-Meteo's fetched API documentation/response does not independently declare its output datum or a datum conversion. The result therefore keeps `verticalDatum: null`, `verticalUncertaintyM: null`, and separately records the documented **dataset** datum. `originElevationM` is absolute in the **provider's unspecified output datum**, not a claimed ellipsoidal/survey elevation. Do not label these API heights as confirmed EPSG:3855 output.

Attribution stored in provenance includes this modified GLO-90 notice from the Copernicus collection:

> produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved

The resulting surface is **coarse interpolated historical DSM elevation, not surveyed road heights**. A finer grid does not add native detail. Roofs/trees can affect the surface; extruding mapped buildings from it can double-count structures. Neither bridge/tunnel levels nor kerbs, lane geometry, current construction or actual water levels are recovered. A genuinely constant source response remains constant; failures never become constant zero terrain.

## Required main-agent wiring (shared files intentionally untouched)

1. Fetch after `make_patch`/OSM acquisition and **before** placement, initial camera and scene/cache construction. Propagate `TerrainError` as a source-unavailable failure; do not catch it and render the old plane. Store the complete JSON-serializable result as `scene["terrain"]`.
2. Include `t["id"]`/request-response hashes in the scene/cache key. Add terrain provenance and origin information to the exported patch. Replace only obsolete “no elevation source / flat reference” limitations after success; preserve OSM/approximation warnings and add DSM limitations. Existing `geography.fetch_osm` patch IDs alone do not identify the terrain.
3. In `blender_scene.build_scene`, replace—not overlay—the unknown flat ground with `t["clippedMesh"]`. This mesh already respects the actual projected boundary and can be consumed without pyproj/shapely in Blender.
4. Ground road/surface mesh vertices and instance bases using the same terrain convention plus small explicit visual clearance. Subdivide large surface triangles as needed; merely setting one global `z` does not drape geometry. Retain boundary clipping and bridge/tunnel exclusions. Label building base/extrusion and road grounding as **DSM-based approximations**, not recovered ground surveys.
5. **Important interpolation distinction:** `height_at` is bilinear; rendered triangular mesh interiors are piecewise planar. They agree at sampled mesh vertices, but can differ inside a cell. For close-up road/asset contact, subdivide terrain and draped geometry consistently, or use triangle-consistent contact sampling. Do not claim sub-metre contact accuracy from the default coarse mesh.
6. `camera.validate_pose` currently assumes ground Z=0, target Z>=0, zero-plane frustum intersections and roofs at `building.h`. Update AGL/target heights, terrain ray intersection/occlusion and building base+height checks together. Moving only the visible ground would leave camera/placement validation incorrect. Negative relative terrain heights are valid.
7. Keep each injected async client alive until shared work completes. Cancelling a caller does not cancel a coalesced fetch. Do not pass a client bound to another loop into the synchronous wrapper.

## Operational bounds and failures

- Two active acquisitions process-wide, at most eight pending unique `(event loop, request hash)` tasks. Equal in-loop requests share one fetch. Different loops share cache/concurrency limits, but cannot share asyncio tasks.
- Up to two attempts **only** on transport/timeouts, HTTP 429 or 5xx. Non-200 other responses, redirects, HTML, malformed/missing/wrong-count arrays, nulls, booleans, strings, nonfinite values or out-of-terrestrial-DSM-range/sentinel elevations (outside −1000 to 9000 m, including −9999/+9999) fail immediately with `TerrainError`. Returned zero/negative numeric heights remain valid data.
- 20 s total deadline per attempt, 15 s queue wait, 64 KiB decoded-body maximum. No alternate/fake source or stale-on-error mode.
- In-memory LRU: 32 successes, TTL 3,600 s; no persistence. Key includes exact bounds, origin, boundary, CRS, axes, grid spacing, endpoint, advertised dataset version and schema. Expired entries are removed before fetch; exceptions are not cached. Returned results are deep copies. `clear_cache()` clears successes, not other callers' work.
- Request bounds/concurrency are **not** an aggregate daily service quota across server processes/replicas. Main must enforce deployment-wide rate limits and service eligibility. Recheck source documentation/version when changing providers or after an upstream dataset update.

## Verification results (not renderer integration claims)

### Synthetic fixture suite — NO live network

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s render_service -p test_terrain.py -v
```

**22 fixture tests passed; 1 opt-in live test skipped** (23 discovered). Covered full-precision metric sampling/ordering, relative and negative heights, independent origin residual, bilinear edges/out-of-bounds, polygon clipping coverage/no spill/upward normals, corrupt/no-data/sentinel/HTML/oversized responses, bounded retries/deadlines/concurrency/queue, cache exactness/version/grid/TTL/LRU/deep copies, caller cancellation, service terms, and a separate `python -S` sampler process with **no httpx/pyproj/shapely/numpy imported**. An initial GEOS near-identical intersection seam was detected by the coverage test and fixed with the shared precision model; the rerun passed. A final targeted rerun also passed after explicitly covering finite −9999/+9999 no-data sentinels.

Executed locally with **Python 3.13.5, httpx 0.28.1, pyproj 3.8.0, shapely 2.2.0**. Both files also parsed successfully with Python **3.10 grammar**. Python 3.10 / pyproj 3.7 / shapely 2.1 runtime execution on the actual host was **not performed** (no SSH); APIs intentionally target those versions. No Blender renderer was launched by this subtask.

### LIVE read-only smoke — actual researched site

```bash
GEV_TERRAIN_LIVE=1 PYTHONDONTWRITEBYTECODE=1 \
  python3 render_service/test_terrain.py TerrainLiveSmoke -v
```

**1 live test passed**, fetched at **2026-11-05T05:30:34.211Z**. Input came from `/tmp/gev-repair-evidence/coordinate-research.json` → `yas`, not fixture/hardcoded fallback coordinates:

- Site evidence: [Yas Mall, OSM way/312812656](https://api.openstreetmap.org/api/0.6/way/312812656/full.json), existing researched source; the test makes no new survey/entrance-verification claim.
- Selected origin: **24.488418332959604 N, 54.60881599715363 E**.
- Bounds `[west,south,east,north]`: **[54.6052565, 24.4851869, 54.6125824, 24.4918893]**, passed through the real `geography.make_patch`.
- 81 grid heights + independent origin; spacing **92.82524813349329 m east, 92.79984188937811 m north**.
- Absolute origin sample **8.0 m**; grid range **3.0–18.0 m**; relative range **−5.0–10.0 m**; no fabricated relief.
- `height_at(0,0)` residual **1.2359850979562435 m** relative to the independent origin sample (coarse-grid interpolation discrepancy is exposed, not concealed).
- Clipped mesh: **170 vertices / 217 faces**.
- Evidence-file SHA-256: `1c2a2fb98c70cf98ba06e03c2fdf4c18e91c0c8e72e9e492b017a83953c10d4c`.
- API response SHA-256: `0be935dc66c0297074a1cdd5e7eddb3c86f0b0fba7356a3ed00f847b6935c958`.
- Exact request-definition SHA-256: `5ea410bf997701dcfe561d643e381ff7a39ca3402eba30a3a361cfb72ac28909`.
- API: `https://api.open-meteo.com/v1/elevation`; the test prints the complete generated URL and all received values in `LIVE_TERRAIN_SMOKE=...`. The module retains that exact URL in provenance. One logical bounded multi-location fetch; no external writes.

Observed LIVE absolute grid, south→north rows and west→east columns, metres (not fixtures):

```text
 4  4  4 10 13 10 10  4  4
 4  5  8  7  7 12 16  5  4
 3 10 13  9 10  6  8  4  4
 4  9 16  6 18 12 11  4  4
 4  4  5  8  8  6 10  8  9
 4  3  4  7  8  8  5 10  5
 4  3  5  7  7  7  8  6  4
 4  4  4  4  6 10 10  5  8
 4  4  4  4  6  6  7  5  9
```

**Remaining blockers are integration and service eligibility, not DEM access.** Do not advertise terrain-enabled rendering until main has wired and validated placement, camera and Blender together.
