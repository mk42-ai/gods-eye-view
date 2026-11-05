"""Studio reference images -> scene bindings (render host side).

The four studio references supplied for crash scenes live in render_service/references/
(copied next to this file; on the host GEV_REFERENCES_DIR may point elsewhere):

  D3IfJIiClM.png  silver mid-size sedan, crumpled front bumper/bonnet    -> civilian_sedan paint + damage decal
  Rv6TULP5dW.png  blue compact hatchback, dented front corner            -> civilian_hatchback (sedan mesh, blue paint) + decal
  HrOVNUqLwL.png  one modular sand-coloured mall entrance facade section -> facade texture on the focal mall's OSM building walls
  ewvknQr9AP.png  collision debris cluster (bumper, glass, wing mirror)  -> ground decal plane at the debris field centre

Nothing here invents geometry: the references drive materials (sampled paint colour), image-plane
decals and the facade texture; the stylised Kenney meshes stay the geometry source. `bindings()`
returns a JSON-serialisable record that the job exposes as `references` so the UI can list what
was actually applied (and the count), and `applied` is only ever true when the PNG exists on disk.
"""
from __future__ import annotations
import os
from typing import Optional

HERE = os.path.dirname(os.path.abspath(__file__))
REFERENCES_DIR = os.environ.get("GEV_REFERENCES_DIR", os.path.join(HERE, "references"))

REFERENCES = [
    {"id": "silver_sedan", "file": "D3IfJIiClM.png", "role": "vehicle_paint_decal", "applies_to": ["civilian_sedan"],
     "paint_rgb": (0.40, 0.41, 0.41), "label": "Silver sedan · crumpled front (reference)"},
    {"id": "blue_hatchback", "file": "Rv6TULP5dW.png", "role": "vehicle_paint_decal", "applies_to": ["civilian_hatchback"],
     "paint_rgb": (0.17, 0.26, 0.44), "label": "Blue hatchback · dented corner (reference)"},
    {"id": "mall_facade_module", "file": "HrOVNUqLwL.png", "role": "facade_texture", "applies_to": ["mall_facade_module"],
     "paint_rgb": (0.42, 0.38, 0.31), "label": "Mall entrance facade module (reference)"},
    {"id": "debris_cluster", "file": "ewvknQr9AP.png", "role": "ground_decal", "applies_to": ["debris_cluster_decal", "debris_bumper", "debris_tire", "debris_door", "debris_plate"],
     "paint_rgb": (0.24, 0.24, 0.25), "label": "Collision debris cluster (reference)"},
]
# Paint colours were sampled from the reference PNGs (median foreground colour vs. the grey
# studio backdrop) on 2026-11-04; they are what the Principled BSDF base colour uses.

MALL_KINDS = ("mall", "shopping")


def reference_path(ref_id: str) -> Optional[str]:
    for r in REFERENCES:
        if r["id"] == ref_id:
            p = os.path.join(REFERENCES_DIR, r["file"])
            return p if os.path.exists(p) else None
    return None


def by_id(ref_id: str) -> Optional[dict]:
    return next((r for r in REFERENCES if r["id"] == ref_id), None)


def is_crash_prompt(prompt: str, scenario_type: Optional[str]) -> bool:
    import re
    return bool(re.search(r"crash|collision|accident|pile[- ]?up", str(prompt or ""), re.I)) or scenario_type == "route_closure"


def bindings(instances: list, focal: dict, prompt: str, scenario_type: Optional[str], buildings_total: int = 0, facade_count: int = 0) -> list:
    """Per-reference record of what the scene applied. Counts come from the real instance list."""
    crash = is_crash_prompt(prompt, scenario_type)
    out = []
    for r in REFERENCES:
        path = os.path.join(REFERENCES_DIR, r["file"])
        exists = os.path.exists(path)
        if r["id"] == "mall_facade_module":
            count = facade_count if exists else 0
        else:
            count = sum(1 for i in instances if i.get("asset") in r["applies_to"]) if exists else 0
        out.append({"id": r["id"], "file": r["file"], "role": r["role"], "label": r["label"], "applies_to": list(r["applies_to"]), "paint_rgb": list(r["paint_rgb"]),
                    "available_on_host": exists, "applied": bool(count), "applied_count": int(count),
                    "reason": (None if count else "reference PNG missing on render host" if not exists else
                               "not a crash scene" if not crash else "no matching placement in this scene")})
    return out


def facade_building_indices(buildings: list, focal: dict, max_count: int = 6) -> list:
    """Indices of the OSM footprints that receive the mall-facade texture: the named focal mall
    first (name match), only; never a nearby unnamed building. Only for
    mall/venue focal kinds so a marathon or palace scene never grows a shopping-mall facade."""
    if not buildings or str(focal.get("kind", "")).lower() not in MALL_KINDS:
        return []
    name = str(focal.get("name", "")).lower()
    scored = []
    for idx, b in enumerate(buildings):
        pts = b.get("pts") or []
        if len(pts) < 3:
            continue
        cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
        dist = (cx * cx + cy * cy) ** 0.5
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        area = (max(xs) - min(xs)) * (max(ys) - min(ys))
        bname = str(b.get("name") or "").lower()
        named = bool(name and bname and (name in bname or bname in name))
        if named:
            scored.append((0 if named else 1, -area, idx))
    scored.sort()
    return [idx for _, _, idx in scored[:max_count]]
