"""Mutation check of the planes path: re-introduce a cause into a COPY of export.py / ridge.py (relight_planes) and run the planes/export tests of test_ridge.py (PLANES_TESTS) against it; a mutant must fail at least one.
  RIDGE_TILES=<tiles> RIDGE_WORK=<dir> venv/bin/python -I tests/mutate_export.py [JOBS=4 and ONLY=<name substring>[|<another>] in the environment]      (prints one line per mutant as it lands; exit 1 if one survives)
Each mutant runs under a 12 GB address-space cap and a 20 minute limit.  Equivalent mutants are named in EQUIVALENT with the argument; they are reported but do not fail the run."""
import os, sys, shutil, subprocess, tempfile, resource
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__)); SRC = os.path.join(HERE, '..')
EQUIVALENT = {'decode budget cap is exclusive': 'decoded = 2 * 3 * w * h * 4 is a multiple of 24 and 20_000_000 is not (20_000_000 / 24 = 833333.33), so decoded == DECODE_BYTES_MAX never holds for integer w and h and > equals >='}
M = {
 'no per-channel ref correction (P = X)': ('ridge.py', 'P = X + ref_w[None] * (Yc - Y[..., None])', 'P = X'),
 'alpha ignores haze (alpha = cov)': ('ridge.py', 'alpha = np.clip(win(cov) - Y, 0, 1)', 'alpha = np.clip(win(cov), 0, 1)'),
 'alpha from the max haze channel': ('ridge.py', 'Y = Yc.mean(-1); alpha', 'Y = Yc.max(-1); alpha'),
 'haze share halved in alpha': ('ridge.py', 'alpha = np.clip(win(cov) - Y, 0, 1)', 'alpha = np.clip(win(cov) - 0.5 * Y, 0, 1)'),
 'default ref = the sky horizon colour, not the haze colour': ('ridge.py', 'ref = haze_colour(sky_hz(st, paperf)[1]) if ref is None', 'ref = sky_hz(st, paperf)[1] if ref is None'),
 'default ref = mid grey': ('ridge.py', 'ref = haze_colour(sky_hz(st, paperf)[1]) if ref is None', 'ref = np.full((W, 3), 0.5) if ref is None'),
 'grain dropped from the planes': ('ridge.py', 'P / np.maximum(alpha, 1e-4)[..., None], 0.0) * win(grain)[..., None]', 'P / np.maximum(alpha, 1e-4)[..., None], 0.0)'),
 'grain squared': ('ridge.py', 'P / np.maximum(alpha, 1e-4)[..., None], 0.0) * win(grain)[..., None]', 'P / np.maximum(alpha, 1e-4)[..., None], 0.0) * win(grain)[..., None] ** 2'),
 'floor dropped from far': ('ridge.py', "if name == 'far' else np.zeros_like(r[0]) for r in runs]", "if False else np.zeros_like(r[0]) for r in runs]"),
 'mid = only the first middle slot': ('ridge.py', 'mid=list(range(1, n - 1))', 'mid=[1]'),
 'cast shadows off in planes': ('ridge.py', 'shs = cast_shadows(layers, az, el) if shadows else [None] * len(layers); out = {}', 'shs = [None] * len(layers); out = {}'),
 'encode premultiplies colour': ('export.py', 'def encode(plane): return bytes(imagecodecs.webp_encode(u8(plane)', 'def encode(plane): return bytes(imagecodecs.webp_encode(u8(np.concatenate([plane[..., :3] * plane[..., 3:], plane[..., 3:]], -1))'),
 'encode drops alpha': ('export.py', 'def encode(plane): return bytes(imagecodecs.webp_encode(u8(plane)', 'def encode(plane): return bytes(imagecodecs.webp_encode(u8(plane)[..., :3]'),
 'encode quality 5': ('export.py', 'WEBP_QUALITY = 80', 'WEBP_QUALITY = 5'),
 'encode flips rows': ('export.py', 'def encode(plane): return bytes(imagecodecs.webp_encode(u8(plane)', 'def encode(plane): return bytes(imagecodecs.webp_encode(u8(plane)[::-1].copy()'),
 'night at -6 deg': ('export.py', 'NIGHT_EL = -12.0', 'NIGHT_EL = -6.0'),
 'golden at 10 deg': ('export.py', 'golden=find(6.0, noon, noon + 9)', 'golden=find(10.0, noon, noon + 9)'),
 'altitude includes eye height': ('export.py', "altitude_km=p['ground_m'] / 1000.0", "altitude_km=(p['ground_m'] + p['eye_m']) / 1000.0"),
 'horizon_row in the wrong unit (degrees)': ('export.py', "horizon_row=v['horizon_row']", "horizon_row=v['top_deg']"),
 'manifest plane h lies': ('export.py', 'w=w, h=h) for n in PLANES}', 'w=w, h=h + 1) for n in PLANES}'),
 'manifest plane w from the constant': ('export.py', 'w=w, h=h) for n in PLANES}', 'w=PLANE_W, h=h) for n in PLANES}'),
 'manifest view plane_w from the constant': ('export.py', 'window_deg=WINDOW_DEG, plane_w=w)', 'window_deg=WINDOW_DEG, plane_w=PLANE_W)'),
 'luma sky 0.8 grey': ('export.py', 'LUMA_SKY = 0.5', 'LUMA_SKY = 0.8'),
 'luma coverage threshold 0.3': ('export.py', 'LUMA_COVER = 0.5', 'LUMA_COVER = 0.3'),
 'luma coverage threshold 0.8': ('export.py', 'LUMA_COVER = 0.5', 'LUMA_COVER = 0.8'),
 'luma composites near to far': ('export.py', 'for a in decoded:', 'for a in decoded[::-1]:'),
 'luma coverage = strongest plane alpha': ('export.py', 'clear = clear * (1 - al[..., 0])', 'clear = np.minimum(clear, 1 - al[..., 0])'),
 'luma coverage = last plane alpha': ('export.py', 'clear = clear * (1 - al[..., 0])', 'clear = 1 - al[..., 0]'),
 'luma never refuses an empty frame': ('export.py', 'if not m.any(): raise ValueError', 'if False: raise ValueError'),
 'planes of mixed size accepted': ('export.py', 'if len(shapes) != 1:', 'if False:'),
 'plane rows not checked against the view': ('export.py', 'if h != view', 'if False and h != view'),
 'budget checked against the constant width': ('export.py', 'check_budget([sum(sizes[k].values()) for k in KEYS], w, h)', 'check_budget([sum(sizes[k].values()) for k in KEYS], PLANE_W, h)'),
 'budget checked against the view height only': ('export.py', 'check_budget([sum(sizes[k].values()) for k in KEYS], w, h)', 'check_budget([sum(sizes[k].values()) for k in KEYS], w, 1)'),
 'width cap is exclusive of 4096': ('export.py', 'if plane_w > PLANE_W_MAX:', 'if plane_w >= PLANE_W_MAX:'),
 'width cap 8192': ('export.py', 'PLANE_W_MAX = 4096', 'PLANE_W_MAX = 8192'),
 'pair cap is exclusive of the cap': ('export.py', 'if frame_bytes[i] + frame_bytes[j] > PAIR_BYTES_MAX:', 'if frame_bytes[i] + frame_bytes[j] >= PAIR_BYTES_MAX:'),
 'pair check does not wrap night to dawn': ('export.py', 'for i in range(len(frame_bytes)):', 'for i in range(len(frame_bytes) - 1):'),
 'decode budget counts one frame, not a pair': ('export.py', 'decoded = 2 * len(PLANES)', 'decoded = len(PLANES)'),
 'decode budget cap doubled': ('export.py', 'DECODE_BYTES_MAX = 20_000_000', 'DECODE_BYTES_MAX = 40_000_000'),
 'decode budget cap is exclusive': ('export.py', 'if decoded > DECODE_BYTES_MAX:', 'if decoded >= DECODE_BYTES_MAX:'),
 'planes order mid far near': ('export.py', "PLANES = ('far', 'mid', 'near')", "PLANES = ('mid', 'far', 'near')"),
 'morning ignores the time zone': ('export.py', 'morning=9.5 - tz', 'morning=9.5'),
 'dawn three hours after sunrise': ('export.py', 'dawn=rise + 0.25', 'dawn=rise + 3'),
 'dusk at -4 deg': ('export.py', 'dusk=find(-2.5, noon, noon + 9)', 'dusk=find(-4.0, noon, noon + 9)'),
 'noon is solar noon of the meridian, not the sun maximum': ('export.py', 'noon = max((12 - lon / 15.0 - 1 + x / 600 for x in range(0, 1200)), key=lambda t: sun.solar(day + timedelta(hours=t), lat, lon)[1])', 'noon = 12 - lon / 15.0 + 1.5'),
 'sun key hour_utc off by one hour': ('export.py', "hour_utc=h) for k, h in hours.items()}", "hour_utc=h + 1) for k, h in hours.items()}"),
 'altitude from the eye, not the ground': ('export.py', "altitude_km=p['ground_m'] / 1000.0", "altitude_km=p['eye_m'] / 1000.0"),
 'look azimuth from the wrong field': ('export.py', "look_az_deg=p['az_center']", "look_az_deg=p['lat']"),
 'view px_per_deg_v is the horizontal one': ('export.py', "px_per_deg_v=v['px_per_deg']", "px_per_deg_v=ridge.HPX_DEG"),
 'sky_row left as a fraction': ('export.py', "sky_row=v['sky_row'] * ridge.H", "sky_row=v['sky_row']"),
 'near_row left as a fraction': ('export.py', "near_row=v['near_row'] * ridge.H", "near_row=v['near_row']"),
 'index written without replacing a rebaked place': ('export.py', "idx['places'][place['id']] = name;", "idx['places'].setdefault(place['id'], name);"),
 'plane files written under the wrong key': ('export.py', "(tmp / f'{k}-{n}.webp').write_bytes(frames_webp[k][n])", "(tmp / f'{k}-{n}.webp').write_bytes(frames_webp['noon'][n])"),
 'a refused bake still creates the out dir': ('export.py', "sizes = {k: {n: len(frames_webp[k][n])", "Path(out).mkdir(parents=True, exist_ok=True); sizes = {k: {n: len(frames_webp[k][n])"),

 'luma in sRGB, not linear': ('export.py', 'lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)', 'lin = c'),
 'pair check skips the night-dawn pair and the last day pair': ('export.py', 'for i in range(len(frame_bytes)):', 'for i in range(len(frame_bytes) - 2):'),
 'decode budget never checked': ('export.py', 'if decoded > DECODE_BYTES_MAX:', 'if False:'),
 'old dir of the place kept': ('export.py', 'if old and old != name: shutil.rmtree(out / old, ignore_errors=True)', 'pass'),
 'tmp dir left in out on success': ('export.py', 'os.rename(tmp, dest)', 'shutil.copytree(tmp, dest)'),
 'index default always the baked place': ('export.py', "idx['default'] = default or (idx['default'] if idx['default'] in idx['places'] else place['id'])", "idx['default'] = place['id']"),
 'attribution credit_line blanked': ('export.py', "credit_line='Contains modified", "credit_line='' and 'Contains modified"),
 'attribution credit_line loses the Airbus line': ('export.py', ' and © Airbus Defence and Space GmbH 2014-2018', ''),
 'attribution licence blanked': ('export.py', "licence='Copernicus DEM licence", "licence='' and 'Copernicus DEM licence"),
 'attribution dem_source names the 90 m product': ('export.py', "dem_source='Copernicus DEM GLO-30 (30 m)'", "dem_source='Copernicus DEM GLO-90 (90 m)'"),
 'attribution url over plain http': ('export.py', "url='https://spacedata", "url='http://spacedata"),
 'attribution url blanked': ('export.py', "url='https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model')", "url='')"),
 'knock-out removed: the farther planes show through the nearer': ('ridge.py', "out[names[i]][..., 3] *= np.clip(left / np.maximum(got, 1e-3), 0, 1)", "out[names[i]][..., 3] *= 1.0"),
 'knock-out ignores the nearer planes\' own alpha': ('ridge.py', "out[names[i]][..., 3] *= np.clip(left / np.maximum(got, 1e-3), 0, 1)", "out[names[i]][..., 3] *= np.clip(left, 0, 1)"),
 'knock-out margin filter is a min (hides what the slide uncovers)': ('ridge.py', 'sliding_window_view(pad, 2 * m + 1, axis=1).max(-1), m / 2.0)', 'sliding_window_view(pad, 2 * m + 1, axis=1).min(-1), m / 2.0)'),
 'knock-out has a hard edge (no easing)': ('ridge.py', 'return np.clip(blurw(np.lib.stride_tricks.sliding_window_view(pad, 2 * m + 1, axis=1).max(-1), m / 2.0)[:, m:-m], 0, 1)', 'return np.clip(np.lib.stride_tricks.sliding_window_view(pad, 2 * m + 1, axis=1).max(-1)[:, m:-m], 0, 1)'),
 'knock-out margin of one column': ('ridge.py', 'OCCLUDE_MARGIN_PX = 48 ', 'OCCLUDE_MARGIN_PX = 1 '),
 'knock-out hides the nearer plane from the farther one, not the reverse': ('ridge.py', 'nearer = names[i + 1:]; left', 'nearer = names[:i]; left'),
 'near foot floor removed: the near body dissolves above the horizon': ('ridge.py', 'if near: foot = np.maximum(foot,', 'if False: foot = np.maximum(foot,'),
 'near foot floor starts the fade at the foot, not at the horizon': ('ridge.py', 'np.clip(ang * PXDEG_V, 0, None) / FADE_AT)', 'np.clip(ang * PXDEG_V, 0, None) / 1.0)'),
 'near flag passed to every layer': ('ridge.py', 'near=rank == len(slots) - 1)', 'near=True)'),
 'near flag passed to no layer': ('ridge.py', 'near=rank == len(slots) - 1)', 'near=False)'),
 'near flag on the first layer, not the last': ('ridge.py', 'near=rank == len(slots) - 1)', 'near=rank == 0)'),
 'near cover never checked at the writer': ('export.py', "for k in KEYS: check_near_cover(dec[k][-1], view['horizon_row'])", "pass"),
 'near cover checked on the mid plane': ('export.py', "check_near_cover(dec[k][-1], view['horizon_row'])", "check_near_cover(dec[k][1], view['horizon_row'])"),
 'near cover checked on noon only': ('export.py', "for k in KEYS: check_near_cover(", "for k in ('noon',): check_near_cover("),
 'near cover hole threshold of zero': ('export.py', 'NEAR_HOLE_ALPHA = 24 ', 'NEAR_HOLE_ALPHA = 0 '),
 'near cover looks below the horizon too': ('export.py', '& (rows < int(horizon_row))', '& (rows < h)'),
 'near cover crest threshold above any alpha': ('export.py', 'NEAR_CREST_ALPHA = 64 ', 'NEAR_CREST_ALPHA = 256 '),
 'near cover lets a transparent column through': ('export.py', 'if none.any(): raise ValueError', 'if False: raise ValueError'),
 'near cover looks only above the crest row': ('export.py', '(rows >= crest[None, :]) & (rows < int(horizon_row))', '(rows >= crest[None, :] + 400) & (rows < int(horizon_row))'),
 'relight is not deterministic (noise in the planes)': ('ridge.py', 'P = X + ref_w[None] * (Yc - Y[..., None])', 'P = X + ref_w[None] * (Yc - Y[..., None]) + np.random.random() * 0.05'),
}

def _cap(): resource.setrlimit(resource.RLIMIT_AS, (12 << 30, 12 << 30))
def run(item):
    name, (f, a, b) = item; d = tempfile.mkdtemp(dir=os.environ.get('TMPDIR')); s = os.path.join(d, 'src'); shutil.copytree(SRC, s, ignore=shutil.ignore_patterns('__pycache__'))
    p = os.path.join(s, f); t = open(p).read(); assert a in t, name; open(p, 'w').write(t.replace(a, b, 1))
    code = ("import sys; sys.path.insert(0, %r); import test_ridge as t\nfor f in sorted(t.PLANES_TESTS, key=lambda f: ('vienna' in f.__name__, f.__name__)):\n"
            "    try: f()\n    except BaseException as e: print(f.__name__[5:50] + ': ' + repr(e)[:120]); break\n") % os.path.join(s, 'tests')
    try: r = subprocess.run([sys.executable, '-I', '-B', '-c', code], env=dict(os.environ, RIDGE_SRC=s), capture_output=True, text=True, preexec_fn=_cap, timeout=1200); fails = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ('CRASH ' + r.stderr[-300:] if r.returncode else '')
    except subprocess.TimeoutExpired: fails = 'TIMEOUT'
    shutil.rmtree(d); line = ('KILLED   ' if fails else 'SURVIVED ') + name + ' -> ' + (fails or '-'); print(line, flush=True); return line
if __name__ == '__main__':
    only = os.environ.get('ONLY'); items = [kv for kv in M.items() if not only or any(o in kv[0] for o in only.split('|'))]
    with ThreadPoolExecutor(int(os.environ.get('JOBS', '4'))) as ex: lines = list(ex.map(run, items))
    live = [l for l in lines if l.startswith('SURVIVED') and l[9:].split(' -> ')[0] not in EQUIVALENT]
    print('%d mutants, %d killed, %d survived (%d named equivalent)' % (len(lines), sum(l.startswith('KILLED') for l in lines), sum(l.startswith('SURVIVED') for l in lines), len(EQUIVALENT))); sys.exit(1 if live else 0)
