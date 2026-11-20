"""Ridge baker: the ray march of a place, cut into K+1 layered-depth G-buffer cards by K authored seams (places.json), no painter, no sun.
Offline baker for the ridge backdrop (scripts/ridge-bake); export.py drives it.

  load_preset(id) -> configure()  : observer, tiles, mosaic origin, ring radius, window azimuth, card splits and prefilter from places.json
  stage0(detail)                   : ray march of all 6400 azimuth columns (curvature+refraction), optional authored sub-DEM foreground detail, cached
  prefilter(d, h, sigma_m)         : Gaussian low-pass of the sampled heights (along each ray, across rays at equal distance), angles recomputed with elev
  set_view(skyline)                : authored Y mapping from the march skyline: angle -> row, see set_view
  coverage(d, a) / seams(cov, ..)  : visible rows per log-distance bin; one forward-energy seam per authored split, per column
  normals(d, h) / cards(...)       : per-sample normals; the K+1 cards (coverage, distance, normal, albedo), each cropped to its band of rows
Vertical exaggeration is AUTHORED and derived per view by set_view (printed on the page).  The client owns lighting, haze and ink (ruling ridge-cards-runtime-lit)."""
import sys, time, math, json
import os, hashlib
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
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

P = {}                                 # configured preset
rowang = np.zeros(H); PXDEG_V = 100.0; TOP_DEG = 2.6; BOTTOM_DEG = -3.4

def load_preset(pid, path=Path(__file__).resolve().parent / 'places.json'):
    """The preset dict.  tz is required, an IANA zone the system knows (the runtime draws named sky moments in the place's local day).  card_split_km is the ordered list of authored seam depths (km): required, strictly increasing, at most export.MAX_CARDS - 1 (the cap is export's, which owns the budget); refused here, before any march."""
    d = json.load(open(path)); p = dict(next(x for x in d['presets'] if x['id'] == pid)); sp = p.get('card_split_km')
    from export import MAX_CARDS
    if not sp: raise ValueError(f"preset {pid}: card_split_km is required (an ordered list of 1 to {MAX_CARDS - 1} depths in km)")
    if len(sp) > MAX_CARDS - 1 or any(b <= a for a, b in zip(sp, sp[1:])): raise ValueError(f"preset {pid}: card_split_km {sp} must be strictly increasing with at most {MAX_CARDS - 1} entries")
    tz = p.get('tz')
    if not isinstance(tz, str) or not tz: raise ValueError(f"preset {pid}: tz is required (an IANA time zone name such as Europe/Vienna)")
    try: ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError, OSError): raise ValueError(f"preset {pid}: tz {tz!r} is not a time zone the system knows")
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

def elev(h, d, curvature=True):
    """Elevation angle (degrees) of height h (m) at distance d (m) from the eye: Earth curvature with refraction.  The one formula of march and prefilter."""
    drop = d * d / (2 * R_EARTH) * (1 - KREF) if curvature else 0.0
    return np.degrees(np.arctan2(h - P['eye_m'] - drop, d))

def march(detail=False, curvature=True):
    m, lt, ll = mosaic(P); az = np.radians((np.arange(W) + 0.5) / W * 360.0); d = schedule(detail); cosl = math.cos(math.radians(P['lat']))
    A = np.zeros((len(d), W), np.float32); Hh = np.zeros_like(A); sa, ca = np.sin(az), np.cos(az)
    for k, dk in enumerate(d):
        lat = P['lat'] + dk * ca / 111320.0; lon = P['lon'] + dk * sa / (111320.0 * cosl)
        h = bil(m, lt, ll, lat, lon)
        if detail and dk < DETAIL['fade_to_m']: h = h + detail_height(dk * sa, dk * ca, dk)
        A[k] = elev(h, dk, curvature); Hh[k] = h
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
def set_view(skyline, sky_row=0.04, near_row=0.66):
    """AUTHORED vertical mapping, linear in elevation angle: row = (TOP_DEG - angle) * PXDEG_V over the whole 600-row frame (cylindrical, horizontal 17.78 px/deg).  skyline is the highest angle any sample reaches in each
    ring column (W,), straight from the march.  Two anchors: the highest skyline angle in the window sits at `sky_row` (4%) of the frame height, the LOWEST sits at `near_row` (66%); everything below is body and ground.
    PXDEG_V = (near_row - sky_row) * 600 / (highest - lowest), clamped to [17.78, 178] px/deg = vertical exaggeration 1x..10x.  TOP_DEG = highest + sky_row*600/PXDEG_V;  BOTTOM_DEG = TOP_DEG - 600/PXDEG_V."""
    global rowang, PXDEG_V, TOP_DEG, BOTTOM_DEG
    w = win(np.asarray(skyline)[None, :])[0]; sky = float(w.max()); low = float(w.min())
    ppd = float(np.clip((near_row - sky_row) * H / max(sky - low, 0.05), HPX_DEG, 10 * HPX_DEG))
    PXDEG_V = ppd; TOP_DEG = sky + sky_row * H / ppd; BOTTOM_DEG = TOP_DEG - H / ppd; rowang = TOP_DEG - (np.arange(H) + 0.5) / PXDEG_V
    return dict(top_deg=TOP_DEG, bottom_deg=BOTTOM_DEG, px_per_deg=PXDEG_V, exaggeration=PXDEG_V / HPX_DEG, horizon_row=TOP_DEG * PXDEG_V, sky_deg=sky, low_deg=low, sky_row=sky_row, near_row=near_row)

# ====================================================================== coverage and seams
COV_BINS = 160                         # log-distance bins between the first and the last sample
SIG_B = 1.5                            # blur of the coverage along depth (bins): seams settle in gaps
SEAM_LAM, SEAM_UNARY = 2.0, 0.25       # forward energy: a seam that moves a bin between neighbouring columns pays SEAM_LAM per bin plus every visible row it sweeps; one that sits in visible terrain pays SEAM_UNARY x those rows (cross-fadable)
SEAM_PRIOR = 0.02                      # the authored depth is a faint pull, rows per nat^2 (the test pins the window: six synthetic receding ridges tear at 0.1, and without the swept-rows term at 0.02 they tear again)
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
    """(K, n) ordered seam distances (m), one per authored target (m), each column.  One 1D forward-energy DP per seam, in target order (seam carving, Avidan & Shamir 2007; forward energy, Rubinstein et al. 2008): unary
    SEAM_UNARY x the rows at the seam; moving a bin between neighbouring columns costs SEAM_LAM per bin plus the rows swept, an L1 distance in u = cumsum(rows) + SEAM_LAM x bin; a weak prior to the target.  Seam k is held at
    least SEAM_SEP nat beyond seam k-1 in every column.  Sequential, not joint: a joint DP has NB^K states per column and seams in gaps do not interact."""
    cov = np.asarray(cov, np.float64); nb, n = cov.shape; edges = log_edges(d, nb); bc = 0.5 * (edges[:-1] + edges[1:]); sep = int(math.ceil(SEAM_SEP / (edges[1] - edges[0]))); INF = 1e12
    r = int(3 * SIG_B) + 1; kern = np.exp(-0.5 * (np.arange(-r, r + 1) / SIG_B) ** 2); kern /= kern.sum(); pad = np.pad(cov, ((r, r), (0, 0)), mode='edge'); Cs = sum(kv * pad[i:i + nb] for i, kv in enumerate(kern))
    bins = np.arange(nb); lo = np.zeros(n, int); out = np.zeros((len(targets), n))
    for t, T in enumerate(targets):
        prior = SEAM_PRIOR * (bc - math.log(T)) ** 2; need = np.minimum(lo + (sep if t else 0), nb - 1); feas = bins[:, None] >= need[None, :]
        warp = lambda x: np.cumsum(0.5 * (cov[:, x - 1] + cov[:, x])) + SEAM_LAM * bins
        cost = np.where(feas[:, 0], SEAM_UNARY * Cs[:, 0] + prior, INF); store = [cost]
        for x in range(1, n): cost = np.where(feas[:, x], _dt(cost, warp(x)) + SEAM_UNARY * Cs[:, x] + prior, INF); store.append(cost)
        j = np.zeros(n, int); j[-1] = int(np.argmin(store[-1]))
        for x in range(n - 1, 0, -1): u = warp(x); j[x - 1] = int(np.argmin(store[x - 1] + np.abs(u - u[j[x]])))
        out[t] = np.exp(bc[j]); lo = j
    return out

# ====================================================================== cards: layered depth, one per band between seams
GRASS, FOREST, ROCK, SNOW = (0.36, 0.44, 0.26), (0.22, 0.31, 0.20), (0.47, 0.44, 0.41), (0.93, 0.95, 0.97)
def albedo(h, n_up):
    """The authored material, a few numbers: valley green to forest to rock by height, rock where the face is steep, snow above the tree line.  Straight colour, no light in it."""
    t = lambda a, b: np.clip((h - a) / (b - a), 0, 1)[..., None]; c = np.asarray(GRASS) + (np.asarray(FOREST) - GRASS) * t(150, 900); c = c + (np.asarray(ROCK) - c) * t(1300, 2000)
    c = c + (np.asarray(ROCK) - c) * np.clip((0.93 - n_up) / 0.25, 0, 1)[..., None]; return c + (np.asarray(SNOW) - c) * (t(1900, 2300) * np.clip((n_up - 0.55) / 0.3, 0, 1)[..., None])

def cards(d, a, h, seams, nrm=None):
    """K+1 cards, nearest first, from the angles a and heights h (samples, n) of n columns and the (K, n) seams (m).  Card i holds per pixel the FIRST VISIBLE hit at or beyond seam i-1 (less XF): layered depth, so a farther
    card keeps the terrain a nearer ridge hides.  Its alpha is that pixel's coverage (a crest row holds the share of its angular span under the card's running maximum) times 1 - smoothstep over seam i +- XF in
    log-distance of the hit; card 0 owns the rows below the first sample, the last card has no far edge.  Alphas are then made nested so the alpha-over composite of all cards is exactly the opaque coverage (a row two
    cards both hold partly is not counted twice).  Distance and normal are interpolated between sample k-1 and k by angle.  Each card is cropped to the rows where its 8-bit alpha is not zero.
    nrm is normals(d, h) of the same columns (default: computed from h as given, so pass it for a window cut from the ring).  Rows of a card i > 0 below the angle of its first sample (hit and idx == 0) are the extruded wall of the ridge the card starts at: they keep that sample's distance, their albedo is the ground material at their height with the face up (n_up = 1),
    and `wall` flags them (card 0 has no wall: its rows below the first sample are the ground).  Each card: dict(top, alpha (h,n), albedo (h,n,3), n_r, n_t, logd (ln metres) (h,n), wall (h,n) bool)."""
    d = np.asarray(d, np.float64); a = np.asarray(a, np.float64); h = np.asarray(h, np.float64); seams = np.asarray(seams, np.float64); nk, n = a.shape; nc = len(seams) + 1
    n_r, n_t, n_u = nrm if nrm is not None else normals(d, h); ld = np.broadcast_to(np.log(d)[:, None], (nk, n)); p = 1.0 / PXDEG_V; lo = rowang - 0.5 * p
    ks0 = [np.searchsorted(d, seams[i - 1] * math.exp(-XF)) for i in range(1, nc)]; ks1 = [np.searchsorted(d, seams[i] * math.exp(XF)) for i in range(nc - 1)]
    F = np.zeros((nc, H, n)); X = np.ones((nc, H, n)); G = np.zeros((nc, 5, H, n)); Wl = np.zeros((nc, H, n), bool)           # coverage, far fade, then (logd, h, n_r, n_t, n_u); wall rows
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
            if i: Wl[i, :, x] = hit & (idx == 0)           # rows below the card's first sample: the extruded wall (card 0's are the ground)
            if i < nc - 1: s = np.clip((lh - (math.log(seams[i, x]) - XF)) / (2 * XF), 0, 1); X[i, :, x] = 1 - s * s * (3 - 2 * s)
    out = []; A = np.zeros((H, n))
    for i in range(nc):
        part = np.where(F[i] < 1, np.clip((np.maximum(A, F[i]) - A) / np.maximum(1 - A, 1e-6), 0, 1), F[i]); al = np.where(np.rint(X[i] * part * 255) > 0, X[i] * part, 0.0); A = 1 - (1 - A) * (1 - al)
        rows = np.flatnonzero(al.max(1) > 0)
        if not len(rows): out.append(dict(top=0, alpha=np.zeros((0, n), np.float32), albedo=np.zeros((0, n, 3), np.float32), n_r=np.zeros((0, n), np.float32), n_t=np.zeros((0, n), np.float32), logd=np.zeros((0, n), np.float32), wall=np.zeros((0, n), bool))); continue
        sl = slice(int(rows[0]), int(rows[-1]) + 1); g = G[i, :, sl]; nz = np.sqrt(g[2] ** 2 + g[3] ** 2 + g[4] ** 2) + 1e-12
        out.append(dict(top=int(rows[0]), alpha=al[sl].astype(np.float32), albedo=albedo(g[1], np.where(Wl[i, sl], 1.0, g[4] / nz)).astype(np.float32), n_r=(g[2] / nz).astype(np.float32), n_t=(g[3] / nz).astype(np.float32), logd=g[0].astype(np.float32), wall=Wl[i, sl].copy()))
    return out
