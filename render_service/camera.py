"""Pure-Python local-metre camera validation, shared by API and Blender.
All four frustum corner rays hit the bounded patch; no geometry is hidden to
make an invalid camera appear usable. Building collision checks include the
near plane and the entire camera-to-target segment, including concave rings.
"""
import math
import terrain as Terrain

class CameraError(ValueError):
    pass

def sub(a,b): return [x-y for x,y in zip(a,b)]
def add(a,b): return [x+y for x,y in zip(a,b)]
def scale(a,s): return [x*s for x in a]
def dot(a,b): return sum(x*y for x,y in zip(a,b))
def cross(a,b): return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def unit(a):
    length=math.sqrt(dot(a,a))
    if length<1e-8: raise CameraError("degenerate camera direction")
    return scale(a,1/length)

def inside_ring(p, ring):
    x,y=p[:2]; yes=False
    for a,b in zip(ring,ring[1:]+ring[:1]):
        if (a[1]>y)!=(b[1]>y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:yes=not yes
    return yes

def inside_building(p,b):
    return inside_ring(p,b["pts"]) and not any(inside_ring(p,h) for h in b.get("holes",[]))

def point_segment_distance(p,a,b):
    v=sub(b[:2],a[:2]);u=sub(p[:2],a[:2]);den=dot(v,v)
    t=max(0,min(1,dot(u,v)/den)) if den else 0
    return math.hypot(p[0]-a[0]-t*v[0],p[1]-a[1]-t*v[1])

def near_building(p,b,margin=.5):
    if p[2] > b.get("z",0)+b["h"]+margin: return False
    if inside_building(p,b): return True
    return any(point_segment_distance(p,a,c)<margin for ring in [b["pts"]]+b.get("holes",[]) for a,c in zip(ring,ring[1:]+ring[:1]))

def sight_blocked(a,b,building):
    # Partition the segment at all polygon-edge crossings. Each interval is
    # wholly inside or outside, so narrow footprints cannot be skipped.
    dx,dy=b[0]-a[0],b[1]-a[1]; cuts=[0.,1.]
    for ring in [building["pts"]]+building.get("holes",[]):
        for c,d in zip(ring,ring[1:]+ring[:1]):
            ex,ey=d[0]-c[0],d[1]-c[1];den=dx*ey-dy*ex
            if abs(den)<1e-12:continue
            cx,cy=c[0]-a[0],c[1]-a[1]
            t=(cx*ey-cy*ex)/den;u=(cx*dy-cy*dx)/den
            if 0<t<1 and 0<=u<=1:cuts.append(t)
    cuts=sorted(cuts)
    for lo,hi in zip(cuts,cuts[1:]):
        mid=(lo+hi)/2;p=add(a,scale(sub(b,a),mid))
        low_z=min(a[2]+lo*(b[2]-a[2]),a[2]+hi*(b[2]-a[2]))
        if inside_building(p,building) and low_z < building.get("z",0)+building["h"]+.2:return True
    return False

def validate_pose(pose,scene,aspect=16/9):
    try:
        p=[float(x) for x in pose["position"]];t=[float(x) for x in pose["target"]];fov=float(pose.get("fovDeg",45))
    except (ValueError,TypeError,KeyError):raise CameraError("position/target must be finite [x,y,z] metre triples")
    if len(p)!=3 or len(t)!=3 or not all(math.isfinite(v) for v in p+t+[fov]):raise CameraError("invalid camera numbers")
    if not 25<=fov<=70:raise CameraError("fovDeg must be 25..70")
    ring=scene["patch"]["boundary"]
    if not inside_ring(p,ring) or not inside_ring(t,ring):raise CameraError("camera/target outside patch")
    terrain=scene.get("terrain")
    ground_p=Terrain.surface_height(terrain,p[0],p[1]) if terrain else 0
    ground_t=Terrain.surface_height(terrain,t[0],t[1]) if terrain else 0
    if not (2<=p[2]-ground_p<=500 and t[2]>=ground_t-.001 and t[2]<p[2]-.5):raise CameraError("camera must be above terrain, looking downward at or above ground")
    forward=unit(sub(t,p));right=cross(forward,[0,0,1])
    right=unit(right) if dot(right,right)>1e-8 else [1,0,0]
    up=unit(cross(right,forward));tx=math.tan(math.radians(fov)/2);ty=tx/aspect
    corners=[];near=[p];clip=.25
    for sx,sy in ((-1,-1),(1,-1),(1,1),(-1,1)):
        ray=add(forward,add(scale(right,sx*tx),scale(up,sy*ty)))
        if ray[2]>=-.02:raise CameraError("view includes horizon/outside patch")
        if terrain:
            terrain_hit=Terrain.ray_hit(terrain,p,ray)
            if terrain_hit is None:raise CameraError("view footprint exceeds bounded terrain")
            hit=terrain_hit[1]
        else:hit=add(p,scale(ray,-p[2]/ray[2]))
        corners.append(hit[:2])
        if not inside_ring(hit,ring):raise CameraError("view footprint exceeds bounded patch")
        near.append(add(p,scale(ray,clip)))
    if terrain:
        center_hit=Terrain.ray_hit(terrain,p,sub(t,p))
        if center_hit and center_hit[0] < .999:raise CameraError("camera target occluded by terrain")
        if any(n[2] < Terrain.surface_height(terrain,n[0],n[1])+.1 for n in near):raise CameraError("near clip intersects terrain")
    for building in scene.get("buildings",[]):
        if any(near_building(n,building) for n in near):raise CameraError("camera/near clip intersects building")
        if sight_blocked(p,t,building):raise CameraError("camera target occluded by mapped building")
    return {"position":p,"target":t,"fovDeg":fov,"nearClip":clip,"groundFootprint":corners,"coordinateSystem":"local-metres-east-north-up"}

def orbit_pose(pose,degrees):
    p=pose["position"];t=pose["target"];x,y=p[0]-t[0],p[1]-t[1];a=math.radians(degrees)
    return {"position":[t[0]+x*math.cos(a)-y*math.sin(a),t[1]+x*math.sin(a)+y*math.cos(a),p[2]],"target":list(t),"fovDeg":pose.get("fovDeg",45)}

def move(pose,command,scene):
    def changed(result):
        result=validate_pose(result,scene)
        old=list(pose["position"])+list(pose["target"])+[pose.get("fovDeg",45)]
        new=result["position"]+result["target"]+[result["fovDeg"]]
        if all(math.isclose(a,b,abs_tol=1e-7) for a,b in zip(old,new)):
            raise CameraError("camera update does not change the view")
        distance=math.sqrt(sum((result["position"][i]-pose["position"][i])**2 for i in range(3)))
        steps=min(64,max(1,math.ceil(distance)))
        for step in range(1,steps):
            u=step/steps
            validate_pose({"position":[pose["position"][i]*(1-u)+result["position"][i]*u for i in range(3)],
                           "target":[pose["target"][i]*(1-u)+result["target"][i]*u for i in range(3)],"fovDeg":result["fovDeg"]},scene)
        return result
    action=command.get("action")
    if not action:return changed(command)
    if action in ("orbit-left","orbit-right"):
        return changed(orbit_pose(pose,10 if action=="orbit-left" else -10))
    result={"position":list(pose["position"]),"target":list(pose["target"]),"fovDeg":pose["fovDeg"]}
    if action in ("up","down"):result["position"][2]+=5 if action=="up" else -5
    elif action in ("forward","back"):
        direction=sub(result["target"],result["position"]);direction[2]=0
        direction=unit(direction);offset=scale(direction,5 if action=="forward" else -5)
        result["position"]=add(result["position"],offset);result["target"]=add(result["target"],offset)
    else:raise CameraError("unsupported camera action")
    return changed(result)

MODES = {
    # mode: (AGL metres to try, horizontal distance factor, label)
    "street": ((7, 10, 14, 18), 2.4, "street-level (pedestrian/vehicle eye height band)"),
    "low_oblique": ((22, 30, 40, 55), 1.9, "low-oblique (rooftop height)"),
    "orbit": ((95, 65, 130, 180, 40), .35, "high orbit (legacy overview)"),
}
FALLBACK = {"street": ("street", "low_oblique", "orbit"), "low_oblique": ("low_oblique", "street", "orbit"), "orbit": ("orbit", "low_oblique")}

def _targets(scene):
    priorities=[]
    for instance in scene.get("instances",[]):
        if str(instance.get("element","")).startswith("crash_vehicle"):
            priorities.append([instance["x"],instance["y"],0.1])
    candidates=[]
    for road in scene.get("roads",[]):
        if road.get("groundingAvailable") and road.get("drivable", True):
            pts=road["pts"]
            candidates.extend([[ (a[0]+b[0])/2,(a[1]+b[1])/2,.1] for a,b in zip(pts,pts[1:])])
    return priorities+sorted((p for p in candidates if not any(inside_building(p,b) for b in scene.get("buildings",[]))),key=lambda p:p[0]**2+p[1]**2)[:60]+[[0,0,.1]]

def _crowded(p, scene, clearance):
    """Street/low cameras keep horizontal clearance from walls taller than the lens,
    so a view is never pressed against (or shadowed inside) a facade."""
    for b in scene.get("buildings",[]):
        if b.get("z",0)+b["h"] < p[2]:continue
        if inside_building(p,b):return True
        if any(point_segment_distance(p,a,c)<clearance for ring in [b["pts"]]+b.get("holes",[]) for a,c in zip(ring,ring[1:]+ring[:1])):return True
    return False

def initial_pose(scene, mode="orbit"):
    """First valid pose for the requested mode, falling back street -> low-oblique -> orbit.

    Every candidate passes validate_pose: no horizon in frame, footprint inside the
    patch, no camera/near-plane inside a building, target not occluded."""
    for used in FALLBACK.get(mode, FALLBACK["orbit"]):
        agls, factor, label = MODES[used]
        for target in _targets(scene):
            target=list(target)
            if scene.get("terrain"):target[2]=Terrain.surface_height(scene["terrain"],target[0],target[1])+(1.0 if used=="street" else .15)
            for agl in agls:
                z=target[2]+agl
                for angle in (-90,-45,0,45,90,135,180,-135):
                    a=math.radians(angle);r=agl*factor
                    position=[target[0]+r*math.cos(a),target[1]+r*math.sin(a),z]
                    if used!="orbit" and _crowded(position,scene,clearance=7.0 if used=="street" else 4.0):continue
                    try:
                        pose=validate_pose({"position":position,"target":target,"fovDeg":50 if used=="street" else 45},scene)
                    except CameraError:continue
                    pose["mode"]=used;pose["modeLabel"]=label;pose["requestedMode"]=mode
                    return pose
    raise CameraError("no valid downward camera inside patch; select a different bounded patch")

def sequence_poses(scene, pose, count, degrees_per_frame):
    """Deterministic, validated camera path. Orbits the target; at street level a
    blocked orbit step tries the opposite direction and then a short dolly, never
    passing through buildings or tilting to the horizon. Stops when nothing is valid."""
    out=[];direction=1;cur=pose
    for _ in range(count):
        nxt=None
        for attempt in ("orbit","reverse","dolly-in","dolly-out"):
            try:
                if attempt=="orbit":cand=orbit_pose(cur,degrees_per_frame*direction)
                elif attempt=="reverse":cand=orbit_pose(cur,-degrees_per_frame*direction)
                else:
                    p=cur["position"];t=cur["target"];k=.985 if attempt=="dolly-in" else 1.015
                    cand={"position":[t[0]+(p[0]-t[0])*k,t[1]+(p[1]-t[1])*k,p[2]],"target":list(t),"fovDeg":cur.get("fovDeg",45)}
                nxt=validate_pose(cand,scene)
                if attempt=="reverse":direction=-direction
                break
            except CameraError:continue
        if nxt is None:break
        for key in ("mode","modeLabel","requestedMode"):
            if key in pose:nxt[key]=pose[key]
        out.append(nxt);cur=nxt
    return out
