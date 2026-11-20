"""Fixtures for the ridge baker (march, prefilter, coverage, seams, normals, cards, export).  Plain asserts, no pytest needed:  venv/bin/python tests/test_ridge.py   (exit code 1 on failure).
RIDGE_SRC selects the source directory (default ..) (the mutation runner points it at a patched copy).
Synthetic terrain has a known right answer; the Vienna tests bake the real preset (its rays come from stage0: RIDGE_TILES needs the tiles, or a cached rays file must exist)."""
import os, sys, math, json, shutil, tempfile, traceback
SRC = os.environ.get('RIDGE_SRC') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); sys.path.insert(0, SRC)   # RIDGE_WORK and RIDGE_TILES must be set (tests/run.sh sets them)
import numpy as np, ridge, export
from ridge import W, WIN, H

EYE = 100.0; GROUND = 50.0          # ground below the eye: every ray climbs, so only the placed blocks make ridges
ridge.P = dict(id='synthetic', rmax_km=95, eye_m=100.0, win0=0)
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
def _bake(hfun, splits_km, sigma=0.0, slide=export.max_slide_px(WIN)):
    """prefilter, set_view, coverage, seams, cards on synthetic rays (window = columns 0..WIN, i.e. azimuth 0..72): the dict bake_place returns."""
    A, Hh = rays(hfun); ridge.P.update(win0=0, eye_m=EYE); a, h = ridge.prefilter(D, Hh, sigma); v = ridge.set_view(a.max(0))
    nrm = tuple(ridge.win(x) for x in ridge.normals(D, h)); aw, hw = ridge.win(a), ridge.win(h); cov = ridge.coverage(D, aw); sm = ridge.seams(cov, [k * 1000.0 for k in splits_km], D)
    place = dict(id='synthetic', name='Synthetic', lat=48.0, lon=16.0, altitude_km=0.05, eye_m=EYE)
    view = dict(look_az_deg=36.0, plane_h=H, px_per_deg_h=ridge.HPX_DEG, px_per_deg_v=v['px_per_deg'], exaggeration=v['exaggeration'], horizon_row=v['horizon_row'], sky_row=v['sky_row'] * H, near_row=v['near_row'] * H)
    meta = dict(curvature=dict(r_earth_m=ridge.R_EARTH, k_ref=ridge.KREF), encoding=dict(log_d_min=math.log(D[0]), log_d_max=math.log(D[-1])))
    return dict(place=place, view=view, meta=meta, cards=ridge.cards(D, aw, hw, sm, nrm, slide_px=slide), splits_km=list(splits_km), seams=sm, cov=cov, opaque=ridge.opaque(aw), edges=ridge.log_edges(D), a=aw, h=hw, v=v)
def _canvas(card, key='alpha'):
    out = np.zeros((H, WIN) + card[key].shape[2:], np.float32); out[card['top']:card['top'] + card[key].shape[0]] = card[key]; return out
def _row(deg): return int(np.argmin(np.abs(ridge.rowang - deg)))
THREE = terrain(block(0, 359.99, 3000, 3600, 350), block(0, 359.99, 20000, 21500, 1800), block(0, 359.99, 70000, 72000, 7000))       # ridges at 3, 20 and 70 km, each taller in angle than the one before

def test_seams_fall_in_depth_gaps():
    """Three ridges at 3, 20 and 70 km: targets [6, 40] give a seam in (3, 20) and one in (20, 70) in EVERY column, ordered with at least 0.4 nat between; targets [6] give one seam in (3, 20)."""
    b = _bake(THREE, [6, 40]); s = b['seams']; assert s.shape == (2, WIN)
    assert (s[0] > 3600).all() and (s[0] < 20000).all() and (s[1] > 21500).all() and (s[1] < 70000).all(), (s.min(1), s.max(1)); assert (np.log(s[1]) - np.log(s[0]) >= 0.4 - 1e-9).all()
    s1 = _bake(THREE, [6])['seams']; assert s1.shape == (1, WIN) and (s1[0] > 3600).all() and (s1[0] < 20000).all(), (s1.min(), s1.max())
def _recede(d0, d1, thick=300.0, hgt=1500.0):
    """A ridge `thick` m thick whose distance runs from d0 m at azimuth 0 to d1 m at azimuth 72."""
    return terrain(lambda dk, az: np.where((az <= 72) & (np.abs(dk - (d0 + (d1 - d0) * np.clip(az / 72.0, 0, 1))) < thick / 2), hgt, 0.0))
def _receding(dk, az): return _recede(4000.0, 15000.0)(dk, az)
def test_the_swept_rows_term_keeps_the_seam_from_hopping_under_a_stronger_pull():
    """With the authored depth pulling harder (0.1 instead of 0.02) the 4 to 15 km ridge's seam still follows the ridge: only the cost of the visible rows it would sweep holds it back (with that term out of the cost it hops between two columns)."""
    old = ridge.SEAM_PRIOR; ridge.SEAM_PRIOR = 0.1
    try: j0, j1, cover = _alpha_jumps(4, 15, 6)
    finally: ridge.SEAM_PRIOR = old
    assert j0 < 0.35 and j1 < 0.35 and cover > 0.999, ('the seam hopped across the ridge', j0, j1)
RECEDING = [(4, 15, 6), (3, 12, 6), (5, 30, 12), (8, 40, 15), (4, 15, 10), (6, 14, 9)]        # km at azimuth 0, km at azimuth 72, authored split km
def _alpha_jumps(d0, d1, split):
    """The two cards' alpha on the ridge body (crest + 4 rows), column to column: the largest step of each.  Unmasked cards: this is about where the seam goes, not what the slide may reveal."""
    b = _bake(_recede(d0 * 1000.0, d1 * 1000.0), [split], slide=None); c0 = _canvas(b['cards'][0]); c1 = _canvas(b['cards'][1]); crest = np.argmax(b['opaque'] > 0.5, axis=0); r = np.clip(crest + 4, 0, H - 1); ok = crest > 0
    a0 = c0[r, np.arange(WIN)]; a1 = c1[r, np.arange(WIN)]; return float(np.abs(np.diff(a0[ok])).max()), float(np.abs(np.diff(a1[ok])).max()), (a0 + (1 - a0) * a1)[ok].min()
def test_seam_never_splits_a_receding_ridge_side_by_side():
    """Six synthetic ridges whose distance recedes across the window (4 to 15, 3 to 12, 5 to 30, 8 to 40, 4 to 15 and 6 to 14 km, targets 6, 6, 12, 15, 10, 9 km): the nearer and the farther card's alpha on the ridge's body never jumps by 0.35 between neighbouring
    columns (a tear: one card here, the other next door; fading slowly over the cross-fade is fine) and the two cards together cover the body.  With the swept-rows term out of the seam cost the seam hops across the ridge; with the prior at 0.1 it hops on two of the six."""
    for d0, d1, sp in RECEDING:
        j0, j1, cover = _alpha_jumps(d0, d1, sp); assert j0 < 0.35 and j1 < 0.35, ('a card appears or vanishes between neighbouring columns', (d0, d1, sp), j0, j1); assert cover > 0.999, ('the ridge body is not covered by the two cards together', (d0, d1, sp))
def test_far_card_keeps_terrain_hidden_behind_a_nearer_ridge():
    """Layered depth (cards cut with slide_px None, the reference; the next tests pin what the slide cut leaves): a far ridge (20 km) lower in angle than the near ridge (3 km) in azimuth 0..36 and higher in 36..72.  Where the near card is opaque in front of the far ridge (columns 100..500) the mid card still holds that ridge, at its distance;
    where the far ridge shows above the near one (column 900) the near card is empty and the mid card holds it."""
    b = _bake(terrain(block(0, 359.99, 3000, 3600, 350), block(0, 36, 20000, 21500, 1500), block(36, 359.99, 20000, 21500, 2400)), [6], slide=None); c0, c1 = _canvas(b['cards'][0]), b['cards'][1]; a1 = _canvas(c1); ld1 = _canvas(c1, 'logd'); r = _row(theta(1500, 20000) - 0.2)
    for x in (100, 300, 500):
        assert c0[r, x] > 0.99, ('the near ridge does not cover the far one here', x); assert a1[r, x] > 0.99, ('the far card lost the terrain behind the near ridge', x); assert abs(math.exp(ld1[r, x]) - 20000) < 1500, (x, math.exp(ld1[r, x]))
    r = _row(0.5 * (theta(350, 3000) + theta(2400, 20000))); assert c0[r, 900] < 0.01 and a1[r, 900] > 0.99 and abs(math.exp(ld1[r, 900]) - 20000) < 1500, (c0[r, 900], a1[r, 900])
def test_crossfade_is_complementary():
    """A ridge across the seam (seam fixed at 6 km, the ridge's front face at 5.9 km inside the cross-fade): the nearer card is partly transparent over the window, the farther card is opaque on the ridge, and the composite stays at coverage 1 below the crest."""
    A, Hh = rays(terrain(block(0, 359.99, 5900, 6100, 900))); ridge.P.update(win0=0, eye_m=EYE); ridge.set_view(A.max(0)); aw, hw = ridge.win(A), ridge.win(Hh)
    cs = ridge.cards(D, aw, hw, np.full((1, WIN), 6000.0), slide_px=None); c0, c1 = _canvas(cs[0]), _canvas(cs[1]); crest = int(np.argmax(ridge.opaque(aw)[:, 500] > 0.5)); r = crest + 6
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
    A, Hh = rays(terrain(block(0, 36, 5000, 5600, 500), block(36, 359.99, 5000, 5600, 560))); ridge.P.update(win0=0, eye_m=EYE); ridge.set_view(A.max(0)); aw, hw = ridge.win(A), ridge.win(Hh); c = ridge.cards(D, aw, hw, np.zeros((0, WIN)), slide_px=None)[0]
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

# ---------------------------------------------------------------------------------------- the real thing: Vienna
def _vienna(splits):
    saved = ridge.P
    try:
        p = ridge.configure(dict(ridge.load_preset('vienna'), card_split_km=splits)); d, _, Hh, _ = ridge.stage0(False); a, h = ridge.prefilter(d, Hh, p['prefilter_m']); ridge.set_view(a.max(0)); aw = ridge.win(a); hw = ridge.win(h)
        nrm = tuple(ridge.win(x) for x in ridge.normals(d, h)); cov = ridge.coverage(d, aw); sm = ridge.seams(cov, [k * 1000.0 for k in splits], d); return d, aw, ridge.cards(d, aw, hw, sm, nrm, slide_px=export.max_slide_px(WIN)), sm, ridge.opaque(aw)
    finally: ridge.P = saved
def test_vienna_k1_k2_k3():
    """Vienna with card_split_km [6], [6, 40] and [6, 20, 40]: 2, 3 and 4 cards, seams ordered in every column, each composite equals the opaque view within 0.02; the cross-fade column count of each K is printed."""
    for sp in ([6], [6, 40], [6, 20, 40]):
        d, aw, cs, sm, op = _vienna(sp); assert len(cs) == len(sp) + 1 and sm.shape == (len(sp), WIN)
        if len(sp) > 1: assert (np.diff(np.log(sm), axis=0) >= 0.4 - 1e-9).all(), 'seams out of order'
        comp = 1 - np.prod([1 - _canvas(c) for c in cs], axis=0); assert np.abs(comp - op).max() < 0.02, (sp, np.abs(comp - op).max())
        xf = int(np.any([((0.02 < _canvas(c)) & (_canvas(c) < 0.98)).sum(0) > 3 for c in cs], axis=0).sum())
        print(f'   K={len(sp)} splits {sp}: {len(cs)} cards, bands {[(c["top"], c["alpha"].shape[0]) for c in cs]}, seam medians km {[round(float(np.median(s)) / 1000, 1) for s in sm]}, cross-fade columns {xf} of {WIN}')
def test_bake_place_manifest_fields_on_vienna():
    """bake_place on the real Vienna preset: three cards, the place carries the ground (km) and the eye, horizon_row is the row where the elevation angle is 0, px_per_deg_h is the ring's; write_bake of its packed cards validates, index default 'vienna', and no temp dir is left."""
    saved = ridge.P
    try: b = export.bake_place('vienna'); P = ridge.P; rowang = ridge.rowang; pxv = ridge.PXDEG_V
    finally: ridge.P = saved
    pl, view = b['place'], b['view']; assert abs(pl['altitude_km'] * 1000 - P['ground_m']) < 1e-6 and abs(pl['eye_m'] - P['eye_m']) < 1e-9 and pl['id'] == 'vienna' and len(b['cards']) == 3
    assert 0 < view['sky_row'] < view['horizon_row'] < view['near_row'] < H and abs(rowang[int(view['horizon_row'])]) <= 1.0 / pxv, (view, rowang[int(view['horizon_row'])]); assert view['px_per_deg_h'] == ridge.HPX_DEG and abs(view['exaggeration'] - pxv / ridge.HPX_DEG) < 1e-9
    d = tempfile.mkdtemp()
    try:
        dest = export.write_bake(d, pl, view, b['meta'], export.pack(b), b['opaque']); m = json.load(open(dest / 'manifest.json')); export.validate(m, export.SCHEMA['$defs']['manifest'])
        assert json.load(open(d + '/index.json'))['default'] == 'vienna' and sorted(os.listdir(d)) == sorted(['index.json', dest.name]), os.listdir(d); print('   vienna manifest bytes', m['bytes'], 'cards', [(c['top'], c['h'], c['colour']['bytes'] + c['geometry']['bytes']) for c in m['cards']])
    finally: shutil.rmtree(d)

# ---------------------------------------------------------------------------------------- export: manifest v2, budget, cover
def _packed(b=None):
    b = b or _bake(THREE, [6, 40]); return b, export.pack(b)
def _refuses(out, b, packed, why, **kw):
    args = dict(place=b['place'], view=b['view'], meta=b['meta'], cards=packed, opaque=b['opaque']); args.update(kw)
    try: export.write_bake(out, **args)
    except ValueError: assert not os.path.exists(out), ('a refused bake left files', why)
    else: assert False, why
def test_manifest_v2_writer():
    """Two independent bakes give the same bytes and bake_id; the manifest validates (an extra key does not), cards are nearest first with their bands and seam medians, the files are what the manifest says, the index points at the dir, a rebake replaces
    the old dir, the committed schema is current, and the Copernicus attribution is the four pinned strings."""
    d = tempfile.mkdtemp()
    try:
        b, pk = _packed(); b2, pk2 = _packed(_bake(THREE, [6, 40])); assert [(c['colour'], c['geometry']) for c in pk] == [(c['colour'], c['geometry']) for c in pk2], 'two independent bakes gave different bytes'
        a = export.write_bake(d + '/a', b['place'], b['view'], b['meta'], pk, b['opaque']); assert a.name == 'synthetic-' + export.bake_id([(c['colour'], c['geometry']) for c in pk]); assert sorted(os.listdir(d + '/a')) == sorted(['index.json', a.name])
        m = json.load(open(a / 'manifest.json')); export.validate(m, export.SCHEMA['$defs']['manifest']); assert m['schema'] == 2 and m['max_slide_px'] == export.max_slide_px(WIN) and m['baker_version'] == export.BAKER_VERSION and len(m['cards']) == 3 and m['w'] == WIN and m['h'] == H
        assert m['cards'][0]['near_m'] is None and m['cards'][-1]['far_m'] is None and m['cards'][0]['far_m'] == m['cards'][1]['near_m'] and m['cards'][0]['median_m'] < m['cards'][1]['median_m'] < m['cards'][2]['median_m']
        for c in m['cards']:
            for kind in ('colour', 'geometry'): f = a / c[kind]['file']; assert f.stat().st_size == c[kind]['bytes'] and export.decode(f.read_bytes()).shape[:2] == (c['h'], WIN), c
        assert m['bytes'] == sum(c[k]['bytes'] for c in m['cards'] for k in ('colour', 'geometry')) and m['encoding']['normal'] == 'rt8' and m['curvature'] == dict(r_earth_m=ridge.R_EARTH, k_ref=ridge.KREF)
        idx = json.load(open(d + '/a/index.json')); export.validate(idx, export.SCHEMA['$defs']['index']); assert idx == dict(schema=1, default='synthetic', places={'synthetic': a.name})
        pk3 = [dict(c) for c in pk]; pk3[1]['geometry'] = pk3[1]['geometry'] + b'x'; assert export.bake_id([(c['colour'], c['geometry']) for c in pk3]) != export.bake_id([(c['colour'], c['geometry']) for c in pk]), 'a changed byte kept the bake_id'
        import hashlib; want = hashlib.sha256(b''.join(c['colour'] + c['geometry'] for c in pk)).hexdigest()[:12]; assert export.bake_id([(c['colour'], c['geometry']) for c in pk]) == want, 'bake_id is not the sha256 of the card files, colour then geometry, in index order'
        assert export.bake_id([(c['geometry'], c['colour']) for c in pk]) != want and export.bake_id([(c['colour'], c['geometry']) for c in pk[::-1]]) != want, 'bake_id ignores the file order'
        bad = json.loads(json.dumps(m)); bad['cards'][0]['extra'] = 1
        try: export.validate(bad, export.SCHEMA['$defs']['manifest'])
        except ValueError: pass
        else: assert False, 'an extra key passed the schema'
        assert json.load(open(os.path.join(SRC, 'ridge-bake.schema.json'))) == json.loads(json.dumps(export.SCHEMA)), 'ridge-bake.schema.json is stale (export.py --write-schema)'
        want = dict(credit_line='Contains modified Copernicus data: DEM © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.',
                    licence='Copernicus DEM licence: free, full and open access, with the credit line shown', dem_source='Copernicus DEM GLO-30 (30 m)', url='https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model')
        assert m['attribution'] == want, m['attribution']
        c = export.write_bake(d + '/a', b['place'], b['view'], b['meta'], pk, b['opaque'])
        assert c.name == a.name; other = dict(b['place'], id='other'); export.write_bake(d + '/a', other, b['view'], b['meta'], pk, b['opaque']); assert json.load(open(d + '/a/index.json'))['default'] == 'synthetic'
        export.write_bake(d + '/a', other, b['view'], b['meta'], pk, b['opaque'], default='other'); assert json.load(open(d + '/a/index.json'))['default'] == 'other'
        idx = json.load(open(d + '/a/index.json')); idx['default'] = 'gone'; open(d + '/a/index.json', 'w').write(json.dumps(idx)); export.write_bake(d + '/a', other, b['view'], b['meta'], pk, b['opaque']); assert json.load(open(d + '/a/index.json'))['default'] == 'other'
    finally: shutil.rmtree(d)
def test_cover_and_size_refusals_write_nothing():
    """write_bake measures the files it is handed: a card with a hole (alpha zeroed in a band of columns) fails the cover check, a card leaving the frame, cards of two widths and a colour/geometry size mismatch are refused, and nothing is written."""
    d = tempfile.mkdtemp()
    try:
        b, pk = _packed(); c1 = b['cards'][1]; hole = c1['alpha'].copy(); hole[:, 200:260] = 0
        holed = [dict(c) for c in pk]; holed[1]['colour'] = export.encode_colour(c1['albedo'], hole); holed[2] = dict(pk[2], colour=export.encode_colour(b['cards'][2]['albedo'], b['cards'][2]['alpha'] * 0)); _refuses(d + '/hole', b, holed, 'a bake whose cards leave a hole was written')
        _refuses(d + '/off', b, [dict(c, top=H - 5) if i == 0 else c for i, c in enumerate(pk)], 'a card leaving the frame was written')
        narrow = [dict(c) for c in pk]; narrow[0]['colour'] = export.encode_colour(b['cards'][0]['albedo'][:, :1000], b['cards'][0]['alpha'][:, :1000]); _refuses(d + '/wide', b, narrow, 'cards of two widths were written')
        _refuses(d + '/rows', b, pk, 'view plane_h disagreeing with the opaque view was written', view=dict(b['view'], plane_h=H + 1))
    finally: shutil.rmtree(d)
def _flat_card(top, h, w=WIN, seed=0, noise=False):
    rng = np.random.default_rng(seed); alpha = np.ones((h, w), np.float32); rgb = rng.random((h, w, 3)).astype(np.float32) if noise else np.full((h, w, 3), 0.5, np.float32); geo = rng.random((h, w)).astype(np.float32) if noise else np.full((h, w), 0.5, np.float32)
    enc = dict(log_d_min=0.0, log_d_max=1.0); return dict(top=top, colour=export.encode_colour(rgb, alpha), geometry=export.encode_geometry(geo, geo, geo, enc), near_m=None, far_m=None, median_m=1.0)
def test_card_cap_refusals():
    """A preset with 6 splits, or splits not increasing, is refused by load_preset before any march; write_bake refuses 4 full-frame 1280x600 cards (24.6 MB decoded) and writes nothing; 6 cards whose bands fit the budget are written; the card count and bytes are capped."""
    d = tempfile.mkdtemp()
    try:
        for bad in ([5, 10, 20, 30, 40, 50], [6, 6], [6, 5], []):
            p = os.path.join(d, 'p.json'); json.dump(dict(presets=[dict(id='x', card_split_km=bad)]), open(p, 'w'))
            try: ridge.load_preset('x', p)
            except ValueError: pass
            else: assert False, ('a preset with splits', bad, 'was accepted')
        json.dump(dict(presets=[dict(id='x')]), open(os.path.join(d, 'q.json'), 'w'))
        try: ridge.load_preset('x', os.path.join(d, 'q.json'))
        except ValueError: pass
        else: assert False, 'a preset without card_split_km was defaulted'
        json.dump(dict(presets=[dict(id='x', card_split_km=[1, 2, 3, 4, 5])]), open(os.path.join(d, 'r.json'), 'w')); assert ridge.load_preset('x', os.path.join(d, 'r.json'))['card_split_km'] == [1, 2, 3, 4, 5]
        place = dict(id='synthetic', name='S', lat=0.0, lon=0.0, altitude_km=0.0, eye_m=1.0); meta = dict(curvature=dict(r_earth_m=1.0, k_ref=0.1), encoding=dict(log_d_min=0.0, log_d_max=1.0)); view = dict(look_az_deg=0.0, plane_h=H, px_per_deg_h=1.0, px_per_deg_v=1.0, exaggeration=1.0, horizon_row=1.0, sky_row=1.0, near_row=1.0)
        full = np.ones((H, WIN))
        _refuses(d + '/four', dict(place=place, view=view, meta=meta, opaque=full), [_flat_card(0, H) for _ in range(4)], 'four full-frame cards (24.6 MB decoded) were written')
        ok = [_flat_card(0, H)] + [_flat_card(0, 150, seed=i) for i in range(1, 6)]; dest = export.write_bake(d + '/six', place, view, meta, ok, full); assert len(json.load(open(dest / 'manifest.json'))['cards']) == 6
        try: export.check_budget([1000] * 7, WIN, [10] * 7)
        except ValueError as e: assert 'above 6' in str(e)
        else: assert False, '7 cards were accepted'
        try: export.check_budget([750_001, 750_000], WIN, [10, 10])
        except ValueError as e: assert 'bytes' in str(e)
        else: assert False, 'cards above TOTAL_BYTES_MAX were accepted'
        export.check_budget([750_000, 750_000], WIN, [10, 10])
        try: export.check_budget([1, 1], export.PLANE_W_MAX + 1, [10, 10])
        except ValueError: pass
        else: assert False, 'a card wider than the cap was accepted'
    finally: shutil.rmtree(d)
def test_cards_are_cropped_to_their_band():
    """Each card is exactly the rows where its 8-bit alpha is non-zero; the manifest top and h place it back at the same rows (colour and geometry decode to that band, alpha in the file equals the canvas row for row)."""
    d = tempfile.mkdtemp()
    try:
        b, pk = _packed(); dest = export.write_bake(d, b['place'], b['view'], b['meta'], pk, b['opaque']); m = json.load(open(dest / 'manifest.json'))
        for c, rec in zip(b['cards'], m['cards']):
            canvas = _canvas(c); rows = np.flatnonzero(np.rint(canvas * 255).max(1) > 0); assert rec['top'] == rows[0] and rec['h'] == rows[-1] - rows[0] + 1 == c['alpha'].shape[0], (rec, rows[0], rows[-1])
            col = export.decode((dest / rec['colour']['file']).read_bytes()); assert col.shape[:2] == (rec['h'], WIN) and np.abs(col[..., 3].astype(int) - np.rint(c['alpha'] * 255)).max() == 0, 'the written alpha is not the card alpha'
            assert export.decode((dest / rec['geometry']['file']).read_bytes()).shape[:2] == (rec['h'], WIN)
    finally: shutil.rmtree(d)

# ---------------------------------------------------------------------------------------- reveal-bounded cards: what the slide may show is kept, the rest is cut
def _shift(a, s):
    """a slid s columns to the right (the last axis), zero where nothing comes in."""
    out = np.zeros_like(a)
    if s > 0: out[..., s:] = a[..., :-s]
    elif s < 0: out[..., :s] = a[..., -s:]
    else: out[:] = a
    return out
def _over(cs, shifts):
    """Colour and coverage of the alpha-over of the cards, last to first, card j slid by shifts.get(j, 0) columns."""
    rgb = np.zeros((H, WIN, 3)); cov = np.zeros((H, WIN))
    for j in reversed(range(len(cs))):
        al = _shift(_canvas(cs[j]), shifts.get(j, 0)); col = _shift(_canvas(cs[j], 'albedo').transpose(2, 0, 1), shifts.get(j, 0)).transpose(1, 2, 0)
        rgb = rgb * (1 - al[..., None]) + col * al[..., None]; cov = 1 - (1 - cov) * (1 - al)
    return rgb, cov
OVERLAP = terrain(block(10, 40, 3000, 3600, 350), block(0, 60, 20000, 21500, 1800), block(0, 359.99, 70000, 72000, 7000))
def test_no_slide_within_the_bound_reveals_a_cut_pixel():
    """Cards cut with the slide bound lose pixels (the farther cards hold less than the uncut reference), the composite at rest is unchanged, and sliding any one card by up to MAX_SLIDE_PX columns either way shows exactly what the uncut cards show: nothing that was cut
    is ever revealed.  A card cut for a smaller slide fails the same check at the full slide, so the test can tell."""
    M = export.max_slide_px(WIN); assert M == 64
    full = _bake(OVERLAP, [6, 40], slide=None)['cards']; cut = _bake(OVERLAP, [6, 40], slide=M)['cards']; small = _bake(OVERLAP, [6, 40], slide=M // 4)['cards']
    n = lambda cs: [int((_canvas(c) > 0).sum()) for c in cs]; assert n(cut)[0] == n(full)[0] and n(cut)[1] < 0.9 * n(full)[1] and n(cut)[2] < 0.9 * n(full)[2], (n(full), n(cut))
    worst = 0.0; worst_small = 0.0
    for j in range(3):
        for sft in (0, -M, -M // 2, -1, 1, M // 2, M):
            sh = {j: sft}; r0, c0 = _over(full, sh); r1, c1 = _over(cut, sh); r2, c2 = _over(small, sh); worst = max(worst, float(np.abs(r0 - r1).max()), float(np.abs(c0 - c1).max())); worst_small = max(worst_small, float(np.abs(r0 - r2).max()))
    assert worst < 1e-5, ('a slide within the bound reveals what was cut', worst); assert worst_small > 0.05, 'a card cut for a quarter of the slide survives the full slide: the check cannot tell'
def test_the_slide_bound_is_in_the_manifest_and_follows_the_card_width():
    """max_slide_px is ceil(5% of the card width) in whole pixels (64 at 1280, 55 at 1100, 1 at 20) and the manifest says it."""
    assert [export.max_slide_px(w) for w in (1280, 1100, 20, 1)] == [64, 55, 1, 1]
    d = tempfile.mkdtemp()
    try:
        b = _bake(OVERLAP, [6, 40]); dest = export.write_bake(d, b['place'], b['view'], b['meta'], export.pack(b), b['opaque']); m = json.load(open(dest / 'manifest.json')); assert m['max_slide_px'] == 64 and m['w'] == WIN
    finally: shutil.rmtree(d)
def test_an_empty_card_is_refused_before_writing_naming_the_split():
    """A card with no rows (its splits leave it no terrain) stops pack with a message that names the splits, instead of dying inside the codec."""
    b = _bake(THREE, [6, 40]); b['cards'][1] = dict(top=0, alpha=np.zeros((0, WIN), np.float32), albedo=np.zeros((0, WIN, 3), np.float32), n_r=np.zeros((0, WIN), np.float32), n_t=np.zeros((0, WIN), np.float32), logd=np.zeros((0, WIN), np.float32))
    try: export.pack(b)
    except ValueError as e: assert 'card 1 is empty' in str(e) and '6 km' in str(e) and '40 km' in str(e), str(e)
    else: assert False, 'an empty card was packed'
    b['cards'][2] = b['cards'][1]
    try: export.pack(dict(b, cards=[b['cards'][0], _bake(THREE, [6, 40])['cards'][1], b['cards'][1]]))
    except ValueError as e: assert 'card 2 is empty' in str(e) and '40 km' in str(e), str(e)
    else: assert False, 'an empty last card was packed'

# ---------------------------------------------------------------------------------------- the written files are the cards
def test_written_cards_decode_to_the_cards_in_memory():
    """Vienna's three cards, written and decoded again: alpha exactly, albedo within the lossy codec (and straight, not premultiplied, at partial alpha), the normal channels in their order (R along the ray, G across it), and the log-distance over the encoding range, within quantisation."""
    saved = ridge.P
    try: b = export.bake_place('vienna')
    finally: ridge.P = saved
    d = tempfile.mkdtemp()
    try:
        dest = export.write_bake(d, b['place'], b['view'], b['meta'], export.pack(b), b['opaque']); m = json.load(open(dest / 'manifest.json')); enc = m['encoding']; span = enc['log_d_max'] - enc['log_d_min']; partial_seen = 0
        for c, rec in zip(b['cards'], m['cards']):
            col = export.decode((dest / rec['colour']['file']).read_bytes()); geo = export.decode((dest / rec['geometry']['file']).read_bytes()); al = c['alpha']; solid = al > 0; part = (al > 0.05) & (al < 0.95); partial_seen += int(part.sum())
            assert (col[..., 3] == np.rint(al * 255)).all(), 'alpha is not exact'; e = np.abs(col[..., :3] / 255.0 - c['albedo']).max(-1)
            assert e[solid].mean() < 0.02 and np.percentile(e[solid], 99) < 0.08, ('albedo is off', e[solid].mean(), np.percentile(e[solid], 99)); assert part.sum() == 0 or e[part].mean() < 0.1, ('albedo at partial alpha is off: premultiplied?', e[part].mean())
            assert (geo[..., 3] == 255).all(); q = 1.0 / 255 + 1e-6
            assert np.abs(geo[..., 0] / 255.0 * 2 - 1 - c['n_r'])[solid].max() < 2 * q and np.abs(geo[..., 1] / 255.0 * 2 - 1 - c['n_t'])[solid].max() < 2 * q, 'a normal channel is off or swapped'
            assert np.abs(enc['log_d_min'] + geo[..., 2] / 255.0 * span - c['logd'])[solid].max() < span * q, 'the log-distance is off or not over the encoding range'
            assert np.abs(c['n_r'][solid]).mean() > 0.05 and np.abs(c['n_t'][solid]).mean() > 0.01 and np.abs(c['n_r'][solid].mean() - c['n_t'][solid].mean()) > 0.0, 'the fixture does not tell the channels apart'
            assert col[..., :3][solid].mean() > 20, 'albedo is zeroed'
        assert partial_seen > 0, 'the fixture has no partial alpha'
    finally: shutil.rmtree(d)

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
        A, Hh = rays(hf); ridge.P.update(win0=0, eye_m=EYE); ridge.set_view(A.max(0)); aw = ridge.win(A); cov = ridge.coverage(D, aw); want = np.clip(np.minimum(aw.max(0), ridge.TOP_DEG) - ridge.BOTTOM_DEG, 0, None) * ridge.PXDEG_V
        assert np.abs(cov.sum(0) - want).max() < 1e-6, np.abs(cov.sum(0) - want).max(); assert cov.shape == (ridge.COV_BINS, WIN)
        if i == 0: assert (cov[0] > 100).all(), ('no foreground rows in the first bin', float(cov[0].min()))
def test_cards_interpolate_between_samples_and_renormalise():
    """On a ramp face every card pixel sits between two samples: its log-distance lies strictly between theirs (not on the nearer sample), and its normal is the normalised blend of theirs by that same fraction (the samples carry alternating normals, so a blend
    that is not renormalised, or a hit that is not interpolated, differs)."""
    A, Hh = rays(terrain(lambda dk, az: np.where(dk >= 4000, GROUND + 0.5 * (dk - 4000), 0.0) + 0 * az)); ridge.P.update(win0=0, eye_m=EYE); ridge.set_view(A.max(0)); aw, hw = ridge.win(A), ridge.win(Hh); k = np.arange(len(D))[:, None]
    nr = np.broadcast_to(np.where(k % 2 == 0, -0.8, 0.8), aw.shape).astype(float); nt = np.broadcast_to(np.where(k % 3 == 0, 0.3, -0.3), aw.shape).astype(float); nu = np.sqrt(1 - nr ** 2 - nt ** 2) * 0 + 0.5
    c = ridge.cards(D, aw, hw, np.zeros((0, WIN)), nrm=(nr, nt, nu), slide_px=None)[0]; x = 300; sel = np.flatnonzero(c['alpha'][:, x] > 0.999); ld = c['logd'][sel, x].astype(np.float64); L = np.log(D); kk = np.searchsorted(L, ld, 'left'); kp = kk - 1; ok = kp >= 0
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
