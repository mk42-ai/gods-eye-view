"""Fail-closed identity policy. Physical indices are resolved, never CUDA ordinals.

Only the two explicitly authorized host UUID/PCI identities may launch workers.
Inventory changes, malformed configuration, missing OptiX or ambiguous Cycles IDs
stop rendering; there is deliberately no CPU or alternate-device fallback.
"""
import csv
import io
import os
import re
import subprocess

ALLOWED = {
    2: ("GPU-b2aff670-0bcc-b834-af70-421466084d30", "00000000:45:00.0"),
    6: ("GPU-2c78264d-f20e-47cb-3976-a85395cbad55", "00000001:45:00.0"),
}
class GPUError(RuntimeError):
    pass

def pci_key(value):
    m=re.search(r"([0-9a-f]{4,8}):([0-9a-f]{2}):([0-9a-f]{2})(?:\.([0-7]))?",str(value),re.I)
    if not m:return None
    return tuple(int(v or '0',16) for v in m.groups())

def resolve_devices(requested=None, inventory=None):
    raw=requested if requested is not None else os.environ.get("RENDER_GPUS","2,6")
    try:indices=[int(v.strip()) for v in raw.split(",") if v.strip()]
    except (ValueError,AttributeError):raise GPUError("RENDER_GPUS must be an explicit subset of physical indices 2,6")
    if not indices or len(indices)!=len(set(indices)) or any(i not in ALLOWED for i in indices):raise GPUError("GPU policy rejects configuration outside physical indices 2,6")
    if inventory is None:
        try:
            result=subprocess.run(["nvidia-smi","--query-gpu=index,uuid,pci.bus_id,name","--format=csv,noheader"],capture_output=True,text=True,check=True,timeout=5)
            inventory=result.stdout
        except (OSError,subprocess.SubprocessError) as exc:raise GPUError("nvidia-smi inventory unavailable") from exc
    records={}
    for row in csv.reader(io.StringIO(inventory)):
        if len(row)!=4:continue
        try:i=int(row[0].strip())
        except ValueError:continue
        if i in records:raise GPUError("duplicate physical GPU inventory index")
        records[i]={"physicalIndex":i,"uuid":row[1].strip(),"pciBusId":row[2].strip(),"name":row[3].strip()}
    selected=[]
    for index in indices:
        row=records.get(index);expected_uuid,expected_pci=ALLOWED[index]
        if not row or row["uuid"]!=expected_uuid or pci_key(row["pciBusId"])!=pci_key(expected_pci):
            raise GPUError("approved GPU UUID/PCI identity missing or changed at physical index "+str(index))
        selected.append(row)
    return selected

def worker_env(device):
    env=dict(os.environ)
    env.update(CUDA_VISIBLE_DEVICES=device["uuid"],CUDA_DEVICE_ORDER="PCI_BUS_ID",GEV_GPU_UUID=device["uuid"],
               GEV_GPU_PCI=device["pciBusId"],GEV_GPU_INDEX=str(device["physicalIndex"]))
    return env

def configure_cycles(bpy,device):
    if os.environ.get("CUDA_VISIBLE_DEVICES")!=device["uuid"] or os.environ.get("GEV_GPU_UUID")!=device["uuid"]:
        raise GPUError("worker lacks an exclusive authorized UUID visibility mask")
    if device["physicalIndex"] not in ALLOWED or ALLOWED[device["physicalIndex"]][0]!=device["uuid"]:
        raise GPUError("unauthorized worker identity")
    if pci_key(device["pciBusId"]) != pci_key(ALLOWED[device["physicalIndex"]][1]):
        raise GPUError("worker PCI identity differs from approved inventory")
    prefs=bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type="OPTIX";prefs.get_devices()
    for d in prefs.devices:d.use=False
    eligible=[d for d in prefs.devices if d.type=="OPTIX" and pci_key(d.id)==pci_key(device["pciBusId"])]
    if len(eligible)!=1:raise GPUError("exactly one PCI-matched Cycles OptiX device is required; no CPU fallback")
    selected=eligible[0];selected.use=True
    bpy.context.scene.render.engine="CYCLES";bpy.context.scene.cycles.device="GPU"
    if any(d.use for d in prefs.devices if d.type!="OPTIX" or d.id != selected.id):
        raise GPUError("unexpected Cycles device enabled")
    return {"uuid":device["uuid"],"pciBusId":device["pciBusId"],"physicalIndex":device["physicalIndex"],
            "cyclesDevice":{"id":selected.id,"name":selected.name,"type":selected.type},"cpuEnabled":False}

def verify_cycles(bpy, device, evidence):
    """Cheap per-frame attestation without prefs.get_devices() (which re-syncs
    the Cycles device and costs seconds per frame). Confirms the exact OptiX
    device chosen by configure_cycles() is still the only enabled device."""
    prefs=bpy.context.preferences.addons["cycles"].preferences
    if prefs.compute_device_type!="OPTIX" or bpy.context.scene.cycles.device!="GPU":
        raise GPUError("Cycles device configuration drifted from OPTIX/GPU")
    enabled=[d for d in prefs.devices if d.use]
    if len(enabled)!=1 or enabled[0].type!="OPTIX" or enabled[0].id!=evidence["cyclesDevice"]["id"] or pci_key(enabled[0].id)!=pci_key(device["pciBusId"]):
        raise GPUError("enabled Cycles devices differ from the attested OptiX device")
    if os.environ.get("CUDA_VISIBLE_DEVICES")!=device["uuid"]:
        raise GPUError("worker visibility mask changed")
    return dict(evidence, attestation="per-frame enabled-device check (no device re-sync)")
