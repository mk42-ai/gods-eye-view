"""Offline fixture contracts. No Blender, network, private configuration or GPU access."""
import copy
import json
import math
import os
from pathlib import Path
import sys
from unittest.mock import Mock
import pytest
from shapely.geometry import Polygon, Point, LineString
sys.path.insert(0,str(Path(__file__).parent))
import geography as G
import pipeline as P


@pytest.fixture(autouse=True)
def clear_geography_cache():
    G.GEO_CACHE.clear()
    yield
    G.GEO_CACHE.clear()

def focal():return G.resolve_location("selected location",24.4886,54.6085,selected=True)
def patch():return G.make_patch(focal())
def way(identifier,pts,tags,version=3):
    f=G.Frame(24.4886,54.6085)
    geom=[]
    for x,y in pts:
        lon,lat=f.inverse.transform(x,y);geom.append({"lat":lat,"lon":lon})
    return {"type":"way","id":identifier,"version":version,"timestamp":"2026-01-01T00:00:00Z","geometry":geom,"tags":tags}

def source():
    return {"elements":[way(10,[(-450,0),(450,0)],{"highway":"primary","width":"9"}),
        way(20,[(-50,35),(40,35),(40,95),(-50,95),(-50,35)],{"building":"retail","height":"30 ft"}),
        way(30,[(200,100),(320,100),(320,200),(200,200),(200,100)],{"building":"yes","building:levels":"3"})]}

@pytest.mark.parametrize("kwargs",[{}, {"lat":24.45,"lon":54.37}, {"lat":24.45,"lon":54.37,"verification":{"verified":True,"precision":"city","source":"nominatim","featureId":"relation/1"}}, {"lat":float('nan'),"lon":1,"selected":True}])
def test_no_city_or_unverified_fallback(kwargs):
    with pytest.raises(G.GeographicError):G.resolve_location("raid at Kane's Boxing Gym Abu Dhabi",**kwargs)

def test_explicit_selection_does_not_claim_name_verified():
    f=focal();assert f["verification"]["namedPlaceVerified"] is False
    assert "Kane" not in f["name"]

def test_exact_upstream_feature_evidence():
    f=G.resolve_location("gym",24.4,54.3,{"verified":True,"precision":"exact","source":"nominatim","featureId":"node/1"})
    assert f["verification"]["featureId"]=="node/1"

def test_metric_origin_and_axes():
    f=focal();frame=G.Frame(f["lat"],f["lon"])
    assert frame.xy(f["lat"],f["lon"])==pytest.approx((0,0),abs=1e-8)
    x,y=frame.xy(f["lat"],f["lon"]+.001);assert 100<x<103 and abs(y)<.01
    x,y=frame.xy(f["lat"]+.001,f["lon"]);assert 110<y<112 and abs(x)<.01
    assert patch()["elevation"]["source"] is None

@pytest.mark.parametrize("aoi",[[50,20,60,30],[54.6,24.48,54.60001,24.48001],[170,24,-170,25],[54.6,24.48,float('inf'),24.49]])
def test_aoi_limits(aoi):
    with pytest.raises(G.GeographicError):G.make_patch(focal(),aoi)

def test_clips_real_geometry_and_retains_vertical_caveats():
    p=patch();result=G.build_geometry(p,source());boundary=Polygon(p["boundary"])
    assert len(result["buildings"])==2 and len(result["roads"])==1
    for b in result["buildings"]:assert boundary.buffer(1e-7).covers(Polygon(b["pts"],b["holes"]))
    assert result["buildings"][0]["h"]==pytest.approx(9.144)
    assert not result["buildings"][0]["height"]["measured"]
    assert result["buildings"][1]["height"]["approximate"] is True
    road=result["roads"][0];assert LineString(road["pts"]).length < 522
    assert road["sourceId"]=="way/10" and not road["widthApproximate"]
    assert result["versions"][0]["version"]==3

def test_missing_or_invalid_height_not_misread_as_number():
    for raw in ("12;15","10-20","about 3",None):assert G.numeric_tag(raw) is None
    data=source();data["elements"][1]["tags"]={"building":"yes","height":"10-20"}
    building=G.build_geometry(patch(),data)["buildings"][0]
    assert building["h"]==8 and building["height"]["approximate"]

def test_multipolygon_hole_and_surface_area():
    outer=way(1,[(-100,-100),(100,-100),(100,100),(-100,100),(-100,-100)],{})
    inner=way(2,[(-30,-30),(30,-30),(30,30),(-30,30),(-30,-30)],{})
    rel={"type":"relation","id":9,"version":4,"tags":{"type":"multipolygon","building":"yes"},
         "members":[{"type":"way","ref":1,"role":"outer"},{"type":"way","ref":2,"role":"inner"}]}
    b=G.build_geometry(patch(),{"elements":[outer,inner,rel]})["buildings"][0]
    poly=Polygon(b["pts"],b["holes"])
    assert len(b["holes"])==1 and not poly.covers(Point(0,0))
    assert sum(Polygon(t).area for t in b["triangles"])==pytest.approx(poly.area)
    assert all(not Polygon(t).contains(Point(0,0)) for t in b["triangles"])
    assert b["sourceId"]=="relation/9"

def test_partial_rings_never_close_with_fabricated_edge():
    data={"elements":[way(2,[(-100,-100),(100,-100),(100,100)],{"building":"yes"})]}
    result=G.build_geometry(patch(),data)
    assert result["buildings"]==[] and "unclosed_polygon:way/2" in result["limitations"]

def test_concave_polygon_triangle_area_exact():
    poly=Polygon([(0,0),(10,0),(10,2),(2,2),(2,10),(0,10)])
    mesh=G.polygon_data(poly)
    assert sum(Polygon(t).area for t in mesh["triangles"])==pytest.approx(poly.area)

def test_bridge_has_no_ground_placement():
    data=source();data["elements"][0]["tags"]["bridge"]="yes"
    result=G.build_geometry(patch(),data)
    assert not result["roads"][0]["groundingAvailable"]

def test_missing_nodes_never_join_disconnected_way():
    data={"elements":[{"type":"node","id":1,"lat":24.4886,"lon":54.608},
                      {"type":"node","id":3,"lat":24.4886,"lon":54.609},
                      {"type":"way","id":9,"nodes":[1,2,3],"tags":{"highway":"primary"}}]}
    assert G.build_geometry(patch(),data)["roads"]==[]

def test_node_geometry_changes_source_hash():
    data={"elements":[{"type":"node","id":1,"lat":24.4886,"lon":54.608},
                      {"type":"node","id":2,"lat":24.4886,"lon":54.609},
                      {"type":"way","id":9,"version":1,"nodes":[1,2],"tags":{"highway":"primary"}}]}
    before=G.build_geometry(patch(),data)["versions"]
    data["elements"][0]["lat"]+=.0001
    after=G.build_geometry(patch(),data)["versions"]
    assert before!=after

class Response:
    def __init__(self,data):self.data=data
    def raise_for_status(self):pass
    def iter_content(self,_):yield json.dumps(self.data).encode()
    def __enter__(self):return self
    def __exit__(self,*args):pass

def test_fetch_provenance_license_hash_and_versions(monkeypatch):
    monkeypatch.setattr(G.requests,"get",lambda *a,**kw:Response(source()))
    p=patch();result=G.fetch_osm(p)
    assert p["id"].startswith("patch_")
    assert p["featureIds"]==["way/10","way/20","way/30"]
    provenance=p["provenance"][0]
    assert provenance["license"]["name"]=="ODbL 1.0" and len(provenance["responseSha256"])==64
    assert provenance["queryBounds"]==p["bounds"] and provenance["versions"]

def test_source_outage_is_terminal_not_generic_roads(monkeypatch):
    def unavailable(*a,**kw):raise G.requests.Timeout("fixture outage")
    monkeypatch.setattr(G.requests,"get",unavailable)
    with pytest.raises(G.GeographicError,match="geographic_source_unavailable"):G.fetch_osm(patch())

def test_empty_map_is_not_rendered(monkeypatch):
    monkeypatch.setattr(G.requests,"get",lambda *a,**kw:Response({"elements":[]}))
    with pytest.raises(G.GeographicError):G.fetch_osm(patch())

def test_scene_assets_land_on_source_road_not_arbitrary_ring(monkeypatch):
    monkeypatch.setattr(P,"ASSET_KEYS",{"police_patrol_car","traffic_cone_cluster"})
    p=patch();osm=G.build_geometry(p,source());osm["patch"]=p
    spec={"scenarioType":"perimeter_cordon","elements":[{"type":"perimeter_unit","params":{"count":6}},{"type":"cones","params":{"spacing_m":20}}]}
    instances,_,_=P.place(spec,focal(),osm,260,5)
    assert instances and all(i["sourceId"]=="way/10" and abs(i["y"])<.1 for i in instances)
    assert all(i["placement"]["elevation"]=="flat-reference-plane-not-measured" for i in instances)
    assert all(Polygon(p["boundary"]).covers(Point(i["x"],i["y"])) for i in instances)

def test_no_roads_no_car_or_fabricated_marine_placement(monkeypatch):
    monkeypatch.setattr(P,"ASSET_KEYS",{"police_patrol_car","marine_patrol_boat"})
    p=patch();osm={"patch":p,"roads":[],"buildings":[],"water":[]}
    spec={"scenarioType":"observation","elements":[{"type":"perimeter_unit"},{"type":"marine_patrol"}]}
    instances,_,_=P.place(spec,focal(),osm,260,5)
    assert not instances and osm["placementOmissions"]


def test_explicit_cone_quantity_is_not_replaced_by_circumference(monkeypatch):
    monkeypatch.setattr(P,"ASSET_KEYS",{"traffic_cone_cluster"})
    p=patch();geometry=G.build_geometry(p,source());geometry["patch"]=p
    spec={"scenarioType":"route_closure","elements":[{"type":"cones","params":{"count":2,"spacing_m":2}}]}
    instances,_,_=P.place(spec,focal(),geometry,260,7)
    assert len(instances)<=2
    assert len(instances)+sum(geometry["placementOmissions"].values())==2
