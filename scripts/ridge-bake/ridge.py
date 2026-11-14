"""Round-2 baker: A's painter baked from D's sweep, driven by a place preset from places.json (ray sampling, the round-1 recommendation).
Offline baker for the ridge backdrop (scripts/ridge-bake); export.py drives it.

  load_preset(id) -> configure()  : observer, tiles, mosaic origin, ring radius, window azimuth, painter constants from places.json
  stage0(detail)                   : ray march of all 6400 azimuth columns (curvature+refraction), optional authored sub-DEM foreground detail, cached
  sweep()                          : D's per-column scan -> spans (with own height/run = per-peak slope) -> wrapped chains -> 7-knot layer cap
  set_view(slots)                  : authored Y mapping: angle -> row, ground plane at the bottom (see set_view)
  bake(slots)                      : sun-independent per-layer arrays
  relight(layers, az, el)          : shading + atmosphere + floor + sky
Vertical exaggeration is AUTHORED and derived per view by set_view (printed on the page)."""
import sys, time, math, json
import os, hashlib
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np, tifffile

def _env_dir(name, what):
    v = os.environ.get(name)
    if not v: raise RuntimeError(f"{name} is not set: it must name {what} (no default location is assumed)")
    return Path(v)
B = _env_dir('RIDGE_WORK', 'the work directory (the mosaic / ray caches)')
COP = _env_dir('RIDGE_TILES', 'the directory of Copernicus GLO-30 tiles (Copernicus_DSM_COG_10_*_DEM.tif)')
W = 6400                               # ring columns: 360 deg at 17.78 px/deg
WIN = 1280                             # window = 72 deg of the ring
HPX_DEG = W / 360.0
H = 600                                # frame rows
COLW = math.radians(360.0 / W)
R_EARTH, KREF = 6371000.0, 0.13
PROM_M, NEAR_CAP, MINW, LINK_D, LINK_A, LOOK = 25.0, 4000.0, 50, 0.45, 0.25, 4
FOREGROUND_M = 5000.0               # a chain nearer than this that is narrower than MINW is kept only where no kept foreground chain covers its columns (the nearest layer must cover every column; a lone stub beside a long near ridge is an arch)
TAPER = 8                              # minimum columns over which a chain end dies into its valley (D's 8; round 1 used a fixed 20 AND borrowed the far end's value: the spike)
TAPER_K, TAPER_MAX = 30.0, 72          # a taller end falls over more columns: ceil(30 columns per degree of drop), 8..72: at the authored 1.5-4x exaggeration an end leaves the ridge at about 45 deg or less, not a wall
def taper_len(drop_deg): return np.clip(np.ceil(np.asarray(drop_deg) * TAPER_K), TAPER, TAPER_MAX)
KNOTS = np.array([80, 48, 28, 16, 9, 5, 2.5]) * 1000.0
_r5 = ('#a9b9d3', '#8e9fc2', '#6f86a6', '#556f7d', '#3f5546')
def hx(h): return np.array([int(h[i:i+2], 16) for i in (1, 3, 5)]) / 255.0
def mix(a, b, t): return a + (b - a) * np.asarray(t)[..., None]
RAMP = [mix(hx(_r5[min(int(t), 3)]), hx(_r5[min(int(t), 3) + 1]), t - min(int(t), 3)) for t in np.linspace(0, 4, len(KNOTS))]
GROUND = hx('#4a5f45'); CONTOUR_NICE = (30.0, 50.0, 100.0, 150.0, 200.0, 300.0, 500.0, 1000.0); CONTOUR_MIN_PX = 9.0   # iso-height interval is the smallest nice value that keeps lines >= 9 px apart (p10 of the layer)
ROT = 0                                # test hook: frame rotated by ROT columns; noise/azimuth stay tied to the absolute column

P = {}                                 # configured preset
rowang = np.zeros(H); PXDEG_V = 100.0; TOP_DEG = 2.6; BOTTOM_DEG = -3.4; Hc = H

def load_preset(pid, path=Path(__file__).resolve().parent / 'places.json'):
    d = json.load(open(path)); p = next(x for x in d['presets'] if x['id'] == pid); p = dict(p); p['date'] = d['date']; return p

# ====================================================================== configuration, DEM
def tiles_for(p):
    lat, lon, r = p['lat'], p['lon'], p['rmax_km']; dl = r / 111.32; dn = r / (111.32 * math.cos(math.radians(lat))); out = []
    for la in range(math.floor(lat - dl), math.floor(lat + dl) + 1):
        for lo in range(math.floor(lon - dn), math.floor(lon + dn) + 1):
            cy = min(max(lat, la), la + 1); cx = min(max(lon, lo), lo + 1)
            if math.hypot((cy - lat) * 111.32, (cx - lon) * 111.32 * math.cos(math.radians(lat))) <= r: out.append((la, lo))
    return out
def tile_path(la, lo): return COP / f"Copernicus_DSM_COG_10_{'N' if la >= 0 else 'S'}{abs(la):02d}_00_{'E' if lo >= 0 else 'W'}{abs(lo):03d}_00_DEM.tif"

def cache_key(*parts):
    """Short digest of everything a cached array was computed from.  A cache file is read only under the key of its own inputs, so a changed preset field, tile list or baker constant never meets a stale file."""
    h = hashlib.sha256()
    for q in parts: h.update(q.tobytes() if isinstance(q, np.ndarray) else repr(q).encode()); h.update(b'|')
    return h.hexdigest()[:12]
def mosaic_key(p): return cache_key('mosaic.v1', sorted(tiles_for(p)), 3600)

_mos = {}
def mosaic(p):
    """Tile grid covering the circle (bounding rows/cols), cached as .npy per preset.  Missing tiles (open sea has no GLO-30 tile) are zero."""
    key = (p['id'], mosaic_key(p))
    if key in _mos: return _mos[key]
    ts = tiles_for(p); las = [t[0] for t in ts]; los = [t[1] for t in ts]; lat_top = max(las) + 1; lon_left = min(los)
    c = B / f"mosaic-{p['id']}-{key[1]}.npy"
    if c.exists(): m = np.load(c, mmap_mode='r')
    else:
        rows = []
        for la in range(max(las), min(las) - 1, -1):
            rows.append(np.concatenate([tifffile.imread(tile_path(la, lo)) if tile_path(la, lo).exists() else np.zeros((3600, 3600), np.float32) for lo in range(min(los), max(los) + 1)], axis=1))
        m = np.concatenate(rows, axis=0).astype(np.float32); np.save(c, m)
    _mos[key] = (m, lat_top, lon_left); return _mos[key]

def bil(a, lat_top, lon_left, lat, lon):
    y = (lat_top - lat) * 3600 - 0.5; x = (lon - lon_left) * 3600 - 0.5
    y0 = np.clip(np.floor(y).astype(int), 0, a.shape[0] - 2); x0 = np.clip(np.floor(x).astype(int), 0, a.shape[1] - 2)
    fy = np.clip(y - y0, 0, 1); fx = np.clip(x - x0, 0, 1)
    return (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x0 + 1] * fx * (1 - fy) + a[y0 + 1, x0] * (1 - fx) * fy + a[y0 + 1, x0 + 1] * fx * fy)

def configure(p):
    """Set the module state for a preset: observer, eye elevation (DEM ground + eye height, or ground_override), window azimuth."""
    global P
    P = p; m, lt, ll = mosaic(p)
    ground = p['ground_override_m'] if 'ground_override_m' in p else float(bil(m, lt, ll, np.array(p['lat']), np.array(p['lon'])))
    P['ground_m'] = ground; P['eye_m'] = ground + p['eye_h_m']
    if 'look_at' in p:
        la, lo = p['look_at']; P['az_center'] = (math.degrees(math.atan2((lo - p['lon']) * math.cos(math.radians(p['lat'])), la - p['lat'])) + 360) % 360
    else: P['az_center'] = p['az_deg']
    P['win0'] = int(round(P['az_center'] / 360 * W - WIN / 2)) % W
    return P

def win(img): return np.take(img, (P['win0'] + np.arange(WIN)) % W, axis=1)

# ====================================================================== authored sub-DEM foreground detail (Aetheria / CultMath ridged multifractal)
def _frac(v): return v - np.floor(v)
def _hash2(x, y): return _frac(np.sin(x * 127.1 + y * 311.7) * 43758.5453)          # cultmath_hash(vec2), as Ratatoskr noise.ts
def _vnoise2(x, y):                                                                  # cultmath_value_noise: 4 hashed corners, smoothstep blend
    cx, cy = np.floor(x), np.floor(y); u = x - cx; v = y - cy; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v)
    a, b, c, d = _hash2(cx, cy), _hash2(cx + 1, cy), _hash2(cx, cy + 1), _hash2(cx + 1, cy + 1)
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v
LACUN, WEIGHT_GAIN, AMP_GAIN, CRAG = 2.07, 2.0, 0.5, 0.5                            # ridgeWorld.ts constants
DETAIL = dict(cell_m=60.0, octaves=4, amp_m=24.0, fade_from_m=500.0, fade_to_m=4000.0, seed=17)
def detail_height(E, N, dist):
    """Ridged multifractal (ridgeWorld.ts `profile`, folded value noise weighted by the previous octave) in WORLD metres (east, north of the observer),
    so it is automatically periodic around the ring.  First octave wavelength = 60 m = two GLO-30 cells (nothing coarser than the DEM can resolve is
    touched), then x2.07.  Amplitude fades to zero between fade_from and fade_to metres of distance.  Seeded, deterministic, authored."""
    cfg = DETAIL; e = 0.03 + (1 - CRAG) * 0.4; top = math.sqrt(1 + e * e); s = 0.0; nrm = 0.0; amp = 1.0; f = 1.0 / cfg['cell_m']; w = 1.0
    for k in range(cfg['octaves']):
        v = 2 * _vnoise2(E * f + cfg['seed'] * 7.31, N * f + cfg['seed'] * 3.17 + k * 13) - 1
        sig = (1 - np.sqrt(v * v + e * e) / top) ** 2 * w; w = np.minimum(1.0, sig * WEIGHT_GAIN); s = s + sig * amp; nrm += amp; amp *= AMP_GAIN; f *= LACUN
    t = np.clip((dist - cfg['fade_from_m']) / (cfg['fade_to_m'] - cfg['fade_from_m']), 0, 1); fade = 1 - t * t * (3 - 2 * t)
    return cfg['amp_m'] * fade * (s / nrm - 0.3)

# ====================================================================== stage 0: march
def schedule(detail):
    d = [500.0]
    while d[-1] < P['rmax_km'] * 1000:
        d.append(d[-1] + min(250.0, max(10.0 if detail else 40.0, 0.004 * d[-1])))
    return np.array(d)

def march(detail=False, curvature=True):
    m, lt, ll = mosaic(P); az = np.radians((np.arange(W) + 0.5) / W * 360.0); d = schedule(detail); cosl = math.cos(math.radians(P['lat']))
    A = np.zeros((len(d), W), np.float32); Hh = np.zeros_like(A); sa, ca = np.sin(az), np.cos(az)
    for k, dk in enumerate(d):
        lat = P['lat'] + dk * ca / 111320.0; lon = P['lon'] + dk * sa / (111320.0 * cosl)
        h = bil(m, lt, ll, lat, lon)
        if detail and dk < DETAIL['fade_to_m']: h = h + detail_height(dk * sa, dk * ca, dk)
        drop = dk * dk / (2 * R_EARTH) * (1 - KREF) if curvature else 0.0
        A[k] = np.degrees(np.arctan2(h - P['eye_m'] - drop, dk)); Hh[k] = h
    return d, A, Hh

def rays_key(detail):
    """Inputs of the ray march: observer, eye elevation, range, the DEM mosaic, the sample schedule (hashed as the array it produces), the Earth / refraction constants, the ring width, and (detail) the foreground detail noise."""
    return cache_key('rays.v1', P['lat'], P['lon'], P['rmax_km'], round(float(P['eye_m']), 3), mosaic_key(P), schedule(detail), R_EARTH, KREF, W, bool(detail),
                     (sorted(DETAIL.items()), LACUN, WEIGHT_GAIN, AMP_GAIN, CRAG) if detail else None)
def stage0(detail=False, force=False):
    c = B / f"rays-{P['id']}{'-detail' if detail else ''}-{rays_key(detail)}.npz"
    if c.exists() and not force:
        z = np.load(c); return z['d'], z['ang'], z['h'], None
    t0 = time.time(); mosaic(P); t1 = time.time(); d, A, Hh = march(detail); t2 = time.time(); np.savez(c, d=d, ang=A, h=Hh)
    return d, A, Hh, dict(mosaic=t1 - t0, march=t2 - t1, samples=len(d))

# ====================================================================== periodic helpers
def blurw(a, s):
    r = int(3 * s) + 1; k = np.exp(-0.5 * (np.arange(-r, r + 1) / s) ** 2); k /= k.sum()
    a = np.asarray(a, np.float64); xp = np.concatenate([a[..., -r:], a, a[..., :r]], axis=-1); o = np.zeros_like(a)
    for i, kv in enumerate(k): o += kv * xp[..., i:i + a.shape[-1]]
    return o
def gradw(a): return (np.roll(a, -1) - np.roll(a, 1)) / 2.0
def _smooth(f): return f * f * (3 - 2 * f)
def pn2(cell, seed):
    rng = np.random.default_rng(seed); n = max(int(round(W / cell)), 2); gh = int(H / cell) + 3
    g = rng.random((gh, n)).astype(np.float32)
    xs = ((np.arange(W) + ROT) % W) * (n / W); x0 = xs.astype(int); fx = _smooth(xs - x0).astype(np.float32); x1 = (x0 + 1) % n
    ys = np.arange(H) / cell; y0 = ys.astype(int); fy = _smooth(ys - y0).astype(np.float32)
    tp = g[y0][:, x0] * (1 - fx) + g[y0][:, x1] * fx; bt = g[y0 + 1][:, x0] * (1 - fx) + g[y0 + 1][:, x1] * fx
    return tp * (1 - fy)[:, None] + bt * fy[:, None]
def pn1(cell, seed): return pn2(cell, seed)[0].astype(np.float64)
def abscol(): return (np.arange(W) + ROT) % W

# ====================================================================== sweep (D), wrapped
NH = 24                                # samples of the face history kept per peak (valley -> crest, uniform in elevation angle)
def strip_history(a, dl, hh, k0, k1):
    """The marcher's record of one peak strip: the ray samples from the last local minimum (k0) to the peak (k1), reduced to what the eye sees (a sample hides
    behind any earlier, higher one: running maximum of the angle) and resampled at NH uniform steps of elevation angle.  Returns (distance[NH], height[NH]), index 0 = valley, NH-1 = crest."""
    seg = np.asarray(a[k0:k1 + 1]); runmax = np.maximum.accumulate(seg); vis = np.concatenate([[True], runmax[1:] > runmax[:-1]])
    va = runmax[vis]; vd = np.asarray(dl[k0:k1 + 1])[vis]; vh = np.asarray(hh[k0:k1 + 1])[vis]
    if len(va) < 2 or va[-1] <= va[0]: return np.full(NH, vd[-1]), np.full(NH, vh[-1])
    t = np.linspace(va[0], va[-1], NH); return np.interp(t, va, vd), np.interp(t, va, vh)

def extract(d, ang, hgt, prom=PROM_M):
    """Per column: (peak_ang, valley_ang, peak_d, peak_h, valley_h, valley_d) followed by the face history (NH distances, NH heights) of the strip valley -> peak.
    A peak commits when the ray has fallen hy[k] below it and it stands `prom` METRES above the lowest ground the strip has seen (the lowest height, not the height of the lowest-ANGLE sample: that one is often near and high)."""
    K, Wc = ang.shape; hy = np.degrees(prom / d).tolist(); dl = d.tolist(); cols = []
    for x in range(Wc):
        a = ang[:, x].tolist(); hh = hgt[:, x].tolist(); out = []
        def span(pk, lo, pd, ph, vh, vd, k0, k1): out.append((pk, lo, pd, ph, vh, vd) + tuple(np.concatenate(strip_history(a, dl, hh, k0, k1))))
        runmax = -90.0; mn = a[0]; mnh = hh[0]; mnd = dl[0]; mnk = 0; cand = a[0]; ch = hh[0]; cd = dl[0]; ck = 0; lowh = hh[0]; capped = False        # NEAR_CAP is tried once, at the first sample past 4 km
        for k in range(1, K):
            v = a[k]; dk = dl[k]; hk = hh[k]; lowh = min(lowh, hk)
            if dk >= NEAR_CAP and not capped and not out and runmax < -80:
                capped = True; j = max(range(k), key=a.__getitem__)
                if hh[j] - lowh >= prom: span(a[j], mn, dl[j], hh[j], mnh, mnd, min(mnk, j), j); runmax = a[j]; mn = cand = v; mnh = ch = hk; mnd = cd = dk; mnk = ck = k; lowh = hk
            if v < mn: mn = cand = v; mnh = ch = hk; mnd = cd = dk; mnk = ck = k
            elif v > cand: cand = v; ch = hk; cd = dk; ck = k
            if cand - v >= hy[k] and ch - lowh >= prom:
                if cand > runmax: span(cand, mn, cd, ch, mnh, mnd, mnk, ck); runmax = cand
                mn = cand = v; mnh = ch = hk; mnd = cd = dk; mnk = ck = k; lowh = hk
        if ch - lowh >= prom and cand > runmax: span(cand, mn, cd, ch, mnh, mnd, mnk, ck)
        cols.append(out)
    return cols

def chains(cols):
    Wc = len(cols); parent = []; ids = []
    for sp in cols: ids.append(list(range(len(parent), len(parent) + len(sp)))); parent.extend(range(len(parent), len(parent) + len(sp)))
    def find(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for x, sp in enumerate(cols):
        for i, s in zip(ids[x], sp):
            p, dd = s[0], s[2]; best = None
            for back in range(1, LOOK + 1):
                xb = (x - back) % Wc
                for j, s2 in zip(ids[xb], cols[xb]):
                    ld = abs(math.log(dd / s2[2]))
                    if ld < LINK_D and abs(p - s2[0]) < LINK_A * (1 + 0.5 * (back - 1)):
                        sc = ld / LINK_D + abs(p - s2[0]) / LINK_A + 0.3 * back
                        if best is None or sc < best[0]: best = (sc, j)
            if best: parent[find(i)] = find(best[1])
    out = {}
    for x, sp in enumerate(cols):
        for i, s in zip(ids[x], sp): out.setdefault(find(i), []).append((x,) + tuple(s))
    return list(out.values())

def chain_layer(c):
    """Chain -> dense per-column arrays (deg / m).  The chain is unrolled at its largest circular gap into an arc [0, x1] of local columns; every
    column outside the arc takes the value of the NEAREST arc end (start end or finish end) and then dies toward that end's valley over TAPER columns."""
    a = np.array(c); xs = a[:, 0].astype(int); u = np.unique(xs)
    gaps = np.diff(np.concatenate([u, [u[0] + W]])); start = int(u[(gaps.argmax() + 1) % len(u)]); xl = (xs - start) % W
    Pk, L, D, PH, VH, VD = (a[:, i] for i in range(1, 7)); HD = a[:, 7:7 + NH]; HH = a[:, 7 + NH:7 + 2 * NH]
    run = np.maximum(np.abs(D - VD), 300.0); slope = np.degrees(np.arctan2(np.maximum(PH - VH, 0), run))
    x1 = int(xl.max()); ii = np.arange(0, x1 + 1); res = {}; x = np.arange(W)
    near_end = np.where(x - x1 <= W - x, x1, 0)                          # outside the arc: which end is nearer going around the ring
    dist = np.where(x <= x1, 0, np.minimum(x - x1, W - x)).astype(float)
    def dense(v):
        full = np.full(W, np.nan); full[xl] = v; ok = ~np.isnan(full[ii]); full[ii] = np.interp(ii, ii[ok], full[ii][ok]); return np.where(x <= x1, full, full[near_end])
    for k, v in dict(top=Pk, lo=L, ph=PH, vh=VH, slope=slope, pd=D, vd=VD).items(): res[k] = dense(v)
    res['hd'] = np.stack([dense(HD[:, j]) for j in range(NH)]); res['hh'] = np.stack([dense(HH[:, j]) for j in range(NH)])     # the face history, one (NH, W) array each: column x carries the history of the peak that owns it
    drop = res['top'] - np.minimum(res['lo'], res['top'] - 0.4); Tn = taper_len(drop)       # end drop in degrees -> taper length at this column
    t = np.clip(dist / Tn, 0, 1); t = t * t * (3 - 2 * t)
    res['top'] = res['top'] - drop * t
    res['wt'] = 1 - np.clip(dist / Tn, 0, 1)
    for k in ('top', 'lo', 'ph', 'vh', 'slope', 'wt', 'pd', 'vd', 'hd', 'hh'): res[k] = np.roll(res[k], start, axis=-1)
    res['dist'] = float(np.median(D)); res['n'] = len(c); res['x0'] = start; res['x1'] = (start + x1) % W; res['span'] = x1 + 1
    res['rise_ang'] = float(np.median(Pk - L)); res['rise_h'] = float(np.median(PH - VH)); res['slope_med'] = float(np.median(slope))
    return res

def col_gap(present):
    """Circular distance in columns from each column to the nearest present column (0 where present)."""
    x = np.arange(3 * W); p = np.tile(present, 3); last = np.maximum.accumulate(np.where(p, x, -10 * W)); nxt = np.minimum.accumulate(np.where(p, x, 10 * W)[::-1])[::-1]
    return np.minimum(x - last, nxt - x)[W:2 * W].astype(float)

def to_slots(layers):
    slots = {}
    for L in layers: slots.setdefault(int(np.argmin(np.abs(np.log(KNOTS) - math.log(L['dist'])))), []).append(L)
    out = []
    for s in sorted(slots):
        g = slots[s]; top = np.stack([np.where(l['wt'] > 0, l['top'], -1e3 - col_gap(l['wt'] > 0)) for l in g]); j = top.argmax(0)   # only chains that are present in a column compete; where none is, the chain whose extent is NEAREST stands (a geometric rule: the list order of chains depends on where column 0 is, and absent-column values feed the blurs at every chain end)
        S = dict(slot=s, dist=float(KNOTS[s]), chains=len(g), dists=[l['dist'] for l in g])
        for k in ('top', 'lo', 'ph', 'vh', 'slope', 'wt', 'pd', 'vd'): S[k] = np.take_along_axis(np.stack([l[k] for l in g]), j[None], 0)[0]
        for k in ('hd', 'hh'): S[k] = np.take_along_axis(np.stack([l[k] for l in g]), j[None, None], 0)[0]
        out.append(S)
    return out

def sweep(d, ang, hgt, prom=PROM_M):
    t0 = time.time(); cols = extract(d, ang, hgt, prom); t1 = time.time()
    ch = chains(cols); near = lambda c: np.median([t[3] for t in c]) < FOREGROUND_M; keep = [c for c in ch if len(c) >= MINW]
    def arc(c):
        u = np.unique([t[0] for t in c]); g = np.diff(np.concatenate([u, [u[0] + W]])); i = g.argmax(); st = u[(i + 1) % len(u)]; return (st + np.arange((u[i] - st) % W + 1)) % W     # the columns a chain spans, unrolled at its largest gap
    cov = np.zeros(W, bool)
    for c in keep:
        if near(c): cov[(arc(c)[:, None] + np.arange(-MINW // 4, MINW // 4 + 1)[None, :]).ravel() % W] = True       # dilated by MINW/4 columns: a stub that occludes a near ridge for a few columns sits inside it
    for c in sorted((c for c in ch if len(c) < MINW and near(c)), key=lambda c: -len(c)):                  # widest first: a stub is judged against the stubs already kept
        xs = arc(c)
        if not cov[xs].any(): keep.append(c); cov[xs] = True
    lay = [chain_layer(c) for c in keep]; slots = to_slots(lay); t2 = time.time()
    return dict(cols=cols, nchains=len(ch), keep=lay, slots=slots, raw=sum(len(c) for c in cols), t_extract=t1 - t0, t_chain=t2 - t1)

# ====================================================================== the authored Y mapping
def set_view(slots, sky_row=0.04, near_row=0.66):
    """AUTHORED vertical mapping, linear in elevation angle: row = (TOP_DEG - angle) * PXDEG_V over the whole 600-row frame (cylindrical, horizontal 17.78 px/deg).
    Two anchors: the highest ridge top in the window sits at `sky_row` (4%) of the frame height, the LOWEST crest of the nearest layer in the window sits at `near_row` (66%);
    everything below is that layer's body, its foot, and the ground-plane band.  PXDEG_V = (near_row - sky_row) * 600 / (highest top - lowest near crest), clamped to
    [17.78, 178] px/deg = vertical exaggeration 1x..10x.  TOP_DEG = highest top + sky_row*600/PXDEG_V;  BOTTOM_DEG = TOP_DEG - 600/PXDEG_V; horizon (angle 0) at row TOP_DEG*PXDEG_V."""
    global rowang, PXDEG_V, TOP_DEG, BOTTOM_DEG
    cols = (P['win0'] + np.arange(WIN)) % W; sky = max(float(S['top'][cols][S['wt'][cols] > 0].max()) for S in slots if (S['wt'][cols] > 0).any())
    near = slots[-1]; act = near['wt'][cols] > 0; c_low = float(blurw(near['top'], 3.0)[cols][act].min()) if act.any() else sky - 2.0
    ppd = float(np.clip((near_row - sky_row) * H / max(sky - c_low, 0.05), HPX_DEG, 10 * HPX_DEG))
    PXDEG_V = ppd; TOP_DEG = sky + sky_row * H / ppd; BOTTOM_DEG = TOP_DEG - H / ppd; rowang = TOP_DEG - (np.arange(H) + 0.5) / PXDEG_V
    return dict(top_deg=TOP_DEG, bottom_deg=BOTTOM_DEG, px_per_deg=PXDEG_V, exaggeration=PXDEG_V / HPX_DEG, horizon_row=TOP_DEG * PXDEG_V, sky_deg=sky, near_crest_low_deg=c_low,
                sky_row=sky_row, near_row=near_row)

# ====================================================================== bake (sun-independent), per layer
def azrad(): return (abscol() + 0.5) / W * 2 * math.pi

def face_field(hd, hh, ang, lo, pd, ph, vd, vh):
    """Per-pixel face from the marcher's history (hd, hh: NH distances / heights per column, valley -> crest).  A pixel at elevation `rowang` of column x sits at fraction
    f = (rowang - lo) / (ang - lo) of the strip; its distance and height are the history interpolated at f.  Front slope s = dh/dd along the ray comes from the history over +-2 nodes
    (the strip's mean slope where the window has no run); the lateral tilt is the height change between the neighbouring columns at the SAME pixel row, corrected for the radial
    step (c - a*s) / (tangential length).  n ~ (-s r - la t, 1).  Returns Z, D, s, la, f as (H, W) arrays."""
    f = np.clip((rowang[:, None] - lo[None, :]) / np.maximum(ang - lo, 1e-3)[None, :], 0, 1); pos = f * (NH - 1); i0 = np.minimum(pos.astype(int), NH - 2); t = pos - i0; xs = np.arange(W)[None, :]
    lerp = lambda A: A[i0, xs] * (1 - t) + A[i0 + 1, xs] * t
    lo_i, hi_i = np.clip(np.arange(NH) - 2, 0, NH - 1), np.clip(np.arange(NH) + 2, 0, NH - 1)
    dd = hd[hi_i] - hd[lo_i]; mean_s = ((ph - vh) / np.maximum(np.abs(pd - vd), 300.0))[None, :]
    sn = np.where(dd >= 20.0, (hh[hi_i] - hh[lo_i]) / np.maximum(dd, 20.0), mean_s)
    Z, Dp, sl = lerp(hh), lerp(hd), lerp(sn)
    a_ = np.roll(Dp, -1, axis=1) - np.roll(Dp, 1, axis=1); c_ = np.roll(Z, -1, axis=1) - np.roll(Z, 1, axis=1)
    b_ = np.maximum(2 * COLW * Dp, 1.0); la = np.where(np.abs(a_) > 3 * b_, 0.0, np.clip((c_ - a_ * sl) / b_, -1.5, 1.5))     # neighbours at very different distances are an occlusion edge, not a surface: no tilt
    return Z.astype(np.float32), Dp, blurw(sl, 2.0).astype(np.float32), blurw(la, 2.0).astype(np.float32), f

def bake_layer(S, rank, far):
    b = S['slot']; base = RAMP[b]; reg = int(round((rank - 2) * 1.5)); R_ = lambda v: np.roll(v, reg, axis=-1); px = 1.0 / PXDEG_V
    s_ref = P.get('s_ref_deg', 8.0)
    ang = blurw(S['top'], 2.5) + (pn1(38, 100 + b) - 0.5) * 6 * px + (pn1(7, 200 + b) - 0.5) * 2 * px; ang = R_(ang)   # edge wobble authored in pixels
    lo = R_(blurw(S['lo'], 2.5)); ph = R_(blurw(S['ph'], 2.0)); vh = R_(blurw(S['vh'], 2.0))
    sn = np.clip(R_(blurw(S['slope'], 3.0)) / s_ref, 0, 1); wt = R_(S['wt'])
    hd = R_(blurw(S['hd'], 2.0)); hhist = R_(blurw(S['hh'], 2.0)); pd_ = R_(blurw(S['pd'], 2.0)); vd_ = R_(blurw(S['vd'], 2.0))
    top = ang[None, :] - rowang[:, None]; toppx = (top * PXDEG_V).astype(np.float32)
    m = np.clip(toppx / 1.6 + 0.5, 0, 1) * np.clip(blurw((wt > 0).astype(float), 1.0) * 1.5, 0, 1)[None, :]       # a layer is drawn only where a chain exists (or tapers)
    rise_px = np.clip((ang - blurw(lo, 12.0)) * PXDEG_V, 1, None)                 # foot length from a smoothed valley: no per-column curtains
    foot = np.clip(0.85 * rise_px, 28 * np.clip(wt, 0, 1), 210).clip(1)                 # a tapering end carries no 28 px curtain: the body shrinks with the chain's weight, so a chain end leaves no stub
    depthpx = np.clip(toppx / foot[None], 0, 1)
    fade = np.clip((depthpx - 0.6) / 0.4, 0, 1); fade = fade * fade * (3 - 2 * fade); alpha = (m * (1 - fade)).astype(np.float32)      # the body dissolves at its foot: what is behind (other layers, floor, sky) shows, so a column boundary leaves no wall down the frame
    w = (depthpx ** 0.8 * 0.92).astype(np.float32)                         # weight of the foot colour (floor/haze mix, decided at relight)
    face = np.broadcast_to((base * 1.12).astype(np.float32), (H, W, 3)).copy()
    Z, Dp, sl, la, f = face_field(hd, hhist, ang, lo, pd_, ph, vd_, vh)
    snp = np.clip(np.degrees(np.arctan(sl)) / s_ref, 0, 1)                         # per-pixel face steepness from the history (the column scalar `sn` stays for stroke weights only)
    face *= (1.07 - 0.22 * snp)[..., None]
    mot = 0.55 * pn2(22, 300 + b) + 0.45 * pn2(5, 400 + b)
    face *= (0.90 + 0.18 * mot[..., None]) * (0.96 + 0.08 * pn2(1, 500 + b)[..., None])
    echo = np.clip(((ang - 24 * px * (1 + rank * .3))[None, :] - rowang[:, None]) * PXDEG_V / 1.6 + .5, 0, 1)
    face *= (1 - 0.13 * echo[..., None] * (1 - depthpx[..., None] * .5))
    ink = base * 0.42 + np.array([0.02, 0.03, 0.08])
    ew = (0.7 + 1.8 * snp) * (1 - 0.35 * far)
    edge = np.clip(1 - np.abs(toppx - 0.6 - ew * 0.5) / ew, 0, 1) * (toppx > -0.5)
    ea = 0.55 * (1 - 0.45 * far) * edge * (0.4 + 0.6 * snp)
    dzdpx = np.maximum(np.abs(np.roll(Z, -1, axis=0) - np.roll(Z, 1, axis=0)) / 2.0, 1e-3); dzdpx[0] = dzdpx[1]; dzdpx[-1] = dzdpx[-2]   # metres of true height per pixel row, per pixel
    faceok = (f > 0.02) & (f < 0.98) & (wt[None, :] > 0.5)
    cm = next((c for c in CONTOUR_NICE if c >= CONTOUR_MIN_PX * float(np.percentile(dzdpx[faceok], 75) if faceok.any() else 3.0)), CONTOUR_NICE[-1])   # metres per contour line: lines >= 9 px apart over three quarters of this layer's face
    p_ = (Z / cm) % 1.0; dpx = (np.minimum(p_, 1 - p_) * cm / dzdpx).astype(np.float32)
    face_mask = ((top > 0.003) & (rowang[:, None] > lo[None, :])).astype(np.float32)
    ca = (0.95 * (1 - 0.45 * far) * (1 - depthpx) ** 2.0 * wt[None, :] * (0.6 + 0.4 * snp) * face_mask).astype(np.float32)
    hatch = np.zeros((H, W), np.float32)
    if far < 0.8:
        rng = np.random.default_rng(700 + b); xs = np.cumsum(rng.integers(2, 7, W // 2)); xs = xs[xs < W]
        up = gradw(ang) * PXDEG_V
        for i, xa in enumerate(xs):
            x = (xa - ROT) % W; u1, u2 = rng.random(2)
            if u1 > 0.30 + 0.70 * sn[x] or wt[x] < 0.5: continue
            Lpx = (8 + 50 * sn[x] ** 0.7) * (0.55 + 0.7 * u2) * (1 - 0.5 * far)
            y0 = (rowang[0] - ang[x]) * PXDEG_V; yy = np.arange(H); t = (yy - y0 - 2) / max(Lpx, 1)
            ok = (t >= 0) & (t < 1); xx = (x + np.round(-np.clip(up[x] * 0.25, -0.6, 0.6) * (yy - y0)).astype(int)) % W
            hatch[yy[ok], xx[ok]] = np.maximum(hatch[yy[ok], xx[ok]], (1 - t[ok]) ** 1.5)
    ha = np.clip(ea + hatch * 0.50 * (1 - 0.4 * far), 0, 1).astype(np.float32)
    rb = (np.clip(1 - toppx / 7.0, 0, 1) * (toppx > -0.5)).astype(np.float32)
    az = azrad(); dd = np.stack([S['vd'], 0.5 * (S['vd'] + S['pd']), S['pd']]); hh = np.stack([S['vh'], 0.5 * (S['vh'] + S['ph']), S['ph']]) + 3.0   # face samples: valley, middle, crest
    spts = dict(lat=np.roll(P['lat'] + dd * np.cos(az) / 111320.0, reg, axis=1), lon=np.roll(P['lon'] + dd * np.sin(az) / (111320.0 * math.cos(math.radians(P['lat']))), reg, axis=1), h=np.roll(hh, reg, axis=1))
    return dict(m=m.astype(np.float32), a=alpha, face=face, w=w, dpx=dpx, ca=ca, ha=ha, rb=rb, mot=mot.astype(np.float32), sl=sl, la=la, ink=ink, far=far, dist=S['dist'], rank=rank, ang=ang, lo=lo, spts=spts)

def bake(slots):
    return [bake_layer(S, rank, float(np.clip((math.log(S['dist']) - math.log(2000)) / (math.log(70000) - math.log(2000)), 0, 1))) for rank, S in enumerate(slots)]

# ====================================================================== cast shadows (sun-dependent): DEM march toward the sun from each layer's face samples
SH_STEPS = 40.0 * 1.1 ** np.arange(0, 66)              # 40 m .. 20 km, geometric
def cast_shadows(layers, az_s, el_s):
    """Per layer a (3, W) array in [0,1]: how much of the sun is blocked by the real DEM at that layer's valley / middle / crest sample.  One vectorised march for all
    layers.  Soft: the blocked fraction is the terrain excess over the sun ray, over a penumbra of 6 m + 3% of the distance travelled.  Sun at or below 0.3 deg: no direct light, no shadow."""
    if el_s <= 0.3: return [np.zeros((3, W)) for _ in layers]
    m, lt, ll = mosaic(P); lat = np.concatenate([Ly['spts']['lat'].ravel() for Ly in layers]); lon = np.concatenate([Ly['spts']['lon'].ravel() for Ly in layers]); h = np.concatenate([Ly['spts']['h'].ravel() for Ly in layers])
    t = math.tan(math.radians(el_s)); cosl = math.cos(math.radians(P['lat'])); ca, sa = math.cos(math.radians(az_s)), math.sin(math.radians(az_s)); sh = np.zeros_like(h)
    for s in SH_STEPS:
        terr = bil(m, lt, ll, lat + s * ca / 111320.0, lon + s * sa / (111320.0 * cosl)) - s * s / (2 * R_EARTH)
        sh = np.maximum(sh, np.clip((terr - (h + s * t)) / (6.0 + 0.03 * s), 0, 1))
    return [a.reshape(3, W) for a in np.split(sh, len(layers))]

# ====================================================================== relight (sun-dependent)
TAU_Z = np.array([0.09, 0.14, 0.30]); BETA_R = np.array([0.0058, 0.0135, 0.0331]); BETA_M = 0.023; ATM = 0.15
ATM_FLOOR = 1.2                        # authored: valley haze over the ground plane is heavier than the layer extinction ATM, so the floor thins into haze gradually
G_MIE, W_MIE = 0.7, 0.10; REF = dict(az=180.0, el=62.0); REF_AMB = np.array([0.62, 0.74, 1.0])
def airmass(el): e = max(el, 0.3); return 1.0 / (math.sin(math.radians(e)) + 0.50572 * (e + 6.07995) ** -1.6364)
def sun_colour(el): return np.exp(-TAU_Z * airmass(el))
def phase(c):
    pr = 3.0 / (16 * math.pi) * (1 + c * c); pm = (1 - G_MIE ** 2) / (4 * math.pi * (1 + G_MIE ** 2 - 2 * G_MIE * c) ** 1.5)
    return (1 - W_MIE) * pr + W_MIE * pm
def sun_vec(az, el): a, e = math.radians(az), math.radians(el); return np.array([math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)])
def EX_REF_NORM(Ec, I, amb_k): return float((0.45 * REF_AMB * amb_k + 0.75 * Ec * I * 0.7).mean()) / 0.87
def sun_state(az, el):
    Ec = sun_colour(el) / sun_colour(REF['el']); I = (max(math.sin(math.radians(el)), 0.0) / math.sin(math.radians(REF['el']))) ** 0.5
    tw = 0.30 * float(np.clip((el + 6) / 8, 0, 1)) ** 2; amb_k = 0.12 + 0.88 * float(np.clip((el + 3) / 45, 0, 1)) ** 0.7
    ex = 0.45 + 0.55 * float(np.clip((el + 4) / 18, 0, 1)) ** 0.6
    return dict(az=az, el=el, L=sun_vec(az, el), sun=Ec * I, sky_sun=Ec * (I + tw), amb=REF_AMB * amb_k, amb_k=amb_k, ex=ex / EX_REF_NORM(Ec, I, amb_k), ex_t=ex)
def _g0():
    st = sun_state(REF['az'], REF['el']); d = 0.7; g = (0.45 * st['amb'] + 0.75 * st['sun'] * d) * (np.array([0.90, 0.92, 1.04]) + (np.array([1.03, 1.0, 0.95]) - np.array([0.90, 0.92, 1.04])) * d)
    return g / g.mean()
G0 = _g0()
def col_scatter(st):
    az = azrad(); c = math.cos(math.radians(st['el'])) * np.cos(az - math.radians(st['az']))
    pr = np.array([phase(float(x)) for x in c]); g = np.clip((pr / phase(0.0)) ** 0.35, 0.5, 2.4)
    rs = sun_state(REF['az'], REF['el']); ref = 0.8 * rs['sky_sun'] + 0.35 * rs['amb']; ref = ref / ref.mean()
    col = 0.8 * st['sky_sun'] + 0.35 * st['amb']; col = col / col.mean()
    return c, g[:, None] * (col / ref)[None, :]

def hue_gain(st, d):
    lit_tint = np.array([1.03, 1.0, 0.95]); shd_tint = np.array([0.90, 0.92, 1.04])
    tint = shd_tint + (lit_tint - shd_tint) * d
    return (0.45 * st['amb'] + 0.75 * st['sun'] * d) * tint / G0 * st['ex']

def floor_img(st, hazec, fmot):
    """Ground-plane band: below the horizon a flat floor `floor_agl_m` below the eye; plane distance dg = h / tan(depression); colour = ground albedo lit by an
    up-facing normal, thinned into haze by the same Beer-Lambert extinction as the layers.  Above the horizon the same array is the haze (sky covers it)."""
    a = rowang; dg = P['floor_agl_m'] / np.tan(np.radians(np.clip(-a, 0.002, 89.0)))
    T = np.exp(-(BETA_R + BETA_M)[None, :] * (dg / 1000.0)[:, None] * ATM_FLOOR); T[a >= 0] = 0.0
    ground = (GROUND * hue_gain(st, float(np.clip((math.sin(math.radians(st['el'])) + 0.2) / 1.2, 0, 1))))
    return ground[None, None, :] * fmot[..., None] * T[:, None, :] + hazec[None, :, :] * (1 - T)[:, None, :]

def ndl_field(Ly, L):
    """n . L per pixel from the baked face: n ~ (-sl r - la t, 1), r / t the column's radial / tangential directions.  Returns (ndl, |n|-normaliser)."""
    az = azrad(); sa, ca_ = np.sin(az), np.cos(az); sl, la = Ly['sl'], Ly['la']
    Lr = (L[0] * sa + L[1] * ca_)[None, :]; Lt = (L[0] * ca_ - L[1] * sa)[None, :]; nrm = np.sqrt(1 + sl * sl + la * la)
    return (L[2] - sl * Lr - la * Lt) / nrm, nrm

RELIEF_OFF_DEG, RELIEF_EL = 45.0, 32.0   # authored relief light: RELIEF_OFF_DEG off the view axis, RELIEF_EL up
def win_centre_az(): return (P['win0'] + WIN / 2) / W * 360.0
def relief_vec(sun_az):
    """The authored relief light direction (toward the light).  The real sun lights a face the viewer looks at only when it is off to one side; with the sun behind the viewer every face is
    head-on and the mountain goes flat.  Shading n.L (ndl_field, rim, spec) therefore uses this fixed direction: azimuth = the view centre az +/- RELIEF_OFF_DEG, on the left/right side of the view axis
    that the real sun is on (so the two agree where they can), RELIEF_EL up.  Sun colour/strength, haze, colour temperature and cast shadows keep the real sun:
    the relief only decides where on the form the sun's light falls."""
    ctr = win_centre_az(); side = 1.0 if math.sin(math.radians(sun_az - ctr)) >= 0 else -1.0
    return sun_vec(ctr + side * RELIEF_OFF_DEG, RELIEF_EL)

def fresnel(sl, nrm): return np.clip(1 - sl / nrm, 0, 1) ** 3                           # (1 - n . V)^3, V = -r: strongest on faces that lie away from the viewer
def spec_field(L, sl, la, nrm, ndl):
    """GGX-like highlight (alpha 0.3) of the face (sl, la, nrm as in ndl_field) for the light L: half vector between L and the direction back to the viewer (-r) in every column."""
    az = azrad(); sa, ca_ = np.sin(az), np.cos(az)
    Hv = L[None, :] + np.stack([-sa, -ca_, np.zeros(W)], 1); Hv /= np.linalg.norm(Hv, axis=1, keepdims=True)
    Hr = (Hv[:, 0] * sa + Hv[:, 1] * ca_)[None, :]; Ht = (Hv[:, 0] * ca_ - Hv[:, 1] * sa)[None, :]
    nh = np.clip((Hv[:, 2][None, :] - sl * Hr - la * Ht) / nrm, 0, 1); al = 0.30
    D = (al * al) / (1 + nh * nh * (al * al - 1)) ** 2 * al * al
    return 0.30 * D * np.clip(ndl, 0, 1)

def relight_layer(Ly, st, hazec, F, sh3=None):
    """Shading per PIXEL (ndl_field), not per column.  n.L uses the relief light; the sun's colour, strength (st['sun'] scales every direct term, so night and dusk stay dark) and shadows are the real sun's."""
    L = relief_vec(st['az']); az = azrad(); sa, ca_ = np.sin(az), np.cos(az); sl, la = Ly['sl'], Ly['la']
    ndl, nrm = ndl_field(Ly, L); d = np.clip((ndl + 0.2) / 1.2, 0, 1)
    gain = hue_gain(st, d[..., None])
    rim_dir = (np.stack([sa, ca_], 1) * L[None, :2]).sum(1)[None, :]
    fres = fresnel(sl, nrm)
    rim = (0.12 + 1.0 * np.clip(rim_dir, 0, 1)) * fres
    spec = spec_field(L, sl, la, nrm, ndl)
    if sh3 is None: sp = np.zeros((1, 1), np.float32); face = Ly['face'] * gain.astype(np.float32)
    else:
        sh3 = blurw(sh3, 2.0); f = np.clip((rowang[:, None] - Ly['lo'][None, :]) / np.maximum(Ly['ang'] - Ly['lo'], 1e-3)[None, :], 0, 1)       # position on the face: 0 valley .. 1 crest
        sp = np.where(f < 0.5, sh3[0] + (sh3[1] - sh3[0]) * 2 * f, sh3[1] + (sh3[2] - sh3[1]) * 2 * (f - 0.5)).astype(np.float32)
        g_amb = hue_gain(st, 0.0)[None, None, :]; face = Ly['face'] * (g_amb + (gain - g_amb) * (1 - sp)[..., None]).astype(np.float32)           # shadow removes the direct share only
    fa = 1 - math.exp(-Ly['dist'] / 20000.0)                                       # valley mist grows with the layer's distance
    foot = F * (1 - fa) + hazec[None] * fa
    wf = Ly['w'] * (1 - 0.6 * fa)                                                   # far layers keep 60% of their own body colour at the foot
    wf = 1 - (1 - wf) * np.clip(1 + rowang * PXDEG_V / 40.0, 0, 1)[:, None]          # below the horizon every layer's foot has merged into the ground plane within 40 px: no per-slot colour seams down the floor
    face = face * (1 - wf[..., None]) + foot * wf[..., None]
    face += (Ly['rb'] * (rim * 0.55) * (1 - sp))[..., None] * (st['sun'] * 1.1 + 0.25)[None, None, :]
    face += ((spec * (0.5 + Ly['mot'])) * (Ly['m'] > 0.5) * (1 - sp))[..., None] * st['sun'][None, None, :] * 0.5
    lw = (0.70 + 0.90 * (1 - d)) * (1 - 0.30 * Ly['far'])
    line = np.clip(1 - Ly['dpx'] / lw, 0, 1) * Ly['ca']
    ia = np.clip(line + Ly['ha'], 0, 1)
    ink = Ly['ink'][None, None, :] * (0.6 + 0.4 * gain.mean(-1))[..., None]
    face = face * (1 - ia[..., None]) + ink * ia[..., None]
    T = np.exp(-(BETA_R + BETA_M) * Ly['dist'] / 1000.0 * ATM)
    return face * T[None, None, :] + hazec[None, :, :] * (1 - T)[None, None, :]

def sky_hz(st, paperf):
    az = azrad(); c, hg = col_scatter(st)
    hz = hx('#f5e2c8')[None, :] * hg * st['ex_t']
    tint = (st['amb'] / st['amb'].mean()) / (REF_AMB / REF_AMB.mean()); zen = hx('#a9bcd6')[None, :] * tint[None, :] * st['ex_t']
    u = np.clip(rowang / max(TOP_DEG, 2.5), 0, 1)[:, None] ** 0.7
    img = zen[None] * u[..., None] + hz[None] * (1 - u)[..., None]
    ev = np.radians(rowang)[:, None]; cs = np.cos(ev) * math.cos(math.radians(st['el'])) * np.cos(az - math.radians(st['az']))[None, :] + np.sin(ev) * math.sin(math.radians(st['el']))
    ang = np.degrees(np.arccos(np.clip(cs, -1, 1)))
    glow = 0.95 * np.exp(-(ang / 4.5) ** 2) + 0.55 * np.exp(-(ang / 22.0) ** 2)
    img = img + glow[..., None] * (st['sky_sun'] * 0.8 * st['ex_t'])[None, None, :]
    return img * paperf[..., None] / 0.93, hz

def haze_colour(hz): return hz * (hx('#cdd7e7') / hx('#f5e2c8'))[None, :]

def relight(layers, az, el, paperf, grain, fmot, shadows=True, flat=None):
    """Opaque frame with the sky.  `flat` (an RGB triple) replaces the sky and the haze colour by that one colour: the stand-in the planes are compared against."""
    st = sun_state(az, el); shs = cast_shadows(layers, az, el) if shadows else [None] * len(layers); sky, hz = sky_hz(st, paperf)
    hazec = haze_colour(hz)
    if flat is not None: hazec = np.broadcast_to(np.asarray(flat, float), (W, 3)); sky = np.broadcast_to(np.asarray(flat, float), sky.shape)
    F = floor_img(st, hazec, fmot) * (paperf[..., None] / 0.93)
    img = np.where((rowang >= 0)[:, None, None], sky, F).astype(np.float32)
    for Ly, sh3 in zip(layers, shs):
        face = relight_layer(Ly, st, hazec.astype(np.float32), F.astype(np.float32), sh3); face *= (paperf[..., None] / 0.93)
        img = img * (1 - Ly['a'][..., None]) + face * Ly['a'][..., None]
    return img * grain[..., None]

def group_slots(n):
    """Plane grouping by slot index: far = slot 0 (+ the floor), near = the last slot, mid = every slot between.  Fewer than 3 slots cannot fill three planes."""
    if n < 3: raise ValueError(f"a place needs at least 3 layer slots for the far/mid/near planes, this one has {n}")
    return dict(far=[0], mid=list(range(1, n - 1)), near=[n - 1])

def relight_planes(layers, az, el, paperf, grain, fmot, shadows=True, ref=None):
    """The frame as three RGBA planes (window columns, float 0..1, straight alpha) with no sky drawn.  Every pixel of relight is affine in the haze colour c: out = X + c Y
    (the haze enters only as the foot mix and the final Beer-Lambert mix).  Render each layer and the floor with c = 0 (X) and c = 1 (X + Y), composite each group over
    nothing, and let the haze share become transparency: alpha = coverage - mean(Y), colour = X / alpha.  Whatever sky the runtime draws behind then supplies the haze.
    The split is exact for one group over a flat sky; stacked planes put a nearer group's haze over the farther ridge instead of over the sky (see the recomposite test for the measured loss)."""
    st = sun_state(az, el); shs = cast_shadows(layers, az, el) if shadows else [None] * len(layers); out = {}
    below = (rowang < 0)[:, None]; k = (paperf[..., None] / 0.93); runs = []
    ref = haze_colour(sky_hz(st, paperf)[1]) if ref is None else np.broadcast_to(np.asarray(ref, float), (W, 3)); ref_w = win(ref[None].astype(np.float32))[0]
    for c in (0.0, 1.0):
        hc = np.full((W, 3), c, np.float32); F = (floor_img(st, hc, fmot) * k).astype(np.float32)
        runs.append((F, [relight_layer(Ly, st, hc, F, sh3) * k for Ly, sh3 in zip(layers, shs)]))
    for name, idx in group_slots(len(layers)).items():
        img = [np.where(below[..., None], r[0], 0.0) if name == 'far' else np.zeros_like(r[0]) for r in runs]; cov = np.broadcast_to(below, (H, W)).astype(np.float32) if name == 'far' else np.zeros((H, W), np.float32)
        for i in idx:
            a = layers[i]['a'][..., None]
            for j in (0, 1): img[j] = img[j] * (1 - a) + runs[j][1][i] * a
            cov = cov * (1 - a[..., 0]) + a[..., 0]
        X = win(img[0]); Yc = win(img[1] - img[0]); Y = Yc.mean(-1); alpha = np.clip(win(cov) - Y, 0, 1)
        P = X + ref_w[None] * (Yc - Y[..., None])                                       # premultiplied colour: exact over the reference haze, per channel
        col = np.where(alpha[..., None] > 1e-4, P / np.maximum(alpha, 1e-4)[..., None], 0.0) * win(grain)[..., None]
        out[name] = np.concatenate([np.clip(col, 0, 1), alpha[..., None]], -1).astype(np.float32)
    return out

def statics():
    paperf = 0.93 + 0.09 * (0.5 * pn2(2, 11) + 0.3 * pn2(9, 12) + 0.2 * pn2(40, 13)) + 0.03 * (pn2(1, 14) - .5)
    return paperf, 0.95 + 0.07 * pn2(1, 900), 0.88 + 0.2 * (0.6 * pn2(30, 810) + 0.4 * pn2(7, 811))

def debug_spans(cols, win0=None, w=WIN):
    win0 = P['win0'] if win0 is None else win0
    img = np.ones((H, w, 3)) * 0.97; ramp = [hx(c) for c in ('#d03030', '#e8a020', '#60b040', '#2090b0', '#6030c0')]
    order = sorted(((s[2], i, s[0], s[1]) for i in range(w) for s in cols[(win0 + i) % W]), key=lambda t: -t[0])
    for dd, x, p, l in order:
        t = np.clip((math.log(dd) - math.log(500)) / (math.log(95000) - math.log(500)), 0, 1) * 4
        i = min(int(t), 3); col = mix(ramp[i], ramp[i + 1], t - i)
        y0 = int(np.clip((TOP_DEG - p) * PXDEG_V, 0, H - 1)); y1 = int(np.clip((TOP_DEG - max(l, p - 3.0)) * PXDEG_V, 0, H - 1))
        img[y0:y1 + 1, x] = col
    return img

def apply_view(v):
    """re-apply a view returned by set_view (used by the rotation test and the before/after comparison so that frames line up exactly)"""
    global rowang, PXDEG_V, TOP_DEG, BOTTOM_DEG
    PXDEG_V = v['px_per_deg']; TOP_DEG = v['top_deg']; BOTTOM_DEG = v['bottom_deg']; rowang = TOP_DEG - (np.arange(H) + 0.5) / PXDEG_V
