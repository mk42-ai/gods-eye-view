"""Patch-to-3D scenery tests: fixtures only, no network, no GPU."""
import math, os, random, sys
from pathlib import Path
from types import SimpleNamespace as NS
import pytest
sys.path.insert(0, str(Path(__file__).parent))
os.environ.setdefault("GEV_ROOT", str(Path(__file__).resolve().parents[1]))
import camera as C
import terrain as T
import gpu_policy as GPU
import imagery as IMG


def flat_terrain(half=300, n=6, z=lambda x, y: 0.02 * x):
    verts, faces = [], []
    step = 2 * half / n
    for j in range(n + 1):
        for i in range(n + 1):
            x, y = -half + i * step, -half + j * step
            verts.append([x, y, z(x, y)])
    for j in range(n):
        for i in range(n):
            a = j * (n + 1) + i; b = a + 1; c = a + n + 1; d = c + 1
            faces += [[a, b, d], [a, d, c]]
    return {"clippedMesh": {"vertices": verts, "faces": faces}}


def linear_height(terrain, x, y):
    mesh = terrain["clippedMesh"]
    for face in mesh["faces"]:
        a, b, c = [mesh["vertices"][i] for i in face]
        den = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        u = ((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den
        v = ((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den
        w = 1-u-v
        if min(u, v, w) >= -1e-7: return u*a[2]+v*b[2]+w*c[2]


def test_grid_index_matches_linear_scan():
    t = flat_terrain(z=lambda x, y: math.sin(x / 40) * 3 + y * .01)
    rnd = random.Random(3)
    for _ in range(400):
        x, y = rnd.uniform(-299, 299), rnd.uniform(-299, 299)
        assert T.surface_height(t, x, y) == pytest.approx(linear_height(t, x, y), abs=1e-9)
    with pytest.raises(T.TerrainError):
        T.surface_height(t, 999, 0)


def scene(buildings=()):
    half = 300
    ring = [[-half, -half], [half, -half], [half, half], [-half, half]]
    return {"patch": {"boundary": ring}, "terrain": flat_terrain(half, z=lambda x, y: 0.0), "buildings": list(buildings),
            "roads": [{"pts": [[-250, 0], [250, 0]], "groundingAvailable": True, "drivable": True}], "instances": []}


def test_street_mode_is_low_and_downward():
    s = scene()
    pose = C.initial_pose(s, "street")
    assert pose["mode"] == "street"
    agl = pose["position"][2] - pose["target"][2]
    assert 4 <= agl <= 16, agl
    assert pose["target"][2] < pose["position"][2]
    for corner in pose["groundFootprint"]:
        assert -300 < corner[0] < 300 and -300 < corner[1] < 300


def test_street_mode_falls_back_when_buildings_block():
    # A dense wall of tall buildings around the only road forces a higher mode.
    blocks = []
    for k in range(-12, 13):
        x = k * 20
        blocks.append({"pts": [[x - 9, 2], [x + 9, 2], [x + 9, 290], [x - 9, 290]], "h": 120})
        blocks.append({"pts": [[x - 9, -290], [x + 9, -290], [x + 9, -2], [x - 9, -2]], "h": 120})
    s = scene(blocks)
    try:
        pose = C.initial_pose(s, "street")
    except C.CameraError:
        return  # failing closed is acceptable; never a pose inside a building
    for b in blocks:
        assert not C.near_building(pose["position"], b)


def test_sequence_never_enters_buildings_or_horizon():
    blocks = [{"pts": [[30, 20], [70, 20], [70, 60], [30, 60]], "h": 40}]
    s = scene(blocks)
    pose = C.initial_pose(s, "street")
    poses = C.sequence_poses(s, pose, 60, 0.45)
    assert poses, "street path should produce frames"
    for p in poses:
        assert not C.near_building(p["position"], blocks[0])
        assert p["target"][2] < p["position"][2]
        assert p["mode"] == "street"


def test_verify_cycles_rejects_drift(monkeypatch):
    dev = {"physicalIndex": 2, "uuid": GPU.ALLOWED[2][0], "pciBusId": GPU.ALLOWED[2][1]}
    monkeypatch.setenv("CUDA_VISIBLE_DEVICES", dev["uuid"])
    good = NS(type="OPTIX", id="OPTIX_NVIDIA H100_0000:45:00", use=True)
    other = NS(type="OPTIX", id="OPTIX_NVIDIA H100_0000:29:00", use=False)
    prefs = NS(compute_device_type="OPTIX", devices=[good, other])
    bpy = NS(context=NS(preferences=NS(addons={"cycles": NS(preferences=prefs)}), scene=NS(cycles=NS(device="GPU"))))
    ev = {"cyclesDevice": {"id": good.id}, "uuid": dev["uuid"]}
    assert GPU.verify_cycles(bpy, dev, ev)["attestation"].startswith("per-frame")
    other.use = True  # GPU 1-style device sneaks in
    with pytest.raises(GPU.GPUError):
        GPU.verify_cycles(bpy, dev, ev)
    other.use = False
    monkeypatch.setenv("CUDA_VISIBLE_DEVICES", "0,1,2")
    with pytest.raises(GPU.GPUError):
        GPU.verify_cycles(bpy, dev, ev)


def test_gpu1_never_allowed():
    for req in ("1", "2,6,1", "1,2"):
        with pytest.raises(GPU.GPUError):
            GPU.resolve_devices(req, inventory="")
    assert set(GPU.ALLOWED) == {2, 6}


def test_imagery_affine_registers_origin_and_axes():
    meta = {"zoom": 18, "tileX0": 0, "tileY0": 0, "width": 256, "height": 256}
    origin = {"lat": 24.4884, "lon": 54.6088}
    px, py = IMG._tile_xy(origin["lon"], origin["lat"], 18)
    meta["tileX0"], meta["tileY0"] = int(px) - 2, int(py) - 2
    meta["width"] = meta["height"] = 256 * 5
    a, b, c, d, e, f = IMG.affine(meta, origin)
    assert 0 < c < 1 and 0 < f < 1
    assert a > 0 and abs(b) < a * .05   # east -> +u
    assert e > 0 and abs(d) < e * .05   # north -> +v (image v is flipped to point up)
    # ~0.6 m/px at z18 for this latitude: 100 m ≈ 167 px of 1280
    assert a * 100 * 1280 == pytest.approx(100 / (156543.03 * math.cos(math.radians(origin["lat"])) / 2 ** 18), rel=.02)
