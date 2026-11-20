"""Ridge backdrop export: bake a place with ridge.py and write its K+1 G-buffer cards (colour + geometry WebP each), a manifest v2 and the index.

  python3 -I scripts/ridge-bake/export.py <place-id> --tiles DIR --out public/ridge/ [--work DIR] [--sheet contact.png]
  python3 -I scripts/ridge-bake/export.py --write-schema          (rewrites ridge-bake.schema.json from SCHEMA below)

The runtime reads manifest.json (SCHEMA is its contract) and nothing else about the bake; it lights the cards itself (ruling ridge-cards-runtime-lit).  The pure parts (budget, bake_id, manifest, index, schema check)
import no baker; bake_place imports ridge, which needs RIDGE_TILES and RIDGE_WORK (main sets them from --tiles / --work)."""
import os, sys, json, math, shutil, hashlib, argparse, tempfile
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import numpy as np, imagecodecs

BAKER_VERSION = 2
WINDOW_DEG = 72
PLANE_W = 1280                         # every card is the whole 72 deg window wide
PLANE_W_MAX = 4096
MAX_CARDS = 6                          # per place; a full-frame card decodes to 2 textures x 1280 x 600 x 4 B = 6.1 MB, the decode budget below holds 3 of them and cropping to the row band is what lets a livelier place have more
TOTAL_BYTES_MAX = 1_500_000            # every card file of a place together
DECODE_BYTES_MAX = 20_000_000          # the cards decoded: sum over cards of 2 textures x w x band h x 4 bytes
COVER_TOL = 0.02                       # the composite of the cards may differ from the opaque view by this much of a pixel, nowhere more
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
def _obj(**props): return {'type': 'object', 'required': list(props), 'additionalProperties': False, 'properties': props}
_file = _obj(file=_str, bytes=_int)
SCHEMA = {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'title': 'ridge-bake manifest v2 and index v1', '$defs': {
    'manifest': _obj(schema={'const': 2}, baker_version=_int, bake_id=_str,
        place=_obj(id=_str, name=_str, lat=_num, lon=_num, altitude_km=_num, eye_m=_num),
        view=_obj(look_az_deg=_num, window_deg={'const': WINDOW_DEG}, plane_w={'type': 'integer', 'maximum': PLANE_W_MAX}, plane_h=_int, px_per_deg_h=_num, px_per_deg_v=_num, exaggeration=_num, horizon_row=_num, sky_row=_num, near_row=_num),
        curvature=_obj(r_earth_m=_num, k_ref=_num),
        encoding=_obj(log_d_min=_num, log_d_max=_num, normal={'const': 'rt8'}),
        cards={'type': 'array', 'minItems': 1, 'maxItems': MAX_CARDS, 'items': dict(_obj(top=_int, h=_int, near_m=_numnull, far_m=_numnull, median_m=_num, colour=_file, geometry=_file),
            description='nearest first; the runtime paints the list last to first. top and h place the card back at its rows of the frame; near_m and far_m are the median seam depths, null at the ends.')},
        w=_int, h=_int, bytes=_int,
        attribution=_obj(credit_line=_str, licence=_str, dem_source=_str, url=_str)),
    'index': _obj(schema={'const': 1}, default=_str, places={'type': 'object', 'additionalProperties': _str})}}

def validate(x, s, path='$'):
    """The subset of JSON Schema SCHEMA uses; raises ValueError naming the path."""
    if '$ref' in s: return validate(x, SCHEMA['$defs'][s['$ref'].split('/')[-1]], path)
    tys = s.get('type'); tys = [tys] if isinstance(tys, str) else tys; py = {'object': dict, 'array': list, 'string': str, 'number': (int, float), 'integer': int, 'null': type(None)}
    if tys and not any(isinstance(x, py[t]) and not (isinstance(x, bool) and t != 'null') for t in tys): raise ValueError(f'{path}: not a {"/".join(tys)}')
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

# ------------------------------------------------------------------------------------ cards -> bytes
def u8(a): return np.clip(np.rint(np.asarray(a) * 255.0), 0, 255).astype(np.uint8)
def encode_colour(albedo, alpha):
    """Lossy RGB albedo with lossless alpha coverage, straight (not premultiplied); the colour under a zero alpha is zeroed."""
    a = u8(alpha); rgb = u8(albedo) * (a[..., None] > 0); return bytes(imagecodecs.webp_encode(np.dstack([rgb, a]), level=WEBP_QUALITY, lossless=False))
def encode_geometry(n_r, n_t, logd, enc):
    """Lossless, opaque RGB: R, G = (n_r + 1) / 2, (n_t + 1) / 2 ('rt8'), B = the log-distance normalised between enc log_d_min and log_d_max."""
    b = (np.asarray(logd) - enc['log_d_min']) / (enc['log_d_max'] - enc['log_d_min']); return bytes(imagecodecs.webp_encode(np.dstack([u8((np.asarray(n_r) + 1) / 2), u8((np.asarray(n_t) + 1) / 2), u8(b)]), lossless=True))
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

def check_budget(card_bytes, w, bands):
    """Refuse a bake the runtime could not hold: more than MAX_CARDS cards, a card wider than PLANE_W_MAX, every card file together above TOTAL_BYTES_MAX, or the cards decoding (2 textures x w x band rows x 4 bytes each) above DECODE_BYTES_MAX."""
    if len(card_bytes) > MAX_CARDS: raise ValueError(f'{len(card_bytes)} cards, above {MAX_CARDS}')
    if w > PLANE_W_MAX: raise ValueError(f'card width {w} above {PLANE_W_MAX}')
    if sum(card_bytes) > TOTAL_BYTES_MAX: raise ValueError(f'the cards are {sum(card_bytes)} bytes, above {TOTAL_BYTES_MAX}')
    decoded = sum(2 * w * h * 4 for h in bands)
    if decoded > DECODE_BYTES_MAX: raise ValueError(f'the cards decode to {decoded} bytes, above {DECODE_BYTES_MAX}')

def bake_id(cards):
    """First 12 hex of sha256 over the card files in index order, colour then geometry.  cards: [(colour bytes, geometry bytes)]."""
    h = hashlib.sha256()
    for colour, geometry in cards: h.update(colour); h.update(geometry)
    return h.hexdigest()[:12]

def write_bake(out, place, view, meta, cards, opaque, default=None):
    """Write out/<place>-<bake_id>/ (card WebPs + manifest.json), rewrite out/index.json, delete the place's previous dir.  cards: [dict(top, colour bytes, geometry bytes, near_m, far_m, median_m)], nearest first; opaque (h, w) is
    the opaque view's coverage.  Refuses before writing a bake whose files decode to different sizes, leave the frame or the view's plane_h, break the budget or composite away from the opaque view.  meta: dict(curvature, encoding).  Returns the directory."""
    dec = [(decode(c['colour']), decode(c['geometry'])) for c in cards]; shapes = {a.shape[:2] for pair in dec for a in pair}; bands = [a.shape[0] for a, _ in dec]
    if any(c.shape[:2] != g.shape[:2] for c, g in dec): raise ValueError('a card colour and geometry are not one size')
    if len({a.shape[1] for pair in dec for a in pair}) != 1: raise ValueError(f'the cards are not one width: {sorted(shapes)}')
    w = dec[0][0].shape[1]; h = view['plane_h']
    if any(band < 1 or c['top'] < 0 or c['top'] + band > h for c, band in zip(cards, bands)): raise ValueError(f'a card leaves the {h} rows of the frame')
    if opaque.shape != (h, w): raise ValueError(f'the opaque view is {opaque.shape}, the frame {(h, w)}')
    sizes = [len(c['colour']) + len(c['geometry']) for c in cards]; check_budget(sizes, w, bands)
    check_cover([(c['top'], col[..., 3] / 255.0) for c, (col, _) in zip(cards, dec)], opaque)
    bid = bake_id([(c['colour'], c['geometry']) for c in cards]); name = f"{place['id']}-{bid}"; out = Path(out); dest = out / name
    manifest = dict(schema=2, baker_version=BAKER_VERSION, bake_id=bid, place=place, view=dict(view, window_deg=WINDOW_DEG, plane_w=w), curvature=meta['curvature'], encoding=dict(meta['encoding'], normal='rt8'),
                    cards=[dict(top=c['top'], h=band, near_m=c['near_m'], far_m=c['far_m'], median_m=c['median_m'], colour=dict(file=f'card-{i}-colour.webp', bytes=len(c['colour'])), geometry=dict(file=f'card-{i}-geometry.webp', bytes=len(c['geometry'])))
                           for i, (c, band) in enumerate(zip(cards, bands))], w=w, h=h, bytes=sum(sizes), attribution=ATTRIBUTION)
    validate(manifest, SCHEMA['$defs']['manifest']); out.mkdir(parents=True, exist_ok=True); tmp = Path(tempfile.mkdtemp(dir=out, prefix='.bake-'))
    for i, c in enumerate(cards): (tmp / f'card-{i}-colour.webp').write_bytes(c['colour']); (tmp / f'card-{i}-geometry.webp').write_bytes(c['geometry'])
    (tmp / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')
    idx_path = out / 'index.json'; idx = json.loads(idx_path.read_text()) if idx_path.exists() else dict(schema=1, default=place['id'], places={})
    old = idx['places'].get(place['id']); idx['places'][place['id']] = name; idx['default'] = default or (idx['default'] if idx['default'] in idx['places'] else place['id'])
    validate(idx, SCHEMA['$defs']['index'])
    if dest.exists(): shutil.rmtree(dest)
    os.rename(tmp, dest); (out / '.index.tmp').write_text(json.dumps(idx, indent=1) + '\n'); os.replace(out / '.index.tmp', idx_path)
    if old and old != name: shutil.rmtree(out / old, ignore_errors=True)
    return dest

# ------------------------------------------------------------------------------------ the bake
def bake_place(pid):
    """stage 0, prefilter, set_view, coverage, seams, cards: dict(place, view, meta, cards (ridge.cards arrays), seams (K, w) in m, cov (bins, w), opaque (h, w) coverage).  Needs RIDGE_TILES / RIDGE_WORK."""
    import ridge
    assert ridge.WIN == PLANE_W and ridge.H > 0
    p = ridge.configure(ridge.load_preset(pid)); ridge.mosaic(p); d, _, Hh, _ = ridge.stage0(False); a, h = ridge.prefilter(d, Hh, p.get('prefilter_m', 0)); v = ridge.set_view(a.max(0))
    nrm = tuple(ridge.win(x) for x in ridge.normals(d, h)); aw, hw = ridge.win(a), ridge.win(h); cov = ridge.coverage(d, aw); sm = ridge.seams(cov, [k * 1000.0 for k in p['card_split_km']], d)
    place = dict(id=p['id'], name=p['name'], lat=p['lat'], lon=p['lon'], altitude_km=p['ground_m'] / 1000.0, eye_m=p['eye_m'])
    view = dict(look_az_deg=p['az_center'], plane_h=ridge.H, px_per_deg_h=ridge.HPX_DEG, px_per_deg_v=v['px_per_deg'], exaggeration=v['exaggeration'], horizon_row=v['horizon_row'], sky_row=v['sky_row'] * ridge.H, near_row=v['near_row'] * ridge.H)
    meta = dict(curvature=dict(r_earth_m=ridge.R_EARTH, k_ref=ridge.KREF), encoding=dict(log_d_min=math.log(d[0]), log_d_max=math.log(d[-1])))
    return dict(place=place, view=view, meta=meta, cards=ridge.cards(d, aw, hw, sm, nrm), seams=sm, cov=cov, opaque=ridge.opaque(aw), edges=ridge.log_edges(d))

def pack(bake):
    """The cards of a bake as bytes plus their manifest facts: median seam depths either side, median distance of the card's solid pixels."""
    enc = bake['meta']['encoding']; sm = bake['seams']; out = []
    for i, c in enumerate(bake['cards']):
        solid = c['alpha'] >= 0.5; out.append(dict(top=c['top'], colour=encode_colour(c['albedo'], c['alpha']), geometry=encode_geometry(c['n_r'], c['n_t'], c['logd'], enc),
            near_m=float(np.median(sm[i - 1])) if i else None, far_m=float(np.median(sm[i])) if i < len(sm) else None, median_m=float(np.exp(np.median(c['logd'][solid]))) if solid.any() else 0.0))
    return out

def lit(c):
    """albedo x (0.35 + 0.65 max(n.L, 0)) under the fixed sheet light, with the card's alpha: (rgb, alpha)."""
    up = np.sqrt(np.clip(1 - c['n_r'] ** 2 - c['n_t'] ** 2, 0, 1)); L = np.array(SHEET_LIGHT) / np.linalg.norm(SHEET_LIGHT); nl = np.clip(c['n_r'] * L[0] + c['n_t'] * L[1] + up * L[2], 0, 1)
    return c['albedo'] * (0.35 + 0.65 * nl)[..., None], c['alpha']
def sheet(bake):
    """Contact sheet (png bytes), stacked: the composite, every card alone, and the depth image (log-distance bins, far at the top, every seam drawn).  All lit by SHEET_LIGHT over the flat SHEET_SKY; reads the arrays the encoder writes."""
    h, w = bake['opaque'].shape; sky = np.broadcast_to(np.array(SHEET_SKY), (h, w, 3)); comp = sky.copy(); panels = []
    for c in bake['cards']:
        rgb, al = lit(c); alone = sky.copy(); sl = slice(c['top'], c['top'] + al.shape[0]); alone[sl] = sky[sl] * (1 - al[..., None]) + rgb * al[..., None]; panels.append(alone)
    for c in reversed(bake['cards']): rgb, al = lit(c); sl = slice(c['top'], c['top'] + al.shape[0]); comp[sl] = comp[sl] * (1 - al[..., None]) + rgb * al[..., None]
    cov = bake['cov']; img = np.repeat(np.log1p(cov[::-1]) / np.log1p(cov.max()), 2, 0); depth = np.dstack([img] * 3) * 0.92 + 0.04; nb = cov.shape[0]; cols = np.arange(w)
    for k, s in enumerate(bake['seams']):
        j = np.clip(np.searchsorted(bake['edges'], np.log(s), 'right') - 1, 0, nb - 1); col = [(0.24, 0.78, 1.0), (1.0, 0.47, 0.24), (0.6, 1.0, 0.4), (1.0, 0.9, 0.3), (0.9, 0.4, 1.0)][k % 5]
        for dy in (0, 1): depth[(nb - 1 - j) * 2 + dy, cols] = col
    return bytes(imagecodecs.png_encode(u8(np.concatenate([comp] + panels + [depth], 0))))

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0]); ap.add_argument('place', nargs='?'); ap.add_argument('--tiles'); ap.add_argument('--out'); ap.add_argument('--work'); ap.add_argument('--sheet'); ap.add_argument('--write-schema', action='store_true')
    a = ap.parse_args(argv)
    if a.write_schema: (HERE / 'ridge-bake.schema.json').write_text(json.dumps(SCHEMA, indent=1, ensure_ascii=False) + '\n'); return 0
    if not (a.place and a.tiles and a.out): ap.error('place, --tiles and --out are required')
    os.environ['RIDGE_TILES'] = a.tiles; os.environ['RIDGE_WORK'] = a.work or os.path.join(os.environ.get('TMPDIR', tempfile.gettempdir()), 'ridge-bake-work'); os.makedirs(os.environ['RIDGE_WORK'], exist_ok=True)
    bake = bake_place(a.place)
    if a.sheet: Path(a.sheet).write_bytes(sheet(bake))
    dest = write_bake(a.out, bake['place'], bake['view'], bake['meta'], pack(bake), bake['opaque'])
    print(dest); return 0

if __name__ == '__main__': sys.exit(main())
