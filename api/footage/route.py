"""Gods-Eye route planning and scenes management API.
Implements great-circle fallback, OnDemand Route Monitoring Agent plugin,
alerts polling, and scenes in-memory CRUD.
"""
from __future__ import annotations

import asyncio
import time
import datetime
import math
import os
import sys
from typing import Any, Optional

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

try:
    from . import ondemand_client as odc
    from . import scenes_store
except Exception:
    import ondemand_client as odc
    import scenes_store

EARTH_RADIUS_KM = 6371.0088
DEG = math.pi / 180.0
PLUGIN_ID = os.environ.get("ROUTE_MONITORING_PLUGIN_ID") or "plugin-1750847932"

_cached_agent_status: str = "unknown"
_agent_inactive_until: float = 0.0

LADDER = [
    {
        "stage": "S0",
        "alt": 8_000_000,
        "pitch": -90,
        "durationMs": 1200,
        "holdMs": 1500,
        "revealLayers": ["globe", "viirs", "aoi-rings", "target-region"],
    },
    {
        "stage": "S1",
        "alt": 1_200_000,
        "pitch": -70,
        "durationMs": 2200,
        "holdMs": 1500,
        "revealLayers": ["country-outline", "scene-aoi-ring", "ground-routes"],
    },
    {
        "stage": "S2",
        "alt": 18_000,
        "pitch": -60,
        "durationMs": 2600,
        "holdMs": 4200,
        "revealLayers": ["pins", "distance-rings", "header"],
    },
    {
        "stage": "S3",
        "alt": 2_000,
        "pitch": -45,
        "durationMs": 2200,
        "holdMs": 1500,
        "revealLayers": ["clusters", "leader-lines", "route-labels"],
    },
    {
        "stage": "S4",
        "alt": 300,
        "pitch": -30,
        "durationMs": 2300,
        "holdMs": 11000,
        "revealLayers": ["rail", "timeline", "player"],
    },
]

DUBAI_CENTER = (25.2048, 55.2708)

DUBAI_GROUND_ROUTES = [
    {
        "id": "szr",
        "name": "Sheikh Zayed Road (E11)",
        "kind": "motorway",
        "status": "unknown",
        "source": "curated-table (no live status)",
        "geometry": [
            [25.2048, 55.2708],
            [25.1859, 55.2534],
            [25.1663, 55.2318],
            [25.1415, 55.2076],
            [25.1165, 55.1832],
            [25.0901, 55.1569],
        ],
    },
    {
        "id": "alwasl",
        "name": "Al Wasl Road (D92)",
        "kind": "arterial",
        "status": "unknown",
        "source": "curated-table (no live status)",
        "geometry": [
            [25.2176, 55.2581],
            [25.1955, 55.2374],
            [25.1727, 55.2178],
            [25.1521, 55.2003],
            [25.1317, 55.1838],
        ],
    },
    {
        "id": "jumeirah",
        "name": "Jumeirah Street (D94)",
        "kind": "arterial",
        "status": "unknown",
        "source": "curated-table (no live status)",
        "geometry": [
            [25.2261, 55.2612],
            [25.204, 55.242],
            [25.1795, 55.2217],
            [25.1567, 55.2005],
            [25.1388, 55.185],
        ],
    },
]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    d_lat = (lat2 - lat1) * DEG
    d_lon = (lon2 - lon1) * DEG
    a = (
        math.sin(d_lat / 2.0) ** 2
        + math.cos(lat1 * DEG) * math.cos(lat2 * DEG) * math.sin(d_lon / 2.0) ** 2
    )
    return 2.0 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = lat1 * DEG
    phi2 = lat2 * DEG
    delta_lambda = (lon2 - lon1) * DEG
    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)
    theta = math.atan2(y, x)
    return (((theta / DEG) % 360.0) + 360.0) % 360.0


def destination_point(lat: float, lon: float, bearing: float, km: float) -> dict[str, float]:
    d_r = km / EARTH_RADIUS_KM
    brg = bearing * DEG
    lat1 = lat * DEG
    lon1 = lon * DEG

    lat2 = math.asin(math.sin(lat1) * math.cos(d_r) + math.cos(lat1) * math.sin(d_r) * math.cos(brg))
    lon2 = lon1 + math.atan2(
        math.sin(brg) * math.sin(d_r) * math.cos(lat1),
        math.cos(d_r) - math.sin(lat1) * math.sin(lat2),
    )
    return {
        "lat": lat2 / DEG,
        "lon": (((lon2 / DEG) + 540.0) % 360.0) - 180.0,
    }


def build_scene_path(
    origin: Optional[dict[str, Any]],
    target: dict[str, Any],
    preset: Optional[dict[str, Any]] = None,
    approach_bearing: Optional[float] = None,
) -> list[dict[str, Any]]:
    preset = preset or {"alt": 18000, "heading": 0, "pitch": 60, "dwell": [4.2, 11]}
    t_lat = float(target.get("lat") or 0.0)
    t_lon = float(target.get("lon") or 0.0)

    bearing = approach_bearing
    if bearing is None:
        if (
            origin
            and origin.get("lat") is not None
            and origin.get("lon") is not None
            and (origin.get("lat") != t_lat or origin.get("lon") != t_lon)
        ):
            bearing = bearing_deg(float(origin["lat"]), float(origin["lon"]), t_lat, t_lon)
        else:
            bearing = float(preset.get("heading", 0))
    bearing = ((bearing % 360.0) + 360.0) % 360.0

    # S0: over target
    s0 = {
        "lat": t_lat,
        "lon": t_lon,
        "alt": LADDER[0]["alt"],
        "heading": bearing,
        "pitch": LADDER[0]["pitch"],
        "durationMs": LADDER[0]["durationMs"],
        "easing": "quadInOut",
        "stage": "S0",
        "revealLayers": list(LADDER[0]["revealLayers"]),
    }

    # S1: offset 2° back along approach bearing
    back_bearing = (bearing + 180.0) % 360.0
    s1_pos = destination_point(t_lat, t_lon, back_bearing, 2.0 * DEG * EARTH_RADIUS_KM)
    s1 = {
        "lat": s1_pos["lat"],
        "lon": s1_pos["lon"],
        "alt": LADDER[1]["alt"],
        "heading": bearing,
        "pitch": LADDER[1]["pitch"],
        "durationMs": LADDER[1]["durationMs"],
        "easing": "quadInOut",
        "stage": "S1",
        "revealLayers": list(LADDER[1]["revealLayers"]),
    }

    # S2: preset.alt and preset.heading
    s2 = {
        "lat": t_lat,
        "lon": t_lon,
        "alt": preset.get("alt", LADDER[2]["alt"]),
        "heading": preset.get("heading", bearing),
        "pitch": LADDER[2]["pitch"],
        "durationMs": LADDER[2]["durationMs"],
        "easing": "quadInOut",
        "stage": "S2",
        "revealLayers": list(LADDER[2]["revealLayers"]),
    }

    # S3: over target
    s3 = {
        "lat": t_lat,
        "lon": t_lon,
        "alt": LADDER[3]["alt"],
        "heading": bearing,
        "pitch": LADDER[3]["pitch"],
        "durationMs": LADDER[3]["durationMs"],
        "easing": "quadInOut",
        "stage": "S3",
        "revealLayers": list(LADDER[3]["revealLayers"]),
    }

    # S4: ~350 m from target along approach bearing looking at it
    s4_pos = destination_point(t_lat, t_lon, back_bearing, 0.35)
    s4 = {
        "lat": s4_pos["lat"],
        "lon": s4_pos["lon"],
        "alt": LADDER[4]["alt"],
        "heading": bearing_deg(s4_pos["lat"], s4_pos["lon"], t_lat, t_lon),
        "pitch": LADDER[4]["pitch"],
        "durationMs": LADDER[4]["durationMs"],
        "easing": "quadInOut",
        "stage": "S4",
        "revealLayers": list(LADDER[4]["revealLayers"]),
    }

    return [s0, s1, s2, s3, s4]


def _extract_geometry(payload: Any) -> Optional[list[list[float]]]:
    """Extract usable [[lat, lon], ...] geometry from agent JSON response."""
    if not payload:
        return None
    coords = None
    if isinstance(payload, list):
        coords = payload
    elif isinstance(payload, dict):
        coords = payload.get("geometry") or payload.get("coordinates") or payload.get("route")
    if not isinstance(coords, list) or len(coords) < 2:
        return None
    out = []
    for item in coords:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            try:
                lat = float(item[0])
                lon = float(item[1])
                out.append([lat, lon])
            except (ValueError, TypeError):
                continue
    return out if len(out) >= 2 else None


async def plan_route(body: dict[str, Any]) -> dict[str, Any]:
    global _cached_agent_status
    origin = body.get("origin")
    target = body.get("target") or {"lat": 25.147, "lon": 55.199, "name": "Target"}
    preset = body.get("preset") or {"alt": 18000, "heading": 0, "pitch": 60, "dwell": [4.2, 11]}
    t_ref = body.get("tRef")
    approach_bearing = body.get("approachBearing")

    t_lat = float(target.get("lat") or 0.0)
    t_lon = float(target.get("lon") or 0.0)
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()

    calc_bearing = approach_bearing
    if calc_bearing is None:
        if (
            origin
            and origin.get("lat") is not None
            and origin.get("lon") is not None
            and (origin.get("lat") != t_lat or origin.get("lon") != t_lon)
        ):
            calc_bearing = bearing_deg(float(origin["lat"]), float(origin["lon"]), t_lat, t_lon)
        else:
            calc_bearing = float(preset.get("heading", 0))

    scene_path = build_scene_path(origin, target, preset, calc_bearing)

    # Check curated Dubai routes
    is_dubai = haversine_km(t_lat, t_lon, DUBAI_CENTER[0], DUBAI_CENTER[1]) <= 15.0
    ground_routes = []
    if is_dubai:
        for r in DUBAI_GROUND_ROUTES:
            ground_routes.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "kind": r["kind"],
                    "status": "unknown",
                    "source": "curated-table (no live status)",
                    "geometry": [list(pt) for pt in r["geometry"]],
                    "lastChecked": now_iso,
                }
            )

    # Try OnDemand Route Monitoring Agent
    agent_info = {"plugin": PLUGIN_ID, "status": "unknown"}
    agent_geometry = None

    global _agent_inactive_until
    if odc.configured() and time.monotonic() < _agent_inactive_until:
        # The account is not subscribed to the agent; do not burn 4 s per scene re-checking.
        agent_info = {"plugin": PLUGIN_ID, "status": "inactive", "error": "not subscribed (cached)"}
    elif odc.configured():
        client = odc.OnDemandClient(timeout=4.0)
        o_lat = float(origin.get("lat")) if origin and origin.get("lat") is not None else t_lat
        o_lon = float(origin.get("lon")) if origin and origin.get("lon") is not None else t_lon
        prompt = (
            f"Provide driving route geometry from lat={o_lat},lon={o_lon} to lat={t_lat},lon={t_lon} "
            f"as JSON coordinates [[lat,lon],...]."
        )
        try:
            parsed_json, _ = await asyncio.wait_for(
                client.query_json([PLUGIN_ID], prompt),
                timeout=4.0,
            )
            agent_geometry = _extract_geometry(parsed_json)
            _cached_agent_status = "active"
            agent_info = {"plugin": PLUGIN_ID, "status": "active"}
        except odc.PluginUnavailable as exc:
            _cached_agent_status = "inactive"
            _agent_inactive_until = time.monotonic() + 300
            agent_info = {"plugin": PLUGIN_ID, "status": "inactive", "error": str(exc)}
        except Exception as exc:
            _cached_agent_status = "error"
            agent_info = {"plugin": PLUGIN_ID, "status": "error", "error": str(exc)}
    else:
        _cached_agent_status = "inactive"
        agent_info = {"plugin": PLUGIN_ID, "status": "inactive", "error": "ONDEMAND_API_KEY not configured"}

    if agent_geometry:
        ground_routes.insert(
            0,
            {
                "id": "route-agent-driving",
                "name": "Driving Route (Route Monitoring Agent)",
                "kind": "motorway",
                "status": "unknown",
                "source": "route-monitoring-agent",
                "geometry": agent_geometry,
                "lastChecked": now_iso,
            },
        )
        return {
            "scenePath": scene_path,
            "approachBearing": calc_bearing,
            "groundRoutes": ground_routes,
            "alerts": [],
            "confidence": 0.8,
            "basis": "route-monitoring-agent",
            "fallback": False,
            "agent": agent_info,
        }

    return {
        "scenePath": scene_path,
        "approachBearing": calc_bearing,
        "groundRoutes": ground_routes,
        "alerts": [],
        "confidence": 0.3,
        "basis": "great-circle-fallback",
        "fallback": True,
        "agent": agent_info,
    }


def route_alerts(scene_id: Optional[str] = None, mock: bool = False) -> dict[str, Any]:
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if mock:
        alerts = [
            {
                "id": "alert-mock-1",
                "at": now_iso,
                "severity": "warn",
                "text": "MOCK: lane closure on Al Wasl Road",
                "routeId": "alwasl",
                "lat": 25.1521,
                "lon": 55.2003,
            }
        ]
    else:
        alerts = []
    return {"sceneId": scene_id or "", "alerts": alerts}


def health_block() -> dict[str, Any]:
    return {
        "plugin": PLUGIN_ID,
        "status": _cached_agent_status,
    }


# Scenes CRUD
def list_scenes() -> list[dict[str, Any]]:
    return scenes_store.list_all()


def get_scene(scene_id: str) -> Optional[dict[str, Any]]:
    return scenes_store.get(scene_id)


def save_scene(scene_id: str, scene: dict[str, Any]) -> dict[str, Any]:
    return scenes_store.put(scene_id, scene)


def delete_scene(scene_id: str) -> bool:
    return scenes_store.delete(scene_id)
