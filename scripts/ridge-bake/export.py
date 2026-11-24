"""Ridge backdrop export: bake a place with ridge.py and write its K+1 G-buffer cards as 32 azimuth tiles each (colour + geometry WebP per card per tile), a manifest v3 and the index.

  python3 -I scripts/ridge-bake/export.py <place-id> --tiles DIR --out public/ridge/ [--work DIR] [--sheet contact.png]
  python3 -I scripts/ridge-bake/export.py --write-schema          (rewrites ridge-bake.schema.json from SCHEMA below)

The runtime reads manifest.json (SCHEMA is its contract) and nothing else about the bake.  The ring is the whole 360 degrees (ruling ridge-camera-full-ring), absolute compass, column 0 = north, cut into TILES tiles of TILE_W columns plus an APRON of real neighbour
columns each side; the bake holds no camera: it ships each card tile's distance_m and camera.r_max_m, the largest offset the per-card linear slide can take (ruling ridge-offset-range-fit); the client lights the cards itself (ruling ridge-cards-runtime-lit).
The pure parts (budget, bake_id, index, schema check) import no baker; bake_place imports ridge, which needs RIDGE_TILES and RIDGE_WORK (main sets them from --tiles / --work), and so do validate_manifest and write_bake, which read ridge's NEAR_CLIP_M and GROUND_ROWS_MIN."""
import os, sys, json, math, shutil, hashlib, argparse, tempfile
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import numpy as np, imagecodecs

BAKER_VERSION = 6
RING_W = 6400                          # the ring's columns (ridge.W, asserted in bake_place): column c is at azimuth (c + 0.5) / RING_W x 360, column 0 = north
TILES = 32                             # azimuth tiles of the ring, each card cut into TILES files per kind (ruling ridge-camera-full-ring: the client loads the arc near its heading)
TILE_W = RING_W // TILES               # 200 columns = 11.25 degrees owned by a tile
APRON = 2                              # real neighbour columns each side in a tile's file: the client's ink pass and lighting read +-1 texel; the client crops it
LIT_W = TILE_W + 2                     # a lit canvas keeps one apron texel each side
TILE_DEG = 360.0 / TILES
MAX_CARDS = 6                          # per place; a card is cropped to its row band in every tile, which is what lets a livelier place have more
TILE_BYTES_MAX = 235_000               # every file of one tile (1.5 MB per 72 degrees, scaled to 11.25)
PLACE_BYTES_MAX = 7_500_000            # every file of the place
RESIDENT_BYTES_MAX = 20_000_000        # the lit canvases (4 B x LIT_W x band h per card) of the worst run of consecutive tiles, cyclic; the loader decodes one tile at a time, so the decode transient is not gated
HFOV_MAX_DEG = 72 / 1.1                # the widest viewport: a 16:9 viewport with 1.1 widths of plane (view.ts windowFor)
FIT_PX_MAX = 24.0                      # the per-card linear slide may err by this many card pixels over the viewport (provisional, tuned by eye: ruling ridge-offset-range-fit)
R_MAX_FLOOR_M = 25.0                   # a bake whose cards cannot take this offset is refused
PHI_STEPS = 24                         # the camera's angle on its circle against its heading, sampled by the r_max search
COVER_TOL = 0.02                       # the composite of a tile's cards may differ from the opaque view by this much of a pixel, nowhere more
WEBP_QUALITY = 80
SHEET_SKY = (0.80, 0.86, 0.94)         # the flat sky of the contact sheet
SHEET_LIGHT = (-0.35, 0.55, 0.76)      # the fixed light of the contact sheet in (along ray, across ray, up); the sheet is a look at the cards, the client lights the real thing
ATTRIBUTION = dict(
    credit_line='Contains modified Copernicus data: DEM © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.',
    licence='Copernicus DEM licence: free, full and open access, with the credit line shown',
    dem_source='Copernicus DEM GLO-30 (30 m)',
    url='https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model')

# ------------------------------------------------------------------------------------ schema (the one dict the schema file and the validator both come from)
_num, _int, _str = {'type': 'number'}, {'type': 'integer'}, {'type': 'string'}
_numnull = {'type': ['number', 'null']}
_tz = {'type': 'string', 'format': 'iana-tz'}   # an IANA zone the system knows, as ridge.load_preset requires; validate() checks it
def _obj(**props): return {'type': 'object', 'required': list(props), 'additionalProperties': False, 'properties': props}
def _objnull(**props): return dict(_obj(**props), type=['object', 'null'])
_file = _obj(file=_str, bytes=_int)
SCHEMA = {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'title': 'ridge-bake manifest v3 and index v1', '$defs': {
    'manifest': _obj(schema={'const': 3}, baker_version=_int, bake_id=_str,
        place=_obj(id=_str, name=_str, lat=_num, lon=_num, altitude_km=_num, eye_m=_num, tz=_tz),
        view=_obj(look_az_deg=_num, ring_w={'const': RING_W}, tile_w={'const': TILE_W}, tiles={'const': TILES}, apron={'const': APRON}, plane_h=_int, px_per_deg_h=_num, px_per_deg_v=_num, exaggeration=_num, horizon_row=_num, sky_row=_num, near_row=_num),
        curvature=_obj(r_earth_m=_num, k_ref=_num),
        encoding=_obj(log_d_min=_num, log_d_max=_num, normal={'const': 'rt8'}),
        camera=dict(_obj(r_max_m=_num, r_max_forward_m=_num), description="r_max_m (every camera angle on its circle) and r_max_forward_m (the camera on its heading) are the offsets up to which the linear slide holds (the fit error at most FIT_PX_MAX card px) for the NEAREST solid terrain (at or beyond the near clip, ridge.NEAR_CLIP_M, 500 m) that each card draws in each tile, not for the tile's median distance_m; a tile that draws only skirt rows (wall) has no such terrain and binds nothing. Nothing nearer than the clip is baked as terrain, so they are no measure of the ground under it."),
        cards={'type': 'array', 'minItems': 1, 'maxItems': MAX_CARDS, 'items': _obj(near_m=_numnull, far_m=_numnull),
            'description': "nearest first; the runtime paints the list last to first.  near_m and far_m are the median seam depths over the ring, null at the ends."},
        tiles={'type': 'array', 'minItems': TILES, 'maxItems': TILES, 'items': {'type': 'array', 'minItems': 1, 'maxItems': MAX_CARDS, 'items': _objnull(top=_int, h=_int, distance_m=_num, colour=_file, geometry=_file)},
            'description': "tiles[t][i] is card i in tile t, or null where the card holds nothing in that tile (the client takes its distance from the neighbouring tiles).  Tile t owns the ring columns [tile_w t, tile_w (t + 1)), column c at azimuth (c + 0.5) / ring_w x 360, 0 = north; its files hold [tile_w t - apron, tile_w (t + 1) + apron), wrapping at the ring's end, and are tile_w + 2 apron columns wide.  top and h place the card's band back at its rows of the frame; distance_m = exp(median ln d) of the card's solid pixels in the tile that are not wall (the interior tile_w columns)."},
        bytes=_int,
        attribution=_obj(credit_line=_str, licence=_str, dem_source=_str, url=_str)),
    'index': _obj(schema={'const': 1}, default=_str, places={'type': 'object', 'additionalProperties': _str})}}
def tile_file(i, t, kind): return f'card-{i}-t{t:02d}-{kind}.webp'

def validate(x, s, path='$'):
    """The subset of JSON Schema SCHEMA uses; raises ValueError naming the path."""
    if '$ref' in s: return validate(x, SCHEMA['$defs'][s['$ref'].split('/')[-1]], path)
    tys = s.get('type'); tys = [tys] if isinstance(tys, str) else tys; py = {'object': dict, 'array': list, 'string': str, 'number': (int, float), 'integer': int, 'null': type(None)}
    if tys and not any(isinstance(x, py[t]) and not (isinstance(x, bool) and t != 'null') for t in tys): raise ValueError(f'{path}: not a {"/".join(tys)}')
    if s.get('format') == 'iana-tz':
        try: ZoneInfo(x)
        except (ZoneInfoNotFoundError, ValueError, OSError): raise ValueError(f'{path}: {x!r} is not a time zone the system knows')
    if 'const' in s and x != s['const']: raise ValueError(f"{path}: must be {s['const']!r}")
    if 'enum' in s and x not in s['enum']: raise ValueError(f'{path}: not one of {s["enum"]}')
    if 'maximum' in s and x > s['maximum']: raise ValueError(f'{path}: above {s["maximum"]}')
    if isinstance(x, list):
        if not s.get('minItems', 0) <= len(x) <= s.get('maxItems', 1 << 30): raise ValueError(f'{path}: wrong length')
        for i, v in enumerate(x): validate(v, s['items'], f'{path}[{i}]')
    if isinstance(x, dict):
        props = s.get('properties', {}); extra = s.get('additionalProperties', True)
        for k in s.get('required', []):
            if k not in x: raise ValueError(f'{path}: missing {k}')
        for k, v in x.items():
            if k in props: validate(v, props[k], f'{path}.{k}')
            elif extra is False: raise ValueError(f'{path}: extra key {k}')
            elif isinstance(extra, dict): validate(v, extra, f'{path}.{k}')

def validate_manifest(m):
    """The schema plus what it cannot say: the plane keeps ridge.GROUND_ROWS_MIN rows under the horizon, every tile lists one entry per card, every card holds something in some tile, each file is named for its card and tile, bytes is the sum of the files."""
    import ridge
    validate(m, SCHEMA['$defs']['manifest']); k = len(m['cards']); v = m['view']
    if v['plane_h'] - v['horizon_row'] < ridge.GROUND_ROWS_MIN - 1e-6: raise ValueError(f"$.view: {v['plane_h'] - v['horizon_row']:.1f} rows under the horizon, below the {ridge.GROUND_ROWS_MIN} the runtime needs (ridge.GROUND_ROWS_MIN)")
    for t, row in enumerate(m['tiles']):
        if len(row) != k: raise ValueError(f'$.tiles[{t}]: {len(row)} entries for {k} cards')
        for i, e in enumerate(row):
            for kind in (('colour', 'geometry') if e else ()):
                if e[kind]['file'] != tile_file(i, t, kind): raise ValueError(f'$.tiles[{t}][{i}].{kind}: file {e[kind]["file"]!r} is not {tile_file(i, t, kind)!r}')
    for i in range(k):
        if all(row[i] is None for row in m['tiles']): raise ValueError(f'card {i} is null in every tile')
    if m['bytes'] != sum(e[kind]['bytes'] for row in m['tiles'] for e in row if e for kind in ('colour', 'geometry')): raise ValueError('bytes is not the sum of the files')

# ------------------------------------------------------------------------------------ cards -> bytes
def u8(a): return np.clip(np.rint(np.asarray(a) * 255.0), 0, 255).astype(np.uint8)
def encode_colour(albedo, alpha):
    """Lossy RGB albedo with lossless alpha coverage, straight (not premultiplied); the colour under a zero alpha is zeroed."""
    a = u8(alpha); rgb = u8(albedo) * (a[..., None] > 0); return bytes(imagecodecs.webp_encode(np.dstack([rgb, a]), level=WEBP_QUALITY, lossless=False))
def encode_geometry(n_r, n_t, logd, enc, wall=None):
    """Lossless, opaque RGB: R, G = (n_r + 1) / 2, (n_t + 1) / 2 ('rt8'), B = the log-distance normalised between enc log_d_min and log_d_max.  Wall pixels (the extruded face under a ridge; wall (h, w) bool) write R = G = 255: a code outside the unit disc
    that no real normal reaches (real r2 + t2 peaks at 0.998), which the runtime reads as 'normal up, no crease'."""
    b = (np.asarray(logd) - enc['log_d_min']) / (enc['log_d_max'] - enc['log_d_min']); r, t = u8((np.asarray(n_r) + 1) / 2), u8((np.asarray(n_t) + 1) / 2)
    if wall is not None: m = np.asarray(wall, bool); r, t = np.where(m, 255, r).astype(np.uint8), np.where(m, 255, t).astype(np.uint8)
    return bytes(imagecodecs.webp_encode(np.dstack([r, t, u8(b)]), lossless=True))
def decode(b):
    """A WebP's bytes as RGBA uint8; the codec returns RGB for an image that is opaque everywhere, which is solid."""
    a = imagecodecs.webp_decode(b)
    return a if a.shape[-1] == 4 else np.concatenate([a, np.full(a.shape[:2] + (1,), 255, np.uint8)], -1)

def composite_alpha(cards, h, w):
    """Coverage of the alpha-over of all cards, each (top, rgba uint8 or float alpha (rows, w)) placed at its rows of an h x w frame."""
    clear = np.ones((h, w))
    for top, al in cards: clear[top:top + al.shape[0]] *= 1 - np.asarray(al, np.float64)
    return 1 - clear
def check_cover(cards, opaque, tol=COVER_TOL):
    """Refuse a bake whose cards, alpha-over, differ from the opaque view's coverage by more than tol anywhere: a hole shows the sky through terrain, an excess is a ghost.  cards: [(top, alpha 0..1 (rows, w))], opaque (h, w)."""
    err = np.abs(composite_alpha(cards, *opaque.shape) - opaque); bad = err > tol
    if bad.any(): y, x = np.unravel_index(int(np.argmax(err)), err.shape); raise ValueError(f'the cards do not composite to the opaque view within {tol}: {int(bad.sum())} pixels differ, worst {err.max():.3f} at x={x} row {y}')

def run_tiles(r_max_m, rmin_m):
    """N, the consecutive tiles the loader keeps resident: the viewport arc at the smallest slide rate plus the offset's own swing (arc_max = HFOV_MAX_DEG / s_min + 2 (r_max / Rmin) 57.3 degrees, s_min = Rmin / (Rmin + r_max)), one straddled tile and two tiles of margin each side."""
    s_min = rmin_m / (rmin_m + r_max_m); arc = HFOV_MAX_DEG / s_min + 2 * (r_max_m / rmin_m) * 57.3
    return min(TILES, math.ceil(arc / TILE_DEG) + 1 + 4)
def resident_bytes(bands, n):
    """The lit canvases (4 bytes x LIT_W x band rows, per card) of the worst run of n consecutive tiles of the ring, wrapping.  bands[t]: the row counts of the cards that tile holds."""
    per = [sum(4 * LIT_W * h for h in b) for b in bands]; n = min(n, TILES)
    return max(sum(per[(t + k) % TILES] for k in range(n)) for t in range(TILES))
def check_budget(n_cards, tile_bytes, bands, r_max_m, rmin_m):
    """Refuse a bake the runtime could not hold: more than MAX_CARDS cards, a tile whose files together are above TILE_BYTES_MAX, every file of the place above PLACE_BYTES_MAX, or the worst run of run_tiles(r_max_m, rmin_m) consecutive tiles lit above RESIDENT_BYTES_MAX."""
    if n_cards > MAX_CARDS: raise ValueError(f'{n_cards} cards, above {MAX_CARDS}')
    for t, b in enumerate(tile_bytes):
        if b > TILE_BYTES_MAX: raise ValueError(f'tile {t} is {b} bytes, above {TILE_BYTES_MAX}')
    if sum(tile_bytes) > PLACE_BYTES_MAX: raise ValueError(f'the place is {sum(tile_bytes)} bytes, above {PLACE_BYTES_MAX}')
    n = run_tiles(r_max_m, rmin_m); res = resident_bytes(bands, n)
    if res > RESIDENT_BYTES_MAX: raise ValueError(f'{n} consecutive tiles light to {res} bytes, above {RESIDENT_BYTES_MAX}')

FIT_QUAD = 48                          # Gauss-Legendre nodes for the least-squares line (exact for the smooth alpha(beta) to far below a card pixel)
FIT_GRID = 513                         # points the worst error is looked for on, ends included: the error is smooth between them, so the maximum found is within 0.01 card px of the continuous one
def fit_px(d, r, px_per_deg, phis=None):
    """The worst error, in card pixels, of a card tile's linear slide at offset r (m): over the camera's angle phi on its circle against its heading (`phis` steps, PHI_STEPS by default; 1 is phi = 0 alone, the camera pushed forward along its heading) and the viewport (beta in +-HFOV_MAX_DEG / 2), the exact view angle of a cylinder point at the tile's
    distance d, alpha = atan2(d sin beta - r sin phi, d cos beta - r cos phi), against the continuous least-squares line a + s beta over the viewport (ruling ridge-offset-range-fit; the line by quadrature, the error on FIT_GRID points: it is the continuous worst error, not the error of a few samples)."""
    half = math.radians(HFOV_MAX_DEG) / 2; p = np.linspace(0, 2 * math.pi, PHI_STEPS if phis is None else phis, endpoint=False)[:, None]
    alpha = lambda b: np.arctan2(d * np.sin(b) - r * np.sin(p), d * np.cos(b) - r * np.cos(p)); x, w = np.polynomial.legendre.leggauss(FIT_QUAD); bq = half * x[None, :]; A = alpha(bq)
    a0 = (A * w).sum(-1, keepdims=True) / 2; s = (A * bq * w).sum(-1, keepdims=True) / (bq * bq * w).sum(); b = np.linspace(-half, half, FIT_GRID)[None, :]
    return math.degrees(float(np.abs(alpha(b) - (a0 + s * b)).max())) * px_per_deg
def fit_table(dist, r, px_per_deg, phis=None):
    """(tiles, cards) fit_px of every card tile at offset r; nan where the card is null in that tile."""
    return np.array([[np.nan if d is None else fit_px(d, r, px_per_deg, phis) for d in row] for row in dist])
def solve_r_max(dist, bands, px_per_deg, phis=None):
    """dist: [tiles][cards] the distance of the NEAREST solid terrain each card draws in each tile (None where it draws none): the line of a tile is fitted for one distance but its terrain spans many, and the nearest is where the slide errs most (ruling ridge-offset-range-fit, up to where the linear map holds).
    The largest offset r (m, down to 0.1 m) at which every card tile fits within FIT_PX_MAX over `phis` camera angles (PHI_STEPS: the whole circle, the offset-only rotation mode; 1: phi = 0 alone, the modes where the offset turns with the view) and the resident gate holds: never above half the nearest card's smallest tile distance.  Scans r upward from 0 on 128 steps to the first failure, then bisects that step.
    Refuses (naming the card and tile that bind) a bake whose r_max_m is below R_MAX_FLOOR_M."""
    near = min((row[0], t) for t, row in enumerate(dist) if row[0] is not None); rmin = near[0]; cap = 0.5 * rmin
    ok = lambda r: bool(np.nanmax(fit_table(dist, r, px_per_deg, phis)) <= FIT_PX_MAX) and resident_bytes(bands, run_tiles(r, rmin)) <= RESIDENT_BYTES_MAX
    lo, hi = 0.0, None
    for r in np.linspace(0, cap, 129)[1:]:
        if ok(r): lo = float(r)
        else: hi = float(r); break
    if hi is None: lo = cap
    else:
        for _ in range(24):
            mid = 0.5 * (lo + hi)
            if ok(mid): lo = mid
            else: hi = mid
    r_max = math.floor(lo * 10) / 10
    if r_max < R_MAX_FLOOR_M:
        if cap < R_MAX_FLOOR_M: raise ValueError(f'r_max_m {r_max:g} is below {R_MAX_FLOOR_M:g} m: card 0 stands {rmin:.0f} m away in tile {near[1]} and the offset stays under half of that')
        tb = fit_table(dist, R_MAX_FLOOR_M, px_per_deg, phis); t, i = np.unravel_index(int(np.nanargmax(tb)), tb.shape)
        if tb[t, i] > FIT_PX_MAX: raise ValueError(f'r_max_m {r_max:g} is below {R_MAX_FLOOR_M:g} m: card {i} in tile {t} errs {tb[t, i]:.1f} card px at {R_MAX_FLOOR_M:g} m (the bound is {FIT_PX_MAX:g})')
        n = run_tiles(R_MAX_FLOOR_M, rmin); raise ValueError(f'r_max_m {r_max:g} is below {R_MAX_FLOOR_M:g} m: at {R_MAX_FLOOR_M:g} m, {n} consecutive tiles light to {resident_bytes(bands, n)} bytes, above {RESIDENT_BYTES_MAX}')
    return r_max

BAKE_ID_BLANK = '0' * 12
def bake_id(manifest_text, files):
    """First 12 hex of sha256 over the whole bake: the manifest.json text as written with its bake_id value BAKE_ID_BLANK (the id cannot hash itself), then the tile files, tile-major then card, colour then geometry (a null card tile writes none), so any change to the manifest or a tile is a new directory.
    files: [(colour bytes, geometry bytes)] in that order."""
    h = hashlib.sha256(); h.update(manifest_text.encode('utf-8'))
    for colour, geometry in files: h.update(colour); h.update(geometry)
    return h.hexdigest()[:12]

def write_bake(out, place, view, meta, packed, opaque, default=None):
    """Write out/<place>-<bake_id>/ (tile WebPs + manifest.json; the id addresses both), rewrite out/index.json, delete the place's previous dir.  packed: dict(cards [dict(near_m, far_m)], tiles [TILES][cards] of dict(top, colour bytes, geometry bytes, distance_m) or None,
    camera dict(r_max_m, r_max_forward_m)); opaque: TILES arrays (plane_h, TILE_W + 2 APRON), each the opaque view's coverage over a tile's columns.  Refuses before writing a bake whose files decode to the wrong size, leave the frame, break a budget (the resident gate at r_max_m and at r_max_forward_m) or composite
    away from the opaque view in any tile.  meta: dict(curvature, encoding).  Returns the directory."""
    cards, tiles, camera = packed['cards'], packed['tiles'], packed['camera']; k = len(cards); h = view['plane_h']; w = TILE_W + 2 * APRON
    if len(tiles) != TILES or len(opaque) != TILES or any(len(row) != k for row in tiles): raise ValueError(f'the bake needs {TILES} tiles of {k} cards each')
    for i in range(k):
        if all(row[i] is None for row in tiles): raise ValueError(f'card {i} is null in every tile')
    dec = [[None if e is None else (decode(e['colour']), decode(e['geometry'])) for e in row] for row in tiles]; bands = [[pair[0].shape[0] for pair in row if pair] for row in dec]; tile_bytes = []
    for t, (row, drow) in enumerate(zip(tiles, dec)):
        tile_bytes.append(sum(len(e['colour']) + len(e['geometry']) for e in row if e))
        for i, (e, pair) in enumerate(zip(row, drow)):
            if e is None: continue
            c, g = pair
            if c.shape[:2] != g.shape[:2]: raise ValueError(f'tile {t} card {i}: colour and geometry are not one size')
            if c.shape[1] != w: raise ValueError(f'tile {t} card {i} is {c.shape[1]} columns wide, not {w} (tile {TILE_W} + 2 apron {APRON})')
            if c.shape[0] < 1 or e['top'] < 0 or e['top'] + c.shape[0] > h: raise ValueError(f'tile {t} card {i} leaves the {h} rows of the frame')
        if opaque[t].shape != (h, w): raise ValueError(f'tile {t}: the opaque view is {opaque[t].shape}, the frame {(h, w)}')
    import ridge
    rmin = min(row[0]['distance_m'] for row in tiles if row[0])   # distance_m is exp of a float32 log: it lands a few parts in 1e7 off the clip, so the compare keeps 1e-5 of slack
    if rmin < ridge.NEAR_CLIP_M * (1 - 1e-5): raise ValueError(f'card 0 stands {rmin:.1f} m away, nearer than the near clip {ridge.NEAR_CLIP_M:g} m: nothing nearer is baked as terrain')
    if camera['r_max_forward_m'] < camera['r_max_m']: raise ValueError(f"r_max_forward_m {camera['r_max_forward_m']:g} is below r_max_m {camera['r_max_m']:g}: phi = 0 is one of the angles r_max_m holds for")
    for r in (camera['r_max_m'], camera['r_max_forward_m']): check_budget(k, tile_bytes, bands, r, rmin)
    for t, (row, drow) in enumerate(zip(tiles, dec)):
        try: check_cover([(e['top'], pair[0][..., 3] / 255.0) for e, pair in zip(row, drow) if e], opaque[t])
        except ValueError as ex: raise ValueError(f'tile {t}: {ex}')
    out = Path(out)
    manifest = dict(schema=3, baker_version=BAKER_VERSION, bake_id=BAKE_ID_BLANK, place=place, view=dict(view, ring_w=RING_W, tile_w=TILE_W, tiles=TILES, apron=APRON), curvature=meta['curvature'], encoding=dict(meta['encoding'], normal='rt8'), camera=dict(r_max_m=camera['r_max_m'], r_max_forward_m=camera['r_max_forward_m']),
                    cards=[dict(near_m=c['near_m'], far_m=c['far_m']) for c in cards],
                    tiles=[[None if e is None else dict(top=e['top'], h=pair[0].shape[0], distance_m=e['distance_m'], colour=dict(file=tile_file(i, t, 'colour'), bytes=len(e['colour'])), geometry=dict(file=tile_file(i, t, 'geometry'), bytes=len(e['geometry'])))
                             for i, (e, pair) in enumerate(zip(row, drow))] for t, (row, drow) in enumerate(zip(tiles, dec))], bytes=sum(tile_bytes), attribution=ATTRIBUTION)
    validate_manifest(manifest); text = json.dumps(manifest, indent=1) + '\n'; blank = f'"bake_id": "{BAKE_ID_BLANK}"'; assert text.count(blank) == 1
    bid = bake_id(text, [(e['colour'], e['geometry']) for row in tiles for e in row if e]); name = f"{place['id']}-{bid}"; dest = out / name; text = text.replace(blank, f'"bake_id": "{bid}"')
    out.mkdir(parents=True, exist_ok=True); tmp = Path(tempfile.mkdtemp(dir=out, prefix='.bake-'))
    for t, row in enumerate(tiles):
        for i, e in enumerate(row):
            if e: (tmp / tile_file(i, t, 'colour')).write_bytes(e['colour']); (tmp / tile_file(i, t, 'geometry')).write_bytes(e['geometry'])
    (tmp / 'manifest.json').write_bytes(text.encode('utf-8'))   # bytes, so the platform's newline cannot move the file under its id
    idx_path = out / 'index.json'; idx = json.loads(idx_path.read_text()) if idx_path.exists() else dict(schema=1, default=place['id'], places={})
    old = idx['places'].get(place['id']); idx['places'][place['id']] = name; idx['default'] = default or (idx['default'] if idx['default'] in idx['places'] else place['id'])
    validate(idx, SCHEMA['$defs']['index'])
    if dest.exists(): shutil.rmtree(dest)
    os.rename(tmp, dest); (out / '.index.tmp').write_bytes((json.dumps(idx, indent=1) + '\n').encode('utf-8')); os.replace(out / '.index.tmp', idx_path)
    if old and old != name: shutil.rmtree(out / old, ignore_errors=True)
    return dest

# ------------------------------------------------------------------------------------ the bake
def cut_ring(d, a, h, splits_km):
    """The ring cut of a prefiltered march (set_view done): normals, coverage, the periodic seams on all RING_W columns, then ridge.cards per tile on its TILE_W + 2 APRON columns with the matching normals.  Returns dict(cards [TILES][cards] (ridge.cards arrays),
    splits_km, seams (K, ring) in m, cov (bins, ring), opaque [TILES] (rows, TILE_W + 2 APRON) coverage, edges)."""
    import ridge
    nrm = ridge.normals(d, h); cov = ridge.coverage(d, a); sm = ridge.seams(cov, [k * 1000.0 for k in splits_km], d); op = ridge.opaque(a); cols = lambda x, t: ridge.ring_cols(x, t * TILE_W - APRON, TILE_W + 2 * APRON); tiles = []
    for t in range(TILES): tiles.append(ridge.cards(d, cols(a, t), cols(h, t), cols(sm, t), tuple(cols(x, t) for x in nrm))); print(f'tile {t + 1}/{TILES}', file=sys.stderr, flush=True)
    return dict(cards=tiles, splits_km=list(splits_km), seams=sm, cov=cov, opaque=[cols(op, t) for t in range(TILES)], edges=ridge.log_edges(d))

def bake_place(pid):
    """stage 0, prefilter, set_view on the whole ring, cut_ring: dict(place, view, meta, v, and cut_ring's cards, splits_km, seams, cov, opaque, edges).  Needs RIDGE_TILES / RIDGE_WORK."""
    import ridge
    assert ridge.W == RING_W and ridge.H > 0
    p = ridge.configure(ridge.load_preset(pid)); ridge.mosaic(p); d, _, Hh, _ = ridge.stage0(False); a, h = ridge.prefilter(d, Hh, p.get('prefilter_m', 0)); v = ridge.set_view(a.max(0)); ring = cut_ring(d, a, h, p['card_split_km'])
    place = dict(id=p['id'], name=p['name'], lat=p['lat'], lon=p['lon'], altitude_km=p['ground_m'] / 1000.0, eye_m=p['eye_m'], tz=p['tz'])
    view = dict(look_az_deg=p['az_center'], plane_h=ridge.H, px_per_deg_h=ridge.HPX_DEG, px_per_deg_v=v['px_per_deg'], exaggeration=v['exaggeration'], horizon_row=v['horizon_row'], sky_row=v['sky_row'] * ridge.H, near_row=v['near_row'] * ridge.H)
    meta = dict(curvature=dict(r_earth_m=ridge.R_EARTH, k_ref=ridge.KREF), encoding=dict(log_d_min=math.log(d[0]), log_d_max=math.log(d[-1])))
    return dict(place=place, view=view, meta=meta, v=v, **ring)

def pack(bake):
    """The tiles of a bake as bytes plus their manifest facts.  Per card tile: distance_m = exp(median ln d) over the solid (alpha >= 0.5) pixels that are not wall of the interior TILE_W columns (a tile with none falls back to its non-wall, then any, lit pixels);
    a card with no rows in a tile is null there.  Per card: the median seam depths over the ring.  camera.r_max_m: solve_r_max over the NEAREST solid non-wall pixel of each card tile (not its median distance_m; a tile that draws only wall, the skirt, has none and binds nothing) and every camera angle on its circle (the offset-only rotation mode), camera.r_max_forward_m: the same at phi = 0 alone (the modes where the offset turns with the view).  Refuses a card empty in every tile (naming the splits) and a card with
    no solid terrain apart from its wall in any tile.  Returns dict(cards, tiles, camera, report) (report is printed, not written)."""
    sm = bake['seams']; sp = bake['splits_km']; k = len(sp) + 1; ppd = bake['view']['px_per_deg_h']; inner = slice(APRON, APRON + TILE_W); enc = bake['meta']['encoding']
    for i in range(k):
        if all(tile[i]['alpha'].shape[0] == 0 for tile in bake['cards']): raise ValueError(f"card {i} is empty: it lies between the splits {' and '.join(f'{sp[j]:g} km' for j in (i - 1, i) if 0 <= j < len(sp))} (card_split_km {sp}) and holds no terrain nothing nearer hides; move or remove a split")
    tiles, dist, near, bands = [], [], [], []; any_solid = [False] * k
    for tile in bake['cards']:
        row, drow, nrow, brow = [], [], [], []
        for i, c in enumerate(tile):
            if c['alpha'].shape[0] == 0: row.append(None); drow.append(None); nrow.append(None); continue
            al, wl, ld = c['alpha'][:, inner], c['wall'][:, inner], c['logd'][:, inner]; solid = (al >= 0.5) & ~wl; any_solid[i] |= bool(solid.any())
            pool = next((m, l) for m, l in ((solid, ld), ((al > 0) & ~wl, ld), (al > 0, ld), (c['alpha'] > 0, c['logd'])) if m.any())
            dm = float(np.exp(np.median(pool[1][pool[0]]))); nrow.append(float(np.exp(ld[solid].min())) if solid.any() else None)   # the nearest solid terrain the card draws in this tile: None where it draws only wall (the skirt), which binds nothing
            row.append(dict(top=c['top'], colour=encode_colour(c['albedo'], c['alpha']), geometry=encode_geometry(c['n_r'], c['n_t'], c['logd'], enc, c['wall']), distance_m=dm)); drow.append(dm); brow.append(c['alpha'].shape[0])
        tiles.append(row); dist.append(drow); near.append(nrow); bands.append(brow)
    for i in range(k):
        if not any_solid[i]: raise ValueError(f'card {i} holds no solid terrain apart from its wall rows')
    r_max = solve_r_max(near, bands, ppd); r_fwd = solve_r_max(near, bands, ppd, phis=1); rmin = min(row[0] for row in near if row[0] is not None); n = run_tiles(r_fwd, rmin); worst = np.nanmax(fit_table(near, r_max, ppd), axis=0)
    cards = [dict(near_m=float(np.median(sm[i - 1])) if i else None, far_m=float(np.median(sm[i])) if i < len(sm) else None) for i in range(k)]
    return dict(cards=cards, tiles=tiles, camera=dict(r_max_m=r_max, r_max_forward_m=r_fwd), report=dict(fit_px=[float(x) for x in worst], run_tiles=n, resident_bytes=resident_bytes(bands, n), nearest_m=rmin))   # nearest_m: the nearest solid terrain of the place

def lit(c):
    """albedo x (0.35 + 0.65 max(n.L, 0)) under the fixed sheet light, with the card's alpha: (rgb, alpha).  Wall pixels are lit with the face up, as the runtime reads their code."""
    wall = c['wall']; n_r, n_t = np.where(wall, 0.0, c['n_r']), np.where(wall, 0.0, c['n_t'])
    up = np.sqrt(np.clip(1 - n_r ** 2 - n_t ** 2, 0, 1)); L = np.array(SHEET_LIGHT) / np.linalg.norm(SHEET_LIGHT); nl = np.clip(n_r * L[0] + n_t * L[1] + up * L[2], 0, 1)
    return c['albedo'] * (0.35 + 0.65 * nl)[..., None], c['alpha']
def sheet(bake):
    """Contact sheet (png bytes) at 1/4 of the ring's width, stacked: the ring composite, every card's strip alone, and the depth image (log-distance bins, far at the top, every seam); the TILES tile boundaries drawn on each.  All lit by SHEET_LIGHT over the flat
    SHEET_SKY; reads the arrays the encoder writes (each tile's interior columns, the apron dropped)."""
    h = bake['opaque'][0].shape[0]; k = len(bake['cards'][0]); sky = np.broadcast_to(np.array(SHEET_SKY, np.float32), (h, RING_W, 3)); rgbs = [np.zeros((h, RING_W, 3), np.float32) for _ in range(k)]; als = [np.zeros((h, RING_W), np.float32) for _ in range(k)]
    for t, tile in enumerate(bake['cards']):
        for i, c in enumerate(tile):
            if c['alpha'].shape[0] == 0: continue
            rgb, al = lit(c); sl = slice(c['top'], c['top'] + al.shape[0]); x0 = t * TILE_W; rgbs[i][sl, x0:x0 + TILE_W] = rgb[:, APRON:APRON + TILE_W]; als[i][sl, x0:x0 + TILE_W] = al[:, APRON:APRON + TILE_W]
    comp = sky.copy(); panels = []
    for rgb, al in zip(rgbs, als): panels.append(sky * (1 - al[..., None]) + rgb * al[..., None])
    for rgb, al in zip(reversed(rgbs), reversed(als)): comp = comp * (1 - al[..., None]) + rgb * al[..., None]
    q = lambda a: a.reshape((a.shape[0], RING_W // 4, 4) + a.shape[2:]).mean(2); mark = np.arange(TILES) * TILE_W // 4; red = np.array([1.0, 0.2, 0.2])
    def bounds(img): img[:, mark] = 0.45 * img[:, mark] + 0.55 * red; return img
    cov = bake['cov'][:, ::4]; w = cov.shape[1]; img = np.repeat(np.log1p(cov[::-1]) / np.log1p(cov.max()), 2, 0); depth = np.dstack([img] * 3) * 0.92 + 0.04; nb = cov.shape[0]; cols = np.arange(w)
    for j, s in enumerate(bake['seams']):
        b = np.clip(np.searchsorted(bake['edges'], np.log(s[::4]), 'right') - 1, 0, nb - 1); col = [(0.24, 0.78, 1.0), (1.0, 0.47, 0.24), (0.6, 1.0, 0.4), (1.0, 0.9, 0.3), (0.9, 0.4, 1.0)][j % 5]
        for dy in (0, 1): depth[(nb - 1 - b) * 2 + dy, cols] = col
    return bytes(imagecodecs.png_encode(u8(np.concatenate([bounds(q(comp))] + [bounds(q(p)) for p in panels] + [bounds(depth)], 0))))

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0]); ap.add_argument('place', nargs='?'); ap.add_argument('--tiles'); ap.add_argument('--out'); ap.add_argument('--work'); ap.add_argument('--sheet'); ap.add_argument('--write-schema', action='store_true')
    a = ap.parse_args(argv)
    if a.write_schema: (HERE / 'ridge-bake.schema.json').write_bytes((json.dumps(SCHEMA, indent=1, ensure_ascii=False) + '\n').encode('utf-8')); return 0
    if not (a.place and a.tiles and a.out): ap.error('place, --tiles and --out are required')
    os.environ['RIDGE_TILES'] = a.tiles; os.environ['RIDGE_WORK'] = a.work or os.path.join(os.environ.get('TMPDIR', tempfile.gettempdir()), 'ridge-bake-work'); os.makedirs(os.environ['RIDGE_WORK'], exist_ok=True)
    bake = bake_place(a.place)
    if a.sheet: Path(a.sheet).write_bytes(sheet(bake))
    packed = pack(bake); rp = packed['report']
    print(f"r_max_m {packed['camera']['r_max_m']:g}  r_max_forward_m {packed['camera']['r_max_forward_m']:g}  nearest card {rp['nearest_m']:.0f} m  resident run {rp['run_tiles']} tiles = {rp['resident_bytes']} bytes  worst fit error per card (card px, bound {FIT_PX_MAX:g}) {[round(x, 1) for x in rp['fit_px']]}", file=sys.stderr, flush=True)
    dest = write_bake(a.out, bake['place'], bake['view'], bake['meta'], packed, bake['opaque']); print(dest); return 0

if __name__ == '__main__': sys.exit(main())
