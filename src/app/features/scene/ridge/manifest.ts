// The ridge backdrop's one JSON boundary: a static asset between the offline Python baker (scripts/ridge-bake/export.py, whose SCHEMA is the
// contract) and the page; no daemon state. Main-chunk safe: types, a parser and fetch only. Wire names are snake_case; the parsed manifest is
// camelCase and its `view` is the View (`view.ts`) the sky and the planes share.
import type { View } from './view';

export const FRAME_KEYS = ['dawn', 'morning', 'noon', 'golden', 'dusk', 'night'] as const;
export type FrameKey = typeof FRAME_KEYS[number];
export const PLANE_NAMES = ['far', 'mid', 'near'] as const;
export type PlaneName = typeof PLANE_NAMES[number];
export const PLANE_W_MAX = 4096;

export interface Frame {
  key: FrameKey;
  /** The sun this frame was lit by: degrees. */
  sun: { az: number; el: number };
  /** File names inside the manifest's directory. */
  planes: Record<PlaneName, string>;
}

export interface RidgeManifest {
  bakeId: string;
  /** Absolute-or-rooted URL of the bake's directory, with a trailing slash. */
  dir: string;
  /** Display name of the place. */
  name: string;
  view: View;
  /** In `FRAME_KEYS` order. */
  frames: Frame[];
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

/** `dir` is the URL of the directory the manifest was read from; the planes are read relative to it. */
export function parseManifest(raw: unknown, dir: string): RidgeManifest {
  const r = rec(raw, 'manifest');
  if (r.schema !== 1) fail('schema', 'must be 1');
  const p = rec(r.place, 'place');
  const v = rec(r.view, 'view');
  const planeW = num(v.plane_w, 'view.plane_w');
  if (planeW > PLANE_W_MAX) fail('view.plane_w', `above ${PLANE_W_MAX}`);
  if (!Array.isArray(r.frames) || r.frames.length < FRAME_KEYS.length)
    fail('frames', `fewer than ${FRAME_KEYS.length}`);
  const frames = FRAME_KEYS.map((key) => {
    const f = (r.frames as unknown[])
      .map((x, i) => rec(x, `frames[${i}]`))
      .find((x) => x.key === key);
    if (!f) return fail('frames', `no ${key} frame`);
    const sun = rec(f.sun, `frames.${key}.sun`);
    const planes = rec(f.planes, `frames.${key}.planes`);
    const file = (n: PlaneName) =>
      str(rec(planes[n], `frames.${key}.planes.${n}`).file, `frames.${key}.planes.${n}.file`);
    return {
      key,
      sun: { az: num(sun.az, `frames.${key}.sun.az`), el: num(sun.el, `frames.${key}.sun.el`) },
      planes: { far: file('far'), mid: file('mid'), near: file('near') },
    };
  });
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
      planeH: num(v.plane_h, 'view.plane_h'),
      pxPerDegH: num(v.px_per_deg_h, 'view.px_per_deg_h'),
      horizonRow: num(v.horizon_row, 'view.horizon_row'),
    },
    frames,
    attribution: {
      creditLine: str(a.credit_line, 'attribution.credit_line'),
      licence: str(a.licence, 'attribution.licence'),
      demSource: str(a.dem_source, 'attribution.dem_source'),
      url: str(a.url, 'attribution.url'),
    },
  };
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
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
    const index = parseIndex(await getJson(`${root}index.json`));
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
