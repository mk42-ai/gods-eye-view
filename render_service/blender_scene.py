"""Blender 4.2 headless worker: builds the staged scene from scene.json and renders a frame shard.

usage: blender -b --factory-startup -noaudio -P blender_scene.py -- scene.json out_dir frame_start frame_end samples width height
Rendering: Cycles + OptiX (GPU selected by CUDA_VISIBLE_DEVICES), OptiX denoise, persistent data (scene synced once per shard).
"""
import bpy, sys, json, math, os, time, random
from mathutils import Vector, Euler

argv = sys.argv[sys.argv.index("--") + 1:]
scene_json, out_dir, f0, f1 = argv[0], argv[1], int(argv[2]), int(argv[3])
samples = int(argv[4]) if len(argv) > 4 else 24
W = int(argv[5]) if len(argv) > 5 else 1280
H = int(argv[6]) if len(argv) > 6 else 720
S = json.load(open(scene_json))
T0 = time.time()
SEED = int(S.get("seed") or S.get("spec", {}).get("seed") or 7)
rnd = random.Random(SEED)  # prompt-hash seed -> unique, reproducible staging per prompt

_vis = os.environ.get("CUDA_VISIBLE_DEVICES", "")
if os.environ.get("CUDA_DEVICE_ORDER") != "PCI_BUS_ID" or _vis not in ("2", "6"):
    print(f"GPU_POLICY_VIOLATION cuda_visible={_vis!r} order={os.environ.get('CUDA_DEVICE_ORDER')!r}; only GPUs 2,6 allowed", flush=True)
    sys.exit(3)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "OPTIX"
prefs.get_devices()
used = []
for d in prefs.devices:
    d.use = d.type == "OPTIX"
    if d.use: used.append(d.name)
sc.cycles.device = "GPU"
sc.cycles.samples = samples
sc.cycles.use_denoising = True
sc.cycles.denoiser = "OPTIX"
sc.cycles.use_adaptive_sampling = True
sc.cycles.adaptive_threshold = 0.05
sc.cycles.max_bounces = 4
sc.cycles.caustics_reflective = False
sc.cycles.caustics_refractive = False
sc.render.use_persistent_data = True
sc.render.resolution_x = W; sc.render.resolution_y = H; sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGB"
sc.render.film_transparent = False
sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"
fps = int(S.get("fps", 24)); sc.render.fps = fps
total = int(S.get("duration_s", 60) * fps)
sc.frame_start = f0; sc.frame_end = f1

def mat(name, color, rough=0.6, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1); b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = strength
    return m

# ---- world / lighting by time of day
tod = S.get("time_of_day", "midday")
world = bpy.data.worlds.new("W"); sc.world = world; world.use_nodes = True
nt = world.node_tree; bg = nt.nodes["Background"]
hdri = os.path.join(S["assets_root"], "polyhaven", S["hdri"])
if os.path.exists(hdri):
    env = nt.nodes.new("ShaderNodeTexEnvironment"); env.image = bpy.data.images.load(hdri)
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = {"dusk": 0.8, "night": 0.25, "midday": 1.0}.get(tod, 1.0)
sun = bpy.data.lights.new("Sun", "SUN"); sun_o = bpy.data.objects.new("Sun", sun); sc.collection.objects.link(sun_o)
elev, az, strength, col = {"midday": (72, 160, 4.0, (1, 0.98, 0.95)), "dusk": (9, 255, 1.6, (1.0, 0.62, 0.35)), "night": (-20, 0, 0.0, (0.5, 0.6, 1.0))}.get(tod, (60, 180, 3.5, (1, 1, 1)))
sun.energy = strength; sun.color = col; sun.angle = math.radians(1.0)
sun_o.rotation_euler = Euler((math.radians(90 - elev), 0, math.radians(az)), "XYZ")
# Exposure calibrated 2026-11-03 against the ground-truth luma (~120-160 for day views, ~55 at night):
# the first Phase-F pass rendered at base exposure came out ~2 stops hot (frame luma ~205).
EXPOSURE = {"night": 1.8, "dusk": -1.2, "midday": -1.6}
sc.view_settings.exposure = EXPOSURE.get(tod, -1.2) + float(os.environ.get("GEV_EXPOSURE_OFFSET", "0") or 0)
if tod == "night":
    bg.inputs["Strength"].default_value = 0.4

# ---- ground with satellite texture
x0, y0, x1, y1 = S["imagery"]["local_bounds"]
bpy.ops.mesh.primitive_plane_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, 0))
g = bpy.context.object; g.scale = ((x1 - x0), (y1 - y0), 1); g.name = "Ground"
gm = bpy.data.materials.new("GroundMat"); gm.use_nodes = True
gnt = gm.node_tree; gb = gnt.nodes["Principled BSDF"]; gb.inputs["Roughness"].default_value = 0.9
tex = gnt.nodes.new("ShaderNodeTexImage"); tex.image = bpy.data.images.load(S["imagery"]["png"])
gnt.links.new(tex.outputs["Color"], gb.inputs["Base Color"]); g.data.materials.append(gm)
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.uv.smart_project(); bpy.ops.object.mode_set(mode="OBJECT")

# ---- buildings extruded from OSM footprints
# Roof caps take the satellite imagery projected from above (so a 700 m mall roof shows the real
# roof plant/colour instead of a flat beige slab); walls keep a PBR facade material.
def building_material(name, wall_rgb, rough, metal):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt_ = m.node_tree; b = nt_.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    texc = nt_.nodes.new("ShaderNodeTexCoord"); mapn = nt_.nodes.new("ShaderNodeMapping")
    mapn.inputs["Location"].default_value = (-x0 / (x1 - x0), -y0 / (y1 - y0), 0)
    mapn.inputs["Scale"].default_value = (1 / (x1 - x0), 1 / (y1 - y0), 1)
    nt_.links.new(texc.outputs["Object"], mapn.inputs["Vector"])
    img = nt_.nodes.new("ShaderNodeTexImage"); img.image = bpy.data.images.load(S["imagery"]["png"]); img.extension = "EXTEND"
    nt_.links.new(mapn.outputs["Vector"], img.inputs["Vector"])
    geo = nt_.nodes.new("ShaderNodeNewGeometry"); sep = nt_.nodes.new("ShaderNodeSeparateXYZ"); nt_.links.new(geo.outputs["True Normal"], sep.inputs["Vector"])
    gt = nt_.nodes.new("ShaderNodeMath"); gt.operation = "GREATER_THAN"; gt.inputs[1].default_value = 0.7; nt_.links.new(sep.outputs["Z"], gt.inputs[0])
    wall = nt_.nodes.new("ShaderNodeRGB"); wall.outputs[0].default_value = (*wall_rgb, 1)
    mix = nt_.nodes.new("ShaderNodeMixRGB"); nt_.links.new(gt.outputs[0], mix.inputs["Fac"]); nt_.links.new(wall.outputs[0], mix.inputs[1]); nt_.links.new(img.outputs["Color"], mix.inputs[2])
    nt_.links.new(mix.outputs[0], b.inputs["Base Color"])
    return m
bmat = building_material("Building", (0.72, 0.70, 0.66), 0.55, 0.0); bglass = building_material("Glass", (0.35, 0.45, 0.55), 0.2, 0.5)

# ---- studio reference images (render_service/references.py): paint, decals, facade texture
REFS = {r["id"]: r for r in S.get("references", [])}
REF_DIR = S.get("references_dir", os.path.join(os.path.dirname(os.path.abspath(__file__)), "references"))
def ref_image(ref_id):
    r = REFS.get(ref_id)
    if not r or not r.get("available_on_host"): return None
    p = os.path.join(REF_DIR, r["file"])
    if not os.path.exists(p): return None
    key = f"ref_{ref_id}"
    if key not in bpy.data.images:
        im = bpy.data.images.load(p); im.name = key
    return bpy.data.images[key]

def facade_material():
    """Mall entrance facade: the reference module (HrOVNUqLwL) tiled along the walls (one module
    per ~12 m, 9 m high), roof keeps the satellite imagery like every other building."""
    im = ref_image("mall_facade_module")
    if im is None: return None
    m = bpy.data.materials.new("MallFacade"); m.use_nodes = True; nt_ = m.node_tree; b = nt_.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.6
    geo = nt_.nodes.new("ShaderNodeNewGeometry"); sep = nt_.nodes.new("ShaderNodeSeparateXYZ"); nt_.links.new(geo.outputs["Position"], sep.inputs["Vector"])
    # wall UV: u = along-wall distance (x+y projected), v = height / 9 m
    addxy = nt_.nodes.new("ShaderNodeMath"); addxy.operation = "ADD"; nt_.links.new(sep.outputs["X"], addxy.inputs[0]); nt_.links.new(sep.outputs["Y"], addxy.inputs[1])
    du = nt_.nodes.new("ShaderNodeMath"); du.operation = "DIVIDE"; du.inputs[1].default_value = 12.0; nt_.links.new(addxy.outputs[0], du.inputs[0])
    dv = nt_.nodes.new("ShaderNodeMath"); dv.operation = "DIVIDE"; dv.inputs[1].default_value = 9.0; nt_.links.new(sep.outputs["Z"], dv.inputs[0])
    comb = nt_.nodes.new("ShaderNodeCombineXYZ"); nt_.links.new(du.outputs[0], comb.inputs["X"]); nt_.links.new(dv.outputs[0], comb.inputs["Y"])
    tex = nt_.nodes.new("ShaderNodeTexImage"); tex.image = im; tex.extension = "REPEAT"; nt_.links.new(comb.outputs[0], tex.inputs["Vector"])
    # roof (normal.z > 0.7) takes the satellite patch, walls take the facade module
    sat = nt_.nodes.new("ShaderNodeTexImage"); sat.image = bpy.data.images.load(S["imagery"]["png"]); sat.extension = "EXTEND"
    texc = nt_.nodes.new("ShaderNodeTexCoord"); mapn = nt_.nodes.new("ShaderNodeMapping")
    mapn.inputs["Location"].default_value = (-x0 / (x1 - x0), -y0 / (y1 - y0), 0); mapn.inputs["Scale"].default_value = (1 / (x1 - x0), 1 / (y1 - y0), 1)
    nt_.links.new(texc.outputs["Object"], mapn.inputs["Vector"]); nt_.links.new(mapn.outputs["Vector"], sat.inputs["Vector"])
    nsep = nt_.nodes.new("ShaderNodeSeparateXYZ"); nt_.links.new(geo.outputs["True Normal"], nsep.inputs["Vector"])
    gt = nt_.nodes.new("ShaderNodeMath"); gt.operation = "GREATER_THAN"; gt.inputs[1].default_value = 0.7; nt_.links.new(nsep.outputs["Z"], gt.inputs[0])
    mix = nt_.nodes.new("ShaderNodeMixRGB"); nt_.links.new(gt.outputs[0], mix.inputs["Fac"]); nt_.links.new(tex.outputs["Color"], mix.inputs[1]); nt_.links.new(sat.outputs["Color"], mix.inputs[2])
    nt_.links.new(mix.outputs[0], b.inputs["Base Color"])
    return m
bfacade = facade_material()
facade_applied = 0
bcount = 0
BUILDINGS = []
for b in S["buildings"][:900]:
    pts = b["pts"]
    if len(pts) < 3: continue
    h = max(3.0, min(320.0, float(b["h"])))
    me = bpy.data.meshes.new("b"); ob = bpy.data.objects.new("b", me); sc.collection.objects.link(ob)
    verts = [(x, y, 0) for x, y in pts] + [(x, y, h) for x, y in pts]
    n = len(pts); faces = [tuple(range(n)), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    me.from_pydata(verts, [], faces); me.update()
    if b.get("facade") == "mall_facade_module" and bfacade is not None:
        ob.data.materials.append(bfacade); ob.name = "mall_facade"; facade_applied += 1
    else:
        ob.data.materials.append(bglass if h > 60 else bmat)
    bcount += 1; BUILDINGS.append((ob, pts, h))
print(f"FACADE applied={facade_applied}", flush=True)

# ---- roads: the satellite ground texture already shows the real carriageways; opaque
# synthetic road strips (first Phase-F pass) covered the imagery almost entirely in dense
# urban patches (230 OSM ways at Yas Mall). Keep them only as faint centreline guides.
rm = mat("Road", (0.12, 0.12, 0.13), 0.75)
for r in S["roads"][:400]:
    if r["kind"] not in ("primary", "trunk", "motorway", "secondary", "tertiary"): continue
    pts = r["pts"]
    if len(pts) < 2: continue
    cu = bpy.data.curves.new("rc", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.35; cu.bevel_resolution = 0; cu.fill_mode = "FULL"
    sp = cu.splines.new("POLY"); sp.points.add(len(pts) - 1)
    for i, (x, y) in enumerate(pts): sp.points[i].co = (x, y, 0.05, 1)
    ob = bpy.data.objects.new("road", cu); sc.collection.objects.link(ob); ob.data.materials.append(rm); ob.scale.z = 0.02

# ---- cordon rings / crowd discs / routes (emissive staging graphics, clearly synthetic)
ring_m = {"inner": mat("Inner", (1, 0.2, 0.1), emit=(1, 0.25, 0.1), strength=6), "outer": mat("Outer", (1, 0.75, 0.1), emit=(1, 0.75, 0.1), strength=5),
          "crowd": mat("Crowd", (0.2, 0.6, 1), emit=(0.2, 0.6, 1), strength=3), "route_line": mat("Route", (0.1, 1, 0.5), emit=(0.1, 1, 0.5), strength=5),
          "approach_route": mat("Appr", (0.1, 0.9, 1), emit=(0.1, 0.9, 1), strength=4), "egress_route": mat("Egr", (1, 0.4, 1), emit=(1, 0.4, 1), strength=4)}
for s in S["shapes"]:
    if s["kind"] == "ring":
        bpy.ops.mesh.primitive_torus_add(major_radius=s["r"], minor_radius=0.6, major_segments=128, minor_segments=6, location=(0, 0, 0.6))
        bpy.context.object.data.materials.append(ring_m[s["style"]])
    elif s["kind"] == "disc":
        bpy.ops.mesh.primitive_circle_add(radius=s["r"], fill_type="NGON", location=(s["x"], s["y"], 0.15)); bpy.context.object.data.materials.append(ring_m["crowd"])
    elif s["kind"] == "line":
        cu = bpy.data.curves.new("ln", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 0.8; cu.bevel_resolution = 1; cu.fill_mode = "FULL"
        sp = cu.splines.new("POLY"); sp.points.add(len(s["pts"]) - 1)
        for i, (x, y) in enumerate(s["pts"]): sp.points[i].co = (x, y, 1.0, 1)
        ob = bpy.data.objects.new("line", cu); sc.collection.objects.link(ob); ob.data.materials.append(ring_m.get(s["style"], ring_m["route_line"]))

# ---- assets: import each glb once, join to ONE mesh, instance via shared mesh data
cache = {}
TARGET = {"police_patrol_car": 4.8, "police_escort_motorcycle": 2.2, "ambulance_medical_point": 5.6, "crowd_control_barrier": 2.0, "road_closed_barricade": 1.6,
          "traffic_cone_cluster": 0.7, "checkpoint_cordon_node": 1.6, "event_command_post": 6.0, "start_finish_gate": 9.0, "foot_patrol_officer": 1.8,
          "spectator_crowd_cluster": 1.75, "city_bus": 11.5, "cctv_camera": 0.5, "marine_patrol_boat": 7.5,
          "civilian_sedan": 4.6, "civilian_suv": 4.9, "civilian_taxi": 4.6, "debris_bumper": 1.7, "debris_tire": 0.65, "debris_door": 1.1, "debris_plate": 0.8}
VIRTUAL = S.get("virtual_assets", {"civilian_hatchback": "civilian_sedan", "debris_cluster_decal": None})

def paint_material(name, rgb, ref_id):
    """Car paint sampled from the studio reference + a damage decal (the reference image itself,
    alpha-faded from the studio grey) blended onto the front third of the body."""
    m = bpy.data.materials.new(name); m.use_nodes = True; nt_ = m.node_tree; b = nt_.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.25; b.inputs["Metallic"].default_value = 0.6
    try: b.inputs["Coat Weight"].default_value = 0.6
    except KeyError: pass
    base = nt_.nodes.new("ShaderNodeRGB"); base.outputs[0].default_value = (*rgb, 1)
    im = ref_image(ref_id)
    if im is None:
        nt_.links.new(base.outputs[0], b.inputs["Base Color"]); return m
    texc = nt_.nodes.new("ShaderNodeTexCoord"); mapn = nt_.nodes.new("ShaderNodeMapping")
    mapn.inputs["Scale"].default_value = (0.9, 0.9, 1.0); mapn.inputs["Location"].default_value = (0.05, 0.05, 0)
    nt_.links.new(texc.outputs["Generated"], mapn.inputs["Vector"])
    tex = nt_.nodes.new("ShaderNodeTexImage"); tex.image = im; tex.extension = "CLIP"; nt_.links.new(mapn.outputs["Vector"], tex.inputs["Vector"])
    # keep the reference where it differs from the studio grey (~0.5) and only on the front of the body
    sep = nt_.nodes.new("ShaderNodeSeparateXYZ"); nt_.links.new(texc.outputs["Generated"], sep.inputs["Vector"])
    front = nt_.nodes.new("ShaderNodeMath"); front.operation = "GREATER_THAN"; front.inputs[1].default_value = 0.62; nt_.links.new(sep.outputs["X"], front.inputs[0])
    diff = nt_.nodes.new("ShaderNodeMath"); diff.operation = "SUBTRACT"; diff.inputs[1].default_value = 0.5
    lum = nt_.nodes.new("ShaderNodeRGBToBW"); nt_.links.new(tex.outputs["Color"], lum.inputs[0]); nt_.links.new(lum.outputs[0], diff.inputs[0])
    absn = nt_.nodes.new("ShaderNodeMath"); absn.operation = "ABSOLUTE"; nt_.links.new(diff.outputs[0], absn.inputs[0])
    gain = nt_.nodes.new("ShaderNodeMath"); gain.operation = "MULTIPLY"; gain.inputs[1].default_value = 4.0; nt_.links.new(absn.outputs[0], gain.inputs[0])
    fac = nt_.nodes.new("ShaderNodeMath"); fac.operation = "MULTIPLY"; nt_.links.new(gain.outputs[0], fac.inputs[0]); nt_.links.new(front.outputs[0], fac.inputs[1])
    clamp = nt_.nodes.new("ShaderNodeClamp"); nt_.links.new(fac.outputs[0], clamp.inputs["Value"])
    mix = nt_.nodes.new("ShaderNodeMixRGB"); nt_.links.new(clamp.outputs[0], mix.inputs["Fac"]); nt_.links.new(base.outputs[0], mix.inputs[1]); nt_.links.new(tex.outputs["Color"], mix.inputs[2])
    nt_.links.new(mix.outputs[0], b.inputs["Base Color"])
    return m

def decal_plane(key, ref_id, size_m):
    """Ground decal: the reference PNG on a thin plane, studio grey keyed out as alpha."""
    im = ref_image(ref_id)
    bpy.ops.mesh.primitive_plane_add(size=size_m, location=(0, 0, 0.03)); src = bpy.context.object
    m = bpy.data.materials.new(f"Decal_{key}"); m.use_nodes = True; m.blend_method = "BLEND"; nt_ = m.node_tree; b = nt_.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.8
    if im is not None:
        tex = nt_.nodes.new("ShaderNodeTexImage"); tex.image = im
        nt_.links.new(tex.outputs["Color"], b.inputs["Base Color"])
        lum = nt_.nodes.new("ShaderNodeRGBToBW"); nt_.links.new(tex.outputs["Color"], lum.inputs[0])
        diff = nt_.nodes.new("ShaderNodeMath"); diff.operation = "SUBTRACT"; diff.inputs[1].default_value = 0.53; nt_.links.new(lum.outputs[0], diff.inputs[0])
        absn = nt_.nodes.new("ShaderNodeMath"); absn.operation = "ABSOLUTE"; nt_.links.new(diff.outputs[0], absn.inputs[0])
        gain = nt_.nodes.new("ShaderNodeMath"); gain.operation = "MULTIPLY"; gain.inputs[1].default_value = 6.0; nt_.links.new(absn.outputs[0], gain.inputs[0])
        clamp = nt_.nodes.new("ShaderNodeClamp"); nt_.links.new(gain.outputs[0], clamp.inputs["Value"]); nt_.links.new(clamp.outputs[0], b.inputs["Alpha"])
    src.data.materials.append(m)
    src.hide_render = True; src.hide_viewport = True; src.name = f"src_{key}"
    return src

def load_asset(key):
    if key in cache: return cache[key]
    if key in VIRTUAL and VIRTUAL[key] is None:
        cache[key] = decal_plane(key, "debris_cluster", 3.2); return cache[key]
    if key in VIRTUAL:
        base = load_asset(VIRTUAL[key])
        src = bpy.data.objects.new(f"src_{key}", base.data.copy()); sc.collection.objects.link(src)
        src.data.materials.clear()
        rgb = REFS.get("blue_hatchback", {}).get("paint_rgb") if key == "civilian_hatchback" else None
        src.data.materials.append(paint_material("HatchbackPaint", tuple(rgb) if rgb else (0.17, 0.26, 0.44), "blue_hatchback"))
        for v in src.data.vertices: v.co = (v.co.x * 0.92, v.co.y * 0.92, v.co.z * 0.95)  # compact hatchback footprint (mesh data is what instances share)
        src.hide_render = True; src.hide_viewport = True
        cache[key] = src; return src
    p = os.path.join(S["assets_root"], "glb", f"{key}.glb")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=p)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    other_names = [o.name for o in new if o.type != "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    # clear parenting (keep world transform) so the join bakes the glTF node hierarchy into one mesh
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1: bpy.ops.object.join()
    src = bpy.context.view_layer.objects.active
    for nm in other_names:
        o = bpy.data.objects.get(nm)
        if o is not None and o is not src: bpy.data.objects.remove(o, do_unlink=True)
    # normalise size: characters by height, everything else by horizontal length
    xs = [v.co.x for v in src.data.vertices]; ys = [v.co.y for v in src.data.vertices]; zs = [v.co.z for v in src.data.vertices]
    ext = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    tgt_m = TARGET.get(key, 2.0)
    s = tgt_m / max(1e-6, ext[2] if key in ("foot_patrol_officer", "spectator_crowd_cluster") else max(ext[0], ext[1]))
    for v in src.data.vertices: v.co = ((v.co.x - (max(xs) + min(xs)) / 2) * s, (v.co.y - (max(ys) + min(ys)) / 2) * s, (v.co.z - min(zs)) * s)
    if key == "foot_patrol_officer":  # navy uniform override (Kenney mini character is generic)
        for slot in src.material_slots: slot.material = mat("Uniform", (0.07, 0.10, 0.28), 0.7)
    if key == "civilian_sedan" and ref_image("silver_sedan") is not None:  # silver sedan reference paint + damage decal
        rgb = tuple(REFS.get("silver_sedan", {}).get("paint_rgb") or (0.40, 0.41, 0.41))
        for slot in src.material_slots: slot.material = paint_material("SedanPaint", rgb, "silver_sedan")
    src.hide_render = True; src.hide_viewport = True; src.name = f"src_{key}"
    cache[key] = src
    return src

inst_count = 0
flash = []
for it in S["instances"]:
    src = load_asset(it["asset"])
    d = bpy.data.objects.new("i_" + it["asset"], src.data); sc.collection.objects.link(d)
    d.location = (it["x"], it["y"], 0.04 if it["asset"] == "debris_cluster_decal" else 0.0); d.rotation_euler = Euler((0, 0, math.radians(it["heading_deg"] - 90)), "XYZ")
    k = float(it.get("scale", 1.0)); d.scale = (k, k, k); inst_count += 1
    if it["asset"] in ("police_patrol_car", "ambulance_medical_point", "police_escort_motorcycle"):
        L = bpy.data.lights.new("beacon", "POINT"); L.energy = 400 if tod != "midday" else 40; L.color = (0.1, 0.3, 1.0) if len(flash) % 2 == 0 else (1.0, 0.1, 0.1)
        lo = bpy.data.objects.new("beacon", L); sc.collection.objects.link(lo); lo.parent = d; lo.location = (0, 0, 2.2); flash.append((lo, len(flash)))

# flashing beacons (keyframed energy)
for lo, k in flash:
    base = lo.data.energy
    for f in range(f0, f1 + 1):
        on = ((f + k * 3) // max(1, fps // 4)) % 2 == 0
        lo.data.energy = base if on else base * 0.05; lo.data.keyframe_insert("energy", frame=f)

# ---- camera: slow crane orbit over the full duration
cam = bpy.data.cameras.new("Cam"); cam.lens = 32; cam.clip_end = 20000
co = bpy.data.objects.new("Cam", cam); sc.collection.objects.link(co); sc.camera = co
tgt = bpy.data.objects.new("Target", None); sc.collection.objects.link(tgt); tgt.location = (0, 0, 8)
tc = co.constraints.new("TRACK_TO"); tc.target = tgt; tc.track_axis = "TRACK_NEGATIVE_Z"; tc.up_axis = "UP_Y"
R0, R1, Z0, Z1 = 260.0, 170.0, 150.0, 95.0
# Frame the subject: a crash tableau gets a close street-level crane (the reference frames show the
# vehicles filling ~1/3 of the frame); other scenarios keep the wide establishing orbit.
crash = [it for it in S["instances"] if str(it.get("element", "")).startswith("crash_vehicle")]
if crash:
    cx = sum(it["x"] for it in crash) / len(crash); cy = sum(it["y"] for it in crash) / len(crash)
    tgt.location = (cx, cy, 1.2); R0, R1, Z0, Z1 = 48.0, 30.0, 26.0, 14.0
else:
    cx = cy = 0.0
def _inside(x, y, pts):
    c = False; n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-9) + x1: c = not c
    return c
def _path_blocked(a0):
    for k in range(9):
        u = k / 8; a = math.radians(a0 + 150 * u); r = R0 + (R1 - R0) * u; z = Z0 + (Z1 - Z0) * u
        px, py = cx + r * math.cos(a), cy + r * math.sin(a)
        for t in (0.0, 0.25, 0.5, 0.75):
            sx, sy, sz = px + (cx - px) * t, py + (cy - py) * t, z + (tgt.location.z - z) * t
            for _ob, pts, h in BUILDINGS:
                if h > sz - 1.0 and _inside(sx, sy, pts): return True
    return False
A0 = -120 + (SEED % 360)  # orbit start angle derived from the prompt seed
if crash:
    # keep the seed-derived phase but rotate to the first orbit whose camera path and sight line stay
    # out of building footprints (e.g. the 40 m Yas Mall slab next to the crash road)
    for off in range(0, 360, 15):
        if not _path_blocked(A0 + off): A0 = A0 + off; break
    else:
        Z0, Z1 = 60.0, 48.0
for f in range(f0, f1 + 1):
    u = f / max(1, total - 1)
    a = math.radians(A0 + 150 * u); r = R0 + (R1 - R0) * u; z = Z0 + (Z1 - Z0) * u
    co.location = (cx + r * math.cos(a), cy + r * math.sin(a), z); co.keyframe_insert("location", frame=f)

# Cutaway: a close crane shot can start inside (or behind) a large footprint such as the Yas Mall
# roof slab, which rendered pure black. Any building that contains the camera or blocks the
# camera->subject sight line on a sampled frame is hidden from camera rays (it still casts shadows).
hidden = 0
samples_f = list(range(f0, f1 + 1, max(1, (f1 - f0) // 12))) + [f1]
for ob, pts, h in BUILDINGS:
    blocked = False
    for f in samples_f:
        u = f / max(1, total - 1); a = math.radians(A0 + 150 * u); r = R0 + (R1 - R0) * u; z = Z0 + (Z1 - Z0) * u
        px, py = cx + r * math.cos(a), cy + r * math.sin(a)
        for t in (0.0, 0.2, 0.4, 0.6, 0.8):
            sx, sy, sz = px + (tgt.location.x - px) * t, py + (tgt.location.y - py) * t, z + (tgt.location.z - z) * t
            if h > sz - 1.0 and _inside(sx, sy, pts): blocked = True; break
        if blocked: break
    if blocked: ob.visible_camera = False; ob.visible_shadow = False; hidden += 1
print(f"CUTAWAY hidden_buildings={hidden}", flush=True)
sc.render.filepath = os.path.join(out_dir, "f_")
setup_s = round(time.time() - T0, 2)
print(f"SCENE_READY seed={SEED} cuda_visible={os.environ.get('CUDA_VISIBLE_DEVICES')} order={os.environ.get('CUDA_DEVICE_ORDER')} devices={used} buildings={bcount} facade={facade_applied} instances={inst_count} assets={len(cache)} references={[k for k in bpy.data.images.keys() if k.startswith('ref_')]} setup_s={setup_s} frames={f0}-{f1}", flush=True)
t = time.time()
bpy.ops.render.render(animation=True)
print(f"SHARD_DONE frames={f1 - f0 + 1} render_s={round(time.time() - t, 2)} setup_s={setup_s}", flush=True)
