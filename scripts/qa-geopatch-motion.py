#!/usr/bin/env python3
"""Offline scene-ROI motion analysis of a REAL existing recording, never a recorder.
Uses ffprobe PTS, installed OpenCV + numpy, and prior disclosed motion thresholds.
Does not claim camera/actor identity, semantic fidelity, or per-service frame IDs.
"""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('evidence', Path(__file__).with_name('qa-geopatch-evidence.py'))
e = importlib.util.module_from_spec(spec); spec.loader.exec_module(e)


def analyze(video, roi, window, video_start_utc=None):
    import cv2
    import numpy as np
    cv2.setNumThreads(1)
    x, y, w, h = roi
    start, end = window
    if x < 0 or y < 0 or w < 1 or h < 1 or start < 0 or end <= start:
        raise ValueError('invalid scene ROI or video-time analysis window')
    if video_start_utc:
        utc_zero = e.stamp(video_start_utc)
    p = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                        '-show_entries', 'frame=best_effort_timestamp_time',
                        '-of', 'csv=p=0', str(video)], capture_output=True, text=True, timeout=120)
    if p.returncode:
        raise ValueError(p.stderr)
    times = []
    for line in p.stdout.splitlines():
        first = line.strip().split(',')[0]
        if first:
            times.append(float(first))
    if not times or any(b < a for a, b in zip(times, times[1:])):
        raise ValueError('missing/nonmonotonic decoded frame timestamps')
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise ValueError('OpenCV could not decode recording')
    if x+w > cap.get(cv2.CAP_PROP_FRAME_WIDTH) or y+h > cap.get(cv2.CAP_PROP_FRAME_HEIGHT):
        cap.release(); raise ValueError('ROI extends outside actual video dimensions')
    # PTS are absolute media timestamps; do NOT derive them from nominal FPS.
    if start < times[0] or end > times[-1] + .25:
        cap.release(); raise ValueError('analysis window extends outside video')
    previous = None
    previous_digest = None
    events, blank_spans, unique, previous_pts = [], [], set(), None
    blanks = count = decoded = 0
    blank_start = None
    blank_seconds = 0.0
    first_nonblank = None
    try:
        for i, pts in enumerate(times):
            ok, bgr = cap.read()
            if not ok:
                raise ValueError(f'decode ended before ffprobe frame {i}')
            decoded += 1
            if pts < start:
                continue
            if pts >= end:
                break
            count += 1
            crop = bgr[y:y+h, x:x+w]
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            sample = cv2.resize(gray, (384, 216), interpolation=cv2.INTER_AREA)
            sample = cv2.GaussianBlur(sample, (3, 3), 0)
            texture = float(sample.std())
            next_pts = times[i+1] if i+1 < len(times) else end
            if texture < 8.0:
                blanks += 1
                blank_seconds += max(0, min(next_pts, end)-max(pts, start))
                if blank_start is None:
                    blank_start = pts
                continue
            if blank_start is not None:
                blank_spans.append(dict(startSeconds=blank_start, endSeconds=pts))
                blank_start = None
            if first_nonblank is None:
                first_nonblank = pts
            digest = hashlib.sha256(sample.tobytes()).hexdigest()
            unique.add(digest)
            if previous is not None:
                delta = cv2.absdiff(sample, previous)
                mad = float(delta.mean())
                fraction = float(np.mean(delta > 8))
                if mad >= 1.0 and fraction >= .03:
                    flow = cv2.calcOpticalFlowFarneback(previous, sample, None, .5, 3, 15, 3, 5, 1.2, 0)
                    mag = np.linalg.norm(flow, axis=2)
                    event = dict(videoTimeSeconds=pts, previousVideoTimeSeconds=previous_pts,
                                 previousProcessedPixelSha256=previous_digest, processedPixelSha256=digest,
                                 meanAbsoluteChange=mad, fractionPixelsChangeOver8=fraction,
                                 opticalFlowMedianPixels=float(np.median(mag)),
                                 opticalFlowP90Pixels=float(np.percentile(mag,90)), sceneOnlyRoi=True)
                    if video_start_utc:
                        event['utc'] = dt.datetime.fromtimestamp(utc_zero+pts, dt.timezone.utc).isoformat()
                    events.append(event)
            previous = sample
            previous_digest = digest
            previous_pts = pts
        if blank_start is not None:
            blank_spans.append(dict(startSeconds=blank_start, endSeconds=end))
    finally:
        cap.release()
    points = [start] + [x['videoTimeSeconds'] for x in events] + [end]
    result = dict(schemaVersion=1, status='PASS' if count and first_nonblank is not None else 'FAIL',
                  scope='offline scene-pixel measurement only', evaluatedUtc=e.utcnow(),
                  sourcePath=str(Path(video).resolve()), sourceSha256=e.sha(video),
                  roiPixels=dict(x=x,y=y,width=w,height=h), sampleDimensions=[384,216],
                  analysisWindowSeconds=dict(start=start,end=end,duration=end-start),
                  analyzedFrames=count, decodedFramesUntilWindowEnd=decoded,
                  nonblankFrames=count-blanks, blankFrames=blanks, blankSeconds=blank_seconds,
                  blankSpans=blank_spans, materialTransitions=len(events),
                  displayedPixelTransitionsPerSecond=len(events)/(end-start),
                  maximumObservedStaticHoldSeconds=max(b-a for a,b in zip(points,points[1:])),
                  exactUniqueProcessedCrops=len(unique), firstNonblankVideoSeconds=first_nonblank,
                  events=events,
                  method='ffprobe native decoded PTS; grayscale ROI resized 384x216 (area), blurred 3x3; reject std<8; MAD>=1 AND fraction(absdiff>8)>=0.03; Farneback flow on material nonblank pairs.',
                  limitations=['Supplied ROI must be independently verified as scene-only, without changing overlays.',
                      'Pixel measurements are not proof of live UI provenance, frame ID, render speed, actor motion, or exact geography.',
                      'Exact processed crop hashes include codec noise: use material transitions, not unique-hash count.',
                      'Reimplementation of disclosed thresholds; not a byte-for-byte reproduction of the original analyzer.',
                      'PASS means analysis executed on nonblank pixels, NOT that playback is realtime/smooth.'])
    if video_start_utc:
        result['windowUtc'] = {key:dt.datetime.fromtimestamp(utc_zero+val,dt.timezone.utc).isoformat() for key,val in [('start',start),('end',end)]}
    return result


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--video',required=True)
    ap.add_argument('--roi',required=True,help='scene-only x,y,width,height in actual recording pixels')
    ap.add_argument('--window',required=True,help='start,end in native video PTS seconds')
    ap.add_argument('--video-start-utc',help='UTC corresponding to media PTS 0; not necessarily recorder process start')
    ap.add_argument('--out',required=True)
    a=ap.parse_args()
    result=analyze(a.video,tuple(map(int,a.roi.split(','))),tuple(map(float,a.window.split(','))),a.video_start_utc)
    e.write_new(a.out,result)
    print(json.dumps({k:result[k] for k in ['status','scope','materialTransitions','displayedPixelTransitionsPerSecond','blankSeconds','maximumObservedStaticHoldSeconds']}))
    return 0 if result['status']=='PASS' else 1


if __name__=='__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, ModuleNotFoundError, subprocess.TimeoutExpired) as exc:
        print(f'{type(exc).__name__}: {exc}',file=sys.stderr)
        sys.exit(2)
