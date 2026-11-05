"""Bounded WGS84 -> local metric patches; no invented geographic fallback.

OSM geometry/attributes are map contributions, not a survey. Unknown vertical data
is intentionally a flat local Z=0 approximation, never an asserted elevation.
"""
from __future__ import annotations
import hashlib
import json
import math
import os
import time
import copy
import threading
from datetime import datetime, timezone

import requests
from pyproj import CRS, Geod, Transformer
from shapely.geometry import Point, LineString, Polygon, box
from shapely.ops import polygonize_full, unary_union
from shapely import constrained_delaunay_triangles

SCHEMA = "osm-metric-patch-v2"
UA = {"User-Agent": "GodsEyeView/0.2 bounded-OSM-illustration"}
LICENSE = {"name": "ODbL 1.0", "url": "https://opendatacommons.org/licenses/odbl/1-0/",
           "attribution": "© OpenStreetMap contributors", "copyrightUrl": "https://www.openstreetmap.org/copyright"}
GEOD = Geod(ellps="WGS84")
MAX_BYTES = 24 * 1024 * 1024
GEO_CACHE = {}
GEO_LOCK = threading.Lock()
GEO_TTL = 900

class GeographicError(ValueError):
    pass

def utc():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()

def resolve_location(prompt, lat=None, lon=None, verification=None, selected=False):
    if lat is None or lon is None or not all(math.isfinite(float(v)) for v in (lat, lon)):
        raise GeographicError("exact_location_required: supply an explicitly selected coordinate pair or verified exact feature")
    lat, lon = float(lat), float(lon)
    if not (-80 <= lat <= 80 and -180 < lon < 180):
        raise GeographicError("coordinate_out_of_supported_range")
    v = dict(verification or {})
    exact = (v.get("verified") is True and v.get("precision") in ("exact", "mapped-building-footprint", "official-address-mapped-building", "mapped-feature") and bool(v.get("source")) and bool(v.get("featureId")))
    if not selected and not exact:
        raise GeographicError("unverified_location: city/district/approximate geocoder results are not renderable")
    v = ({"verified": False, "precision": "explicit-selected-coordinate", "source": "user-selected-coordinates",
          "namedPlaceVerified": False} if selected else v)
    v["coordinates"] = {"lat": lat, "lon": lon}
    return {"lat": lat, "lon": lon, "name": v.get("name") or "Selected geographic patch", "kind": v.get("kind", "selected-location"),
            "source": v["source"], "precision": v["precision"], "verification": v, "approximate": bool(selected)}

class Frame:
    def __init__(self, lat, lon):
        self.lat, self.lon = lat, lon
        self.definition = f"+proj=aeqd +lat_0={lat:.10f} +lon_0={lon:.10f} +datum=WGS84 +units=m +no_defs"
        crs = CRS.from_proj4(self.definition)
        self.forward = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        self.inverse = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    def xy(self, lat, lon):
        return self.forward.transform(lon, lat)

def make_patch(focal, aoi=None, half_m=260):
    lat, lon = focal["lat"], focal["lon"]
    f = Frame(lat, lon)
    if aoi is None:
        corners = [f.inverse.transform(x, y) for x in (-half_m, half_m) for y in (-half_m, half_m)]
        aoi = [min(p[0] for p in corners), min(p[1] for p in corners), max(p[0] for p in corners), max(p[1] for p in corners)]
    if len(aoi) != 4 or not all(math.isfinite(float(x)) for x in aoi):
        raise GeographicError("aoi must be [west,south,east,north]")
    w, s, e, n = map(float, aoi)
    if not (-180 < w < e < 180 and -80 <= s < n <= 80 and w <= lon <= e and s <= lat <= n):
        raise GeographicError("aoi must contain the selected coordinate; antimeridian patches are unsupported")
    width = abs(GEOD.inv(w, lat, e, lat)[2]); height = abs(GEOD.inv(lon, s, lon, n)[2])
    if not (100 <= width <= 2402 and 100 <= height <= 2402):
        raise GeographicError("aoi sides must be between 100 and 2400 metres")
    ring = []
    for a,b in [((w,s),(e,s)),((e,s),(e,n)),((e,n),(w,n)),((w,n),(w,s))]:
        for k in range(16):
            u=k/16; ring.append(f.xy(a[1]+u*(b[1]-a[1]), a[0]+u*(b[0]-a[0])))
    geom = Polygon(ring)
    x0,y0,x1,y1=geom.bounds
    patch = {"bounds": [w,s,e,n], "origin": {"lat":lat,"lon":lon},
             "localBounds": {"minX":x0,"minY":y0,"maxX":x1,"maxY":y1}, "boundary": [list(p) for p in geom.exterior.coords],
             "crs": {"geographic":"EPSG:4326","local":f.definition,"axes":["east X","north Y","up Z"],"units":"metres"},
             "elevation": {"status":"unavailable","source":None,"verticalDatum":None,"groundZ":0,
                           "approximation":"Flat local Z=0 reference plane; no measured terrain elevation. OSM height tags are unverified contributions."},
             "verification":focal["verification"], "schema":SCHEMA}
    return patch

def _read_json(response):
    response.raise_for_status()
    content = bytearray()
    deadline=time.monotonic()+30
    for chunk in response.iter_content(65536):
        if time.monotonic()>deadline:raise GeographicError("geographic_response_deadline_exceeded")
        content.extend(chunk)
        if len(content)>MAX_BYTES:
            raise GeographicError("geographic_response_too_large")
    data = json.loads(content)
    if data.get("remark") or not isinstance(data.get("elements"), list):
        raise GeographicError("incomplete_or_invalid_geographic_response")
    return data, hashlib.sha256(content).hexdigest()

def _fetch_osm_uncached(patch, log=None):
    log=log or (lambda *a:None)
    w,s,e,n=patch["bounds"]
    bbox=",".join(f"{v:.9f}" for v in (w,s,e,n))
    endpoints=[("https://api.openstreetmap.org/api/0.6/map.json", {"bbox":bbox})]
    configured=os.environ.get("SCENE_OVERPASS_ENDPOINTS", "https://overpass-api.de/api/interpreter").split(",")
    query=f'[out:json][timeout:20][maxsize:24000000];(way[building]({s},{w},{n},{e});way[highway]({s},{w},{n},{e});way[natural=water]({s},{w},{n},{e});relation[type=multipolygon][building]({s},{w},{n},{e});relation[type=multipolygon][natural=water]({s},{w},{n},{e}););out meta geom;'
    endpoints += [(ep.strip(), {"data":query}) for ep in configured[:2] if ep.strip().startswith("https://")]
    errors=[]
    for endpoint,params in endpoints:
        try:
            with requests.get(endpoint, params=params, headers=UA, stream=True, timeout=(5,25)) as r:
                data, raw_hash = _read_json(r)
            result=build_geometry(patch,data)
            if not (result["buildings"] or result["roads"] or result["water"]):
                raise GeographicError("no_usable_bounded_features")
            provenance={"provider":"OpenStreetMap", "endpoint":endpoint,"queryBounds":patch["bounds"],
                        "retrievedUtc":utc(),"sourceTimestamp":data.get("osm3s",{}).get("timestamp_osm_base"),
                        "responseSha256":raw_hash, "license":LICENSE, "versions":result.pop("versions")}
            patch["provenance"]=[provenance]
            patch["featureIds"]=sorted(set(f["sourceId"] for kind in ("buildings","roads","water") for f in result[kind]))
            patch["limitations"]=result.pop("limitations")
            patch["id"]="patch_"+digest({"schema":SCHEMA,"bounds":patch["bounds"],"origin":patch["origin"],
                "versions":provenance["versions"],"geometry":result})[:24]
            log("geography", {"patchId":patch["id"],"featureCount":len(patch["featureIds"]),"endpoint":endpoint})
            return result
        except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
            errors.append(type(exc).__name__+": "+str(exc).split("https://")[0][:140])
            log("geography_source_error", {"endpoint":endpoint,"error":errors[-1]})
    raise GeographicError("geographic_source_unavailable: "+"; ".join(errors))

def fetch_osm(patch, log=None):
    # Bound/source/schema/origin keyed and TTL limited. Verified metadata is
    # copied, never shared mutable geometry between unrelated scenes.
    key = digest({"bounds":patch["bounds"],"origin":patch["origin"],"schema":SCHEMA,
                  "source":os.environ.get("SCENE_OVERPASS_ENDPOINTS", "osm-api-first")})
    with GEO_LOCK:
        hit=GEO_CACHE.get(key)
        if hit and time.monotonic()-hit["at"]<GEO_TTL:
            patch.update(copy.deepcopy(hit["metadata"]))
            if log:log("geography_cache", {"key":key,"hit":True,"sourceRetrievedUtc":patch["provenance"][0]["retrievedUtc"]})
            return copy.deepcopy(hit["geometry"])
        geometry=_fetch_osm_uncached(patch,log)
        metadata={k:patch[k] for k in ("id","provenance","featureIds","limitations")}
        GEO_CACHE[key]={"at":time.monotonic(),"metadata":copy.deepcopy(metadata),"geometry":copy.deepcopy(geometry)}
        while len(GEO_CACHE)>16:GEO_CACHE.pop(next(iter(GEO_CACHE)))
        return geometry


def _parts(geom, kind):
    if geom.is_empty:return []
    if geom.geom_type==kind:return [geom]
    if hasattr(geom,"geoms"):
        return [p for g in geom.geoms for p in _parts(g,kind)]
    return []

def numeric_tag(raw):
    import re
    match=re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(m|metres|meters|ft|')?\s*",str(raw or ""),re.I)
    if not match:return None
    value=float(match[1])*(0.3048 if (match[2] or "").lower() in ("ft", "'") else 1)
    return value if math.isfinite(value) else None

def polygon_data(poly):
    # Roof/surface triangles exclude holes and concave exterior gaps; no giant n-gon filling courtyards.
    from shapely.geometry.polygon import orient
    poly=orient(poly,sign=1.0)
    triangles=[]
    for tri in constrained_delaunay_triangles(poly).geoms:
        triangles.append([list(p) for p in list(tri.exterior.coords)[:3]])
    return {"pts":[list(p) for p in list(poly.exterior.coords)[:-1]],
            "holes":[[list(p) for p in list(r.coords)[:-1]] for r in poly.interiors], "triangles":triangles}

def build_geometry(patch,data):
    f=Frame(**patch["origin"]); bounds=Polygon(patch["boundary"])
    elements=data["elements"]
    nodes={e["id"]:(e["lat"],e["lon"]) for e in elements if e.get("type")=="node" and "lat" in e and "lon" in e}
    ways={e["id"]:e for e in elements if e.get("type")=="way"}
    limits=[]; versions={}; buildings=[]; roads=[]; water=[]; consumed=set()
    def coords(el):
        geom=el.get("geometry")
        if geom is not None:
            if any(not g or "lat" not in g or "lon" not in g for g in geom):return []
            return [f.xy(g["lat"],g["lon"]) for g in geom]
        ids=el.get("nodes",[])
        if not ids or any(i not in nodes for i in ids):return []
        return [f.xy(*nodes[i]) for i in ids]
    def record(el):
        sid=f'{el.get("type","way")}/{el["id"]}'
        versions[sid]={"id":sid,"version":el.get("version"),"timestamp":el.get("timestamp"),
                       "geometrySha256":digest({"resolvedLocalCoordinates":coords(el), **{k:el.get(k) for k in ("nodes","geometry","members","tags")}})}
        if el.get("version") is None:limits.append("source_version_missing:"+sid)
        return sid
    def surface(el,geom):
        tags=el.get("tags",{}); clipped=geom.intersection(bounds)
        pieces=_parts(clipped,"Polygon")
        if not pieces:return
        sid=record(el)
        for i,poly in enumerate(pieces):
            if poly.area<0.15:continue
            item={"id":sid+f"/{i}","sourceId":sid,"name":tags.get("name"),"tags":tags,**polygon_data(poly)}
            if tags.get("building") not in (None,"no"):
                h=numeric_tag(tags.get("height"));levels=numeric_tag(tags.get("building:levels"))
                if h is not None and 1<=h<=1000:
                    basis="OSM height tag (contributed, not surveyed)"; approximation=False
                elif levels is not None and 1<=levels<=150:
                    h=levels*3.2;basis="OSM building:levels × assumed 3.2 m";approximation=True
                else:h=8.0;basis="assumed 8 m; no usable height/levels";approximation=True
                item.update(h=h,height={"metres":h,"basis":basis,"approximate":approximation,"measured":False},z=0)
                buildings.append(item)
            elif tags.get("natural")=="water":water.append(item)
    # Multipolygon relations are assembled only from complete closed rings. No gap bridging.
    for el in elements:
        if el.get("type")!="relation" or el.get("tags",{}).get("type")!="multipolygon":continue
        tags=el.get("tags",{})
        if not (tags.get("building") or tags.get("natural")=="water"):continue
        rings={"outer":[],"inner":[]}; member_ids=[]; complete=True
        for member in el.get("members",[]):
            if member.get("type")!="way":continue
            pts=coords(member) if member.get("geometry") else coords(ways.get(member.get("ref"),{}))
            if len(pts)<2:complete=False;break
            rings["inner" if member.get("role")=="inner" else "outer"].append(LineString(pts));member_ids.append(member.get("ref"))
        if not complete or not rings["outer"]:
            limits.append("incomplete_multipolygon:relation/"+str(el["id"]));continue
        outer_set, cuts, dangles, invalid=polygonize_full(unary_union(rings["outer"]))
        if any(not g.is_empty for g in (cuts,dangles,invalid)):
            limits.append("incomplete_outer_ring:relation/"+str(el["id"]));continue
        outer=list(outer_set.geoms);inner=[]
        if rings["inner"]:
            inner_set,cuts,dangles,invalid=polygonize_full(unary_union(rings["inner"]))
            if any(not g.is_empty for g in (cuts,dangles,invalid)):
                limits.append("incomplete_inner_ring:relation/"+str(el["id"]));continue
            inner=list(inner_set.geoms)
        if not outer:
            limits.append("unclosed_multipolygon:relation/"+str(el["id"]));continue
        geom=unary_union(outer)
        if inner:geom=geom.difference(unary_union(inner))
        surface(el,geom);consumed.update(member_ids)
        for mid in member_ids:
            if mid in ways:record(ways[mid])
    defaults={"motorway":12,"trunk":10,"primary":9,"secondary":8,"tertiary":7,"residential":6,"service":4,"living_street":4}
    for el in ways.values():
        tags=el.get("tags",{});pts=coords(el)
        if len(pts)<2:continue
        if el["id"] not in consumed and (tags.get("building") or tags.get("natural")=="water"):
            if pts[0]!=pts[-1] or len(pts)<4:
                limits.append("unclosed_polygon:way/"+str(el["id"]))
            else:
                poly=Polygon(pts)
                if poly.is_valid:surface(el,poly)
                else:limits.append("invalid_polygon:way/"+str(el["id"]))
        kind=tags.get("highway")
        if not kind:continue
        ln=LineString(pts)
        lines=_parts(ln.intersection(bounds),"LineString")
        if not lines:continue
        sid=record(el);width=numeric_tag(tags.get("width")); tagged=width is not None and 0.5<=width<=60
        width=width if tagged else defaults.get(kind,2.0)
        ground=tags.get("bridge","no") in ("no","false","0") and tags.get("tunnel","no") in ("no","false","0") and tags.get("layer","0")=="0"
        for i,line in enumerate(lines):
            if line.length<0.5:continue
            road={"id":sid+f"/{i}","sourceId":sid,"pts":[list(p) for p in line.coords],"kind":kind,"name":tags.get("name"),
                  "width":width,"widthApproximate":not tagged,"widthBasis":"OSM width tag" if tagged else "assumed class width; centerline is OSM geometry",
                  "drivable":kind in defaults and tags.get("access")!="no","groundingAvailable":ground,"z":0.04,
                  "surface":[polygon_data(p) for p in _parts(line.buffer(width/2,cap_style=2,join_style=2).intersection(bounds),"Polygon")]}
            if not ground:limits.append("unmeasured_grade_not_for_placement:"+sid)
            roads.append(road)
    if sum(len(v) for v in (buildings,roads,water))>6000:raise GeographicError("patch_geometry_limit_exceeded")
    return {"buildings":buildings,"roads":roads,"water":water,"versions":sorted(versions.values(),key=lambda x:x["id"]),
            "limitations":sorted(set(limits))+["No terrain elevation source; flat local reference plane.","Building heights/road widths may be approximations; no satellite imagery used."]}


def drape_features(geometry, terrain):
    """Split road/water polygons at terrain faces for plane-exact contact.

    The GPU then samples Z at these intersections using the same triangular
    terrain mesh. A long road triangle cannot cut through a DSM grid ridge.
    """
    from shapely.strtree import STRtree
    mesh=terrain["clippedMesh"]
    triangles=[Polygon([mesh["vertices"][i][:2] for i in face]) for face in mesh["faces"]]
    tree=STRtree(triangles)
    def split(data):
        polygon=Polygon(data["pts"],data.get("holes",[]));out=[]
        for index in tree.query(polygon):
            for piece in _parts(polygon.intersection(triangles[int(index)]),"Polygon"):
                if piece.area>1e-8:out.append(polygon_data(piece))
        return out
    for road in geometry["roads"]:
        road["surface"]=[piece for region in road["surface"] for piece in split(region)]
        road["groundingBasis"]="piecewise-triangular Copernicus DSM (not surveyed road grade)"
    for water in geometry["water"]:
        water["surface"]=split(water)
    return geometry
