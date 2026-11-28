"""Ridge baker: the ray march of a place, cut into K+1 layered-depth G-buffer cards by K authored seams (places.json), no painter, no sun.
Offline baker for the ridge backdrop (scripts/ridge-bake); export.py drives it.

  load_preset(id) -> configure()  : observer, tiles, surface origin, ring radius, rest azimuth, card splits and prefilter from places.json
  stage0(detail)                   : ray march of all 6400 azimuth columns (curvature+refraction), optional authored sub-DEM foreground detail, cached
  prefilter(d, h, sigma_m)         : Gaussian low-pass of the sampled heights (along each ray, across rays at equal distance), angles recomputed with elev
  set_view(skyline)                : authored Y mapping from the march skyline of the whole ring: angle -> row, see set_view
  ring_cols(a, c0, n)              : n columns of the ring from column c0, periodic (the tile cut)
  coverage(d, a) / seams(cov, ..)  : visible rows per log-distance bin; one forward-energy seam per authored split, per column, periodic round the ring
  normals(d, h) / cards(...)       : per-sample normals; the K+1 cards (coverage, distance, normal, height), each cropped to its band of rows
  relief / mosaic                  : the terrain surface M' (the survey generalised by curvature, ruling ridge-terrain-curvature-generalisation): the one array every stage after it reads, through cubic
Vertical exaggeration is AUTHORED and derived per view by set_view (printed on the page).  The client owns lighting, haze and ink (ruling ridge-cards-runtime-lit)."""
import sys, time, math, json
import os, hashlib
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from refusal import Refusal
import numpy as np, tifffile

def _env_dir(name, what):
    v = os.environ.get(name)
    if not v: raise RuntimeError(f"{name} is not set: it must name {what} (no default location is assumed)")
    return Path(v)
B = _env_dir('RIDGE_WORK', 'the work directory (the mosaic / ray caches)')
COP = _env_dir('RIDGE_TILES', 'the directory of Copernicus GLO-30 tiles (Copernicus_DSM_COG_10_*_DEM.tif)')
W = 6400                               # ring columns: 360 deg at 17.78 px/deg
HPX_DEG = W / 360.0
H = 600                                # frame rows
COLW = math.radians(360.0 / W)
R_EARTH, KREF = 6371000.0, 0.13
KERNEL = 'catmull-rom'                 # the DEM sampling kernel of the march (cubic): part of the ray cache key

P = {}                                 # configured preset
rowang = np.zeros(H); PXDEG_V = 100.0; TOP_DEG = 2.6; BOTTOM_DEG = -3.4

def load_preset(pid, path=Path(__file__).resolve().parent / 'places.json'):
    """The preset dict.  tz is required, an IANA zone the system knows (the runtime draws named sky moments in the place's local day).  card_split_km is the ordered list of authored seam depths (km): required, strictly increasing, at most export.MAX_CARDS - 1 (the cap is export's, which owns the budget); refused here, before any march."""
    d = json.load(open(path)); p = dict(next(x for x in d['presets'] if x['id'] == pid)); sp = p.get('card_split_km')
    from export import MAX_CARDS
    if not sp: raise Refusal(f"preset {pid}: card_split_km is required (an ordered list of 1 to {MAX_CARDS - 1} depths in km)")
    if len(sp) > MAX_CARDS - 1 or any(b <= a for a, b in zip(sp, sp[1:])): raise Refusal(f"preset {pid}: card_split_km {sp} must be strictly increasing with at most {MAX_CARDS - 1} entries")
    tz = p.get('tz')
    if not isinstance(tz, str) or not tz: raise Refusal(f"preset {pid}: tz is required (an IANA time zone name such as Europe/Vienna)")
    try: ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError, OSError): raise Refusal(f"preset {pid}: tz {tz!r} is not a time zone the system knows")
    if 'ground_override_m' in p: raise Refusal(f"preset {pid}: ground_override_m is gone: the eye stands eye_h_m above the final surface at the observer, never at a stored altitude")
    canon_relief(p.get('relief'))
    return p

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

# ====================================================================== the terrain surface: raw survey -> relief() -> the one array every later stage reads
RELIEF_VERSION = 1                     # bump with any change to relief() or its helpers: it is part of mosaic_key, so no stale generalised array is read
RELIEF_KNOBS = dict(detail=0.0, ridge_removal=2.0, ridge_gain=0.0, ridge_sharpness=1.5, valley_removal=2.0, valley_gain=0.0, valley_limit=0.8, slope_threshold_deg=25.0, max_shift_m=None)
def canon_relief(r):
    """The canonical knob dict of a places.json `relief` object, or None for the identity: absent, or detail, ridge_gain and valley_gain all 0 (max_shift_m alone moves nothing).  Unknown keys and out-of-range values are a Refusal.  Knobs are in the published tool's own units: the sigmas, in posts of 30 m, are 0.4 detail, 0.7 ridge_removal and 0.7 valley_removal."""
    if r is None: return None
    if not isinstance(r, dict): raise Refusal("relief must be an object of knobs or absent")
    bad = sorted(set(r) - set(RELIEF_KNOBS))
    if bad: raise Refusal(f"relief: unknown knob {', '.join(bad)} (known: {', '.join(RELIEF_KNOBS)})")
    k = dict(RELIEF_KNOBS, **r)
    for n, v in k.items():
        if v is None and n == 'max_shift_m': continue
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0: raise Refusal(f"relief.{n} must be a number of at least 0, not {v!r}")
    if k['max_shift_m'] == 0 or k['slope_threshold_deg'] >= 90 or k['valley_gain'] > 1: raise Refusal("relief: max_shift_m must be above 0 (null: unbounded), slope_threshold_deg below 90 and valley_gain at most 1")
    if k['detail'] == 0 and k['ridge_gain'] == 0 and k['valley_gain'] == 0: return None
    return {n: None if v is None else float(v) for n, v in k.items()}

def gauss(X, s, cy, cx):
    """Separable Gaussian low-pass of the grid X with sigma s posts of 30 m, i.e. 30 s metres, in pixels per axis from the true cell size (cy m north-south, cx m east-west) so it is round on the ground; kernel radius ceil(3 sigma), edge samples replicated; s = 0 returns X itself (callers never modify the result in place)."""
    if s <= 0: return X
    for ax, c in ((0, cy), (1, cx)):
        sg = 30.0 * s / c; r = int(math.ceil(3 * sg)); n = X.shape[ax]
        if r == 0: continue
        k = np.exp(-0.5 * (np.arange(r + 1) / sg) ** 2); k /= k[0] + 2 * k[1:].sum(); k = k.astype(np.float32)
        pad = np.pad(X, ((r, r), (0, 0)) if ax == 0 else ((0, 0), (r, r)), mode='edge'); sl = (lambda a: (slice(a, a + n), slice(None))) if ax == 0 else (lambda a: (slice(None), slice(a, a + n)))
        acc = pad[sl(r)] * k[0]
        for i in range(1, r + 1): acc += k[i] * (pad[sl(r - i)] + pad[sl(r + i)])
        X = acc
    return X

def _strips(Z, rows=512):
    """(a, b, S) for row strips [a, b) of the grid Z: S is the strip with one replicated neighbour row and column all round, float64, shape (b - a + 2, columns + 2)."""
    n = Z.shape[0]
    for a in range(0, n, rows):
        b = min(a + rows, n); S = np.asarray(Z[np.clip(np.arange(a - 1, b + 1), 0, n - 1)], np.float64); yield a, b, np.pad(S, ((0, 0), (1, 1)), mode='edge')
def curvature(Z, cy, cx, ridge):
    """Evans-Young curvature of Z: a 3x3 quadratic fit per post with the true cell sizes (r = d2z/dx2 east, t = d2z/dy2 north, s = d2z/dxdy, slopes p east and q north; Evans 1979, Zevenbergen and Thorne 1987, Pennock 1987, Wood 1996, Shary 2002).  The principal curvatures are the eigenvalues of [[r, s], [s, t]]: a crest bends down (lmin < 0), a trough bends up (lmax > 0).
    ridge: (kmax, plan) float32, kmax = max(0, -lmin) the bend of a crest, plan = (r q2 - 2 s p q + t p2) / (p2 + q2) (0 on level ground): negative where a contour bulges out like a spur, positive in a hollow.  Not ridge: (m, None), m = max(0, lmax) the bend of a trough."""
    out = np.zeros(Z.shape, np.float32); pl = np.zeros(Z.shape, np.float32) if ridge else None
    for a, b, S in _strips(Z):
        m = S.shape[1] - 2; v = lambda di, dj: S[1 + di:1 + di + b - a, 1 + dj:1 + dj + m]
        z1, z2, z3, z4, z5, z6, z7, z8, z9 = (v(-1, -1), v(-1, 0), v(-1, 1), v(0, -1), v(0, 0), v(0, 1), v(1, -1), v(1, 0), v(1, 1))
        r = (z1 + z3 + z4 + z6 + z7 + z9 - 2 * (z2 + z5 + z8)) / (3 * cx * cx); t = (z1 + z2 + z3 + z7 + z8 + z9 - 2 * (z4 + z5 + z6)) / (3 * cy * cy); s = (z3 + z7 - z1 - z9) / (4 * cx * cy)
        w = np.sqrt(((r - t) / 2) ** 2 + s * s); mid = (r + t) / 2
        if ridge:
            p = (z3 + z6 + z9 - z1 - z4 - z7) / (6 * cx); q = (z1 + z2 + z3 - z7 - z8 - z9) / (6 * cy); den = p * p + q * q; ok = den > 1e-18
            out[a:b] = np.maximum(0.0, w - mid); pl[a:b] = np.where(ok, (r * q * q - 2 * s * p * q + t * p * p) / np.where(ok, den, 1.0), 0.0)
        else: out[a:b] = np.maximum(0.0, mid + w)
    return out, pl
def _unit(X):
    lo, hi = float(X.min()), float(X.max()); return (X - lo) / np.float32(hi - lo) if hi > lo else np.zeros_like(X)

def relief(M, k, cell_y_m, cell_x_m):
    """The terrain generalisation: M (rows north to south, float32 metres, posts cell_y_m north-south and cell_x_m east-west) -> float32 of the same shape; M itself when the knobs are the identity (canon_relief None).  After the published method of Leonowicz, Jenny and Hurni (2010, Cartographica 45(1) 64-74; Cartographic Perspectives 67, 51-60): a base surface, a
    ridge weight and a valley weight from the curvature of low-passed copies, a flat mask from slope, a ridge-lifted and a valley-deepened copy of the base, blended by the mask.  G(X, s) is gauss(): sigma s posts.
      B = G(M, 0.4 detail).   wr: kmax of Z = G(M, 0.7 ridge_removal), rescaled 0..1, plus the plan curvature mapped to +-ridge_sharpness (a spur positive, a hollow negative, each over its own extreme), G(., 0.7), rescaled 0..1.
      ws: slope of M by central differences, G(., 0.4 detail), min(., T) / T with T = slope_threshold_deg, G(., 0.4 detail); T = 0 gives 1.   wv: the bend m of a trough in Z = G(M, 0.7 valley_removal), min(m / (valley_limit max m), 1), 0 where there is none.
      Hm = B (1 + ridge_gain wr), Hl = B (1 - valley_gain wv), out = ws Hm + (1 - ws) Hl: the factors act on absolute elevation, so sea level is the fixed point.  max_shift_m s: out = M + s tanh((out - M) / s), so no post moves s or more.  Heights, never colour: this is the one owner of the accentuation."""
    k = canon_relief(k)
    if k is None: return M
    cy, cx = cell_y_m, cell_x_m; M = np.asarray(M, np.float32); g = lambda X, s: gauss(X, s, cy, cx); det = 0.4 * k['detail']; B = g(M, det)
    if k['ridge_gain']:
        kmax, plan = curvature(g(M, 0.7 * k['ridge_removal']), cy, cx, True); pmax, pmin = float(plan.max()), float(plan.min()); plan = np.where(plan > 0, plan / pmax if pmax > 0 else 0.0, plan / -pmin if pmin < 0 else 0.0).astype(np.float32)
        wr = _unit(g(_unit(kmax) - np.float32(k['ridge_sharpness']) * plan, 0.7)); del kmax, plan; Hm = B * (1 + np.float32(k['ridge_gain']) * wr); del wr
    else: Hm = B
    if k['valley_gain']:
        m, _ = curvature(g(M, 0.7 * k['valley_removal']), cy, cx, False); top = float(m.max())
        wv = np.minimum(m / np.float32(k['valley_limit'] * top), 1) if top > 0 and k['valley_limit'] > 0 else np.zeros_like(m); del m; Hl = B * (1 - np.float32(k['valley_gain']) * wv); del wv
    else: Hl = B
    if Hm is Hl: out = np.array(B, np.float32)
    else:
        T = math.radians(k['slope_threshold_deg'])
        if T > 0:
            sl = np.zeros(M.shape, np.float32)
            for a, b, S in _strips(M): sl[a:b] = np.arctan(np.hypot((S[1:-1, 2:] - S[1:-1, :-2]) / (2 * cx), (S[:-2, 1:-1] - S[2:, 1:-1]) / (2 * cy)))
            ws = g(np.minimum(g(sl, det), np.float32(T)) / np.float32(T), det); del sl
        else: ws = np.ones(M.shape, np.float32)
        out = np.array(Hm, np.float32); out -= Hl; out *= ws; out += Hl
    del Hm, Hl
    if k['max_shift_m'] is not None: s = np.float32(k['max_shift_m']); out -= M; out /= s; np.tanh(out, out=out); out *= s; out += M
    return out

def raw_key(p): return cache_key('raw', sorted(tiles_for(p)), 3600)
def mosaic_key(p):
    """The identity of the terrain surface M' of a preset: the raw survey, the canonical relief knobs and the relief code version.  An absent and an all-neutral relief are one key."""
    return cache_key('mosaic.v2', raw_key(p), canon_relief(p.get('relief')), RELIEF_VERSION)

_raw, _mos, STATS = {}, {}, {}
def raw_mosaic(p):
    """The survey: the GLO-30 tiles covering the circle (bounding rows and columns) as one float32 array, cached as .npy per preset under raw_key; returns (array, lat_top, lon_left).  Missing tiles (open sea has no GLO-30 tile) are zero.  Read by relief() and raw_ground() alone."""
    key = (p['id'], raw_key(p))
    if key in _raw: return _raw[key]
    ts = tiles_for(p); las = [t[0] for t in ts]; los = [t[1] for t in ts]; lat_top = max(las) + 1; lon_left = min(los)
    c = B / f"mosaic-{p['id']}-{key[1]}.npy"
    if c.exists(): m = np.load(c, mmap_mode='r')
    else:
        rows = []
        for la in range(max(las), min(las) - 1, -1):
            rows.append(np.concatenate([tifffile.imread(tile_path(la, lo)) if tile_path(la, lo).exists() else np.zeros((3600, 3600), np.float32) for lo in range(min(los), max(los) + 1)], axis=1))
        m = np.concatenate(rows, axis=0).astype(np.float32); np.save(c, m)
    _raw[key] = (m, lat_top, lon_left); return _raw[key]
def cell_m(p):
    """(north-south, east-west) post spacing in metres of a preset's mosaic at its latitude: 21 m east-west against 31 m north-south at 47 N."""
    cy = 111320.0 / 3600.0; return cy, cy * math.cos(math.radians(p['lat']))
def _rss_mb():
    import resource; return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0
def mosaic(p):
    """The terrain surface M' every later stage reads: the survey through relief(), cached as .npy under mosaic_key (the survey itself when the relief is the identity).  Returns (M', lat_top, lon_left)."""
    key = (p['id'], mosaic_key(p))
    if key in _mos: return _mos[key]
    m, lt, ll = raw_mosaic(p); k = canon_relief(p.get('relief'))
    if k is not None:
        c = B / f"relief-{p['id']}-{key[1]}.npy"
        if not c.exists():
            t0 = time.time(); r = relief(m, k, *cell_m(p)); STATS.update(relief_s=time.time() - t0, relief_rss_mb=_rss_mb()); tmp = c.with_name(c.stem + '.tmp.npy'); np.save(tmp, r); os.replace(tmp, c); del r
        m = np.load(c, mmap_mode='r')
    _mos[key] = (m, lt, ll); return _mos[key]
def raw_ground(p):
    """The survey's own ground at the observer: for the report and the drift bound of configure alone, no stage reads the survey for geometry."""
    m, lt, ll = raw_mosaic(p); return float(cubic(m, lt, ll, np.array(p['lat']), np.array(p['lon'])))

def cubic(a, lat_top, lon_left, lat, lon):
    """Catmull-Rom bicubic sample of the grid a (16 taps) at lat, lon (arrays of one shape): it passes through every post and its gradient is continuous across cell edges (a bilinear read creases at every 30 m cell).  Taps beyond the grid replicate the edge."""
    y = (lat_top - np.asarray(lat, np.float64)) * 3600 - 0.5; x = (np.asarray(lon, np.float64) - lon_left) * 3600 - 0.5
    y0 = np.floor(y); x0 = np.floor(x); fy = y - y0; fx = x - x0; y0 = y0.astype(int); x0 = x0.astype(int)
    w = lambda f: (0.5 * (-f ** 3 + 2 * f ** 2 - f), 0.5 * (3 * f ** 3 - 5 * f ** 2 + 2), 0.5 * (-3 * f ** 3 + 4 * f ** 2 + f), 0.5 * (f ** 3 - f ** 2)); wy, wx = w(fy), w(fx); out = 0.0
    for j in range(4):
        yi = np.clip(y0 + j - 1, 0, a.shape[0] - 1)
        for i in range(4): out = out + wy[j] * wx[i] * a[yi, np.clip(x0 + i - 1, 0, a.shape[1] - 1)]
    return out

def surface(lat, lon):
    """The final terrain surface at lat, lon (arrays of one shape): the one reader the eye and the near march stand on.  It is the Catmull-Rom (cubic) read of the generalised mosaic M'; the erosion detail of cut-ridge-erosion-detail joins here, so the eye and every ground sample see the same surface."""
    m, lt, ll = mosaic(P); return cubic(m, lt, ll, lat, lon)

def configure(p):
    """Set the module state for a preset: observer, eye elevation (the final surface at the observer, ridge.surface, + eye height: never a stored altitude; prints the survey's ground, the generalised ground and the final ground, and refuses a generalised ground more than max_shift_m from the survey), rest azimuth (az_center: where the view looks at rest; the ring itself is absolute compass, column 0 = north)."""
    global P
    P = p; mosaic(p); g = float(surface(np.array(p['lat']), np.array(p['lon']))); rg = raw_ground(p); k = canon_relief(p.get('relief')); s = k and k['max_shift_m']
    print(f"{p['id']}: ground at the observer survey {rg:.1f} m, generalised {g:.1f} m, final {g:.1f} m (generalised {g - rg:+.1f} m from the survey)", file=sys.stderr, flush=True)
    if s is not None and abs(g - rg) > s: raise Refusal(f"preset {p['id']}: the generalised ground at the observer differs from the survey by {abs(g - rg):.1f} m, above max_shift_m {s:g}")
    P['ground_m'] = g; P['eye_m'] = g + p['eye_h_m']; P['ground_raw_m'] = rg; P['ground_gen_m'] = g
    if 'look_at' in p:
        la, lo = p['look_at']; P['az_center'] = (math.degrees(math.atan2((lo - p['lon']) * math.cos(math.radians(p['lat'])), la - p['lat'])) + 360) % 360
    else: P['az_center'] = p['az_deg']
    return P

def ring_cols(a, c0, n):
    """n columns of the ring array a (last axis W) from column c0 (negative or past W wraps): the one periodic take, the wrap at 0 / 360 degrees is handled here."""
    return np.take(a, (c0 + np.arange(n)) % W, axis=-1)

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
NEAR_CLIP_M = 500.0                    # authored: the far march's first sample and the boundary of parallax authority: coverage, seams, the encoding range, distance_m and r_max read terrain at or beyond it.  The ground under it is the near march (near_march), drawn by card 0 only
def schedule(detail):
    d = [NEAR_CLIP_M]
    while d[-1] < P['rmax_km'] * 1000:
        d.append(d[-1] + min(250.0, max(10.0 if detail else 40.0, 0.004 * d[-1])))
    return np.array(d)

def elev(h, d, curvature=True):
    """Elevation angle (degrees) of height h (m) at distance d (m) from the eye: Earth curvature with refraction.  The one formula of march and prefilter."""
    drop = d * d / (2 * R_EARTH) * (1 - KREF) if curvature else 0.0
    return np.degrees(np.arctan2(h - P['eye_m'] - drop, d))

def march(detail=False, curvature=True):
    m, lt, ll = mosaic(P); az = np.radians((np.arange(W) + 0.5) / W * 360.0); d = schedule(detail); cosl = math.cos(math.radians(P['lat']))
    A = np.zeros((len(d), W), np.float32); Hh = np.zeros_like(A); sa, ca = np.sin(az), np.cos(az)
    for k, dk in enumerate(d):
        lat = P['lat'] + dk * ca / 111320.0; lon = P['lon'] + dk * sa / (111320.0 * cosl)
        h = cubic(m, lt, ll, lat, lon)
        if detail and dk < DETAIL['fade_to_m']: h = h + detail_height(dk * sa, dk * ca, dk)
        A[k] = elev(h, dk, curvature); Hh[k] = h
    return d, A, Hh

def rays_key(detail):
    """Inputs of the ray march: observer, eye elevation, range, the DEM mosaic, the sample schedule (hashed as the array it produces), the Earth / refraction constants, the ring width, and (detail) the foreground detail noise."""
    return cache_key('rays.v2', KERNEL, P['lat'], P['lon'], P['rmax_km'], round(float(P['eye_m']), 3), mosaic_key(P), schedule(detail), R_EARTH, KREF, W, bool(detail),
                     (sorted(DETAIL.items()), LACUN, WEIGHT_GAIN, AMP_GAIN, CRAG) if detail else None)
def stage0(detail=False, force=False):
    c = B / f"rays-{P['id']}{'-detail' if detail else ''}-{rays_key(detail)}.npz"
    if c.exists() and not force:
        z = np.load(c); return z['d'], z['ang'], z['h'], None
    t0 = time.time(); mosaic(P); t1 = time.time(); d, A, Hh = march(detail); t2 = time.time(); np.savez(c, d=d, ang=A, h=Hh)
    return d, A, Hh, dict(mosaic=t1 - t0, march=t2 - t1, samples=len(d))

# ====================================================================== the near march: the ground under the near clip
NEAR_START_M = 1.0                     # authored: the ray of the frame bottom meets flat ground from a 1.6 m eye farther out than this; a 5 m start leaves a wall at grandcanyon h100, where the ground at 5 m stands 8 degrees up
def near_schedule():
    """Sample distances (m) of the near march: NEAR_START_M, then steps of max(1 m, 0.02 d) capped at 10 m, every sample below NEAR_CLIP_M (about 170)."""
    d = [NEAR_START_M]
    while d[-1] + min(10.0, max(1.0, 0.02 * d[-1])) < NEAR_CLIP_M: d.append(d[-1] + min(10.0, max(1.0, 0.02 * d[-1])))
    return np.array(d)
def near_march(sigma_m=0.0):
    """(d, a, h) of the ground under the near clip: the place's final terrain surface (ridge.surface), sampled along near_schedule() on all W columns in float64 (no cache: one pass is about 170 x 6400 samples), low-passed with the place's own prefilter (sigma_m = prefilter_m) like the far march."""
    az = np.radians((np.arange(W) + 0.5) / W * 360.0); d = near_schedule(); cosl = math.cos(math.radians(P['lat'])); sa, ca = np.sin(az), np.cos(az)
    h = np.stack([np.asarray(surface(P['lat'] + dk * ca / 111320.0, P['lon'] + dk * sa / (111320.0 * cosl)), np.float64) for dk in d]); a, h = prefilter(d, h, sigma_m)
    return d, a, h
def check_eye_clear(near):
    """Refuse a bake whose near ground stands at or above the eye at the first near sample (d <= NEAR_START_M, 1 m): a face steeper than about 58 degrees at the feet puts the eye inside a wall.  Uphill ground above eye level a few metres away is real on a hillside and stays under the 500 m outline (join_near's cap), so only the first sample counts."""
    d, a, h = near; hi = float(np.asarray(h)[np.asarray(d) <= NEAR_START_M].max())
    if hi >= P['eye_m']: raise Refusal(f"preset {P['id']}: the near ground {NEAR_START_M:g} m from the observer stands {hi:.1f} m, at or above the eye at {P['eye_m']:.1f} m: the eye is inside a wall")
def join_near(d, a, h, near):
    """The one join of the near march to the far march (d, a, h: (K, W), set_view done): returns (D, A, Hc, nrm) for cards, near samples first.  The near angles are capped per column at the angle of the far march's first sample, a[0]: the near ground draws inside the silhouette of the terrain at the clip
    and no near hill rises above it (ruling ridge-near-ground-outline).  The normals of the two marches are computed apart and concatenated, so the far normals are those of the far march alone.  Needs the whole ring (the cap and the lateral normal read ring columns): cut the tiles from the result."""
    dn, an, hn = near; a = np.asarray(a); an = np.minimum(an, a[0][None, :]); nn, nf = normals(dn, hn), normals(d, h)
    return np.concatenate([dn, d]), np.concatenate([an, a]), np.concatenate([hn, h]), tuple(np.concatenate([x, y]) for x, y in zip(nn, nf))

# ====================================================================== periodic helpers

# ====================================================================== prefilter: the march is a heightfield of roofs and hills; the cards want the hills
def prefilter(d, h, sigma_m):
    """Gaussian low-pass of the ray heights h (K, W): along each ray with sigma sigma_m metres (weighted by sample spacing, the schedule is not uniform), then across rays at equal distance with
    sigma = sigma_m / (d * COLW) columns (periodic, exact in the Fourier domain).  Angles are recomputed from the filtered heights with elev.  Returns (angles, heights); sigma_m 0 leaves the heights as they are."""
    d = np.asarray(d, np.float64); h = np.asarray(h, np.float64)
    if sigma_m > 0:
        f = np.fft.rfftfreq(h.shape[1]); sc = sigma_m / (d * COLW)
        h = np.fft.irfft(np.fft.rfft(h, axis=1) * np.exp(-2 * (np.pi * f[None, :] * sc[:, None]) ** 2), n=h.shape[1], axis=1)
        dd = np.gradient(d); out = np.empty_like(h)
        for k in range(len(d)):
            r = int(min(3 * sigma_m / dd[k] + 1, 60)); lo, hi = max(0, k - r), min(len(d), k + r + 1)
            w = np.exp(-0.5 * ((d[lo:hi] - d[k]) / sigma_m) ** 2) * dd[lo:hi]; out[k] = (w[:, None] * h[lo:hi]).sum(0) / w.sum()
        h = out
    return elev(h, d[:, None]), h

def normals(d, h):
    """Surface normal at every ray sample (n_r, n_t, n_up), each (K, W): n_r along the ray, n_t across it (towards increasing azimuth), n_up vertical.  The slopes are the ray's own dh/dd and the difference of the
    neighbouring columns at the SAME sample (equal distance, never equal row) over 2 d COLW, both times the authored vertical exaggeration PXDEG_V / HPX_DEG, so a face reads as steep as the view draws it."""
    d = np.asarray(d, np.float64); h = np.asarray(h, np.float64); E = PXDEG_V / HPX_DEG
    sr = E * np.gradient(h, d, axis=0); st = E * (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2 * d[:, None] * COLW); nz = 1.0 / np.sqrt(1 + sr * sr + st * st)
    return -sr * nz, -st * nz, nz

# ====================================================================== the authored Y mapping
GROUND_ROWS_MIN = 150                  # rows every bake keeps under the horizon: (1 - HORIZON_AT) x plane_h / RIDGE_BAND_FRAC of the runtime (view.ts groundRowsNeeded; ridgeAssets.test pins the two together)
E_MIN = 0.5                            # the vertical exaggeration may go down to this to keep GROUND_ROWS_MIN (ruling ridge-ground-rows-below-horizon)
def set_view(skyline, sky_row=0.04, near_row=0.66):
    """AUTHORED vertical mapping, linear in elevation angle: row = (TOP_DEG - angle) * PXDEG_V over the whole 600-row frame (cylindrical, horizontal 17.78 px/deg).  skyline is the highest angle any sample reaches in each
    ring column (W,), straight from the march.  Three anchors on the whole ring (rulings ridge-ring-vertical-anchors, ridge-ground-rows-below-horizon): the highest skyline angle of the ring sits at `sky_row` (4%) of the frame height, the LOWEST sits at
    `near_row` (66%) where the scale allows, and the horizon keeps GROUND_ROWS_MIN rows under it.  PXDEG_V = the lesser of (near_row - sky_row) * 600 / (highest - lowest) and (600 - GROUND_ROWS_MIN - sky_row * 600) / highest, clamped to
    [E_MIN, 10] x 17.78 px/deg = vertical exaggeration 0.5x..10x; a skyline whose highest angle cannot keep the ground rows even at E_MIN refuses (Refusal naming sky_deg, the scale needed and the floor).
    TOP_DEG = highest + sky_row*600/PXDEG_V;  BOTTOM_DEG = TOP_DEG - 600/PXDEG_V.  Returns the view, with `binds` naming the anchor that set the scale: 'skyline', 'horizon', 'floor' or 'ceiling'."""
    global rowang, PXDEG_V, TOP_DEG, BOTTOM_DEG
    sk = np.asarray(skyline); sky = float(sk.max()); low = float(sk.min()); lo, hi = E_MIN * HPX_DEG, 10 * HPX_DEG
    fit = (near_row - sky_row) * H / max(sky - low, 0.05); hold = (H - GROUND_ROWS_MIN - sky_row * H) / sky if sky > 0 else math.inf
    if hold < lo: raise Refusal(f"the whole-ring skyline reaches {sky:.2f} degrees: holding {GROUND_ROWS_MIN} rows under the horizon needs {hold:.2f} px/deg, below the floor {lo:.2f} px/deg ({E_MIN:g}x)")
    ppd = float(np.clip(min(fit, hold), lo, hi)); binds = 'horizon' if hold < fit and ppd == hold else 'floor' if ppd == lo else 'ceiling' if ppd == hi else 'skyline'
    PXDEG_V = ppd; TOP_DEG = sky + sky_row * H / ppd; BOTTOM_DEG = TOP_DEG - H / ppd; rowang = TOP_DEG - (np.arange(H) + 0.5) / PXDEG_V
    return dict(top_deg=TOP_DEG, bottom_deg=BOTTOM_DEG, px_per_deg=PXDEG_V, exaggeration=PXDEG_V / HPX_DEG, horizon_row=TOP_DEG * PXDEG_V, sky_deg=sky, low_deg=low, sky_row=sky_row, near_row=near_row, binds=binds)

# ====================================================================== coverage and seams
COV_BINS = 160                         # log-distance bins between the first and the last sample
SIG_B = 1.5                            # blur of the coverage along depth (bins): seams settle in gaps
SEAM_LAM, SEAM_UNARY = 2.0, 0.25       # forward energy: a seam that moves a bin between neighbouring columns pays SEAM_LAM per bin plus every visible row it sweeps; one that sits in visible terrain pays SEAM_UNARY x those rows (cross-fadable)
SEAM_PRIOR = 0.02                      # the authored depth is a faint pull, rows per nat^2 (the tests pin the window: six synthetic receding ridges, a sawtooth round the ring, tear at 0.05, and without the swept-rows term at 0.02 they tear too)
SEAM_SEP = 0.4                         # seams at least this far apart in log-distance (nat)
XF = 0.07                              # half-width of a seam's cross-fade, nat (about two bins)

def log_edges(d, nb=COV_BINS): L = np.log(np.asarray(d, np.float64)); return np.linspace(L[0], L[-1] + 1e-9, nb + 1)

def opaque(a):
    """Coverage 0..1 of every frame row by the opaque view of angles a (K, n): the share of the row's angular span under the column skyline."""
    p = 1.0 / PXDEG_V; lo = rowang - 0.5 * p; return np.clip((np.asarray(a, np.float64).max(0)[None, :] - lo[:, None]) / p, 0, 1)

def coverage(d, a, nb=COV_BINS):
    """(nb, n): rows of the opaque view first revealed by the samples of each log-distance bin, per column.  The first sample reveals every row from the frame bottom up to its angle, so the rows below it (nearer than it) count in bin 0.  Needs set_view."""
    a = np.asarray(a, np.float64); edges = log_edges(d, nb); kb = np.clip(np.searchsorted(edges, np.log(d), 'right') - 1, 0, nb - 1)
    runmax = np.maximum.accumulate(a, axis=0); prev = np.vstack([np.full((1, a.shape[1]), BOTTOM_DEG), runmax[:-1]])
    C = np.zeros((nb, a.shape[1])); np.add.at(C, kb, np.clip(np.minimum(a, TOP_DEG) - np.maximum(prev, BOTTOM_DEG), 0, None) * PXDEG_V)
    return C

def _dt(f, u):
    """out[i] = min_k f[k] + |u[i] - u[k]| along axis 0, u increasing: two cumulative-minimum passes (Felzenszwalb & Huttenlocher's L1 distance transform)."""
    u = u.reshape((-1,) + (1,) * (f.ndim - 1)); return np.minimum(np.minimum.accumulate(f - u, axis=0) + u, np.flip(np.minimum.accumulate(np.flip(f + u, 0), axis=0), 0) - u)

def seams(cov, targets, d):
    """(K, n) ordered seam distances (m), one per authored target (m), each column of a RING (cov is periodic: the last column neighbours the first).  One 1D forward-energy DP per seam, in target order (seam carving, Avidan & Shamir 2007; forward energy, Rubinstein et al. 2008): unary
    SEAM_UNARY x the rows at the seam; moving a bin between neighbouring columns costs SEAM_LAM per bin plus the rows swept, an L1 distance in u = cumsum(rows) + SEAM_LAM x bin; a weak prior to the target.  Seam k is held at
    least SEAM_SEP nat beyond seam k-1 in every column.  Sequential, not joint: a joint DP has NB^K states per column and seams in gaps do not interact.  Periodic: the DP runs over the ring three times side by side and keeps the middle lap,
    so a seam is continuous across the wrap and a tile boundary is only a crop."""
    cov = np.tile(np.asarray(cov, np.float64), (1, 3)); nb, n3 = cov.shape; n = n3 // 3; edges = log_edges(d, nb); bc = 0.5 * (edges[:-1] + edges[1:]); sep = int(math.ceil(SEAM_SEP / (edges[1] - edges[0]))); INF = 1e12
    r = int(3 * SIG_B) + 1; kern = np.exp(-0.5 * (np.arange(-r, r + 1) / SIG_B) ** 2); kern /= kern.sum(); pad = np.pad(cov, ((r, r), (0, 0)), mode='edge'); Cs = sum(kv * pad[i:i + nb] for i, kv in enumerate(kern))
    bins = np.arange(nb); lo = np.zeros(n3, int); out = np.zeros((len(targets), n3))
    for t, T in enumerate(targets):
        prior = SEAM_PRIOR * (bc - math.log(T)) ** 2; need = np.minimum(lo + (sep if t else 0), nb - 1); feas = bins[:, None] >= need[None, :]
        warp = lambda x: np.cumsum(0.5 * (cov[:, x - 1] + cov[:, x])) + SEAM_LAM * bins
        cost = np.where(feas[:, 0], SEAM_UNARY * Cs[:, 0] + prior, INF); store = [cost]
        for x in range(1, n3): cost = np.where(feas[:, x], _dt(cost, warp(x)) + SEAM_UNARY * Cs[:, x] + prior, INF); store.append(cost)
        j = np.zeros(n3, int); j[-1] = int(np.argmin(store[-1]))
        for x in range(n3 - 1, 0, -1): u = warp(x); j[x - 1] = int(np.argmin(store[x - 1] + np.abs(u - u[j[x]])))
        out[t] = np.exp(bc[j]); lo = j
    return out[:, n:2 * n]

# ====================================================================== cards: layered depth, one per band between seams
def load_material(name, path=Path(__file__).resolve().parent / 'places.json'):
    """The named material of places.json `materials` (its one owner), checked for shape; an unknown name is a Refusal, never a fallback.  A material: base rgb, ramps [{from_m, to_m, colour}] lerped over height in order, steep {colour} | None (the steep-face override), snow {from_m, to_m, colour} | None (gated by flatness)."""
    tab = json.load(open(path)).get('materials') or {}
    if name not in tab: raise Refusal(f"material {name!r} is not in places.json materials ({', '.join(sorted(tab)) or 'none'})")
    return check_material(tab[name], name)
def check_material(m, name='material'):
    """m itself if it has the shape of a places.json material, else a Refusal."""
    rgb = lambda c: isinstance(c, list) and len(c) == 3 and all(isinstance(v, (int, float)) and 0 <= v <= 1 for v in c)
    ok = isinstance(m, dict) and set(m) == {'base', 'ramps', 'steep', 'snow'} and rgb(m['base']) and isinstance(m['ramps'], list) and all(isinstance(r, dict) and set(r) == {'from_m', 'to_m', 'colour'} and r['from_m'] < r['to_m'] and rgb(r['colour']) for r in m['ramps'])
    ok = ok and (m['steep'] is None or (isinstance(m['steep'], dict) and set(m['steep']) == {'colour'} and rgb(m['steep']['colour']))) and (m['snow'] is None or (isinstance(m['snow'], dict) and set(m['snow']) == {'from_m', 'to_m', 'colour'} and m['snow']['from_m'] < m['snow']['to_m'] and rgb(m['snow']['colour'])))
    if not ok: raise Refusal(f"material {name!r} is malformed (base rgb, ramps [{{from_m < to_m, colour}}], steep {{colour}} | null, snow {{from_m < to_m, colour}} | null; rgb in 0..1)")
    return m
def albedo(h, n_up, material):
    """The contact sheet's evaluator, never a shipped pixel: a material (load_material) at height h and up-component n_up: the base colour, each ramp lerped by height in order, the steep colour where the face is steep, the snow colour above its band where the face is flat.  Straight colour, no light in it."""
    t = lambda a, b: np.clip((h - a) / (b - a), 0, 1)[..., None]; c = np.asarray(material['base'])
    for r in material['ramps']: c = c + (np.asarray(r['colour']) - c) * t(r['from_m'], r['to_m'])
    if material['steep']: c = c + (np.asarray(material['steep']['colour']) - c) * np.clip((0.93 - n_up) / 0.25, 0, 1)[..., None]
    sn = material['snow']
    return c + (np.asarray(sn['colour']) - c) * (t(sn['from_m'], sn['to_m']) * np.clip((n_up - 0.55) / 0.3, 0, 1)[..., None]) if sn else c

def cards(d, a, h, seams, nrm=None):
    """K+1 cards, nearest first, from the angles a and heights h (samples, n) of n columns and the (K, n) seams (m).  Card i holds per pixel the FIRST VISIBLE hit at or beyond seam i-1 (less XF): layered depth, so a farther
    card keeps the terrain a nearer ridge hides.  Its alpha is that pixel's coverage (a crest row holds the share of its angular span under the card's running maximum) times 1 - smoothstep over seam i +- XF in
    log-distance of the hit; card 0 owns the rows below the first sample, the last card has no far edge.  Alphas are then made nested so the alpha-over composite of all cards is exactly the opaque coverage (a row two
    cards both hold partly is not counted twice).  Distance and normal are interpolated between sample k-1 and k by angle.  Each card is cropped to the rows where its 8-bit alpha is not zero.
    The height h of the terrain surface at each pixel is output, never a colour (ruling ridge-place-colour-authored: the material is the client's).  nrm is normals(d, h) of the same columns (default: computed from h as given, so pass it for columns cut from the ring: the lateral slope reads the neighbouring columns).  Rows of any card below the angle of its first sample (hit and idx == 0) are its wall: they keep that sample's distance and height, and `wall` flags them (their normal is read face up) (card 0's first sample is the near march's NEAR_START_M, so no row of it is wall under a real frame).  Card 0 draws the near march (join_near; the samples nearer than NEAR_CLIP_M) under the silhouette of the terrain at the clip as ordinary terrain: its own normal and height; `near` (h, n) bool flags the pixels whose hit lies on the near side of the clip sample (the rows that were card 0's wall), whose distance is then never above the clip.  Each card: dict(top, alpha (h,n), h (h,n) metres, n_r, n_t, logd (ln metres) (h,n), wall (h,n) bool, near (h,n) bool)."""
    d = np.asarray(d, np.float64); a = np.asarray(a, np.float64); h = np.asarray(h, np.float64); seams = np.asarray(seams, np.float64); nk, n = a.shape; nc = len(seams) + 1
    if d[0] >= NEAR_CLIP_M: raise Refusal(f"card 0 draws the ground under the near clip from the near march, but the first sample is at {d[0]:g} m (the clip is {NEAR_CLIP_M:g} m): pass join_near")
    n_r, n_t, n_u = nrm if nrm is not None else normals(d, h); ld = np.broadcast_to(np.log(d)[:, None], (nk, n)); p = 1.0 / PXDEG_V; lo = rowang - 0.5 * p; kn = int(np.searchsorted(d, NEAR_CLIP_M))           # kn: the samples nearer than the clip
    ks0 = [np.searchsorted(d, seams[i - 1] * math.exp(-XF)) for i in range(1, nc)]; ks1 = [np.searchsorted(d, seams[i] * math.exp(XF)) for i in range(nc - 1)]
    F = np.zeros((nc, H, n)); X = np.ones((nc, H, n)); G = np.zeros((nc, 5, H, n)); Wl = np.zeros((nc, H, n), bool); Nr = np.zeros((nc, H, n), bool)           # coverage, far fade, then (logd, h, n_r, n_t, n_u); wall rows; near rows (the ground under the clip)
    for x in range(n):
        for i in range(nc):
            k0 = 0 if i == 0 else int(ks0[i - 1][x]); k1 = nk if i == nc - 1 else int(ks1[i][x])
            if k1 <= k0: continue
            rm = np.maximum.accumulate(a[k0:k1, x]); idx = np.searchsorted(rm, lo, 'right'); hit = idx < len(rm); idx = np.minimum(idx, len(rm) - 1); kk = k0 + idx
            if not hit.any(): continue
            kp = np.maximum(kk - 1, k0); prev = np.where(idx > 0, rm[np.maximum(idx - 1, 0)], rm[idx] - 1.0)
            t = np.where(idx > 0, np.clip((rowang - prev) / np.maximum(rm[idx] - prev, 1e-9), 0, 1), 1.0); mix = lambda arr: arr[kp, x] + t * (arr[kk, x] - arr[kp, x])
            F[i, :, x] = np.where(hit, np.clip((rm[-1] - lo) / p, 0, 1), 0); lh = mix(ld)
            G[i, :, :, x] = np.where(hit, np.stack([lh, mix(h), mix(n_r), mix(n_t), mix(n_u)]), 0)
            Wl[i, :, x] = hit & (idx == 0); Nr[i, :, x] = hit & (kp < kn)           # rows below the card's first sample: the extruded wall; hits on the near side of the clip sample (below it, or between the last near sample and it): the near ground (only card 0 reaches it)
            if i < nc - 1: s = np.clip((lh - (math.log(seams[i, x]) - XF)) / (2 * XF), 0, 1); X[i, :, x] = 1 - s * s * (3 - 2 * s)
    out = []; A = np.zeros((H, n))
    for i in range(nc):
        part = np.where(F[i] < 1, np.clip((np.maximum(A, F[i]) - A) / np.maximum(1 - A, 1e-6), 0, 1), F[i]); al = np.where(np.rint(X[i] * part * 255) > 0, X[i] * part, 0.0); A = 1 - (1 - A) * (1 - al)
        rows = np.flatnonzero(al.max(1) > 0)
        if not len(rows): out.append(dict(top=0, alpha=np.zeros((0, n), np.float32), h=np.zeros((0, n), np.float32), n_r=np.zeros((0, n), np.float32), n_t=np.zeros((0, n), np.float32), logd=np.zeros((0, n), np.float32), wall=np.zeros((0, n), bool), near=np.zeros((0, n), bool))); continue
        sl = slice(int(rows[0]), int(rows[-1]) + 1); g = G[i, :, sl]; nz = np.sqrt(g[2] ** 2 + g[3] ** 2 + g[4] ** 2) + 1e-12
        out.append(dict(top=int(rows[0]), alpha=al[sl].astype(np.float32), h=g[1].astype(np.float32), n_r=(g[2] / nz).astype(np.float32), n_t=(g[3] / nz).astype(np.float32), logd=g[0].astype(np.float32), wall=Wl[i, sl].copy(), near=Nr[i, sl].copy()))
    return out
