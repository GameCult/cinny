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

P = {}                                 # configured preset
rowang = np.zeros(H); PXDEG_V = 100.0; TOP_DEG = 2.6; BOTTOM_DEG = -3.4

def load_preset(pid, path=Path(__file__).resolve().parent / 'places.json'):
    d = json.load(open(path)); p = next(x for x in d['presets'] if x['id'] == pid); return dict(p)

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


