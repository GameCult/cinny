// The ring: the one place that reasons about wrap-around at 0 / 360 degrees (a heading is unwrapped and never wrapped by a consumer), and the
// one place a card's distance at an azimuth is read from its tiles. Pure: no DOM, no state.
import type { RidgeManifest } from './manifest';
import type { View } from './view';

/** Tiles fetched beyond the arc each side, and tiles kept beyond it each side (the baker's resident gate counts the keep: `export.py` `run_tiles`; `view.ts` `maxSpeed` spends what it leaves). */
export const LOAD_MARGIN_TILES = 1;
export const KEEP_MARGIN_TILES = 2;

/** A compass angle brought into [0, 360). */
export const norm = (deg: number): number => ((deg % 360) + 360) % 360;

/** A tile of the ring and the revolution it is met in: its unwrapped azimuth is `turn x 360 + tile x (360 / tiles)`. */
export interface TileRef {
  tile: number;
  turn: number;
}

/**
 * The tiles that overlap `[centre - half, centre + half]`, unwrapped compass degrees, in increasing unwrapped azimuth. Each tile is named at most once
 * (an arc of a whole ring or more is every tile, from the one the arc starts in).
 */
export function residentTiles(
  view: Pick<View, 'tiles'>,
  centreDeg: number,
  halfArcDeg: number
): TileRef[] {
  const w = 360 / view.tiles;
  const first = Math.floor((centreDeg - halfArcDeg) / w);
  const last = Math.min(Math.floor((centreDeg + halfArcDeg) / w), first + view.tiles - 1);
  const out: TileRef[] = [];
  for (let u = first; u <= last; u += 1) {
    out.push({ tile: ((u % view.tiles) + view.tiles) % view.tiles, turn: Math.floor(u / view.tiles) });
  }
  return out;
}

/** The unwrapped azimuth of the left edge of a tile met in `turn`. */
export const tileAzimuth = (view: Pick<View, 'tiles'>, ref: TileRef): number =>
  ref.turn * 360 + (ref.tile * 360) / view.tiles;

/**
 * The distance of card `card` at compass angle `azDeg`, metres: the circular linear interpolation of the tiles' `distanceM` between tile centres, a tile
 * where the card is absent skipped (the line runs on to the next tile that holds it; a card in one tile only has that distance all round).
 */
export function distanceAt(manifest: RidgeManifest, card: number, azDeg: number): number {
  const n = manifest.view.tiles;
  const at = (t: number) => manifest.tiles[t][card]?.distanceM;
  const u = norm(azDeg) / (360 / n) - 0.5; // tile-centre coordinates: tile t's centre is at t
  const lo = Math.floor(u);
  const frac = u - lo;
  const held = (from: number, step: number): number => {
    for (let k = 0; k < n; k += 1) {
      const t = (((from + step * k) % n) + n) % n;
      if (at(t) !== undefined) return k;
    }
    throw new Error(`ridge: card ${card} is in no tile`);
  };
  // The nearest tiles that hold the card at or before the point (back) and after it (ahead), by how many tile steps away they are.
  const back = held(lo, -1);
  const ahead = held(lo + 1, 1);
  const tBack = (((lo - back) % n) + n) % n;
  const tAhead = (((lo + 1 + ahead) % n) + n) % n;
  const dBack = at(tBack) as number;
  const dAhead = at(tAhead) as number;
  const span = back + 1 + ahead; // tile steps between the two holders
  const along = back + frac; // steps from the back holder to the point
  return dBack + (dAhead - dBack) * (along / span);
}

/**
 * N: the tiles the loader may hold at once for a bake (export.py `run_tiles`): the widest viewport arc at the smallest slide rate plus the offset's own
 * swing, one straddled tile and two tiles of margin each side. `rminM` is the nearest card's nearest distance.
 */
export function runTiles(view: Pick<View, 'tiles'>, hfovMaxDeg: number, rMaxM: number, rminM: number): number {
  const sMin = rminM / (rminM + rMaxM);
  const arc = hfovMaxDeg / sMin + 2 * (rMaxM / rminM) * 57.3;
  return Math.min(view.tiles, Math.ceil(arc / (360 / view.tiles)) + 1 + 4);
}
