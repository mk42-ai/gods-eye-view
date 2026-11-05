import json
import queue
import sys
import threading
import time
from concurrent.futures import CancelledError
from pathlib import Path
from types import SimpleNamespace as NS
import pytest
sys.path.insert(0,str(Path(__file__).parent))
import worker_pool as W


def bare_pool(slots):
    pool=W.WorkerPool.__new__(W.WorkerPool);pool.slots=slots;pool.lock=threading.Lock();return pool

def test_pool_queue_capacity_and_no_unbounded_spawn():
    slots=[NS(queue=queue.Queue(maxsize=1),busy=False,cache_key=None) for _ in range(2)]
    pool=bare_pool(slots);event=threading.Event();cmd={"cacheKey":"same"}
    pool.submit(cmd,event);pool.submit(cmd,event)
    with pytest.raises(W.QueueFull):pool.submit(cmd,event)
    assert sum(slot.queue.qsize() for slot in slots)==2

def test_hot_scene_affinity_even_if_other_gpu_idle():
    cold=NS(queue=queue.Queue(maxsize=1),busy=False,cache_key=None)
    hot=NS(queue=queue.Queue(maxsize=1),busy=True,cache_key="scene")
    bare_pool([cold,hot]).submit({"cacheKey":"scene"},threading.Event())
    assert hot.queue.qsize()==1 and cold.queue.qsize()==0

def test_cancelled_completed_worker_frame_is_deleted(tmp_path):
    slot=W.Slot.__new__(W.Slot);slot.process=NS(poll=lambda:None);slot.spool=tmp_path;slot.closed=threading.Event()
    staged=tmp_path/"staging.jpg";staged.write_bytes(b"not-published")
    cmd={"requestId":"request1","cacheKey":"scene","stagingPath":str(staged)}
    cancel=threading.Event();cancel.set()
    def worker():
        for _ in range(100):
            if (tmp_path/"command.json").exists():
                W.atomic_json(tmp_path/"result.json",{"requestId":"request1"});return
            time.sleep(.005)
    thread=threading.Thread(target=worker);thread.start()
    with pytest.raises(CancelledError):slot.execute(cmd,cancel)
    thread.join();assert not staged.exists()

def test_stale_worker_result_rejected(tmp_path):
    slot=W.Slot.__new__(W.Slot);slot.process=NS(poll=lambda:None);slot.spool=tmp_path;slot.closed=threading.Event()
    cmd={"requestId":"new","cacheKey":"scene","stagingPath":str(tmp_path/"f.jpg")}
    def worker():
        for _ in range(100):
            if (tmp_path/"command.json").exists():
                W.atomic_json(tmp_path/"result.json",{"requestId":"old"});return
            time.sleep(.005)
    thread=threading.Thread(target=worker);thread.start()
    with pytest.raises(RuntimeError,match="stale worker result"):slot.execute(cmd,threading.Event())
    thread.join()

def test_launch_uses_uuid_policy_not_unapproved_index(tmp_path,monkeypatch):
    device={"physicalIndex":2,"uuid":"approved-uuid","pciBusId":"approved-pci","name":"test"}
    slot=W.Slot.__new__(W.Slot);slot.device=device;slot.root=tmp_path;slot.blender="fixture-blender";slot.closed=threading.Event()
    monkeypatch.setattr(W.GPU,"resolve_devices",lambda indices:[device])
    monkeypatch.setattr(W.GPU,"worker_env",lambda d:{"CUDA_VISIBLE_DEVICES":d["uuid"]})
    called={}
    def spawn(args,**kw):
        called.update(args=args,kwargs=kw)
        spool=Path(args[-1]);W.atomic_json(spool/"ready.json",{"workerPid":321,"gpu":{"uuid":device["uuid"],"cpuEnabled":False}})
        return NS(poll=lambda:None,pid=321)
    monkeypatch.setattr(W.subprocess,"Popen",spawn)
    slot.launch();slot.log.close()
    assert called["kwargs"]["env"]["CUDA_VISIBLE_DEVICES"]=="approved-uuid"
    assert "--worker" in called["args"] and "--factory-startup" in called["args"]
