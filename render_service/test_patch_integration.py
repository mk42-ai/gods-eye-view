"""Offline integration gates. Fixtures are never advertised as live renders."""
import math
from PIL import Image
import pytest
import copernicus as D
import terrain as T
import camera as C
import pipeline as P


def fixture_terrain():
    return {"clippedMesh": {"vertices": [[-20,-20,2],[20,-20,4],[20,20,6],[-20,20,4]], "faces": [[0,1,2],[0,2,3]]}}


def test_cog_pixel_is_point_axes_and_bilinear_sampling():
    im=Image.new('F',(3,3));im.putdata([0,10,20,30,40,50,60,70,80])
    tile={'image':im,'scale':(1.,1.,0.),'tie':(0.,0.,0.,50.,25.,0.)}
    assert D.sample_tile(tile,24.5,50.5)==pytest.approx(20)
    assert D.sample_tile(tile,25,50)==0
    with pytest.raises(T.TerrainError):D.sample_tile(tile,24,52)


def test_tile_ids_derive_from_real_wgs84_floor_not_rounded_location():
    assert D.tile_parts(24.488,54.608)[0]=='Copernicus_DSM_COG_30_N24_00_E054_00_DEM'
    assert D.tile_parts(-.01,-.01)[0]=='Copernicus_DSM_COG_30_S01_00_W001_00_DEM'


def test_cog_invalid_values_fail_no_zero_fallback():
    im=Image.new('F',(3,3),-9999)
    tile={'image':im,'scale':(1.,1.,0.),'tie':(0.,0.,0.,50.,25.,0.)}
    with pytest.raises(T.TerrainError):D.sample_tile(tile,24.5,50.5)


def test_rendered_mesh_sampler_and_ray_agree():
    t=fixture_terrain()
    assert T.surface_height(t,0,0)==pytest.approx(4)
    assert T.surface_height(t,10,0)==pytest.approx(4.5)
    length,point=T.ray_hit(t,[0,0,14],[0,0,-1])
    assert length==pytest.approx(10)
    assert point==pytest.approx([0,0,4])
    with pytest.raises(T.TerrainError):T.surface_height(t,50,0)


def test_camera_checks_terrain_agl_and_bounded_real_surface():
    t=fixture_terrain();s={'terrain':t,'patch':{'boundary':[[-20,-20],[20,-20],[20,20],[-20,20],[-20,-20]]},'buildings':[]}
    pose=C.validate_pose({'position':[0,-3,14],'target':[0,0,4.1],'fovDeg':25},s)
    assert len(pose['groundFootprint'])==4
    with pytest.raises(C.CameraError):C.validate_pose({'position':[0,0,4.2],'target':[0,1,3],'fovDeg':25},s)
    with pytest.raises(C.CameraError):C.validate_pose({'position':[0,0,60],'target':[0,1,4.1],'fovDeg':70},s)


def test_neutral_venue_cannot_receive_generic_police_scene():
    neutral={'scenarioType':'observation','elements':[],'confidence':.8}
    assert P.validate_spec(neutral,"Kane's Boxing Gym, Abu Dhabi",'Official venue')['elements']==[]
    with pytest.raises(P.PlanningError):P.validate_spec({'scenarioType':'police_raid','elements':[]},"Kane's Boxing Gym, Abu Dhabi",'Official venue')
    with pytest.raises(P.PlanningError):P.validate_spec({'scenarioType':'observation','elements':[{'type':'perimeter_unit','params':{'count':2}}]},"Kane's Boxing Gym, Abu Dhabi",'Official venue')


def test_missing_live_planner_credentials_is_visible_blocker_not_template(monkeypatch):
    monkeypatch.delenv('ONDEMAND_API_KEY',raising=False)
    with pytest.raises(P.PlanningError,match='not configured'):P.ondemand_spec('Car crash outside Yas Mall','Yas Mall')


def test_structured_plan_rejects_invalid_parameters():
    for value in (float('nan'),-1,0,99,1.5,True):
        with pytest.raises(P.PlanningError):P.validate_spec({'scenarioType':'route_closure','elements':[{'type':'cones','params':{'count':value}}]},'Car crash','Yas Mall')
