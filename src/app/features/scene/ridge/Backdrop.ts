// The ridge cards the scene composes, lit, kept resident by tile: the one owner of which tiles of the ring are in memory. `ensure` is told the arc of
// azimuth the view is about to need; it fetches and decodes the tiles of that arc it does not hold, one tile at a time, lights each card of a tile
// (`lightCards.ts`, one lighter for the one sky this backdrop was made for) and drops the tiles beyond the arc and its margin. The files of the tiles to make
// are fetched a few at a time, each against a timeout. A tile that fails is a tile the scene draws as absence, asked for again by the loader itself after a growing
// pause, for as long as the arc last asked for wants it (whoever asked, a scene's timer or none: a still has no timer); a file the server says is not there (404) is
// not asked for again while its tile stays: the scene draws the cards of the tile that came. Nothing is thrown into the scene.
import type { RidgeManifest } from './manifest';
import type { PhysicalSky } from './physicalSky';
import { createLighter, DEFAULT_LOOK } from './lightCards';
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
  /**
   * Hold the tiles of `arc` and one tile beyond it each side; let go of those past two tiles. Resolves when every tile it could make is made. They are asked for
   * and made nearest first to `first`, the arc the view shows now (the middle of `arc` when absent), so what is on screen comes before what the sweep reaches later.
   */
  ensure(arc: Arc, first?: Arc): Promise<void>;
  /** Every card of every tile held, in no order. */
  litTiles(): readonly LitTile[];
  /** Hear each tile as it is made and held, however late (a still scene has no timer of its own and draws only what it held); not a tile that failed. Returns the way to stop. */
  onTile(cb: () => void): () => void;
  /**
   * Light at scale `s` (`view.ts` `litScale`) from now on: a new lighter, every held tile marked stale and made again nearest the view first on the passes that follow.
   * An old canvas stays held, and drawn, until its replacement is made, so a rescale never blanks a tile. The same scale does nothing; a lighter that cannot be made
   * leaves the scale as it was.
   */
  setScale(s: number): void;
  /** What the lighting is costing now, for the probe: the scale, the renderer, the last light times (ms) at this scale, and the pixels and bytes of the lit canvases held. */
  stats(): { scale: number; renderer: string; lightMs: readonly number[]; litPx: number; litBytes: number };
  /** Let go of everything, the lighting context included. Idempotent. */
  dispose(): void;
}

export interface BackdropDeps {
  /** Rejects with `NotFound` when the server has no such file, with anything else for a failure that may pass. `signal` aborts it. */
  fetchBlob: (url: string, signal?: AbortSignal) => Promise<Blob>;
  decode: (blob: Blob) => Promise<ImageBitmap>;
  lighter: (manifest: RidgeManifest, sky: PhysicalSky, scale: number) => Lighter;
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
  scale: number,
  deps: Partial<BackdropDeps> = {}
): Backdrop {
  const get = deps.fetchBlob ?? fetchBlob;
  const open = deps.decode ?? decode;
  const makeLighter = deps.lighter ?? ((m: RidgeManifest, sk: PhysicalSky, sc: number) => createLighter(m, sk, DEFAULT_LOOK, sc));
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const { view } = manifest;
  const tileDeg = 360 / view.tiles;
  /** The scale tiles are lit at now (`setScale` changes it). */
  let lit = scale;
  let lighter = makeLighter(manifest, sky, lit);
  const held = new Map<number, LitTile[]>();
  /** Held tiles lit at a scale since left: made again, nearest the view first, each replacing its canvases only once the new ones exist. */
  const stale = new Set<number>();
  /**
   * Canvases a replacement made unused. A scene may still have one mounted until its next mount, so they are not emptied when replaced: `litTiles` is the scene's
   * read of what is held, and a canvas retired before its second-to-last call has been left out of one mount by then.
   */
  let retiring: HTMLCanvasElement[] = [];
  let retired: HTMLCanvasElement[] = [];
  /** Tiles that failed, when they may be asked for again and the pause after the next failure. */
  const failed = new Map<number, { until: number; pause: number }>();
  const heard = new Set<() => void>();
  let disposed = false;
  let running: Promise<void> | null = null;
  let want: { arc: Arc; first?: Arc } | null = null;
  /** The arc last asked for: what the loader keeps its tiles for and retries for. */
  let wanted: { arc: Arc; first?: Arc } | null = null;
  /** Ask for the arc wanted once more: a pass ends in `schedule`, which is defined before the backdrop that can be asked. */
  let askAgain: () => void = () => undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  /** The pass that is on the wire: dispose gives up its requests, as a newer arc does. */
  let current: AbortController | null = null;

  const empty = (c: HTMLCanvasElement) => {
    c.width = 0;
    c.height = 0;
  };
  const drop = (tile: number) => {
    held.get(tile)?.forEach((t) => empty(t.canvas));
    held.delete(tile);
    stale.delete(tile);
  };

  // At most FETCH_PARALLEL requests at once over every tile, each with its own timeout (the signal is passed on, and a fetch that ignores it is still given up on).
  // A slot is handed straight to the next waiter, so `active` never dips for a request issued in between to slip into; it falls only when nobody waits.
  let active = 0;
  const queue: (() => void)[] = [];
  const request = async (url: string, signal: AbortSignal): Promise<Blob> => {
    if (active < FETCH_PARALLEL) active += 1;
    else await new Promise<void>((go) => queue.push(go));
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
      const next = queue.shift();
      if (next) next();
      else active -= 1;
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
    const at = lit;
    try {
      if (fetched.some((f) => f.files.includes('failed'))) throw new Error('ridge: a file of the tile failed');
      if (lighter.lost) {
        lighter.release();
        lighter = makeLighter(manifest, sky, lit);
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
      held.get(tile)?.forEach((t) => retiring.push(t.canvas));
      held.set(tile, made);
      stale.delete(tile);
      if (at !== lit) stale.add(tile); // the scale changed while this tile was made: it is made again
      failed.delete(tile);
      heard.forEach((cb) => cb());
    } catch {
      made.forEach((t) => (t.canvas.width = 0));
      const pause = Math.min(RETRY_MAX_MS, (failed.get(tile)?.pause ?? RETRY_FIRST_MS / 2) * 2);
      failed.set(tile, { until: now() + pause, pause });
    } finally {
      bitmaps.forEach((b) => b.close?.());
    }
  }

  async function pass(arc: Arc, first?: Arc): Promise<void> {
    const centre = (arc.fromDeg + arc.toDeg) / 2;
    const from0 = first ? (first.fromDeg + first.toDeg) / 2 : centre;
    const half = (arc.toDeg - arc.fromDeg) / 2;
    const near = residentTiles(view, centre, half + LOAD_MARGIN_TILES * tileDeg);
    const keep = new Set(
      residentTiles(view, centre, half + KEEP_MARGIN_TILES * tileDeg).map((r) => r.tile)
    );
    [...held.keys()].filter((t) => !keep.has(t)).forEach(drop);
    // The tile under the view first, then outward along the sweep: what the view needs now comes before what it needs next.
    const from = (r: { tile: number; turn: number }) => r.turn * 360 + r.tile * tileDeg + tileDeg / 2;
    const order = [...near]
      .sort((a, b) => Math.abs(from(a) - from0) - Math.abs(from(b) - from0))
      .map((r) => r.tile)
      .filter((t) => (!held.has(t) || stale.has(t)) && (failed.get(t)?.until ?? 0) <= now());
    // Every tile's files are asked for at once (the requests queue to FETCH_PARALLEL, in this order) and made one tile at a time as they arrive.
    const stop = new AbortController();
    current = stop;
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
      if (current === stop) current = null;
    }
  }

  /** When the arc wanted holds a tile that failed, ask for it again at the end of its pause: the loader's own retry, the same for every tier. */
  function schedule(): void {
    clearTimeout(retry);
    retry = undefined;
    if (disposed || !wanted) return;
    const { arc } = wanted;
    const half = (arc.toDeg - arc.fromDeg) / 2 + LOAD_MARGIN_TILES * tileDeg;
    const due = residentTiles(view, (arc.fromDeg + arc.toDeg) / 2, half)
      .filter((r) => (!held.has(r.tile) || stale.has(r.tile)) && failed.has(r.tile))
      .map((r) => (failed.get(r.tile) as { until: number }).until);
    if (!due.length) return;
    retry = setTimeout(() => {
      retry = undefined;
      askAgain();
    }, Math.max(0, Math.min(...due) - now()));
  }

  async function loop(): Promise<void> {
    while (want && !disposed) {
      const { arc, first } = want;
      want = null;
      await pass(arc, first);
    }
    schedule();
  }

  const api: Backdrop = {
    manifest,
    ensure(arc, first) {
      if (disposed) return Promise.resolve();
      wanted = { arc, first };
      want = wanted;
      running ??= loop().finally(() => {
        running = null;
      });
      return running;
    },
    litTiles: () => {
      retired.forEach(empty);
      retired = retiring;
      retiring = [];
      return [...held.values()].flat();
    },
    setScale(s) {
      if (disposed || s === lit) return;
      let next: Lighter;
      try {
        next = makeLighter(manifest, sky, s);
      } catch {
        return;
      }
      lighter.release();
      lighter = next;
      lit = s;
      held.forEach((_, tile) => stale.add(tile));
      askAgain();
    },
    stats() {
      const canvases = [...held.values()].flat().map((t) => t.canvas);
      const litPx = canvases.reduce((a, c) => a + c.width * c.height, 0);
      return { scale: lit, renderer: lighter.renderer, lightMs: lighter.lightMs, litPx, litBytes: litPx * 4 };
    },
    onTile(cb) {
      heard.add(cb);
      return () => heard.delete(cb);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      heard.clear();
      wanted = null;
      want = null;
      clearTimeout(retry);
      current?.abort(); // a scene that did not wait for its tiles, or was replaced, leaves nothing asking for them
      [...held.keys()].forEach(drop);
      [...retired, ...retiring].forEach(empty);
      retired = [];
      retiring = [];
      lighter.release();
    },
  };
  askAgain = () => {
    if (wanted) api.ensure(wanted.arc, wanted.first).catch(() => undefined);
  };
  return api;
}
