"""Authenticated, bounded scene-render API for Python 3.10 / Blender 4.2.3.

GPU workers are persistent, UUID pinned, GPU-only. Rendering cadence is measured
separately from the export timeline. Every published image has immutable source,
pose, worker, device and byte-hash evidence; cancelled revisions cannot publish.
"""
from __future__ import annotations
import asyncio
from concurrent.futures import ThreadPoolExecutor, CancelledError
from contextlib import asynccontextmanager
import hashlib
import hmac
import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import threading
import time
from typing import Literal, Optional
import uuid
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field, model_validator
from PIL import Image
import pipeline as P
import imagery as IMG
import geography as G
import camera as C
import gpu_policy as GPU
import copernicus as DEM
import terrain as Terrain
from worker_pool import WorkerPool, QueueFull, atomic_json

ROOT=Path(os.environ.get("GEV_ROOT","/localstorage/mk.thomas/gev"))
JOBS_DIR=ROOT/"jobs"
BLENDER=str(ROOT/"blender-4.2.3-linux-x64"/"blender")
TOKEN=os.environ.get("RENDER_SERVICE_TOKEN","")
PUBLIC_BASE=os.environ.get("RENDER_PUBLIC_BASE","").rstrip("/")
LABEL="Illustrative render · not evidence"
SAMPLES=max(8,min(128,int(os.environ.get("RENDER_SAMPLES","24"))))
SOURCE_VERSION=hashlib.sha256(b"".join(p.read_bytes() for p in sorted(Path(__file__).parent.glob("*.py")) if not p.name.startswith("test_"))).hexdigest()
CAPTURE_FPS=max(1,min(30,int(os.environ.get("RENDER_TIMELINE_FPS","24"))))
MAX_FRAMES=240
SEQUENCE_SAMPLES=max(4,min(32,int(os.environ.get("RENDER_SEQUENCE_SAMPLES","8"))))
# Bounded 16:9 render widths. preview = first (fast) frame; quality = hero still; sequence = timeline frames.
# 1280x720 is the merged-workstation viewport size; per request `resolution` may raise/lower the sequence width.
WIDTHS=(640,960,1280)
def _width(name,default):
    try:value=int(os.environ.get(name,default))
    except ValueError:value=default
    return value if value in WIDTHS else default
PREVIEW_WIDTH=640
QUALITY_WIDTH=_width("RENDER_QUALITY_WIDTH",1280)
SEQUENCE_WIDTH=_width("RENDER_SEQUENCE_WIDTH",640)
def frame_width(j,quality):
    if quality=="preview":return PREVIEW_WIDTH
    requested=(j.get("request") or {}).get("resolution")
    if quality=="sequence":
        if requested:return int(str(requested).split("x")[0])
        return SEQUENCE_WIDTH
    return QUALITY_WIDTH
TERMINAL={"complete","partial","failed","cancelled"}
@asynccontextmanager
async def lifespan(_app):
    yield
    shutdown()

app=FastAPI(title="gods-eye-view render service",version="0.2.0",lifespan=lifespan)
app.add_middleware(CORSMiddleware,allow_origins=["*"],allow_methods=["*"],allow_headers=["*"])
JOBS={};SCENES={};LOCK=threading.RLock();POOL=None
COORDINATORS=ThreadPoolExecutor(max_workers=4,thread_name_prefix="scene-job")
ADMISSION=threading.BoundedSemaphore(12)


def auth(request:Request):
    # Missing secret is never an unauthenticated render service.
    if not TOKEN:raise HTTPException(503,"render authentication not configured")
    h=request.headers.get("authorization","")
    token=h[7:] if h.lower().startswith("bearer ") else ""
    if not hmac.compare_digest(token,TOKEN):raise HTTPException(401,"invalid bearer token")

class RenderBody(BaseModel):
    prompt:str=Field(min_length=3,max_length=3000)
    lat:Optional[float]=Field(default=None,ge=-80,le=80)
    lon:Optional[float]=Field(default=None,gt=-180,lt=180)
    lng:Optional[float]=Field(default=None,gt=-180,lt=180)
    aoi:Optional[list[float]]=Field(default=None,min_length=4,max_length=4)
    radius_m:float=Field(default=260,ge=150,le=1200)
    camera:Optional[dict]=None
    request_id:Optional[str]=Field(default=None,max_length=96)
    selectedCoordinates:bool=False
    locationVerification:Optional[dict]=None
    time_of_day:Optional[Literal["dusk","night","midday","auto"]]=None
    duration_s:int=Field(default=60,ge=2,le=120)
    seed:Optional[int]=Field(default=None,ge=0,le=2**31-1)
    samples:Optional[int]=Field(default=None,ge=4,le=128)
    camera_mode:Literal["street","low_oblique","orbit"]="street"
    layers:Optional[dict[str,bool]]=None
    resolution:Optional[Literal["640x360","960x540","1280x720"]]=None
    @model_validator(mode="after")
    def coordinate_alias(self):
        if self.lon is not None and self.lng is not None and self.lon!=self.lng:raise ValueError("lon and lng disagree")
        if self.lon is None:self.lon=self.lng
        return self

class CameraBody(BaseModel):
    action:Optional[Literal["orbit-left","orbit-right","forward","back","up","down"]]=None
    position:Optional[list[float]]=Field(default=None,min_length=3,max_length=3)
    target:Optional[list[float]]=Field(default=None,min_length=3,max_length=3)
    fovDeg:float=Field(default=45,ge=25,le=70)
    revision:int=Field(ge=1)
    @model_validator(mode="after")
    def exactly_one(self):
        if self.action and (self.position is not None or self.target is not None):raise ValueError("action and explicit pose are mutually exclusive")
        if not self.action and (self.position is None or self.target is None):raise ValueError("action or complete position/target required")
        return self


def urls(jid):
    return {"status_url":f"{PUBLIC_BASE}/status/{jid}","stream_url":f"{PUBLIC_BASE}/stream/{jid}",
            "latest_frame_url":f"{PUBLIC_BASE}/frames/{jid}/latest.jpg", "frames_url_template":f"{PUBLIC_BASE}/frames/{jid}/{{n}}.jpg",
            "mp4_url":f"{PUBLIC_BASE}/video/{jid}.mp4","camera_url":f"{PUBLIC_BASE}/render/{jid}/camera"}

def public(j):
    return {k:v for k,v in j.items() if not k.startswith("_") and k!="dir"}

def persist(j):atomic_json(Path(j["dir"])/"job.json",public(j))

def log_event(j,stage,data):
    ev={"utc":P.utc(),"stage":stage,"jobId":j["jobId"],"sceneId":j.get("sceneId"),"patchId":j.get("patchId"),"data":data}
    with LOCK:
        j["events"]=(j["events"]+[ev])[-120:]
        with open(Path(j["dir"])/"events.jsonl","a") as f:f.write(json.dumps(ev,allow_nan=False)+"\n")

def check_job(j):
    if j["_cancel"].is_set():raise CancelledError()
    scene=SCENES.get(j.get("sceneId"))
    if scene and scene["revision"]!=j["revision"]:raise CancelledError()

def ensure_pool():
    global POOL
    with LOCK:
        if POOL is None:
            try:devices=GPU.resolve_devices()
            except GPU.GPUError as exc:raise HTTPException(503,str(exc))
            if not Path(BLENDER).is_file():raise HTTPException(503,"Blender 4.2.3 executable unavailable")
            POOL=WorkerPool(devices,ROOT,BLENDER,int(os.environ.get("RENDER_WORKERS_PER_GPU","3")))
        return POOL

def new_job(request,kind="initial",parent=None):
    if not ADMISSION.acquire(blocking=False):raise HTTPException(429,"render job queue full; retry after a job completes")
    try:
        with LOCK:
            if len(JOBS)>=128:
                # Retain bounded in-memory metadata; finished jobs remain readable from disk.
                for key in list(JOBS):
                    if JOBS[key]["stage"] in TERMINAL:
                        JOBS.pop(key)
                        if len(JOBS)<128:break
            if len(JOBS)>=128:raise HTTPException(429,"active job capacity reached")
            jid=uuid.uuid4().hex[:20];directory=JOBS_DIR/jid;directory.mkdir(parents=True)
            j={"jobId":jid,"job_id":jid,"kind":kind,"parentJobId":parent,"illustrative":True,"label":LABEL,
               "schema":"geo-render-v2","created_utc":P.utc(),"request":request,"requestHash":G.digest(request),"revision":0,"stage":"queued","progress":0.,"frames_done":0,
               "frames":[],"events":[],"dir":str(directory),"_cancel":threading.Event(),"_started":time.monotonic(),**urls(jid)}
            (directory/"frames").mkdir();(directory/"staging").mkdir();JOBS[jid]=j;persist(j)
            return j
    except Exception:ADMISSION.release();raise

def response_job(j):
    return {k:v for k,v in public(j).items() if k in ("jobId","job_id","sceneId","patchId","revision","parentJobId","stage","pose","patch","illustrative","label") or k.endswith("_url") or k.endswith("_template")}

def publish(j,result,index,quality,pose):
    # This lock serializes revision admission and atomic image+manifest publication.
    with LOCK:
        check_job(j)
        if result["jobId"]!=j["jobId"] or result["sceneId"]!=j["sceneId"] or result["patchId"]!=j["patchId"] or result.get("jobHash")!=j.get("jobHash"):
            raise RuntimeError("worker source/job identity mismatch")
        source=Path(result["stagingPath"])
        if source.parent.resolve()!=(Path(j["dir"])/"staging").resolve():raise RuntimeError("untrusted worker output path")
        data=source.read_bytes()
        if hashlib.sha256(data).hexdigest()!=result["hash"]:raise RuntimeError("worker frame hash mismatch")
        with Image.open(io.BytesIO(data)) as image:
            if image.size!=(result["width"],result["height"]) or image.format!="JPEG":raise RuntimeError("invalid frame format")
            image.verify()
        filename=f"f_{index:04d}_{quality}.jpg";target=Path(j["dir"])/"frames"/filename
        os.replace(source,target)
        frame={k:v for k,v in result.items() if k not in ("stagingPath","requestId") and not (k=="sourceIds" and quality=="sequence")}
        # Source IDs are immutable per patch: keep a digest + count per frame, full list once in /patch.
        frame["sourceIdsSha256"]=hashlib.sha256(json.dumps(result.get("sourceIds") or [],separators=(",",":")).encode()).hexdigest()
        frame["sourceIdCount"]=len(result.get("sourceIds") or [])
        frame.update(id=result["frameId"],index=index,quality=quality,revision=j["revision"],
                     url=f"{PUBLIC_BASE}/frames/{j['jobId']}/file/{filename}")
        j["frames"].append(frame)
        prev=j.get("latestFrame")
        if not prev or index>=prev["index"]:j["latestFrame"]=frame;j["pose"]=pose
        if quality!="preview":j["frames_done"]+=1
        j["progress"]=min(1,j["frames_done"]/max(1,j["total_frames"]))
        now=time.monotonic()
        j["fps_sustained"]=round(j["frames_done"]/max(.001,now-j["_render_start"]),3)
        if quality=="sequence":
            seq=j.setdefault("_seq_times",[]);seq.append(now)
            if len(seq)>=3:j["fps_steady"]=round((len(seq)-1)/max(.001,seq[-1]-seq[0]),3)
            j["sequence_frames_published"]=len(seq)
            gpu=str((result.get("gpu") or {}).get("physicalIndex"))
            j.setdefault("frames_by_gpu",{});j["frames_by_gpu"][gpu]=j["frames_by_gpu"].get(gpu,0)+1
        j["unique_view_count"]=len({G.digest(f["pose"]) for f in j["frames"]})
        j["unique_views_per_second"]=round(j["unique_view_count"]/max(.001,time.monotonic()-j["_render_start"]),3)
        if "ttff_s" not in j:j["ttff_s"]=round(time.monotonic()-j["_started"],3)
        record=SCENES.get(j["sceneId"])
        if record and record["revision"]==j["revision"]:record["pose"]=pose
        compact={k:frame[k] for k in ("id","index","quality","hash","workerPid","renderSeconds","createdUtc") if k in frame}
        compact["gpu"]={k:(frame.get("gpu") or {}).get(k) for k in ("physicalIndex","uuid")}
        log_event(j,"frame_published",compact)
        # Sequence frames: persist job.json at most ~2x/s (it is a status snapshot; frames + events.jsonl are the record).
        if quality!="sequence" or now-j.get("_persisted_at",0)>.5 or j["frames_done"]>=j["total_frames"]:
            persist(j);j["_persisted_at"]=now

def frame_command(j,scene,pose,index,quality):
    width=frame_width(j,quality)
    fid=j["jobId"]+f"_{index:04d}_{quality}";stage=Path(j["dir"])/"staging"/(fid+".jpg")
    return {"requestId":uuid.uuid4().hex,"jobId":j["jobId"],"sceneId":j["sceneId"],"frameId":fid,"scenePath":j["_scene_path"],
             "cacheKey":scene["cacheKey"],"jobHash":j["jobHash"],"pose":pose,"width":width,"height":width*9//16,
             "samples":8 if quality=="preview" else min(SEQUENCE_SAMPLES,j["request"].get("samples") or SAMPLES) if quality=="sequence" else j["request"].get("samples") or SAMPLES,
             "stagingPath":str(stage)}

def render_sequence(j,scene,poses,first_index=2):
    """Shard the validated camera path across BOTH approved GPU workers.

    Up to 3 frames are in flight per worker; each worker keeps its own hot scene
    copy (first command builds it). Frames publish in completion order, every one
    individually verified (identity, hash, decode, GPU attestation)."""
    pool=ensure_pool();inflight={};nxt=0;window=max(2,3*len(pool.slots))
    def submit(i):
        cmd=frame_command(j,scene,poses[i],first_index+i,"sequence")
        # round-robin by index keeps both GPUs fed even before their scene caches warm
        slot=pool.slots[i%len(pool.slots)]
        fut=slot_submit(pool,slot,cmd,j["_cancel"])
        inflight[fut]=(i,cmd)
    from concurrent.futures import wait,FIRST_COMPLETED
    while nxt<len(poses) and len(inflight)<window:submit(nxt);nxt+=1
    while inflight:
        check_job(j)
        done,_=wait(list(inflight),timeout=1.0,return_when=FIRST_COMPLETED)
        for fut in done:
            i,cmd=inflight.pop(fut)
            result=fut.result()
            publish(j,result,first_index+i,"sequence",poses[i])
            if nxt<len(poses):submit(nxt);nxt+=1

def slot_submit(pool,slot,cmd,cancel):
    from concurrent.futures import Future
    import queue as _q
    future=Future()
    try:slot.queue.put_nowait((cmd,cancel,future));return future
    except _q.Full:return pool.submit(cmd,cancel)

def render_frame(j,scene,pose,index,quality):
    check_job(j)
    width=frame_width(j,quality)
    fid=j["jobId"]+f"_{index:04d}_{quality}";stage=Path(j["dir"])/"staging"/(fid+".jpg")
    command={"requestId":uuid.uuid4().hex,"jobId":j["jobId"],"sceneId":j["sceneId"],"frameId":fid,"scenePath":j["_scene_path"],
             "cacheKey":scene["cacheKey"],"jobHash":j["jobHash"],"pose":pose,"width":width,"height":width*9//16,
             "samples":8 if quality=="preview" else min(8,j["request"].get("samples") or SAMPLES) if quality=="sequence" else j["request"].get("samples") or SAMPLES,
             "stagingPath":str(stage)}
    result=ensure_pool().submit(command,j["_cancel"]).result(timeout=420)
    publish(j,result,index,quality,pose)

def prepare(j):
    request=j["request"];log=lambda stage,data:log_event(j,stage,data)
    j["stage"]="land_patch";focal=j["focal"];patch=j["patch"]
    osm=G.fetch_osm(patch,log);osm["patch"]=patch;check_job(j)
    feature=focal["verification"].get("featureId")
    if feature and focal["verification"].get("precision") in ("mapped-building-footprint","official-address-mapped-building") and feature not in patch["featureIds"]:
        raise G.GeographicError("verified_site_feature_missing_from_selected_patch")
    terrain=DEM.fetch_terrain(patch);check_job(j)
    osm["terrain"]=terrain
    G.drape_features(osm,terrain)
    try:sidewalks=G.derive_sidewalks(osm,terrain,patch)
    except Exception as exc:sidewalks=[];log("sidewalks_unavailable",{"error":type(exc).__name__+": "+str(exc)[:200]})
    try:
        img=IMG.patch_imagery(patch);log("imagery",{k:{x:img[k].get(x) for x in ("provider","zoom","tiles","width","height","sourceSha256","fetchSeconds")} for k in ("fine","context")})
    except Exception as exc:
        img=None;log("imagery_unavailable",{"error":type(exc).__name__+": "+str(exc)[:200]})
    j["imagery"]={k:{x:img[k].get(x) for x in ("provider","providerName","attribution","licence","zoom","tiles","sourceSha256","retrievedUtc","use")} for k in ("fine","context")} if img else {"status":"unavailable"}
    j["sidewalks"]={"count":len(sidewalks),"basis":"derived 2.4 m strips beside OSM drivable roads (approximate, not mapped)"}
    check_job(j)
    patch["osmPatchId"]=patch["id"]
    patch["id"]="patch_"+G.digest({"osm":patch["id"],"terrain":terrain["id"]})[:24]
    patch["elevation"]=terrain["elevation"]
    patch["origin"]["elevationM"]=terrain["originElevationM"]
    patch["provenance"].append(terrain["provenance"])
    patch["limitations"]=[x for x in patch.get("limitations",[]) if "flat local" not in x]+terrain["limitations"]
    for b in osm["buildings"]:
        b["z"]=max(Terrain.surface_height(terrain,x,y) for x,y in b["pts"])
        b["baseHeightBasis"]="maximum sampled DSM along footprint; approximate foundation, not a survey"
    patch["provenance"] += focal["verification"].get("provenance", [])
    transform=G.Frame(patch["origin"]["lat"],patch["origin"]["lon"])
    patch["features"] = []
    for kind in ("buildings","roads","water"):
        for item in osm[kind]:
            rings=[item["pts"]]+item.get("holes",[])
            coords=[[list(transform.inverse.transform(x,y)) for x,y in ring] for ring in rings]
            geometry={"type":"LineString","coordinates":coords[0]} if kind=="roads" else {"type":"Polygon","coordinates":[ring+[ring[0]] for ring in coords]}
            patch["features"].append({"type":"Feature","id":item["id"],"geometry":geometry,"localGeometry":{"type":"LineString" if kind=="roads" else "Polygon","coordinates":item["pts"] if kind=="roads" else [item["pts"]]+item.get("holes",[])},
                "properties":{"sourceId":item["sourceId"],"name":item.get("name") or item["sourceId"],"kind":kind,"height":item.get("height"),"width":item.get("width"),"widthApproximate":item.get("widthApproximate"),"groundingAvailable":item.get("groundingAvailable")}})

    j["patchId"]=patch["id"];j["land_patch"]={"source":"OpenStreetMap bounded geometry; no satellite substitute",
        "buildings":len(osm["buildings"]),"roads":len(osm["roads"]),"status":"ok"}
    persist(j);j["stage"]="scene_spec"
    seed=P.prompt_seed(request["prompt"]);j["seed"]=seed;j["prompt_hash"]=P.prompt_hash(request["prompt"])
    spec,model=P.ondemand_spec(request["prompt"],focal["name"],log);check_job(j)
    spec.update(seed=seed,prompt_hash=j["prompt_hash"],_prompt=request["prompt"])
    j["spec"]=spec;j["model"]=model;j["stage"]="placement"
    local=patch["localBounds"];half=min(local["maxX"]-local["minX"],local["maxY"]-local["minY"])/2
    instances,shapes,roads=P.place(spec,focal,osm,half,seed,log)
    ambient=[a for a in P.place_ambient(osm,seed) if all((a["x"]-i["x"])**2+(a["y"]-i["y"])**2>36 for i in instances)]
    j["scenery"]={"count":len(ambient),"by_asset":{k:sum(1 for a in ambient if a["asset"]==k) for k in sorted({a["asset"] for a in ambient})},
                  "licenses":sorted({a["license"] for a in ambient}),"illustrative":True}
    tod=request.get("time_of_day") or "auto"
    if tod=="auto":tod="night" if re.search("night",request["prompt"],re.I) else "dusk" if re.search("dusk|sunset|evening",request["prompt"],re.I) else "midday"
    total=min(MAX_FRAMES,request["duration_s"]*CAPTURE_FPS);fps=total/request["duration_s"]
    mode=request.get("camera_mode") or "street"
    layers={k:bool(v) for k,v in (request.get("layers") or {}).items() if k in ("imagery","buildings","roads","sidewalks","scenery","staging","skirt")}
    if layers.get("scenery") is False:ambient=[]
    if layers.get("sidewalks") is False:sidewalks=[]
    if layers.get("staging") is False:instances=[]
    if layers.get("imagery") is False:img=None
    j["layers"]={k:layers.get(k,True) for k in ("imagery","buildings","roads","sidewalks","scenery","staging","skirt")}
    scene=P.build_scene_json(j["jobId"],focal,spec,model,osm,img,instances,shapes,roads,tod,request["duration_s"],fps,[s.device for s in ensure_pool().slots],ambient,sidewalks,mode)
    scene["layers"]=j["layers"];scene["cacheKey"]=G.digest({"base":scene["cacheKey"],"layers":j["layers"]});scene["sceneId"]="scene_"+scene["cacheKey"][:24]
    pose=C.validate_pose(request["camera"],scene) if request.get("camera") else C.initial_pose(scene,mode)
    # The Blender scene keeps the initial pose so night lighting can be anchored around the camera/action.
    scene["camera"]={"position":pose["position"],"target":pose["target"]}
    if tod=="night":
        # Night lights are anchored on the camera: a different anchor is a different hot scene.
        scene["cacheKey"]=G.digest({"base":scene["cacheKey"],"nightAnchor":[round(float(v)) for v in pose["position"][:2]]});scene["sceneId"]="scene_"+scene["cacheKey"][:24]
    j["camera_mode"]={"requested":mode,"used":pose.get("mode","explicit"),"label":pose.get("modeLabel","explicit operator pose")};scene_path=Path(j["dir"])/"scene.json";atomic_json(scene_path,scene)
    with LOCK:
        check_job(j)
        # A fresh request owns a separate scene session even if content hashes match;
        # reusable Blender state is addressed by immutable cacheKey, not session ID.
        sid=scene["sceneId"]+"_"+j["jobId"];scene["sceneId"]=sid;atomic_json(scene_path,scene)
        j.update(sceneId=sid,patchId=patch["id"],pose=pose,total_frames=total,timeline_fps=fps,
                 references=scene["references"],time_of_day=tod,placement={"instances":len(instances),"items":[{"id":f"staged_{n}",**item} for n,item in enumerate(instances)],"by_asset":{a:sum(1 for i in instances if i["asset"]==a) for a in sorted({i["asset"] for i in instances})},"omissions":scene["placementOmissions"]})
        j["jobHash"]=G.digest({"request":request,"scene":scene["cacheKey"],"pose":pose,"revision":0})
        j["_scene_path"]=str(scene_path)
        SCENES[sid]={"scene":scene,"path":str(scene_path),"pose":pose,"revision":0,"jobId":j["jobId"]}
        if len(SCENES)>64:
            for key in list(SCENES):
                if key!=sid and not any(x.get("sceneId")==key and x["stage"] not in TERMINAL for x in JOBS.values()):SCENES.pop(key)
                if len(SCENES)<=64:break
    j["prep_s"]=round(time.monotonic()-j["_started"],3)
    return scene,pose

def encode(j):
    check_job(j)
    frames=[f for f in j["frames"] if f["quality"]!="preview"]
    if len(frames)<2:return
    directory=Path(j["dir"]);manifest=directory/"encode.txt"
    # concat supports mixed progressive frame sizes; the canvas is the dominant (sequence) width so
    # timeline frames are never upscaled (a lone 1280 hero still is letterboxed down instead).
    widths=[int(f.get("width") or 640) for f in frames]
    canvas_w=max(set(widths),key=widths.count);canvas_h=canvas_w*9//16
    lines=[]
    for frame in frames:
        name=f"frames/f_{frame['index']:04d}_{frame['quality']}.jpg"
        lines.extend(["file '"+name+"'", "duration "+str(1/j["timeline_fps"])])
    lines.append(lines[-2]);manifest.write_text("\n".join(lines)+"\n")
    part=directory/"video.part.mp4";j["stage"]="encode"
    cmd=["ffmpeg","-nostdin","-y","-loglevel","error","-f","concat","-safe","1","-i",str(manifest),
         "-vf",f"scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=decrease,pad={canvas_w}:{canvas_h}:(ow-iw)/2:(oh-ih)/2", "-r",str(j["timeline_fps"]),
         "-c:v","libx264","-threads","2","-preset","fast","-crf","22","-pix_fmt","yuv420p","-movflags","+faststart",str(part)]
    with open(directory/"encode.log","w") as log:
        proc=subprocess.Popen(cmd,stdout=log,stderr=log,env=dict(os.environ,CUDA_VISIBLE_DEVICES=""))
        try:
            deadline=time.monotonic()+120
            while proc.poll() is None:
                check_job(j)
                if time.monotonic()>deadline:raise TimeoutError("CPU export timeout")
                time.sleep(.1)
            if proc.returncode:raise RuntimeError("ffmpeg export failed; see encode.log")
        finally:
            if proc.poll() is None:proc.terminate();proc.wait(timeout=5)
    with LOCK:
        check_job(j);os.replace(part,directory/"video.mp4");j["mp4_bytes"]=(directory/"video.mp4").stat().st_size;j["encoder"]="libx264 (CPU encode only)"
        j["mp4_resolution"]=f"{canvas_w}x{canvas_h}"

def run_job(jid):
    j=JOBS[jid]
    try:
        check_job(j)
        if j["kind"]=="initial":scene,pose=prepare(j)
        else:scene=SCENES[j["sceneId"]]["scene"];pose=j["pose"]
        check_job(j);j["stage"]="render";j["_render_start"]=time.monotonic();persist(j)
        if j["kind"]=="initial":
            # Warm every other worker (scene build + OptiX attestation) while slot 0 renders the preview.
            pool=ensure_pool()
            for slot in pool.slots[1:]:
                warm=frame_command(j,scene,pose,0,"sequence");warm["warmOnly"]=True
                slot_submit(pool,slot,warm,j["_cancel"])
        render_frame(j,scene,pose,1,"preview")
        render_frame(j,scene,pose,1,"quality")
        if j["kind"]=="initial":
            step=(0.45 if pose.get("mode")=="street" else 0.7)*24/max(1,j["timeline_fps"])
            poses=C.sequence_poses(scene,pose,j["total_frames"]-1,step)
            if len(poses)<j["total_frames"]-1:
                j.setdefault("warnings",[]).append(f"Camera path stopped after {len(poses)+1} views at a geography/building boundary; no invented views or hidden buildings.")
                j["total_frames"]=len(poses)+1
            j["_seq_start"]=time.monotonic()
            render_sequence(j,scene,poses)
            j["sequence_wall_s"]=round(time.monotonic()-j["_seq_start"],3)
            if j["sequence_wall_s"]>0:j["fps_sequence_wall"]=round(len(poses)/j["sequence_wall_s"],3)
            encode(j)
        j["stage"]="complete" if j["frames_done"]==j["total_frames"] else "partial"
    except CancelledError:j["stage"]="cancelled"
    except Exception as exc:
        j["_cancel"].set();j["stage"]="failed";j["error"]=type(exc).__name__+": "+str(exc)[:400];log_event(j,"error",{"error":j["error"]})
    finally:
        with LOCK:
            j["finished_utc"]=P.utc();j["wall_clock_total_s"]=round(time.monotonic()-j["_started"],3)
            log_event(j,"done",{"stage":j["stage"],"frames":j["frames_done"],"uniqueViewsPerSecond":j.get("unique_views_per_second")});persist(j)
        ADMISSION.release()

@app.post("/render",dependencies=[Depends(auth)])
@app.post("/render/start",dependencies=[Depends(auth)])
def render(body:RenderBody):
    try:
        focal=G.resolve_location(body.prompt,body.lat,body.lon,body.locationVerification,body.selectedCoordinates)
        patch=G.make_patch(focal,body.aoi,half_m=body.radius_m)
    except G.GeographicError as exc:raise HTTPException(422,str(exc))
    ensure_pool();j=new_job(body.model_dump());j.update(focal=focal,patch=patch)
    COORDINATORS.submit(run_job,j["jobId"])
    return response_job(j)


def valid_id(jid):
    if not re.fullmatch(r"[a-f0-9]{12,20}",jid):raise HTTPException(404,"unknown job")

def get_job(jid):
    valid_id(jid)
    with LOCK:
        if jid in JOBS:return JOBS[jid]
    path=JOBS_DIR/jid/"job.json"
    if not path.is_file():raise HTTPException(404,"unknown job")
    stored=json.loads(path.read_text())
    if stored.get("schema")!="geo-render-v2":raise HTTPException(410,"legacy unverified render; start a source-verified scene")
    return stored

@app.post("/render/{jid}/camera",dependencies=[Depends(auth)])
def camera_update(jid:str,body:CameraBody):
    parent=get_job(jid)
    with LOCK:
        record=SCENES.get(parent.get("sceneId"))
        if not record:raise HTTPException(409,"scene not ready or evicted; start a new render")
        if body.revision<=record["revision"]:raise HTTPException(409,"stale camera revision")
        try:pose=C.move(record["pose"],body.model_dump(exclude_none=True),record["scene"])
        except C.CameraError as exc:raise HTTPException(422,str(exc))
        j=new_job(parent["request"],"camera",parent=jid)
        j.update(sceneId=parent["sceneId"],patchId=record["scene"]["patch"]["id"],patch=record["scene"]["patch"],
                 pose=pose,revision=body.revision,total_frames=1,timeline_fps=1,_scene_path=record["path"])
        for key in ("spec","model","focal","land_patch","references","placement","time_of_day"):
            if key in parent:j[key]=parent[key]
        j["jobHash"]=G.digest({"request":j["request"],"scene":record["scene"]["cacheKey"],"pose":pose,"revision":body.revision})
        record.update(revision=body.revision,pose=pose,jobId=j["jobId"])
        for other in JOBS.values():
            if other["jobId"]!=j["jobId"] and other.get("sceneId")==j["sceneId"] and other["stage"] not in TERMINAL:other["_cancel"].set()
        persist(j)
    COORDINATORS.submit(run_job,j["jobId"])
    return response_job(j)

@app.post("/render/{jid}/cancel",dependencies=[Depends(auth)])
def cancel(jid:str):
    j=get_job(jid)
    with LOCK:
        if j.get("_cancel") is not None and j["stage"] not in TERMINAL:j["_cancel"].set()
    return {"jobId":jid,"cancelRequested":True,"stage":j["stage"]}

@app.get("/status/{jid}",dependencies=[Depends(auth)])
def status(jid:str, details:bool=False):
    with LOCK:
        j=get_job(jid);out=public(j);out.pop("events",None);out["events_tail"]=j.get("events",[])[-6:]
        if not details:
            # Geometry is immutable per patch and loaded once via /patch. Never
            # retransmit thousands of source IDs inside every frame and event.
            patch=dict(out.get("patch") or {})
            patch.pop("features",None)
            patch["provenance"]=[{k:v for k,v in source.items() if k!="versions"} for source in patch.get("provenance",[])]
            out["patch"]=patch
            def compact(frame):
                return {k:v for k,v in frame.items() if k not in ("sourceIds","cacheKey")}
            out["frames"]=[compact(f) for f in out.get("frames",[])]
            if out.get("latestFrame"):out["latestFrame"]=compact(out["latestFrame"])
            out["events_tail"]=[{**ev,"data":compact(ev["data"])} for ev in out["events_tail"]]
        return out

@app.get("/patch/{jid}",dependencies=[Depends(auth)])
def get_patch(jid:str):
    j=get_job(jid)
    return j.get("patch", {})

@app.get("/jobs",dependencies=[Depends(auth)])
def jobs():
    with LOCK:return [{k:j.get(k) for k in ("jobId","job_id","stage","sceneId","patchId","revision","progress","created_utc","ttff_s","fps_sustained")} for j in JOBS.values()]


def frame_path(jid,frame):return JOBS_DIR/jid/"frames"/Path(frame["url"]).name

def frame_headers(frame):
    return {"Cache-Control":"no-store","X-Illustrative":"true","X-Frame-Id":frame["id"],"X-Frame-SHA256":frame["hash"],
            "X-Frame-Created-Utc":frame["createdUtc"],"X-Scene-Id":frame["sceneId"],"X-Patch-Id":frame["patchId"],"X-Camera-Revision":str(frame["revision"])}

@app.get("/frames/{jid}/latest.jpg",dependencies=[Depends(auth)])
def latest(jid:str):
    j=get_job(jid);frame=j.get("latestFrame")
    if not frame:raise HTTPException(404,"no published frame yet")
    return FileResponse(frame_path(jid,frame),media_type="image/jpeg",headers=frame_headers(frame))

@app.get("/frames/{jid}/file/{name}",dependencies=[Depends(auth)])
def immutable_frame(jid:str,name:str):
    j=get_job(jid);frame=next((f for f in j["frames"] if Path(f["url"]).name==name),None)
    if not frame:raise HTTPException(404,"unknown frame")
    return FileResponse(frame_path(jid,frame),media_type="image/jpeg",headers=frame_headers(frame))

@app.get("/frames/{jid}/{n}.jpg",dependencies=[Depends(auth)])
def jpeg_frame(jid:str,n:int):
    j=get_job(jid);frame=next((f for f in reversed(j["frames"]) if f["index"]==n),None)
    if not frame:raise HTTPException(404,"frame not published")
    return FileResponse(frame_path(jid,frame),media_type="image/jpeg",headers=frame_headers(frame))

@app.get("/frames/{jid}/{n}.png",dependencies=[Depends(auth)])
def legacy_frame(jid:str,n:int):
    j=get_job(jid);frame=next((f for f in reversed(j["frames"]) if f["index"]==n),None)
    if not frame:raise HTTPException(404,"frame not published")
    buf=io.BytesIO()
    with Image.open(frame_path(jid,frame)) as image:image.save(buf,"PNG")
    headers=frame_headers(frame);headers["X-Source-JPEG-SHA256"]=headers.pop("X-Frame-SHA256")
    headers["X-Frame-SHA256"]=hashlib.sha256(buf.getvalue()).hexdigest()
    return Response(buf.getvalue(),media_type="image/png",headers=headers)

@app.get("/video/{jid}.mp4",dependencies=[Depends(auth)])
def video(jid:str):
    j=get_job(jid);path=JOBS_DIR/jid/"video.mp4"
    if j["stage"] not in ("complete","partial") or not path.is_file():raise HTTPException(404,"video not ready")
    return FileResponse(path,media_type="video/mp4",headers={"X-Illustrative":"true","X-Timeline-FPS":str(j["timeline_fps"]),"X-Rendered-FPS":str(j.get("fps_sustained",0))})

@app.get("/stream/{jid}",dependencies=[Depends(auth)])
async def stream(jid:str):
    get_job(jid)
    async def generate():
        last=None
        while True:
            j=get_job(jid);frame=j.get("latestFrame")
            if frame and frame["id"]!=last:
                data=frame_path(jid,frame).read_bytes();last=frame["id"]
                yield (b"--frame\r\nContent-Type: image/jpeg\r\nX-Frame-Id: "+last.encode()+b"\r\nX-Frame-SHA256: "+frame["hash"].encode()+
                       b"\r\nContent-Length: "+str(len(data)).encode()+b"\r\n\r\n"+data+b"\r\n")
            if j["stage"] in TERMINAL:break
            await asyncio.sleep(.03)
    return StreamingResponse(generate(),media_type="multipart/x-mixed-replace; boundary=frame",headers={"Cache-Control":"no-store","X-Illustrative":"true"})

@app.get("/gpu-evidence",dependencies=[Depends(auth)])
def gpu_evidence():
    """Read-only nvidia-smi snapshot correlated with this service's Blender worker PIDs."""
    def q(args):
        r=subprocess.run(["nvidia-smi",*args,"--format=csv,noheader"],capture_output=True,text=True,timeout=8)
        return [[c.strip() for c in line.split(",")] for line in r.stdout.strip().splitlines() if line.strip()]
    try:
        gpus=[{"index":r[0],"uuid":r[1],"pciBusId":r[2],"name":r[3],"utilizationPct":r[4],"memoryUsedMiB":r[5]} for r in q(["--query-gpu=index,uuid,pci.bus_id,name,utilization.gpu,memory.used"])]
        apps=[{"pid":int(r[0]),"gpuUuid":r[1],"processName":r[2],"usedMemoryMiB":r[3]} for r in q(["--query-compute-apps=pid,gpu_uuid,process_name,used_memory"])]
    except Exception as exc:
        raise HTTPException(503,"nvidia-smi unavailable: "+type(exc).__name__)
    workers=POOL.status() if POOL else []
    pids={w["pid"]:w["device"] for w in workers if w.get("pid")}
    ours=[dict(a,physicalIndex=pids[a["pid"]]["physicalIndex"]) for a in apps if a["pid"] in pids]
    allowed={u for u,_ in GPU.ALLOWED.values()}
    return {"utc":P.utc(),"workerPids":sorted(pids),"rendererProcesses":ours,
            "rendererGpuUuids":sorted({a["gpuUuid"] for a in ours}),
            "violations":[a for a in ours if a["gpuUuid"] not in allowed],
            "missingWorkerPidsInNvidiaSmi":sorted(set(pids)-{a["pid"] for a in ours}),
            "gpus":gpus,"allowedGpuUuids":sorted(allowed),
            "note":"Other processes on non-approved GPUs belong to unrelated workloads and are not used by this renderer."}

@app.get("/health")
def health():
    try:devices=GPU.resolve_devices();policy_error=None
    except GPU.GPUError as exc:devices=[];policy_error=str(exc)
    workers=POOL.status() if POOL else []
    return {"ok":bool(devices) and bool(TOKEN) and Path(BLENDER).is_file() and bool(P.ASSET_KEYS),"service":"gods-eye-view-render","utc":P.utc(),"sourceVersion":SOURCE_VERSION,"buildReference":os.environ.get("GEV_SERVICE_REVISION","unrecorded"),
            "gpus":[str(d["physicalIndex"]) for d in devices],"gpu_policy":{"allowed":[2,6],"resolved":devices,"backend":"OPTIX","cpuRendering":False,
             "visibility":"UUID per worker","error":policy_error,"verification":"Cycles PCI device attested on each render; see frame.gpu"},
            "workers":workers,"fps":CAPTURE_FPS,"fpsMeaning":"export timeline, not a realtime render claim","resolutions":[[w,w*9//16] for w in WIDTHS],"defaults":{"preview":[PREVIEW_WIDTH,PREVIEW_WIDTH*9//16],"quality":[QUALITY_WIDTH,QUALITY_WIDTH*9//16],"sequence":[SEQUENCE_WIDTH,SEQUENCE_WIDTH*9//16]},
            "samples":SAMPLES,"blender":Path(BLENDER).is_file(),"assets":len(P.ASSET_KEYS),"jobs":len(JOBS),"illustrative":True,"label":LABEL}

@app.get("/")
def index():
    return {"service":"gods-eye-view render service","label":LABEL,"endpoints":["POST /render/start","POST /render/{id}/camera","POST /render/{id}/cancel","/status/{id}","/frames/{id}/latest.jpg","/stream/{id}"]}

def shutdown():
    with LOCK:
        for j in JOBS.values():j["_cancel"].set()
    COORDINATORS.shutdown(wait=False,cancel_futures=True)
    if POOL:POOL.close()
