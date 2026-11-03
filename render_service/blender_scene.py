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
rnd = random.Random(7)

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
if tod == "night":
    sc.view_settings.exposure = 1.2
elif tod == "dusk":
    sc.view_settings.exposure = 0.4

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
bmat = mat("Building", (0.72, 0.70, 0.66), 0.55); bglass = mat("Glass", (0.35, 0.45, 0.55), 0.15, 0.6)
bcount = 0
for b in S["buildings"][:900]:
    pts = b["pts"]
    if len(pts) < 3: continue
    h = max(3.0, min(320.0, float(b["h"])))
    me = bpy.data.meshes.new("b"); ob = bpy.data.objects.new("b", me); sc.collection.objects.link(ob)
    verts = [(x, y, 0) for x, y in pts] + [(x, y, h) for x, y in pts]
    n = len(pts); faces = [tuple(range(n)), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    me.from_pydata(verts, [], faces); me.update()
    ob.data.materials.append(bglass if h > 60 else bmat); bcount += 1

# ---- roads as thin dark strips
rm = mat("Road", (0.12, 0.12, 0.13), 0.75)
for r in S["roads"][:400]:
    pts = r["pts"]
    if len(pts) < 2: continue
    cu = bpy.data.curves.new("rc", "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = 3.5 if r["kind"] in ("primary", "trunk", "motorway", "secondary") else 2.2; cu.bevel_resolution = 0; cu.fill_mode = "FULL"
    sp = cu.splines.new("POLY"); sp.points.add(len(pts) - 1)
    for i, (x, y) in enumerate(pts): sp.points[i].co = (x, y, 0.08, 1)
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
          "spectator_crowd_cluster": 1.75, "city_bus": 11.5, "cctv_camera": 0.5, "marine_patrol_boat": 7.5}
def load_asset(key):
    if key in cache: return cache[key]
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
    src.hide_render = True; src.hide_viewport = True; src.name = f"src_{key}"
    cache[key] = src
    return src

inst_count = 0
flash = []
for it in S["instances"]:
    src = load_asset(it["asset"])
    d = bpy.data.objects.new("i_" + it["asset"], src.data); sc.collection.objects.link(d)
    d.location = (it["x"], it["y"], 0.0); d.rotation_euler = Euler((0, 0, math.radians(it["heading_deg"] - 90)), "XYZ")
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
for f in range(f0, f1 + 1):
    u = f / max(1, total - 1)
    a = math.radians(-120 + 150 * u); r = R0 + (R1 - R0) * u; z = Z0 + (Z1 - Z0) * u
    co.location = (r * math.cos(a), r * math.sin(a), z); co.keyframe_insert("location", frame=f)

sc.render.filepath = os.path.join(out_dir, "f_")
setup_s = round(time.time() - T0, 2)
print(f"SCENE_READY devices={used} buildings={bcount} instances={inst_count} assets={len(cache)} setup_s={setup_s} frames={f0}-{f1}", flush=True)
t = time.time()
bpy.ops.render.render(animation=True)
print(f"SHARD_DONE frames={f1 - f0 + 1} render_s={round(time.time() - t, 2)} setup_s={setup_s}", flush=True)
