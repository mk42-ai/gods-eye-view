"""Two bounded, persistent Blender slots. No process-wide GPU ordinal assumptions.

One command at a time per owned process. Cancellation never publishes a result;
shutdown only terminates the child PIDs this pool actually launched. A dead or
unhealthy worker is replaced once on its *same authorized GPU*, never on CPU.
"""
from concurrent.futures import Future, CancelledError
from pathlib import Path
import json
import os
import queue
import subprocess
import threading
import time
import uuid
import gpu_policy as GPU

class QueueFull(RuntimeError):pass

def atomic_json(path,data):
    tmp=Path(str(path)+".tmp");tmp.write_text(json.dumps(data,allow_nan=False));os.replace(tmp,path)

class Slot:
    def __init__(self,device,root,blender):
        self.device=device;self.root=Path(root);self.blender=blender
        self.queue=queue.Queue(maxsize=8);self.process=None;self.log=None;self.spool=None
        self.cache_key=None;self.busy=False;self.closed=threading.Event()
        self.thread=threading.Thread(target=self.loop,name="blender-"+str(device["physicalIndex"]),daemon=True);self.thread.start()
    def launch(self):
        # Re-resolve at every launch, protecting against inventory/configuration drift.
        current=GPU.resolve_devices(str(self.device["physicalIndex"]))[0]
        if current!=self.device:raise GPU.GPUError("GPU inventory changed before worker launch")
        self.spool=self.root/"runtime"/("worker_"+str(self.device["physicalIndex"])+"_"+uuid.uuid4().hex[:12])
        self.spool.mkdir(parents=True,exist_ok=False)
        self.log=open(self.spool/"blender.log","a",buffering=1)
        self.process=subprocess.Popen([self.blender,"-b","--factory-startup","-noaudio","-P",str(Path(__file__).with_name("blender_scene.py")),"--","--worker",str(self.spool)],
                                      env=GPU.worker_env(self.device),stdin=subprocess.DEVNULL,stdout=self.log,stderr=subprocess.STDOUT)
        end=time.monotonic()+45
        while time.monotonic()<end and not self.closed.is_set():
            if self.process.poll() is not None:raise GPU.GPUError("Blender exited during OptiX device verification; inspect worker log")
            if (self.spool/"ready.json").exists():
                ready=json.loads((self.spool/"ready.json").read_text())
                if ready["gpu"]["uuid"]!=self.device["uuid"] or ready["gpu"]["cpuEnabled"]:raise GPU.GPUError("invalid worker GPU evidence")
                return
            time.sleep(.05)
        raise GPU.GPUError("Blender OptiX readiness timeout")
    def stop_process(self):
        p=self.process
        if p and p.poll() is None:
            p.terminate()
            try:p.wait(timeout=5)
            except subprocess.TimeoutExpired:p.kill();p.wait(timeout=5)
        self.process=None;self.cache_key=None
        if self.log:self.log.close();self.log=None
    def execute(self,cmd,cancel):
        if not self.process or self.process.poll() is not None:
            self.stop_process();self.launch()
        result_path=self.spool/"result.json"
        result_path.unlink(missing_ok=True)
        atomic_json(self.spool/"command.json",cmd)
        end=time.monotonic()+180
        while time.monotonic()<end and not self.closed.is_set():
            if self.process.poll() is not None:raise RuntimeError("Blender worker exited mid-frame; GPU-only retry required")
            if result_path.exists():
                result=json.loads(result_path.read_text());result_path.unlink()
                if result.get("requestId")!=cmd["requestId"]:raise RuntimeError("stale worker result identity")
                if cancel.is_set():
                    Path(cmd["stagingPath"]).unlink(missing_ok=True);raise CancelledError()
                if result.get("error"):raise RuntimeError(result["error"])
                self.cache_key=cmd["cacheKey"];return result
            time.sleep(.04)
        self.stop_process()
        raise TimeoutError("bounded Blender render timeout (180s)")
    def loop(self):
        while not self.closed.is_set():
            try:cmd,cancel,future=self.queue.get(timeout=.2)
            except queue.Empty:continue
            self.busy=True
            try:
                if cancel.is_set():raise CancelledError()
                result=None
                for attempt in range(2):
                    try:result=self.execute(cmd,cancel);break
                    except CancelledError:raise
                    except Exception:
                        self.stop_process()
                        if attempt or cancel.is_set():raise
                future.set_result(result)
            except BaseException as exc:future.set_exception(exc)
            finally:self.busy=False;self.queue.task_done()
        self.stop_process()
        while True:
            try:_,_,future=self.queue.get_nowait();future.set_exception(CancelledError());self.queue.task_done()
            except queue.Empty:break

class WorkerPool:
    def __init__(self,devices,root,blender):
        if not devices:raise GPU.GPUError("no eligible GPU workers")
        self.slots=[Slot(device,root,blender) for device in devices];self.lock=threading.Lock()
    def submit(self,cmd,cancel):
        with self.lock:
            # Prefer hot scene state; queued work is capped, never fork per camera.
            options=sorted(self.slots,key=lambda s:(s.cache_key!=cmd["cacheKey"],s.queue.qsize()+int(s.busy)))
            for slot in options:
                future=Future()
                try:slot.queue.put_nowait((cmd,cancel,future));return future
                except queue.Full:continue
        raise QueueFull("GPU command queues are full")
    def close(self):
        for slot in self.slots:slot.closed.set()
        for slot in self.slots:slot.thread.join(timeout=7)
    def status(self):
        return [{"device":s.device,"pid":s.process.pid if s.process and s.process.poll() is None else None,
                 "queued":s.queue.qsize(),"busy":s.busy,"sceneCacheKey":s.cache_key,
                 "log":str(s.spool/"blender.log") if s.spool else None} for s in self.slots]
