"""Tests for route planning, alerts, scenes store, and dispatch rewrite."""
from __future__ import annotations

import os
import sys

from fastapi.testclient import TestClient

_HERE = os.path.dirname(os.path.abspath(__file__))
_PARENT = os.path.dirname(_HERE)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from index import app  # noqa: E402
import scenes_store  # noqa: E402


def test_plan_route_fallback_when_no_key(monkeypatch):
    monkeypatch.setenv("ONDEMAND_API_KEY", "")
    monkeypatch.setenv("ON_DEMAND_API_KEY", "")

    client = TestClient(app)
    body = {
        "origin": {"lat": 25.2048, "lon": 55.2708},
        "target": {"lat": 25.147, "lon": 55.199, "name": "Umm Suqeim"},
        "aoiId": "dubai-core",
    }
    res = client.post("/footage/route/plan", json=body)
    assert res.status_code == 200
    data = res.json()

    # 5 waypoints
    assert "scenePath" in data
    assert len(data["scenePath"]) == 5
    stages = [wp["stage"] for wp in data["scenePath"]]
    assert stages == ["S0", "S1", "S2", "S3", "S4"]

    # Travel duration within 9–12 s (10.5 s)
    total_travel_ms = sum(wp["durationMs"] for wp in data["scenePath"])
    assert 9000 <= total_travel_ms <= 12000
    assert total_travel_ms == 10500

    # Fallback status
    assert data["fallback"] is True
    assert data["confidence"] == 0.3
    assert data["basis"] == "great-circle-fallback"
    assert len(data["groundRoutes"]) == 3
    assert data["agent"]["status"] == "inactive"


def test_plan_route_mock_500():
    client = TestClient(app)
    body = {
        "origin": {"lat": 25.2, "lon": 55.27},
        "target": {"lat": 25.147, "lon": 55.199},
    }
    res = client.post("/footage/route/plan?mock=500", json=body)
    assert res.status_code == 500
    assert res.json() == {"error": "route_agent_failed"}


def test_route_alerts_mock():
    client = TestClient(app)
    # mock=1 returns 1 mock alert
    res = client.get("/footage/route/alerts?sceneId=s_test123&mock=1")
    assert res.status_code == 200
    data = res.json()
    assert data["sceneId"] == "s_test123"
    assert len(data["alerts"]) == 1
    alert = data["alerts"][0]
    assert alert["id"] == "alert-mock-1"
    assert alert["severity"] == "warn"
    assert alert["routeId"] == "alwasl"
    assert alert["lat"] == 25.1521
    assert alert["lon"] == 55.2003

    # without mock returns empty alerts
    res_empty = client.get("/footage/route/alerts?sceneId=s_test123")
    assert res_empty.status_code == 200
    assert res_empty.json()["alerts"] == []


def test_scenes_crud_round_trip():
    client = TestClient(app)
    scene_id = "s_round_trip_1"
    scene_data = {
        "id": scene_id,
        "title": "Incident in Umm Suqeim",
        "kind": "live",
        "target": {"lat": 25.147, "lon": 55.199},
    }

    # PUT
    res_put = client.put(f"/footage/scenes/{scene_id}", json=scene_data)
    assert res_put.status_code == 200
    assert res_put.json()["title"] == "Incident in Umm Suqeim"

    # GET
    res_get = client.get(f"/footage/scenes/{scene_id}")
    assert res_get.status_code == 200
    assert res_get.json()["id"] == scene_id

    # LIST
    res_list = client.get("/footage/scenes")
    assert res_list.status_code == 200
    scenes = res_list.json()
    assert any(s["id"] == scene_id for s in scenes)

    # DELETE
    res_del = client.delete(f"/footage/scenes/{scene_id}")
    assert res_del.status_code == 200
    assert res_del.json()["deleted"] is True

    # GET after DELETE -> 404
    res_404 = client.get(f"/footage/scenes/{scene_id}")
    assert res_404.status_code == 404


def test_rewrite_dispatch_route_alerts():
    client = TestClient(app)
    res = client.get("/api/footage/index?__fp=route/alerts&sceneId=x&mock=1")
    assert res.status_code == 200
    data = res.json()
    assert data["sceneId"] == "x"
    assert len(data["alerts"]) == 1
    assert data["alerts"][0]["id"] == "alert-mock-1"


def test_health_includes_route_agent():
    client = TestClient(app)
    res = client.get("/footage/health")
    assert res.status_code == 200
    data = res.json()
    assert "route_agent" in data
    assert data["route_agent"]["plugin"] == "plugin-1750847932"
    assert "status" in data["route_agent"]


def test_scenes_store_eviction():
    scenes_store.clear()
    assert scenes_store.size() == 0

    # Add 201 scenes
    for i in range(205):
        sid = f"s_evict_{i}"
        scenes_store.put(sid, {"id": sid, "num": i})

    assert scenes_store.size() == scenes_store.MAX
    # First 5 items (0..4) should have been evicted
    assert scenes_store.get("s_evict_0") is None
    assert scenes_store.get("s_evict_4") is None
    # 5..204 should be present
    assert scenes_store.get("s_evict_5") is not None
    assert scenes_store.get("s_evict_204") is not None
