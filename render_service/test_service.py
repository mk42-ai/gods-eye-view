"""API tests use a fake worker and fixture bytes, not claims of real GPU renders."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import threading
import time
from concurrent.futures import Future, CancelledError
from types import SimpleNamespace as NS
from unittest.mock import Mock
import pytest
from fastapi.testclient import TestClient
from PIL import Image
sys.path.insert(0,str(Path(__file__).parent))
os.environ.setdefault("GEV_ROOT",str(Path(__file__).resolve().parents[1]))
import app as A
import camera as C
import geography as G
from test_geography import focal, patch, source

class Executor:
    def __init__(self):self.calls=[]
    def submit(self,*args):self.calls.append(args)

@pytest.fixture
def setup(monkeypatch,tmp_path):
    monkeypatch.setattr(A,"TOKEN","test-credential-not-production")
    monkeypatch.setattr(A,"JOBS_DIR",tmp_path)
    monkeypatch.setattr(A,"JOBS",{})
    monkeypatch.setattr(A,"SCENES",{})
    monkeypatch.setattr(A,"ADMISSION",threading.BoundedSemaphore(12))
    executor=Executor();monkeypatch.setattr(A,"COORDINATORS",executor)
    pool=NS(slots=[]);monkeypatch.setattr(A,"ensure_pool",lambda:pool)
    return TestClient(A.app),{"Authorization":"Bearer test-credential-not-production"},executor

def ready_parent():
    j=A.new_job({"prompt":"selected road","duration_s":2,"samples":8})
    p=patch();p.update(id="patch_test",featureIds=["way/10"],provenance=[])
    scene={"sceneId":"scene_test","cacheKey":"a"*64,"patch":p,"buildings":[],"roads":[],"instances":[]}
    pose=C.initial_pose(scene)
    j.update(sceneId="scene_test",jobHash="b"*64,patchId=p["id"],patch=p,pose=pose,total_frames=2,_render_start=time.monotonic())
    A.SCENES["scene_test"]={"scene":scene,"path":str(Path(j["dir"])/"scene.json"),"pose":pose,"revision":0,"jobId":j["jobId"]}
    return j,scene

def frame_result(j,scene,quality="quality"):
    buf=io.BytesIO();Image.new("RGB",(640,360),(64,96,128)).save(buf,"JPEG");data=buf.getvalue()
    path=Path(j["dir"])/"staging"/"fixture.jpg";path.write_bytes(data)
    return {"jobId":j["jobId"],"sceneId":scene["sceneId"],"patchId":scene["patch"]["id"],"stagingPath":str(path),
            "jobHash":j["jobHash"],"frameId":j["jobId"]+"_1_"+quality,"hash":hashlib.sha256(data).hexdigest(),"width":640,"height":360,
            "createdUtc":G.utc(),"pose":j["pose"],"sourceIds":["way/10"],"workerPid":1234,"gpu":{"fixture":True}}

def test_auth_is_fail_closed(setup,monkeypatch):
    client,headers,_=setup
    assert client.get("/jobs").status_code==401
    monkeypatch.setattr(A,"TOKEN","")
    assert client.get("/jobs",headers=headers).status_code==503

@pytest.mark.parametrize("endpoint",["/render","/render/start"])
def test_render_rejects_city_guess_before_admission(setup,endpoint):
    client,headers,executor=setup
    res=client.post(endpoint,headers=headers,json={"prompt":"raid at Kane's gym Abu Dhabi"})
    assert res.status_code==422 and not executor.calls and not A.JOBS

@pytest.mark.parametrize("endpoint",["/render","/render/start"])
def test_explicit_location_alias_preserved(setup,endpoint):
    client,headers,executor=setup
    res=client.post(endpoint,headers=headers,json={"prompt":"selected road","lat":24.4886,"lng":54.6085,"selectedCoordinates":True})
    assert res.status_code==200
    payload=res.json();assert payload["job_id"]==payload["jobId"] and "patch" in payload
    assert executor.calls and payload["patch"]["verification"]["source"]=="user-selected-coordinates"

def test_disagreeing_longitude_aliases_rejected(setup):
    client,headers,_=setup
    assert client.post("/render",headers=headers,json={"prompt":"test","lat":24,"lng":54,"lon":55,"selectedCoordinates":True}).status_code==422

def test_camera_new_job_reuses_scene_and_cancels_stale(setup):
    client,headers,executor=setup;j,scene=ready_parent()
    response=client.post(f"/render/{j['jobId']}/camera",headers=headers,json={"action":"orbit-left","revision":1})
    assert response.status_code==200
    data=response.json();assert data["jobId"]!=j["jobId"] and data["sceneId"]==j["sceneId"] and data["patchId"]==j["patchId"]
    assert j["_cancel"].is_set() and data["pose"]["position"]!=j["pose"]["position"]
    assert client.post(f"/render/{j['jobId']}/camera",headers=headers,json={"action":"orbit-right","revision":1}).status_code==409

def test_invalid_camera_does_not_advance_revision(setup):
    client,headers,_=setup;j,_=ready_parent()
    res=client.post(f"/render/{j['jobId']}/camera",headers=headers,json={"position":[9999,0,50],"target":[0,0,0],"revision":1})
    assert res.status_code==422 and A.SCENES[j["sceneId"]]["revision"]==0 and not j["_cancel"].is_set()

def test_camera_body_mutually_exclusive(setup):
    client,headers,_=setup;j,_=ready_parent()
    assert client.post(f"/render/{j['jobId']}/camera",headers=headers,json={"action":"up","position":[0,0,30],"target":[0,0,0],"revision":1}).status_code==422

def test_published_bytes_and_status_evidence(setup):
    client,headers,_=setup;j,scene=ready_parent();result=frame_result(j,scene)
    A.publish(j,result,1,"quality",j["pose"])
    res=client.get(f"/frames/{j['jobId']}/latest.jpg",headers=headers)
    assert res.status_code==200 and hashlib.sha256(res.content).hexdigest()==res.headers["X-Frame-SHA256"]
    assert res.headers["X-Patch-Id"]==scene["patch"]["id"]
    status=client.get(f"/status/{j['jobId']}",headers=headers).json()
    assert status["latestFrame"]["sourceIds"]==["way/10"] and status["latestFrame"]["workerPid"]==1234
    assert all(not k.startswith("_") for k in status) and "dir" not in status

def test_legacy_png_is_real_png_with_correct_hash(setup):
    client,headers,_=setup;j,scene=ready_parent();A.publish(j,frame_result(j,scene),1,"quality",j["pose"])
    res=client.get(f"/frames/{j['jobId']}/1.png",headers=headers)
    assert res.status_code==200 and res.content.startswith(b"\x89PNG")
    assert hashlib.sha256(res.content).hexdigest()==res.headers["X-Frame-SHA256"]

def test_cancelled_frame_never_publishes(setup):
    _,_,_=setup;j,scene=ready_parent();result=frame_result(j,scene);j["_cancel"].set()
    with pytest.raises(CancelledError):A.publish(j,result,1,"quality",j["pose"])
    assert j["frames"]==[] and not list((Path(j["dir"])/"frames").iterdir())

def test_superseded_revision_never_publishes(setup):
    j,scene=ready_parent();result=frame_result(j,scene);A.SCENES[j["sceneId"]]["revision"]=1
    with pytest.raises(CancelledError):A.publish(j,result,1,"quality",j["pose"])
    assert not j["frames"]

def test_cross_job_and_tampered_bytes_rejected(setup):
    j,scene=ready_parent();result=frame_result(j,scene);result["jobId"]="not-this-job"
    with pytest.raises(RuntimeError,match="identity"):A.publish(j,result,1,"quality",j["pose"])
    result["jobId"]=j["jobId"];result["hash"]="0"*64
    with pytest.raises(RuntimeError,match="hash"):A.publish(j,result,1,"quality",j["pose"])

def test_admission_is_bounded(setup):
    for _ in range(12):A.new_job({"prompt":"fixture"})
    with pytest.raises(A.HTTPException) as error:A.new_job({"prompt":"fixture"})
    assert error.value.status_code==429

def test_camera_all_quality_commands_use_shared_gpu_pool(setup,monkeypatch):
    j,scene=ready_parent();j["_scene_path"]="fixture_scene.json";commands=[]
    class Pool:
        def submit(self,cmd,cancel):
            commands.append(cmd);result=frame_result(j,scene);result["frameId"]=cmd["frameId"]
            f=Future();f.set_result(result);return f
    monkeypatch.setattr(A,"ensure_pool",lambda:Pool())
    for quality in ("preview","quality","sequence"):A.render_frame(j,scene,j["pose"],1,quality)
    assert [cmd["width"] for cmd in commands]==[640,960,640]
    assert all(cmd["cacheKey"]==scene["cacheKey"] and cmd["sceneId"]==scene["sceneId"] for cmd in commands)

def test_cpu_export_real_mp4_and_timeline_not_fake_realtime(setup):
    import shutil
    if not shutil.which("ffmpeg"):pytest.skip("ffmpeg not installed")
    j,scene=ready_parent();j["timeline_fps"]=2
    for index,color in ((1,(10,30,70)),(2,(70,30,10))):
        result=frame_result(j,scene,quality="quality" if index==1 else "sequence")
        path=Path(result["stagingPath"])
        with Image.open(path) as im:
            changed=Image.new("RGB",im.size,color);changed.save(path,"JPEG")
        result["hash"]=hashlib.sha256(path.read_bytes()).hexdigest()
        A.publish(j,result,index,"quality" if index==1 else "sequence",j["pose"])
    A.encode(j)
    assert (Path(j["dir"])/"video.mp4").stat().st_size>1000
    assert j["encoder"]=="libx264 (CPU encode only)" and j["timeline_fps"]==2

def test_legacy_unverified_archive_not_returned_as_new_scene(setup):
    client,headers,_=setup
    jid="abcd"*5;folder=A.JOBS_DIR/jid;folder.mkdir()
    (folder/"job.json").write_text(json.dumps({"job_id":jid,"stage":"complete"}))
    response=client.get(f"/status/{jid}",headers=headers)
    assert response.status_code==410 and "legacy unverified" in response.json()["detail"]
