// The ridge cards the scene composes, lit, kept resident by tile: the one owner of which tiles of the ring are in memory. `ensure` is told the arc of
// azimuth the view is about to need; it fetches and decodes the tiles of that arc it does not hold, one tile at a time, lights each card of a tile
// (`lightCards.ts`, one lighter for the one sky this backdrop was made for) and drops the tiles beyond the arc and its margin. The files of the tiles to make
// are fetched a few at a time, each against a timeout. A tile that fails is a tile the scene draws as absence, asked for again after a growing pause; a file
// the server says is not there (404) is not asked for again while its tile stays: the scene draws the cards of the tile that came. Nothing is thrown into the scene.
import type { RidgeManifest } from './manifest';
import type { PhysicalSky } from './physicalSky';
import { createLighter } from './lightCards';
import type { CardBitmaps, Lighter } from './lightCards';
import { KEEP_MARGIN_TILES, LOAD_MARGIN_TILES, residentTiles } from './ring';

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
  /** Rejects with `NotFound` when the server has no such file, with anything else for a failure that may pass. `signal` aborts it. */
  fetchBlob: (url: string, signal?: AbortSignal) => Promise<Blob>;
  decode: (blob: Blob) => Promise<ImageBitmap>;
  lighter: (manifest: RidgeManifest, sky: PhysicalSky) => Lighter;
  /** The clock (ms) the pauses between a tile's attempts run on. */
  now: () => number;
}

/** A file the server answered 404 or 410 for: asking again will not make it appear. */
export class NotFound extends Error {}

/** Requests in flight at once, over all tiles; how long one may take; the pause before a failed tile is asked for again (doubled each failure, to the cap). */
export const FETCH_PARALLEL = 6;
export const FETCH_TIMEOUT_MS = 15_000;
export const RETRY_FIRST_MS = 1_000;
export const RETRY_MAX_MS = 60_000;

const fetchBlob = async (url: string, signal?: AbortSignal): Promise<Blob> => {
  const res = await fetch(url, { signal });
  if (res.status === 404 || res.status === 410) throw new NotFound(`ridge: ${url} answered ${res.status}`);
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
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const { view } = manifest;
  const tileDeg = 360 / view.tiles;
  let lighter = makeLighter(manifest, sky);
  const held = new Map<number, LitTile[]>();
  /** Tiles that failed, when they may be asked for again and the pause after the next failure. */
  const failed = new Map<number, { until: number; pause: number }>();
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

  // At most FETCH_PARALLEL requests at once over every tile, each with its own timeout (the signal is passed on, and a fetch that ignores it is still given up on).
  let active = 0;
  const queue: (() => void)[] = [];
  const request = async (url: string, signal: AbortSignal): Promise<Blob> => {
    if (active >= FETCH_PARALLEL) await new Promise<void>((go) => queue.push(go));
    active += 1;
    try {
      if (signal.aborted) throw new Error('ridge: aborted');
      return await new Promise<Blob>((resolve, reject) => {
        const ctl = new AbortController();
        const stop = () => {
          ctl.abort();
          reject(new Error(`ridge: ${url} ${signal.aborted ? 'aborted' : 'timed out'}`));
        };
        const timer = setTimeout(stop, FETCH_TIMEOUT_MS);
        signal.addEventListener('abort', stop, { once: true });
        get(url, ctl.signal).then(resolve, reject).finally(() => {
          clearTimeout(timer);
          signal.removeEventListener('abort', stop);
        });
      });
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };

  /** The files of a tile, each settled on its own: a blob, or what became of it (`gone`: the server has none; `failed`: it may pass). */
  type Fetched = { blob: Blob } | 'gone' | 'failed';
  async function fetchTile(tile: number, signal: AbortSignal): Promise<{ card: number; files: Fetched[] }[]> {
    const cards = manifest.tiles[tile].flatMap((e, card) => (e ? [{ e, card }] : []));
    return Promise.all(
      cards.map(async ({ e, card }) => ({
        card,
        files: await Promise.all(
          [e.colour, e.geometry].map(
            (f): Promise<Fetched> =>
              request(`${manifest.dir}${f}`, signal).then(
                (blob) => ({ blob }),
                (err: unknown) => (err instanceof NotFound ? 'gone' : 'failed')
              )
          )
        ),
      }))
    );
  }

  /**
   * Decode and light what a tile's fetch brought, one card at a time, and hold the tile. A card with a file the server does not have is left out (the scene
   * draws the others); a tile with any file that failed otherwise is not kept (it is lit whole or not at all) and is asked for again after a pause.
   */
  async function make(tile: number, fetched: { card: number; files: Fetched[] }[]): Promise<void> {
    const made: LitTile[] = [];
    const bitmaps: ImageBitmap[] = [];
    try {
      if (fetched.some((f) => f.files.includes('failed'))) throw new Error('ridge: a file of the tile failed');
      if (lighter.lost) {
        lighter.release();
        lighter = makeLighter(manifest, sky);
      }
      for (const { card, files } of fetched) {
        if (files.includes('gone')) continue;
        const [colour, geometry] = await Promise.all(
          files.map(async (f) => {
            const b = await open((f as { blob: Blob }).blob);
            bitmaps.push(b);
            return b;
          })
        );
        if (disposed) return;
        made.push({ tile, card, canvas: lighter.light({ colour, geometry }, tile, card) });
      }
      held.set(tile, made);
      failed.delete(tile);
    } catch {
      made.forEach((t) => (t.canvas.width = 0));
      const pause = Math.min(RETRY_MAX_MS, (failed.get(tile)?.pause ?? RETRY_FIRST_MS / 2) * 2);
      failed.set(tile, { until: now() + pause, pause });
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
    const order = [...near]
      .sort((a, b) => Math.abs(from(a) - centre) - Math.abs(from(b) - centre))
      .map((r) => r.tile)
      .filter((t) => !held.has(t) && (failed.get(t)?.until ?? 0) <= now());
    // Every tile's files are asked for at once (the requests queue to FETCH_PARALLEL, in this order) and made one tile at a time as they arrive.
    const stop = new AbortController();
    try {
      const asked = order.map((tile) => fetchTile(tile, stop.signal));
      for (const [i, tile] of order.entries()) {
        const fetched = await asked[i];
        if (disposed) return;
        await make(tile, fetched);
        // A newer arc is waiting: take it up now, with this tile made, instead of finishing an arc the view has left.
        if (want && held.has(tile)) return;
      }
    } finally {
      stop.abort(); // what is still on the wire is for an arc the view has left
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
