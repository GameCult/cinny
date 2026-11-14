"""Mutation check: re-introduce a cause into a COPY of the baker, run the fixtures against it, and require that at least one fails.
  venv/bin/python tests/mutate.py          (prints one line per mutant; exit 1 if a mutant survives)"""
import os, shutil, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); SRC = os.path.join(HERE, '..')
MUTANTS = {
 'round-1 bug: both chain sides take the END value (near_end always x1)': ("near_end = np.where(x - x1 <= W - x, x1, 0)", "near_end = np.where(x - x1 <= W - x, x1, x1)"),
 'linking does not wrap (look-back columns clipped at 0)': ("xb = (x - back) % Wc", "xb = max(x - back, 0)"),
 'a chain absent from a column still competes in the slot union (held valley value wins)': ("np.where(l['wt'] > 0, l['top'], -1e3 - col_gap(l['wt'] > 0))", "l['top']"),
 'shadow march goes AWAY from the sun': ("lat + s * ca / 111320.0, lon + s * sa", "lat - s * ca / 111320.0, lon - s * sa"),
 'shadow ignores the sun elevation (ray stays at the sample height)': ("(h + s * t)", "(h + 0 * t)"),
 'taper length ignores the drop (always the 8-column minimum)': ("Tn = taper_len(drop)", "Tn = np.full_like(drop, 8.0)"),
 'shadow march mirrors east/west (longitude sign)': ("lon + s * sa / (111320.0 * cosl)", "lon - s * sa / (111320.0 * cosl)"),
 'shadow longitude scale ignores cos(lat)': ("lon + s * sa / (111320.0 * cosl)", "lon + s * sa / 111320.0"),
 'shadow lightens instead of darkens the face': ("(gain - g_amb) * (1 - sp)[..., None]", "(gain - g_amb) * sp[..., None]"),
 'taper cap lowered to 8 columns': ("TAPER_K, TAPER_MAX = 30.0, 72", "TAPER_K, TAPER_MAX = 30.0, 8"),
 'taper per degree lowered to 2': ("TAPER_K, TAPER_MAX = 30.0, 72", "TAPER_K, TAPER_MAX = 2.0, 72"),
 'taper floor ignores the chain end (top held, no fall)': ("res['top'] = res['top'] - drop * t", "res['top'] = res['top']"),
 'painter shades one normal per column (the column mean of the per-pixel face)': ("sl, la = Ly['sl'], Ly['la']\n    Lr", "sl, la = np.broadcast_to(Ly['sl'].mean(0), Ly['sl'].shape), np.broadcast_to(Ly['la'].mean(0), Ly['la'].shape)\n    Lr"),
 'history collapsed to ONE slope per peak (the strip mean)': ("Z, Dp, sl = lerp(hh), lerp(hd), lerp(sn)", "Z, Dp, sl = lerp(hh), lerp(hd), np.broadcast_to(mean_s, Z.shape)"),
 'history not recorded: only valley and peak samples kept': ("return np.interp(t, va, vd), np.interp(t, va, vh)", "return np.interp(t, va[[0, -1]], vd[[0, -1]]), np.interp(t, va[[0, -1]], vh[[0, -1]])"),
 'no lateral tilt from the neighbouring columns': ("np.clip((c_ - a_ * sl) / b_, -1.5, 1.5))", "0 * np.clip((c_ - a_ * sl) / b_, -1.5, 1.5))"),
 'NEAR_CAP shoulder committed without the prominence test': ("if hh[j] - lowh >= prom: span(", "if True: span("),
 'prominence measured as an angle at the CURRENT sample (round 2)': ("if cand - v >= hy[k] and ch - lowh >= prom:", "if cand - v >= hy[k] and cand - mn >= hy[k]:"),
 'contour interval chosen from the shallowest quarter of the face (banding)': ("np.percentile(dzdpx[faceok], 75)", "np.percentile(dzdpx[faceok], 10)"),
 'a tapering end keeps the 28 px minimum body (stub / curtain at every chain end)': ("28 * np.clip(wt, 0, 1)", "28"),
 'absent columns of a slot take the first chain in list order (rotation-dependent)': ("np.where(l['wt'] > 0, l['top'], -1e3 - col_gap(l['wt'] > 0))", "np.where(l['wt'] > 0, l['top'], -1e9)"),
 'history keeps samples the eye cannot see (no running maximum)': ("runmax = np.maximum.accumulate(seg)", "runmax = seg"),
 'lateral tilt scale doubled': ("/ b_, -1.5, 1.5))", "/ b_ * 2, -1.5, 1.5))"),
 'lateral tilt kept across occlusion edges': ("np.abs(a_) > 3 * b_", "np.abs(a_) > 3e9 * b_"),
 'every foreground stub kept (round 2 arches)': ("if not cov[xs].any(): keep.append(c)", "if True: keep.append(c)"),
 'no foreground stub kept (holes in the nearest layer)': ("if not cov[xs].any(): keep.append(c)", "if False: keep.append(c)"),
 'prominence from the height of the lowest-angle sample (near, high valley)': ("if cand - v >= hy[k] and ch - lowh >= prom:", "if cand - v >= hy[k] and ch - mnh >= prom:"),
 'layer body painted to the bottom of the frame (no foot fade: walls)': ("alpha = (m * (1 - fade)).astype(np.float32)", "alpha = m.astype(np.float32)"),
 'relief: shading uses the real sun again (face flat with the sun behind the viewer)': ("L = relief_vec(st['az']); az", "L = st['L']; az"),
 'relief: 45 deg off the viewer-ward axis (the previous reading) instead of the view axis': ("ctr = win_centre_az(); side", "ctr = (win_centre_az() + 180.0) % 360.0; side"),
 'relief: always the + side, whatever side the real sun is on': ("side = 1.0 if math.sin(math.radians(sun_az - ctr)) >= 0 else -1.0", "side = 1.0"),
 'relief: colour / strength / haze frozen at a 40 deg sun (night does not go dark)': ("st = sun_state(az, el); shs", "st = sun_state(az, 40.0); shs"),
 'relief: cast shadows march toward the relief light instead of the real sun': ("cast_shadows(layers, az, el) if shadows", "cast_shadows(layers, math.degrees(math.atan2(relief_vec(az)[0], relief_vec(az)[1])) % 360.0, RELIEF_EL) if shadows"),

 'compositor (relight) reads the layer mask m instead of its alpha a (walls return)': ("img = img * (1 - Ly['a'][..., None]) + face * Ly['a'][..., None]", "img = img * (1 - Ly['m'][..., None]) + face * Ly['m'][..., None]"),
 'foot fade starts at 30% of the foot instead of 60%': ("(depthpx - 0.6) / 0.4", "(depthpx - 0.3) / 0.7"),
 'foot fade starts at 90% of the foot instead of 60%': ("(depthpx - 0.6) / 0.4", "(depthpx - 0.9) / 0.1"),
 'TAPER_MAX 72 -> 40': ("TAPER_K, TAPER_MAX = 30.0, 72", "TAPER_K, TAPER_MAX = 30.0, 40"),
 'RELIEF_EL 32 -> 3 (grazing relief light)': ("RELIEF_OFF_DEG, RELIEF_EL = 45.0, 32.0", "RELIEF_OFF_DEG, RELIEF_EL = 45.0, 3.0"),
 'spec half vector ignores the light': ("Hv = L[None, :] + np.stack(", "Hv = 0 * L[None, :] + np.stack("),
 'lateral tilt not blurred across columns': ("blurw(la, 2.0).astype", "la.astype"),
 'contour interval percentile includes the tapering columns (weight condition removed)': ("& (wt[None, :] > 0.5)", ""),
 'Fresnel sign flipped (rim strongest on faces standing at the viewer)': ("np.clip(1 - sl / nrm, 0, 1) ** 3", "np.clip(1 + sl / nrm, 0, 1) ** 3"),
 'rays cache key ignores the refraction constant': ("R_EARTH, KREF, W, bool(detail)", "R_EARTH, W, bool(detail)"),
 'rays cache key ignores the eye elevation': ("round(float(P['eye_m']), 3), ", ""),
 'mosaic cache key ignores the tile list': ("sorted(tiles_for(p)), 3600", "3600"),
}
EQUIVALENT = {}        # mutant name -> one line on why it is behaviourally equivalent (reported, not run)
def run(item):
    name, (a, b) = item; d = tempfile.mkdtemp(); shutil.copytree(SRC, os.path.join(d, 'src'), ignore=shutil.ignore_patterns('tests', '__pycache__')); p = os.path.join(d, 'src', 'ridge.py'); s = open(p).read(); assert a in s, name
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
