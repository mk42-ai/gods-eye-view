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


def mesh_object(name,vertices,faces,material,source_id=None):
    me=bpy.data.meshes.new(name);me.from_pydata(vertices,[],faces);me.update()
    ob=bpy.data.objects.new(name,me);sc.collection.objects.link(ob);ob.data.materials.append(material)
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
    sc.cycles.max_bounces=3;sc.cycles.caustics_reflective=False;sc.cycles.caustics_refractive=False
    sc.render.use_persistent_data=True;sc.render.image_settings.file_format="JPEG"
    sc.render.image_settings.color_mode="RGB";sc.render.image_settings.quality=84
    sc.render.film_transparent=False;sc.view_settings.view_transform="AgX"
    sc.view_settings.look="AgX - Medium High Contrast";sc.render.threads_mode="FIXED";sc.render.threads=4
    sc.unit_settings.system="METRIC";sc.unit_settings.scale_length=1.0
    tod=S.get("time_of_day","midday")
    world=bpy.data.worlds.new("Illustrative lighting (not geographic imagery)");sc.world=world;world.use_nodes=True
    bg=world.node_tree.nodes["Background"];bg.inputs["Strength"].default_value={"night":.25,"dusk":.6,"midday":.8}[tod]
    hdri=os.path.join(S["assets_root"],"polyhaven",S["hdri"])
    if os.path.isfile(hdri):
        env=world.node_tree.nodes.new("ShaderNodeTexEnvironment");env.image=bpy.data.images.load(hdri)
        world.node_tree.links.new(env.outputs["Color"],bg.inputs["Color"])
    sun=bpy.data.lights.new("Illustrative sun","SUN");sun.energy={"night":.1,"dusk":1.5,"midday":3.0}[tod]
    ob=bpy.data.objects.new("Sun",sun);sc.collection.objects.link(ob);ob.rotation_euler=Euler((.4,.5,-.5))
    if not S.get("terrain"):raise RuntimeError("source terrain is required; no flat substitute")
    ground=mat("Copernicus DSM / coarse source terrain",(.34,.32,.28),.9)
    boundary=S["patch"]["boundary"]
    terrain_mesh=S["terrain"]["clippedMesh"]
    mesh_object("Copernicus GLO-90 terrain",terrain_mesh["vertices"],terrain_mesh["faces"],ground,S["terrain"]["id"])
    building_mat=mat("OSM footprint / approximate height",(.62,.60,.55),.75)
    for b in S["buildings"]:
        vertices=[];faces=[];h=b["h"]+b.get("z",0)
        for ring in [b["pts"]]+b.get("holes",[]):
            offset=len(vertices);n=len(ring)
            vertices.extend((x,y,Terrain.surface_height(S["terrain"],x,y)) for x,y in ring);vertices.extend((x,y,h) for x,y in ring)
            faces.extend((offset+i,offset+(i+1)%n,offset+n+(i+1)%n,offset+n+i) for i in range(n))
        for tri in b.get("triangles",[]):
            offset=len(vertices);vertices.extend((x,y,h) for x,y in tri);faces.append((offset,offset+1,offset+2))
        ob=mesh_object("OSM "+b["id"],vertices,faces,building_mat,b["sourceId"])
        ob["height_basis"]=b["height"]["basis"]
        if b.get("facade")=="mall_facade_module" and ref_image("mall_facade_module"):
            # Artistic supplied reference, not a measured/photographed local facade.
            m=mat("Illustrative mall reference",(.62,.60,.55),.7)
            tex=m.node_tree.nodes.new("ShaderNodeTexImage");tex.image=ref_image("mall_facade_module");tex.projection="BOX"
            coords=m.node_tree.nodes.new("ShaderNodeTexCoord");m.node_tree.links.new(coords.outputs["Generated"],tex.inputs["Vector"])
            m.node_tree.links.new(tex.outputs["Color"],m.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
            ob.data.materials.clear();ob.data.materials.append(m)
    road_mat=mat("Mapped centerline / width-tag or approximate corridor",(.11,.12,.13),.85)
    for road in S["roads"]:
        for piece in road["surface"]:surface(piece,.025,road_mat,"OSM "+road["id"],road["sourceId"])
    water_mat=mat("Mapped water extent / elevation unknown",(.08,.22,.28),.25)
    for water in S.get("water",[]):
        for piece in water.get("surface",[water]):surface(piece,.03,water_mat,"OSM "+water["id"],water["sourceId"])
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
    emit("scene_ready",sceneId=S["sceneId"],patchId=S["patch"]["id"],cacheKey=S["cacheKey"],buildings=len(S["buildings"]),instances=len(S["instances"]))

def render_command(cmd,device):
    global S
    start=time.monotonic();reused=bool(S and S["cacheKey"]==cmd["cacheKey"])
    if not reused:
        with open(cmd["scenePath"]) as f:scene=json.load(f)
        if scene["cacheKey"]!=cmd["cacheKey"]:raise RuntimeError("scene cache identity mismatch")
        build_scene(scene)
    evidence=GPU.configure_cycles(bpy,device)
    width,height=int(cmd["width"]),int(cmd["height"])
    if width not in (640,960) or height!=width*9//16:raise RuntimeError("unsupported bounded resolution")
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
        if not path.exists():time.sleep(.03);continue
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
