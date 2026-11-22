"""Fixtures for the ridge baker (march, prefilter, coverage, seams, normals, cards, export).  Plain asserts, no pytest needed:  venv/bin/python tests/test_ridge.py   (exit code 1 on failure).
RIDGE_SRC selects the source directory (default ..) (the mutation runner points it at a patched copy).
Synthetic terrain has a known right answer; the Vienna tests bake the real preset (its rays come from stage0: RIDGE_TILES needs the tiles, or a cached rays file must exist)."""
import os, sys, math, json, shutil, tempfile, traceback
SRC = os.environ.get('RIDGE_SRC') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); sys.path.insert(0, SRC)   # RIDGE_WORK and RIDGE_TILES must be set (tests/run.sh sets them)
import numpy as np, ridge, export
from ridge import W, H
NW = 1280                           # the synthetic bakes' window: columns 0..NW of the ring (azimuth 0..72); the pieces that need the whole ring (seams across the wrap, the tile cut) run on the ring
TW = export.TILE_W + 2 * export.APRON
_w = lambda x: ridge.ring_cols(x, 0, NW)

EYE = 100.0; GROUND = 50.0          # ground below the eye: every ray climbs, so only the placed blocks make ridges
ridge.P = dict(id='synthetic', rmax_km=95, eye_m=100.0)
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

# ---------------------------------------------------------------------------------------- synthetic bakes: the shared steps of export.bake_place on rays the fixtures make
def _bake(hfun, splits_km, sigma=0.0, fixed_m=None):
    """prefilter, whole-ring set_view, coverage and the periodic seams on the whole ring (or fixed_m, one seam depth in m for every column), then the window columns 0..NW (azimuth 0..72) of them and the cards on those, of synthetic rays: the pieces of the bake a fixture can look at cheaply."""
    A, Hh = rays(hfun); ridge.P.update(eye_m=EYE); a, h = ridge.prefilter(D, Hh, sigma); v = ridge.set_view(a.max(0))
    nrm = tuple(_w(x) for x in ridge.normals(D, h)); aw, hw = _w(a), _w(h); cov_ring = ridge.coverage(D, a); cov = _w(cov_ring); sm = _w(ridge.seams(cov_ring, [k * 1000.0 for k in splits_km], D)) if fixed_m is None else np.array([np.full(NW, float(v)) for v in fixed_m])
    return dict(cards=ridge.cards(D, aw, hw, sm, nrm), splits_km=list(splits_km), seams=sm, cov=cov, opaque=ridge.opaque(aw), edges=ridge.log_edges(D), a=aw, h=hw, nrm=nrm, v=v)
def _canvas(card, key='alpha'):
    out = np.zeros((H, NW) + card[key].shape[2:], np.float32); out[card['top']:card['top'] + card[key].shape[0]] = card[key]; return out
def _row(deg): return int(np.argmin(np.abs(ridge.rowang - deg)))
THREE = terrain(block(0, 359.99, 3000, 3600, 350), block(0, 359.99, 20000, 21500, 1800), block(0, 359.99, 70000, 72000, 7000))       # ridges at 3, 20 and 70 km, each taller in angle than the one before
WIDE3 = terrain(block(0, 359.99, 9000, 10000, 300), block(0, 359.99, 38000, 40000, 2000), block(0, 359.99, 70000, 72000, 3000))       # low near hills, then ridges at 39 and 71 km: the frame reaches below the ground at the seams (so cards have wall rows) and the horizon is inside it
WALLED = terrain(block(0, 359.99, 9000, 10000, 300), block(0, 359.99, 38000, 40000, 2000))
NEARHILL = terrain(block(0, 359.99, 0, 4000, 150), block(0, 359.99, 38000, 40000, 2000))       # ground above the eye from the first sample on: every row of card 0 lies below its first sample
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
    A, Hh = rays(terrain(block(0, 359.99, 5900, 6100, 900))); ridge.P.update(eye_m=EYE); ridge.set_view(A.max(0)); aw, hw = _w(A), _w(Hh)
    cs = ridge.cards(D, aw, hw, np.full((1, NW), 6000.0)); c0, c1 = _canvas(cs[0]), _canvas(cs[1]); crest = int(np.argmax(ridge.opaque(aw)[:, 500] > 0.5)); r = crest + 6
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
    A, Hh = rays(terrain(block(0, 36, 5000, 5600, 500), block(36, 359.99, 5000, 5600, 560))); ridge.P.update(eye_m=EYE); ridge.set_view(A.max(0)); aw, hw = _w(A), _w(Hh); c = ridge.cards(D, aw, hw, np.zeros((0, NW)))[0]
    cv = _canvas(c)[:, 300]; r = int(np.argmax(cv > 0)); top = float(aw.max(0)[300]); p = 1.0 / ridge.PXDEG_V; want = (top - (ridge.rowang[r] - 0.5 * p)) / p
    assert 0.0 < want < 1.0 and abs(cv[r] - want) < 0.01, (cv[r], want, r); assert (cv[r + 1:] > 0.999).all()
def test_cards_composite_to_the_opaque_view():
    """Alpha-over of all cards, last to first, equals the opaque march coverage within 0.02 everywhere, and where opaque the nearest solid card's distance is the first-hit distance of the march."""
    for hf, sp in ((THREE, [6, 40]), (terrain(_receding), [6]), (terrain(block(0, 359.99, 3000, 3600, 350), block(0, 36, 20000, 21500, 700), block(36, 359.99, 20000, 21500, 1800)), [6])):
        b = _bake(hf, sp); comp = 1 - np.prod([1 - _canvas(c) for c in b['cards']], axis=0); assert np.abs(comp - b['opaque']).max() < 0.02, np.abs(comp - b['opaque']).max()
        rm = np.maximum.accumulate(b['a'], axis=0); col = 640; r = _row(float(b['a'][:, col].max()) - 0.5); k = int(np.searchsorted(rm[:, col], ridge.rowang[r], 'left')); first = None
        for c in b['cards']:
            if _canvas(c)[r, col] > 0.99: first = math.exp(_canvas(c, 'logd')[r, col]); break
        assert first is not None and abs(first - D[k]) < 0.1 * D[k] + 60, (first, D[k])

# ---------------------------------------------------------------------------------------- the ring: tiles are crops of per-column results, the wrap is periodic
_RING = {}
def _ring(key, hfun, splits_km):
    """export.cut_ring on synthetic rays (prefilter, whole-ring set_view, then the ring cut), cached by key: dict(bake = what export.bake_place returns, minus the place)."""
    if key not in _RING:
        A, Hh = rays(hfun); ridge.P.update(eye_m=EYE); a, h = ridge.prefilter(D, Hh, 0.0); v = ridge.set_view(a.max(0)); r = export.cut_ring(D, a, h, splits_km)
        _RING[key] = dict(r, op_ring=ridge.opaque(a), place=dict(id='synthetic', name='Synthetic', lat=48.0, lon=16.0, altitude_km=0.05, eye_m=EYE, tz='Europe/Vienna'), v=v,
                          view=dict(look_az_deg=36.0, plane_h=H, px_per_deg_h=ridge.HPX_DEG, px_per_deg_v=v['px_per_deg'], exaggeration=v['exaggeration'], horizon_row=v['horizon_row'], sky_row=v['sky_row'] * H, near_row=v['near_row'] * H),
                          meta=dict(curvature=dict(r_earth_m=ridge.R_EARTH, k_ref=ridge.KREF), encoding=dict(log_d_min=math.log(D[0]), log_d_max=math.log(D[-1]))))
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
    tile = ridge.cards(D, b['a'][:, sl], b['h'][:, sl], b['seams'][:, sl], tuple(x[:, sl] for x in b['nrm']))
    for c, w in zip(tile, b['cards']):
        assert np.array_equal(_canvas(w)[:, sl], _tile_canvas(c)), 'a tile is not a crop of the columns'; seen = _tile_canvas(c) > 0
        for key in ('albedo', 'n_r', 'n_t', 'logd', 'wall'): assert np.array_equal(_canvas(w, key)[:, sl][seen], _tile_canvas(c, key)[seen]), ('a tile is not a crop of the columns', key)

# ---------------------------------------------------------------------------------------- toy bakes: tile data made by hand, for the packer and the writer
def _toy(dists=(3000.0, 15000.0, 50000.0), bands=(300, 400, 500), tops=(300, 150, 60), amp=0.01):
    """TILES tiles of len(dists) cards: card i is a solid band of rows (top, h) whose distance is dists[i] x (1 + amp sin x) across the columns, no wall; the opaque view is their composite.  Returns the bake dict pack() reads."""
    n = export.TILE_W + 2 * export.APRON; x = np.arange(n); tile = []; k = len(dists)
    for i in range(k):
        ld = np.log(dists[i] * (1 + amp * np.sin(x * 0.3)))[None, :].repeat(bands[i], 0).astype(np.float32)
        tile.append(dict(top=tops[i], alpha=np.ones((bands[i], n), np.float32), albedo=np.full((bands[i], n, 3), 0.4, np.float32), n_r=np.full((bands[i], n), 0.1, np.float32), n_t=np.full((bands[i], n), -0.1, np.float32), logd=ld, wall=np.zeros((bands[i], n), bool)))
    comp = export.composite_alpha([(c['top'], c['alpha']) for c in tile], H, n)
    return dict(cards=[[dict(c) for c in tile] for _ in range(export.TILES)], splits_km=[6.0 * (j + 1) for j in range(k - 1)], seams=np.tile(np.array(dists[:-1])[:, None] * 0.5, (1, W)), opaque=[comp.copy() for _ in range(export.TILES)],
                view=dict(look_az_deg=36.0, plane_h=H, px_per_deg_h=ridge.HPX_DEG, px_per_deg_v=100.0, exaggeration=5.0, horizon_row=60.0, sky_row=24.0, near_row=396.0), meta=dict(curvature=dict(r_earth_m=ridge.R_EARTH, k_ref=ridge.KREF), encoding=dict(log_d_min=math.log(500.0), log_d_max=math.log(100000.0))),
                place=dict(id='toy', name='Toy', lat=0.0, lon=0.0, altitude_km=0.0, eye_m=1.0, tz='UTC'))
def _write(out, b, packed, **kw):
    args = dict(place=b['place'], view=b['view'], meta=b['meta'], packed=packed, opaque=b['opaque']); args.update(kw); return export.write_bake(out, **args)
def _refuses(out, b, packed, why, **kw):
    try: _write(out, b, packed, **kw)
    except ValueError: assert not os.path.exists(out), ('a refused bake left files', why)
    else: assert False, why
def _pins():
    assert (export.RING_W, export.TILES, export.TILE_W, export.APRON, export.MAX_CARDS, export.BAKER_VERSION) == (6400, 32, 200, 2, 6, 5), 'the ring layout is pinned'
    assert (export.TILE_BYTES_MAX, export.PLACE_BYTES_MAX, export.RESIDENT_BYTES_MAX, export.FIT_PX_MAX, export.R_MAX_FLOOR_M, export.PHI_STEPS) == (235_000, 7_500_000, 20_000_000, 24.0, 25.0, 24), 'the budgets and the fit bound are pinned'
    assert abs(export.HFOV_MAX_DEG - 72 / 1.1) < 1e-12

def test_schema3():
    """The manifest validates; a tile array of the wrong length, a missing apron, a file named for another tile, and any key of schema 2 left behind (the camera's heading range and offset, the window, the plane width, the card's median and scale, the whole-bake w and h) are refused; the schema file is pinned; the layout constants are pinned."""
    _pins(); d = tempfile.mkdtemp()
    try:
        b = _toy(); pk = export.pack(b); dest = _write(d, b, pk); m = json.load(open(dest / 'manifest.json')); export.validate_manifest(m); mk = lambda: json.loads(json.dumps(m))
        assert m['schema'] == 3 and m['baker_version'] == 5 and set(m['view']) >= {'ring_w', 'tile_w', 'tiles', 'apron'} and 'rows_above' not in m['view'] and m['camera'] == dict(r_max_m=pk['camera']['r_max_m'], r_max_forward_m=pk['camera']['r_max_forward_m']) and m['camera']['r_max_forward_m'] >= m['camera']['r_max_m'] and len(m['tiles']) == 32 and 'w' not in m and 'h' not in m
        def bad(f, why):
            x = mk(); f(x)
            try: export.validate_manifest(x)
            except ValueError: return
            raise AssertionError(why)
        bad(lambda x: x['camera'].pop('r_max_forward_m'), 'a camera without its forward offset validated'); bad(lambda x: x['camera'].pop('r_max_m'), 'a camera without its offset validated')
        bad(lambda x: x['tiles'].pop(), 'a manifest of 31 tiles validated'); bad(lambda x: x['tiles'][3].pop(), 'a tile with a card missing validated'); bad(lambda x: x['tiles'][3].append(None), 'a tile with an extra card validated'); bad(lambda x: x['view'].pop('apron'), 'a missing apron validated')
        bad(lambda x: x['view'].update(apron=0), 'an apron of 0 validated'); bad(lambda x: x['tiles'][2][1]['colour'].update(file='card-1-t03-colour.webp'), 'a file named for another tile validated')
        bad(lambda x: x['tiles'].__setitem__(slice(None), [[None] * 3 for _ in range(32)]), 'a card null in every tile validated'); bad(lambda x: x.update(bytes=x['bytes'] + 1), 'a wrong byte total validated')
        for where, key in (('camera', 'heading_max' + '_deg'), ('view', 'window' + '_deg'), ('view', 'plane' + '_w'), ('view', 'rows_above'), ('camera', 'r_m'), (None, 'w'), (None, 'h')):       # schema 2's names are spelled in pieces: the baker's tree must hold none of them
             bad(lambda x: (x[where] if where else x).update({key: 1}), f'a leftover {key} validated')
        bad(lambda x: x['cards'][0].update(**{'median' + '_m': 1.0}), 'a leftover median validated'); bad(lambda x: x['cards'][0].update(scale=1.0), 'a leftover scale validated'); bad(lambda x: x['tiles'][0][0].update(scale=1.0), 'a tile entry with a scale validated')
        bad(lambda x: x['tiles'][0][0].update(distance_m='far'), 'a distance that is not a number validated'); bad(lambda x: x['place'].update(tz='Mars/Olympus'), 'a zone the system does not know validated')
        assert json.load(open(os.path.join(SRC, 'ridge-bake.schema.json'))) == json.loads(json.dumps(export.SCHEMA)), 'ridge-bake.schema.json is stale (export.py --write-schema)'
    finally: shutil.rmtree(d)
def test_manifest_v3_writer():
    """Two packs of one bake give the same bytes and bake_id; tiles[t][i] files are where the manifest says with the sizes it says and decode to tile_w + 2 apron columns; the bake_id is the sha256 of the files tile-major, then card, colour then geometry; the index points at the dir, a
    rebake replaces the old dir, cards are nearest first with their seam medians, the attribution is the four pinned strings."""
    d = tempfile.mkdtemp()
    try:
        b = _toy(); pk = export.pack(b); pk2 = export.pack(b); files = lambda p: [(e['colour'], e['geometry']) for row in p['tiles'] for e in row if e]; assert files(pk) == files(pk2), 'two packs gave different bytes'
        a = _write(d + '/a', b, pk); assert a.name == 'toy-' + export.bake_id(files(pk)) and sorted(os.listdir(d + '/a')) == sorted(['index.json', a.name]); m = json.load(open(a / 'manifest.json')); export.validate_manifest(m)
        import hashlib; want = hashlib.sha256(b''.join(c + g for c, g in files(pk))).hexdigest()[:12]; assert export.bake_id(files(pk)) == want, 'bake_id is not the sha256 of the tile files, tile-major then card, colour then geometry'
        assert export.bake_id([(g, c) for c, g in files(pk)]) != want and export.bake_id(files(pk)[::-1]) != want and export.bake_id([f for i, f in enumerate(files(pk)) if i % 3 != 1] + [f for i, f in enumerate(files(pk)) if i % 3 == 1]) != want, 'bake_id ignores the file order'
        pk3 = [list(f) for f in files(pk)]; pk3[40][1] += b'x'; assert export.bake_id([tuple(f) for f in pk3]) != want, 'a changed byte kept the bake_id'
        assert m['cards'][0]['near_m'] is None and m['cards'][-1]['far_m'] is None and m['cards'][0]['far_m'] == m['cards'][1]['near_m'] and len(m['cards']) == 3
        for t, row in enumerate(m['tiles']):
            for i, e in enumerate(row):
                for kind in ('colour', 'geometry'): f = a / e[kind]['file']; assert f.stat().st_size == e[kind]['bytes'] and export.decode(f.read_bytes()).shape[:2] == (e['h'], export.TILE_W + 2 * export.APRON), (t, i, kind)
        assert m['bytes'] == sum(e[k]['bytes'] for row in m['tiles'] for e in row for k in ('colour', 'geometry')) and m['encoding']['normal'] == 'rt8' and m['curvature'] == dict(r_earth_m=ridge.R_EARTH, k_ref=ridge.KREF)
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
                col = export.decode((dest / e['colour']['file']).read_bytes()); assert col.shape[:2] == (e['h'], export.TILE_W + 2 * export.APRON) and np.abs(col[..., 3].astype(int) - np.rint(c['alpha'] * 255)).max() == 0, 'the written alpha is not the card alpha'
        t0 = _toy(); cs = [[dict(c) for c in tile] for tile in t0['cards']]; empty = dict(top=0, alpha=np.zeros((0, 204), np.float32), albedo=np.zeros((0, 204, 3), np.float32), n_r=np.zeros((0, 204), np.float32), n_t=np.zeros((0, 204), np.float32), logd=np.zeros((0, 204), np.float32), wall=np.zeros((0, 204), bool))
        cs[5][2] = empty; op = [x.copy() for x in t0['opaque']]; op[5] = export.composite_alpha([(c['top'], c['alpha']) for c in cs[5] if c['alpha'].shape[0]], H, 204); b5 = dict(t0, cards=cs, opaque=op); pk5 = export.pack(b5)
        assert pk5['tiles'][5][2] is None and pk5['tiles'][4][2] is not None; dest = _write(d + '/null', b5, pk5); m5 = json.load(open(dest / 'manifest.json')); assert m5['tiles'][5][2] is None and not (dest / export.tile_file(2, 5, 'colour')).exists() and (dest / export.tile_file(2, 4, 'colour')).exists()
        for i, why in ((1, '20 km'), (2, '55 km')):
            gone = [[empty if j == i else c for j, c in enumerate(tile)] for tile in b['cards']]
            try: export.pack(dict(b, cards=gone))
            except ValueError as e: assert f'card {i} is empty' in str(e) and why in str(e), str(e)
            else: assert False, ('an empty card', i, 'was packed')
        liquid = [[dict(c, alpha=c['alpha'] * 0.4) if j == 1 else c for j, c in enumerate(tile)] for tile in t0['cards']]
        try: export.pack(dict(t0, cards=liquid))
        except ValueError as e: assert 'no solid terrain' in str(e), str(e)
        else: assert False, 'a card with no solid pixel in any tile was packed'
        walled = [[dict(c, wall=np.ones_like(c['wall'])) if j == 1 else c for j, c in enumerate(tile)] for tile in t0['cards']]
        try: export.pack(dict(t0, cards=walled))
        except ValueError as e: assert 'no solid terrain' in str(e), str(e)
        else: assert False, 'a card that is all wall was packed'
    finally: shutil.rmtree(d)
def test_cover_and_size_refusals_write_nothing():
    """write_bake measures the files it is handed: a hole in one tile's card (alpha zeroed over a band of columns) fails that tile's cover check and names the tile, a card leaving the frame, a tile file without its apron, colour and geometry of two sizes and an opaque view of the wrong
    rows are refused, and nothing is written."""
    d = tempfile.mkdtemp()
    try:
        b = _toy(); pk = export.pack(b); c = b['cards'][3][2]; hole = c['alpha'].copy(); hole[:, 100:140] = 0; bad = [list(r) for r in pk['tiles']]; bad[3][2] = dict(bad[3][2], colour=export.encode_colour(c['albedo'], hole)); _refuses(d + '/hole', b, dict(pk, tiles=bad), 'a bake whose card leaves a hole was written')
        try: _write(d + '/hole', b, dict(pk, tiles=bad))
        except ValueError as e: assert 'tile 3' in str(e), str(e)
        off = [list(r) for r in pk['tiles']]; off[7][0] = dict(off[7][0], top=H - 5); _refuses(d + '/off', b, dict(pk, tiles=off), 'a card leaving the frame was written')
        narrow = [list(r) for r in pk['tiles']]; c0 = b['cards'][2][0]; narrow[2][0] = dict(narrow[2][0], colour=export.encode_colour(c0['albedo'][:, 2:-2], c0['alpha'][:, 2:-2]), geometry=export.encode_geometry(c0['n_r'][:, 2:-2], c0['n_t'][:, 2:-2], c0['logd'][:, 2:-2], b['meta']['encoding'])); _refuses(d + '/apron', b, dict(pk, tiles=narrow), 'a tile without its apron was written')
        try: _write(d + '/apron', b, dict(pk, tiles=narrow))
        except ValueError as e: assert 'apron' in str(e), str(e)
        mism = [list(r) for r in pk['tiles']]; mism[4][1] = dict(mism[4][1], geometry=export.encode_geometry(c0['n_r'][:50], c0['n_t'][:50], c0['logd'][:50], b['meta']['encoding'])); _refuses(d + '/size', b, dict(pk, tiles=mism), 'a colour and geometry of two sizes were written')
        _refuses(d + '/rows', b, pk, 'view plane_h disagreeing with the opaque view was written', view=dict(b['view'], plane_h=H + 1)); _refuses(d + '/short', b, dict(pk, tiles=pk['tiles'][:31]), 'a bake of 31 tiles was written')
    finally: shutil.rmtree(d)
def _flat_entry(top, h, w=export.TILE_W + 2 * export.APRON, seed=0, noise=False, distance_m=1000.0):
    rng = np.random.default_rng(seed); alpha = np.ones((h, w), np.float32); rgb = rng.random((h, w, 3)).astype(np.float32) if noise else np.full((h, w, 3), 0.5, np.float32); geo = rng.random((h, w)).astype(np.float32) if noise else np.full((h, w), 0.5, np.float32)
    enc = dict(log_d_min=0.0, log_d_max=1.0); return dict(top=top, colour=export.encode_colour(rgb, alpha), geometry=export.encode_geometry(geo, geo, geo, enc), distance_m=distance_m)
def test_card_cap_refusals():
    """A preset with 6 splits, or splits not increasing, is refused by load_preset before any march; a bake of 7 cards is refused; 6 cards that fit the budgets are written; 6 full-frame cards in every tile (the lit canvases of 13 tiles are 38 MB) are refused and write nothing."""
    d = tempfile.mkdtemp()
    try:
        for bad in ([5, 10, 20, 30, 40, 50], [6, 6], [6, 5], []):
            p = os.path.join(d, 'p.json'); json.dump(dict(presets=[dict(id='x', tz='UTC', card_split_km=bad)]), open(p, 'w'))       # a valid zone, so only the splits can refuse it
            try: ridge.load_preset('x', p)
            except ValueError: pass
            else: assert False, ('a preset with splits', bad, 'was accepted')
        json.dump(dict(presets=[dict(id='x')]), open(os.path.join(d, 'q.json'), 'w'))
        try: ridge.load_preset('x', os.path.join(d, 'q.json'))
        except ValueError: pass
        else: assert False, 'a preset without card_split_km was defaulted'
        json.dump(dict(presets=[dict(id='x', tz='Europe/Vienna', card_split_km=[1, 2, 3, 4, 5])]), open(os.path.join(d, 'r.json'), 'w')); assert ridge.load_preset('x', os.path.join(d, 'r.json'))['card_split_km'] == [1, 2, 3, 4, 5]
        for bad_tz in (None, '', 'Not/AZone'):
            p = os.path.join(d, 'tz.json'); json.dump(dict(presets=[dict(id='x', card_split_km=[6], **({} if bad_tz is None else dict(tz=bad_tz)))]), open(p, 'w'))
            try: ridge.load_preset('x', p)
            except ValueError: pass
            else: assert False, ('a preset with tz', bad_tz, 'was accepted')
        place = dict(id='synthetic', name='S', lat=0.0, lon=0.0, altitude_km=0.0, eye_m=1.0, tz='UTC'); meta = dict(curvature=dict(r_earth_m=1.0, k_ref=0.1), encoding=dict(log_d_min=0.0, log_d_max=1.0)); view = dict(look_az_deg=0.0, plane_h=H, px_per_deg_h=1.0, px_per_deg_v=1.0, exaggeration=1.0, horizon_row=1.0, sky_row=1.0, near_row=1.0)
        full = [np.ones((H, 204)) for _ in range(32)]; cards = lambda k: [dict(near_m=None if i == 0 else 1.0, far_m=None if i == k - 1 else 1.0) for i in range(k)]; cam = dict(r_max_m=100.0, r_max_forward_m=100.0)
        big = dict(cards=cards(6), tiles=[[_flat_entry(0, H, seed=0)] + [_flat_entry(0, H) for _ in range(5)] for _ in range(32)], camera=cam)
        try: export.write_bake(d + '/big', place, view, meta, big, full)
        except ValueError as e: assert 'consecutive tiles' in str(e), str(e)
        else: assert False, 'six full-frame cards in every tile were written'
        assert not os.path.exists(d + '/big')
        ok = dict(cards=cards(6), tiles=[[_flat_entry(0, H, seed=0)] + [_flat_entry(0, 100, seed=i) for i in range(1, 6)] for _ in range(32)], camera=cam); dest = export.write_bake(d + '/six', place, view, meta, ok, full); assert len(json.load(open(dest / 'manifest.json'))['cards']) == 6
        fwd = lambda r: dict(ok, camera=dict(r_max_m=100.0, r_max_forward_m=r)); bands6 = [[H] + [100] * 5] * 32; assert export.resident_bytes(bands6, export.run_tiles(100.0, 1000.0)) <= export.RESIDENT_BYTES_MAX < export.resident_bytes(bands6, export.run_tiles(1e6, 1000.0)), 'the fixture cannot tell the gate at r_max_forward_m from the gate at r_max_m'
        try: export.write_bake(d + '/fwd', place, view, meta, fwd(1e6), full)
        except ValueError as e: assert 'consecutive tiles' in str(e), str(e)
        else: assert False, 'a bake whose forward offset breaks the resident gate was written'
        try: export.write_bake(d + '/low', place, view, meta, fwd(50.0), full)
        except ValueError as e: assert 'below r_max_m' in str(e), str(e)
        else: assert False, 'a bake whose forward offset is below the worst-case offset was written'
        assert not os.path.exists(d + '/fwd') and not os.path.exists(d + '/low')
        try: export.check_budget(7, [1000] * 32, [[10] * 7] * 32, 100.0, 1000.0)
        except ValueError as e: assert 'above 6' in str(e)
        else: assert False, '7 cards were accepted'
    finally: shutil.rmtree(d)
def test_budgets():
    """A tile over 235 kB, a place over 7.5 MB and a resident run over 20 MB each refuse and one byte (one band row) under passes; the resident run wraps the ring: the last tiles and the first count as consecutive."""
    none = [[] for _ in range(export.TILES)]; call = lambda tb, bands, r=100.0, rmin=1000.0: export.check_budget(3, tb, bands, r, rmin)
    def refused(*a, **k):
        try: call(*a, **k)
        except ValueError: return True
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
        except ValueError as e: assert 'below 25' in str(e) and 'card 1' in str(e) and 'tile 7' in str(e), str(e)
        else: assert False, 'a bake whose r_max_m is below 25 was accepted'
        close = [[30.0] for _ in range(32)]
        try: export.solve_r_max(close, bands, ppd)
        except ValueError as e: assert 'below 25' in str(e) and 'card 0' in str(e), str(e)
        else: assert False, 'a nearest card at 30 m was accepted'
    finally: export.FIT_PX_MAX, export.PHI_STEPS = saved
def test_pack_distance_and_r_max_in_the_bake():
    """pack: a card tile's distance_m is exp(median ln d) over the interior solid pixels that are not wall (not the wall rows, not the apron columns); the manifest camera is the r_max_m of those distances and no per-card scale or median is written."""
    b = _toy(); cs = [[dict(c) for c in tile] for tile in b['cards']]; c = dict(cs[10][1]); n = c['alpha'].shape[0]; wall = np.zeros_like(c['wall']); wall[:n * 3 // 4] = True; ld = np.where(wall, c['logd'] + 3.0, c['logd']).copy(); ld[:, :2] += 2.0; ld[:, -2:] += 2.0; cs[10][1] = dict(c, wall=wall, logd=ld)
    pk = export.pack(dict(b, cards=cs)); inner = (slice(None), slice(2, -2)); want = float(np.exp(np.median(ld[inner][~wall[inner]]))); with_wall = float(np.exp(np.median(ld[inner]))); assert abs(with_wall - want) > 0.05 * want, 'the fixture cannot tell wall rows from ground'
    assert abs(pk['tiles'][10][1]['distance_m'] - want) < 1e-9 * want, ('the distance counted wall rows or the apron', pk['tiles'][10][1]['distance_m'], want); assert set(pk['tiles'][10][1]) == {'top', 'colour', 'geometry', 'distance_m'} and set(pk['cards'][0]) == {'near_m', 'far_m'}
    base = export.pack(b); assert base['camera']['r_max_m'] >= 25 and base['camera']['r_max_forward_m'] >= base['camera']['r_max_m'] and abs(base['report']['nearest_m'] - min(e[0]['distance_m'] for e in base['tiles'])) < 1e-9 and len(base['report']['fit_px']) == 3 and max(base['report']['fit_px']) <= export.FIT_PX_MAX + 1e-6
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
        p = ridge.configure(dict(ridge.load_preset('vienna'), card_split_km=splits)); d, _, Hh, _ = ridge.stage0(False); a, h = ridge.prefilter(d, Hh, p['prefilter_m']); ridge.set_view(a.max(0)); nrm = ridge.normals(d, h); sm = ridge.seams(ridge.coverage(d, a), [k * 1000.0 for k in splits], d); op = ridge.opaque(a)
        cols = lambda x, t: ridge.ring_cols(x, t * export.TILE_W - export.APRON, export.TILE_W + 2 * export.APRON)
        return d, sm, {t: ridge.cards(d, cols(a, t), cols(h, t), cols(sm, t), tuple(cols(x, t) for x in nrm)) for t in tiles}, {t: cols(op, t) for t in tiles}
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
        assert json.load(open(d + '/index.json'))['default'] == 'vienna' and sorted(os.listdir(d)) == sorted(['index.json', dest.name]), os.listdir(d); print('   vienna manifest bytes', m['bytes'], 'largest tile', max(sum(e[k]['bytes'] for e in row if e for k in ('colour', 'geometry')) for row in m['tiles']))
    finally: shutil.rmtree(d)

# ---------------------------------------------------------------------------------------- the written files are the cards
def test_written_cards_decode_to_the_cards_in_memory():
    """Vienna's cards in three tiles (north, the rest azimuth's, the wrap), written and decoded again: alpha exactly, albedo within the lossy codec (and straight, not premultiplied, at partial alpha), the normal channels in their order (R along the ray, G across it), and the log-distance over the encoding
    range, within quantisation."""
    b = _vienna_bake(); d = tempfile.mkdtemp()
    try:
        dest = _write(d, b, export.pack(b)); m = json.load(open(dest / 'manifest.json')); enc = m['encoding']; span = enc['log_d_max'] - enc['log_d_min']; partial_seen = 0
        for t in (0, 19, 31):
            for c, rec in zip(b['cards'][t], m['tiles'][t]):
                col = export.decode((dest / rec['colour']['file']).read_bytes()); geo = export.decode((dest / rec['geometry']['file']).read_bytes()); al = c['alpha']; wall = c['wall']; solid = (al > 0) & ~wall; part = (al > 0.05) & (al < 0.95) & ~wall; partial_seen += int(part.sum())
                assert (col[..., 3] == np.rint(al * 255)).all(), 'alpha is not exact'; e = np.abs(col[..., :3] / 255.0 - c['albedo']).max(-1)
                assert e[solid].mean() < 0.021 and np.percentile(e[solid], 99) < 0.081, ('albedo is off', e[solid].mean(), np.percentile(e[solid], 99)); assert part.sum() == 0 or e[part].mean() < 0.1, ('albedo at partial alpha is off: premultiplied?', e[part].mean())
                assert (geo[..., 3] == 255).all(); q = 1.0 / 255 + 1e-6; assert (((geo[..., 0] == 255) & (geo[..., 1] == 255)) == wall).all(), 'the wall code is not R = G = 255 on exactly the wall pixels'
                assert np.abs(geo[..., 0] / 255.0 * 2 - 1 - c['n_r'])[solid].max() < 2 * q and np.abs(geo[..., 1] / 255.0 * 2 - 1 - c['n_t'])[solid].max() < 2 * q, 'a normal channel is off or swapped'
                assert np.abs(enc['log_d_min'] + geo[..., 2] / 255.0 * span - c['logd'])[solid].max() < span * q, 'the log-distance is off or not over the encoding range'
                assert np.abs(c['n_r'][solid]).mean() > 0.05 and np.abs(c['n_t'][solid]).mean() > 0.01 and np.abs(c['n_r'][solid].mean() - c['n_t'][solid].mean()) > 0.0, 'the fixture does not tell the channels apart'
                assert col[..., :3][solid].mean() > 20, 'albedo is zeroed'
        assert partial_seen > 0, 'the fixture has no partial alpha'
    finally: shutil.rmtree(d)

# ---------------------------------------------------------------------------------------- wall rows
def _first_sample_angle(b, i):
    """Per column, the angle of the first sample card i (> 0) reads: the first sample at or beyond its near seam, less the cross-fade half-width."""
    k0 = np.array([np.searchsorted(D, b['seams'][i - 1][x] * math.exp(-ridge.XF)) for x in range(NW)]); return k0, b['a'][k0, np.arange(NW)]
def test_wall_rows_flagged():
    """Card i > 0 flags as wall exactly the rows below the angle of its first sample (the extruded face of the ridge it starts at), card 0 none; the wall carries R = G = 255 in the geometry file and no other pixel has r2 + t2 above 1.02; wall pixels keep that sample's
    distance and their albedo is the ground material of the sample's height with the face up (so a steep face is not rock), constant down the column."""
    steep = 0
    for make in (lambda: _bake(WALLED, [20]), lambda: _bake(WIDE3, [20, 55]), lambda: _bake(_receding, [6]), lambda: _bake(_ramp, [20], fixed_m=[20000.0])):       # the ramp's seam is fixed: the wall must stand on the slope, below the height where every material is rock or snow
        b = make(); assert not b['cards'][0]['wall'].any(), 'card 0 has a wall'; lo = ridge.rowang - 0.5 / ridge.PXDEG_V; seen = 0
        for i, c in enumerate(b['cards']):
            if i == 0: continue
            k0, a0 = _first_sample_angle(b, i); want = (lo[:, None] < a0[None, :])[c['top']:c['top'] + c['alpha'].shape[0]]; assert (c['wall'] == want).all(), ('wall rows are not the rows below the first sample', i, int((c['wall'] != want).sum())); seen += int(want.sum())
            geo = export.decode(export.encode_geometry(c['n_r'], c['n_t'], c['logd'], dict(log_d_min=math.log(D[0]), log_d_max=math.log(D[-1])), c['wall'])); r, t = geo[..., 0] / 255.0 * 2 - 1, geo[..., 1] / 255.0 * 2 - 1; code = (geo[..., 0] == 255) & (geo[..., 1] == 255)
            assert (code == c['wall']).all() and (r[~code] ** 2 + t[~code] ** 2 <= 1.02).all(), 'the wall code is not on exactly the wall pixels, or a real normal reaches it'
            for x in np.flatnonzero(c['wall'].any(0)):
                rows = np.flatnonzero(c['wall'][:, x]); ld = c['logd'][rows, x]; assert np.ptp(ld) < 1e-5 and abs(math.exp(ld[0]) - D[k0[x]]) < 1e-3 * D[k0[x]] + 60, ('a wall keeps its sample distance', x)
                want_alb = ridge.albedo(np.array([b['h'][k0[x], x]]), np.array([1.0]))[0]; assert np.abs(c['albedo'][rows, x] - want_alb).max() < 1e-5, ('wall albedo is not the ground material with the face up', x)
        assert seen > 1000, 'the fixture has no wall'
        for i in range(1, len(b['cards'])):
            c = b['cards'][i]; steep += int((np.sqrt(np.clip(1 - c['n_r'] ** 2 - c['n_t'] ** 2, 0, 1))[c['wall']] < 0.93).sum())
    assert steep > 1000, 'no wall pixel has a steep face under it: a wall lit by its own normal would pass'
    b = _bake(NEARHILL, [20]); c0 = b['cards'][0]; lo = ridge.rowang - 0.5 / ridge.PXDEG_V; below = (lo[:, None] < b['a'][0][None, :])[c0['top']:c0['top'] + c0['alpha'].shape[0]]
    assert below.sum() > 1000 and not c0['wall'].any(), ('card 0 has no wall, though rows lie below its first sample', int(below.sum()))
def test_the_sheet_lights_a_wall_with_the_face_up():
    """The contact sheet shades a wall pixel as an up-facing one whatever normal the card carries there, and a non-wall pixel by its normal."""
    n = 4; c = dict(albedo=np.ones((n, n, 3), np.float32), alpha=np.ones((n, n), np.float32), n_r=np.full((n, n), 0.9, np.float32), n_t=np.zeros((n, n), np.float32), wall=np.zeros((n, n), bool)); c['wall'][:, :2] = True
    rgb, _ = export.lit(c); L = np.array(export.SHEET_LIGHT) / np.linalg.norm(export.SHEET_LIGHT); up = 0.35 + 0.65 * L[2]; tilted = 0.35 + 0.65 * np.clip(0.9 * L[0] + np.sqrt(1 - 0.81) * L[2], 0, 1)
    assert np.allclose(rgb[:, :2], up) and np.allclose(rgb[:, 2:], tilted) and abs(up - tilted) > 0.05, (rgb[0, 0], rgb[0, 3])
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
    A, Hh = rays(terrain(lambda dk, az: np.where(dk >= 4000, GROUND + 0.5 * (dk - 4000), 0.0) + 0 * az)); ridge.P.update(eye_m=EYE); ridge.set_view(A.max(0)); aw, hw = _w(A), _w(Hh); k = np.arange(len(D))[:, None]
    nr = np.broadcast_to(np.where(k % 2 == 0, -0.8, 0.8), aw.shape).astype(float); nt = np.broadcast_to(np.where(k % 3 == 0, 0.3, -0.3), aw.shape).astype(float); nu = np.sqrt(1 - nr ** 2 - nt ** 2) * 0 + 0.5
    c = ridge.cards(D, aw, hw, np.zeros((0, NW)), nrm=(nr, nt, nu))[0]; x = 300; sel = np.flatnonzero(c['alpha'][:, x] > 0.999); ld = c['logd'][sel, x].astype(np.float64); L = np.log(D); kk = np.searchsorted(L, ld, 'left'); kp = kk - 1; ok = kp >= 0
    t = (ld - L[np.maximum(kp, 0)]) / (L[kk] - L[np.maximum(kp, 0)]); inner = ok & (t > 0.02) & (t < 0.98); assert inner.sum() > 0.3 * len(sel), ('hits sit on samples, not between them', int(inner.sum()), len(sel))
    mix = lambda arr: arr[np.maximum(kp, 0), x] + t * (arr[kk, x] - arr[np.maximum(kp, 0), x]); m = np.sqrt(mix(nr) ** 2 + mix(nt) ** 2 + mix(nu) ** 2); er = np.abs(c['n_r'][sel, x] - mix(nr) / m)[inner]; et = np.abs(c['n_t'][sel, x] - mix(nt) / m)[inner]
    assert er.max() < 1e-3 and et.max() < 1e-3, ('the normal is not the normalised blend of the two samples', er.max(), et.max())

TESTS = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
if __name__ == '__main__':
    fails = 0
    for t in TESTS:
        try: t(); print("PASS", t.__name__)
        except Exception as e: fails += 1; print("FAIL", t.__name__, "|", repr(e)[:300])
    print("failures:", fails); sys.exit(1 if fails else 0)
