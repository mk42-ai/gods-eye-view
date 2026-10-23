"""Vercel Python function + local ASGI app for the footage service.

Public routes (vercel.json rewrites `/footage/:path*` and `/api/footage/:path*`
to this function with the original sub-path in `?__fp=`):
  GET /footage/health
  GET /footage/search?lat&lon&radius_km&keywords&since&mode=live|rebuild&limit&place
  GET /footage/stream  (same params; text/event-stream)
  POST /footage/route/plan
  GET /footage/route/alerts?sceneId&mock
  GET /footage/scenes
  GET|PUT|DELETE /footage/scenes/{id}

Vercel's Python runtime serves the ASGI `app` exported here; locally
`uvicorn api.footage.index:app --port 8787` runs the same object.
"""
from __future__ import annotations

import json
import os
import sys
from typing import Optional

from fastapi import FastAPI, Query as Q, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
try:  # package import (uvicorn api.footage.index:app)
    from . import service as svc  # type: ignore
    from . import route  # type: ignore
except Exception:  # Vercel runtime imports the file flat
    import service as svc  # type: ignore
    import route  # type: ignore

app = FastAPI(title="gods-eye-footage-service", version="1.0.0", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], allow_headers=["*"])
NO_STORE = {"Cache-Control": "no-store"}


class Params:
    def __init__(
        self,
        lat: Optional[float] = Q(None, ge=-90, le=90),
        lon: Optional[float] = Q(None, ge=-180, le=180),
        radius_km: float = Q(5.0, ge=0.1, le=500),
        keywords: str = Q("", max_length=200),
        since: Optional[str] = Q(None, max_length=40),
        mode: str = Q("live", pattern="^(live|rebuild)$"),
        limit: int = Q(12, ge=1, le=40),
        place: Optional[str] = Q(None, max_length=120),
        fixtures: bool = False,
    ):
        self.lat, self.lon, self.radius_km, self.keywords, self.since, self.mode, self.limit, self.place = lat, lon, radius_km, keywords, since, mode, limit, place
        self.fixtures = bool(fixtures)

    def query(self, plugin_timeout=None) -> "svc.Query":
        q = svc.Query(lat=self.lat, lon=self.lon, radius_km=self.radius_km, keywords=self.keywords or "", since=self.since, mode=self.mode or "live", limit=self.limit, place_hint=self.place, plugin_timeout=plugin_timeout)
        q.fixtures = bool(getattr(self, "fixtures", False))
        return q


def _sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def do_health():
    h = svc.health()
    h["route_agent"] = route.health_block()
    return JSONResponse(h, headers=NO_STORE)


async def do_search(p: Params):
    payload = await svc.search(p.query())
    return JSONResponse(payload, headers={"Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=120"})


async def do_stream(request: Request, p: Params):
    q = p.query(plugin_timeout=svc.STREAM_PLUGIN_TIMEOUT_S)

    async def gen():
        yield ": gods-eye-footage-service stream\n\n"
        yield _sse("open", {"mode": q.mode, "since": svc.S.iso(q.since)})
        try:
            async for ev in svc.stream_events(q):
                if await request.is_disconnected():
                    break
                yield _sse(ev["event"], ev["data"])
        except Exception as exc:  # noqa: BLE001
            yield _sse("error", {"error": f"{exc.__class__.__name__}: {str(exc)[:160]}"})
            yield _sse("done", {"error": True})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


async def do_route_plan(request: Request):
    if request.query_params.get("mock") == "500":
        return JSONResponse({"error": "route_agent_failed"}, status_code=500, headers=NO_STORE)
    try:
        body = await request.json()
    except Exception:
        body = {}
    plan = await route.plan_route(body)
    if request.query_params.get("fixtures") == "1":
        # Test mode: the FIXTURE route table (explicit status + lastChecked + source) replaces
        # the curated "status unknown" roads, so the acceptance tests can assert statuses.
        try:
            from fixtures_replay import pick_fixture  # type: ignore

            t = body.get("target") or {}
            fx = pick_fixture(t.get("name"), "", t.get("lat"), t.get("lon"))
            if fx and fx.get("groundRoutes"):
                plan["groundRoutes"] = fx["groundRoutes"]
                plan["alerts"] = fx.get("alerts", [])
                plan["basis"] = (plan.get("basis") or "") + " + FIXTURE route table"
        except Exception:  # noqa: BLE001
            pass
    return JSONResponse(plan, headers=NO_STORE)


def do_route_alerts(request: Request):
    scene_id = request.query_params.get("sceneId") or request.query_params.get("scene_id")
    mock = request.query_params.get("mock") in ("1", "true", "True")
    payload = route.route_alerts(scene_id, mock=mock)
    if request.query_params.get("fixtures") == "1" and not mock:
        try:
            from fixtures_replay import _load  # type: ignore

            fx = _load("umm-suqeim-rebuild")
            payload["alerts"] = list(payload.get("alerts") or []) + list((fx or {}).get("alerts") or [])
        except Exception:  # noqa: BLE001
            pass
    return JSONResponse(payload, headers=NO_STORE)


def do_list_scenes():
    return JSONResponse(route.list_scenes(), headers=NO_STORE)


def do_get_scene(scene_id: str):
    sc = route.get_scene(scene_id)
    if sc is None:
        return JSONResponse({"error": "not_found", "sceneId": scene_id}, status_code=404, headers=NO_STORE)
    return JSONResponse(sc, headers=NO_STORE)


async def do_save_scene(scene_id: str, request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    saved = route.save_scene(scene_id, body)
    return JSONResponse(saved, headers=NO_STORE)


def do_delete_scene(scene_id: str):
    ok = route.delete_scene(scene_id)
    if not ok:
        return JSONResponse({"error": "not_found", "sceneId": scene_id}, status_code=404, headers=NO_STORE)
    return JSONResponse({"deleted": True, "sceneId": scene_id}, headers=NO_STORE)


def _index():
    return JSONResponse(
        {
            "service": "gods-eye-footage-service",
            "endpoints": [
                "/footage/health",
                "/footage/search",
                "/footage/stream",
                "/footage/route/plan",
                "/footage/route/alerts",
                "/footage/scenes",
            ],
        },
        headers=NO_STORE,
    )


@app.get("/footage/health")
@app.get("/api/footage/health")
async def footage_health():
    return await do_health()


@app.get("/footage/search")
@app.get("/api/footage/search")
async def footage_search(request: Request):
    return await do_search(Params(**_kw(request)))


@app.get("/footage/stream")
@app.get("/api/footage/stream")
async def footage_stream(request: Request):
    return await do_stream(request, Params(**_kw(request)))


@app.post("/footage/route/plan")
@app.post("/api/footage/route/plan")
async def footage_route_plan(request: Request):
    return await do_route_plan(request)


@app.get("/footage/route/alerts")
@app.get("/api/footage/route/alerts")
async def footage_route_alerts(request: Request):
    return do_route_alerts(request)


@app.get("/footage/scenes")
@app.get("/api/footage/scenes")
async def footage_scenes_list():
    return do_list_scenes()


@app.get("/footage/scenes/{scene_id}")
@app.get("/api/footage/scenes/{scene_id}")
async def footage_scenes_get(scene_id: str):
    return do_get_scene(scene_id)


@app.put("/footage/scenes/{scene_id}")
@app.put("/api/footage/scenes/{scene_id}")
async def footage_scenes_put(scene_id: str, request: Request):
    return await do_save_scene(scene_id, request)


@app.delete("/footage/scenes/{scene_id}")
@app.delete("/api/footage/scenes/{scene_id}")
async def footage_scenes_delete(scene_id: str):
    return do_delete_scene(scene_id)


def _kw(request: Request) -> dict:
    """Validate query params through the Params signature by hand (so the same code serves the rewrite catch-all)."""
    qp = request.query_params
    out = {}

    def num(name, lo, hi, cast=float):
        v = qp.get(name)
        if v in (None, ""):
            return None
        try:
            n = cast(v)
        except Exception:
            raise _bad(f"{name} must be a number")
        if n < lo or n > hi:
            raise _bad(f"{name} out of range")
        return n

    out["lat"] = num("lat", -90, 90)
    out["lon"] = num("lon", -180, 180)
    out["radius_km"] = num("radius_km", 0.1, 500) or 5.0
    out["keywords"] = (qp.get("keywords") or "")[:200]
    out["since"] = (qp.get("since") or None)
    if out["since"]:
        out["since"] = out["since"][:40]
    mode = qp.get("mode") or "live"
    if mode not in ("live", "rebuild"):
        raise _bad("mode must be live|rebuild")
    out["mode"] = mode
    out["limit"] = int(num("limit", 1, 40, int) or 12)
    out["place"] = (qp.get("place") or None)
    if out["place"]:
        out["place"] = out["place"][:120]
    out["fixtures"] = qp.get("fixtures") == "1"
    return out


class _Bad(Exception):
    def __init__(self, msg):
        super().__init__(msg)
        self.msg = msg


def _bad(msg):
    return _Bad(msg)


@app.exception_handler(_Bad)
async def _bad_handler(_req, exc: _Bad):
    return JSONResponse({"error": "invalid_param", "message": exc.msg}, status_code=400, headers=NO_STORE)


# … and the Vercel rewrite entry point: the function is addressed as /api/footage/index
# with the public sub-path carried in ?__fp= (see vercel.json).
@app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
async def rewrite_dispatch(full_path: str, request: Request):
    fp = request.query_params.get("__fp")
    if fp:
        sub = fp.strip("/")
    else:
        clean = full_path.strip("/")
        if clean.startswith("api/"):
            clean = clean[4:].strip("/")
        if clean.startswith("footage/"):
            clean = clean[8:].strip("/")
        sub = clean

    if sub == "health":
        return await do_health()
    if sub == "search":
        return await do_search(Params(**_kw(request)))
    if sub == "stream":
        return await do_stream(request, Params(**_kw(request)))
    if sub == "route/plan":
        return await do_route_plan(request)
    if sub == "route/alerts":
        return do_route_alerts(request)
    if sub == "scenes":
        if request.method == "GET":
            return do_list_scenes()
        try:
            body = await request.json()
        except Exception:
            body = {}
        sid = body.get("id") or "scene"
        return JSONResponse(route.save_scene(sid, body), headers=NO_STORE)
    if sub.startswith("scenes/"):
        sid = sub[len("scenes/"):]
        if request.method == "GET":
            return do_get_scene(sid)
        if request.method == "PUT":
            return await do_save_scene(sid, request)
        if request.method == "DELETE":
            return do_delete_scene(sid)
    if sub in ("", "index", "footage"):
        return _index()
    return JSONResponse({"error": "not_found", "path": full_path}, status_code=404, headers=NO_STORE)
