"""Gods-Eye View hyper-real render service (runs on the H100 host).

GET  /health                        no auth
POST /render                        {prompt, lat?, lng?, time_of_day?, duration_s=60}  -> {job_id}
GET  /status/{job_id}               stage, progress, metrics, urls
GET  /stream/{job_id}               multipart/x-mixed-replace MJPEG of the newest rendered frame
GET  /frames/{job_id}/{n}.png       rendered frame n (1-based)
GET  /frames/{job_id}/latest.jpg    newest frame as JPEG
GET  /video/{job_id}.mp4            NVENC-encoded 60 s sequence (when complete)
GET  /jobs                          list

Auth: Authorization: Bearer <RENDER_SERVICE_TOKEN> on everything except /health
(and the GET media routes also accept ?token= so <img>/<video> tags can load them).
Every response carries illustrative:true / label "Illustrative render · not evidence".
"""
from __future__ import annotations
import asyncio, json, os, re, shutil, subprocess, threading, time, uuid, glob
from typing import Optional
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import pipeline as P

ROOT = os.environ.get("GEV_ROOT", "/localstorage/mk.thomas/gev")
JOBS_DIR = os.path.join(ROOT, "jobs"); os.makedirs(JOBS_DIR, exist_ok=True)
BLENDER = os.path.join(ROOT, "blender-4.2.3-linux-x64", "blender")
TOKEN = os.environ.get("RENDER_SERVICE_TOKEN", "")
GPUS = [g for g in os.environ.get("RENDER_GPUS", "2,6").split(",") if g.strip()]
FPS = int(os.environ.get("RENDER_FPS", "24"))
SAMPLES = int(os.environ.get("RENDER_SAMPLES", "24"))
RES_W, RES_H = [int(v) for v in os.environ.get("RENDER_RES", "1280x720").split("x")]
PUBLIC_BASE = os.environ.get("RENDER_PUBLIC_BASE", "")
LABEL = "Illustrative render · not evidence"

app = FastAPI(title="gods-eye-view render service", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
JOBS: dict[str, dict] = {}
LOCK = threading.Lock()

def auth(request: Request):
    if not TOKEN: return
    h = request.headers.get("authorization", "")
    tok = h[7:] if h.lower().startswith("bearer ") else request.query_params.get("token", "")
    if tok != TOKEN: raise HTTPException(401, "invalid bearer token")

class RenderBody(BaseModel):
    prompt: str = Field(min_length=3, max_length=600)
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lng: Optional[float] = Field(default=None, ge=-180, le=180)
    time_of_day: Optional[str] = Field(default=None, pattern="^(dusk|night|midday|auto)$")
    duration_s: int = Field(default=60, ge=2, le=120)
    samples: Optional[int] = Field(default=None, ge=4, le=256)

def job_urls(jid):
    b = PUBLIC_BASE.rstrip("/")
    return {"status_url": f"{b}/status/{jid}", "stream_url": f"{b}/stream/{jid}", "latest_frame_url": f"{b}/frames/{jid}/latest.jpg",
            "frames_url_template": f"{b}/frames/{jid}/{{n}}.png", "mp4_url": f"{b}/video/{jid}.mp4"}

def public(j):
    d = {k: v for k, v in j.items() if k not in ("_thread",)}
    return d

def log_event(j, stage, data):
    ev = {"utc": P.utc(), "stage": stage, "data": data}
    j["events"].append(ev)
    with open(os.path.join(j["dir"], "events.jsonl"), "a") as f: f.write(json.dumps(ev) + "\n")

def nvidia_sample():
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=index,utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=5).stdout
        rows = []
        for ln in out.strip().splitlines():
            i, u, m, t = [x.strip() for x in ln.split(",")]
            if i in GPUS: rows.append({"gpu": int(i), "util_pct": int(u), "mem_used_mib": int(m), "mem_total_mib": int(t)})
        return rows
    except Exception as e:
        return [{"error": str(e)}]

def run_job(jid):
    j = JOBS[jid]; d = j["dir"]; L = lambda s, x: log_event(j, s, x)
    t_start = time.time()
    try:
        j["stage"] = "geocode"
        focal = P.geocode(j["request"]["prompt"], j["request"].get("lat"), j["request"].get("lng"), L)
        j["focal"] = focal
        tod = j["request"].get("time_of_day") or "auto"
        if tod == "auto":
            tod = "night" if re.search(r"night", j["request"]["prompt"], re.I) else "dusk" if re.search(r"dusk|sunset|evening", j["request"]["prompt"], re.I) else "midday"
        j["time_of_day"] = tod
        j["stage"] = "land_patch"
        half = 260.0
        img = P.imagery_patch(focal["lat"], focal["lon"], half, os.path.join(d, "imagery.png"), log=L)
        osm = P.osm_features(focal["lat"], focal["lon"], half, log=L)
        j["land_patch"] = {"source": "Esri World Imagery tiles + OSM buildings/roads via Overpass (no Google Maps key on host)", "half_extent_m": half,
                           "buildings": len(osm["buildings"]), "roads": len(osm["highways"]), "overpass": osm["status"], "tiles_ok": img["tiles_ok"]}
        j["stage"] = "scene_spec"
        spec, model = P.ondemand_spec(j["request"]["prompt"], focal["name"], L)
        j["spec"] = spec; j["model"] = model
        j["stage"] = "placement"
        inst, shapes, roads = P.place(spec, focal, osm, half, seed=jid, log=L)
        scene = P.build_scene_json(jid, focal, spec, model, osm, img, inst, shapes, roads, tod, j["request"]["duration_s"], FPS, GPUS)
        scene_path = os.path.join(d, "scene.json"); json.dump(scene, open(scene_path, "w"))
        j["placement"] = {"instances": len(inst), "by_asset": {k: sum(1 for i in inst if i["asset"] == k) for k in sorted({i["asset"] for i in inst})}}
        j["prep_s"] = round(time.time() - t_start, 2)
        # ---- render: shard the frame range across GPUs, interleaved so early frames arrive first on every GPU
        j["stage"] = "render"
        total = j["request"]["duration_s"] * FPS; j["total_frames"] = total
        frames_dir = os.path.join(d, "frames"); os.makedirs(frames_dir, exist_ok=True)
        samples = j["request"].get("samples") or SAMPLES
        procs = []
        # contiguous shards per GPU, but first shard is tiny (first frames) to minimise time-to-first-frame
        n = len(GPUS); per = total // n
        ranges = []
        for gi in range(n):
            a = gi * per + 1; b = total if gi == n - 1 else (gi + 1) * per
            ranges.append((a, b))
        # split GPU0's range into a 1-frame warm shard + remainder so frame 1 lands ASAP
        a, b = ranges[0]; ranges = [(a, a)] + ([(a + 1, b)] if b > a else []) + ranges[1:]
        gpu_for = [GPUS[0], GPUS[0]] + GPUS[1:] if len(ranges) > n else GPUS[:len(ranges)]
        j["shards"] = []
        sample_thread_stop = threading.Event(); samples_log = []
        def sampler():
            while not sample_thread_stop.is_set():
                samples_log.append({"utc": P.utc(), "t": round(time.time() - t_start, 1), "gpus": nvidia_sample()}); time.sleep(2)
        threading.Thread(target=sampler, daemon=True).start()
        t_render = time.time()
        def launch(rng, gpu):
            env = dict(os.environ, CUDA_VISIBLE_DEVICES=str(gpu))
            lf = open(os.path.join(d, f"blender_{rng[0]}_{rng[1]}.log"), "w")
            p = subprocess.Popen([BLENDER, "-b", "--factory-startup", "-noaudio", "-P", os.path.join(os.path.dirname(__file__), "blender_scene.py"), "--",
                                  scene_path, frames_dir, str(rng[0]), str(rng[1]), str(samples), str(RES_W), str(RES_H)], env=env, stdout=lf, stderr=subprocess.STDOUT)
            j["shards"].append({"frames": list(rng), "gpu": gpu, "pid": p.pid, "started_utc": P.utc()})
            return p
        # run the warm shard and the big shards concurrently (warm shard on GPU0 first, remainder of GPU0 queued after it)
        queue0 = [r for r, g in zip(ranges, gpu_for) if g == GPUS[0]]
        others = [(r, g) for r, g in zip(ranges, gpu_for) if g != GPUS[0]]
        procs = [launch(r, g) for r, g in others]
        def gpu0_chain():
            for r in queue0:
                p = launch(r, GPUS[0]); p.wait()
        th0 = threading.Thread(target=gpu0_chain); th0.start()
        first_seen = None
        while True:
            done = sorted(glob.glob(os.path.join(frames_dir, "f_*.png")))
            j["frames_done"] = len(done); j["progress"] = round(len(done) / total, 3)
            if done and first_seen is None:
                first_seen = time.time(); j["ttff_s"] = round(first_seen - t_start, 2); j["ttff_render_only_s"] = round(first_seen - t_render, 2)
                L("first_frame", {"ttff_s": j["ttff_s"], "frame": os.path.basename(done[0])})
            if not th0.is_alive() and all(p.poll() is not None for p in procs): break
            time.sleep(1)
        sample_thread_stop.set()
        done = sorted(glob.glob(os.path.join(frames_dir, "f_*.png"))); j["frames_done"] = len(done)
        j["wall_clock_render_s"] = round(time.time() - t_render, 2); j["wall_clock_total_s"] = round(time.time() - t_start, 2)
        j["fps_sustained"] = round(len(done) / max(0.001, j["wall_clock_render_s"]), 3)
        j["realtime_factor"] = round(j["fps_sustained"] / FPS, 4)
        json.dump(samples_log, open(os.path.join(d, "nvidia-smi-samples.json"), "w"))
        def agg(rows):
            if not rows: return None
            return {"util_pct_mean": round(sum(r["util_pct"] for r in rows) / len(rows), 1), "util_pct_max": max(r["util_pct"] for r in rows),
                    "mem_used_mib_max": max(r["mem_used_mib"] for r in rows), "mem_total_mib": rows[0]["mem_total_mib"], "samples": len(rows)}
        j["gpu_metrics"] = {str(g): agg([r for s in samples_log for r in s["gpus"] if r.get("gpu") == int(g)]) for g in GPUS}
        for lf in glob.glob(os.path.join(d, "blender_*.log")):
            for ln in open(lf, errors="ignore"):
                if ln.startswith("SCENE_READY") or ln.startswith("SHARD_DONE"): L("blender", {"log": os.path.basename(lf), "line": ln.strip()[:300]})
        if len(done) < total:
            j["warnings"] = j.get("warnings", []) + [f"only {len(done)}/{total} frames rendered; see blender logs"]
        # ---- encode
        j["stage"] = "encode"
        mp4 = os.path.join(d, "video.mp4"); t_enc = time.time()
        enc = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", os.path.join(frames_dir, "f_%04d.png"),
               "-c:v", "h264_nvenc", "-preset", "p4", "-b:v", "8M", "-pix_fmt", "yuv420p", mp4]
        r = subprocess.run(enc, capture_output=True, text=True, env=dict(os.environ, CUDA_VISIBLE_DEVICES=str(GPUS[0])))
        if r.returncode != 0:
            L("encode", {"nvenc_error": r.stderr[-300:], "fallback": "libx264"})
            enc[enc.index("h264_nvenc")] = "libx264"; enc.remove("-preset"); enc.remove("p4")
            r = subprocess.run(enc, capture_output=True, text=True)
            j["encoder"] = "libx264 (NVENC failed)"
        else:
            j["encoder"] = "h264_nvenc p4 8 Mbps"
        j["encode_s"] = round(time.time() - t_enc, 2)
        j["mp4_bytes"] = os.path.getsize(mp4) if os.path.exists(mp4) else 0
        j["stage"] = "complete" if j["mp4_bytes"] and len(done) >= total else "partial"
        j["finished_utc"] = P.utc()
        L("done", {"stage": j["stage"], "frames": len(done), "ttff_s": j.get("ttff_s"), "fps_sustained": j["fps_sustained"], "mp4_bytes": j["mp4_bytes"]})
    except Exception as e:
        j["stage"] = "failed"; j["error"] = f"{type(e).__name__}: {e}"[:500]; j["finished_utc"] = P.utc(); L("error", {"error": j["error"]})
    finally:
        json.dump(public(j), open(os.path.join(d, "job.json"), "w"), indent=1, default=str)

@app.get("/health")
def health():
    return {"ok": True, "service": "gods-eye-view-render", "utc": P.utc(), "gpus": GPUS, "fps": FPS, "resolution": [RES_W, RES_H], "samples": SAMPLES,
            "blender": os.path.exists(BLENDER), "assets": len(P.ASSET_KEYS), "ondemand_configured": bool(os.environ.get("ONDEMAND_API_KEY")),
            "nvidia": nvidia_sample(), "jobs": len(JOBS), "illustrative": True, "label": LABEL}

@app.post("/render", dependencies=[Depends(auth)])
def render(body: RenderBody):
    jid = uuid.uuid4().hex[:12]; d = os.path.join(JOBS_DIR, jid); os.makedirs(d, exist_ok=True)
    j = {"job_id": jid, "illustrative": True, "label": LABEL, "created_utc": P.utc(), "request": body.model_dump(), "stage": "queued", "progress": 0.0,
         "frames_done": 0, "events": [], "dir": d, **job_urls(jid)}
    with LOCK: JOBS[jid] = j
    th = threading.Thread(target=run_job, args=(jid,), daemon=True); th.start()
    return {"job_id": jid, "illustrative": True, "label": LABEL, **job_urls(jid)}

@app.get("/jobs", dependencies=[Depends(auth)])
def jobs():
    return [{k: j.get(k) for k in ("job_id", "stage", "progress", "created_utc", "ttff_s", "fps_sustained")} for j in JOBS.values()]

def get_job(jid):
    j = JOBS.get(jid)
    if not j:
        p = os.path.join(JOBS_DIR, jid, "job.json")
        if os.path.exists(p): return json.load(open(p))
        raise HTTPException(404, "unknown job")
    return public(j)

@app.get("/status/{jid}", dependencies=[Depends(auth)])
def status(jid: str):
    j = get_job(jid)
    out = {k: v for k, v in j.items() if k not in ("events", "dir")}
    out["events_tail"] = j.get("events", [])[-6:]
    return out

def frame_paths(jid):
    return sorted(glob.glob(os.path.join(JOBS_DIR, jid, "frames", "f_*.png")))

@app.get("/frames/{jid}/latest.jpg", dependencies=[Depends(auth)])
def latest(jid: str):
    fr = frame_paths(jid)
    if not fr: raise HTTPException(404, "no frame yet")
    from PIL import Image; import io
    im = Image.open(fr[-1]).convert("RGB"); buf = io.BytesIO(); im.save(buf, "JPEG", quality=85)
    return StreamingResponse(iter([buf.getvalue()]), media_type="image/jpeg", headers={"Cache-Control": "no-store", "X-Illustrative": "true"})

@app.get("/frames/{jid}/{n}.png", dependencies=[Depends(auth)])
def frame(jid: str, n: int):
    p = os.path.join(JOBS_DIR, jid, "frames", f"f_{n:04d}.png")
    if not os.path.exists(p): raise HTTPException(404, "frame not rendered")
    return FileResponse(p, media_type="image/png", headers={"X-Illustrative": "true"})

@app.get("/video/{jid}.mp4", dependencies=[Depends(auth)])
def video(jid: str):
    p = os.path.join(JOBS_DIR, jid, "video.mp4")
    if not os.path.exists(p): raise HTTPException(404, "video not ready")
    return FileResponse(p, media_type="video/mp4", headers={"X-Illustrative": "true"})

@app.get("/stream/{jid}", dependencies=[Depends(auth)])
async def stream(jid: str):
    """MJPEG: pushes the newest rendered frame whenever it changes (max 10 Hz); ends when the job finishes."""
    from PIL import Image; import io
    async def gen():
        last = None; idle = 0
        while True:
            fr = frame_paths(jid); j = JOBS.get(jid) or {}
            if fr and fr[-1] != last:
                last = fr[-1]
                try:
                    im = Image.open(last).convert("RGB"); buf = io.BytesIO(); im.save(buf, "JPEG", quality=80); b = buf.getvalue()
                    yield b"--frame\r\nContent-Type: image/jpeg\r\nX-Frame: " + os.path.basename(last).encode() + b"\r\nContent-Length: " + str(len(b)).encode() + b"\r\n\r\n" + b + b"\r\n"
                except Exception: pass
                idle = 0
            else:
                idle += 1
            if j.get("stage") in ("complete", "partial", "failed") and (not fr or fr[-1] == last) and idle > 20: break
            await asyncio.sleep(0.1)
    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame", headers={"Cache-Control": "no-store", "X-Illustrative": "true"})

@app.get("/")
def index():
    return JSONResponse({"service": "gods-eye-view render service", "label": LABEL, "endpoints": ["/health", "POST /render", "/status/{id}", "/stream/{id}", "/frames/{id}/{n}.png", "/video/{id}.mp4"]})
