"""Blender 4.2.3 persistent scene worker, exclusively UUID-pinned OptiX.

Called only by worker_pool.py. All images are staged and hashed; the API owns
publication. A cancelled/superseded request can never publish a stale image.
"""
import bpy, sys, json, math, os, time, hashlib, traceback
from datetime import datetime, timezone
from pathlib import Path
from mathutils import Vector, Euler, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gpu_policy as GPU
import camera as Camera
import terrain as Terrain

def utc(): return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
def atomic_json(path,value):
    temp=str(path)+".tmp"
    with open(temp,"w") as f:json.dump(value,f,allow_nan=False)
    os.replace(temp,path)
def emit(event,**data): print(json.dumps({"utc":utc(),"event":event,"workerPid":os.getpid(),**data}),flush=True)

def mat(name, color, rough=0.6, metal=0.0):
    m=bpy.data.materials.new(name);m.use_nodes=True;b=m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value=(*color,1);b.inputs["Roughness"].default_value=rough;b.inputs["Metallic"].default_value=metal
    return m

# Poly Haven CC0 scenery (street furniture / vegetation / PBR). key -> (relative gltf, target metres, axis)
AMBIENT = {"street_lamp": ("polyhaven/street_lamp_01/street_lamp_01_1k.gltf", 6.5, "h"),
           "street_tree": ("polyhaven/island_tree_02/island_tree_02_1k.gltf", 7.5, "h"),
           "shrub": ("polyhaven/shrub_01/shrub_01_1k.gltf", 1.3, "h"),
           "bench": ("polyhaven/modular_street_seating/modular_street_seating_1k.gltf", 2.2, "l")}
PBR = {"asphalt": "polyhaven/tex_asphalt_02/diff.jpg", "pavement": "polyhaven/tex_concrete_pavement/diff.jpg",
       "plaster": "polyhaven/tex_plastered_wall_04/diff.jpg"}
EVIDENCE = None

def _image(path):
    key = "img_" + os.path.basename(os.path.dirname(path)) + "_" + os.path.basename(path)
    if key not in bpy.data.images:
        im = bpy.data.images.load(path); im.name = key
    return bpy.data.images[key]

def _affine_uv(nt, affine):
    """World X/Y (local metres) -> ortho UV using the registered affine from imagery.py."""
    tc = nt.nodes.new("ShaderNodeTexCoord")
    a, b, c, d, e, f = affine
    du = nt.nodes.new("ShaderNodeVectorMath"); du.operation = "DOT_PRODUCT"; du.inputs[1].default_value = (a, b, 0)
    dv = nt.nodes.new("ShaderNodeVectorMath"); dv.operation = "DOT_PRODUCT"; dv.inputs[1].default_value = (d, e, 0)
    nt.links.new(tc.outputs["Object"], du.inputs[0]); nt.links.new(tc.outputs["Object"], dv.inputs[0])
    au = nt.nodes.new("ShaderNodeMath"); au.operation = "ADD"; au.inputs[1].default_value = c
    av = nt.nodes.new("ShaderNodeMath"); av.operation = "ADD"; av.inputs[1].default_value = f
    nt.links.new(du.outputs["Value"], au.inputs[0]); nt.links.new(dv.outputs["Value"], av.inputs[0])
    cmb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(au.outputs[0], cmb.inputs[0]); nt.links.new(av.outputs[0], cmb.inputs[1])
    return cmb.outputs[0]

def ortho_material(name, imagery, rough=.85, pbr=None, pbr_scale=.25, mix=0.0, tint=None):
    """Ortho imagery draped by geographic affine; optional PBR tile mixed in for close range."""
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = _image(imagery["file"]); tex.extension = "EXTEND"
    nt.links.new(_affine_uv(nt, imagery["affine"]), tex.inputs["Vector"])
    color = tex.outputs["Color"]
    if pbr and mix > 0 and os.path.isfile(os.path.join(S["assets_root"], pbr)):
        tc = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (pbr_scale, pbr_scale, pbr_scale)
        nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
        pt = nt.nodes.new("ShaderNodeTexImage"); pt.image = _image(os.path.join(S["assets_root"], pbr))
        nt.links.new(mp.outputs["Vector"], pt.inputs["Vector"])
        mx = nt.nodes.new("ShaderNodeMixRGB"); mx.blend_type = "OVERLAY"; mx.inputs["Fac"].default_value = mix
        nt.links.new(color, mx.inputs[1]); nt.links.new(pt.outputs["Color"], mx.inputs[2]); color = mx.outputs[0]
    if tint:
        mt = nt.nodes.new("ShaderNodeMixRGB"); mt.blend_type = "MULTIPLY"; mt.inputs["Fac"].default_value = 1
        mt.inputs[2].default_value = (*tint, 1); nt.links.new(color, mt.inputs[1]); color = mt.outputs[0]
    nt.links.new(color, b.inputs["Base Color"])
    return m

def pbr_material(name, pbr, scale, tint=(1, 1, 1), rough=.8):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    path = os.path.join(S["assets_root"], pbr)
    if not os.path.isfile(path):
        b.inputs["Base Color"].default_value = (*tint, 1); return m
    tc = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (scale, scale, scale)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = _image(path); t.projection = "BOX"; t.projection_blend = .25
    nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
    mt = nt.nodes.new("ShaderNodeMixRGB"); mt.blend_type = "MULTIPLY"; mt.inputs["Fac"].default_value = 1; mt.inputs[2].default_value = (*tint, 1)
    nt.links.new(t.outputs["Color"], mt.inputs[1]); nt.links.new(mt.outputs[0], b.inputs["Base Color"])
    return m

def load_ambient(key):
    """Poly Haven glTF -> single hidden source mesh normalised to a real-world size; instances share data."""
    ck = "ambient_" + key
    if ck in cache: return cache[ck]
    rel, target, axis = AMBIENT[key]
    path = os.path.join(S["assets_root"], rel)
    if not os.path.isfile(path): cache[ck] = None; return None
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    other_names = [o.name for o in new if o.type != "MESH"]
    if not meshes: cache[ck] = None; return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1: bpy.ops.object.join()
    src = bpy.context.view_layer.objects.active
    for nm in other_names:
        o = bpy.data.objects.get(nm)
        if o is not None and o is not src: bpy.data.objects.remove(o, do_unlink=True)
    xs = [v.co.x for v in src.data.vertices]; ys = [v.co.y for v in src.data.vertices]; zs = [v.co.z for v in src.data.vertices]
    ext = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    k = target / max(1e-6, ext[2] if axis == "h" else max(ext[0], ext[1]))
    cx, cy, z0 = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs)
    for v in src.data.vertices: v.co = ((v.co.x - cx) * k, (v.co.y - cy) * k, (v.co.z - z0) * k)
    src.hide_render = True; src.hide_viewport = True; src.name = "src_" + ck
    cache[ck] = src
    return src

S={};sc=None;cache={};REFS={};REF_DIR=""
def ref_image(ref_id):
    r=REFS.get(ref_id)
    if not r or not r.get("available_on_host"):return None
    p=os.path.join(REF_DIR,r["file"])
    if not os.path.isfile(p):return None
    key="ref_"+ref_id
    if key not in bpy.data.images:
        im=bpy.data.images.load(p);im.name=key
    return bpy.data.images[key]

TARGET = {"police_patrol_car": 4.8, "police_escort_motorcycle": 2.2, "ambulance_medical_point": 5.6, "crowd_control_barrier": 2.0, "road_closed_barricade": 1.6,
          "traffic_cone_cluster": 0.7, "checkpoint_cordon_node": 1.6, "event_command_post": 6.0, "start_finish_gate": 9.0, "foot_patrol_officer": 1.8,
          "spectator_crowd_cluster": 1.75, "city_bus": 11.5, "cctv_camera": 0.5, "marine_patrol_boat": 7.5,
          "civilian_sedan": 4.6, "civilian_suv": 4.9, "civilian_taxi": 4.6, "debris_bumper": 1.7, "debris_tire": 0.65, "debris_door": 1.1, "debris_plate": 0.8}
VIRTUAL = {"civilian_hatchback": "civilian_sedan", "debris_cluster_decal": None}

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
    m = bpy.data.materials.new(f"Decal_{key}"); m.use_nodes = True; m.surface_render_method = "DITHERED"; nt_ = m.node_tree; b = nt_.nodes["Principled BSDF"]
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
    if not meshes: raise RuntimeError("asset has no mesh: " + key)
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


def mesh_object(name,vertices,faces,material,source_id=None,material2=None,second_from=None):
    me=bpy.data.meshes.new(name);me.from_pydata(vertices,[],faces);me.update()
    ob=bpy.data.objects.new(name,me);sc.collection.objects.link(ob);ob.data.materials.append(material)
    if material2 is not None and second_from is not None:
        ob.data.materials.append(material2)
        for poly in me.polygons:
            if poly.index>=second_from:poly.material_index=1
    if source_id:ob["source_id"]=source_id
    return ob

def surface(data,z,material,name,source_id):
    verts=[];faces=[]
    for triangle in data.get("triangles",[]):
        idx=len(verts);verts.extend((x,y,Terrain.surface_height(S["terrain"],x,y)+z) for x,y in triangle);faces.append((idx,idx+1,idx+2))
    if faces:return mesh_object(name,verts,faces,material,source_id)

def build_scene(scene):
    global S,sc,cache,REFS,REF_DIR,co
    S=scene;cache={};REFS={r["id"]:r for r in S.get("references",[])};REF_DIR=S["references_dir"]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc=bpy.context.scene
    sc.render.engine="CYCLES";sc.cycles.device="GPU";sc.cycles.use_denoising=True;sc.cycles.denoiser="OPTIX"
    sc.cycles.use_adaptive_sampling=True;sc.cycles.adaptive_threshold=.08
    sc.cycles.max_bounces=4;sc.cycles.diffuse_bounces=3;sc.cycles.caustics_reflective=False;sc.cycles.caustics_refractive=False
    sc.render.use_persistent_data=True;sc.render.image_settings.file_format="JPEG"
    sc.render.image_settings.color_mode="RGB";sc.render.image_settings.quality=84
    sc.render.film_transparent=False;sc.view_settings.view_transform="AgX"
    sc.view_settings.look="AgX - Medium High Contrast";sc.render.threads_mode="FIXED";sc.render.threads=4
    sc.unit_settings.system="METRIC";sc.unit_settings.scale_length=1.0
    tod=S.get("time_of_day","midday")
    world=bpy.data.worlds.new("Illustrative lighting (not geographic imagery)");sc.world=world;world.use_nodes=True
    bg=world.node_tree.nodes["Background"];bg.inputs["Strength"].default_value={"night":.3,"dusk":.9,"midday":1.35}[tod]
    hdri=os.path.join(S["assets_root"],"polyhaven",S["hdri"])
    if os.path.isfile(hdri):
        env=world.node_tree.nodes.new("ShaderNodeTexEnvironment");env.image=bpy.data.images.load(hdri)
        world.node_tree.links.new(env.outputs["Color"],bg.inputs["Color"])
    sun=bpy.data.lights.new("Illustrative sun","SUN");sun.energy={"night":.08,"dusk":1.8,"midday":3.6}[tod];sun.angle=math.radians(1.2)
    if tod=="dusk":sun.color=(1.0,.72,.48)
    ob=bpy.data.objects.new("Sun",sun);sc.collection.objects.link(ob);ob.rotation_euler=Euler({"night":(.5,.4,-.5),"dusk":(1.32,.0,-1.9),"midday":(.18,.14,-.6)}[tod])
    sc.view_settings.exposure={"night":.7,"dusk":.35,"midday":.55}[tod]
    if tod=="night":
        # Urban night: a low moon-sky fill plus warm sodium glow AROUND THE CAMERA / STAGED
        # ACTION, not only at the patch origin — street-level cameras hundreds of metres
        # from the origin were rendering black (lumMean ≈ 1/255) before this fix.
        bg.inputs["Strength"].default_value=.32
        sun.energy=.22;sun.color=(.72,.8,1.0)
        anchors=[]
        cam0=(S.get("camera") or {}).get("position") or None
        if cam0:anchors.append((float(cam0[0]),float(cam0[1])))
        for it in (S.get("instances") or [])[:6]:anchors.append((float(it["x"]),float(it["y"])))
        if not anchors:anchors=[(0.0,0.0)]
        cx=sum(a[0] for a in anchors)/len(anchors);cy=sum(a[1] for a in anchors)/len(anchors)
        spots=[(cx,cy)]+[(cx+45*math.cos(a),cy+45*math.sin(a)) for a in (0.4,2.5,4.6)]+[(0,0)]
        for k,(lx,ly) in enumerate(spots):
            try:lz=Terrain.surface_height(S["terrain"],lx,ly)
            except Exception:lz=0.0
            pl=bpy.data.lights.new(f"Street glow {k}","POINT");pl.energy=30000 if k==0 else 15000;pl.color=(1,.78,.5);pl.shadow_soft_size=5
            lo=bpy.data.objects.new(f"Street glow {k}",pl);sc.collection.objects.link(lo);lo.location=(lx,ly,lz+11)
    if not S.get("terrain"):raise RuntimeError("source terrain is required; no flat substitute")
    imagery=S.get("imagery") or {}
    fine=imagery.get("fine") if imagery.get("fine") and os.path.isfile(imagery["fine"].get("file","")) else None
    context=imagery.get("context") if imagery.get("context") and os.path.isfile(imagery["context"].get("file","")) else None
    if fine:ground=ortho_material("Ortho imagery draped on Copernicus DSM ("+fine["providerName"]+")",fine,.9,PBR["pavement"],.35,.18)
    else:ground=pbr_material("Copernicus DSM / no imagery available",PBR["pavement"],.3,(.55,.5,.43),.9)
    boundary=S["patch"]["boundary"]
    terrain_mesh=S["terrain"]["clippedMesh"]
    mesh_object("Copernicus GLO-90 terrain",terrain_mesh["vertices"],terrain_mesh["faces"],ground,S["terrain"]["id"])
    # Scenery skirt: context imagery ring around the geo patch so its edge blends into surroundings.
    skirt_m=float(imagery.get("skirtM",2500)) if context else 1800.0
    ring=boundary[:-1] if boundary[0]==boundary[-1] else boundary
    inner=[];zs=[]
    for x,y in ring:
        z=None
        for k in (0.999,0.995,0.99,0.98):
            try:z=Terrain.surface_height(S["terrain"],x*k,y*k);break
            except Exception:continue
        zs.append(z)
    known=[z for z in zs if z is not None];zmean=sum(known)/len(known) if known else 0
    zs=[zmean if z is None else z for z in zs]
    verts=[];faces=[];n=len(ring)
    for (x,y),z in zip(ring,zs):
        r=math.hypot(x,y) or 1;verts.append((x,y,z-.05))
    for (x,y) in ring:
        r=math.hypot(x,y) or 1;f=(r+skirt_m)/r;verts.append((x*f,y*f,zmean-1.5))
    for i in range(n):faces.append((i,(i+1)%n,n+(i+1)%n,n+i))
    skirt_mat=ortho_material("Context imagery skirt (scenery, not geography)",context,.95,PBR["pavement"],.08,.12,(.92,.92,.9)) if context else pbr_material("Neutral scenery skirt",PBR["pavement"],.05,(.5,.47,.41),.95)
    mesh_object("Scenery skirt (outside geographic patch)",verts,faces,skirt_mat,None)
    wall_palette=[(.86,.82,.74),(.93,.91,.86),(.78,.72,.62),(.70,.68,.66),(.88,.84,.78)]
    roof_mat=ortho_material("Ortho imagery roof drape",fine,.8) if fine else mat("OSM roof / approximate",(.55,.53,.5),.8)
    wall_mats=[pbr_material(f"Facade PBR plaster {i} (illustrative)",PBR["plaster"],.35,c,.85) for i,c in enumerate(wall_palette)]
    for b in S["buildings"]:
        vertices=[];faces=[];h=b["h"]+b.get("z",0)
        for ring_pts in [b["pts"]]+b.get("holes",[]):
            offset=len(vertices);n=len(ring_pts)
            vertices.extend((x,y,Terrain.surface_height(S["terrain"],x,y)-.3) for x,y in ring_pts);vertices.extend((x,y,h) for x,y in ring_pts)
            faces.extend((offset+i,offset+(i+1)%n,offset+n+(i+1)%n,offset+n+i) for i in range(n))
        walls=len(faces)
        for tri in b.get("triangles",[]):
            offset=len(vertices);vertices.extend((x,y,h) for x,y in tri);faces.append((offset,offset+1,offset+2))
        wm=wall_mats[int(hashlib.md5(b["id"].encode()).hexdigest(),16)%len(wall_mats)]
        ob=mesh_object("OSM "+b["id"],vertices,faces,wm,b["sourceId"],roof_mat,walls)
        ob["height_basis"]=b["height"]["basis"]
        if b.get("facade")=="mall_facade_module" and ref_image("mall_facade_module"):
            # Artistic supplied reference, not a measured/photographed local facade.
            m=mat("Illustrative mall reference",(.62,.60,.55),.7)
            tex=m.node_tree.nodes.new("ShaderNodeTexImage");tex.image=ref_image("mall_facade_module");tex.projection="BOX"
            coords=m.node_tree.nodes.new("ShaderNodeTexCoord");m.node_tree.links.new(coords.outputs["Generated"],tex.inputs["Vector"])
            m.node_tree.links.new(tex.outputs["Color"],m.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
            ob.data.materials[0]=m
    road_mat=ortho_material("OSM road surface · asphalt PBR over ortho",fine,.75,PBR["asphalt"],.3,.55,(.72,.72,.72)) if fine else pbr_material("Mapped road / asphalt PBR",PBR["asphalt"],.3,(.35,.35,.36),.85)
    for road in S["roads"]:
        for piece in road["surface"]:surface(piece,.035,road_mat,"OSM "+road["id"],road["sourceId"])
    walk_mat=pbr_material("Sidewalk (derived from OSM road class; approximate)",PBR["pavement"],.5,(.82,.79,.73),.9)
    for walk in S.get("sidewalks",[]):
        for piece in walk["surface"]:surface(piece,.12,walk_mat,"Sidewalk "+walk["id"],walk["sourceId"])
    water_mat=mat("Mapped water extent / elevation unknown",(.05,.17,.22),.08)
    for water in S.get("water",[]):
        for piece in water.get("surface",[water]):surface(piece,.03,water_mat,"OSM "+water["id"],water["sourceId"])
    for i,it in enumerate(S.get("ambient",[])):
        src=load_ambient(it["asset"])
        if src is None:continue
        ob=bpy.data.objects.new("scenery_"+str(i)+"_"+it["asset"],src.data);sc.collection.objects.link(ob)
        ob.location=(it["x"],it["y"],it["z"]);ob.rotation_euler=(0,0,math.radians(it.get("heading_deg",0)))
        k=it.get("scale",1);ob.scale=(k,k,k);ob["scenery"]="Poly Haven CC0 (illustrative street furniture/vegetation)"
    for i,it in enumerate(S["instances"]):
        src=load_asset(it["asset"])
        ob=bpy.data.objects.new("staged_"+str(i)+"_"+it["asset"],src.data);sc.collection.objects.link(ob)
        ob.location=(it["x"],it["y"],it.get("z",.06))
        x,y=it["x"],it["y"];eps=.15
        gx=(Terrain.surface_height(S["terrain"],x+eps,y)-Terrain.surface_height(S["terrain"],x-eps,y))/(2*eps)
        gy=(Terrain.surface_height(S["terrain"],x,y+eps)-Terrain.surface_height(S["terrain"],x,y-eps))/(2*eps)
        up=Vector((-gx,-gy,1)).normalized();angle=math.radians(it["heading_deg"])
        forward=Vector((math.cos(angle),math.sin(angle),gx*math.cos(angle)+gy*math.sin(angle))).normalized()
        side=forward.cross(up).normalized();forward=up.cross(side).normalized()
        ob.rotation_euler=Matrix((side,forward,up)).transposed().to_euler()
        k=it.get("scale",1);ob.scale=(k,k,k);ob["grounding_source"]=it["sourceId"]
        bpy.context.view_layer.update()
        if any(not Camera.inside_ring((ob.matrix_world @ v.co),S["patch"]["boundary"]) for v in ob.data.vertices):
            raise RuntimeError("staged asset exceeds actual geographic boundary: "+it["asset"])
    cam=bpy.data.cameras.new("Bounded camera");cam.sensor_fit="HORIZONTAL";cam.clip_start=.25;cam.clip_end=2000
    co=bpy.data.objects.new("Bounded camera",cam);sc.collection.objects.link(co);sc.camera=co
    layers=S.get("layers") or {}
    for o in sc.objects:
        if (o.name.startswith("OSM way") or o.name.startswith("OSM relation")) and o.get("height_basis") is not None and layers.get("buildings") is False:o.hide_render=True
        if o.name.startswith("Scenery skirt") and layers.get("skirt") is False:o.hide_render=True
        if o.name.startswith("OSM") and o.get("height_basis") is None and layers.get("roads") is False and "water" not in (o.active_material.name.lower() if o.active_material else ""):o.hide_render=True
    emit("scene_ready",sceneId=S["sceneId"],patchId=S["patch"]["id"],cacheKey=S["cacheKey"],buildings=len(S["buildings"]),instances=len(S["instances"]))

def render_command(cmd,device):
    global S
    start=time.monotonic();reused=bool(S and S["cacheKey"]==cmd["cacheKey"])
    if not reused:
        with open(cmd["scenePath"]) as f:scene=json.load(f)
        if scene["cacheKey"]!=cmd["cacheKey"]:raise RuntimeError("scene cache identity mismatch")
        build_scene(scene)
    global EVIDENCE
    if not reused or EVIDENCE is None:EVIDENCE=GPU.configure_cycles(bpy,device);evidence=EVIDENCE
    else:evidence=GPU.verify_cycles(bpy,device,EVIDENCE)
    if cmd.get("warmOnly"):
        # Prime BVH, OptiX kernels and image textures with a 1-sample render (persistent data keeps them).
        target=Path(cmd["stagingPath"]).resolve();allowed=Path(os.environ.get("GEV_ROOT","/localstorage/mk.thomas/gev"),"jobs").resolve()
        if allowed in target.parents:
            pose=Camera.validate_pose(cmd["pose"],S,16/9)
            co.location=pose["position"];co.rotation_euler=(Vector(pose["target"])-co.location).to_track_quat("-Z","Y").to_euler()
            co.data.angle=math.radians(pose["fovDeg"]);sc.render.resolution_x=640;sc.render.resolution_y=360;sc.render.resolution_percentage=100
            sc.cycles.samples=1;sc.render.filepath=str(target.with_name(target.stem+"_warm.jpg"))
            bpy.ops.render.render(write_still=True)
            try:target.with_name(target.stem+"_warm.jpg").unlink()
            except FileNotFoundError:pass
        result={"requestId":cmd["requestId"],"jobId":cmd["jobId"],"warm":True,"cacheKey":S["cacheKey"],"workerPid":os.getpid(),
                "gpu":evidence,"totalSeconds":round(time.monotonic()-start,4),"reusedScene":reused}
        emit("worker_warm",**result);return result
    width,height=int(cmd["width"]),int(cmd["height"])
    if width not in (640,960,1280) or height!=width*9//16:raise RuntimeError("unsupported bounded resolution")
    pose=Camera.validate_pose(cmd["pose"],S,width/height)
    co.location=pose["position"];co.rotation_euler=(Vector(pose["target"])-co.location).to_track_quat("-Z","Y").to_euler()
    co.data.angle=math.radians(pose["fovDeg"]);co.data.clip_start=pose["nearClip"]
    sc.render.resolution_x=width;sc.render.resolution_y=height;sc.render.resolution_percentage=100
    sc.cycles.samples=max(4,min(128,int(cmd["samples"])));sc.cycles.seed=int(S.get("seed",7))
    target=Path(cmd["stagingPath"]).resolve();allowed=Path(os.environ.get("GEV_ROOT","/localstorage/mk.thomas/gev"),"jobs").resolve()
    if allowed not in target.parents:raise RuntimeError("output outside jobs directory")
    sc.render.filepath=str(target);render_start=time.monotonic()
    emit("render_start",jobId=cmd["jobId"],frameId=cmd["frameId"],jobHash=cmd["jobHash"],sceneHash=cmd["cacheKey"],pose=pose,**evidence)
    bpy.ops.render.render(write_still=True)
    if not target.is_file():raise RuntimeError("Blender produced no frame")
    frame_hash=hashlib.sha256(target.read_bytes()).hexdigest()
    result={"requestId":cmd["requestId"],"jobId":cmd["jobId"],"frameId":cmd["frameId"],"sceneId":cmd["sceneId"],
            "patchId":S["patch"]["id"],"cacheKey":S["cacheKey"],"jobHash":cmd["jobHash"],"hash":frame_hash,"createdUtc":utc(),"pose":pose,
            "sourceIds":S["patch"]["featureIds"],"width":width,"height":height,"workerPid":os.getpid(),
            "renderSeconds":round(time.monotonic()-render_start,4),"totalSeconds":round(time.monotonic()-start,4),
            "reusedScene":reused,"gpu":evidence,"stagingPath":str(target)}
    emit("frame_complete",**result)
    return result

def main():
    argv=sys.argv[sys.argv.index("--")+1:]
    if len(argv)!=2 or argv[0]!="--worker":raise RuntimeError("persistent worker invocation required")
    spool=Path(argv[1]);spool.mkdir(parents=True,exist_ok=True)
    device={"physicalIndex":int(os.environ["GEV_GPU_INDEX"]),"uuid":os.environ["GEV_GPU_UUID"],"pciBusId":os.environ["GEV_GPU_PCI"]}
    evidence=GPU.configure_cycles(bpy,device)
    atomic_json(spool/"ready.json",{"workerPid":os.getpid(),"utc":utc(),"gpu":evidence})
    emit("worker_ready",**evidence)
    while not (spool/"shutdown").exists():
        path=spool/"command.json"
        if not path.exists():time.sleep(.003);continue
        cmd=json.loads(path.read_text());path.unlink()
        try:result=render_command(cmd,device)
        except Exception as exc:
            result={"requestId":cmd.get("requestId"),"error":type(exc).__name__+": "+str(exc),"workerPid":os.getpid()}
            emit("worker_error",**result);traceback.print_exc()
        atomic_json(spool/"result.json",result)

if __name__=="__main__":
    try:main()
    except Exception as exc:
        emit("fatal_gpu_or_worker_error",error=str(exc));raise
