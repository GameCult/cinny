"""Mutation check: re-introduce a cause into a COPY of the baker, run the fixtures against it, and require that at least one fails.
  venv/bin/python tests/mutate.py          (prints one line per mutant; exit 1 if a mutant survives)"""
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
 'check_budget ignores the cropped bands (decoded as full frames)': ("decoded = sum(2 * w * h * 4 for h in bands)", "decoded = 0"),
 'load_preset accepts splits that do not increase': ("or any(b <= a for a, b in zip(sp, sp[1:]))", ""),
 'geometry: n_r and n_t channels swapped': ("dstack([u8((np.asarray(n_r) + 1) / 2), u8((np.asarray(n_t) + 1) / 2), u8(b)])", "dstack([u8((np.asarray(n_t) + 1) / 2), u8((np.asarray(n_r) + 1) / 2), u8(b)])"),
 'geometry: log-distance not normalised by the encoding range': ("b = (np.asarray(logd) - enc['log_d_min']) / (enc['log_d_max'] - enc['log_d_min'])", "b = np.asarray(logd) / 12.0"),
 'colour: albedo zeroed in the file': ("rgb = u8(albedo) * (a[..., None] > 0)", "rgb = u8(albedo) * 0"),
 'colour: premultiplied instead of straight': ("rgb = u8(albedo) * (a[..., None] > 0)", "rgb = u8(np.asarray(albedo) * np.asarray(alpha)[..., None])"),
 'seams: the separation between seams is ignored': ("SEAM_SEP = 0.4 ", "SEAM_SEP = 0.0 "),
 'elev: curvature and refraction dropped': ("drop = d * d / (2 * R_EARTH) * (1 - KREF) if curvature else 0.0", "drop = 0.0"),
 'coverage: the rows below the first sample are not counted': ("prev = np.vstack([np.full((1, a.shape[1]), BOTTOM_DEG), runmax[:-1]])", "prev = np.vstack([np.full((1, a.shape[1]), 100.0), runmax[:-1]])"),
 'coverage: the rows below the first sample are counted twice': ("* PXDEG_V)\n    return C", "* PXDEG_V); C[0] += np.clip(np.minimum(a[0], TOP_DEG) - BOTTOM_DEG, 0, None) * PXDEG_V\n    return C"),
 'cards: the hit is not interpolated between samples': ("t = np.where(idx > 0, np.clip((rowang - prev) / np.maximum(rm[idx] - prev, 1e-9), 0, 1), 1.0)", "t = np.ones_like(rowang)"),
 'cards: the blended normal is not renormalised': ("nz = np.sqrt(g[2] ** 2 + g[3] ** 2 + g[4] ** 2) + 1e-12", "nz = 1.0"),
 'cards: nothing is cut for the slide': ("if slide_px is not None and solid:", "if False:"),
 'cards: the cut ignores the slide width (erosion 0)': ("lost = _erode(cnt > 0, slide_px)", "lost = _erode(cnt > 0, 0)"),
 'cards: the cut ignores a single card sliding (one covering card is enough)': ("& ((cnt >= 2) | alone)", ""),
 'cards: the cut counts pixels the frame edge leaves unheld as held': ("ok = (lo >= 0) & (hi <= n)", "ok = np.ones(n, bool)"),
 'export: the slide bound is floored, not ceiled': ("-(-(w * SLIDE_PCT) // 100)", "(w * SLIDE_PCT) // 100"),
 'export: the manifest slide bound is zero': ("max_slide_px=max_slide_px(w), curvature", "max_slide_px=0, curvature"),
 'export: an empty card is not refused': ("if c['alpha'].shape[0] == 0: raise", "if False: raise"),
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
    with ThreadPoolExecutor(int(os.environ.get('MUTATE_JOBS', '6'))) as ex: res = list(ex.map(run, [(n, v) for n, v in MUTANTS.items() if n not in EQUIVALENT]))
    for line, _ in res: print(line, flush=True)
    for n, why in EQUIVALENT.items(): print('EQUIVALENT ' + n + ' -> ' + why)
    sys.exit(1 if any(sv for _, sv in res) else 0)
