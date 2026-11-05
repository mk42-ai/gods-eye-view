"""Independent terrain tests. Default: synthetic FIXTURES, NO external traffic.

Run from repo root (no shared-file writes):
  PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s render_service -p test_terrain.py -v
Opt-in read-only LIVE smoke (researched coordinates, no constants invented):
  GEV_TERRAIN_LIVE=1 PYTHONDONTWRITEBYTECODE=1 python3 render_service/test_terrain.py TerrainLiveSmoke -v
"""
import asyncio
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest import mock

import httpx
from pyproj import CRS, Transformer
from shapely.geometry import Polygon, Point
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
import terrain as T


def fixture_patch(half_m=260.0, offcentre=False, diamond=False):
    """Synthetic fixture coordinate/frame; NEVER used by the live smoke test."""
    lat, lon = 24.0, 54.0
    definition = f"+proj=aeqd +lat_0={lat:.10f} +lon_0={lon:.10f} +datum=WGS84 +units=m +no_defs"
    local = CRS.from_proj4(definition)
    forward = Transformer.from_crs("EPSG:4326", local, always_xy=True)
    inverse = Transformer.from_crs(local, "EPSG:4326", always_xy=True)
    if diamond:
        ring = [[-half_m, 0], [0, -half_m], [half_m, 0], [0, half_m], [-half_m, 0]]
        corners = [inverse.transform(*p) for p in ring]
        w, s = min(p[0] for p in corners), min(p[1] for p in corners)
        e, n = max(p[0] for p in corners), max(p[1] for p in corners)
    else:
        left = -half_m*0.4 if offcentre else -half_m
        corners = [inverse.transform(x, y) for x in (left, half_m) for y in (-half_m, half_m)]
        w, s = min(p[0] for p in corners), min(p[1] for p in corners)
        e, n = max(p[0] for p in corners), max(p[1] for p in corners)
        ring = []
        for a, b in [((w, s), (e, s)), ((e, s), (e, n)), ((e, n), (w, n)), ((w, n), (w, s))]:
            for i in range(16):
                u = i/16
                ring.append(list(forward.transform(a[0]+u*(b[0]-a[0]), a[1]+u*(b[1]-a[1]))))
        ring.append(list(ring[0]))
    x0, y0, x1, y1 = Polygon(ring).bounds
    return {"bounds": [w, s, e, n], "origin": {"lat": lat, "lon": lon},
            "localBounds": {"minX": x0, "minY": y0, "maxX": x1, "maxY": y1},
            "boundary": ring, "crs": {"geographic": "EPSG:4326", "local": definition,
                                      "axes": ["east X", "north Y", "up Z"], "units": "metres"}}


class FixtureSource:
    """Explicitly SYNTHETIC sloping DSM surface; HTTP calls are MockTransport."""
    def __init__(self, patch):
        self.frame = Transformer.from_crs("EPSG:4326", patch["crs"]["local"], always_xy=True)
        self.requests = []
        self.content = None

    @staticmethod
    def height(x, y):
        return 51.75+0.012*x-0.007*y+0.00003*x*y

    async def __call__(self, request):
        self.requests.append(request)
        latitudes = list(map(float, request.url.params["latitude"].split(",")))
        longitudes = list(map(float, request.url.params["longitude"].split(",")))
        data = {"elevation": [self.height(*self.frame.transform(lon, lat))
                              for lat, lon in zip(latitudes, longitudes)]}
        self.content = json.dumps(data).encode()
        return httpx.Response(200, content=self.content, headers={"Content-Type": "application/json"})


class TerrainFixtureTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        T.clear_cache()
        self.patch = fixture_patch()
        self.source = FixtureSource(self.patch)
        self.client = httpx.AsyncClient(transport=httpx.MockTransport(self.source))

    async def asyncTearDown(self):
        await self.client.aclose()
        T.clear_cache()

    async def fetch(self, patch=None, **kwargs):
        return await T.fetch_terrain(patch or self.patch, client=self.client, non_commercial=True, **kwargs)

    async def test_fixture_regular_metric_grid_and_full_precision(self):
        original = copy.deepcopy(self.patch)
        result = await self.fetch()
        self.assertEqual(self.patch, original, "fetch must not mutate shared geography patch")
        self.assertEqual(result["grid"]["rows"], 9)
        self.assertEqual(len(result["vertices"]), 81)
        self.assertEqual(len(result["faces"]), 128)
        self.assertEqual(len(self.source.requests), 1)
        request = self.source.requests[0]
        latitudes = list(map(float, request.url.params["latitude"].split(",")))
        longitudes = list(map(float, request.url.params["longitude"].split(",")))
        self.assertEqual(len(latitudes), 82)
        self.assertEqual((longitudes[-1], latitudes[-1]), (54.0, 24.0))
        self.assertAlmostEqual(result["originElevationM"], 51.75, places=8)
        for i, vertex in enumerate(result["vertices"]):
            x, y, z = vertex
            r, c = divmod(i, 9)
            self.assertEqual((x, y), (result["grid"]["x"][c], result["grid"]["y"][r]))
            self.assertAlmostEqual(z, self.source.height(x, y)-51.75, places=7)
            self.assertAlmostEqual(T.height_at(result, x, y), z, places=9)
            a, b = self.source.frame.transform(longitudes[i], latitudes[i])
            self.assertAlmostEqual(a, x, places=6)
            self.assertAlmostEqual(b, y, places=6)
        self.assertFalse(self.client.is_closed)
        json.dumps(result, allow_nan=False)

    async def test_fixture_provenance_datum_and_license_are_not_overclaimed(self):
        result = await self.fetch()
        p = result["provenance"]
        self.assertEqual(p["responseSha256"], hashlib.sha256(self.source.content).hexdigest())
        self.assertIsNone(p["verticalDatum"])
        self.assertIsNone(p["verticalUncertaintyM"])
        self.assertIsNone(p["datasetSubrelease"])
        self.assertEqual(p["datasetVerticalDatum"]["epsg"], "EPSG:3855")
        self.assertEqual(p["nativeResolutionM"], 90)
        self.assertFalse(p["isSurveyedRoadElevation"])
        self.assertFalse(p["isBareEarthDTM"])
        self.assertIn("non-commercial", p["license"]["serviceRestriction"])
        self.assertIn("Copernicus", p["license"]["attribution"])
        self.assertTrue(p["retrievedUtc"].endswith("Z"))
        self.assertIn("2021", p["datasetVersion"])
        self.assertNotIn("apikey", p["sourceUrl"].lower())

    async def test_fixture_bilinear_interpolation_and_outside_guard(self):
        result = await self.fetch()
        for x, y in [(-55.5, 42.125), (14.25, -12.333), (0.0, 0.0)]:
            self.assertAlmostEqual(T.height_at(result, x, y, absolute=True), self.source.height(x, y), places=7)
        xs, ys = result["grid"]["x"], result["grid"]["y"]
        self.assertEqual(T.height_at(result, xs[-1], ys[-1]), result["vertices"][-1][2])
        for x, y in [(xs[0]-0.01, 0), (xs[-1]+0.01, 0), (0, ys[-1]+0.01), (math.nan, 0), (True, 0)]:
            with self.subTest(point=(x, y)), self.assertRaises(T.TerrainError):
                T.height_at(result, x, y)

    async def test_fixture_corrupt_grid_fails_closed(self):
        result = await self.fetch()
        for field, value in [("heightsM", [[1.0]]), ("x", [0.0]*9), ("rows", 99)]:
            bad = copy.deepcopy(result)
            bad["grid"][field] = value
            with self.subTest(field=field), self.assertRaises(T.TerrainError):
                T.height_at(bad, 0, 0)
        result["grid"]["heightsM"][0][0] = math.nan
        with self.assertRaises(T.TerrainError):
            T.height_at(result, 0, 0)

    async def test_fixture_noncentral_origin_and_negative_heights(self):
        result = await self.fetch(fixture_patch(offcentre=True), rows=8, cols=7)
        self.assertAlmostEqual(result["originElevationM"], 51.75, places=8)
        self.assertAlmostEqual(result["originGridResidualM"], 0.0, places=7)
        self.assertLess(result["elevation"]["minRelativeM"], 0)
        self.assertGreater(result["elevation"]["maxRelativeM"], 0)
        self.assertEqual(result["provenance"]["sampleCount"], 57)

    async def test_fixture_independent_origin_residual_is_not_hidden(self):
        async def independent(request):
            response = await self.source(request)
            data = json.loads(response.content)
            data["elevation"][-1] += 3.25
            return httpx.Response(200, json=data)
        async with httpx.AsyncClient(transport=httpx.MockTransport(independent)) as client:
            result = await T.fetch_terrain(self.patch, client, non_commercial=True)
        self.assertAlmostEqual(result["originGridResidualM"], -3.25, places=7)
        self.assertAlmostEqual(result["originElevationM"], 55.0, places=7)

    async def test_fixture_exact_polygon_clipping_no_spill_or_holes(self):
        for patch in (self.patch, fixture_patch(diamond=True)):
            with self.subTest(diamond=len(patch["boundary"]) == 5):
                result = await self.fetch(patch)
                boundary = Polygon(patch["boundary"])
                mesh = result["clippedMesh"]
                triangles = []
                for face in mesh["faces"]:
                    xyz = [mesh["vertices"][i] for i in face]
                    a, b, c = xyz
                    signed = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
                    self.assertGreater(signed, 0)
                    poly = Polygon([p[:2] for p in xyz])
                    self.assertLess(poly.difference(boundary).area, 1e-7)
                    triangles.append(poly)
                    for x, y, z in xyz:
                        self.assertAlmostEqual(z, T.height_at(result, x, y), places=9)
                union = unary_union(triangles)
                self.assertLess(union.symmetric_difference(boundary).area, 1e-6)
                self.assertAlmostEqual(sum(p.area for p in triangles), boundary.area, places=6)

    async def test_fixture_constant_real_values_are_not_fabricated_relief(self):
        async def flat(request):
            count = len(request.url.params["latitude"].split(","))
            return httpx.Response(200, json={"elevation": [-3.75]*count})
        async with httpx.AsyncClient(transport=httpx.MockTransport(flat)) as client:
            result = await T.fetch_terrain(self.patch, client, non_commercial=True)
        self.assertEqual(result["originElevationM"], -3.75)
        self.assertEqual({v[2] for v in result["vertices"]}, {0.0})
        self.assertIn("responseSha256", result["provenance"])

    async def test_fixture_terms_acknowledgement_required_even_with_cache(self):
        with self.assertRaisesRegex(T.TerrainError, "non-commercial"):
            await T.fetch_terrain(self.patch, self.client)
        self.assertEqual(len(self.source.requests), 0)
        await self.fetch()
        with self.assertRaisesRegex(T.TerrainError, "non-commercial"):
            await T.fetch_terrain(self.patch, self.client)

    async def test_fixture_invalid_patch_and_grid_rejected_before_network(self):
        patches = [None, {}, copy.deepcopy(self.patch), copy.deepcopy(self.patch), copy.deepcopy(self.patch)]
        patches[2]["origin"]["lat"] = math.nan
        patches[3]["crs"]["local"] = "EPSG:4326"
        patches[4]["localBounds"]["maxX"] = 20000
        for patch in patches:
            with self.subTest(patch=patch), self.assertRaises(T.TerrainError):
                await T.fetch_terrain(patch, self.client, non_commercial=True)
        for rows, cols in [(1, 9), (10, 9), (9, True), (9.0, 9)]:
            with self.subTest(grid=(rows, cols)), self.assertRaises(T.TerrainError):
                await self.fetch(rows=rows, cols=cols)
        bad = copy.deepcopy(self.patch)
        bad["bounds"][0] -= 0.01
        with self.assertRaisesRegex(T.TerrainError, "bounds do not match"):
            await self.fetch(bad)
        self.assertEqual(len(self.source.requests), 0)

    async def test_fixture_nodata_malformed_and_sentinels_never_fallback(self):
        payloads = [b"not json", b"[]", b'{}', b'{"error":true}', b'{"elevation":[]}']
        for value in [None, True, "12", math.nan, math.inf, -32768, 32767, -99999, 99999, -9999, 9999]:
            values = [7.5]*82
            values[6] = value
            payloads.append(json.dumps({"elevation": values}).encode())
        for payload in payloads:
            with self.subTest(payload=payload[:100]):
                calls = []
                async def invalid(request):
                    calls.append(request)
                    return httpx.Response(200, content=payload, headers={"Content-Type": "application/json"})
                async with httpx.AsyncClient(transport=httpx.MockTransport(invalid)) as client:
                    with self.assertRaises(T.TerrainError):
                        await T.fetch_terrain(self.patch, client, non_commercial=True)
                self.assertEqual(len(calls), 1, "bad payloads must not be retried")
                self.assertEqual(len(T._CACHE), 0)

    async def test_fixture_html_redirect_and_oversized_payload_fail(self):
        for status, content, headers in [(200, b'<html>blocked</html>', {"Content-Type": "text/html"}),
                                         (302, b'', {"Location": "https://example.invalid"}),
                                         (200, b' '*(T.MAX_RESPONSE_BYTES+1), {"Content-Type": "application/json"})]:
            async def bad(request):
                return httpx.Response(status, content=content, headers=headers)
            async with httpx.AsyncClient(transport=httpx.MockTransport(bad)) as client:
                with self.subTest(status=status, length=len(content)), self.assertRaises(T.TerrainError):
                    await T.fetch_terrain(self.patch, client, non_commercial=True)

    async def test_fixture_transient_retry_is_bounded_and_can_recover(self):
        calls = []
        async def once(request):
            calls.append(request)
            if len(calls) == 1:
                return httpx.Response(503)
            return await self.source(request)
        async with httpx.AsyncClient(transport=httpx.MockTransport(once)) as client:
            result = await T.fetch_terrain(self.patch, client, non_commercial=True)
        self.assertEqual(len(calls), 2)
        self.assertEqual(len(result["vertices"]), 81)
        T.clear_cache()
        calls.clear()
        async def unavailable(request):
            calls.append(request)
            return httpx.Response(429)
        async with httpx.AsyncClient(transport=httpx.MockTransport(unavailable)) as client:
            with self.assertRaisesRegex(T.TerrainError, "after_2_attempts.*429"):
                await T.fetch_terrain(self.patch, client, non_commercial=True)
        self.assertEqual(len(calls), 2)
        self.assertFalse(T._CACHE)

    async def test_fixture_transport_error_is_bounded_and_http_403_not_retried(self):
        for kind in ("timeout", "403"):
            calls = []
            async def bad(request):
                calls.append(request)
                if kind == "timeout":
                    raise httpx.ReadTimeout("fixture timeout", request=request)
                return httpx.Response(403)
            async with httpx.AsyncClient(transport=httpx.MockTransport(bad)) as client:
                with self.subTest(kind=kind), self.assertRaises(T.TerrainError):
                    await T.fetch_terrain(self.patch, client, non_commercial=True)
            self.assertEqual(len(calls), 2 if kind == "timeout" else 1)

    async def test_fixture_cache_deep_copy_and_exact_bounds_grid_version_keys(self):
        result = await self.fetch()
        result["vertices"][0][2] = 12345
        cached = await self.fetch()
        self.assertNotEqual(cached["vertices"][0][2], 12345)
        self.assertEqual(len(self.source.requests), 1)
        almost = copy.deepcopy(self.patch)
        almost["bounds"][0] = math.nextafter(almost["bounds"][0], -math.inf)
        await self.fetch(almost)
        await self.fetch(cols=8)
        with mock.patch.object(T, "DATASET_VERSION", "fixture-different-release"):
            await self.fetch()
        self.assertEqual(len(self.source.requests), 4)

    async def test_fixture_ttl_failure_never_serves_stale_success(self):
        with mock.patch.object(T, "CACHE_TTL_S", 0.005):
            await self.fetch()
        await asyncio.sleep(0.02)
        async def error(request):
            return httpx.Response(403)
        async with httpx.AsyncClient(transport=httpx.MockTransport(error)) as client:
            with self.assertRaises(T.TerrainError):
                await T.fetch_terrain(self.patch, client, non_commercial=True)
        self.assertFalse(T._CACHE)

    async def test_fixture_lru_size_bound(self):
        with mock.patch.object(T, "CACHE_MAX_ENTRIES", 2):
            for half in (100, 120, 140):
                await self.fetch(fixture_patch(half))
            self.assertEqual(len(T._CACHE), 2)
            await self.fetch(fixture_patch(100))
            self.assertEqual(len(self.source.requests), 4)

    async def test_fixture_coalesces_and_cancelled_waiter_does_not_cancel_shared_work(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def slow(request):
            entered.set()
            await release.wait()
            return await self.source(request)
        async with httpx.AsyncClient(transport=httpx.MockTransport(slow)) as client:
            args = {"client": client, "non_commercial": True}
            first = asyncio.create_task(T.fetch_terrain(self.patch, **args))
            await entered.wait()
            second = asyncio.create_task(T.fetch_terrain(self.patch, **args))
            await asyncio.sleep(0.01)
            first.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await first
            release.set()
            result = await second
        self.assertEqual(len(self.source.requests), 1)
        self.assertEqual(len(result["vertices"]), 81)
        self.assertEqual(T._ACTIVE_REQUESTS, 0)

    async def test_fixture_inflight_concurrency_and_queue_are_bounded(self):
        release = asyncio.Event()
        started = 0
        active = 0
        peak = 0
        async def slow(request):
            nonlocal started, active, peak
            started += 1
            active += 1
            peak = max(peak, active)
            try:
                await release.wait()
                return await self.source(request)
            finally:
                active -= 1
        async with httpx.AsyncClient(transport=httpx.MockTransport(slow)) as client:
            tasks = [asyncio.create_task(T.fetch_terrain(fixture_patch(100+i), client, non_commercial=True))
                     for i in range(T.MAX_PENDING_REQUESTS)]
            try:
                for _ in range(100):
                    if started == T.MAX_CONCURRENT_REQUESTS:
                        break
                    await asyncio.sleep(0.01)
                self.assertEqual(started, 2)
                with self.assertRaisesRegex(T.TerrainError, "terrain_busy"):
                    await T.fetch_terrain(fixture_patch(200), client, non_commercial=True)
            finally:
                release.set()
                await asyncio.gather(*tasks)
        self.assertEqual(peak, 2)
        self.assertEqual(T._ACTIVE_REQUESTS, 0)

    async def test_fixture_absolute_request_deadline_is_bounded(self):
        calls = []
        async def delayed(request):
            calls.append(request)
            await asyncio.sleep(0.1)
            return await self.source(request)
        async with httpx.AsyncClient(transport=httpx.MockTransport(delayed)) as client:
            with mock.patch.object(T, "REQUEST_TIMEOUT_S", 0.01):
                with self.assertRaisesRegex(T.TerrainError, "after_2_attempts"):
                    await T.fetch_terrain(self.patch, client, non_commercial=True)
        self.assertEqual(len(calls), 2)

    async def test_fixture_sync_wrapper_refuses_running_event_loop(self):
        with self.assertRaisesRegex(T.TerrainError, "use await"):
            T.fetch_terrain_sync(self.patch, non_commercial=True)

    async def test_fixture_sampler_imports_and_runs_without_site_packages(self):
        result = await self.fetch()
        path = str(Path(T.__file__).resolve())
        script = ("import sys,json,importlib.util\n"
                  "sys.dont_write_bytecode=True\n"
                  "s=importlib.util.spec_from_file_location('terrain_only',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n"
                  "t=json.loads(sys.stdin.read()); print(m.height_at(t,0.,0.,absolute=True))\n"
                  "assert not any(k in sys.modules for k in ('httpx','pyproj','shapely','numpy'))\n")
        process = subprocess.run([sys.executable, "-S", "-c", script, path], input=json.dumps(result),
                                 text=True, capture_output=True, timeout=10)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertAlmostEqual(float(process.stdout), 51.75, places=7)


@unittest.skipUnless(os.environ.get("GEV_TERRAIN_LIVE") == "1", "LIVE API smoke is opt-in; all other tests are synthetic fixtures")
class TerrainLiveSmoke(unittest.IsolatedAsyncioTestCase):
    async def test_live_researched_yas_mall_grid(self):
        # Read existing verified evidence; DO NOT replace a missing file with
        # hardcoded/example coordinates or fabricated values.
        path = Path(os.environ.get("GEV_COORDINATE_EVIDENCE", "/tmp/gev-repair-evidence/coordinate-research.json"))
        evidence_bytes = path.read_bytes()
        evidence = json.loads(evidence_bytes)
        site = evidence["yas"]
        self.assertEqual(site["osmType"], "way")
        self.assertTrue(site["sourceUrl"].startswith("https://api.openstreetmap.org/"))
        import geography as G
        focal = {"lat": site["lat"], "lon": site["lng"], "verification": {
            "source": site["sourceUrl"], "featureId": "way/"+str(site["osmId"]),
            "coordinateEvidence": "Existing researched source, not a new place-verification claim"}}
        patch = G.make_patch(focal, aoi=site["bounds"])
        T.clear_cache()
        result = await T.fetch_terrain(patch, non_commercial=True)
        self.assertEqual(len(result["vertices"]), 81)
        self.assertEqual(result["provenance"]["sampleCount"], 82)
        self.assertTrue(math.isfinite(result["originElevationM"]))
        self.assertTrue(result["clippedMesh"]["faces"])
        self.assertAlmostEqual(T.height_at(result, 0, 0), result["originGridResidualM"], places=8)
        print("LIVE_TERRAIN_SMOKE="+json.dumps({
            "label": "LIVE read-only Open-Meteo request, NOT fixtures", "site": site["tags"].get("name:en"),
            "coordinates": result["origin"], "bounds": result["bounds"],
            "evidenceSha256": hashlib.sha256(evidence_bytes).hexdigest(), "siteSourceUrl": site["sourceUrl"],
            "rows": result["grid"]["rows"], "cols": result["grid"]["cols"],
            "gridSpacingM": result["provenance"]["gridSpacingM"],
            "originElevationM": result["originElevationM"], "originGridResidualM": result["originGridResidualM"],
            "absoluteElevationsM": result["grid"]["elevationsM"], "elevation": result["elevation"],
            "clippedVertexCount": len(result["clippedMesh"]["vertices"]), "clippedFaceCount": len(result["clippedMesh"]["faces"]),
            "retrievedUtc": result["provenance"]["retrievedUtc"], "sourceUrl": result["provenance"]["sourceUrl"],
            "responseSha256": result["provenance"]["responseSha256"], "requestSha256": result["provenance"]["requestSha256"],
        }, allow_nan=False, sort_keys=True))


if __name__ == "__main__":
    unittest.main()
