// The ridge backdrop's one JSON boundary: a static asset between the offline Python baker (scripts/ridge-bake/export.py, whose SCHEMA is the
// contract) and the page; no daemon state. Main-chunk safe: types, a parser and fetch only. Wire names are snake_case; the parsed manifest is
// camelCase and its `view` is the View (`view.ts`) the sky and the cards share. Schema 3: the whole 360 degree ring, K G-buffer cards cut into
// azimuth tiles, each tile two files.
import { groundRowsNeeded, type Place, type View } from './view';

/** As export.py MAX_CARDS: the decode budget holds this many. */
export const MAX_CARDS = 6;

/** One card's tile: its rows of the plane, the card's distance there, and its two files (names inside the manifest's directory). */
export interface TileCard {
  /** First row of the card's band in the plane, and its height in rows. */
  top: number;
  h: number;
  /** exp(median ln d) of the card's solid pixels in the tile's interior, metres. */
  distanceM: number;
  colour: string;
  geometry: string;
}

/** A card as the bake lists it: the median seam depths over the ring, null at the ends. */
export interface CardEntry {
  nearM: number | null;
  farM: number | null;
}

export interface RidgeManifest {
  bakeId: string;
  /** Absolute-or-rooted URL of the bake's directory, with a trailing slash. */
  dir: string;
  /** Display name of the place. */
  name: string;
  view: View;
  /** How the geometry file's blue channel maps to ln metres: `logD = logDMin + b x (logDMax - logDMin)`, b in 0..1. The red and green channels are the 'rt8' normal. */
  encoding: { logDMin: number; logDMax: number };
  /**
   * The largest camera offset from the bake centre the cards' linear slide fits, metres (ruling ridge-offset-range-fit): `rMaxM` over every angle of the camera
   * on its circle (the offset-only rotation mode), `rMaxForwardM` with the camera pushed forward along the view direction alone (the modes where the offset
   * turns with the view), so never below `rMaxM`.
   */
  camera: { rMaxM: number; rMaxForwardM: number };
  /** Nearest first. */
  cards: CardEntry[];
  /** `tiles[t][i]` is card i in tile t, or null where the card holds nothing there. */
  tiles: (TileCard | null)[][];
  attribution: { creditLine: string; licence: string; demSource: string; url: string };
}

export interface RidgeIndex {
  default: string;
  places: Record<string, string>;
}

type Rec = Record<string, unknown>;
const fail = (path: string, why: string): never => {
  throw new Error(`ridge manifest ${path}: ${why}`);
};
const rec = (x: unknown, path: string): Rec =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
    ? (x as Rec)
    : fail(path, 'not an object');
const num = (x: unknown, path: string): number =>
  typeof x === 'number' && Number.isFinite(x) ? x : fail(path, 'not a number');
const str = (x: unknown, path: string): string =>
  typeof x === 'string' ? x : fail(path, 'not a string');
const numOrNull = (x: unknown, path: string): number | null => (x === null ? null : num(x, path));

/** An IANA zone name Intl knows (the one place besides skyMoment.ts that touches Intl.DateTimeFormat). */
const zone = (x: unknown, path: string): string => {
  const tz = str(x, path);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    fail(path, `unknown time zone ${tz}`);
  }
  return tz;
};

export function parseIndex(raw: unknown): RidgeIndex {
  const r = rec(raw, 'index');
  if (r.schema !== 1) fail('index.schema', 'must be 1');
  const places = rec(r.places, 'index.places');
  const out = Object.fromEntries(
    Object.entries(places).map(([k, v]) => [k, str(v, `index.places.${k}`)])
  );
  return { default: str(r.default, 'index.default'), places: out };
}

/** `dir` is the URL of the directory the manifest was read from; the tile files are read relative to it. */
export function parseManifest(raw: unknown, dir: string): RidgeManifest {
  const r = rec(raw, 'manifest');
  if (r.schema !== 3) {
    fail(
      'schema',
      `must be 3: this build reads ring bakes only, so the deploy holds a stale ridge bake (rebake the place, or redeploy a matching build)`
    );
  }
  const p = rec(r.place, 'place');
  const v = rec(r.view, 'view');
  const ringW = num(v.ring_w, 'view.ring_w');
  const tileW = num(v.tile_w, 'view.tile_w');
  const tiles = num(v.tiles, 'view.tiles');
  if (!Number.isInteger(tiles) || tiles < 1) fail('view.tiles', 'not a count');
  if (ringW !== tiles * tileW) fail('view.ring_w', 'is not tiles x tile_w');
  const planeH = num(v.plane_h, 'view.plane_h');
  const horizonRow = num(v.horizon_row, 'view.horizon_row');
  const ground = groundRowsNeeded(planeH);
  if (planeH - horizonRow < ground - 1e-6) {
    fail(
      'view.horizon_row',
      `short plane: ${(planeH - horizonRow).toFixed(1)} rows under the horizon, the runtime needs ${Math.round(ground)} to reach the viewport bottom (the baker refuses such a bake: rebake the place)`
    );
  }
  if (!Array.isArray(r.cards) || r.cards.length < 1) fail('cards', 'none');
  const k = (r.cards as unknown[]).length;
  if (k > MAX_CARDS) fail('cards', `more than ${MAX_CARDS}`);
  const cards = (r.cards as unknown[]).map((x, i): CardEntry => {
    const c = rec(x, `cards[${i}]`);
    return {
      nearM: numOrNull(c.near_m, `cards[${i}].near_m`),
      farM: numOrNull(c.far_m, `cards[${i}].far_m`),
    };
  });
  if (!Array.isArray(r.tiles) || r.tiles.length !== tiles) fail('tiles', `not ${tiles} tiles`);
  const grid = (r.tiles as unknown[]).map((row, t) => {
    if (!Array.isArray(row) || row.length !== k) fail(`tiles[${t}]`, `not ${k} entries`);
    return (row as unknown[]).map((x, i): TileCard | null => {
      if (x === null) return null;
      const path = `tiles[${t}][${i}]`;
      const e = rec(x, path);
      const top = num(e.top, `${path}.top`);
      const h = num(e.h, `${path}.h`);
      if (top < 0 || h < 1 || top + h > planeH) fail(path, 'outside the plane rows');
      const distanceM = num(e.distance_m, `${path}.distance_m`);
      if (!(distanceM > 0)) fail(`${path}.distance_m`, 'not above 0');
      return {
        top,
        h,
        distanceM,
        colour: str(rec(e.colour, `${path}.colour`).file, `${path}.colour.file`),
        geometry: str(rec(e.geometry, `${path}.geometry`).file, `${path}.geometry.file`),
      };
    });
  });
  for (let i = 0; i < k; i += 1) {
    if (grid.every((row) => row[i] === null)) fail(`cards[${i}]`, 'is null in every tile');
  }
  const e = rec(r.encoding, 'encoding');
  if (e.normal !== 'rt8') fail('encoding.normal', "must be 'rt8'");
  const logDMin = num(e.log_d_min, 'encoding.log_d_min');
  const logDMax = num(e.log_d_max, 'encoding.log_d_max');
  if (!(logDMax > logDMin)) fail('encoding', 'log_d_max not above log_d_min');
  const cam = rec(r.camera, 'camera');
  const rMaxM = num(cam.r_max_m, 'camera.r_max_m');
  if (!(rMaxM > 0)) fail('camera.r_max_m', 'not above 0');
  const rMaxForwardM = num(cam.r_max_forward_m, 'camera.r_max_forward_m');
  if (!(rMaxForwardM >= rMaxM)) fail('camera.r_max_forward_m', 'below camera.r_max_m');
  const a = rec(r.attribution, 'attribution');
  const id = str(p.id, 'place.id');
  return {
    bakeId: str(r.bake_id, 'bake_id'),
    dir,
    name: str(p.name, 'place.name'),
    view: {
      place: {
        id,
        lat: num(p.lat, 'place.lat'),
        lon: num(p.lon, 'place.lon'),
        altitudeKm: num(p.altitude_km, 'place.altitude_km'),
        tz: zone(p.tz, 'place.tz'),
      },
      lookAzDeg: num(v.look_az_deg, 'view.look_az_deg'),
      ringW,
      tileW,
      tiles,
      apron: num(v.apron, 'view.apron'),
      planeH,
      pxPerDegH: num(v.px_per_deg_h, 'view.px_per_deg_h'),
      pxPerDegV: num(v.px_per_deg_v, 'view.px_per_deg_v'),
      horizonRow,
    },
    encoding: { logDMin, logDMax },
    camera: { rMaxM, rMaxForwardM },
    cards,
    tiles: grid,
    attribution: {
      creditLine: str(a.credit_line, 'attribution.credit_line'),
      licence: str(a.licence, 'attribution.licence'),
      demSource: str(a.dem_source, 'attribution.dem_source'),
      url: str(a.url, 'attribution.url'),
    },
  };
}

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`ridge: ${url} answered ${res.status}`);
  return res.json();
}

/** A baked place as the Place submenu lists it: the manifest's own name and place (its card reads the moment drawn there, in its zone). */
export interface PlaceListing {
  id: string;
  name: string;
  place: Place;
}

const memo = new Map<string, Promise<RidgeManifest>>();
const indexMemo = new Map<string, Promise<RidgeIndex>>();
const listMemo = new Map<string, Promise<PlaceListing[]>>();

/** The baked places' index (`${baseUrl}public/ridge/index.json`), memoised per URL; a failure is not remembered. */
export function loadIndex(baseUrl: string): Promise<RidgeIndex> {
  const root = `${baseUrl}public/ridge/`;
  const hit = indexMemo.get(root);
  if (hit) return hit;
  // The index is the one mutable pointer (a rebake deletes the old directory it named); the manifest and tiles are content-addressed.
  const p = getJson(`${root}index.json`, { cache: 'no-cache' }).then(parseIndex);
  indexMemo.set(root, p);
  p.catch(() => indexMemo.delete(root));
  return p;
}

/**
 * The manifest of a baked place: the index names each place's directory, then `<dir>/manifest.json` is read.
 * `placeId` picks the entry (unknown or absent: the index's default). Memoised per index URL and place; a failure is not remembered.
 * Rejects on any failure: the caller degrades to the sky-only scene.
 */
export function loadManifest(baseUrl: string, placeId?: string): Promise<RidgeManifest> {
  const root = `${baseUrl}public/ridge/`;
  const key = `${root}|${placeId ?? ''}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const p = (async () => {
    const index = await loadIndex(baseUrl);
    const id = placeId !== undefined && placeId in index.places ? placeId : index.default;
    const name = index.places[id];
    if (name === undefined) throw new Error(`ridge: index has no place ${id}`);
    const dir = `${root}${name}/`;
    return parseManifest(await getJson(`${dir}manifest.json`), dir);
  })();
  memo.set(key, p);
  p.catch(() => memo.delete(key));
  return p;
}

/** The baked places in the index's order, named by their manifests; a place whose manifest fails to load is left out. Memoised per index URL; a failure is not remembered. */
export function listPlaces(baseUrl: string): Promise<PlaceListing[]> {
  const root = `${baseUrl}public/ridge/`;
  const hit = listMemo.get(root);
  if (hit) return hit;
  const p = (async () => {
    const index = await loadIndex(baseUrl);
    const found = await Promise.allSettled(
      Object.keys(index.places).map(async (id): Promise<PlaceListing> => {
        const m = await loadManifest(baseUrl, id);
        return { id, name: m.name, place: m.view.place };
      })
    );
    return found.flatMap((f) => (f.status === 'fulfilled' ? [f.value] : []));
  })();
  listMemo.set(root, p);
  p.catch(() => listMemo.delete(root));
  return p;
}

/** For tests: forget every memoised manifest. */
export const forgetManifests = (): void => {
  memo.clear();
  indexMemo.clear();
  listMemo.clear();
};
