"""Fixtures for the ridge baker (march, prefilter, coverage, seams, normals, cards, export).  Plain asserts, no pytest needed:  venv/bin/python tests/test_ridge.py   (exit code 1 on failure).
RIDGE_SRC selects the source directory (default ..) (the mutation runner points it at a patched copy).
Synthetic terrain has a known right answer; the Vienna tests bake the real preset (its rays come from stage0: RIDGE_TILES needs the tiles, or a cached rays file must exist)."""
import os, sys, math, traceback
SRC = os.environ.get('RIDGE_SRC') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); sys.path.insert(0, SRC)   # RIDGE_WORK and RIDGE_TILES must be set (tests/run.sh sets them)
import numpy as np, ridge
from ridge import W

EYE = 100.0; GROUND = 50.0          # ground below the eye: every ray climbs, so only the placed blocks make ridges
ridge.P = dict(id='synthetic', rmax_km=60)
D = ridge.schedule(False)
def az_of(x): return (x + 0.5) / W * 360.0
def col_of(az): return int(round(az / 360.0 * W - 0.5)) % W

def rays(hfun):
    az = (np.arange(W) + 0.5) / W * 360.0; A = np.zeros((len(D), W), np.float32); Hh = np.zeros_like(A)
    for k, dk in enumerate(D):
        h = hfun(dk, az); Hh[k] = h; A[k] = np.degrees(np.arctan2(h - EYE - dk * dk / (2 * ridge.R_EARTH) * (1 - ridge.KREF), dk))
    return A, Hh
def theta(h, d): return math.degrees(math.atan2(h - EYE - d * d / (2 * ridge.R_EARTH) * (1 - ridge.KREF), d))
def in_arc(az, a0, a1): return ((az - a0) % 360.0) <= ((a1 - a0) % 360.0)
def block(a0, a1, d0, d1, h): return lambda dk, az: np.where(in_arc(az, a0, a1) & (dk >= d0) & (dk < d1), h, 0.0)
def terrain(*blocks): return lambda dk, az: np.maximum.reduce([np.full_like(az, GROUND)] + [np.asarray(b(dk, az), float) for b in blocks])
def test_cache_keys_follow_every_input_of_the_cached_array():
    """mosaic-/rays- cache files are keyed by a digest of their inputs.  Right answer: identical inputs -> identical key (the preset id does not enter), a changed preset field (eye height, range, position), tile list or baker constant (refraction, detail noise) -> a different key."""
    saved = ridge.P
    try:
        base = dict(id='k1', lat=47.0, lon=11.0, rmax_km=40, eye_m=2000.0); ridge.P = dict(base); k0 = (ridge.rays_key(False), ridge.rays_key(True), ridge.mosaic_key(ridge.P))
        ridge.P = dict(base, id='other'); assert (ridge.rays_key(False), ridge.rays_key(True), ridge.mosaic_key(ridge.P)) == k0, 'the preset id changed the key'
        for fld, v in (('eye_m', 2010.0), ('rmax_km', 41), ('lon', 11.001), ('lat', 47.001)):
            ridge.P = dict(base, **{fld: v}); assert ridge.rays_key(False) != k0[0], ('rays key ignores', fld)
        ridge.P = dict(base, lat=47.0, lon=13.5); assert ridge.mosaic_key(ridge.P) != k0[2], 'mosaic key ignores the tile list'
        ridge.P = dict(base); old = ridge.KREF; ridge.KREF = 0.2
        try: assert ridge.rays_key(False) != k0[0], 'rays key ignores the refraction constant'
        finally: ridge.KREF = old
        old = ridge.DETAIL; ridge.DETAIL = dict(old, amp_m=30.0)
        try: assert ridge.rays_key(True) != k0[1] and ridge.rays_key(False) == k0[0], 'detail key ignores the noise settings (or the plain key follows them)'
        finally: ridge.DETAIL = old
    finally: ridge.P = saved
def test_paths_come_from_the_environment_with_no_default():
    """Importing the baker without RIDGE_WORK / RIDGE_TILES fails with a message naming the variable (no location is assumed)."""
    import subprocess; env = {k: v for k, v in os.environ.items() if not k.startswith('RIDGE_')}
    for var in ('RIDGE_WORK', 'RIDGE_TILES'):
        e = dict(env); e.update({'RIDGE_WORK': '.', 'RIDGE_TILES': '.'}); del e[var]
        r = subprocess.run([sys.executable, '-I', '-c', 'import sys; sys.path.insert(0, %r); import ridge' % SRC], env=e, capture_output=True, text=True); assert r.returncode and var in r.stderr and 'not set' in r.stderr, (var, r.stderr[-200:])

TESTS = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
if __name__ == '__main__':
    fails = 0
    for t in TESTS:
        try: t(); print("PASS", t.__name__)
        except Exception as e: fails += 1; print("FAIL", t.__name__, "|", repr(e)[:300])
    print("failures:", fails); sys.exit(1 if fails else 0)
