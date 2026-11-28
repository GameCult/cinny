"""Fixtures for the ridge baker (march, prefilter, coverage, seams, normals, cards, export).  Plain asserts, no pytest needed:  venv/bin/python tests/test_ridge.py   (exit code 1 on failure).
RIDGE_SRC selects the source directory (default ..) (the mutation runner points it at a patched copy).
Synthetic terrain has a known right answer; the Vienna tests bake the real preset (its rays come from stage0: RIDGE_TILES needs the tiles, or a cached rays file must exist)."""
import os, sys, math, json, shutil, tempfile, traceback
from pathlib import Path
SRC = os.environ.get('RIDGE_SRC') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); sys.path.insert(0, SRC)   # RIDGE_WORK and RIDGE_TILES must be set (tests/run.sh sets them)
import numpy as np, ridge, export
from ridge import W, H
ALPINE = ridge.load_material('alpine')          # the places.json material of every place that names none
NW = 1280                           # the synthetic bakes' window: columns 0..NW of the ring (azimuth 0..72); the pieces that need the whole ring (seams across the wrap, the tile cut) run on the ring
TW = export.TILE_W + 2 * export.APRON
_w = lambda x: ridge.ring_cols(x, 0, NW)

EYE = 100.0; GROUND = 50.0          # ground below the eye: every ray climbs, so only the placed blocks make ridges
ridge.P = dict(id='synthetic', rmax_km=95, eye_m=100.0)
D = ridge.schedule(False)
def az_of(x): return (x + 0.5) / W * 360.0
def col_of(az): return int(round(az / 360.0 * W - 0.5)) % W

def rays(hfun, eye=EYE):
    az = (np.arange(W) + 0.5) / W * 360.0; A = np.zeros((len(D), W), np.float32); Hh = np.zeros_like(A)
    for k, dk in enumerate(D):
        h = hfun(dk, az); Hh[k] = h; A[k] = np.degrees(np.arctan2(h - eye - dk * dk / (2 * ridge.R_EARTH) * (1 - ridge.KREF), dk))
    return A, Hh
def near_rays(hfun, sigma=0.0):
    """The near march of a synthetic terrain: hfun over ridge.near_schedule() on all W columns, float64, prefiltered like the far march (angles from ridge.P['eye_m']): (d, a, h) as ridge.near_march returns it."""
    dn = ridge.near_schedule(); az = (np.arange(W) + 0.5) / W * 360.0; hn = np.stack([np.broadcast_to(np.asarray(hfun(dk, az), np.float64), az.shape) for dk in dn]); a, h = ridge.prefilter(dn, hn, sigma); return dn, a, h
def _join(hfun, A, Hh, sigma=0.0):
    """ridge.join_near of raw far rays (K, W) and the near march of the same terrain, cut to the window 0..NW: (D, a, h, nrm) as ridge.cards reads them."""
    d, a, h, nrm = ridge.join_near(D, A, Hh, near_rays(hfun, sigma)); return d, _w(a), _w(h), tuple(_w(x) for x in nrm)
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

# ---------------------------------------------------------------------------------------- synthetic bakes: the shared steps of export.bake_place on rays the fixtures make
def _bake(hfun, splits_km, sigma=0.0, fixed_m=None):
    """prefilter, whole-ring set_view, coverage and the periodic seams on the whole ring (or fixed_m, one seam depth in m for every column), the join of the near march on the whole ring, then the window columns 0..NW (azimuth 0..72) of them and the cards on those, of synthetic rays: the pieces of the bake a fixture can look at cheaply.
    D, a, h, nrm of the result are the JOINED march's window (the near samples first); opaque and edges are the far march's."""
    A, Hh = rays(hfun); ridge.P.update(eye_m=EYE); a, h = ridge.prefilter(D, Hh, sigma); v = ridge.set_view(a.max(0)); cov_ring = ridge.coverage(D, a); cov = _w(cov_ring)
    sm = _w(ridge.seams(cov_ring, [k * 1000.0 for k in splits_km], D)) if fixed_m is None else np.array([np.full(NW, float(v)) for v in fixed_m])
    Dj, aj, hj, nj = ridge.join_near(D, a, h, near_rays(hfun, sigma)); aw, hw, nrm = _w(aj), _w(hj), tuple(_w(x) for x in nj)
    return dict(cards=ridge.cards(Dj, aw, hw, sm, nrm), splits_km=list(splits_km), seams=sm, cov=cov, opaque=ridge.opaque(_w(a)), edges=ridge.log_edges(D), D=Dj, a=aw, h=hw, nrm=nrm, v=v)
def _canvas(card, key='alpha'):
    out = np.zeros((H, NW) + card[key].shape[2:], np.float32); out[card['top']:card['top'] + card[key].shape[0]] = card[key]; return out
def _row(deg): return int(np.argmin(np.abs(ridge.rowang - deg)))
THREE = terrain(block(0, 359.99, 3000, 3600, 350), block(0, 359.99, 20000, 21500, 1800), block(0, 359.99, 70000, 72000, 7000))       # ridges at 3, 20 and 70 km, each taller in angle than the one before
WIDE3 = terrain(block(0, 359.99, 9000, 10000, 300), block(0, 359.99, 38000, 40000, 2000), block(0, 359.99, 70000, 72000, 3000))       # low near hills, then ridges at 39 and 71 km: the frame reaches below the ground at the seams (so cards have wall rows) and the horizon is inside it
WALLED = terrain(block(0, 359.99, 9000, 10000, 300), block(0, 359.99, 38000, 40000, 2000))
def _ramp(dk, az): return np.maximum(GROUND, np.where(dk > 12000, (dk - 12000) * 0.045 + 50.0, 0.0))       # a slope the first sample of card 1 stands on: n_up about 0.9, so the material would be rock if the face counted

def test_the_vertical_anchors_read_the_whole_ring():
    """set_view anchors the highest skyline angle of the ring at 4% of the frame and the lowest at 66%, wherever they are: a peak at column 3555 and a low at column 5333, both outside the first 72 degrees, set the mapping."""
    sk = np.full(W, 1.0); sk[3555] = 3.0; sk[5333] = -1.0; sk[10] = 1.5; v = ridge.set_view(sk)
    assert v['sky_deg'] == 3.0 and v['low_deg'] == -1.0 and abs(v['px_per_deg'] - 0.62 * H / 4.0) < 1e-9 and abs(v['horizon_row'] - ridge.TOP_DEG * v['px_per_deg']) < 1e-9 and abs(ridge.TOP_DEG - (3.0 + 0.04 * H / v['px_per_deg'])) < 1e-9, v
def test_seams_fall_in_depth_gaps():
    """Three ridges at 3, 20 and 70 km: targets [6, 40] give a seam in (3, 20) and one in (20, 70) in EVERY column, ordered with at least 0.4 nat between; targets [6] give one seam in (3, 20)."""
    b = _bake(THREE, [6, 40]); s = b['seams']; assert s.shape == (2, NW)
    assert (s[0] > 3600).all() and (s[0] < 20000).all() and (s[1] > 21500).all() and (s[1] < 70000).all(), (s.min(1), s.max(1)); assert (np.log(s[1]) - np.log(s[0]) >= 0.4 - 1e-9).all()
    s1 = _bake(THREE, [6])['seams']; assert s1.shape == (1, NW) and (s1[0] > 3600).all() and (s1[0] < 20000).all(), (s1.min(), s1.max())
def _recede(d0, d1, thick=300.0, hgt=1500.0):
    """A ridge `thick` m thick whose distance runs from d0 m at azimuth 0 to d1 m at azimuth 72, and again in every 72 degrees of the ring (so the ring's skyline is the ridge's everywhere, as the window's was)."""
    return terrain(lambda dk, az: np.where(np.abs(dk - (d0 + (d1 - d0) * ((az % 72) / 72.0))) < thick / 2, hgt, 0.0))
def _receding(dk, az): return _recede(4000.0, 15000.0)(dk, az)
def test_the_swept_rows_term_keeps_the_seam_from_hopping_under_a_stronger_pull():
    """With the authored depth pulling five times as hard (0.1 instead of 0.02) the seams of the 3-12, 4-15 (split 10) and 6-14 km ridges still follow the ridge, and twice as hard (0.04) those of the 4-15 (split 6), 5-30 and 8-40 km ridges: only the cost of the visible rows it would sweep holds it back (with that term out of the cost it hops between two columns)."""
    old = ridge.SEAM_PRIOR
    try:
        ridge.SEAM_PRIOR = 0.1
        for d0, d1, sp in ((3, 12, 6), (4, 15, 10), (6, 14, 9)):
            j0, j1, cover = _alpha_jumps(d0, d1, sp); assert j0 < 0.35 and j1 < 0.35 and cover > 0.999, ('the seam hopped across the ridge', (d0, d1, sp), j0, j1)
        ridge.SEAM_PRIOR = 0.04       # these three tear above 0.04 (measured: 0.05 tears 5-30 and 8-40, 0.1 tears 4-15/6): the seam is closed on the ring, so a stronger pull makes one tear per period cheaper than staying beyond the ridge
        for d0, d1, sp in ((4, 15, 6), (5, 30, 12), (8, 40, 15)):
            j0, j1, cover = _alpha_jumps(d0, d1, sp); assert j0 < 0.35 and j1 < 0.35 and cover > 0.999, ('the seam hopped across the ridge', (d0, d1, sp), j0, j1)
    finally: ridge.SEAM_PRIOR = old
RECEDING = [(4, 15, 6), (3, 12, 6), (5, 30, 12), (8, 40, 15), (4, 15, 10), (6, 14, 9)]        # km at azimuth 0, km at azimuth 72, authored split km
def _alpha_jumps(d0, d1, split):
    """The two cards' alpha on the ridge body (crest + 4 rows), column to column: the largest step of each.  """
    b = _bake(_recede(d0 * 1000.0, d1 * 1000.0), [split]); c0 = _canvas(b['cards'][0]); c1 = _canvas(b['cards'][1]); crest = np.argmax(b['opaque'] > 0.5, axis=0); r = np.clip(crest + 4, 0, H - 1); ok = crest > 0
    a0 = c0[r, np.arange(NW)]; a1 = c1[r, np.arange(NW)]; return float(np.abs(np.diff(a0[ok])).max()), float(np.abs(np.diff(a1[ok])).max()), (a0 + (1 - a0) * a1)[ok].min()
def test_seam_never_splits_a_receding_ridge_side_by_side():
    """Six synthetic ridges whose distance recedes across the window (4 to 15, 3 to 12, 5 to 30, 8 to 40, 4 to 15 and 6 to 14 km, targets 6, 6, 12, 15, 10, 9 km): the nearer and the farther card's alpha on the ridge's body never jumps by 0.35 between neighbouring
    columns (a tear: one card here, the other next door; fading slowly over the cross-fade is fine) and the two cards together cover the body.  With the swept-rows term out of the seam cost the seam hops across the ridge; with the prior at 0.1 it hops on two of the six."""
    for d0, d1, sp in RECEDING:
        j0, j1, cover = _alpha_jumps(d0, d1, sp); assert j0 < 0.35 and j1 < 0.35, ('a card appears or vanishes between neighbouring columns', (d0, d1, sp), j0, j1); assert cover > 0.999, ('the ridge body is not covered by the two cards together', (d0, d1, sp))
def test_far_card_keeps_terrain_hidden_behind_a_nearer_ridge():
    """Layered depth: a far ridge (20 km) lower in angle than the near ridge (3 km) in azimuth 0..36 and higher in 36..72.  Where the near card is opaque in front of the far ridge (columns 100..500) the mid card still holds that ridge, at its distance;
    where the far ridge shows above the near one (column 900) the near card is empty and the mid card holds it."""
    b = _bake(terrain(block(0, 359.99, 3000, 3600, 350), block(0, 36, 20000, 21500, 1500), block(36, 359.99, 20000, 21500, 2400)), [6]); c0, c1 = _canvas(b['cards'][0]), b['cards'][1]; a1 = _canvas(c1); ld1 = _canvas(c1, 'logd'); r = _row(theta(1500, 20000) - 0.2)
    for x in (100, 300, 500):
        assert c0[r, x] > 0.99, ('the near ridge does not cover the far one here', x); assert a1[r, x] > 0.99, ('the far card lost the terrain behind the near ridge', x); assert abs(math.exp(ld1[r, x]) - 20000) < 1500, (x, math.exp(ld1[r, x]))
    r = _row(0.5 * (theta(350, 3000) + theta(2400, 20000))); assert c0[r, 900] < 0.01 and a1[r, 900] > 0.99 and abs(math.exp(ld1[r, 900]) - 20000) < 1500, (c0[r, 900], a1[r, 900])
def test_crossfade_is_complementary():
    """A ridge across the seam (seam fixed at 6 km, the ridge's front face at 5.9 km inside the cross-fade): the nearer card is partly transparent over the window, the farther card is opaque on the ridge, and the composite stays at coverage 1 below the crest."""
    hf = terrain(block(0, 359.99, 5900, 6100, 900)); A, Hh = rays(hf); ridge.P.update(eye_m=EYE); ridge.set_view(A.max(0)); aw = _w(A); Dj, aj, hj, nj = _join(hf, A, Hh)
    cs = ridge.cards(Dj, aj, hj, np.full((1, NW), 6000.0), nj); c0, c1 = _canvas(cs[0]), _canvas(cs[1]); crest = int(np.argmax(ridge.opaque(aw)[:, 500] > 0.5)); r = crest + 6
    assert 0.2 < c0[r, 500] < 0.8, ('the near card does not fade over the window', c0[r, 500]); assert c1[r, 500] > 0.99, 'the far card is not opaque on the ridge'
    comp = 1 - (1 - c0) * (1 - c1); assert (comp[crest + 3:, :] > 0.999).all(), 'the composite dips below coverage 1 under the crest'
def test_normals_of_a_tilted_plane():
    """A plane with front slope s (north) and lateral slope l (east), seen towards azimuth 0: n = (-E s, -E l, 1) normalised, E the authored exaggeration (a dropped E fails)."""
    s, l, E = 0.12, -0.08, 3.0; saved = ridge.PXDEG_V; ridge.PXDEG_V = E * ridge.HPX_DEG
    try:
        az = (np.arange(W) + 0.5) / W * 2 * math.pi; h = 300.0 + s * D[:, None] * np.cos(az)[None, :] + l * D[:, None] * np.sin(az)[None, :]; nr, nt, nu = ridge.normals(D, h); k = len(D) // 2; x = [0, 1, 2, W - 2, W - 1]
        want = np.array([-E * s, -E * l, 1.0]); want /= np.linalg.norm(want); got = np.array([nr[k, x].mean(), nt[k, x].mean(), nu[k, x].mean()]); assert np.abs(got - want).max() < 2e-3, (got, want)
        assert np.abs(nr ** 2 + nt ** 2 + nu ** 2 - 1).max() < 1e-9
    finally: ridge.PXDEG_V = saved
def test_lateral_slope_uses_equal_distance_not_equal_row():
    """A plane with lateral slope l at 20 km, a 3 km ridge only for azimuth above 40 deg: at the 20 km samples, in the columns around the ridge's azimuth edge, the across-ray slope is the plane's own l (neighbouring columns at the same distance), not a step between the ridge and the plane."""
    l = 0.05; saved = ridge.PXDEG_V; ridge.PXDEG_V = 2.0 * ridge.HPX_DEG
    try:
        az = (np.arange(W) + 0.5) / W * 360.0; A, Hh = rays(lambda dk, a: np.where(dk > 10000, GROUND + l * dk * np.radians(a), GROUND) + np.where((a > 40) & (dk >= 3000) & (dk < 3600), 400.0, 0.0))
        nr, nt, nu = ridge.normals(D, Hh); k = int(np.searchsorted(D, 20000)); x0 = int(40 / 360 * W); want = -2.0 * l / math.sqrt(1 + 4 * l * l + (2.0 * 0.0) ** 2)
        assert np.abs(nt[k, x0 - 20:x0 + 20] / nu[k, x0 - 20:x0 + 20] + 2.0 * l).max() < 5e-3, nt[k, x0 - 5:x0 + 5] / nu[k, x0 - 5:x0 + 5]
    finally: ridge.PXDEG_V = saved
def test_prefilter_flattens_roofs_and_keeps_hills():
    """A 25 m bump 60 m wide at 2 km drops below 5 m; a 400 m hill (3 km scale) keeps at least 90% of its height."""
    ridge.P.update(eye_m=EYE); roof = lambda dk, az: GROUND + np.where((az < 1.72) & (dk >= 2000) & (dk < 2060), 25.0, 0.0)
    hill = lambda dk, az: GROUND + 400.0 * np.exp(-((dk - 10000.0) / 3000.0) ** 2 - ((np.radians(((az + 180) % 360) - 180) * dk) / 3000.0) ** 2)
    for f, name in ((roof, 'roof'), (hill, 'hill')):
        A, Hh = rays(f); a, h = ridge.prefilter(D, Hh, 100.0); k = int(np.argmin(np.abs(D - (2030 if name == 'roof' else 10000)))); x = int(np.argmax(Hh[k]))
        if name == 'roof': assert h[k, x] - GROUND < 5.0 and Hh[k, x] - GROUND >= 24.9, ('the roof survives the low-pass', h[k, x] - GROUND)
        else: assert h[k, x] - GROUND >= 0.9 * 400.0, ('the hill is flattened', h[k, x] - GROUND)
    assert np.allclose(ridge.prefilter(D, Hh, 0.0)[1], Hh), 'sigma 0 changed the heights'
def test_crest_rows_have_fractional_coverage():
    """The top row of a card's run has alpha equal to the share of its angular span under the running maximum, and the rows below it are 1 (a lower ridge in columns 0..640 so its crest is not at the frame's top edge)."""
    hf = terrain(block(0, 36, 5000, 5600, 500), block(36, 359.99, 5000, 5600, 560)); A, Hh = rays(hf); ridge.P.update(eye_m=EYE); ridge.set_view(A.max(0)); aw = _w(A); Dj, aj, hj, nj = _join(hf, A, Hh); c = ridge.cards(Dj, aj, hj, np.zeros((0, NW)), nj)[0]
    cv = _canvas(c)[:, 300]; r = int(np.argmax(cv > 0)); top = float(aw.max(0)[300]); p = 1.0 / ridge.PXDEG_V; want = (top - (ridge.rowang[r] - 0.5 * p)) / p
    assert 0.0 < want < 1.0 and abs(cv[r] - want) < 0.01, (cv[r], want, r); assert (cv[r + 1:] > 0.999).all()
def test_cards_composite_to_the_opaque_view():
    """Alpha-over of all cards, last to first, equals the opaque march coverage within 0.02 everywhere, and where opaque the nearest solid card's distance is the first-hit distance of the march."""
    for hf, sp in ((THREE, [6, 40]), (terrain(_receding), [6]), (terrain(block(0, 359.99, 3000, 3600, 350), block(0, 36, 20000, 21500, 700), block(36, 359.99, 20000, 21500, 1800)), [6])):
        b = _bake(hf, sp); comp = 1 - np.prod([1 - _canvas(c) for c in b['cards']], axis=0); assert np.abs(comp - b['opaque']).max() < 0.02, np.abs(comp - b['opaque']).max()
        rm = np.maximum.accumulate(b['a'], axis=0); col = 640; r = _row(float(b['a'][:, col].max()) - 0.5); k = int(np.searchsorted(rm[:, col], ridge.rowang[r], 'left')); first = None
        for c in b['cards']:
            if _canvas(c)[r, col] > 0.99: first = math.exp(_canvas(c, 'logd')[r, col]); break
        assert first is not None and abs(first - b['D'][k]) < 0.1 * b['D'][k] + 60, (first, b['D'][k])

# ---------------------------------------------------------------------------------------- the ring: tiles are crops of per-column results, the wrap is periodic
_RING = {}
def _ring(key, hfun, splits_km):
    """export.cut_ring on synthetic rays (prefilter, whole-ring set_view, then the ring cut), cached by key: dict(bake = what export.bake_place returns, minus the place)."""
    if key not in _RING:
        A, Hh = rays(hfun); ridge.P.update(eye_m=EYE); a, h = ridge.prefilter(D, Hh, 0.0); v = ridge.set_view(a.max(0)); r = export.cut_ring(D, a, h, splits_km, near_rays(hfun))
        _RING[key] = dict(r, op_ring=ridge.opaque(a), place=dict(id='synthetic', name='Synthetic', lat=48.0, lon=16.0, altitude_km=0.05, eye_m=EYE, tz='Europe/Vienna'), v=v,
                          view=dict(look_az_deg=36.0, plane_h=H, px_per_deg_h=ridge.HPX_DEG, px_per_deg_v=v['px_per_deg'], exaggeration=v['exaggeration'], horizon_row=v['horizon_row'], sky_row=v['sky_row'] * H, near_row=v['near_row'] * H),
                          meta=dict(curvature=dict(r_earth_m=ridge.R_EARTH, k_ref=ridge.KREF), encoding=dict(log_d_min=math.log(D[0]), log_d_max=math.log(D[-1])), material=ALPINE, relief=None), material=ALPINE)
    return _RING[key]
def _tile_canvas(card, key='alpha'):
    out = np.zeros((H, TW) + card[key].shape[2:], np.float32); out[card['top']:card['top'] + card[key].shape[0]] = card[key]; return out
def _across_north(dk, az): return np.where(in_arc(az, 340, 20) & (np.abs(dk - (12000.0 + 400.0 * (((az + 180) % 360) - 180))) < 200), 1500.0, 0.0)       # a ridge across the wrap at 4 km (az -20) to 20 km (az +20)
ACROSS = terrain(block(0, 359.99, 3000, 3600, 350), _across_north, block(0, 359.99, 70000, 72000, 3000), block(0.0, 0.05, 6000, 7000, 2500), block(359.95, 359.99, 6000, 7000, 2500))       # and a tower one column wide on each side of north
def test_ring_wrap():
    """A ridge across column 6399 / 0 (receding from 4 km at -20 deg to 20 km at +20 deg): the seam is continuous over the wrap (its jump there no larger than the largest jump elsewhere), tile 31's right apron equals tile 0's first columns and tile 0's left apron
    tile 31's last (every card, pixel for pixel), neighbouring tiles agree on their shared apron, and the interiors of all tiles composite to the opaque ring."""
    b = _ring('across', ACROSS, [8]); sm = np.log(b['seams'][0]); jumps = np.abs(np.diff(np.append(sm, sm[0]))); assert jumps[-1] <= jumps[:-1].max() + 1e-9, ('the seam jumps over the wrap', jumps[-1], jumps[:-1].max())
    A_ = export.APRON; T_ = export.TILE_W; ring = np.zeros((H, W)); op = np.zeros((H, W))
    for t, tile in enumerate(b['cards']):
        nxt = b['cards'][(t + 1) % export.TILES]
        for i, c in enumerate(tile):
            assert (_tile_canvas(c)[:, T_ + A_:T_ + 2 * A_] == _tile_canvas(nxt[i])[:, A_:2 * A_]).all(), ('the apron differs from the neighbour', t, i); seen = _tile_canvas(c)[:, T_ + A_:T_ + 2 * A_] > 0
            for key in ('logd', 'wall'): assert (_tile_canvas(c, key)[:, T_ + A_:T_ + 2 * A_][seen] == _tile_canvas(nxt[i], key)[:, A_:2 * A_][seen]).all(), ('the apron differs from the neighbour', t, i, key)
        comp = 1 - np.prod([1 - _tile_canvas(c) for c in tile], axis=0); ring[:, t * T_:(t + 1) * T_] = comp[:, A_:A_ + T_]; op[:, t * T_:(t + 1) * T_] = b['opaque'][t][:, A_:A_ + T_]
    assert np.abs(ring - op).max() < 0.02, np.abs(ring - op).max(); assert np.abs(ring - b['op_ring']).max() < 0.02 and b['op_ring'][:, [0, W - 1]].sum(0).min() > b['op_ring'][:, [1, W - 2]].sum(0).max() + 10, 'the tiles hold the wrong columns of the ring (a tower on column 0 and column 6399 is the fixture)'
    assert b['opaque'][0].shape == (H, T_ + 2 * A_) and (b['opaque'][0][:, :A_] == b['opaque'][export.TILES - 1][:, T_:T_ + A_]).all(), 'the left apron of tile 0 is not the last columns of tile 31'
def test_every_tile_is_cut_at_its_own_seam():
    """The seams sweep from 5 km to 30 km once round the ring (ridge.seams stands in): in every tile the near card holds nothing beyond its columns' seam (plus the cross-fade) and the far card nothing before it, so no tile is cut with another tile's seams."""
    saved = ridge.seams; sweep = 5000.0 * 6.0 ** (np.arange(W) / W)
    ridge.seams = lambda cov, targets, d: sweep[None, :]
    try: b = _ring('swept', terrain(block(0, 359.99, 3000, 3600, 350), block(0, 359.99, 20000, 21500, 1800), block(0, 359.99, 70000, 72000, 3000)), [8])
    finally: ridge.seams = saved
    T_, A_ = export.TILE_W, export.APRON; ix = slice(A_, A_ + T_); xf = ridge.XF; seen = 0
    for t, tile in enumerate(b['cards']):
        s_t = np.broadcast_to(sweep[np.arange(T_) + t * T_], (H, T_)); c0, c1 = tile[0], tile[1]; d0 = np.exp(_tile_canvas(c0, 'logd')[:, ix]); d1 = np.exp(_tile_canvas(c1, 'logd')[:, ix])
        n0 = (_tile_canvas(c0)[:, ix] >= 0.5) & (_tile_canvas(c0, 'wall')[:, ix] < 0.5); n1 = (_tile_canvas(c1)[:, ix] >= 0.5) & (_tile_canvas(c1, 'wall')[:, ix] < 0.5); seen += int(n0.sum() + n1.sum())
        assert (d0[n0] <= s_t[n0] * math.exp(xf) * 1.02 + 100).all() and (d1[n1] >= s_t[n1] * math.exp(-xf) * 0.98 - 100).all(), ('a card tile is cut at another tile seam', t)
    assert seen > 100_000, 'the fixture holds no card pixels'
def test_tile_is_a_crop_of_the_columns():
    """ridge.cards on a tile's columns (the 200 it owns and the apron) equals the same columns of ridge.cards on a wider run of columns, pixel for pixel, for fixed seams: the tile cut changes no pixel and adds no seam."""
    b = _bake(terrain(_receding, block(0, 359.99, 3000, 3600, 350)), [6]); x0 = 500; n = export.TILE_W + 2 * export.APRON; sl = slice(x0, x0 + n)
    tile = ridge.cards(b['D'], b['a'][:, sl], b['h'][:, sl], b['seams'][:, sl], tuple(x[:, sl] for x in b['nrm']))
    for c, w in zip(tile, b['cards']):
        assert np.array_equal(_canvas(w)[:, sl], _tile_canvas(c)), 'a tile is not a crop of the columns'; seen = _tile_canvas(c) > 0
        for key in ('h', 'n_r', 'n_t', 'logd', 'wall', 'near'): assert np.array_equal(_canvas(w, key)[:, sl][seen], _tile_canvas(c, key)[seen]), ('a tile is not a crop of the columns', key)

# ---------------------------------------------------------------------------------------- toy bakes: tile data made by hand, for the packer and the writer
def _toy(dists=(3000.0, 15000.0, 50000.0), bands=(300, 400, 500), tops=(300, 150, 60), amp=0.01):
    """TILES tiles of len(dists) cards: card i is a solid band of rows (top, h) whose distance is dists[i] x (1 + amp sin x) across the columns, no wall; the opaque view is their composite.  Returns the bake dict pack() reads."""
    n = export.TILE_W + 2 * export.APRON; x = np.arange(n); tile = []; k = len(dists)
    for i in range(k):
        ld = np.log(dists[i] * (1 + amp * np.sin(x * 0.3)))[None, :].repeat(bands[i], 0).astype(np.float32)
        tile.append(dict(top=tops[i], alpha=np.ones((bands[i], n), np.float32), h=np.full((bands[i], n), 1500.0, np.float32), n_r=np.full((bands[i], n), 0.1, np.float32), n_t=np.full((bands[i], n), -0.1, np.float32), logd=ld, wall=np.zeros((bands[i], n), bool), near=np.zeros((bands[i], n), bool)))
    comp = export.composite_alpha([(c['top'], c['alpha']) for c in tile], H, n)
    return dict(cards=[[dict(c) for c in tile] for _ in range(export.TILES)], splits_km=[6.0 * (j + 1) for j in range(k - 1)], seams=np.tile(np.array(dists[:-1])[:, None] * 0.5, (1, W)), opaque=[comp.copy() for _ in range(export.TILES)],
                view=dict(look_az_deg=36.0, plane_h=H, px_per_deg_h=ridge.HPX_DEG, px_per_deg_v=100.0, exaggeration=5.0, horizon_row=60.0, sky_row=24.0, near_row=396.0), meta=dict(curvature=dict(r_earth_m=ridge.R_EARTH, k_ref=ridge.KREF), encoding=dict(log_d_min=math.log(500.0), log_d_max=math.log(100000.0)), material=ALPINE, relief=None),
                place=dict(id='toy', name='Toy', lat=0.0, lon=0.0, altitude_km=0.0, eye_m=1.0, tz='UTC'))
def _write(out, b, packed, **kw):
    args = dict(place=b['place'], view=b['view'], meta=b['meta'], packed=packed, opaque=b['opaque'], switch_index=True); args.update(kw); return export.write_bake(out, **args)
def _refuses(out, b, packed, why, **kw):
    try: _write(out, b, packed, **kw)
    except export.Refusal: assert not os.path.exists(out), ('a refused bake left files', why)
    else: assert False, why
def _pins():
    assert (export.RING_W, export.TILES, export.TILE_W, export.APRON, export.MAX_CARDS, export.BAKER_VERSION) == (6400, 32, 200, 3, 6, 8), 'the ring layout is pinned'
    assert (export.TILE_BYTES_MAX, export.PLACE_BYTES_MAX, export.RESIDENT_BYTES_MAX, export.FIT_PX_MAX, export.R_MAX_FLOOR_M, export.PHI_STEPS) == (235_000, 7_500_000, 20_000_000, 24.0, 25.0, 24), 'the budgets and the fit bound are pinned'
    assert abs(export.HFOV_MAX_DEG - 72 / 1.1) < 1e-12

def test_schema4():
    """The schema 4 manifest validates; a tile array of the wrong length, a missing apron, a file named for another tile, and any key of schema 2 left behind (the camera's heading range and offset, the window, the plane width, the card's median and scale, the whole-bake w and h) are refused; the schema file is pinned; the layout constants are pinned."""
    _pins(); d = tempfile.mkdtemp()
    try:
        b = _toy(); pk = export.pack(b); dest = _write(d, b, pk); m = json.load(open(dest / 'manifest.json')); export.validate_manifest(m); mk = lambda: json.loads(json.dumps(m))
        assert m['schema'] == 4 and m['baker_version'] == 8 and set(m['view']) >= {'ring_w', 'tile_w', 'tiles', 'apron'} and 'rows_above' not in m['view'] and m['camera'] == dict(r_max_m=pk['camera']['r_max_m'], r_max_forward_m=pk['camera']['r_max_forward_m']) and m['camera']['r_max_forward_m'] >= m['camera']['r_max_m'] and len(m['tiles']) == 32 and 'w' not in m and 'h' not in m
        def bad(f, why):
            x = mk(); f(x)
            try: export.validate_manifest(x)
            except export.Refusal: return
            raise AssertionError(why)
        bad(lambda x: x['camera'].pop('r_max_forward_m'), 'a camera without its forward offset validated'); bad(lambda x: x['camera'].pop('r_max_m'), 'a camera without its offset validated')
        bad(lambda x: x['tiles'].pop(), 'a manifest of 31 tiles validated'); bad(lambda x: x['tiles'][3].pop(), 'a tile with a card missing validated'); bad(lambda x: x['tiles'][3].append(None), 'a tile with an extra card validated'); bad(lambda x: x['view'].pop('apron'), 'a missing apron validated')
        bad(lambda x: x['view'].update(apron=0), 'an apron of 0 validated'); bad(lambda x: x['tiles'][2][1]['surface'].update(file='card-1-t03-surface.webp'), 'a file named for another tile validated')
        bad(lambda x: x['tiles'].__setitem__(slice(None), [[None] * 3 for _ in range(32)]), 'a card null in every tile validated'); bad(lambda x: x.update(bytes=x['bytes'] + 1), 'a wrong byte total validated')
        for where, key in (('camera', 'heading_max' + '_deg'), ('view', 'window' + '_deg'), ('view', 'plane' + '_w'), ('view', 'rows_above'), ('camera', 'r_m'), (None, 'w'), (None, 'h')):       # schema 2's names are spelled in pieces: the baker's tree must hold none of them
             bad(lambda x: (x[where] if where else x).update({key: 1}), f'a leftover {key} validated')
        bad(lambda x: x['cards'][0].update(**{'median' + '_m': 1.0}), 'a leftover median validated'); bad(lambda x: x['cards'][0].update(scale=1.0), 'a leftover scale validated'); bad(lambda x: x['tiles'][0][0].update(scale=1.0), 'a tile entry with a scale validated')
        bad(lambda x: x['tiles'][0][0].update(distance_m='far'), 'a distance that is not a number validated'); bad(lambda x: x['place'].update(tz='Mars/Olympus'), 'a zone the system does not know validated')
        assert json.load(open(os.path.join(SRC, 'ridge-bake.schema.json'))) == json.loads(json.dumps(export.SCHEMA)), 'ridge-bake.schema.json is stale (export.py --write-schema)'
    finally: shutil.rmtree(d)
def test_manifest_v4_writer():
    """Two packs of one bake give the same bytes and bake_id; tiles[t][i] files are where the manifest says with the sizes it says and decode to tile_w + 2 apron columns; the bake_id is the sha256 of the files tile-major, then card, surface then geometry; the index points at the dir, a
    rebake replaces the old dir, cards are nearest first with their seam medians, the attribution is the four pinned strings."""
    d = tempfile.mkdtemp()
    try:
        b = _toy(); pk = export.pack(b); pk2 = export.pack(b); files = lambda p: [(e['surface'], e['geometry']) for row in p['tiles'] for e in row if e]; assert files(pk) == files(pk2), 'two packs gave different bytes'
        a = _write(d + '/a', b, pk); m = json.load(open(a / 'manifest.json')); export.validate_manifest(m); text = (a / 'manifest.json').read_bytes().decode('utf-8'); blank = text.replace(f'"bake_id": "{m["bake_id"]}"', f'"bake_id": "{export.BAKE_ID_BLANK}"'); assert blank != text and a.name == 'toy-' + m['bake_id'] and sorted(os.listdir(d + '/a')) == sorted(['index.json', a.name])
        import hashlib; want = hashlib.sha256(blank.encode() + b''.join(c + g for c, g in files(pk))).hexdigest()[:12]; assert m['bake_id'] == want and export.bake_id(blank, files(pk)) == want, 'bake_id is not the sha256 of the manifest with its id blanked, then the tile files tile-major, then card, colour then geometry'
        assert export.bake_id(blank, [(g, c) for c, g in files(pk)]) != want and export.bake_id(blank, files(pk)[::-1]) != want and export.bake_id(blank, [f for i, f in enumerate(files(pk)) if i % 3 != 1] + [f for i, f in enumerate(files(pk)) if i % 3 == 1]) != want, 'bake_id ignores the file order'
        pk3 = [list(f) for f in files(pk)]; pk3[40][1] += b'x'; assert export.bake_id(blank, [tuple(f) for f in pk3]) != want, 'a changed byte kept the bake_id'
        assert export.bake_id(blank.replace('"r_max_forward_m"', '"r_max_forward_m "', 1), files(pk)) != want and export.bake_id(blank + ' ', files(pk)) != want, 'a changed manifest kept the bake_id'
        import pathlib; was = pathlib.Path.write_text; pathlib.Path.write_text = lambda self, data, *a, **k: open(self, 'wb').write(data.replace('\n', '\r\n').encode('utf-8'))    # a platform whose text files end lines with CRLF
        try: w = _write(d + '/crlf', b, pk)
        finally: pathlib.Path.write_text = was
        raw = (w / 'manifest.json').read_bytes(); idx_raw = open(d + '/crlf/index.json', 'rb').read(); assert w.name == a.name and b'\r' not in raw and b'\r' not in idx_raw, 'the manifest or the index was written with the platform newline: the bytes served are not the bytes the id was hashed from'
        assert hashlib.sha256(raw.replace(m['bake_id'].encode(), export.BAKE_ID_BLANK.encode()) + b''.join(c + g for c, g in files(pk))).hexdigest()[:12] == m['bake_id']
        pk4 = dict(pk, camera=dict(pk['camera'], r_max_forward_m=pk['camera']['r_max_forward_m'] + 0.1)); a4 = _write(d + '/d', b, pk4); assert a4.name != a.name and [(e['surface'], e['geometry']) for row in pk4['tiles'] for e in row if e] == files(pk), 'a manifest moved under the same bake id (tile bytes identical, camera differs)'
        assert m['cards'][0]['near_m'] is None and m['cards'][-1]['far_m'] is None and m['cards'][0]['far_m'] == m['cards'][1]['near_m'] and len(m['cards']) == 3
        for t, row in enumerate(m['tiles']):
            for i, e in enumerate(row):
                for kind in export.KINDS: f = a / e[kind]['file']; assert f.stat().st_size == e[kind]['bytes'] and export.decode(f.read_bytes()).shape[:2] == (e['h'], export.TILE_W + 2 * export.APRON), (t, i, kind)
        assert m['bytes'] == sum(e[k]['bytes'] for row in m['tiles'] for e in row for k in export.KINDS) and m['encoding']['normal'] == 'rt8-up-walls' and m['curvature'] == dict(r_earth_m=ridge.R_EARTH, k_ref=ridge.KREF)
        idx = json.load(open(d + '/a/index.json')); export.validate(idx, export.SCHEMA['$defs']['index']); assert idx == dict(schema=1, default='toy', places={'toy': a.name})
        want = dict(credit_line='Contains modified Copernicus data: DEM © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.',
                    licence='Copernicus DEM licence: free, full and open access, with the credit line shown', dem_source='Copernicus DEM GLO-30 (30 m)', url='https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model'); assert m['attribution'] == want, m['attribution']
        c = _write(d + '/a', b, pk); assert c.name == a.name; other = dict(b['place'], id='other'); _write(d + '/a', b, pk, place=other); assert json.load(open(d + '/a/index.json'))['default'] == 'toy'
        _write(d + '/a', b, pk, place=other, default='other'); assert json.load(open(d + '/a/index.json'))['default'] == 'other'
        idx = json.load(open(d + '/a/index.json')); idx['default'] = 'gone'; open(d + '/a/index.json', 'w').write(json.dumps(idx)); _write(d + '/a', b, pk, place=other); assert json.load(open(d + '/a/index.json'))['default'] == 'other'
    finally: shutil.rmtree(d)
def test_tile_crop_and_null():
    """Each card tile is exactly the rows where its 8-bit alpha is non-zero (top and h in the manifest are those rows, the files decode to that band, the written alpha is the card's); a card with no rows in a tile is null there, writes no file and the bake still validates;
    a card empty everywhere is refused naming the splits, and a card with no solid terrain in any tile is refused."""
    d = tempfile.mkdtemp()
    try:
        b = _ring('wide3', WIDE3, [20, 55]); pk = export.pack(b); dest = _write(d, b, pk); m = json.load(open(dest / 'manifest.json'))
        for t in (0, 9, 31):
            for c, e in zip(b['cards'][t], m['tiles'][t]):
                rows = np.flatnonzero(np.rint(_tile_canvas(c) * 255).max(1) > 0); assert e['top'] == rows[0] and e['h'] == rows[-1] - rows[0] + 1 == c['alpha'].shape[0], (t, e, rows[0], rows[-1])
                col = export.decode((dest / e['surface']['file']).read_bytes()); assert col.shape[:2] == (e['h'], export.TILE_W + 2 * export.APRON) and np.abs(col[..., 3].astype(int) - np.rint(c['alpha'] * 255)).max() == 0, 'the written alpha is not the card alpha'
        t0 = _toy(); cs = [[dict(c) for c in tile] for tile in t0['cards']]; empty = dict(top=0, alpha=np.zeros((0, TW), np.float32), h=np.zeros((0, TW), np.float32), n_r=np.zeros((0, TW), np.float32), n_t=np.zeros((0, TW), np.float32), logd=np.zeros((0, TW), np.float32), wall=np.zeros((0, TW), bool))
        cs[5][2] = empty; op = [x.copy() for x in t0['opaque']]; op[5] = export.composite_alpha([(c['top'], c['alpha']) for c in cs[5] if c['alpha'].shape[0]], H, TW); b5 = dict(t0, cards=cs, opaque=op); pk5 = export.pack(b5)
        assert pk5['tiles'][5][2] is None and pk5['tiles'][4][2] is not None; dest = _write(d + '/null', b5, pk5); m5 = json.load(open(dest / 'manifest.json')); assert m5['tiles'][5][2] is None and not (dest / export.tile_file(2, 5, 'surface')).exists() and (dest / export.tile_file(2, 4, 'surface')).exists()
        for i, why in ((1, '20 km'), (2, '55 km')):
            gone = [[empty if j == i else c for j, c in enumerate(tile)] for tile in b['cards']]
            try: export.pack(dict(b, cards=gone))
            except export.Refusal as e: assert f'card {i} is empty' in str(e) and why in str(e), str(e)
            else: assert False, ('an empty card', i, 'was packed')
        liquid = [[dict(c, alpha=c['alpha'] * 0.4) if j == 1 else c for j, c in enumerate(tile)] for tile in t0['cards']]
        try: export.pack(dict(t0, cards=liquid))
        except export.Refusal as e: assert 'no solid terrain' in str(e), str(e)
        else: assert False, 'a card with no solid pixel in any tile was packed'
        walled = [[dict(c, wall=np.ones_like(c['wall'])) if j == 1 else c for j, c in enumerate(tile)] for tile in t0['cards']]
        try: export.pack(dict(t0, cards=walled))
        except export.Refusal as e: assert 'no solid terrain' in str(e), str(e)
        else: assert False, 'a card that is all wall was packed'
    finally: shutil.rmtree(d)
def test_cover_and_size_refusals_write_nothing():
    """write_bake measures the files it is handed: a hole in one tile's card (alpha zeroed over a band of columns) fails that tile's cover check and names the tile, a card leaving the frame, a tile file without its apron, surface and geometry of two sizes and an opaque view of the wrong
    rows are refused, and nothing is written."""
    d = tempfile.mkdtemp()
    try:
        b = _toy(); pk = export.pack(b); c = b['cards'][3][2]; hole = c['alpha'].copy(); hole[:, 100:140] = 0; bad = [list(r) for r in pk['tiles']]; bad[3][2] = dict(bad[3][2], surface=export.encode_surface(c['h'], pk['encoding'], c['wall'], hole)); _refuses(d + '/hole', b, dict(pk, tiles=bad), 'a bake whose card leaves a hole was written')
        try: _write(d + '/hole', b, dict(pk, tiles=bad))
        except export.Refusal as e: assert 'tile 3' in str(e), str(e)
        off = [list(r) for r in pk['tiles']]; off[7][0] = dict(off[7][0], top=H - 5); _refuses(d + '/off', b, dict(pk, tiles=off), 'a card leaving the frame was written')
        narrow = [list(r) for r in pk['tiles']]; c0 = b['cards'][2][0]; narrow[2][0] = dict(narrow[2][0], surface=export.encode_surface(c0['h'][:, 2:-2], pk['encoding'], c0['wall'][:, 2:-2], c0['alpha'][:, 2:-2]), geometry=export.encode_geometry(c0['n_r'][:, 2:-2], c0['n_t'][:, 2:-2], c0['logd'][:, 2:-2], b['meta']['encoding'])); _refuses(d + '/apron', b, dict(pk, tiles=narrow), 'a tile without its apron was written')
        try: _write(d + '/apron', b, dict(pk, tiles=narrow))
        except export.Refusal as e: assert 'apron' in str(e), str(e)
        mism = [list(r) for r in pk['tiles']]; mism[4][1] = dict(mism[4][1], geometry=export.encode_geometry(c0['n_r'][:50], c0['n_t'][:50], c0['logd'][:50], b['meta']['encoding'])); _refuses(d + '/size', b, dict(pk, tiles=mism), 'a surface and geometry of two sizes were written')
        _refuses(d + '/rows', b, pk, 'view plane_h disagreeing with the opaque view was written', view=dict(b['view'], plane_h=H + 1)); _refuses(d + '/short', b, dict(pk, tiles=pk['tiles'][:31]), 'a bake of 31 tiles was written')
    finally: shutil.rmtree(d)
ENC4 = dict(log_d_min=0.0, log_d_max=1.0, h_min_m=0.0, h_max_m=1.0)
def _flat_entry(top, h, w=export.TILE_W + 2 * export.APRON, seed=0, noise=False, distance_m=1000.0):
    rng = np.random.default_rng(seed); alpha = np.ones((h, w), np.float32); rgb = rng.random((h, w)).astype(np.float32) if noise else np.full((h, w), 0.5, np.float32); geo = rng.random((h, w)).astype(np.float32) if noise else np.full((h, w), 0.5, np.float32)
    enc = ENC4; return dict(top=top, surface=export.encode_surface(rgb, enc, np.zeros((h, w), bool), alpha), geometry=export.encode_geometry(geo, geo, geo, enc), distance_m=distance_m)
def test_card_cap_refusals():
    """A preset with 6 splits, or splits not increasing, is refused by load_preset before any march; a bake of 7 cards is refused; 6 cards that fit the budgets are written; 6 full-frame cards in every tile (the lit canvases of 13 tiles are 38 MB) are refused and write nothing."""
    d = tempfile.mkdtemp()
    try:
        for bad in ([5, 10, 20, 30, 40, 50], [6, 6], [6, 5], []):
            p = os.path.join(d, 'p.json'); json.dump(dict(presets=[dict(id='x', tz='UTC', card_split_km=bad)]), open(p, 'w'))       # a valid zone, so only the splits can refuse it
            try: ridge.load_preset('x', p)
            except export.Refusal: pass
            else: assert False, ('a preset with splits', bad, 'was accepted')
        json.dump(dict(presets=[dict(id='x')]), open(os.path.join(d, 'q.json'), 'w'))
        try: ridge.load_preset('x', os.path.join(d, 'q.json'))
        except export.Refusal: pass
        else: assert False, 'a preset without card_split_km was defaulted'
        json.dump(dict(presets=[dict(id='x', tz='Europe/Vienna', card_split_km=[1, 2, 3, 4, 5])]), open(os.path.join(d, 'r.json'), 'w')); assert ridge.load_preset('x', os.path.join(d, 'r.json'))['card_split_km'] == [1, 2, 3, 4, 5]
        for bad_tz in (None, '', 'Not/AZone'):
            p = os.path.join(d, 'tz.json'); json.dump(dict(presets=[dict(id='x', card_split_km=[6], **({} if bad_tz is None else dict(tz=bad_tz)))]), open(p, 'w'))
            try: ridge.load_preset('x', p)
            except export.Refusal: pass
            else: assert False, ('a preset with tz', bad_tz, 'was accepted')
        place = dict(id='synthetic', name='S', lat=0.0, lon=0.0, altitude_km=0.0, eye_m=1.0, tz='UTC'); meta = dict(curvature=dict(r_earth_m=1.0, k_ref=0.1), encoding=dict(log_d_min=0.0, log_d_max=1.0), material=ALPINE, relief=None); view = dict(look_az_deg=0.0, plane_h=H, px_per_deg_h=1.0, px_per_deg_v=1.0, exaggeration=1.0, horizon_row=1.0, sky_row=1.0, near_row=1.0)
        full = [np.ones((H, TW)) for _ in range(32)]; cards = lambda k: [dict(near_m=None if i == 0 else 1.0, far_m=None if i == k - 1 else 1.0) for i in range(k)]; cam = dict(r_max_m=100.0, r_max_forward_m=100.0)
        big = dict(cards=cards(6), tiles=[[_flat_entry(0, H, seed=0)] + [_flat_entry(0, H) for _ in range(5)] for _ in range(32)], camera=cam, encoding=ENC4)
        try: export.write_bake(d + '/big', place, view, meta, big, full)
        except export.Refusal as e: assert 'consecutive tiles' in str(e), str(e)
        else: assert False, 'six full-frame cards in every tile were written'
        assert not os.path.exists(d + '/big')
        ok = dict(cards=cards(6), tiles=[[_flat_entry(0, H, seed=0)] + [_flat_entry(0, 100, seed=i) for i in range(1, 6)] for _ in range(32)], camera=cam, encoding=ENC4); dest = export.write_bake(d + '/six', place, view, meta, ok, full); assert len(json.load(open(dest / 'manifest.json'))['cards']) == 6
        fwd = lambda r: dict(ok, camera=dict(r_max_m=100.0, r_max_forward_m=r)); bands6 = [[H] + [100] * 5] * 32; assert export.resident_bytes(bands6, export.run_tiles(100.0, 1000.0)) <= export.RESIDENT_BYTES_MAX < export.resident_bytes(bands6, export.run_tiles(1e6, 1000.0)), 'the fixture cannot tell the gate at r_max_forward_m from the gate at r_max_m'
        try: export.write_bake(d + '/fwd', place, view, meta, fwd(1e6), full)
        except export.Refusal as e: assert 'consecutive tiles' in str(e), str(e)
        else: assert False, 'a bake whose forward offset breaks the resident gate was written'
        try: export.write_bake(d + '/low', place, view, meta, fwd(50.0), full)
        except export.Refusal as e: assert 'below r_max_m' in str(e), str(e)
        else: assert False, 'a bake whose forward offset is below the worst-case offset was written'
        assert not os.path.exists(d + '/fwd') and not os.path.exists(d + '/low')
        try: export.check_budget(7, [1000] * 32, [[10] * 7] * 32, 100.0, 1000.0)
        except export.Refusal as e: assert 'above 6' in str(e)
        else: assert False, '7 cards were accepted'
    finally: shutil.rmtree(d)
def test_budgets():
    """A tile over 235 kB, a place over 7.5 MB and a resident run over 20 MB each refuse and one byte (one band row) under passes; the resident run wraps the ring: the last tiles and the first count as consecutive."""
    none = [[] for _ in range(export.TILES)]; call = lambda tb, bands, r=100.0, rmin=1000.0: export.check_budget(3, tb, bands, r, rmin)
    def refused(*a, **k):
        try: call(*a, **k)
        except export.Refusal: return True
        return False
    assert not refused([235_000] + [0] * 31, none) and refused([235_001] + [0] * 31, none), 'the tile cap'
    assert not refused([234_375] * 32, none) and refused([234_375] * 31 + [234_376], none), 'the place cap'
    rows = 20_000_000 // (4 * export.LIT_W); one = lambda h: [[h]] + [[] for _ in range(31)]
    assert not refused([0] * 32, one(rows)) and refused([0] * 32, one(rows + 1)), 'the resident cap'
    n = export.run_tiles(100.0, 1000.0); assert 5 < n < 32; split = [[] for _ in range(32)]; split[31] = [rows // 2]; split[0] = [rows - rows // 2 + 1]
    assert refused([0] * 32, split), 'the resident run does not wrap the ring (tile 31 and tile 0 are consecutive)'; split[0] = [rows - rows // 2]; assert not refused([0] * 32, split)
    far = [[] for _ in range(32)]; far[0] = [rows // 2]; far[n + 3] = [rows - rows // 2 + 1]; assert not refused([0] * 32, far), 'a run is only N tiles long'; far[n - 1] = far[n + 3]; far[n + 3] = []; assert refused([0] * 32, far)
    assert export.run_tiles(0.0, 1000.0) == math.ceil(export.HFOV_MAX_DEG / 11.25) + 5 and export.run_tiles(250.0, 20000.0) > export.run_tiles(25.0, 20000.0) and export.run_tiles(1e9, 1.0) == 32, 'N = ceil(arc_max / 11.25) + 1 + 4'
    rows_t = [[10, 20] if t in (30, 31, 0, 1) else [] for t in range(32)]; assert export.resident_bytes(rows_t, 4) == 4 * export.LIT_W * 120 and export.resident_bytes(rows_t, 3) == 4 * export.LIT_W * 90 and export.resident_bytes(rows_t, 40) == 4 * export.LIT_W * 120
def _fit(d, r, phis=None): return export.fit_px(d, r, ridge.HPX_DEG, phis)
def _brute_fit(d, r, phis, ppd, n=20001):
    """The worst error of the best line, by brute force: the least-squares line over n uniform samples (the integral to within 1e-4 of itself), the error on the same n."""
    half = math.radians(export.HFOV_MAX_DEG) / 2; b = np.linspace(-half, half, n)[None, :]; p = np.linspace(0, 2 * math.pi, phis, endpoint=False)[:, None]; A = np.arctan2(d * np.sin(b) - r * np.sin(p), d * np.cos(b) - r * np.cos(p))
    bc = b - b.mean(); s = (A * bc).sum(-1, keepdims=True) / (bc * bc).sum(); return math.degrees(float(np.abs(A - (A.mean(-1, keepdims=True) + s * bc)).max())) * ppd
def test_fit_px_is_the_continuous_error():
    """fit_px is the worst error of the best line over the whole viewport, not of a few samples of it: it equals a brute-force measure (20001 samples, line and error) within 0.1 card px at the offsets the bound is set at (an offset a few samples undercount by more than that), over the whole circle and at phi = 0."""
    ppd = ridge.HPX_DEG; seen = 0
    for d, r, phis in ((410.0, 205.0, 1), (410.0, 98.0, export.PHI_STEPS), (1500.0, 600.0, 1), (1500.0, 300.0, export.PHI_STEPS), (60.0, 30.0, export.PHI_STEPS), (20000.0, 9000.0, 1)):
        got, want = _fit(d, r, phis), _brute_fit(d, r, phis, ppd); assert abs(got - want) < 0.1, ('fit_px is not the continuous error', d, r, phis, got, want); seen += want > 5
    assert seen >= 4, 'the cases are too tame to tell a coarse measure from the continuous one'
def test_r_max():
    """On a card at 1.5 km: r_max_m falls as FIT_PX_MAX falls and is at most half the distance; it is the largest offset within the bound (the fit error at r_max is within it, a little more is not); a forward-only sweep of phi finds a larger r_max than the whole circle (the error is in the phi
    that is not forward); the binding card tile is the nearest one (each tile's line is fitted at its own distance_m); the resident gate binds when its tiles are heavy; a place whose r_max_m is below 25 refuses and names the card and tile."""
    ppd = ridge.HPX_DEG; dist = [[1500.0] for _ in range(32)]; bands = [[100] for _ in range(32)]; saved = (export.FIT_PX_MAX, export.PHI_STEPS)
    try:
        r = export.solve_r_max(dist, bands, ppd); assert 25 < r <= 750 and _fit(1500.0, r) <= export.FIT_PX_MAX + 1e-9 and _fit(1500.0, r + 0.5) > export.FIT_PX_MAX, ('r_max is not the largest offset within the bound', r, _fit(1500.0, r), _fit(1500.0, r + 0.5))
        export.FIT_PX_MAX = 12.0; r12 = export.solve_r_max(dist, bands, ppd); export.FIT_PX_MAX = 60.0; r60 = export.solve_r_max(dist, bands, ppd); export.FIT_PX_MAX = saved[0]; assert r12 < r < r60, (r12, r, r60)
        export.FIT_PX_MAX = 1e9; assert export.solve_r_max(dist, bands, ppd) == 750.0, 'r_max is not capped at half the nearest distance'; export.FIT_PX_MAX = saved[0]
        export.PHI_STEPS = 1; rf = export.solve_r_max(dist, bands, ppd); export.PHI_STEPS = saved[1]; assert rf > r + 5, ('a forward-only sweep finds the same r_max', rf, r)
        rp = export.solve_r_max(dist, bands, ppd, phis=1); assert rp == rf and 25 < rp <= 750 and _fit(1500.0, rp, 1) <= export.FIT_PX_MAX + 1e-9 and _fit(1500.0, rp + 0.5, 1) > export.FIT_PX_MAX, ('the phi = 0 bound is not the largest offset within the bound at phi = 0', rp, rf)
        assert _fit(1500.0, rp) > export.FIT_PX_MAX, 'the forward offset fits at some other phi, so the two numbers do not differ'
        mixed = [[1500.0 if t == 3 else 9000.0] for t in range(32)]; assert export.solve_r_max(mixed, bands, ppd) == r, 'the binding tile is not the nearest one'
        dist2 = [[20000.0] for _ in range(32)]; free = export.solve_r_max(dist2, bands, ppd); heavy = [[1700000 // (4 * export.LIT_W)] for _ in range(32)]; held = export.solve_r_max(dist2, heavy, ppd)
        assert held < free - 100 and export.resident_bytes(heavy, export.run_tiles(held, 20000.0)) <= export.RESIDENT_BYTES_MAX < export.resident_bytes(heavy, export.run_tiles(held + 1.0, 20000.0)), ('the resident gate does not bind r_max', held, free)
        held_f = export.solve_r_max(dist2, heavy, ppd, phis=1); assert held_f >= held and export.resident_bytes(heavy, export.run_tiles(held_f, 20000.0)) <= export.RESIDENT_BYTES_MAX < export.resident_bytes(heavy, export.run_tiles(held_f + 1.0, 20000.0)), ('the resident gate does not bind the forward offset', held_f, held)
        two = [[5000.0, 40.0 if t == 7 else 5000.0] for t in range(32)]
        try: export.solve_r_max(two, [[100, 100] for _ in range(32)], ppd)
        except export.Refusal as e: assert 'below 25' in str(e) and 'card 1' in str(e) and 'tile 7' in str(e), str(e)
        else: assert False, 'a bake whose r_max_m is below 25 was accepted'
        close = [[30.0] for _ in range(32)]
        try: export.solve_r_max(close, bands, ppd)
        except export.Refusal as e: assert 'below 25' in str(e) and 'card 0' in str(e), str(e)
        else: assert False, 'a nearest card at 30 m was accepted'
    finally: export.FIT_PX_MAX, export.PHI_STEPS = saved
def test_pack_distance_and_r_max_in_the_bake():
    """pack: a card tile's distance_m is exp(median ln d) over the interior solid pixels that are not wall (not the wall rows, not the apron columns); the manifest camera is the r_max_m of those distances and no per-card scale or median is written."""
    b = _toy(); cs = [[dict(c) for c in tile] for tile in b['cards']]; c = dict(cs[10][1]); n = c['alpha'].shape[0]; wall = np.zeros_like(c['wall']); wall[:n * 3 // 4] = True; ld = np.where(wall, c['logd'] + 3.0, c['logd']).copy(); ld[:, :2] += 2.0; ld[:, -2:] += 2.0; cs[10][1] = dict(c, wall=wall, logd=ld)
    pk = export.pack(dict(b, cards=cs)); inner = (slice(None), slice(export.APRON, -export.APRON)); want = float(np.exp(np.median(ld[inner][~wall[inner]]))); with_wall = float(np.exp(np.median(ld[inner]))); assert abs(with_wall - want) > 0.05 * want, 'the fixture cannot tell wall rows from ground'
    assert abs(pk['tiles'][10][1]['distance_m'] - want) < 1e-9 * want, ('the distance counted wall rows or the apron', pk['tiles'][10][1]['distance_m'], want); assert set(pk['tiles'][10][1]) == {'top', 'surface', 'geometry', 'distance_m'} and set(pk['cards'][0]) == {'near_m', 'far_m'}
    base = export.pack(b); assert base['camera']['r_max_m'] >= 25 and base['camera']['r_max_forward_m'] >= base['camera']['r_max_m'] and abs(base['report']['nearest_m'] - min(float(np.exp(c[0]['logd'][:, export.APRON:-export.APRON].min())) for c in b['cards'])) < 1e-6 and len(base['report']['fit_px']) == 3 and max(base['report']['fit_px']) <= export.FIT_PX_MAX + 1e-6
    near = export.pack(_toy(dists=(1500.0, 15000.0, 50000.0))); assert near['camera']['r_max_forward_m'] > near['camera']['r_max_m'] + 5, ('the forward offset was searched over the whole circle', near['camera'])
    assert abs(base['cards'][0]['far_m'] - 1500.0) < 1e-6 and base['cards'][0]['near_m'] is None and base['cards'][1]['near_m'] == base['cards'][0]['far_m']
def test_the_sheet_draws_the_ring():
    """The contact sheet is the ring at 1/4 width (1600 px) with a mark on each of the 32 tile boundaries, in the composite, every card's strip and the depth image, stacked: composite, K cards, depth."""
    b = _ring('wide3', WIDE3, [20, 55]); png = export.sheet(b); img = export.imagecodecs.png_decode(png); k = 3; nb = b['cov'].shape[0]; assert img.shape == ((1 + k) * H + 2 * nb, W // 4, 3), img.shape
    mark = np.arange(32) * 200 // 4; sky = np.array(export.SHEET_SKY); reddish = lambda px: (px[..., 0] > px[..., 2] + 40); assert reddish(img[2, mark].astype(int)).all() and not reddish(img[2, mark + 7].astype(int)).any(), 'the tile boundaries are not drawn on the composite'
    assert reddish(img[(1 + k) * H + 3, mark].astype(int)).all(), 'the tile boundaries are not drawn on the depth image'; assert abs(img[2, 1].astype(int) - np.rint(np.array(export.SHEET_SKY) * 255)).max() <= 2, 'the sky is not the flat sky'

# ---------------------------------------------------------------------------------------- the real thing: Vienna
_VIENNA = {}
def _vienna_bake():
    if 'b' not in _VIENNA:
        saved = ridge.P
        try: b = export.bake_place('vienna'); _VIENNA.update(b=b, pxv=ridge.PXDEG_V, P=dict(ridge.P), rowang=ridge.rowang.copy(), skyline=None)
        finally: ridge.P = saved
    return _VIENNA['b']
def _vienna_ring(splits, tiles):
    """Vienna's whole-ring march and seams for the given splits, cards on only the given tiles: (d, seams, {t: cards}, {t: opaque})."""
    saved = ridge.P
    try:
        p = ridge.configure(dict(ridge.load_preset('vienna'), card_split_km=splits)); d, _, Hh, _ = ridge.stage0(False); a, h = ridge.prefilter(d, Hh, p['prefilter_m']); ridge.set_view(a.max(0)); sm = ridge.seams(ridge.coverage(d, a), [k * 1000.0 for k in splits], d); op = ridge.opaque(a); D_, A_, H_, nrm = ridge.join_near(d, a, h, ridge.near_march(p['prefilter_m']))
        cols = lambda x, t: ridge.ring_cols(x, t * export.TILE_W - export.APRON, export.TILE_W + 2 * export.APRON)
        return d, sm, {t: ridge.cards(D_, cols(A_, t), cols(H_, t), cols(sm, t), tuple(cols(x, t) for x in nrm)) for t in tiles}, {t: cols(op, t) for t in tiles}
    finally: ridge.P = saved
def test_vienna_k1_k2_k3():
    """Vienna with card_split_km [6], [6, 40] and [6, 20, 40]: 2, 3 and 4 cards, seams ordered in every column of the ring, each composite of a tile (the rest azimuth's, the north's and the last one) equals the opaque view within 0.02; the cross-fade column count is printed."""
    for sp in ([6], [6, 40], [6, 20, 40]):
        d, sm, cs, op = _vienna_ring(sp, (0, 19, 31)); assert sm.shape == (len(sp), W)
        if len(sp) > 1: assert (np.diff(np.log(sm), axis=0) >= 0.4 - 1e-9).all(), 'seams out of order'
        for t, tile in cs.items():
            assert len(tile) == len(sp) + 1; comp = 1 - np.prod([1 - _tile_canvas(c) for c in tile], axis=0); assert np.abs(comp - op[t]).max() < 0.02, (sp, t, np.abs(comp - op[t]).max())
        xf = int(np.any([((0.02 < _tile_canvas(c)) & (_tile_canvas(c) < 0.98)).sum(0) > 3 for c in cs[19]], axis=0).sum())
        print(f'   K={len(sp)} splits {sp}: {len(cs[19])} cards, tile 19 bands {[(c["top"], c["alpha"].shape[0]) for c in cs[19]]}, seam medians km {[round(float(np.median(s)) / 1000, 1) for s in sm]}, cross-fade columns {xf} of {export.TILE_W + 4} in tile 19')
def test_bake_place_manifest_fields_on_vienna():
    """bake_place on the real Vienna preset: 32 tiles of three cards, the place carries the ground (km) and the eye, horizon_row is the row where the elevation angle is 0, px_per_deg_h is the ring's, look_az_deg is the rest azimuth; the shared apron of neighbouring tiles is the same pixels
    (the tile cut at the real preset), and write_bake of its packed tiles validates with index default 'vienna', no temp dir left, r_max_m and the worst fit error per card printed."""
    b = _vienna_bake(); P = _VIENNA['P']; rowang = _VIENNA['rowang']; pxv = _VIENNA['pxv']; pl, view = b['place'], b['view']; assert len(b['cards']) == 32 and all(len(t) == 3 for t in b['cards']) and len(b['opaque']) == 32 and b['seams'].shape == (2, W)
    assert abs(pl['altitude_km'] * 1000 - P['ground_m']) < 1e-6 and abs(pl['eye_m'] - P['eye_m']) < 1e-9 and pl['id'] == 'vienna' and view['look_az_deg'] == P['az_center'] == 214.0
    assert 0 < view['sky_row'] < view['horizon_row'] < view['near_row'] < H and abs(rowang[int(view['horizon_row'])]) <= 1.0 / pxv, (view, rowang[int(view['horizon_row'])]); assert view['px_per_deg_h'] == ridge.HPX_DEG and abs(view['exaggeration'] - pxv / ridge.HPX_DEG) < 1e-9
    T_, A_ = export.TILE_W, export.APRON
    for t in (0, 19, 31):
        nxt = b['cards'][(t + 1) % 32]
        for i, c in enumerate(b['cards'][t]):
            assert (_tile_canvas(c)[:, T_ + A_:T_ + 2 * A_] == _tile_canvas(nxt[i])[:, A_:2 * A_]).all(), ('the apron is not the neighbour tile', t, i); seen = _tile_canvas(c)[:, T_ + A_:T_ + 2 * A_] > 0
            assert (_tile_canvas(c, 'logd')[:, T_ + A_:T_ + 2 * A_][seen] == _tile_canvas(nxt[i], 'logd')[:, A_:2 * A_][seen]).all(), ('the apron is not the neighbour tile', t, i, 'logd')
    d = tempfile.mkdtemp()
    try:
        pk = export.pack(b); rp = pk['report']; print('   vienna r_max_m', pk['camera']['r_max_m'], 'r_max_forward_m', pk['camera']['r_max_forward_m'], 'nearest card m', round(rp['nearest_m']), 'resident run', rp['run_tiles'], 'tiles', rp['resident_bytes'], 'bytes; worst fit error per card (card px)', [round(x, 1) for x in rp['fit_px']], 'sky/low deg', round(b['v']['sky_deg'], 2), round(b['v']['low_deg'], 2), 'exaggeration', round(view['exaggeration'], 2))
        dest = _write(d, b, pk); m = json.load(open(dest / 'manifest.json')); export.validate_manifest(m); assert m['camera']['r_max_m'] >= export.R_MAX_FLOOR_M and m['camera']['r_max_forward_m'] >= m['camera']['r_max_m']
        assert json.load(open(d + '/index.json'))['default'] == 'vienna' and sorted(os.listdir(d)) == sorted(['index.json', dest.name]), os.listdir(d); print('   vienna manifest bytes', m['bytes'], 'largest tile', max(sum(e[k]['bytes'] for e in row if e for k in export.KINDS) for row in m['tiles']))
    finally: shutil.rmtree(d)

# ---------------------------------------------------------------------------------------- the written files are the cards
def test_written_cards_decode_to_the_cards_in_memory():
    """Vienna's cards in three tiles (north, the rest azimuth's, the wrap), written and decoded again: alpha exactly, the height within one step of the 16-bit range, the wall flag on exactly the wall pixels, the normal channels in their order (R along the ray, G across it, a wall face up), and the log-distance over the encoding
    range, within quantisation."""
    b = _vienna_bake(); d = tempfile.mkdtemp()
    try:
        dest = _write(d, b, export.pack(b)); m = json.load(open(dest / 'manifest.json')); enc = m['encoding']; span = enc['log_d_max'] - enc['log_d_min']; hs = enc['h_max_m'] - enc['h_min_m']; partial_seen = near_seen = wall_seen = 0; heights = []
        for t in (0, 19, 31):
            for c, rec in zip(b['cards'][t], m['tiles'][t]):
                sf = export.decode((dest / rec['surface']['file']).read_bytes()); geo = export.decode((dest / rec['geometry']['file']).read_bytes()); al = c['alpha']; wall = c['wall']; nr = c['near']; live = al > 0; solid = live & ~wall & ~nr; part = (al > 0.05) & (al < 0.95) & ~wall & ~nr; partial_seen += int(part.sum()); near_seen += int((nr & live).sum()); wall_seen += int((wall & live).sum())
                assert (sf[..., 3] == np.rint(al * 255)).all(), 'alpha is not exact'; hh = enc['h_min_m'] + (sf[..., 0].astype(int) * 256 + sf[..., 1]) / 65535.0 * hs; assert np.abs(hh - c['h'])[live].max() <= hs / 65535.0 * 0.5 + 1e-3, ('the height is off', float(np.abs(hh - c['h'])[live].max()))
                assert ((sf[..., 2] == 255) == (wall & live)).all() and (sf[..., 2][~wall] == 0).all(), 'the wall flag is not B = 255 on exactly the wall pixels'; assert (sf[..., :3][~live] == 0).all(), 'a zero alpha carries data'
                assert (geo[..., 3] == 255).all(); q = 1.0 / 255 + 1e-6; assert (geo[..., 0][wall] == 128).all() and (geo[..., 1][wall] == 128).all(), 'a wall is not written face up'
                assert np.abs(geo[..., 0] / 255.0 * 2 - 1 - c['n_r'])[solid].max() < 2 * q and np.abs(geo[..., 1] / 255.0 * 2 - 1 - c['n_t'])[solid].max() < 2 * q, 'a normal channel is off or swapped'
                assert np.abs(enc['log_d_min'] + geo[..., 2] / 255.0 * span - c['logd'])[solid].max() < span * q, 'the log-distance is off or not over the encoding range'
                assert np.abs(c['n_r'][solid]).mean() > 0.05 and np.abs(c['n_t'][solid]).mean() > 0.01 and np.abs(c['n_r'][solid].mean() - c['n_t'][solid].mean()) > 0.0, 'the fixture does not tell the channels apart'
                heights.append(hh[solid]); assert (geo[..., 2][nr & live] == 0).all(), 'a near pixel is not at the clip distance (B = 0)'
        assert partial_seen > 0, 'the fixture has no partial alpha'; assert near_seen > 1000, 'the fixture has no near ground'; assert wall_seen > 0, 'the fixture has no wall'; assert np.concatenate(heights).std() > 5.0, 'the heights are flat'
    finally: shutil.rmtree(d)

# ---------------------------------------------------------------------------------------- wall rows
def _first_sample_angle(b, i):
    """Per column, the angle of the first sample card i reads: the first sample at or beyond its near seam, less the cross-fade half-width (card 0: sample 0 of the joined march, the near start)."""
    k0 = np.zeros(NW, int) if i == 0 else np.array([np.searchsorted(b['D'], b['seams'][i - 1][x] * math.exp(-ridge.XF)) for x in range(NW)]); return k0, b['a'][k0, np.arange(NW)]
def test_wall_rows_flagged():
    """Every card, card 0 included, flags as wall exactly the rows below the angle of its first sample (the extruded face of the ridge it starts at; card 0's first sample is the near march's, under the frame, so it has none); the wall is written face up in the geometry file (R = G = 128) and no pixel has r2 + t2 above 1.02; wall pixels keep that sample's
    distance and their height is that sample's, constant down the column."""
    steep = 0
    for make in (lambda: _bake(WALLED, [20]), lambda: _bake(WIDE3, [20, 55]), lambda: _bake(_receding, [6]), lambda: _bake(_ramp, [20], fixed_m=[20000.0])):       # the ramp's seam is fixed: the wall must stand on the slope, below the height where every material is rock or snow
        b = make(); lo = ridge.rowang - 0.5 / ridge.PXDEG_V; seen = 0
        for i, c in enumerate(b['cards']):
            k0, a0 = _first_sample_angle(b, i); want = (lo[:, None] < a0[None, :])[c['top']:c['top'] + c['alpha'].shape[0]]; assert (c['wall'] == want).all(), ('wall rows are not the rows below the first sample', i, int((c['wall'] != want).sum())); seen += int(want.sum())
            geo = export.decode(export.encode_geometry(c['n_r'], c['n_t'], c['logd'], dict(log_d_min=math.log(D[0]), log_d_max=math.log(D[-1])), c['wall'])); r, t = geo[..., 0] / 255.0 * 2 - 1, geo[..., 1] / 255.0 * 2 - 1
            assert (np.abs(r[c['wall']]) < 0.01).all() and (np.abs(t[c['wall']]) < 0.01).all() and (r ** 2 + t ** 2 <= 1.02).all(), 'a wall is not written face up'
            for x in np.flatnonzero(c['wall'].any(0)):
                rows = np.flatnonzero(c['wall'][:, x]); ld = c['logd'][rows, x]; assert np.ptp(ld) < 1e-5 and abs(math.exp(ld[0]) - b['D'][k0[x]]) < 1e-3 * b['D'][k0[x]] + 60, ('a wall keeps its sample distance', x)
                assert np.abs(c['h'][rows, x] - b['h'][k0[x], x]).max() < 1e-3, ('a wall keeps its sample height', x)
        assert seen > 1000, 'the fixture has no wall'
        for i in range(1, len(b['cards'])):
            c = b['cards'][i]; steep += int((np.sqrt(np.clip(1 - c['n_r'] ** 2 - c['n_t'] ** 2, 0, 1))[c['wall']] < 0.93).sum())
    assert steep > 1000, 'no wall pixel has a steep face under it: a wall lit by its own normal would pass'
def test_the_sheet_lights_a_wall_with_the_face_up():
    """The contact sheet shades a wall pixel as an up-facing one whatever normal the card carries there, and a non-wall pixel by its normal, both over the colour its material gives its height (ridge.albedo, the sheet's evaluator)."""
    n = 4; c = dict(h=np.full((n, n), 100.0, np.float32), alpha=np.ones((n, n), np.float32), n_r=np.full((n, n), 0.9, np.float32), n_t=np.zeros((n, n), np.float32), wall=np.zeros((n, n), bool)); c['wall'][:, :2] = True
    rgb, _ = export.lit(c, ALPINE); L = np.array(export.SHEET_LIGHT) / np.linalg.norm(export.SHEET_LIGHT); up = 0.35 + 0.65 * L[2]; tilted = 0.35 + 0.65 * np.clip(0.9 * L[0] + np.sqrt(1 - 0.81) * L[2], 0, 1); nu = np.sqrt(1 - 0.81)
    assert np.allclose(rgb[:, :2], ridge.albedo(np.full((n, 2), 100.0), np.ones((n, 2)), ALPINE) * up) and np.allclose(rgb[:, 2:], ridge.albedo(np.full((n, 2), 100.0), np.full((n, 2), nu), ALPINE) * tilted) and abs(up - tilted) > 0.05, (rgb[0, 0], rgb[0, 3])
# ---------------------------------------------------------------------------------------- the near clip, the ground rows
def _nearest_solid(c):
    """The nearest solid (alpha >= 0.5) pixel that is neither wall nor near ground of a card tile's interior columns, metres; None where there is none (computed here from the arrays, not by pack)."""
    ld, al, wl, nr = (c[k][:, export.APRON:-export.APRON] for k in ('logd', 'alpha', 'wall', 'near')); m = (al >= 0.5) & ~wl & ~nr; return float(np.exp(np.float64(ld[m].min()))) if m.any() else None
def test_r_max_holds_for_the_nearest_terrain_of_every_tile_and_near_only_tiles_bind_at_the_clip():
    """The offset range is where the linear map holds for the NEAREST solid terrain each card draws in each tile (ruling ridge-offset-range-fit), not its median: a tile whose card 0 spans 600 to 2000 m has its median near 1200 m, and at the r_max the median would give the 600 m pixels err past FIT_PX_MAX.
    So the fit at every tile's nearest solid pixel is within the bound at r_max_m (over the circle) and at r_max_forward_m (phi 0), and the bound is reached: a little more offset breaks it at the binding tile.  A tile whose card 0 draws only near ground (under the clip) is slid at the clip distance (its distance_m) and binds there."""
    b = _toy(); cs = [[dict(c) for c in tile] for tile in b['cards']]; c = dict(cs[7][0]); n = c['alpha'].shape[1]
    ld = np.log(np.linspace(600.0, 2000.0, n))[None, :].repeat(c['alpha'].shape[0], 0).astype(np.float32); cs[7][0] = dict(c, logd=ld)
    bad = dict(cs[5][0]); cs[5][0] = dict(bad, near=np.ones_like(bad['near']), logd=np.full_like(bad['logd'], math.log(300.0)))     # tile 5: card 0 is all near ground
    pk = export.pack(dict(b, cards=cs)); r, rf = pk['camera']['r_max_m'], pk['camera']['r_max_forward_m']; ppd = ridge.HPX_DEG; worst = worst_f = 0.0; seen = 0
    for t, tile in enumerate(cs):
        for i, card in enumerate(tile):
            d = _nearest_solid(card)
            if d is None: assert (t, i) == (5, 0), ('a tile has no solid terrain but was not made all near ground', t, i); d = ridge.NEAR_CLIP_M
            seen += 1; assert export.fit_px(d, r, ppd) <= export.FIT_PX_MAX + 1e-6 and export.fit_px(d, rf, ppd, 1) <= export.FIT_PX_MAX + 1e-6, ('the nearest terrain of a tile is outside the fit bound', t, i, d, r, rf)
            worst, worst_f = max(worst, export.fit_px(d, r + 0.5, ppd)), max(worst_f, export.fit_px(d, rf + 0.5, ppd, 1))
    assert seen == 32 * 3 and worst > export.FIT_PX_MAX and worst_f > export.FIT_PX_MAX, ('the range stops short of the bound of the nearest terrain', worst, worst_f)
    assert abs(pk['tiles'][7][0]['distance_m'] - float(np.exp(np.median(np.log(np.linspace(600.0, 2000.0, n)))))) < 1.0, 'the manifest distance is still the median'
    assert r < export.solve_r_max([[1200.0 if (t, i) == (7, 0) else None for i in range(3)] for t in range(32)], [[100] * 3 for _ in range(32)], ppd) - 5, 'the range is the median model'
    near_free = export.pack(_toy()); assert pk['camera']['r_max_m'] < near_free['camera']['r_max_m'], 'the 600 m pixels do not bind'
def test_the_near_clip_compare_does_not_depend_on_float32_rounding():
    """A card 0 exactly at the near clip is accepted whatever the clip's value: exp of a float32 ln 700 is 699.99994, which a strict compare against a 700 m clip refuses; one 1.5 per mille under the clip is still refused."""
    saved = ridge.NEAR_CLIP_M; d = tempfile.mkdtemp()
    try:
        for clip in (500.0, 520.0, 700.0):
            ridge.NEAR_CLIP_M = clip; b = _toy(dists=(clip, 15000.0, 50000.0), amp=0.0); pk = export.pack(b); assert pk['tiles'][0][0]['distance_m'] != 0
            try: dest = _write(d + f'/ok{clip:g}', b, pk)
            except export.Refusal as e: assert 'near clip' not in str(e), ('a card 0 at the near clip was refused', clip, str(e)); raise
            assert dest.exists(), ('a card 0 at the near clip was refused', clip)
        b = _toy(dists=(698.9, 15000.0, 50000.0), amp=0.0); ridge.NEAR_CLIP_M = 700.0; _refuses(d + '/under', b, export.pack(b), 'a card 0 under the near clip was written')
    finally: ridge.NEAR_CLIP_M = saved; shutil.rmtree(d)
def test_set_view_keeps_the_ground_rows_under_the_horizon():
    """A skyline +28 degrees high and +5 low is compressed below 1x so the horizon sits at row 450 or above (GROUND_ROWS_MIN rows under it); one +60 degrees high cannot hold them even at 0.5x and refuses naming sky_deg and the floor; a Vienna-like skyline
    (the 10x clamp) and one that fits its anchors above 1x are unchanged to 1e-9; a low skyline never binds the horizon."""
    assert ridge.GROUND_ROWS_MIN == 150 and ridge.E_MIN == 0.5 and ridge.NEAR_CLIP_M == 500.0, 'the authored constants are pinned'
    sk = np.full(W, 5.0); sk[100] = 60.0
    try: ridge.set_view(sk)
    except export.Refusal as e:
        if 'under the horizon' not in str(e): raise      # not the refusal: a crash
        assert '60.00' in str(e) and '8.89' in str(e) and '0.5x' in str(e), str(e)
    else: assert False, 'a skyline that cannot hold the ground rows was accepted'
    sk = np.full(W, 5.0); sk[100] = 28.0; v = ridge.set_view(sk)
    assert v['horizon_row'] <= H - ridge.GROUND_ROWS_MIN + 1e-6 and v['exaggeration'] < 1 and v['binds'] == 'horizon' and abs(v['horizon_row'] - (H - ridge.GROUND_ROWS_MIN)) < 1e-6 and abs(v['px_per_deg'] - (H - 150 - 0.04 * H) / 28.0) < 1e-9, v
    sk = np.full(W, 1.7); sk[7] = 2.0; v = ridge.set_view(sk); assert abs(v['px_per_deg'] - 10 * ridge.HPX_DEG) < 1e-9 and abs(v['horizon_row'] - (2.0 * 10 * ridge.HPX_DEG + 0.04 * H)) < 1e-9 and v['binds'] == 'ceiling', v
    sk = np.full(W, 1.0); sk[7] = 3.0; sk[9] = -1.0; v = ridge.set_view(sk); assert abs(v['px_per_deg'] - 0.62 * H / 4.0) < 1e-9 and v['binds'] == 'skyline', v
    sk = np.full(W, -30.0); sk[7] = 12.0; v = ridge.set_view(sk); assert abs(v['px_per_deg'] - 0.5 * ridge.HPX_DEG) < 1e-9 and v['binds'] == 'floor', v
    sk = np.full(W, -9.0); sk[7] = -2.0; v = ridge.set_view(sk); assert v['horizon_row'] < 0.04 * H and v['binds'] != 'horizon', v
def test_the_near_clip_and_the_ground_rows_are_refused_at_the_writer():
    """The march starts at the authored near clip; write_bake refuses a bake whose card 0 stands nearer than it (nothing nearer is baked as terrain), and validate_manifest, which the writer and the committed bakes go through, refuses a plane with fewer than GROUND_ROWS_MIN rows under the horizon and accepts exactly that many."""
    assert D[0] == ridge.NEAR_CLIP_M == ridge.schedule(True)[0] and (np.diff(D) > 0).all(), 'the march does not start at the near clip'
    d = tempfile.mkdtemp()
    try:
        b = _toy(); pk = export.pack(b); near = export.pack(_toy(dists=(300.0, 15000.0, 50000.0))); assert near['report']['nearest_m'] < ridge.NEAR_CLIP_M
        try: _write(d + '/near', b, near)
        except export.Refusal as e: assert 'near clip' in str(e), str(e); assert not os.path.exists(d + '/near')
        else: assert False, 'a bake whose card 0 stands inside the near clip was written'
        _refuses(d + '/short', b, pk, 'a plane with 149 rows under the horizon was written', view=dict(b['view'], horizon_row=451.0)); dest = _write(d + '/ok', b, pk, view=dict(b['view'], horizon_row=450.0)); m = json.load(open(dest / 'manifest.json')); export.validate_manifest(m)
        m['view']['horizon_row'] = 450.5
        try: export.validate_manifest(m)
        except export.Refusal as e: assert 'GROUND_ROWS_MIN' in str(e), str(e)
        else: assert False, 'validate_manifest accepted a short plane'
    finally: shutil.rmtree(d)
# ---------------------------------------------------------------------------------------- the near ground: the place's own terrain under the clip, drawn by card 0 inside the clip's silhouette
def _blend(L, ld, arr, x):
    """arr (K, n) read at hits of log-distance ld (between the samples of log-distance L), blended by the fraction between the two samples: what ridge.cards does for a normal."""
    kk = np.searchsorted(L, ld, 'left'); kp = np.maximum(kk - 1, 0); t = np.clip((ld - L[kp]) / np.maximum(L[kk] - L[kp], 1e-12), 0, 1); return arr[kp, x] + t * (arr[kk, x] - arr[kp, x])
def test_near_ground_draws_inside_the_clip_silhouette():
    """Eye 1.6 m over flat ground, a ramp hill at 150-300 m rising to 60 m (its crest stands far above the angle of the clip sample) and a far ridge in half the ring: card 0 composites to the opaque view of the FAR march (the hill above the clip line is not drawn; without the cap it stands above the far ridge),
    its rows are near ground, not wall, and their normals are normals(dn, hn) of the near march blended at the hit (the ramp's, not the far sample 0's)."""
    saved = ridge.P.get('eye_m'); ridge.P.update(eye_m=1.6)
    try:
        far = block(36, 359.99, 20000, 21500, 1500); hf = lambda dk, az: np.maximum(np.where((dk >= 150) & (dk < 300), 0.4 * (dk - 150), 0.0), np.asarray(far(dk, az), float))
        A, Hh = rays(hf, eye=1.6); a, h = ridge.prefilter(D, Hh, 0.0); ridge.set_view(a.max(0)); near = near_rays(hf); Dj, Aj, Hj, Nj = ridge.join_near(D, a, h, near); aw, hw, nj = _w(Aj), _w(Hj), tuple(_w(x) for x in Nj)
        c = ridge.cards(Dj, aw, hw, np.zeros((0, NW)), nj)[0]; comp = _canvas(c); opq = ridge.opaque(_w(a)); err = np.abs(comp - opq).max(); assert err < export.COVER_TOL, ('card 0 draws outside the silhouette of the terrain at the clip', err)
        free = ridge.cards(Dj, _w(np.concatenate([near[1], a])), hw, np.zeros((0, NW)), nj)[0]; assert np.abs(_canvas(free) - opq).max() > 5 * export.COVER_TOL, 'the fixture cannot tell a hill above the clip line (the cap is not tested)'
        x = 300; al, nrr, wl, ld = c['alpha'][:, x], c['near'][:, x], c['wall'], c['logd'][:, x]; sel = (al > 0.99) & nrr; assert sel.sum() > 20 and not wl.any(), ('card 0 has wall rows', int(wl.sum()), int(sel.sum())); assert nrr[al > 0.5].mean() > 0.9, 'the rows under the clip are not flagged near'
        L = np.log(Dj); q = ld[sel].astype(np.float64); want = np.stack([_blend(L, q, nj[0], x), _blend(L, q, nj[1], x), _blend(L, q, nj[2], x)]); m = np.sqrt((want ** 2).sum(0))
        assert np.abs(c['n_r'][sel, x] - want[0] / m).max() < 2e-3 and np.abs(c['n_t'][sel, x] - want[1] / m).max() < 2e-3, 'a near row has not its own normal'; assert (np.abs(c['n_r'][sel, x]) > 0.5).sum() > 5, 'the fixture has no ramp rows'
    finally: ridge.P.update(eye_m=saved)
def test_near_ground_has_the_height_and_relief_of_its_own_ground():
    """Near heights stepping in blocks of 20 columns across the grass, forest and rock thresholds (100, 1000, 2100 m, the forest block a 45 degree hill) while the far march stands at 1000 m everywhere: every near row carries its own height, so the blocks differ where the ground does, and the hill face is steep (n_up < 0.93)."""
    dn = ridge.near_schedule(); K, Kn = len(D), len(dn); a = np.tile(np.linspace(5.0, 12.0, K)[:, None], (1, W)); h = np.full((K, W), 1000.0); blk = (np.arange(W) // 20) % 3; base = np.array([100.0, 1000.0, 2100.0])[blk]
    hn = np.broadcast_to(base[None, :], (Kn, W)).copy(); hn[:, blk == 1] += dn[:, None]; an = np.tile(np.linspace(-8.0, 5.0, Kn)[:, None], (1, W)); ridge.P.update(eye_m=EYE); ridge.set_view(a.max(0))
    Dj, Aj, Hj, Nj = ridge.join_near(D, a, h, (dn, an, hn)); assert all(np.array_equal(u[Kn:], w) for u, w in zip(Nj, ridge.normals(D, h))), 'the far normals are not those of the far march alone'
    c = ridge.cards(Dj, _w(Aj), _w(Hj), np.zeros((0, NW)), tuple(_w(x) for x in Nj))[0]; up = np.sqrt(np.clip(1 - c['n_r'] ** 2 - c['n_t'] ** 2, 0, 1)); got = {}
    for x in range(NW):
        if not 3 <= x % 20 <= 16: continue
        sel = (c['alpha'][:, x] > 0.99) & c['near'][:, x] & (c['logd'][:, x] < math.log(ridge.NEAR_CLIP_M) - 1e-6); assert sel.sum() > 50, ('no near rows', x)       # the crest row that meets the clip sample itself is not under the clip
        if blk[x] == 1: assert up[sel, x].max() < 0.93 and c['h'][sel, x].min() >= base[x] - 1e-3, ('the hill face is not steep', x, float(up[sel, x].max()))
        else: assert np.abs(c['h'][sel, x] - base[x]).max() < 1e-3, ('a near row has not the height of its own ground', x)
        got[blk[x]] = float(c['h'][sel, x].mean())
    assert abs(got[0] - got[1]) > 100 and abs(got[1] - got[2]) > 100 and abs(got[0] - got[2]) > 100, ('the blocks do not differ where the ground does', got)
def test_near_pixels_bind_at_the_clip_wherever_they_are():
    """Near pixels are drawn at the clip, so each tile's near pixels count in the r_max fit as terrain at the clip alongside its solid pixels, and never in distance_m.  Card 0, every other tile 3000 m away: (a) a tile whose lower third is near ground at 150 m keeps its distance_m but binds at 500 m, and without those pixels binds nothing;
    (b) a tile of near ground only has distance_m == NEAR_CLIP_M, binds exactly like terrain at 500 m, and write_bake accepts it; (c) a tile of near ground with a few stray solid pixels at 3000 m binds the same, whatever the stray count (no threshold)."""
    b = _toy(); base = export.pack(b); cs = [[dict(c) for c in tile] for tile in b['cards']]; c = cs[3][0]; n = c['alpha'].shape[0]; near = np.zeros_like(c['near']); near[n * 2 // 3:] = True; ppd = ridge.HPX_DEG
    dists = lambda pk: [[e and e['distance_m'] for e in row] for row in pk['tiles']]; at_clip = lambda src: dict(src, logd=np.full_like(src['logd'], math.log(ridge.NEAR_CLIP_M)))
    cs[3][0] = dict(c, near=near, logd=np.where(near, math.log(150.0), c['logd']).astype(np.float32)); a = export.pack(dict(b, cards=cs))
    cs[3][0] = dict(c, alpha=np.where(near, 0.0, c['alpha']).astype(np.float32)); cut = export.pack(dict(b, cards=cs)); cs[3][0] = at_clip(c); clip = export.pack(dict(b, cards=cs))
    assert dists(a) == dists(cut) == dists(base) and cut['camera'] == base['camera'], ('near pixels were measured in distance_m', dists(a)[3], dists(base)[3])
    assert a['camera'] == clip['camera'] and a['camera']['r_max_m'] < base['camera']['r_max_m'] - 5 and a['camera']['r_max_forward_m'] < base['camera']['r_max_forward_m'] - 5, ('near pixels in a tile of terrain do not bind at the clip', a['camera'], base['camera'])
    cs[3][0] = c; only = dict(cs[9][0]); cs[9][0] = dict(only, near=np.ones_like(only['near']), logd=np.full_like(only['logd'], math.log(300.0))); ob = dict(b, cards=cs); pk = export.pack(ob); d = tempfile.mkdtemp()
    try:
        assert pk['tiles'][9][0]['distance_m'] == ridge.NEAR_CLIP_M and pk['tiles'][8][0]['distance_m'] == base['tiles'][8][0]['distance_m'], ('a near-only tile', pk['tiles'][9][0]['distance_m'])
        r, rf = pk['camera']['r_max_m'], pk['camera']['r_max_forward_m']; assert r < base['camera']['r_max_m'] - 5 and rf < base['camera']['r_max_forward_m'] - 5, ('a near-only tile does not bind', pk['camera'], base['camera'])
        assert export.fit_px(ridge.NEAR_CLIP_M, r, ppd) <= export.FIT_PX_MAX + 1e-6 and export.fit_px(ridge.NEAR_CLIP_M, rf, ppd, 1) <= export.FIT_PX_MAX + 1e-6 and export.fit_px(ridge.NEAR_CLIP_M, r + 0.5, ppd) > export.FIT_PX_MAX, ('the near-only tile is not bound at the clip distance it is slid at', r, rf)
        cs[9][0] = at_clip(only); assert export.pack(dict(b, cards=cs))['camera'] == pk['camera'], 'a near-only tile does not bind exactly like terrain at the clip'
        assert _write(d + '/ok', ob, pk).exists(), 'a bake with a near-only tile was refused'
        for stray in (1, 6, 40):      # solid pixels at 3000 m among the near ground of a tile: it binds at the clip all the same
            st = np.zeros_like(only['near']); st[:1, 10:10 + stray] = True; cs[9][0] = dict(only, near=~st, logd=np.where(st, only['logd'], math.log(300.0)).astype(np.float32)); sp = export.pack(dict(b, cards=cs))
            assert sp['camera'] == pk['camera'], ('stray solid pixels unbound a tile of near ground', stray, sp['camera'], pk['camera'])
    finally: shutil.rmtree(d)
def test_cards_refuses_a_march_without_the_near_ground():
    """ridge.cards on a march whose first sample is the near clip (not joined to the near march) raises, naming join_near: card 0 can never extrude the clip sample again."""
    A, Hh = rays(THREE); ridge.P.update(eye_m=EYE); ridge.set_view(A.max(0))
    try: ridge.cards(D, _w(A), _w(Hh), np.zeros((0, NW)))
    except export.Refusal as e: assert 'join_near' in str(e), str(e)
    else: assert False, 'cards drew a march that starts at the near clip'
def test_near_march_starts_at_your_feet():
    """The near march starts at NEAR_START_M = 1 m, strictly increasing in steps of max(1 m, 0.02 d) up to 10 m, its last sample under the clip; over flat ground with a 1.6 m eye and a frame bottom below -8 degrees (the ray of the frame bottom meets the ground 11 m out) card 0 has no wall row and draws the ground to the bottom row."""
    dn = ridge.near_schedule(); st = np.diff(dn); assert dn[0] == ridge.NEAR_START_M == 1.0 and (st > 0).all() and dn[-1] < ridge.NEAR_CLIP_M and dn[-1] + 10.0 >= ridge.NEAR_CLIP_M and 150 < len(dn) < 190, (dn[0], len(dn))
    assert np.allclose(st, np.clip(0.02 * dn[:-1], 1.0, 10.0)), 'the steps are not max(1 m, 0.02 d) capped at 10 m'
    saved = ridge.P.get('eye_m'); ridge.P.update(eye_m=1.6)
    try:
        hf = lambda dk, az: np.zeros_like(az); A, Hh = rays(hf, eye=1.6); a, h = ridge.prefilter(D, Hh, 0.0); sk = np.full(W, -5.0); sk[::2] = 2.0; ridge.set_view(sk); assert ridge.BOTTOM_DEG < -8.0, ridge.BOTTOM_DEG
        Dj, Aj, Hj, Nj = ridge.join_near(D, a, h, near_rays(hf)); c = ridge.cards(Dj, _w(Aj), _w(Hj), np.zeros((0, NW)), tuple(_w(x) for x in Nj))[0]
        assert not c['wall'].any() and c['near'].any(), ('card 0 has wall under the frame bottom', int(c['wall'].sum())); assert _canvas(c)[H - 1, 300] > 0.99 and c['near'][H - 1 - c['top'], 300], 'the bottom row is not near ground'
    finally: ridge.P.update(eye_m=saved)
def test_near_march_is_float64_and_prefiltered():
    """near_march over an injected 64 x 64 mosaic: a plane tilted 5% at 3000 m gives adjacent-column near normals within 1e-3 of each other (heights in float32 would jump by 0.1 at a metre's distance); 30 m roof blocks under sigma 100 leave near heights within 2 m of each other, and without the prefilter they do not."""
    saved = (ridge.P, ridge.PXDEG_V); lat, lon = 47.0, 11.0; n = 64; ridge.P = dict(id='nearmos', lat=lat, lon=lon, rmax_km=1, eye_m=3001.6); key = (ridge.P['id'], ridge.mosaic_key(ridge.P)); ridge.PXDEG_V = 100.0
    x = np.arange(n)[None, :] * (111320.0 * math.cos(math.radians(lat)) / 3600.0); y = np.arange(n)[:, None]
    try:
        ridge._mos[key] = ((3000.0 + 0.05 * x + 0 * y).astype(np.float32), lat + 32 / 3600.0, lon - 32 / 3600.0); dn, an, hn = ridge.near_march(0.0); nn = ridge.normals(dn, hn)
        assert hn.dtype == np.float64 and an.dtype == np.float64 and hn.shape == (len(ridge.near_schedule()), W) and (dn == ridge.near_schedule()).all(), (hn.dtype, hn.shape)
        assert max(np.abs(np.diff(nn[0], axis=1)).max(), np.abs(np.diff(nn[1], axis=1)).max()) < 1e-3, ('the near normals jump between adjacent columns', float(np.abs(np.diff(nn[1], axis=1)).max()))
        ridge._mos[key] = ((3000.0 + 30.0 * ((np.arange(n)[None, :] + y) % 2)).astype(np.float32), lat + 32 / 3600.0, lon - 32 / 3600.0); raw = np.ptp(ridge.near_march(0.0)[2]); flat = np.ptp(ridge.near_march(100.0)[2])
        assert raw > 20.0 and flat < 2.0, ('sigma is not applied to the near heights', raw, flat)
    finally: ridge.P, ridge.PXDEG_V = saved; ridge._mos.pop(key, None)
# ---------------------------------------------------------------------------------------- rules that no other test touched
def test_seams_keep_their_separation():
    """Two authored targets closer than SEAM_SEP (6 and 7 km, 0.15 nat): the seams still sit at least 0.4 nat apart in every column."""
    s = _bake(THREE, [6, 7])['seams']; assert (np.log(s[1]) - np.log(s[0]) >= 0.4 - 1e-9).all(), float((np.log(s[1]) - np.log(s[0])).min())
def test_elev_is_the_curved_refracted_angle():
    """elev(h, d) = atan2(h - eye - d^2 / 2R x (1 - k), d): at 80 km a 3000 m summit stands 0.3 deg lower than the flat angle, and curvature False gives the flat one."""
    ridge.P.update(eye_m=EYE); d = 80000.0; want = math.degrees(math.atan2(3000.0 - EYE - d * d / (2 * ridge.R_EARTH) * (1 - ridge.KREF), d)); flat = math.degrees(math.atan2(3000.0 - EYE, d))
    assert abs(float(ridge.elev(3000.0, d)) - want) < 1e-9 and abs(float(ridge.elev(3000.0, d, curvature=False)) - flat) < 1e-9 and flat - want > 0.25, (want, flat)
    assert ridge.elev(np.array([[1000.0, 1200.0]]), np.array([[d], [d / 2]])).shape == (2, 2)
def test_coverage_counts_every_visible_row_including_the_foreground():
    """Per column the coverage sums to the visible rows of the opaque view: (min(skyline, top) - bottom) x px per degree, the rows below the first sample included once, not twice (a ground just under the eye shows below the first sample)."""
    for i, hf in enumerate((terrain(block(0, 359.99, 0, 20000, 91), block(0, 359.99, 20000, 21500, 600)), THREE)):
        A, Hh = rays(hf); ridge.P.update(eye_m=EYE); ridge.set_view(A.max(0)); aw = _w(A); cov = ridge.coverage(D, aw); want = np.clip(np.minimum(aw.max(0), ridge.TOP_DEG) - ridge.BOTTOM_DEG, 0, None) * ridge.PXDEG_V
        assert np.abs(cov.sum(0) - want).max() < 1e-6, np.abs(cov.sum(0) - want).max(); assert cov.shape == (ridge.COV_BINS, NW)
        if i == 0: assert (cov[0] > 100).all(), ('no foreground rows in the first bin', float(cov[0].min()))
def test_cards_interpolate_between_samples_and_renormalise():
    """On a ramp face every card pixel sits between two samples: its log-distance lies strictly between theirs (not on the nearer sample), and its normal is the normalised blend of theirs by that same fraction (the samples carry alternating normals, so a blend
    that is not renormalised, or a hit that is not interpolated, differs)."""
    hf = terrain(lambda dk, az: np.where(dk >= 4000, GROUND + 0.5 * (dk - 4000), 0.0) + 0 * az); A, Hh = rays(hf); ridge.P.update(eye_m=EYE); ridge.set_view(A.max(0)); Dj, aw, hw, _ = _join(hf, A, Hh); k = np.arange(len(Dj))[:, None]
    nr = np.broadcast_to(np.where(k % 2 == 0, -0.8, 0.8), aw.shape).astype(float); nt = np.broadcast_to(np.where(k % 3 == 0, 0.3, -0.3), aw.shape).astype(float); nu = np.sqrt(1 - nr ** 2 - nt ** 2) * 0 + 0.5
    c = ridge.cards(Dj, aw, hw, np.zeros((0, NW)), nrm=(nr, nt, nu))[0]; x = 300; sel = np.flatnonzero(c['alpha'][:, x] > 0.999); ld = c['logd'][sel, x].astype(np.float64); L = np.log(Dj); kk = np.searchsorted(L, ld, 'left'); kp = kk - 1; ok = kp >= 0
    t = (ld - L[np.maximum(kp, 0)]) / (L[kk] - L[np.maximum(kp, 0)]); inner = ok & (t > 0.02) & (t < 0.98); assert inner.sum() > 0.3 * len(sel), ('hits sit on samples, not between them', int(inner.sum()), len(sel))
    mix = lambda arr: arr[np.maximum(kp, 0), x] + t * (arr[kk, x] - arr[np.maximum(kp, 0), x]); m = np.sqrt(mix(nr) ** 2 + mix(nt) ** 2 + mix(nu) ** 2); er = np.abs(c['n_r'][sel, x] - mix(nr) / m)[inner]; et = np.abs(c['n_t'][sel, x] - mix(nt) / m)[inner]
    assert er.max() < 1e-3 and et.max() < 1e-3, ('the normal is not the normalised blend of the two samples', er.max(), et.max())

def _old_albedo(h, n_up):
    """The oracle: ridge.albedo as it stood before materials, constants and all (copied here, the only place they live now)."""
    GRASS, FOREST, ROCK, SNOW = (0.36, 0.44, 0.26), (0.22, 0.31, 0.20), (0.47, 0.44, 0.41), (0.93, 0.95, 0.97)
    t = lambda a, b: np.clip((h - a) / (b - a), 0, 1)[..., None]; c = np.asarray(GRASS) + (np.asarray(FOREST) - GRASS) * t(150, 900); c = c + (np.asarray(ROCK) - c) * t(1300, 2000)
    c = c + (np.asarray(ROCK) - c) * np.clip((0.93 - n_up) / 0.25, 0, 1)[..., None]; return c + (np.asarray(SNOW) - c) * (t(1900, 2300) * np.clip((n_up - 0.55) / 0.3, 0, 1)[..., None])
def test_alpine_material_is_exactly_the_old_albedo():
    """places.json's alpine material evaluates to the old hard-coded formula bit for bit on a grid of heights 0-3000 m and n_up 0-1 (the four unrebaked places keep their bake ids because of it), and the canyon material differs from it where it should: the river floor is not grass."""
    hh, nn = np.meshgrid(np.linspace(0.0, 3000.0, 301), np.linspace(0.0, 1.0, 101), indexing='ij')
    assert np.array_equal(ridge.albedo(hh, nn, ALPINE), _old_albedo(hh, nn)), 'alpine is not the old formula'
    assert np.abs(ridge.albedo(np.array([800.0]), np.array([1.0]), ridge.load_material('canyon')) - _old_albedo(np.array([800.0]), np.array([1.0]))).max() > 0.1
def test_canyon_material_has_strata_and_holds_on_cliffs():
    """The canyon (steep null, snow null): a cliff face has the colour of its height, not a rock grey (a flat and a steep face at one height agree), and the bands are distinct colours over height."""
    cy = ridge.load_material('canyon'); hs = np.linspace(800.0, 2500.0, 200); flat = ridge.albedo(hs, np.ones_like(hs), cy); steep = ridge.albedo(hs, np.full_like(hs, 0.3), cy)
    assert np.array_equal(flat, steep), 'a steep face changes the canyon colour'; assert np.abs(np.diff(flat, axis=0)).sum() > 1.0 and len(np.unique(np.rint(flat * 255), axis=0)) > 20, 'the canyon has no strata'
def test_an_unknown_material_name_is_refused():
    """A place naming a material that places.json does not hold is a Refusal from the baker's own loader, not the alpine fallback; a malformed material is refused too."""
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 'm.json'); json.dump(dict(materials=dict(alpine=ALPINE, bad=dict(ALPINE, base=[2, 0, 0]))), open(p, 'w'))
        assert ridge.load_material('alpine', p) == ALPINE
        for name in ('canyon', '', 'Alpine'):
            try: ridge.load_material(name, p)
            except export.Refusal as ex: assert repr(name) in str(ex), ex
            else: assert False, ('an unknown material was accepted', name)
        try: ridge.load_material('bad', p)
        except export.Refusal: pass
        else: assert False, 'a malformed material was accepted'
        json.dump(dict(presets=[]), open(p, 'w'))
        try: ridge.load_material('alpine', p)
        except export.Refusal: pass
        else: assert False, 'a file without materials gave a material'

def test_the_sheet_paints_with_the_material_it_is_given():
    """The sheet evaluates the place's material over the card heights: the same cards lit with the canyon material differ from the alpine ones in colour only (the card has no colour of its own), alpha untouched."""
    b = _ring('wide3', WIDE3, [20, 55]); c = [x for x in b['cards'][0] if x['alpha'].shape[0]]; assert c and all('albedo' not in x for x in c), 'a card carries a colour'
    ca = [export.lit(x, ridge.load_material('canyon')) for x in c]; al = [export.lit(x, ALPINE) for x in c]
    assert any(not np.array_equal(p[0], q[0]) for p, q in zip(ca, al)) and all(np.array_equal(p[1], q[1]) for p, q in zip(ca, al)), 'the sheet ignores its material'

# ---------------------------------------------------------------------------------------- the terrain surface: cubic, relief, keys, eye ground
KN = dict(detail=3, ridge_removal=2, ridge_gain=0.25, ridge_sharpness=1.5, valley_removal=2, valley_gain=0.3, valley_limit=0.8, slope_threshold_deg=25, max_shift_m=60)       # the shipped defaults of places.json
CY, CX = ridge.cell_m(dict(lat=47.0))            # 31 m north-south, 21 m east-west
def _bil(a, lat_top, lon_left, lat, lon):
    """Bilinear sampling, the kernel the baker no longer has: the reference the cubic is measured against."""
    y = (lat_top - lat) * 3600 - 0.5; x = (lon - lon_left) * 3600 - 0.5; y0 = np.clip(np.floor(y).astype(int), 0, a.shape[0] - 2); x0 = np.clip(np.floor(x).astype(int), 0, a.shape[1] - 2); fy = np.clip(y - y0, 0, 1); fx = np.clip(x - x0, 0, 1)
    return a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x0 + 1] * fx * (1 - fy) + a[y0 + 1, x0] * (1 - fx) * fy + a[y0 + 1, x0 + 1] * fx * fy
def _knife(n=121, tilt=2.0):
    """A knife ridge 300 m high running north-south at column 60, its crest sloping down 2 m a post to the south (so the crest has a slope of its own), on 2000 m."""
    x = np.arange(n)[None, :]; y = np.arange(n)[:, None]; return (2000.0 + np.maximum(0.0, 300.0 - 30.0 * np.abs(x - 60)) - tilt * y).astype(np.float32)
def _trough(n=121):
    x = np.arange(n)[None, :]; y = np.arange(n)[:, None]; return (2000.0 + np.minimum(300.0, 30.0 * np.abs(x - 60)) + 0 * y).astype(np.float32)

def test_cubic_interpolates_posts_and_is_c1():
    """cubic equals the DEM at every post; on a tent ridge its gradient is continuous across the cell edge at the crest post (the two one-sided slopes agree), where bilinear sampling jumps by two posts' worth of slope; a linear surface is reproduced exactly."""
    rng = np.random.default_rng(5); a = rng.random((16, 16)) * 100; lt, ll = 47.0, 11.0; px = 1 / 3600.0
    ii, jj = np.meshgrid(np.arange(2, 14), np.arange(2, 14), indexing='ij'); got = ridge.cubic(a, lt, ll, lt - (ii + 0.5) * px, ll + (jj + 0.5) * px); assert np.abs(got - a[ii, jj]).max() < 1e-9, 'cubic does not pass through the posts'
    tent = np.tile(np.minimum(np.arange(16), 8 * 2 - np.arange(16)) * 30.0, (16, 1)); lat = np.full(1, lt - 8.5 * px); eps = 1e-3 * px
    slope = lambda f, c: (f(tent, lt, ll, lat, ll + (c + 0.5) * px + eps) - f(tent, lt, ll, lat, ll + (c + 0.5) * px)) / 1e-3                 # per post, just right of post c
    left = lambda f, c: (f(tent, lt, ll, lat, ll + (c + 0.5) * px) - f(tent, lt, ll, lat, ll + (c + 0.5) * px - eps)) / 1e-3
    assert abs(slope(ridge.cubic, 8) - left(ridge.cubic, 8)) < 1.0 and abs(slope(_bil, 8) - left(_bil, 8)) > 50, ('the gradient at the crest post', slope(ridge.cubic, 8), left(ridge.cubic, 8), slope(_bil, 8), left(_bil, 8))
    ramp = (3.0 * np.arange(16)[None, :] + 2.0 * np.arange(16)[:, None]).astype(np.float64); lat = np.array([lt - 6.3 * px]); lon = np.array([ll + 7.7 * px]); assert abs(float(ridge.cubic(ramp, lt, ll, lat, lon)[0]) - (3.0 * 7.2 + 2.0 * 5.8)) < 1e-9, 'a linear surface is not reproduced'
def test_rays_key_names_the_kernel():
    """Changing the sampling kernel changes the ray cache key (a ray cache of another kernel is never read), and the key is the v2 one."""
    saved = ridge.P, ridge.KERNEL
    try:
        ridge.P = dict(id='k1', lat=47.0, lon=11.0, rmax_km=40, eye_m=2000.0); k0 = ridge.rays_key(False); ridge.KERNEL = 'bilinear'; assert ridge.rays_key(False) != k0, 'the ray key ignores the kernel'
    finally: ridge.P, ridge.KERNEL = saved
    assert 'rays.v1' not in open(os.path.join(SRC, 'ridge.py')).read()

def test_surface_round_trips_height_wall_alpha():
    """encode_surface then decode: the height within half a step of the 16-bit range, the wall flag on exactly the wall pixels with coverage, the alpha exact, every channel zero under a zero alpha."""
    rng = np.random.default_rng(3); h = rng.random((40, 50)) * 4300 + 100; al = rng.random((40, 50)); al[rng.random(al.shape) < 0.3] = 0; al[:, :5] = 1; wall = rng.random(al.shape) < 0.4; enc = dict(h_min_m=90.0, h_max_m=4410.0)
    b = export.encode_surface(h, enc, wall, al); s = export.decode(b); live = s[..., 3] > 0; assert (s[..., 3] == np.rint(al * 255)).all() and live.any() and (~live).any()
    got = enc['h_min_m'] + (s[..., 0].astype(int) * 256 + s[..., 1]) / 65535.0 * (enc['h_max_m'] - enc['h_min_m']); assert np.abs(got - h)[live].max() <= (4320 / 65535) * 0.5 + 1e-9, float(np.abs(got - h)[live].max())
    assert ((s[..., 2] == 255) == (wall & live)).all() and (s[~live][..., :3] == 0).all(), 'the wall flag or the zero alpha is wrong'; full = export.decode(export.encode_surface(h, enc, wall, np.ones_like(al))); assert full.shape[-1] == 4 and (full[..., 3] == 255).all()
def test_schema4_writer_and_material_in_manifest():
    """The manifest validates as schema 4 with surface and geometry entries, the height range and the place's material; a material change is a new bake id; a malformed material, a schema 3 colour entry, the old normal code and an empty height range are refused."""
    d = tempfile.mkdtemp()
    try:
        b = _toy(); pk = export.pack(b); a = _write(d + '/a', b, pk); m = json.load(open(a / 'manifest.json')); export.validate_manifest(m)
        assert m['schema'] == 4 and m['material'] == ALPINE and m['relief'] is None and m['view']['apron'] == 3 and set(m['tiles'][0][0]) == {'top', 'h', 'distance_m', 'surface', 'geometry'} and m['encoding']['h_min_m'] < m['encoding']['h_max_m'] and m['encoding']['normal'] == 'rt8-up-walls'
        b2 = dict(b, meta=dict(b['meta'], material=ridge.load_material('canyon'))); a2 = _write(d + '/b', b2, pk); assert a2.name != a.name and json.load(open(a2 / 'manifest.json'))['material'] == ridge.load_material('canyon'), 'a material change kept the bake id'
        def bad(f, why):
            x = json.loads(json.dumps(m)); f(x)
            try: export.validate_manifest(x)
            except export.Refusal: return
            raise AssertionError(why)
        bad(lambda x: x['material'].update(base=[2, 0, 0]), 'a malformed material validated'); bad(lambda x: x.pop('material'), 'a manifest without a material validated'); bad(lambda x: x['tiles'][0][0].update(colour=x['tiles'][0][0]['surface']), 'a schema 3 colour entry validated')
        bad(lambda x: x['encoding'].update(normal='rt8'), 'the old normal code validated'); bad(lambda x: x['encoding'].update(h_max_m=x['encoding']['h_min_m']), 'an empty height range validated'); bad(lambda x: x.update(schema=3), 'schema 3 validated')
        bad(lambda x: x['material']['ramps'][0].update(from_m=5000.0), 'a material ramp running backwards validated')
    finally: shutil.rmtree(d)
def test_index_is_left_alone_unless_switched():
    """write_bake without switch_index writes the bake directory and neither creates nor changes index.json nor deletes the place's previous directory; with it, the index names the new directory and the old one goes."""
    d = tempfile.mkdtemp()
    try:
        b = _toy(); pk = export.pack(b); first = _write(d, b, pk, switch_index=False); assert not os.path.exists(d + '/index.json') and os.listdir(d) == [first.name]
        idx = dict(schema=1, default='toy', places={'toy': 'toy-old'}); os.makedirs(d + '/toy-old'); open(d + '/index.json', 'w').write(json.dumps(idx)); pk2 = dict(pk, camera=dict(pk['camera'], r_max_forward_m=pk['camera']['r_max_forward_m'] + 0.1)); second = _write(d, b, pk2, switch_index=False)
        assert json.load(open(d + '/index.json')) == idx and os.path.isdir(d + '/toy-old') and second.exists(), 'the index or the old bake was touched'
        third = _write(d, b, pk2, switch_index=True); assert json.load(open(d + '/index.json'))['places']['toy'] == third.name and not os.path.exists(d + '/toy-old')
    finally: shutil.rmtree(d)

def test_near_ground_normals_have_no_cell_edge_jumps():
    """On the real near ground of the Grand Canyon (the preset's raw mosaic, the 1 to 500 m march on all 6400 columns), the Catmull-Rom march's column-to-column and row-to-row normal steps have a p99 under 0.8 of the bilinear march's: the bilinear gradient jumps at every 30 m cell edge, the cubic's does not."""
    saved = (ridge.P, ridge.PXDEG_V); p = ridge.load_preset('grandcanyon'); m, lt, ll = ridge.raw_mosaic(p); iy, ix = int((lt - p['lat']) * 3600), int((p['lon'] - ll) * 3600); r = 90; win = np.array(m[iy - r:iy + r, ix - r:ix + r], np.float64); lt2, ll2 = lt - (iy - r) / 3600.0, ll + (ix - r) / 3600.0
    ridge.P = dict(id='nearreal', lat=p['lat'], lon=p['lon'], rmax_km=1, eye_m=float(win[r, r]) + 1.6); ridge.PXDEG_V = 100.0; key = (ridge.P['id'], ridge.mosaic_key(ridge.P))
    try:
        ridge._mos[key] = (win, lt2, ll2); dn, an, hn = ridge.near_march(0.0); az = np.radians((np.arange(W) + 0.5) / W * 360.0); cosl = math.cos(math.radians(p['lat'])); sa, ca = np.sin(az), np.cos(az)
        hb = np.stack([_bil(win, lt2, ll2, p['lat'] + dk * ca / 111320.0, p['lon'] + dk * sa / (111320.0 * cosl)) for dk in dn]); nc, nb = ridge.normals(dn, hn), ridge.normals(dn, hb); sel = slice(20, None)       # from 20 m out: nearer, a column is under a metre wide
        step = lambda n: np.concatenate([np.abs(np.diff(n[0][sel], axis=1)).ravel(), np.abs(np.diff(n[1][sel], axis=1)).ravel(), np.abs(np.diff(n[0][sel], axis=0)).ravel(), np.abs(np.diff(n[1][sel], axis=0)).ravel()])
        pc, pb = np.percentile(step(nc), 99), np.percentile(step(nb), 99); print(f'   near normal step p99 cubic {pc:.4f} bilinear {pb:.4f}'); assert pc < 0.8 * pb, ('the cubic near ground still has cell edges', pc, pb)
    finally: ridge.P, ridge.PXDEG_V = saved; ridge._mos.pop(key, None)

def test_relief_identity_at_neutral_knobs():
    """detail 0, ridge_gain 0 and valley_gain 0 return the input array (equal bit for bit), an absent relief and an all-neutral one give the same mosaic_key (None), max_shift_m alone changes nothing, and any one live knob changes the key."""
    M = np.random.default_rng(1).random((50, 60)).astype(np.float32) * 500; base = dict(id='k1', lat=47.0, lon=11.0, rmax_km=40, eye_m=2000.0)
    for k in (dict(detail=0, ridge_gain=0, valley_gain=0), dict(detail=0, ridge_gain=0, valley_gain=0, max_shift_m=30, ridge_removal=9, slope_threshold_deg=10), {}):
        out = ridge.relief(M, k, CY, CX); assert np.array_equal(out, M) and ridge.canon_relief(k) is None, k; assert ridge.mosaic_key(dict(base, relief=k)) == ridge.mosaic_key(base) == ridge.mosaic_key(dict(base, relief=None))
    for knob, v in (('detail', 1), ('ridge_gain', 0.1), ('valley_gain', 0.1)): assert ridge.mosaic_key(dict(base, relief={knob: v})) != ridge.mosaic_key(base), knob
    assert not np.array_equal(ridge.relief(M, dict(detail=3), CY, CX), M), 'a base low-pass alone did nothing'
def test_relief_knobs_are_checked():
    """Unknown keys, negative, non-numeric and out-of-range knobs are a Refusal from canon_relief and from load_preset (before any march); a null max_shift_m is unbounded."""
    for bad in (dict(detial=3), dict(detail=-1), dict(ridge_gain='x'), dict(valley_gain=1.5), dict(slope_threshold_deg=90), dict(max_shift_m=0), dict(detail=True), 5):
        try: ridge.canon_relief(bad)
        except export.Refusal: pass
        else: assert False, ('a relief of', bad, 'was accepted')
    assert ridge.canon_relief(dict(KN, max_shift_m=None))['max_shift_m'] is None and ridge.canon_relief(KN)['max_shift_m'] == 60.0
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 'p.json'); json.dump(dict(presets=[dict(id='x', tz='UTC', card_split_km=[6], relief=dict(KN, sharpness=1))]), open(p, 'w'))
        try: ridge.load_preset('x', p)
        except export.Refusal as e: assert 'sharpness' in str(e), str(e)
        else: assert False, 'a preset with an unknown relief knob was loaded'
def test_shipped_presets_carry_the_defaults():
    """The five shipped places carry the documented relief defaults (the published 'large scale' preset, detail 3, max_shift_m null: unbounded for now) and halfdome none; the _doc names every knob."""
    d = json.load(open(os.path.join(SRC, 'places.json'))); by = {p['id']: p for p in d['presets']}
    for pid in ('vienna', 'matterhorn', 'fuji', 'amadablam', 'grandcanyon'): assert by[pid]['relief'] == dict(KN, max_shift_m=None), pid
    assert 'relief' not in by['halfdome'] and all(k in d['_doc'] for k in ridge.RELIEF_KNOBS), 'the _doc lacks a knob'

def test_relief_curvature_signs():
    """On a knife ridge the maximum curvature is positive along the crest and zero five posts out on the flank, the trough measure is zero on it; in a trough the valley measure is positive in the floor, zero on a plane and on the flanks; the plan curvature is negative on a conical summit and positive in a bowl."""
    Z = _knife(); kmax, plan = ridge.curvature(Z, CY, CX, True); assert kmax[60, 60] > 0 and (kmax[5:-5, 66:] == 0).all() and (kmax[5:-5, :54] == 0).all(), (float(kmax[60, 60]), float(kmax[60, 66]))
    assert (ridge.curvature(Z, CY, CX, False)[0][5:-5, 55:66] == 0).all(), 'a crest has a trough measure'
    T = _trough(); m, _ = ridge.curvature(T, CY, CX, False); assert m[60, 60] > 0 and (m[5:-5, 66:] == 0).all() and (m[5:-5, :54] == 0).all() and (ridge.curvature(T, CY, CX, True)[0][5:-5, 55:66] == 0).all(), (float(m[60, 60]), 'the trough floor is not curved up')
    assert (ridge.curvature(np.full((30, 30), 100.0), CY, CX, False)[0] == 0).all() and (ridge.curvature(np.full((30, 30), 100.0), CY, CX, True)[0] == 0).all(), 'a plane has curvature'
    y, x = np.mgrid[-30:31, -30:31]; cone = (3000 - 20 * np.hypot(x * CX, y * CY) / 30).astype(np.float32); _, pk = ridge.curvature(cone, CY, CX, True); _, pb = ridge.curvature(6000 - cone, CY, CX, True)
    assert pk[30, 45] < 0 and pk[45, 30] < 0 and pb[30, 45] > 0 and pb[45, 30] > 0, ('the plan curvature has the wrong sign', float(pk[30, 45]), float(pb[30, 45]))
def test_relief_accentuates_known_ridge():
    """A knife ridge of known height over 30 m posts: with detail 0 (and the mountain model everywhere, slope threshold 0, since a symmetric apex has no slope of its own to switch it on) the crest rises and the flank 10 posts out rises less, so crest-over-flank relief grows; at the shipped defaults (detail 3) the crest-over-flank relief is still greater than the input's."""
    Z = _knife(); crest, flank = Z[50, 60], Z[50, 50]; k0 = ridge.relief(Z, dict(detail=0, ridge_gain=0.25, slope_threshold_deg=0), CY, CX); up_c, up_f = k0[50, 60] - crest, k0[50, 50] - flank
    print(f'   knife ridge, detail 0: crest +{up_c:.0f} m, flank 10 posts out +{up_f:.0f} m, relief {crest - flank:.0f} -> {k0[50, 60] - k0[50, 50]:.0f}'); assert up_c > up_f > 0 and k0[50, 60] - k0[50, 50] > crest - flank + 100, (up_c, up_f)
    kd = ridge.relief(Z, KN, CY, CX); print(f'   knife ridge, shipped defaults: crest +{kd[50, 60] - crest:.0f} m, flank +{kd[50, 50] - flank:.0f} m, relief {crest - flank:.0f} -> {kd[50, 60] - kd[50, 50]:.1f}'); assert kd[50, 60] - kd[50, 50] > crest - flank, 'the shipped defaults do not sharpen the crest'
    kf = ridge.relief(Z, dict(KN, max_shift_m=None), CY, CX); assert kf[50, 60] - kf[50, 50] > kd[50, 60] - kd[50, 50] + 100, 'the unbounded method is not stronger than the bounded one'
def test_relief_deepens_known_valley():
    """A trough with a flat floor line: the floor goes down by valley_gain times its elevation where the valley weight is 1 (the lowland model holds where the slope is nil), the rim's plateau beyond the corner is unchanged."""
    T = _trough(); o = ridge.relief(T, dict(detail=0, valley_gain=0.3), CY, CX); drop = T[60, 60] - o[60, 60]; assert abs(drop - 0.3 * T[60, 60]) < 0.05 * 0.3 * T[60, 60], ('the floor did not go down by valley_gain x its elevation', float(drop)); assert np.abs(o[:, 100:] - T[:, 100:]).max() < 1e-3, 'the rim moved'
def test_relief_flat_areas_unchanged():
    """A level plane returns within 1e-3 m everywhere, edges included (zero curvature and zero slope: the flat mask hands it to the lowland model, whose valley weight is zero); on a level plane with a distant bump, posts more than 8 sigma of the largest filter away from the bump are unchanged within 1e-3 m while the bump moves.  A TILTED plane is not
    returned unchanged by the published weights: the ridge weight is min-max rescaled over the grid, so level curvature sits at a baseline weight above 0 wherever the grid has a hollow (the replicated edge of the tilted plane makes one), and the flat mask weighs a gentle slope in; the interior deviation (25 posts from the edge) is printed and bounded by 1.6 x ridge_gain x elevation x slope / threshold."""
    n = 140; x = np.arange(n)[None, :]; y = np.arange(n)[:, None]; L = np.full((n, n), 1500.0, np.float32); assert np.abs(ridge.relief(L, KN, CY, CX) - L).max() < 1e-3
    B = L.copy(); B[40:46, 40:46] += 400.0; ob = ridge.relief(B, KN, CY, CX); far = np.ones(B.shape, bool); far[:40 + 6 + 24, :40 + 6 + 24] = False; assert far.sum() > 8000 and np.abs(ob - B)[far].max() < 1e-3, float(np.abs(ob - B)[far].max()); assert np.abs(ob - B)[38:48, 38:48].max() > 1.0, 'the bump did not move'
    P = (1500.0 + 0.3 * x + 0.2 * y).astype(np.float32); dev = float(np.abs(ridge.relief(P, KN, CY, CX) - P)[25:-25, 25:-25].max()); print(f'   tilted plane (0.8 deg), interior: deviation {dev:.1f} m of 1500 (bounded by max_shift_m 60)'); assert dev < 0.25 * 1800 * np.radians(1.0) / np.radians(25.0) * 1.6, dev
def test_relief_shift_is_bounded():
    """With max_shift_m = s every |out - M| is below s (to float32 rounding, 1e-3 m) on a rugged synthetic surface, out - M is s tanh(unbounded change / s) (smooth and monotone, no clipped plateau), and s = null leaves the change unbounded."""
    rng = np.random.default_rng(2); r = rng.random((150, 150)); import itertools
    M = (2200 + 600 * (np.add.outer(np.sin(np.arange(150) / 9.0), np.cos(np.arange(150) / 7.0))) + 80 * r).astype(np.float32); free = ridge.relief(M, dict(KN, max_shift_m=None), CY, CX) - M
    for s in (20.0, 60.0, 200.0):
        d = ridge.relief(M, dict(KN, max_shift_m=s), CY, CX) - M; assert np.abs(d).max() < s + 1e-3, (s, float(np.abs(d).max())); assert np.abs(d - s * np.tanh(free / s)).max() < 5e-2, ('not the smooth bound', s); o = np.argsort(free.ravel()); assert (np.diff(d.ravel()[o]) >= -5e-2).all(), 'the bound is not monotone'
    assert np.abs(free).max() > 300, 'the unbounded change is bounded'
def test_relief_respects_cell_anisotropy():
    """The same physical surface sampled with posts 31 m north and 21 m east, and its transpose with the cell sizes swapped, give transposed outputs within 1e-3 m; treating the cells as square would not."""
    rng = np.random.default_rng(7); M = (150 + 120 * np.add.outer(np.sin(np.arange(110) / 5.0), np.cos(np.arange(130) / 8.0)) + 15 * rng.random((110, 130))).astype(np.float32); k = dict(KN, max_shift_m=None)
    a = ridge.relief(M, k, CY, CX); b = ridge.relief(np.ascontiguousarray(M.T), k, CX, CY).T; assert np.abs(a - b).max() < 1e-3, float(np.abs(a - b).max()); sq = ridge.relief(M, k, CY, CY); assert np.abs(a - sq).max() > 0.5, 'square cells give the same answer: the cell size is not used'
def test_mosaic_key_includes_relief():
    """Changing any knob changes mosaic_key and rays_key while raw_key stays, and the preset id changes neither; the generalised cache file is read only under its own key (each knob set has its own file and content)."""
    base = dict(id='k1', lat=47.0, lon=11.0, rmax_km=40, eye_m=2000.0, relief=KN); saved = ridge.P
    try:
        ridge.P = dict(base); k0 = (ridge.mosaic_key(base), ridge.rays_key(False))
        for knob, v in dict(detail=2, ridge_removal=3, ridge_gain=0.3, ridge_sharpness=1.0, valley_removal=3, valley_gain=0.2, valley_limit=0.5, slope_threshold_deg=15, max_shift_m=40).items():
            p = dict(base, relief=dict(KN, **{knob: v})); ridge.P = p; assert ridge.mosaic_key(p) != k0[0] and ridge.rays_key(False) != k0[1] and ridge.raw_key(p) == ridge.raw_key(base), knob
        ridge.P = dict(base, id='other'); assert (ridge.mosaic_key(ridge.P), ridge.rays_key(False)) == k0, 'the preset id changed a key'
    finally: ridge.P = saved
    savedB = ridge.B; d = tempfile.mkdtemp(); ridge.B = type(savedB)(d); M = (np.random.default_rng(4).random((40, 40)) * 300 + 1000).astype(np.float32); keys = []
    try:
        for rl in (KN, dict(KN, ridge_gain=0.5)):
            p = dict(base, id='cachetest', relief=rl); raw_k = (p['id'], ridge.raw_key(p)); ridge._raw[raw_k] = (M, 48.0, 10.0); out, _, _ = ridge.mosaic(p); keys.append(ridge.mosaic_key(p)); assert np.allclose(out, ridge.relief(M, rl, *ridge.cell_m(p))) and not np.array_equal(out, M)
        assert sorted(os.listdir(d)) == sorted(f'relief-cachetest-{k}.npy' for k in keys) and keys[0] != keys[1], os.listdir(d)
        ridge._mos.clear(); out0, _, _ = ridge.mosaic(dict(base, id='cachetest')); assert np.allclose(out0, ridge.relief(M, KN, *ridge.cell_m(base))), 'a cache file was read under another key'
        out_n, _, _ = ridge.mosaic(dict(base, id='cachetest', relief=None)); assert np.array_equal(out_n, M), 'no relief did not return the survey'
    finally:
        ridge.B = savedB; shutil.rmtree(d, ignore_errors=True)
        for k in [k for k in ridge._mos if k[0] == 'cachetest']: ridge._mos.pop(k)
        for k in [k for k in ridge._raw if k[0] == 'cachetest']: ridge._raw.pop(k)
def test_eye_ground_reads_relief_surface():
    """On a synthetic mosaic the eye is exactly the final surface at the observer (ridge.surface, the cubic read of M') plus eye_h_m, never the survey; load_preset refuses a preset with ground_override_m; a generalised ground more than max_shift_m from the survey refuses the bake, and null is unbounded."""
    n = 60; lat, lon = 47.0, 11.0; lt, ll = lat + 30.5 / 3600, lon - 30.5 / 3600; M = np.full((n, n), 1000.0, np.float32); M[28:32, 28:32] = 1100.0; M2 = M + 40.0
    p = dict(id='eyetest', lat=lat, lon=lon, rmax_km=1, eye_h_m=1.6, az_deg=0.0, relief=dict(KN)); rk = (p['id'], ridge.raw_key(p)); mk = (p['id'], ridge.mosaic_key(p)); saved = ridge.P
    try:
        ridge._raw[rk] = (M, lt, ll); ridge._mos[mk] = (M2, lt, ll); q = ridge.configure(dict(p)); want = float(ridge.cubic(M2, lt, ll, np.array(lat), np.array(lon))); assert q['ground_m'] == want and abs(q['eye_m'] - (want + 1.6)) < 1e-9 and q['ground_raw_m'] != q['ground_m'], (q['ground_m'], want)
        assert abs(float(ridge.surface(np.array(lat), np.array(lon))) - want) < 1e-9
        d = tempfile.mkdtemp(); pj = Path(d) / 'places.json'; base = dict(id='x', name='x', lat=lat, lon=lon, eye_h_m=1.6, az_deg=0.0, rmax_km=1, card_split_km=[6], tz='UTC'); pj.write_text(json.dumps(dict(presets=[dict(base, ground_override_m=123.0)])))
        try: ridge.load_preset('x', pj)
        except export.Refusal as e: assert 'ground_override_m' in str(e), str(e)
        else: assert False, 'a stored eye altitude was accepted'
        pj.write_text(json.dumps(dict(presets=[base]))); assert 'ground_override_m' not in ridge.load_preset('x', pj)
        ridge._mos[mk] = (M + 100.0, lt, ll)
        try: ridge.configure(dict(p))
        except export.Refusal as e: assert 'max_shift_m' in str(e), str(e)
        else: assert False, 'a ground 100 m from the survey passed a 60 m bound'
        ridge._mos[mk] = (M + 100.0, lt, ll); assert ridge.configure(dict(p, relief=dict(KN, max_shift_m=None)))  # unbounded: no refusal
    finally: ridge.P = saved; ridge._raw.pop(rk, None); [ridge._mos.pop(k, None) for k in [mk, (p['id'], ridge.mosaic_key(dict(p, relief=dict(KN, max_shift_m=None))))]]
def test_schema4_carries_relief():
    """The manifest validates with relief an object (the canonical knobs) or null; an unknown knob, a missing one and a non-object are refused; a relief change is a new bake id."""
    d = tempfile.mkdtemp()
    try:
        b = _toy(); pk = export.pack(b); a = _write(d + '/a', b, pk); b2 = dict(b, meta=dict(b['meta'], relief=ridge.canon_relief(KN))); a2 = _write(d + '/b', b2, pk); m2 = json.load(open(a2 / 'manifest.json')); export.validate_manifest(m2)
        assert a2.name != a.name and m2['relief'] == ridge.canon_relief(KN) and json.load(open(a / 'manifest.json'))['relief'] is None
        for f, why in ((lambda x: x['relief'].update(sharpness=1.0), 'an unknown knob'), (lambda x: x['relief'].pop('detail'), 'a missing knob'), (lambda x: x.update(relief=3), 'a relief that is not an object'), (lambda x: x['relief'].update(detail='3'), 'a knob that is not a number')):
            x = json.loads(json.dumps(m2)); f(x)
            try: export.validate_manifest(x)
            except export.Refusal: continue
            raise AssertionError(why + ' validated')
    finally: shutil.rmtree(d)
def test_no_gpl_source_in_tree():
    """No .java file, no class or package name of the GPL Java source of Terrain Sculptor and no path to a checkout of it anywhere in scripts/ or src/ (text files), and the baker's own files cite the 2010 papers only."""
    import re
    root = os.path.abspath(os.path.join(SRC, '..', '..')); roots = [SRC] + ([os.path.join(root, 'scripts'), os.path.join(root, 'src')] if os.path.isdir(os.path.join(root, 'src')) and os.path.isdir(os.path.join(root, 'scripts')) else []); pat = re.compile('|'.join(['Terrain' + 'SculptorFilter', 'Grid' + 'GaussLowPass', 'Positive' + 'MaximumCurvature', 'Negative' + 'MinimumCurvature', 'Curvature' + 'Combine', 'Weighted' + 'ScaleOperator', 'package ' + 'ika', 'import ' + 'ika'])); path_pat = re.compile('/tmp' + '/ts|OSU' + 'Cartography'); seen = 0
    for top in roots:
        for dp, dn, fn in os.walk(top):
            dn[:] = [x for x in dn if x not in ('node_modules', '__pycache__', '.git')]
            for f in fn:
                assert not f.endswith('.java'), ('a Java file in the tree', f); p = os.path.join(dp, f)
                try: t = open(p, encoding='utf-8').read()
                except (UnicodeDecodeError, OSError): continue
                seen += 1; assert not pat.search(t), ('a Terrain Sculptor source name in', p, pat.search(t).group(0))
                if p.startswith(SRC) or os.path.abspath(p).startswith(os.path.abspath(SRC)): assert not path_pat.search(t), ('a path to the Java checkout in', p)
    assert seen > 5, 'the scan saw no files'
    ridge_t = open(os.path.join(SRC, 'ridge.py'), encoding='utf-8').read(); assert 'Leonowicz' in ridge_t and 'def bil(' not in ridge_t

def test_march_and_near_march_read_the_surface_not_the_survey():
    """With the survey a plane at 1000 m and the generalised surface a plane at 1200 m under one key, the far march and the near march both sample 1200 m: no stage after mosaic() reads the survey."""
    lat, lon = 47.0, 11.0; n = 400; lt, ll = lat + 200 / 3600.0, lon - 200 / 3600.0; saved = (ridge.P, ridge.PXDEG_V); ridge.P = dict(id='surfread', lat=lat, lon=lon, rmax_km=2, eye_m=1300.0, relief=dict(KN)); rk = (ridge.P['id'], ridge.raw_key(ridge.P)); mk = (ridge.P['id'], ridge.mosaic_key(ridge.P)); ridge.PXDEG_V = 100.0
    try:
        ridge._raw[rk] = (np.full((n, n), 1000.0, np.float32), lt, ll); ridge._mos[mk] = (np.full((n, n), 1200.0, np.float32), lt, ll); d, A, Hh = ridge.march(); dn, an, hn = ridge.near_march(0.0)
        assert np.abs(Hh - 1200.0).max() < 1e-3 and np.abs(hn - 1200.0).max() < 1e-3, (float(Hh.min()), float(Hh.max()), float(hn.min()), float(hn.max()))
    finally: ridge.P, ridge.PXDEG_V = saved; ridge._raw.pop(rk, None); ridge._mos.pop(mk, None)

def test_eye_check_at_first_sample():
    """check_eye_clear counts the first near sample only (d <= NEAR_START_M, 1 m): ground at the eye refuses, ground just under passes, ground above the eye from the second sample on does not count; a 30 degree slope under the observer passes (a 5 m check would refuse it), a 70 degree face within 1 m refuses; the unmodified Grand Canyon survey passes with its real tiles."""
    saved = ridge.P; ridge.P = dict(id='eyeclear', eye_m=100.0); dn = ridge.near_schedule(); h = np.full((len(dn), 8), 90.0); assert dn[0] == ridge.NEAR_START_M and dn[1] > ridge.NEAR_START_M
    try:
        ridge.check_eye_clear((dn, None, h)); h2 = h.copy(); h2[1:] = 150.0; ridge.check_eye_clear((dn, None, h2)); h3 = h.copy(); h3[0] = 99.9; ridge.check_eye_clear((dn, None, h3))
        h4 = h.copy(); h4[0, 3] = 100.0
        try: ridge.check_eye_clear((dn, None, h4))
        except export.Refusal as e: assert 'inside a wall' in str(e), str(e)
        else: assert False, 'ground at the eye at the first sample was accepted'
        for deg, ok in ((30.0, True), (70.0, False)):
            hs = 100.0 - 1.6 + np.tan(np.radians(deg)) * dn[:, None] * np.ones((1, 8)); ridge.P = dict(id='slope', eye_m=100.0)    # a slope rising from the foot of a 1.6 m eye
            try: ridge.check_eye_clear((dn, None, hs)); assert ok, f'a {deg} degree face at the feet was accepted'
            except export.Refusal: assert not ok, f'a {deg} degree slope was refused'
        p = ridge.load_preset('grandcanyon'); p = dict(p, relief=None); p = ridge.configure(p); near = ridge.near_march(p.get('prefilter_m', 0) or 0); ridge.check_eye_clear(near)
    finally: ridge.P = saved
TESTS = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
if __name__ == '__main__':
    fails = 0
    for t in TESTS:
        try: t(); print("PASS", t.__name__)
        except Exception as e: fails += 1; print("FAIL", t.__name__, "|", type(e).__name__, "|", traceback.extract_tb(e.__traceback__)[-1].filename, "|", repr(e)[:300])      # name | class | file of the innermost frame | repr: mutate.py kills only on an AssertionError raised in this directory
    print("failures:", fails); sys.exit(1 if fails else 0)
