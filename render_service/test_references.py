"""Placement + reference-binding tests for the render pipeline (no Blender, no network).

Run: GEV_ROOT=<repo root> python3 -m pytest render_service/test_references.py  (or python3 render_service/test_references.py)
"""
import os, sys, json
HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("GEV_ROOT", os.path.dirname(HERE))
sys.path.insert(0, HERE)
import pipeline as P
import references as R

FOCAL = {"name": "Yas Mall", "lat": 24.4886, "lon": 54.6085, "kind": "mall", "waterfront": False}

def fake_osm():
    # one east-west road through the focal point, one named mall footprint next to it, one far building
    lat, lon = FOCAL["lat"], FOCAL["lon"]
    road = {"id": 1, "tags": {"highway": "primary"}, "geometry": [{"lat": lat, "lon": lon - 0.004}, {"lat": lat, "lon": lon + 0.004}]}
    mall = {"id": 2, "tags": {"building": "retail", "name": "Yas Mall", "height": "24"}, "geometry": [
        {"lat": lat + 0.0005, "lon": lon - 0.001}, {"lat": lat + 0.0005, "lon": lon + 0.001}, {"lat": lat + 0.0012, "lon": lon + 0.001}, {"lat": lat + 0.0012, "lon": lon - 0.001}]}
    far = {"id": 3, "tags": {"building": "yes", "building:levels": "3"}, "geometry": [
        {"lat": lat + 0.002, "lon": lon + 0.002}, {"lat": lat + 0.002, "lon": lon + 0.0022}, {"lat": lat + 0.0022, "lon": lon + 0.0022}, {"lat": lat + 0.0022, "lon": lon + 0.002}]}
    return {"buildings": [mall, far], "highways": [road], "water": [], "status": "ok"}

def test_references_available():
    for r in R.REFERENCES:
        assert R.reference_path(r["id"]), f"missing {r['file']}"

def test_crash_placement_uses_reference_vehicles_and_decal():
    P.ASSET_KEYS.update({"civilian_sedan", "civilian_taxi", "debris_bumper", "debris_tire", "debris_door", "debris_plate"})
    spec = {"scenarioType": "route_closure", "_prompt": "car crash yas mall", "elements": [{"type": "cones", "params": {"spacing_m": 6}}]}
    inst, shapes, roads = P.place(spec, FOCAL, fake_osm(), 260.0, seed=P.prompt_seed("car crash yas mall"))
    by = {}
    for i in inst: by[i["asset"]] = by.get(i["asset"], 0) + 1
    assert by.get("civilian_sedan") == 1, by
    assert by.get("civilian_hatchback") == 1, by
    assert by.get("debris_cluster_decal") == 1, by
    assert by.get("debris_bumper", 0) >= 1
    a = next(i for i in inst if i["element"] == "crash_vehicle_a"); b = next(i for i in inst if i["element"] == "crash_vehicle_b")
    assert ((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2) ** 0.5 < 8.0, "crash pair must sit within one carriageway"
    scene = P.build_scene_json("t", FOCAL, spec, {}, fake_osm(), {"png": "x.png", "bounds_wsen": [54.60, 24.48, 54.61, 24.49], "attribution": ""}, inst, shapes, roads, "midday", 4, 24, ["2", "6"])
    refs = {r["id"]: r for r in scene["references"]}
    assert refs["silver_sedan"]["applied_count"] == 1 and refs["silver_sedan"]["applied"]
    assert refs["blue_hatchback"]["applied_count"] == 1
    assert refs["debris_cluster"]["applied_count"] >= 2
    assert refs["mall_facade_module"]["applied_count"] == 1, refs["mall_facade_module"]
    facaded = [b for b in scene["buildings"] if b.get("facade") == "mall_facade_module"]
    assert len(facaded) == 1 and facaded[0]["name"] == "Yas Mall"
    assert scene["virtual_assets"]["civilian_hatchback"] == "civilian_sedan"
    assert scene["gpus"] == ["2", "6"]

def test_non_mall_scene_gets_no_facade_and_counts_are_honest():
    palace = {"name": "Emirates Palace", "lat": 24.4617, "lon": 54.3173, "kind": "venue", "waterfront": True}
    bl = [{"pts": [[-10, -10], [10, -10], [10, 10], [-10, 10]], "h": 30, "name": "Emirates Palace"}]
    assert R.facade_building_indices(bl, palace) == [0]  # named venue match is allowed
    marathon = {"name": "Dubai Marina", "lat": 25.08, "lon": 55.14, "kind": "district", "waterfront": True}
    assert R.facade_building_indices(bl, marathon) == []
    refs = {r["id"]: r for r in R.bindings([], marathon, "marathon in dubai marina", "crowd_event", 0, 0)}
    assert all(not r["applied"] for r in refs.values())
    assert refs["silver_sedan"]["reason"] == "not a crash scene"

if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print("ok", name)
