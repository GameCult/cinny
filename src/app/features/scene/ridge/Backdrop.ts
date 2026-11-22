// The ridge cards the scene composes, lit, kept resident by tile: the one owner of which tiles of the ring are in memory. `ensure` is told the arc of
// azimuth the view is about to need; it fetches and decodes the tiles of that arc it does not hold, one tile at a time, lights each card of a tile
// (`lightCards.ts`, one lighter for the one sky this backdrop was made for) and drops the tiles beyond the arc and its margin. A tile that fails is a
// tile the scene draws as absence, retried at the next `ensure`; it is never thrown into the scene.
import type { RidgeManifest } from './manifest';
import type { PhysicalSky } from './physicalSky';
import { createLighter } from './lightCards';
import type { CardBitmaps, Lighter } from './lightCards';
import { residentTiles } from './ring';

/** A range of unwrapped compass azimuth, degrees, `fromDeg <= toDeg`. */
export interface Arc {
  fromDeg: number;
  toDeg: number;
}

/** One card of one tile, lit: its pixels premultiplied by the card's alpha, `tileW + 2` columns by the band's rows. */
export interface LitTile {
  tile: number;
  card: number;
  canvas: HTMLCanvasElement;
}

export interface Backdrop {
  manifest: RidgeManifest;
  /** Hold the tiles of `arc` and one tile beyond it each side; let go of those past two tiles. Resolves when every tile it could make is made. */
  ensure(arc: Arc): Promise<void>;
  /** Every card of every tile held, in no order. */
  litTiles(): readonly LitTile[];
  /** Let go of everything, the lighting context included. Idempotent. */
  dispose(): void;
}

export interface BackdropDeps {
  fetchBlob: (url: string) => Promise<Blob>;
  decode: (blob: Blob) => Promise<ImageBitmap>;
  lighter: (manifest: RidgeManifest, sky: PhysicalSky) => Lighter;
}

/** Tiles fetched beyond the arc each side, and tiles kept beyond it each side (the baker's resident gate counts the keep: `export.py` `run_tiles`). */
export const LOAD_MARGIN_TILES = 1;
export const KEEP_MARGIN_TILES = 2;

const fetchBlob = async (url: string): Promise<Blob> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ridge: ${url} answered ${res.status}`);
  return res.blob();
};

/** Straight alpha and the file's own values: the colour file's alpha is coverage and the geometry file's channels are data, so neither may be premultiplied or colour-managed. */
const decode = (blob: Blob): Promise<ImageBitmap> =>
  createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });

/**
 * A backdrop for `sky`. Throws at once when the cards cannot be lit (no WebGL2, a shader that will not link): the caller makes the sky-only scene.
 * Nothing is fetched until the first `ensure`.
 */
export function createBackdrop(
  manifest: RidgeManifest,
  sky: PhysicalSky,
  deps: Partial<BackdropDeps> = {}
): Backdrop {
  const get = deps.fetchBlob ?? fetchBlob;
  const open = deps.decode ?? decode;
  const makeLighter = deps.lighter ?? createLighter;
  const { view } = manifest;
  const tileDeg = 360 / view.tiles;
  let lighter = makeLighter(manifest, sky);
  const held = new Map<number, LitTile[]>();
  let disposed = false;
  let running: Promise<void> | null = null;
  let want: Arc | null = null;

  const drop = (tile: number) => {
    held.get(tile)?.forEach((t) => {
      t.canvas.width = 0;
      t.canvas.height = 0;
    });
    held.delete(tile);
  };

  /** Fetch, decode and light every card of a tile; a tile that is only partly made is not kept. */
  async function make(tile: number): Promise<void> {
    const cards = manifest.tiles[tile].flatMap((e, card) => (e ? [{ e, card }] : []));
    const made: LitTile[] = [];
    const bitmaps: ImageBitmap[] = [];
    try {
      if (lighter.lost) {
        lighter.release();
        lighter = makeLighter(manifest, sky);
      }
      const pairs: CardBitmaps[] = [];
      for (const { e } of cards) {
        const [colour, geometry] = await Promise.all(
          [e.colour, e.geometry].map(async (f) => {
            const b = await open(await get(`${manifest.dir}${f}`));
            bitmaps.push(b);
            return b;
          })
        );
        pairs.push({ colour, geometry });
      }
      if (disposed) return;
      cards.forEach(({ card }, i) => made.push({ tile, card, canvas: lighter.light(pairs[i], tile, card) }));
      held.set(tile, made);
    } catch {
      made.forEach((t) => (t.canvas.width = 0));
    } finally {
      bitmaps.forEach((b) => b.close?.());
    }
  }

  async function pass(arc: Arc): Promise<void> {
    const centre = (arc.fromDeg + arc.toDeg) / 2;
    const half = (arc.toDeg - arc.fromDeg) / 2;
    const near = residentTiles(view, centre, half + LOAD_MARGIN_TILES * tileDeg);
    const keep = new Set(
      residentTiles(view, centre, half + KEEP_MARGIN_TILES * tileDeg).map((r) => r.tile)
    );
    [...held.keys()].filter((t) => !keep.has(t)).forEach(drop);
    // The tile under the middle of the arc first: what the view needs now comes before what it needs next.
    const from = (r: { tile: number; turn: number }) => r.turn * 360 + r.tile * tileDeg + tileDeg / 2;
    const order = [...near].sort((a, b) => Math.abs(from(a) - centre) - Math.abs(from(b) - centre));
    for (const { tile } of order) {
      if (disposed) return;
      if (held.has(tile)) continue;
      await make(tile);
      // A newer arc is waiting: take it up now, with this tile made, instead of finishing an arc the view has left.
      if (want && held.has(tile)) return;
    }
  }

  async function loop(): Promise<void> {
    while (want && !disposed) {
      const arc = want;
      want = null;
      await pass(arc);
    }
  }

  return {
    manifest,
    ensure(arc) {
      if (disposed) return Promise.resolve();
      want = arc;
      running ??= loop().finally(() => {
        running = null;
      });
      return running;
    },
    litTiles: () => [...held.values()].flat(),
    dispose() {
      if (disposed) return;
      disposed = true;
      want = null;
      [...held.keys()].forEach(drop);
      lighter.release();
    },
  };
}
