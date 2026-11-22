"""Mutation check: re-introduce a cause into a COPY of the baker, run the fixtures against it, and require that at least one fails.
  venv/bin/python tests/mutate.py [word ...]   (prints one line per mutant whose name holds every word; exit 1 if a mutant survives)"""
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
 'wall: no row is flagged (the flag is dropped)': ("if i: Wl[i, :, x] = hit & (idx == 0)", "if i: Wl[i, :, x] = False"),
 'wall: card 0 is flagged too (its ground rows become wall)': ("if i: Wl[i, :, x] = hit & (idx == 0)", "Wl[i, :, x] = hit & (idx == 0)"),
 'wall: albedo takes the face normal, not the face up': ("np.where(Wl[i, sl], 1.0, g[4] / nz)", "g[4] / nz"),
 'wall: the code is not written to the geometry': ("if wall is not None: m = np.asarray(wall, bool)", "if False: m = np.asarray(wall, bool)"),
 'wall: the sheet lights wall rows with their normal': ("wall = c['wall']; n_r, n_t = np.where(wall, 0.0, c['n_r']), np.where(wall, 0.0, c['n_t'])", "n_r, n_t = c['n_r'], c['n_t']"),
 'ring: the seam DP is not periodic (the first lap is kept, not the middle)': ("return out[:, n:2 * n]", "return out[:, :n]"),
 'ring: the tile take does not wrap (the ring ends repeat their edge column)': ("return np.take(a, (c0 + np.arange(n)) % W, axis=-1)", "return np.take(a, np.clip(c0 + np.arange(n), 0, W - 1), axis=-1)"),
 'tile: the apron is shifted (a tile starts at its own first column)': ("ridge.ring_cols(x, t * TILE_W - APRON, TILE_W + 2 * APRON)", "ridge.ring_cols(x, t * TILE_W, TILE_W + 2 * APRON)"),
 'tile: the seams are cut from tile 0 for every tile': ("cols(sm, t), tuple(cols(x, t) for x in nrm)", "cols(sm, 0), tuple(cols(x, t) for x in nrm)"),
 'view: the vertical anchors read the first 72 degrees only (the old window)': ("sk = np.asarray(skyline); sky", "sk = np.asarray(skyline)[:1280]; sky"),
 'bake_id: card-major instead of tile-major': ("bake_id([(e['colour'], e['geometry']) for row in tiles for e in row if e])", "bake_id([(row[i]['colour'], row[i]['geometry']) for i in range(k) for row in tiles if row[i]])"),
 'write: the per-tile cover check is dropped': ("except ValueError as ex: raise ValueError(f'tile {t}: {ex}')", "except ValueError as ex: pass"),
 'write: the apron width is not checked': ("if c.shape[1] != w: raise", "if False: raise"),
 'budget: the tile cap is ignored': ("if b > TILE_BYTES_MAX: raise", "if False: raise"),
 'budget: the place cap is ignored': ("if sum(tile_bytes) > PLACE_BYTES_MAX: raise", "if False: raise"),
 'budget: the resident gate is ignored': ("if res > RESIDENT_BYTES_MAX: raise", "if False: raise"),
 'budget: the resident run does not wrap the ring': ("sum(per[(t + k) % TILES] for k in range(n))", "sum(per[t + k] for k in range(n) if t + k < TILES)"),
 'budget: the run length forgets the margin tiles': ("math.ceil(arc / TILE_DEG) + 1 + 4", "math.ceil(arc / TILE_DEG)"),
 'r_max: the camera sweeps forward only (phi = 0)': ("PHI_STEPS = 24 ", "PHI_STEPS = 1 "),
 'r_max: every card of a tile is fitted at the nearest card distance': ("fit_px(d, r, px_per_deg) for d in row", "fit_px(row[0] if row[0] is not None else d, r, px_per_deg) for d in row"),
 'r_max: not capped at half the nearest distance': ("cap = 0.5 * rmin", "cap = 5.0 * rmin"),
 'r_max: the resident gate is not part of the search': (" and resident_bytes(bands, run_tiles(r, rmin)) <= RESIDENT_BYTES_MAX\n", "\n"),
 'r_max: a bake below the floor is accepted': ("if r_max < R_MAX_FLOOR_M:", "if False:"),
 'pack: the distance counts wall rows': ("solid = (al >= 0.5) & ~wl; any_solid", "solid = (al >= 0.5); any_solid"),
 'pack: the distance reads the apron columns too': ("inner = slice(APRON, APRON + TILE_W)", "inner = slice(0, TILE_W + 2 * APRON)"),
 'sheet: the tile boundaries are not drawn': ("def bounds(img): img[:, mark] = 0.45 * img[:, mark] + 0.55 * red; return img", "def bounds(img): return img"),
 'export: an empty card is not refused': ("if all(tile[i]['alpha'].shape[0] == 0 for tile in bake['cards']): raise", "if False: raise"),
 'rays cache key ignores the refraction constant': ("R_EARTH, KREF, W, bool(detail)", "R_EARTH, W, bool(detail)"),
 'rays cache key ignores the eye elevation': ("round(float(P['eye_m']), 3), ", ""),
 'mosaic cache key ignores the tile list': ("sorted(tiles_for(p)), 3600", "3600"),
}
EQUIVALENT = {}        # mutant name -> one line on why it is behaviourally equivalent (reported, not run)
def run(item):
    name, (a, b) = item; d = tempfile.mkdtemp(); shutil.copytree(SRC, os.path.join(d, 'src'), ignore=shutil.ignore_patterns('tests', '__pycache__')); p = next(q for q in (os.path.join(d, 'src', f) for f in ('ridge.py', 'export.py')) if a in open(q).read()); s = open(p).read(); assert a in s, name
    open(p, 'w').write(s.replace(a, b))
    r = subprocess.run([sys.executable, os.path.join(HERE, 'test_ridge.py')], env=dict(os.environ, RIDGE_SRC=os.path.join(d, 'src')), capture_output=True, text=True); shutil.rmtree(d)
    fails = [l.split('|')[0].strip() for l in r.stdout.splitlines() if l.startswith('FAIL')]
    line = ('KILLED   ' if r.returncode else 'SURVIVED ') + name + ' -> ' + (', '.join(fails) or 'no fixture failed'); print(line, file=sys.stderr, flush=True)       # progress: a killed run keeps what finished
    return line, r.returncode == 0
if __name__ == '__main__':
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(int(os.environ.get('MUTATE_JOBS', '6'))) as ex: res = list(ex.map(run, [(n, v) for n, v in MUTANTS.items() if n not in EQUIVALENT and all(w in n for w in sys.argv[1:])]))
    for line, _ in res: print(line, flush=True)
    for n, why in EQUIVALENT.items(): print('EQUIVALENT ' + n + ' -> ' + why)
    sys.exit(1 if any(sv for _, sv in res) else 0)
