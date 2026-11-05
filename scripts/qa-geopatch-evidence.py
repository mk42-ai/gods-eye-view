#!/usr/bin/env python3
"""Offline evidence checks. Never starts a browser, fetches a URL, or submits a render.

Input records are observations, not proof by themselves. PASS means the named
check ran on supplied artifacts; it is NOT a blanket claim about the live app.
All writes are new files under ops/cycle-geopatch. See its README for contracts.
"""
import argparse
import copy
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'ops/cycle-geopatch'
PROMPTS = ['Car crash outside Yas Mall', "Kane's Boxing Gym, Abu Dhabi"]
VIEWPORTS = [[1440, 900], [390, 844]]
KEYS = 'v lat lon alt heading pitch roll style bloom sharpen bi bv si hud hv dm dd da kf ko cr sc scf map l lo ui'.split()
STATUSES = ['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN']
MANUAL = [
    'source-build-live-byte-match', 'render-host-source-version',
    'prompt-multiline-and-keyboard-submit', 'aoi-footprint-road-water-alignment',
    'inspector-evidence-attribution', 'camera-controls-actual-pose-change',
    'timeline-play-pause-scrub-no-blank-flashes', 'assets-applied-not-only-listed',
    'current-recordings-are-unaltered-live-ui', 'geography-independent-target-review',
    'proxy-range-content-type-cache-isolation', 'failure-and-retry-no-stale-job',
]


def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def stamp(value):
    if not isinstance(value, str):
        raise ValueError('UTC timestamp missing')
    t = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if t.tzinfo is None or t.utcoffset() != dt.timedelta(0):
        raise ValueError('timestamps must explicitly use UTC (Z or +00:00)')
    return t.timestamp()


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def write_new(path, data):
    path = Path(path).resolve()
    if not path.is_relative_to(OUT.resolve()):
        raise ValueError(f'Output must be under {OUT}')
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as f:
        json.dump(data, f, indent=2, ensure_ascii=False, allow_nan=False)
        f.write('\n')


def row(id_, status, reason, observed=None, refs=None):
    assert status in STATUSES
    return dict(id=id_, status=status, reason=reason, observed=observed,
                evidenceRefs=refs or [], evaluatedUtc=utcnow() if status != 'NOT_RUN' else None)


def finite(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def digest(x):
    return isinstance(x, str) and re.fullmatch(r'[a-f0-9]{64}', x) is not None


def bounds(b):
    return (isinstance(b, list) and len(b) == 4 and all(finite(x) for x in b)
            and -180 <= b[0] < b[2] <= 180 and -90 <= b[1] < b[3] <= 90)


def contains(outer, inner):
    return all([inner[0] >= outer[0], inner[1] >= outer[1],
                inner[2] <= outer[2], inner[3] <= outer[3]])


def coordinate_pairs(value):
    if not isinstance(value, list):
        raise ValueError('GeoJSON coordinates must be arrays')
    if len(value) >= 2 and finite(value[0]) and finite(value[1]):
        yield value[:2]
    else:
        for child in value:
            yield from coordinate_pairs(child)


class Evidence:
    def __init__(self, data, directory):
        self.data, self.directory = data, Path(directory)
        self.artifacts = data.get('artifacts', {})

    def file(self, ref):
        a = self.artifacts.get(ref)
        if not isinstance(a, dict) or not a.get('path') or not digest(a.get('sha256')):
            raise LookupError(f'artifact {ref!r} missing path/SHA-256')
        path = (self.directory / a['path']).resolve()
        if not path.is_file() or not path.stat().st_size:
            raise LookupError(f'artifact {ref!r} missing/empty: {path}')
        if sha(path) != a['sha256']:
            raise ValueError(f'artifact {ref!r} SHA-256 mismatch')
        return path

    def verify(self, refs):
        if not isinstance(refs, list) or not refs:
            raise LookupError('no source evidence references')
        for ref in refs:
            self.file(ref)

    def json(self, ref):
        return read(self.file(ref))


def safely(id_, fn, refs=None):
    try:
        ok, detail = fn()
        return row(id_, 'PASS' if ok else 'FAIL', 'Check executed on supplied evidence', detail, refs)
    except LookupError as exc:
        return row(id_, 'BLOCKED', str(exc), refs=refs)
    except (ValueError, TypeError, KeyError, IndexError, OSError) as exc:
        return row(id_, 'FAIL', f'{type(exc).__name__}: {exc}', refs=refs)


def cadence(events, start, end, service_window=None):
    """Three separate rates; frame IDs alone or CFR video frames are not motion."""
    lo, hi = stamp(start), stamp(end)
    if hi <= lo:
        raise ValueError('nonpositive measurement window')
    streams = {k: [] for k in ['display', 'service', 'transport']}
    for e in events:
        if e.get('stream') not in streams:
            raise ValueError('event stream must be display/service/transport')
        t = stamp(e.get('utc'))
        if e['stream'] == 'display' and not lo <= t <= hi:
            raise ValueError('display event outside measurement window')
        streams[e['stream']].append(e)
    for name, items in streams.items():
        if any(stamp(b['utc']) < stamp(a['utc']) for a, b in zip(items, items[1:])):
            raise ValueError(f'{name} events out of timestamp order')
    display = streams['display']
    service = streams['service']
    if not display or not service:
        raise LookupError('need display observations AND service frame identity evidence')
    for e in display + service:
        if e.get('frameId') is None or not digest(e.get('contentSha256')):
            raise LookupError('canonical content SHA-256/frameId missing; counters alone cannot prove motion')
    render_keys = {(str(e['frameId']), e['contentSha256']) for e in service}
    if len({key[0] for key in render_keys}) != len(render_keys):
        raise ValueError('service frame IDs are not immutable: one ID has conflicting hashes')
    visible = [e for e in display if e.get('decoded') is True and e.get('blank') is False]
    if not visible:
        raise ValueError('no successfully decoded nonblank displayed frame')
    unlinked = [e['frameId'] for e in visible if (str(e['frameId']), e['contentSha256']) not in render_keys]
    if unlinked:
        raise LookupError(f'display IDs/hashes do not link to service frames: {unlinked[:8]}')
    id_changes = content_changes = pose_changes = genuine = 0
    change_times = [lo]
    for a, b in zip(visible, visible[1:]):
        ic = str(a['frameId']) != str(b['frameId'])
        hc = a['contentSha256'] != b['contentSha256']
        pc = digest(a.get('poseSha256')) and digest(b.get('poseSha256')) and a['poseSha256'] != b['poseSha256']
        pixel = b.get('scenePixels', {})
        material = (finite(pixel.get('meanAbsoluteChange')) and pixel['meanAbsoluteChange'] >= 1.0
                    and finite(pixel.get('fractionPixelsChangeOver8')) and pixel['fractionPixelsChangeOver8'] >= .03
                    and pixel.get('sceneOnlyRoi') is True)
        id_changes += ic
        content_changes += hc
        pose_changes += bool(pc)
        if ic and hc and material:
            genuine += 1
            change_times.append(stamp(b['utc']))
    change_times.append(hi)
    seconds = hi - lo
    service_seconds = None
    if service_window:
        service_lo, service_hi = stamp(service_window['start']), stamp(service_window['end'])
        if service_hi <= service_lo or any(not service_lo <= stamp(e['utc']) <= service_hi for e in service):
            raise ValueError('invalid service render measurement window')
        service_seconds = service_hi - service_lo
    concurrent_service = {(str(e['frameId']), e['contentSha256']) for e in service if lo <= stamp(e['utc']) <= hi}
    concurrent_transport = [e for e in streams['transport'] if lo <= stamp(e['utc']) <= hi]
    return dict(windowStartUtc=start, windowEndUtc=end, windowSeconds=seconds,
                displayedSamples=len(display), nonblankDecodedSamples=len(visible),
                blankSamples=sum(e.get('blank') is True for e in display),
                frameIdTransitions=id_changes, contentHashTransitions=content_changes,
                poseTransitions=pose_changes, genuineDisplayedTransitions=genuine,
                displayedTransitionsPerSecond=genuine / seconds,
                maximumObservedStaticHoldSeconds=max(b-a for a, b in zip(change_times, change_times[1:])),
                serviceUniqueFrameCompletions=len(render_keys), serviceWindowUtc=service_window,
                serviceFramesPerSecond=(len(render_keys) / service_seconds) if service_seconds else None,
                serviceCompletionsDuringDisplayWindow=len(concurrent_service),
                serviceFramesPerSecondDuringDisplayWindow=len(concurrent_service) / seconds,
                transportEvents=len(concurrent_transport), transportEventsPerSecond=len(concurrent_transport) / seconds,
                note='Sampled observations give a lower bound unless collected at each presentation. Video FPS is separate. Pose change corroborates camera motion, not actor animation.')


def check_geo(g):
    if not isinstance(g, dict) or not g:
        raise LookupError('geography evidence missing')
    if g.get('approximate') is not False or g.get('precision') not in ['venue', 'building', 'address', 'rooftop', 'exact', 'landmark']:
        raise ValueError('city/district/approximate or unknown precision is unacceptable')
    if not g.get('source') or not bounds(g.get('boundsWsen')):
        raise ValueError('source and ordered WGS84 [west,south,east,north] required')
    b = g['boundsWsen']
    f = g.get('focal', {})
    if not finite(f.get('lon')) or not finite(f.get('lat')) or not (b[0] <= f['lon'] <= b[2] and b[1] <= f['lat'] <= b[3]):
        raise ValueError('focal point outside AOI or malformed coordinates')
    features = g.get('features', [])
    if not features or not g.get('targetFeatureId') or not g.get('expectedTargetFeatureIds'):
        raise LookupError('provider feature geometry/target ID/independently reviewed expected IDs missing')
    ids = []
    for feature in features:
        id_ = feature.get('id')
        if not id_ or id_ in ids:
            raise ValueError('missing/duplicate source feature IDs')
        ids.append(id_)
        if not bounds(feature.get('boundsWsen')) or not contains(b, feature['boundsWsen']):
            raise ValueError(f'feature {id_} bounds not clipped to AOI')
        points = list(coordinate_pairs(feature.get('geometry', {}).get('coordinates')))
        if not points:
            raise LookupError(f'feature {id_} has no geometry coordinates')
        for lon, lat in points:
            fb = feature['boundsWsen']
            if not (fb[0] <= lon <= fb[2] and fb[1] <= lat <= fb[3]):
                raise ValueError(f'feature {id_} geometry outside declared bounds')
    if g['targetFeatureId'] not in ids or g['targetFeatureId'] not in g['expectedTargetFeatureIds']:
        raise ValueError('resolved target does not match independently reviewed provider identity')
    return True, dict(source=g['source'], targetFeatureId=g['targetFeatureId'], featureIds=ids, boundsWsen=b,
                      note='Structural bounds/identity check only; independent site/footprint alignment review is separately required.')


def check_gpu(g, job, start, end):
    if not g.get('mapping') or not g.get('samples'):
        raise LookupError('physical-index↔UUID↔job-process mapping and active-window samples required')
    lo, hi = stamp(start), stamp(end)
    mapping = {(m.get('physicalIndex'), m.get('uuid'), m.get('pid')) for m in g['mapping'] if m.get('jobId') == job}
    if not mapping:
        raise LookupError('mapping does not identify this job')
    used = set()
    for s in g['samples']:
        if s.get('jobId') != job:
            continue  # Other workloads are not a violation by this job.
        key = (s.get('physicalIndex'), s.get('uuid'), s.get('pid'))
        if key not in mapping or s.get('physicalIndex') not in [2, 6]:
            raise ValueError('job process unmapped or running outside physical GPUs 2/6')
        if not isinstance(s.get('uuid'), str) or not s['uuid'].startswith('GPU-') or not isinstance(s.get('pid'), int) or s['pid'] <= 0:
            raise ValueError('UUID/PID not valid')
        if 'blender' not in s.get('processName', '').lower():
            raise ValueError('not attributable to a Blender process')
        if not lo <= stamp(s.get('utc')) <= hi:
            raise ValueError('GPU sample outside render window')
        if not finite(s.get('utilizationPct')) or not 0 <= s['utilizationPct'] <= 100 or not finite(s.get('memoryMiB')) or s['memoryMiB'] < 0:
            raise ValueError('GPU utilization/memory telemetry missing or invalid')
        used.add(s['physicalIndex'])
    if used != {2, 6}:
        raise LookupError('need attributable active-window evidence for both physical GPUs 2 and 6')
    return True, dict(physicalGpuIndices=sorted(used), mappedProcesses=len(mapping),
                      note='Index means host PCI_BUS_ID physical index, not CUDA_VISIBLE_DEVICES ordinal.')


def check_ttff(run):
    t = run.get('ttff', {})
    if run.get('cacheState') not in ['cold', 'warm'] or not t.get('cacheEvidenceRef'):
        raise LookupError('documented cold/warm cache preparation missing')
    keys = ['clientSubmitUtc', 'firstDecodedUtc', 'serviceAcceptedUtc', 'firstServiceFrameUtc']
    if any(not t.get(k) for k in keys):
        raise LookupError('need client submit→first decoded and service accept→first completed timestamps')
    client = stamp(t['firstDecodedUtc']) - stamp(t['clientSubmitUtc'])
    service = stamp(t['firstServiceFrameUtc']) - stamp(t['serviceAcceptedUtc'])
    if client < 0 or service < 0:
        raise ValueError('negative TTFF')
    return True, dict(cacheState=run['cacheState'], clientTtffSeconds=client, serviceTtffSeconds=service,
                      note='Within-clock durations only; do not subtract clocks from different hosts without offset evidence.')


def check_ui(report, viewport):
    assertions = report.get('assertions', [])
    if not assertions:
        raise LookupError('no executed UI assertions')
    required = ['#ws-aoi', '#ws-evidence', '#ws-camera']
    covered = all(any(a.get('kind') == 'expect-selector' and a.get('target') == s for a in assertions) for s in required)
    prompt = any(a.get('kind') == 'eval' and 'ws-prompt' in a.get('target', '') and 'TEXTAREA' in a.get('target', '') for a in assertions)
    shot_suffix = f'-{viewport[0]}x{viewport[1]}.png'
    vp = any(str(s).endswith(shot_suffix) for s in report.get('screenshots', []))
    if not covered or not prompt or not vp:
        raise LookupError('required request-specific assertions/viewport screenshot are absent')
    ok = (report.get('ok') is True and all(a.get('ok') is True for a in assertions)
          and not report.get('consoleErrors') and not report.get('pageErrors') and not report.get('failedRequests'))
    return ok, dict(assertionCount=len(assertions), screenshots=report.get('screenshots'),
                    note='Validator DOM assertions, not proof of recording, precise geography, or sustained FPS.')


def template():
    runs = []
    for pi, prompt in enumerate(PROMPTS):
        for vp in VIEWPORTS:
            for cache in ['cold', 'warm']:
                runs.append(dict(id=f'prompt-{pi+1}-{vp[0]}x{vp[1]}-{cache}', prompt=prompt,
                                 viewport=vp, cacheState=cache, execution='NOT_RUN', reason='Await integration',
                                 evidenceRefs=[], jobId=None, url=None, windowUtc={}, frames=[], geo={}, gpu={}, ttff={}, ui={}))
    return dict(schemaVersion=1, cycleId='geopatch', policy={'minimumObservationSeconds': 10,
                'minimumDisplayedTransitionsPerSecond': None}, artifacts={}, runs=runs,
                camera=[], recordings=[dict(prompt=p, execution='NOT_RUN', reason='No sanctioned recording method available', evidenceRefs=[]) for p in PROMPTS],
                manualChecks=[dict(id=x, status='NOT_RUN', reason='Not executed', evidenceRefs=[]) for x in MANUAL])


def aggregate(data, directory):
    ev = Evidence(data, directory)
    rows = []
    run_checks = ['identity', 'ui', 'display-motion', 'realtime-target', 'ttff', 'geography', 'gpu']
    for run in data.get('runs', []):
        prefix, refs = run.get('id', 'missing-run-id'), run.get('evidenceRefs', [])
        execution = run.get('execution', 'NOT_RUN')
        if execution not in ['EXECUTED', 'NOT_RUN', 'BLOCKED']:
            rows.append(row(prefix + ':execution', 'FAIL', 'Invalid execution status')); continue
        if execution != 'EXECUTED':
            rows.extend(row(prefix + ':' + k, execution, run.get('reason') or 'Not executed', refs=refs) for k in run_checks)
            continue

        def identity():
            ev.verify(refs)
            if run.get('prompt') not in PROMPTS or run.get('viewport') not in VIEWPORTS or not run.get('jobId'):
                raise ValueError('exact prompt, viewport, and jobId required')
            if not str(run.get('url', '')).startswith(('http://', 'https://')):
                raise ValueError('actual application URL required')
            if any(e.get('jobId') != run['jobId'] for e in run.get('frames', [])):
                raise ValueError('cross-job frame contamination')
            lo, hi = (stamp(run['windowUtc'][k]) for k in ['start', 'end'])
            if hi <= lo:
                raise ValueError('measurement window must have positive duration')
            return True, {k: run[k] for k in ['prompt', 'viewport', 'jobId', 'url', 'cacheState', 'windowUtc']}
        identity_row = safely(prefix + ':identity', identity, refs)
        rows.append(identity_row)
        if identity_row['status'] != 'PASS':
            rows.extend(row(prefix + ':' + k, 'BLOCKED', 'Run identity/evidence prerequisites failed', refs=refs) for k in run_checks[1:])
            continue
        window = run['windowUtc']
        rows.append(safely(prefix + ':ui', lambda: check_ui(ev.json(run.get('ui', {}).get('reportRef')), run['viewport']), refs))
        motion = safely(prefix + ':display-motion', lambda: (lambda x: (x['genuineDisplayedTransitions'] > 0 and x['windowSeconds'] >= data.get('policy', {}).get('minimumObservationSeconds', 10), x))(cadence(run.get('frames', []), window['start'], window['end'], run.get('serviceWindowUtc'))), refs)
        rows.append(motion)
        rate_target = data.get('policy', {}).get('minimumDisplayedTransitionsPerSecond')
        if not finite(rate_target) or rate_target <= 0 or motion['status'] != 'PASS':
            rows.append(row(prefix + ':realtime-target', 'BLOCKED', 'Explicit positive acceptance target and valid measured motion required; encoding FPS is not a target', refs=refs))
        else:
            rows.append(row(prefix + ':realtime-target', 'PASS' if motion['observed']['displayedTransitionsPerSecond'] >= rate_target else 'FAIL', 'Compared genuine displayed transitions/sec, not service/transport/encoding FPS', dict(target=rate_target, measured=motion['observed']['displayedTransitionsPerSecond']), refs))
        def ttff():
            ev.file(run.get('ttff', {}).get('cacheEvidenceRef'))
            return check_ttff(run)
        def geo():
            ev.verify(run.get('geo', {}).get('evidenceRefs'))
            return check_geo(run.get('geo', {}))
        def gpu():
            ev.verify(run.get('gpu', {}).get('evidenceRefs'))
            interval = run.get('gpu', {}).get('renderWindowUtc', {})
            return check_gpu(run.get('gpu', {}), run['jobId'], interval.get('start'), interval.get('end'))
        rows.extend([safely(prefix + ':ttff', ttff, refs), safely(prefix + ':geography', geo, refs), safely(prefix + ':gpu', gpu, refs)])
    # Coverage cannot be satisfied by absence, duplicate runs, or a different prompt.
    present = [(r.get('prompt'), tuple(r.get('viewport', [])), r.get('cacheState')) for r in data.get('runs', []) if r.get('execution') == 'EXECUTED']
    expected = [(p, tuple(v), c) for p in PROMPTS for v in VIEWPORTS for c in ['cold', 'warm']]
    missing = [list(x) for x in expected if x not in present]
    rows.append(row('exact-prompt-viewport-cache-coverage', 'NOT_RUN' if not present else ('BLOCKED' if missing else 'PASS'), 'Eight distinct executed measurement cases required; per-case checks remain independent', {'missing': missing}))
    from urllib.parse import parse_qsl
    for vp in VIEWPORTS:
        id_ = f'camera-hash-roundtrip-{vp[0]}x{vp[1]}'
        matches = [c for c in data.get('camera', []) if c.get('viewport') == vp]
        if not matches:
            rows.append(row(id_, 'NOT_RUN', 'No current boot/reload observation')); continue
        c = matches[-1]
        if c.get('execution') != 'EXECUTED':
            rows.append(row(id_, 'BLOCKED' if c.get('execution') == 'BLOCKED' else 'NOT_RUN', c.get('reason', 'Not executed'))); continue
        def camera():
            ev.verify(c.get('evidenceRefs'))
            source = (ROOT / 'scripts/qa-scene-videos.mjs').read_text()
            fixture = re.search(r'''export const APPROVED_HASH\s*=\s*['"]([^'"]+)''', source)
            if not fixture:
                raise LookupError('canonical approved camera fixture unavailable')
            canonical = dict(parse_qsl(fixture[1].lstrip('#'), keep_blank_values=True))
            hashes = [parse_qsl(c.get(k, '').lstrip('#'), keep_blank_values=True) for k in ['expectedHash', 'bootHash', 'reloadedHash']]
            if any(len(h) != 27 or sorted(k for k, v in h) != sorted(KEYS) for h in hashes):
                raise ValueError('All observations need exactly the 27 keys, including empty l= and no duplicates')
            return canonical == dict(hashes[0]) == dict(hashes[1]) == dict(hashes[2]), {'keys': KEYS, 'expected': dict(hashes[0]), 'boot': dict(hashes[1]), 'reloaded': dict(hashes[2])}
        rows.append(safely(id_, camera, c.get('evidenceRefs')))
    for i, prompt in enumerate(PROMPTS):
        id_ = f'live-ui-recording-prompt-{i+1}'
        matches = [r for r in data.get('recordings', []) if r.get('prompt') == prompt]
        r = matches[-1] if matches else {}
        if r.get('execution') != 'EXECUTED':
            rows.append(row(id_, 'BLOCKED' if r.get('execution') == 'BLOCKED' else 'NOT_RUN', r.get('reason', 'Fresh recording absent'))); continue
        def recording():
            ev.verify(r.get('evidenceRefs'))
            video = ev.file(r.get('videoRef')); original = ev.file(r.get('originalRef'))
            probe = ev.json(r.get('probeRef')); provenance = ev.json(r.get('provenanceRef'))
            if probe.get('sha256') != sha(video) or provenance.get('originalSha256') != sha(original):
                raise ValueError('probe/provenance belongs to different video bytes')
            if probe.get('status') != 'PASS':
                raise ValueError('H.264/full decode/faststart format checks did not pass')
            if provenance.get('kind') != 'continuous-live-ui' or provenance.get('prompt') != prompt:
                raise ValueError('not exact-prompt continuous live UI provenance')
            if provenance.get('synthetic') is not False or provenance.get('timeScale') != 1:
                raise ValueError('synthetic/time-scaled capture or no explicit declaration')
            elapsed = stamp(provenance.get('endUtc')) - stamp(provenance.get('startUtc'))
            if elapsed <= 0 or abs(probe['durationSeconds'] - elapsed) > max(.25, elapsed * .01):
                raise ValueError('video duration differs from captured wall time')
            if provenance.get('actualViewport') not in VIEWPORTS or provenance.get('letterboxed') is not False:
                raise ValueError('actual viewport must match required size; padding is not viewport proof')
            ev.file(provenance.get('uiObservationRef'))
            return True, dict(durationSeconds=probe['durationSeconds'], codec='h264',
                              note='Format/provenance consistency only. Independent current-recordings-are-unaltered-live-ui review also required.')
        rows.append(safely(id_, recording, r.get('evidenceRefs')))
    manual = {m.get('id'): m for m in data.get('manualChecks', [])}
    for id_ in MANUAL:
        m = manual.get(id_, {})
        status = m.get('status', 'NOT_RUN')
        refs = m.get('evidenceRefs', [])
        if status in ['PASS', 'FAIL']:
            try:
                ev.verify(refs); stamp(m.get('executedUtc'))
                if not m.get('reviewer') or not m.get('reason'):
                    raise LookupError('executed manual review needs reviewer, UTC, evidence and explanation')
                rows.append(row(id_, status, m['reason'], m.get('observed'), refs))
            except LookupError as exc:
                rows.append(row(id_, 'BLOCKED', str(exc), refs=refs))
            except (ValueError, OSError) as exc:
                rows.append(row(id_, 'FAIL', str(exc), refs=refs))
        else:
            rows.append(row(id_, status if status in STATUSES else 'FAIL', m.get('reason', 'Not executed'), refs=refs))
    counts = {s: sum(r['status'] == s for r in rows) for s in STATUSES}
    overall = 'FAIL' if counts['FAIL'] else 'BLOCKED' if counts['BLOCKED'] else 'NOT_RUN' if counts['NOT_RUN'] else 'PASS'
    return dict(schemaVersion=1, cycleId=data.get('cycleId'), generatedUtc=utcnow(), status=overall,
                counts=counts, rows=rows, limitation='Offline artifact checks only. No browser run/render was performed by this tool.')


def probe_video(path):
    path = Path(path).resolve()
    if not shutil.which('ffprobe') or not shutil.which('ffmpeg'):
        return dict(status='BLOCKED', reason='ffprobe/ffmpeg unavailable')
    p = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)], capture_output=True, text=True, timeout=90)
    if p.returncode:
        return dict(status='FAIL', reason=p.stderr[-2000:])
    info = json.loads(p.stdout)
    videos = [s for s in info['streams'] if s.get('codec_type') == 'video']
    if not videos:
        return dict(status='FAIL', reason='no video stream')
    v = videos[0]
    decode = subprocess.run(['ffmpeg', '-hide_banner', '-v', 'error', '-nostdin', '-xerror', '-i', str(path), '-map', '0:v:0', '-an', '-fps_mode', 'passthrough', '-f', 'null', '-'], capture_output=True, text=True, timeout=300)
    atoms = []
    with path.open('rb') as f:
        length = path.stat().st_size
        while f.tell() + 8 <= length:
            offset = f.tell(); hdr = f.read(8); size = int.from_bytes(hdr[:4], 'big'); name = hdr[4:].decode('ascii', errors='replace')
            if size == 1:
                size = int.from_bytes(f.read(8), 'big')
            if size == 0:
                size = length - offset
            if size < 8 or offset + size > length:
                break
            atoms.append({'type': name, 'offset': offset, 'size': size}); f.seek(offset + size)
    positions = {a['type']: a['offset'] for a in atoms}
    faststart = 'moov' in positions and 'mdat' in positions and positions['moov'] < positions['mdat']
    duration = float(info.get('format', {}).get('duration') or v.get('duration') or 0)
    ok = v.get('codec_name') == 'h264' and v.get('pix_fmt') == 'yuv420p' and decode.returncode == 0 and not decode.stderr.strip() and duration > 0 and faststart
    return dict(status='PASS' if ok else 'FAIL', kind='media-format-only', evaluatedUtc=utcnow(), path=str(path),
                sha256=sha(path), bytes=path.stat().st_size, codec=v.get('codec_name'), pixelFormat=v.get('pix_fmt'),
                width=v.get('width'), height=v.get('height'), durationSeconds=duration,
                encodingFrameRate=v.get('avg_frame_rate'), fastStart=faststart, atoms=atoms,
                fullDecodeExit=decode.returncode, decodeStderr=decode.stderr[-2000:],
                limitation='Encoding cadence and successful decoding prove neither live capture nor genuine scene motion nor actual DOM viewport.')


def append_candidate(prior_path, report_path):
    old = read(prior_path); candidate = copy.deepcopy(old)
    if not isinstance(candidate.get('validationHistory', []), list):
        raise ValueError('prior validationHistory must be preserved as an array')
    candidate.setdefault('validationHistory', []).append(dict(utc=utcnow(), kind='geopatch-independent-audit',
        priorArtifactSha256=sha(prior_path), reportSha256=sha(report_path), report=read(report_path)))
    candidate['updatedUtc'] = utcnow()
    assert candidate.get('recordings') == old.get('recordings')
    assert candidate['validationHistory'][:-1] == old.get('validationHistory', [])
    return candidate


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest='command', required=True)
    p = sub.add_parser('init'); p.add_argument('--out', required=True)
    p = sub.add_parser('aggregate'); p.add_argument('--input', required=True); p.add_argument('--out', required=True)
    p = sub.add_parser('probe-video'); p.add_argument('--video', required=True); p.add_argument('--out', required=True)
    p = sub.add_parser('append-candidate'); p.add_argument('--prior', required=True); p.add_argument('--report', required=True); p.add_argument('--out', required=True)
    args = ap.parse_args()
    if args.command == 'init':
        result = template()
    elif args.command == 'aggregate':
        result = aggregate(read(args.input), Path(args.input).resolve().parent)
        result['inputSha256'] = sha(args.input)
    elif args.command == 'probe-video':
        result = probe_video(args.video)
    else:
        if Path(args.out).resolve() == Path(args.prior).resolve():
            raise ValueError('cannot overwrite prior artifact')
        result = append_candidate(args.prior, args.report)
    write_new(args.out, result)
    print(json.dumps({'output': str(Path(args.out).resolve()), 'status': result.get('status'), 'counts': result.get('counts')}))
    if args.command in ['aggregate', 'probe-video']:
        return {'PASS': 0, 'FAIL': 1, 'BLOCKED': 2, 'NOT_RUN': 3}[result['status']]
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as exc:
        print(f'{type(exc).__name__}: {exc}', file=sys.stderr)
        sys.exit(2)
