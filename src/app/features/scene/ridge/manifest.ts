// The ridge backdrop's one JSON boundary: a static asset between the offline Python baker (scripts/ridge-bake/export.py, whose SCHEMA is the
// contract) and the page; no daemon state. Main-chunk safe: types, a parser and fetch only. Wire names are snake_case; the parsed manifest is
// camelCase and its `view` is the View (`view.ts`) the sky and the cards share. Schema 2: K G-buffer cards, nearest first.
import type { View } from './view';

export const PLANE_W_MAX = 4096;
/** As export.py MAX_CARDS: the decode budget holds this many. */
export const MAX_CARDS = 6;

/** One G-buffer card: its rows of the plane, how large it sits against the bake, and its two files (names inside the manifest's directory). */
export interface CardEntry {
  /** First row of the card in the plane, and its height in rows. */
  top: number;
  h: number;
  /** The card's pan rate per unit of heading and its static size, as the baker derived them from the camera and the card's distance (ruling ridge-camera-on-circle). */
  scale: number;
  colour: string;
  geometry: string;
}

export interface RidgeManifest {
  bakeId: string;
  /** Absolute-or-rooted URL of the bake's directory, with a trailing slash. */
  dir: string;
  /** Display name of the place. */
  name: string;
  view: View;
  /** How the geometry card's blue channel maps to ln metres: `logD = logDMin + b x (logDMax - logDMin)`, b in 0..1. The red and green channels are the 'rt8' normal. */
  encoding: { logDMin: number; logDMax: number };
  /** The widest heading either side of the look azimuth the baked cards allow, degrees. */
  camera: { headingMaxDeg: number };
  /** Nearest first. */
  cards: CardEntry[];
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

export function parseIndex(raw: unknown): RidgeIndex {
  const r = rec(raw, 'index');
  if (r.schema !== 1) fail('index.schema', 'must be 1');
  const places = rec(r.places, 'index.places');
  const out = Object.fromEntries(
    Object.entries(places).map(([k, v]) => [k, str(v, `index.places.${k}`)])
  );
  return { default: str(r.default, 'index.default'), places: out };
}

/** `dir` is the URL of the directory the manifest was read from; the cards are read relative to it. */
export function parseManifest(raw: unknown, dir: string): RidgeManifest {
  const r = rec(raw, 'manifest');
  if (r.schema !== 2) fail('schema', 'must be 2');
  const p = rec(r.place, 'place');
  const v = rec(r.view, 'view');
  const planeW = num(v.plane_w, 'view.plane_w');
  if (planeW > PLANE_W_MAX) fail('view.plane_w', `above ${PLANE_W_MAX}`);
  const planeH = num(v.plane_h, 'view.plane_h');
  if (!Array.isArray(r.cards) || r.cards.length < 1) fail('cards', 'none');
  if ((r.cards as unknown[]).length > MAX_CARDS) fail('cards', `more than ${MAX_CARDS}`);
  const cards = (r.cards as unknown[]).map((x, i): CardEntry => {
    const c = rec(x, `cards[${i}]`);
    const top = num(c.top, `cards[${i}].top`);
    const h = num(c.h, `cards[${i}].h`);
    if (top < 0 || h < 1 || top + h > planeH) fail(`cards[${i}]`, 'outside the plane rows');
    const scale = num(c.scale, `cards[${i}].scale`);
    if (!(scale > 0)) fail(`cards[${i}].scale`, 'not above 0');
    return {
      top,
      h,
      scale,
      colour: str(rec(c.colour, `cards[${i}].colour`).file, `cards[${i}].colour.file`),
      geometry: str(rec(c.geometry, `cards[${i}].geometry`).file, `cards[${i}].geometry.file`),
    };
  });
  const e = rec(r.encoding, 'encoding');
  if (e.normal !== 'rt8') fail('encoding.normal', "must be 'rt8'");
  const logDMin = num(e.log_d_min, 'encoding.log_d_min');
  const logDMax = num(e.log_d_max, 'encoding.log_d_max');
  if (!(logDMax > logDMin)) fail('encoding', 'log_d_max not above log_d_min');
  const headingMaxDeg = num(rec(r.camera, 'camera').heading_max_deg, 'camera.heading_max_deg');
  if (!(headingMaxDeg > 0)) fail('camera.heading_max_deg', 'not above 0');
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
      },
      lookAzDeg: num(v.look_az_deg, 'view.look_az_deg'),
      windowDeg: num(v.window_deg, 'view.window_deg'),
      planeW,
      planeH,
      pxPerDegH: num(v.px_per_deg_h, 'view.px_per_deg_h'),
      pxPerDegV: num(v.px_per_deg_v, 'view.px_per_deg_v'),
      horizonRow: num(v.horizon_row, 'view.horizon_row'),
    },
    encoding: { logDMin, logDMax },
    camera: { headingMaxDeg },
    cards,
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

const memo = new Map<string, Promise<RidgeManifest>>();

/**
 * The manifest of a baked place: `${baseUrl}public/ridge/index.json` names each place's directory, then `<dir>/manifest.json` is read.
 * `placeId` picks the entry (unknown or absent: the index's default). Memoised per index URL and place; a failure is not remembered.
 * Rejects on any failure: the caller degrades to the sky-only scene.
 */
export function loadManifest(baseUrl: string, placeId?: string): Promise<RidgeManifest> {
  const root = `${baseUrl}public/ridge/`;
  const key = `${root}|${placeId ?? ''}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const p = (async () => {
    const index = parseIndex(
      // The index is the one mutable pointer (a rebake deletes the old directory it named); the manifest and planes are content-addressed.
      await getJson(`${root}index.json`, { cache: 'no-cache' })
    );
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

/** For tests: forget every memoised manifest. */
export const forgetManifests = (): void => memo.clear();
