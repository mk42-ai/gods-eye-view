import copy
import os
from pathlib import Path
import sys
from types import SimpleNamespace as NS
import pytest
sys.path.insert(0,str(Path(__file__).parent))
import camera as C
import gpu_policy as G


def scene():return {"patch":{"boundary":[[-260,-260],[260,-260],[260,260],[-260,260],[-260,-260]]},"buildings":[],"roads":[]}
def pose():return {"position":[0,-20,60],"target":[0,0,.1],"fovDeg":45}

def test_initial_is_downward_inside_patch():
    p=C.initial_pose(scene())
    assert p["position"][2]>p["target"][2] and len(p["groundFootprint"])==4
    assert all(abs(v)<260 for pt in p["groundFootprint"] for v in pt)

@pytest.mark.parametrize("action",["orbit-left","orbit-right","forward","back","up","down"])
def test_every_action_changes_actual_camera_pose(action):
    old=C.validate_pose(pose(),scene());new=C.move(old,{"action":action},scene())
    assert new["position"]!=old["position"]
    C.validate_pose(new,scene())

@pytest.mark.parametrize("p",[
    {"position":[260,0,60],"target":[0,0,0]},
    {"position":[0,0,1],"target":[0,0,0]},
    {"position":[0,0,80],"target":[0,50,79]},
    {"position":[0,0,450],"target":[200,200,0]},
    {"position":[0,float('nan'),60],"target":[0,0,0]}])
def test_invalid_pose_rejected(p):
    with pytest.raises(C.CameraError):C.validate_pose(p,scene())

def test_thin_building_cannot_be_skipped_by_sightline():
    b={"pts":[[-1,-11],[1,-11],[1,-10.99],[-1,-10.99]],"h":80}
    s=scene();s["buildings"]=[b]
    with pytest.raises(C.CameraError,match="occluded"):C.validate_pose(pose(),s)

def test_near_clip_collision_rejected():
    s=scene();s["buildings"]=[{"pts":[[-1,-21],[1,-21],[1,-19],[-1,-19]],"h":80}]
    with pytest.raises(C.CameraError,match="near clip"):C.validate_pose(pose(),s)

def test_courtyard_not_collision():
    s=scene();s["buildings"]=[{"pts":[[-50,-50],[50,-50],[50,50],[-50,50]],"holes":[[[-25,-25],[25,-25],[25,25],[-25,25]]],"h":10}]
    C.validate_pose(pose(),s)

def inventory():
    return '\n'.join(f'{i}, {ident[0]}, {ident[1]}, NVIDIA H100 80GB HBM3' for i,ident in G.ALLOWED.items())

@pytest.mark.parametrize("requested",["1","0,2","2,6,1","", "2,2", "GPU-any"])
def test_gpu_configuration_never_falls_back(requested):
    with pytest.raises(G.GPUError):G.resolve_devices(requested,inventory())

def test_uuid_visibility_not_ordinal(monkeypatch):
    devices=G.resolve_devices("2,6",inventory())
    env=G.worker_env(devices[0]);assert env["CUDA_VISIBLE_DEVICES"]==G.ALLOWED[2][0]
    assert env["CUDA_DEVICE_ORDER"]=="PCI_BUS_ID"

def test_inventory_mapping_change_rejected():
    with pytest.raises(G.GPUError):G.resolve_devices("2",inventory().replace(G.ALLOWED[2][0],"GPU-other"))

def fake_bpy(devices):
    preferences=NS(devices=devices,compute_device_type=None,get_devices=lambda:None)
    return NS(context=NS(preferences=NS(addons={"cycles":NS(preferences=preferences)}),scene=NS(render=NS(engine=""),cycles=NS(device=""))))

def test_cycles_pci_selected_and_every_other_gpu_cpu_disabled(monkeypatch):
    device=G.resolve_devices("6",inventory())[0]
    for key,value in G.worker_env(device).items():
        if key.startswith("GEV_GPU") or key.startswith("CUDA"):monkeypatch.setenv(key,value)
    ds=[NS(type="OPTIX",id="OPTIX_NVIDIA H100_0001:45:00",name="H100",use=False),
        NS(type="OPTIX",id="OPTIX_NVIDIA H100_0000:29:00",name="unrelated",use=True),
        NS(type="CPU",id="CPU",name="CPU",use=True)]
    bpy=fake_bpy(ds);proof=G.configure_cycles(bpy,device)
    assert [d.use for d in ds]==[True,False,False] and proof["cpuEnabled"] is False
    assert bpy.context.scene.cycles.device=="GPU"

def test_no_matching_optix_cannot_render_on_cpu(monkeypatch):
    device=G.resolve_devices("2",inventory())[0]
    monkeypatch.setenv("CUDA_VISIBLE_DEVICES",device["uuid"]);monkeypatch.setenv("GEV_GPU_UUID",device["uuid"])
    cpu=NS(type="CPU",id="CPU",name="CPU",use=True)
    with pytest.raises(G.GPUError,match="PCI-matched"):G.configure_cycles(fake_bpy([cpu]),device)
    assert cpu.use is False

def test_blender_has_no_old_gpu_ordinal_or_animation_bypass():
    text=Path(__file__).with_name("blender_scene.py").read_text()
    assert 'GPU.configure_cycles(bpy,device)' in text
    assert 'visible_camera = False' not in text
    assert 'animation=True' not in text
    assert '"2", "6"' not in text

@pytest.mark.parametrize("command",[{"action":"orbit-left"},{"position":[0,0,60],"target":[0,0,.1],"fovDeg":45}])
def test_no_op_camera_updates_do_not_claim_new_view(command):
    original={"position":[0,0,60],"target":[0,0,.1],"fovDeg":45}
    with pytest.raises(C.CameraError,match="does not change"):C.move(original,command,scene())
