"""Mutation check: re-introduce a cause into a COPY of the baker, run the fixtures against it, and require that at least one fails.
  venv/bin/python tests/mutate.py [word ...]   (runs the unmutated copy first and exits 2 if a fixture fails; prints one line per mutant whose name holds every word; exit 1 if a mutant survives or only crashes the run: a kill is an AssertionError raised by the fixtures' own code)"""
import os, shutil, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); SRC = os.path.join(HERE, '..')
MUTANTS = {        # name -> (text in ridge.py or export.py, replacement)
 'seam cost: the rows a seam sweeps are not paid (it hops across a receding ridge)': ("np.cumsum(0.5 * (cov[:, x - 1] + cov[:, x])) + SEAM_LAM * bins", "SEAM_LAM * bins"),
 'seam prior pulls hard to the target (2.0, or 0.1: the seam hops across a ridge)': ("SEAM_PRIOR = 0.02 ", "SEAM_PRIOR = 2.0 "),
 'normals: the authored exaggeration is dropped': ("h = np.asarray(h, np.float64); E = PXDEG_V / HPX_DEG", "h = np.asarray(h, np.float64); E = 1.0"),
 'normals: the lateral neighbour is one sample nearer (not equal distance)': ("st = E * (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1))", "st = E * (np.roll(np.roll(h, -1, axis=1), 1, axis=0) - np.roll(h, 1, axis=1))"),
 'cards: the near edge is ignored (every card starts at sample 0)': ("k0 = 0 if i == 0 else int(ks0[i - 1][x])", "k0 = 0"),
 'cards: the farther card fades in over the window too (both cards translucent)': ("X[i, :, x] = 1 - s * s * (3 - 2 * s)", "X[i, :, x] = 1 - s * s * (3 - 2 * s); X[i + 1, :, x] = s * s * (3 - 2 * s)"),
 'cards: a crest row is all or nothing (no fractional coverage)': ("F[i, :, x] = np.where(hit, np.clip((rm[-1] - lo) / p, 0, 1), 0)", "F[i, :, x] = np.where(hit, 1.0, 0)"),
 'prefilter ignores sigma': ("if sigma_m > 0:", "if False:"),
 'prefilter across rays uses one sigma in columns (not per distance)': ("sc = sigma_m / (d * COLW)", "sc = sigma_m / (d[0] * COLW) * np.ones_like(d)"),
 'bake_id hashes geometry before colour': ("h.update(colour); h.update(geometry)", "h.update(geometry); h.update(colour)"),
 'check_cover accepts any composite': ("if bad.any(): y, x", "if False: y, x"),
 'load_preset accepts splits that do not increase': ("or any(b <= a for a, b in zip(sp, sp[1:]))", ""),
 'geometry: n_r and n_t channels swapped': ("r, t = u8((np.asarray(n_r) + 1) / 2), u8((np.asarray(n_t) + 1) / 2)", "r, t = u8((np.asarray(n_t) + 1) / 2), u8((np.asarray(n_r) + 1) / 2)"),
 'geometry: log-distance not normalised by the encoding range': ("b = (np.asarray(logd) - enc['log_d_min']) / (enc['log_d_max'] - enc['log_d_min'])", "b = np.asarray(logd) / 12.0"),
 'colour: albedo zeroed in the file': ("rgb = u8(albedo) * (a[..., None] > 0)", "rgb = u8(albedo) * 0"),
 'colour: premultiplied instead of straight': ("rgb = u8(albedo) * (a[..., None] > 0)", "rgb = u8(np.asarray(albedo) * np.asarray(alpha)[..., None])"),
 'seams: the separation between seams is ignored': ("SEAM_SEP = 0.4 ", "SEAM_SEP = 0.0 "),
 'elev: curvature and refraction dropped': ("drop = d * d / (2 * R_EARTH) * (1 - KREF) if curvature else 0.0", "drop = 0.0"),
 'coverage: the rows below the first sample are not counted': ("prev = np.vstack([np.full((1, a.shape[1]), BOTTOM_DEG), runmax[:-1]])", "prev = np.vstack([np.full((1, a.shape[1]), 100.0), runmax[:-1]])"),
 'coverage: the rows below the first sample are counted twice': ("* PXDEG_V)\n    return C", "* PXDEG_V); C[0] += np.clip(np.minimum(a[0], TOP_DEG) - BOTTOM_DEG, 0, None) * PXDEG_V\n    return C"),
 'cards: the hit is not interpolated between samples': ("t = np.where(idx > 0, np.clip((rowang - prev) / np.maximum(rm[idx] - prev, 1e-9), 0, 1), 1.0)", "t = np.ones_like(rowang)"),
 'cards: the blended normal is not renormalised': ("nz = np.sqrt(g[2] ** 2 + g[3] ** 2 + g[4] ** 2) + 1e-12", "nz = 1.0"),
 'wall: no row is flagged (the flag is dropped)': ("Wl[i, :, x] = hit & (idx == 0)", "Wl[i, :, x] = False"),
 'near: the cap to the silhouette of the terrain at the clip is dropped': ("an = np.minimum(an, a[0][None, :])", "an = an"),
 'near: rows under the clip are flagged wall': ("Wl[i, :, x] = hit & (idx == 0); Nr[i, :, x] = hit & (kp < kn)", "Wl[i, :, x] = hit & ((idx == 0) | (kp < kn)); Nr[i, :, x] = hit & (kp < kn)"),
 'near: albedo takes the face up (the wall rule on near rows)': ("albedo(g[1], np.where(Wl[i, sl], 1.0, g[4] / nz), material)", "albedo(g[1], np.where(Wl[i, sl] | Nr[i, sl], 1.0, g[4] / nz), material)"),
 'near: albedo reads the height of the far march first sample': ("albedo(g[1], np.where(Wl[i, sl]", "albedo(np.where(Nr[i, sl], h[int(np.searchsorted(d, NEAR_CLIP_M))][None, :], g[1]), np.where(Wl[i, sl]"),
 'near: the march starts at 20 m': ("NEAR_START_M = 1.0 ", "NEAR_START_M = 20.0 "),
 'near: the heights are stored float32': (", np.float64) for dk in d])", ", np.float32) for dk in d])"),
 'near: the place prefilter is not applied': ("; a, h = prefilter(d, h, sigma_m)\n", "; a, h = prefilter(d, h, 0.0)\n"),
 'near: the far normals are computed over the joined march (not apart)': ("nn, nf = normals(dn, hn), normals(d, h)", "nj_ = normals(np.concatenate([dn, d]), np.concatenate([hn, h])); nn, nf = tuple(x[:len(dn)] for x in nj_), tuple(x[len(dn):] for x in nj_)"),
 'near: cards accepts a march that starts at the clip': ("if d[0] >= NEAR_CLIP_M: raise Refusal", "if False: raise Refusal"),
 'pack: near pixels count as solid terrain': ("solid = (al >= 0.5) & ~wl & ~nr;", "solid = (al >= 0.5) & ~wl;"),
 'pack: the non-wall fallback pool reads near pixels': ("((al > 0) & ~wl & ~nr, ld)", "((al > 0) & ~wl, ld)"),
 'pack: the lit fallback pool reads near pixels': ("((al > 0) & ~nr, ld)", "(al > 0, ld)"),
 'pack: the apron fallback pool reads near pixels': ("((c['alpha'] > 0) & ~c['near'], c['logd'])", "(c['alpha'] > 0, c['logd'])"),
 'pack: a tile with nothing outside the near ground is not at the clip': ("if pool else ridge.NEAR_CLIP_M", "if pool else 0.0"),
 'r_max: the tile median binds, not the nearest terrain': ("r_max = solve_r_max(near, bands, ppd); r_fwd = solve_r_max(near, bands, ppd, phis=1)", "r_max = solve_r_max(dist, bands, ppd); r_fwd = solve_r_max(dist, bands, ppd, phis=1)"),
 'r_max: near pixels do not bind at the clip': ("ridge.NEAR_CLIP_M if ((al >= 0.5) & nr).any() else None", "None"),
 'r_max: near pixels bind only in a tile with no other solid pixel': ("ridge.NEAR_CLIP_M if ((al >= 0.5) & nr).any() else None", "ridge.NEAR_CLIP_M if ((al >= 0.5) & nr).any() and not solid.any() else None"),
 'r_max: near pixels bind only where they outnumber the solid ones': ("ridge.NEAR_CLIP_M if ((al >= 0.5) & nr).any() else None", "ridge.NEAR_CLIP_M if ((al >= 0.5) & nr).sum() > solid.sum() else None"),
 'r_max: the nearest pixel is the farthest solid one': ("float(np.exp(ld[solid].min())) if solid.any() else None, ridge", "float(np.exp(ld[solid].max())) if solid.any() else None, ridge"),
 'near clip: the writer compares the float32 distance strictly': ("if rmin < ridge.NEAR_CLIP_M * (1 - 1e-5): raise", "if rmin < ridge.NEAR_CLIP_M: raise"),
 'near clip: the march starts nearer than the clip': ("d = [NEAR_CLIP_M]", "d = [100.0]"),
 'near clip: a card 0 inside the clip is accepted by the writer': ("if rmin < ridge.NEAR_CLIP_M * (1 - 1e-5): raise", "if False: raise"),
 'view: the 1x floor is back': ("lo, hi = E_MIN * HPX_DEG, 10 * HPX_DEG", "lo, hi = HPX_DEG, 10 * HPX_DEG"),
 'view: the horizon anchor is dropped (the scale is the skyline fit alone)': ("ppd = float(np.clip(min(fit, hold), lo, hi))", "ppd = float(np.clip(fit, lo, hi))"),
 'view: a skyline that cannot hold the ground rows is not refused': ("if hold < lo: raise", "if False: raise"),
 'view: the ground rows are not asked for (GROUND_ROWS_MIN 0)': ("GROUND_ROWS_MIN = 150 ", "GROUND_ROWS_MIN = 0 "),
 'validate_manifest: a plane short of its ground rows is accepted': ("if v['plane_h'] - v['horizon_row'] < ridge.GROUND_ROWS_MIN - 1e-6: raise", "if False: raise"),
 'wall: albedo takes the face normal, not the face up': ("np.where(Wl[i, sl], 1.0, g[4] / nz)", "g[4] / nz"),
 'wall: the code is not written to the geometry': ("if wall is not None: m = np.asarray(wall, bool)", "if False: m = np.asarray(wall, bool)"),
 'wall: the sheet lights wall rows with their normal': ("wall = c['wall']; n_r, n_t = np.where(wall, 0.0, c['n_r']), np.where(wall, 0.0, c['n_t'])", "n_r, n_t = c['n_r'], c['n_t']"),
 'ring: the seam DP is not periodic (the first lap is kept, not the middle)': ("return out[:, n:2 * n]", "return out[:, :n]"),
 'ring: the tile take does not wrap (the ring ends repeat their edge column)': ("return np.take(a, (c0 + np.arange(n)) % W, axis=-1)", "return np.take(a, np.clip(c0 + np.arange(n), 0, W - 1), axis=-1)"),
 'tile: the apron is shifted (a tile starts at its own first column)': ("ridge.ring_cols(x, t * TILE_W - APRON, TILE_W + 2 * APRON)", "ridge.ring_cols(x, t * TILE_W, TILE_W + 2 * APRON)"),
 'tile: the seams are cut from tile 0 for every tile': ("cols(sm, t), tuple(cols(x, t) for x in nrm)", "cols(sm, 0), tuple(cols(x, t) for x in nrm)"),
 'view: the vertical anchors read the first 72 degrees only (the old window)': ("sk = np.asarray(skyline); sky", "sk = np.asarray(skyline)[:1280]; sky"),
 'bake_id: card-major instead of tile-major': ("bake_id(text, [(e['colour'], e['geometry']) for row in tiles for e in row if e])", "bake_id(text, [(row[i]['colour'], row[i]['geometry']) for i in range(k) for row in tiles if row[i]])"),
 'bake_id: the manifest is not hashed (a manifest moves under its id)': ("h = hashlib.sha256(); h.update(manifest_text.encode('utf-8'))", "h = hashlib.sha256()"),
 'bake_id: the manifest is hashed with the id already in it (the blank is skipped)': ("bid = bake_id(text, [", "bid = bake_id(text.replace(BAKE_ID_BLANK, '111111111111'), ["),
 'write: the per-tile cover check is dropped': ("except Refusal as ex: raise Refusal(f'tile {t}: {ex}')", "except Refusal as ex: pass"),
 'write: the apron width is not checked': ("if c.shape[1] != w: raise", "if False: raise"),
 'budget: the tile cap is ignored': ("if b > TILE_BYTES_MAX: raise", "if False: raise"),
 'budget: the place cap is ignored': ("if sum(tile_bytes) > PLACE_BYTES_MAX: raise", "if False: raise"),
 'budget: the resident gate is ignored': ("if res > RESIDENT_BYTES_MAX: raise", "if False: raise"),
 'budget: the resident run does not wrap the ring': ("sum(per[(t + k) % TILES] for k in range(n))", "sum(per[t + k] for k in range(n) if t + k < TILES)"),
 'budget: the run length forgets the margin tiles': ("math.ceil(arc / TILE_DEG) + 1 + 4", "math.ceil(arc / TILE_DEG)"),
 'r_max: the camera sweeps forward only (phi = 0)': ("PHI_STEPS = 24 ", "PHI_STEPS = 1 "),
 'r_max: every card of a tile is fitted at the nearest card distance': ("fit_px(d, r, px_per_deg, phis) for d in row", "fit_px(row[0] if row[0] is not None else d, r, px_per_deg, phis) for d in row"),
 'r_max_forward: the forward offset is searched over the whole circle': ("r_fwd = solve_r_max(near, bands, ppd, phis=1)", "r_fwd = solve_r_max(near, bands, ppd)"),
 'r_max_forward: the resident gate is not checked at the forward offset': ("for r in (camera['r_max_m'], camera['r_max_forward_m']): check_budget", "for r in (camera['r_max_m'],): check_budget"),
 'r_max_forward: a forward offset below r_max_m is accepted': ("if camera['r_max_forward_m'] < camera['r_max_m']: raise", "if False: raise"),
 'fit: the line is the least squares of 33 uniform samples, as the first gate drew it': ("x, w = np.polynomial.legendre.leggauss(FIT_QUAD)", "x = np.linspace(-1, 1, 33); w = np.full(33, 2 / 33)"),
 'fit: the line is a two-node quadrature': ("FIT_QUAD = 48 ", "FIT_QUAD = 2 "),
 'write: the manifest is written as platform text (CRLF on Windows)': ("(tmp / 'manifest.json').write_bytes(text.encode('utf-8'))", "(tmp / 'manifest.json').write_text(text)"),
 'write: the index is written as platform text (CRLF on Windows)': ("(out / '.index.tmp').write_bytes((json.dumps(idx, indent=1) + '\\n').encode('utf-8'))", "(out / '.index.tmp').write_text(json.dumps(idx, indent=1) + '\\n')"),
 'r_max: not capped at half the nearest distance': ("cap = 0.5 * rmin", "cap = 5.0 * rmin"),
 'r_max: the resident gate is not part of the search': (" and resident_bytes(bands, run_tiles(r, rmin)) <= RESIDENT_BYTES_MAX\n", "\n"),
 'r_max: a bake below the floor is accepted': ("if r_max < R_MAX_FLOOR_M:", "if False:"),
 'pack: the distance counts wall rows': ("solid = (al >= 0.5) & ~wl & ~nr; any_solid", "solid = (al >= 0.5) & ~nr; any_solid"),
 'pack: the distance reads the apron columns too': ("inner = slice(APRON, APRON + TILE_W)", "inner = slice(0, TILE_W + 2 * APRON)"),
 'sheet: the tile boundaries are not drawn': ("def bounds(img): img[:, mark] = 0.45 * img[:, mark] + 0.55 * red; return img", "def bounds(img): return img"),
 'export: an empty card is not refused': ("if all(tile[i]['alpha'].shape[0] == 0 for tile in bake['cards']): raise", "if False: raise"),
 'material: a null steep override still paints steep faces rock grey (strata do not hold on cliffs)': ("if material['steep']: c = c + (np.asarray(material['steep']['colour'])", "if True: c = c + (np.asarray((material['steep'] or dict(colour=[0.47, 0.44, 0.41]))['colour'])"),
 'material: the ramps apply in reverse order': ("for r in material['ramps']:", "for r in reversed(material['ramps']):"),
 'material: a null snow still snows': ("sn = material['snow']", "sn = material['snow'] or dict(from_m=1900, to_m=2300, colour=[0.93, 0.95, 0.97])"),
 'material: an unknown name falls back to alpine': ("if name not in tab: raise Refusal(", "if name not in tab: name = 'alpine'; ("),
 'material: the cards take the alpine colours whatever the place names': ("ridge.cards(D, cols(A, t), cols(Hc, t), cols(sm, t), tuple(cols(x, t) for x in nrm), material=material)", "ridge.cards(D, cols(A, t), cols(Hc, t), cols(sm, t), tuple(cols(x, t) for x in nrm), material=ridge.load_material('alpine'))"),
 'rays cache key ignores the refraction constant': ("R_EARTH, KREF, W, bool(detail)", "R_EARTH, W, bool(detail)"),
 'rays cache key ignores the eye elevation': ("round(float(P['eye_m']), 3), ", ""),
 'mosaic cache key ignores the tile list': ("sorted(tiles_for(p)), 3600", "3600"),
}
EQUIVALENT = {'fit: the error is looked for between four points': "the worst error of the best line is at the viewport's two ends for every distance and offset the bound is searched over (checked against a 20001-sample brute force in test_fit_px_is_the_continuous_error); the grid only guards a shape where it is not"}        # mutant name -> one line on why it is behaviourally equivalent (reported, not run)
def execute(edit):
    """Run the fixtures on a COPY of the baker, with edit = (text, replacement) applied or None for the unmutated copy: (returncode or None if the text is gone, [(fixture, exception class, directory of the innermost traceback frame)] of every FAIL line, last stderr line)."""
    d = tempfile.mkdtemp(); shutil.copytree(SRC, os.path.join(d, 'src'), ignore=shutil.ignore_patterns('tests', '__pycache__'))
    try:
        if edit:
            a, b = edit; p = next((q for q in (os.path.join(d, 'src', f) for f in ('ridge.py', 'export.py')) if a in open(q).read()), None)
            if p is None: return None, [], 'the mutant text is in neither ridge.py nor export.py'
            s = open(p).read(); open(p, 'w').write(s.replace(a, b))
        r = subprocess.run([sys.executable, os.path.join(HERE, 'test_ridge.py')], env=dict(os.environ, RIDGE_SRC=os.path.join(d, 'src')), capture_output=True, text=True)
    finally: shutil.rmtree(d)
    fails = [(f[0][4:].strip(), f[1].strip(), os.path.dirname(os.path.abspath(f[2].strip()))) for f in (l.split(' | ', 3) for l in r.stdout.splitlines() if l.startswith('FAIL')) if len(f) == 4]
    return r.returncode, fails, (r.stderr.strip().splitlines() or ['no output'])[-1][:200]
def run(item):
    """KILLED: at least one fixture failed on an assertion the test code itself raised (an AssertionError whose innermost traceback frame lies in the tests directory).  CRASHED: the run failed but no fixture did that (every FAIL is another exception, NameError or a numpy error and the like, or an assert inside the baker, or none printed, or the mutant text is gone), which proves nothing and fails the run.  SURVIVED: every fixture passed."""
    name, (a, b) = item; rc, fails, err = execute((a, b)); asserts = [n for n, c, w in fails if c == 'AssertionError' and w == HERE]
    state = 'CRASHED  ' if rc is None or (rc and not asserts) else 'KILLED   ' if rc else 'SURVIVED '
    why = ', '.join(f'{n}[{c}{"" if w == HERE else " in " + os.path.basename(w)}]' for n, c, w in fails) if fails else err
    line = state + name + ' -> ' + why; print(line, file=sys.stderr, flush=True)       # progress: a killed run keeps what finished
    return line, state != 'KILLED   '
def baseline():
    """The unmutated copy must pass every fixture before any mutant means anything: a broken environment would kill them all."""
    rc, fails, err = execute(None)
    if rc or fails: print('BASELINE FAILED: the unmutated baker does not pass its fixtures: ' + (', '.join(f'{n}[{c}]' for n, c, w in fails) or err), file=sys.stderr, flush=True); sys.exit(2)
    print('BASELINE ok: the unmutated copy passes every fixture', file=sys.stderr, flush=True)
if __name__ == '__main__':
    from concurrent.futures import ThreadPoolExecutor
    baseline()
    with ThreadPoolExecutor(int(os.environ.get('MUTATE_JOBS', '6'))) as ex: res = list(ex.map(run, [(n, v) for n, v in MUTANTS.items() if n not in EQUIVALENT and all(w in n for w in sys.argv[1:])]))
    for line, _ in res: print(line, flush=True)
    for n, why in EQUIVALENT.items(): print('EQUIVALENT ' + n + ' -> ' + why)
    sys.exit(1 if any(sv for _, sv in res) else 0)
