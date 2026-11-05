#!/usr/bin/env python3
"""Synthetic UNIT FIXTURES only; never export their results as live-app evidence."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('geopatch', Path(__file__).with_name('qa-geopatch-evidence.py'))
e = importlib.util.module_from_spec(spec); spec.loader.exec_module(e)
A, B = 'a'*64, 'b'*64
START, END = '2026-11-05T00:00:00Z', '2026-11-05T00:00:10Z'

def frame(stream, second, num, digest):
    return dict(stream=stream, utc=f'2026-11-05T00:00:{second:02d}Z', frameId=num, contentSha256=digest,
                decoded=True, blank=False, poseSha256=digest, jobId='unit-test',
                scenePixels={'sceneOnlyRoi': True, 'meanAbsoluteChange': 8, 'fractionPixelsChangeOver8': .2})

def geo():
    return dict(approximate=False, precision='venue', source='unit-fixture', boundsWsen=[54,24,55,25], focal={'lon':54.5,'lat':24.5},
        targetFeatureId='way/1', expectedTargetFeatureIds=['way/1'], features=[{'id':'way/1','boundsWsen':[54.1,24.1,54.9,24.9],
        'geometry':{'type':'Polygon','coordinates':[[[54.1,24.1],[54.9,24.1],[54.9,24.9],[54.1,24.1]]]}}])

class EvidenceTests(unittest.TestCase):
    def test_template_never_prepasses(self):
        r=e.aggregate(e.template(), e.OUT)
        self.assertEqual(r['status'], 'NOT_RUN'); self.assertEqual(r['counts']['PASS'], 0)
        self.assertEqual(len(e.template()['runs']),8)
    def test_empty_input_cannot_pass(self):
        self.assertNotEqual(e.aggregate({}, e.OUT)['status'], 'PASS')
    def test_claimed_execution_without_evidence_blocked(self):
        data=e.template(); data['runs'][0]['execution']='EXECUTED'
        r=e.aggregate(data,e.OUT); self.assertEqual(r['rows'][0]['status'],'BLOCKED')
    def test_unexecuted_manual_pass_blocked(self):
        data=e.template(); data['manualChecks'][0]['status']='PASS'
        r=e.aggregate(data,e.OUT); self.assertEqual(next(x for x in r['rows'] if x['id']==e.MANUAL[0])['status'],'BLOCKED')
    def test_encoding_duplicates_do_not_count(self):
        events=[frame('service',0,1,A),frame('service',1,2,B),frame('display',0,1,A),frame('display',1,1,A),frame('display',2,2,B)]
        r=e.cadence(events,START,END)
        self.assertEqual(r['genuineDisplayedTransitions'],1); self.assertEqual(r['displayedTransitionsPerSecond'],.1)
        self.assertIsNone(r['serviceFramesPerSecond'])
    def test_pose_metadata_alone_not_motion(self):
        events=[frame('service',0,1,A),frame('service',1,2,B),frame('display',0,1,A),frame('display',1,2,B)]
        events[-1]['scenePixels']={}
        self.assertEqual(e.cadence(events,START,END)['genuineDisplayedTransitions'],0)
    def test_blank_flashes_excluded(self):
        events=[frame('service',0,1,A),frame('service',1,2,B),frame('display',0,1,A),frame('display',1,2,B)]
        events[-1]['blank']=True
        r=e.cadence(events,START,END); self.assertEqual(r['genuineDisplayedTransitions'],0);self.assertEqual(r['blankSamples'],1)
    def test_unlinked_frame_identity_blocked(self):
        with self.assertRaises(LookupError): e.cadence([frame('service',0,1,A),frame('display',1,2,B)],START,END)
    def test_conflicting_service_id_hashes_fail(self):
        with self.assertRaises(ValueError):
            e.cadence([frame('service',0,1,A),frame('service',1,1,B),frame('display',1,1,A)],START,END)
    def test_unordered_events_fail(self):
        with self.assertRaises(ValueError): e.cadence([frame('display',2,2,B),frame('display',1,1,A)],START,END)
    def test_pre_rendered_playback_is_not_live_service_rate(self):
        events=[frame('service',0,1,A),frame('service',1,2,B),frame('display',5,1,A),frame('display',6,2,B)]
        r=e.cadence(events,'2026-11-05T00:00:05Z',END,{'start':START,'end':'2026-11-05T00:00:02Z'})
        self.assertEqual(r['serviceFramesPerSecond'],1);self.assertEqual(r['serviceFramesPerSecondDuringDisplayWindow'],0)
    def test_utc_timezone_required(self):
        for t in ['2026-11-05T00:00:00','2026-11-05T00:00:00+04:00']:
            with self.assertRaises(ValueError): e.stamp(t)
    def test_city_fallback_fails(self):
        g=geo();g['precision']='city'
        with self.assertRaises(ValueError):e.check_geo(g)
    def test_exact_feature_geometry_can_pass(self):
        self.assertTrue(e.check_geo(geo())[0])
    def test_bbox_and_wrong_identity_fail(self):
        for key,value in [('boundsWsen',[24,54,25,55]),('expectedTargetFeatureIds',['way/2'])]:
            g=geo();g[key]=value
            with self.assertRaises(ValueError):e.check_geo(g)
    def test_geometry_outside_declared_bounds_fails(self):
        g=geo();g['features'][0]['geometry']['coordinates'][0][0]=[55.5,24.1]
        with self.assertRaises(ValueError):e.check_geo(g)
    def test_gpu_physical_identity(self):
        g={'mapping':[],'samples':[]}
        for n in [2,6]:
            s=dict(physicalIndex=n,uuid=f'GPU-unit-{n}',pid=100+n,jobId='unit-test',utc=START,processName='blender',utilizationPct=50,memoryMiB=100)
            g['mapping'].append(copy.deepcopy(s));g['samples'].append(s)
        self.assertTrue(e.check_gpu(g,'unit-test',START,END)[0])
        g['samples'][0]['physicalIndex']=1
        with self.assertRaises(ValueError):e.check_gpu(g,'unit-test',START,END)
    def test_ttff_needs_cache_proof(self):
        with self.assertRaises(LookupError):e.check_ttff({'cacheState':'warm'})
    def test_history_and_exclusive_output(self):
        e.OUT.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='unit-fixtures-',dir=e.OUT) as d:
            d=Path(d);old={'recordings':[{'immutable':True}],'validationHistory':['old correction']}
            e.write_new(d/'prior.json',old);e.write_new(d/'report.json',{'status':'NOT_RUN'})
            new=e.append_candidate(d/'prior.json',d/'report.json')
            self.assertEqual(new['recordings'],old['recordings']);self.assertEqual(new['validationHistory'][:-1],old['validationHistory'])
            self.assertEqual(e.read(d/'prior.json'),old)
            with self.assertRaises(FileExistsError):e.write_new(d/'prior.json',{})
            with self.assertRaises(ValueError):e.write_new(e.ROOT/'DO-NOT-WRITE.json',{})
    def test_tampered_source_artifact_fails(self):
        with tempfile.TemporaryDirectory(prefix='unit-fixtures-',dir=e.OUT) as d:
            f=Path(d)/'a.json';f.write_text('{}')
            ev=e.Evidence({'artifacts':{'a':{'path':'a.json','sha256':A}}},d)
            with self.assertRaises(ValueError):ev.file('a')

if __name__=='__main__':unittest.main(verbosity=2)
