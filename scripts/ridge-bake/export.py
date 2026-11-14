"""Ridge backdrop export: bake a place with ridge.py and write its three WebP planes per sun key, a manifest and the index.

  python3 -I scripts/ridge-bake/export.py <place-id> --tiles DIR --out public/ridge/ [--work DIR] [--sheet contact.png]
  python3 -I scripts/ridge-bake/export.py --write-schema          (rewrites ridge-bake.schema.json from SCHEMA below)

The runtime reads manifest.json (SCHEMA is its contract) and nothing else about the bake.  The pure parts (budget, bake_id, manifest, index, schema check) import no baker;
bake_place imports ridge, which needs RIDGE_TILES and RIDGE_WORK (main sets them from --tiles / --work)."""
import os, sys, json, math, shutil, hashlib, argparse, tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import numpy as np, imagecodecs
import sun

BAKER_VERSION = 1
KEYS = ('dawn', 'morning', 'noon', 'golden', 'dusk', 'night')
PLANES = ('far', 'mid', 'near')
NIGHT_EL = -12.0                       # the night frame: sun this far below the horizon
WINDOW_DEG = 72
PLANE_W = 1280                         # every plane is the whole 72 deg window
PLANE_W_MAX = 4096
PAIR_BYTES_MAX = 800_000               # two adjacent frames (the runtime's worst case) together; the same number is a CI constant in cut-ridge-ad-gates
DECODE_BYTES_MAX = 20_000_000          # the six planes of a frame pair decoded (2 x 3 x w x h x 4 bytes = 18.4 MB at the full window)
WEBP_QUALITY = 80
SOLID = 250                            # alpha (0..255) that counts as a solid pixel for the luma probe
SHEET_SKY = (0.80, 0.86, 0.94)         # the flat sky of the contact sheet
ATTRIBUTION = dict(
    credit_line='Contains modified Copernicus data: DEM © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.',
    licence='Copernicus DEM licence: free, full and open access, with the credit line shown',
    dem_source='Copernicus DEM GLO-30 (30 m)',
    url='https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model')

# ------------------------------------------------------------------------------------ schema (the one dict the schema file and the validator both come from)
_num, _int, _str = {'type': 'number'}, {'type': 'integer'}, {'type': 'string'}
def _obj(**props): return {'type': 'object', 'required': list(props), 'additionalProperties': False, 'properties': props}
_plane = _obj(file=_str, bytes=_int, w=_int, h=_int)
SCHEMA = {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'title': 'ridge-bake manifest v1 and index v1', '$defs': {
    'manifest': _obj(schema={'const': 1}, baker_version=_int, bake_id=_str,
        place=_obj(id=_str, name=_str, lat=_num, lon=_num, altitude_km=_num, tz_h=_num, tz_name=_str, date=_str),
        view=_obj(look_az_deg=_num, window_deg={'const': WINDOW_DEG}, plane_w={'type': 'integer', 'maximum': PLANE_W_MAX}, plane_h=_int, px_per_deg_h=_num, px_per_deg_v=_num, horizon_row=_num, sky_row=_num, near_row=_num),
        frames={'type': 'array', 'minItems': len(KEYS), 'maxItems': len(KEYS), 'items': _obj(key={'enum': list(KEYS)}, sun=_obj(az=_num, el=_num), hour_utc=_num, planes=_obj(**{k: _plane for k in PLANES}), bytes=_int, luma=_obj(min=_num, max=_num))},
        attribution=_obj(credit_line=_str, licence=_str, dem_source=_str, url=_str)),
    'index': _obj(schema={'const': 1}, default=_str, places={'type': 'object', 'additionalProperties': _str})}}

def validate(x, s, path='$'):
    """The subset of JSON Schema SCHEMA uses; raises ValueError naming the path."""
    if '$ref' in s: return validate(x, SCHEMA['$defs'][s['$ref'].split('/')[-1]], path)
    ty = s.get('type'); py = {'object': dict, 'array': list, 'string': str, 'number': (int, float), 'integer': int}
    if ty and (not isinstance(x, py[ty]) or isinstance(x, bool)): raise ValueError(f'{path}: not a {ty}')
    if 'const' in s and x != s['const']: raise ValueError(f"{path}: must be {s['const']!r}")
    if 'enum' in s and x not in s['enum']: raise ValueError(f'{path}: not one of {s["enum"]}')
    if 'maximum' in s and x > s['maximum']: raise ValueError(f'{path}: above {s["maximum"]}')
    if ty == 'array':
        if not s.get('minItems', 0) <= len(x) <= s.get('maxItems', 1 << 30): raise ValueError(f'{path}: wrong length')
        for i, v in enumerate(x): validate(v, s['items'], f'{path}[{i}]')
    if ty == 'object':
        props = s.get('properties', {}); extra = s.get('additionalProperties', True)
        for k in s.get('required', []):
            if k not in x: raise ValueError(f'{path}: missing {k}')
        for k, v in x.items():
            if k in props: validate(v, props[k], f'{path}.{k}')
            elif extra is False: raise ValueError(f'{path}: extra key {k}')
            elif isinstance(extra, dict): validate(v, extra, f'{path}.{k}')

# ------------------------------------------------------------------------------------ sun keys
def sun_set(p, date):
    """The five day keys from the preset date (copied from the mockup's run2.sun_set) plus the night key at NIGHT_EL: key -> {az, el, hour_utc}."""
    day = datetime.fromisoformat(date).replace(tzinfo=timezone.utc); lat, lon, tz = p['lat'], p['lon'], p['tz_h']
    geo = lambda t: sun.solar(day + timedelta(hours=t), lat, lon)[2]
    def find(target, a, b):
        fa = geo(a) - target
        for _ in range(50):
            m = (a + b) / 2; fm = geo(m) - target
            if (fa < 0) == (fm < 0): a, fa = m, fm
            else: b = m
        return (a + b) / 2
    noon = max((12 - lon / 15.0 - 1 + x / 600 for x in range(0, 1200)), key=lambda t: sun.solar(day + timedelta(hours=t), lat, lon)[1])
    rise = find(-0.833, noon - 9, noon)
    hours = dict(dawn=rise + 0.25, morning=9.5 - tz, noon=noon, golden=find(6.0, noon, noon + 9), dusk=find(-2.5, noon, noon + 9), night=find(NIGHT_EL, noon, noon + 14))
    return {k: dict(az=sun.solar(day + timedelta(hours=h), lat, lon)[0], el=sun.solar(day + timedelta(hours=h), lat, lon)[1], hour_utc=h) for k, h in hours.items()}

# ------------------------------------------------------------------------------------ planes -> bytes
def u8(plane): return np.clip(np.rint(plane * 255.0), 0, 255).astype(np.uint8)
def encode(plane): return bytes(imagecodecs.webp_encode(u8(plane), level=WEBP_QUALITY, lossless=False))
def decode(b):
    """A plane's bytes as RGBA uint8; the codec returns RGB for a plane that is opaque everywhere, which is solid."""
    a = imagecodecs.webp_decode(b)
    return a if a.shape[-1] == 4 else np.concatenate([a, np.full(a.shape[:2] + (1,), 255, np.uint8)], -1)
def luma_range(decoded):
    """WCAG relative luminance (linear 0..1) of the sRGB colour of every solid pixel (alpha >= SOLID) over the planes together: (min, max)."""
    lo, hi = 1.0, 0.0
    for a in decoded:
        m = a[..., 3] >= SOLID
        if not m.any(): continue
        c = a[..., :3][m].astype(np.float64) / 255.0; lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4); y = lin @ np.array([0.2126, 0.7152, 0.0722])
        lo, hi = min(lo, float(y.min())), max(hi, float(y.max()))
    if hi < lo: raise ValueError('a frame has no solid pixel to measure')
    return lo, hi

def check_budget(frame_bytes, plane_w, plane_h):
    """Refuse a bake the runtime could not hold: any two adjacent frames above PAIR_BYTES_MAX, or the planes of a frame pair decoding above DECODE_BYTES_MAX."""
    if plane_w > PLANE_W_MAX: raise ValueError(f'plane width {plane_w} above {PLANE_W_MAX}')
    for i in range(len(frame_bytes) - 1):
        if frame_bytes[i] + frame_bytes[i + 1] > PAIR_BYTES_MAX: raise ValueError(f'frames {KEYS[i]} + {KEYS[i + 1]} are {frame_bytes[i] + frame_bytes[i + 1]} bytes, above {PAIR_BYTES_MAX}')
    decoded = 2 * len(PLANES) * plane_w * plane_h * 4
    if decoded > DECODE_BYTES_MAX: raise ValueError(f'a frame pair decodes to {decoded} bytes, above {DECODE_BYTES_MAX}')

def bake_id(frames_webp):
    """First 12 hex of sha256 over the plane bytes in key order, then far, mid, near."""
    h = hashlib.sha256()
    for k in KEYS:
        for n in PLANES: h.update(frames_webp[k][n])
    return h.hexdigest()[:12]

def write_bake(out, place, view, suns, frames_webp, default=None):
    """Write out/<place>-<bake_id>/ (planes + manifest.json), rewrite out/index.json, delete the place's previous dir.  Refuses over budget before writing.  Returns the directory."""
    sizes = {k: {n: len(frames_webp[k][n]) for n in PLANES} for k in KEYS}; check_budget([sum(sizes[k].values()) for k in KEYS], PLANE_W, view['plane_h'])
    bid = bake_id(frames_webp); name = f"{place['id']}-{bid}"; out = Path(out); out.mkdir(parents=True, exist_ok=True); dest = out / name
    frames = []
    for k in KEYS:
        dec = [decode(frames_webp[k][n]) for n in PLANES]; lo, hi = luma_range(dec)
        frames.append(dict(key=k, sun=dict(az=suns[k]['az'], el=suns[k]['el']), hour_utc=suns[k]['hour_utc'],
                           planes={n: dict(file=f'{k}-{n}.webp', bytes=sizes[k][n], w=PLANE_W, h=view['plane_h']) for n in PLANES}, bytes=sum(sizes[k].values()), luma=dict(min=lo, max=hi)))
    manifest = dict(schema=1, baker_version=BAKER_VERSION, bake_id=bid, place=place, view=dict(view, window_deg=WINDOW_DEG, plane_w=PLANE_W), frames=frames, attribution=ATTRIBUTION)
    validate(manifest, SCHEMA['$defs']['manifest'])
    tmp = Path(tempfile.mkdtemp(dir=out, prefix='.bake-'))
    for k in KEYS:
        for n in PLANES: (tmp / f'{k}-{n}.webp').write_bytes(frames_webp[k][n])
    (tmp / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')
    idx_path = out / 'index.json'; idx = json.loads(idx_path.read_text()) if idx_path.exists() else dict(schema=1, default=place['id'], places={})
    old = idx['places'].get(place['id']); idx['places'][place['id']] = name; idx['default'] = default or (idx['default'] if idx['default'] in idx['places'] else place['id'])
    validate(idx, SCHEMA['$defs']['index'])
    if dest.exists(): shutil.rmtree(dest)
    os.rename(tmp, dest); (out / '.index.tmp').write_text(json.dumps(idx, indent=1) + '\n'); os.replace(out / '.index.tmp', idx_path)
    if old and old != name: shutil.rmtree(out / old, ignore_errors=True)
    return dest

# ------------------------------------------------------------------------------------ the bake
def bake_place(pid, relight_keys=KEYS):
    """stage 0, sweep, set_view, bake, then relight_planes for every sun key: (place dict, view dict, suns, {key: {plane: float RGBA}}).  Needs RIDGE_TILES / RIDGE_WORK."""
    import ridge
    assert ridge.WIN == PLANE_W and ridge.H > 0
    p = ridge.configure(ridge.load_preset(pid)); ridge.mosaic(p); d, A, Hh, _ = ridge.stage0(False); r = ridge.sweep(d, A, Hh); v = ridge.set_view(r['slots']); layers = ridge.bake(r['slots']); statics = ridge.statics()
    suns = sun_set(p, p['date']); planes = {k: ridge.relight_planes(layers, suns[k]['az'], suns[k]['el'], *statics) for k in relight_keys}
    place = dict(id=p['id'], name=p['name'], lat=p['lat'], lon=p['lon'], altitude_km=p['ground_m'] / 1000.0, tz_h=p['tz_h'], tz_name=p['tz_name'], date=p['date'])
    view = dict(look_az_deg=p['az_center'], plane_h=ridge.H, px_per_deg_h=ridge.HPX_DEG, px_per_deg_v=v['px_per_deg'], horizon_row=v['horizon_row'], sky_row=v['sky_row'] * ridge.H, near_row=v['near_row'] * ridge.H)
    return place, view, suns, planes

def sheet(planes):
    """Contact sheet: the six frames over one flat sky, 2 columns x 3 rows (png bytes)."""
    rows = []
    for k in KEYS:
        img = np.broadcast_to(np.array(SHEET_SKY), planes[k]['far'].shape[:2] + (3,)).copy()
        for n in PLANES: a = planes[k][n]; img = img * (1 - a[..., 3:]) + a[..., :3] * a[..., 3:]
        rows.append(img)
    grid = np.concatenate([np.concatenate(rows[i:i + 2], 1) for i in range(0, 6, 2)], 0)
    return bytes(imagecodecs.png_encode(u8(grid)))

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0]); ap.add_argument('place', nargs='?'); ap.add_argument('--tiles'); ap.add_argument('--out'); ap.add_argument('--work'); ap.add_argument('--sheet'); ap.add_argument('--write-schema', action='store_true')
    a = ap.parse_args(argv)
    if a.write_schema: (HERE / 'ridge-bake.schema.json').write_text(json.dumps(SCHEMA, indent=1, ensure_ascii=False) + '\n'); return 0
    if not (a.place and a.tiles and a.out): ap.error('place, --tiles and --out are required')
    os.environ['RIDGE_TILES'] = a.tiles; os.environ['RIDGE_WORK'] = a.work or os.path.join(os.environ.get('TMPDIR', tempfile.gettempdir()), 'ridge-bake-work'); os.makedirs(os.environ['RIDGE_WORK'], exist_ok=True)
    place, view, suns, planes = bake_place(a.place)
    if a.sheet: Path(a.sheet).write_bytes(sheet(planes))
    dest = write_bake(a.out, place, view, suns, {k: {n: encode(planes[k][n]) for n in PLANES} for k in KEYS})
    print(dest); return 0

if __name__ == '__main__': sys.exit(main())
