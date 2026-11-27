import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  createBackdrop,
  FETCH_PARALLEL,
  FETCH_TIMEOUT_MS,
  NotFound,
  RETRY_FIRST_MS,
  RETRY_MAX_MS,
} from './Backdrop';
import type { CardBitmaps, Lighter } from './lightCards';
import { parseManifest } from './manifest';
import { wireManifest } from './manifest.fixture';
import type { PhysicalSky } from './physicalSky';
import { KEEP_MARGIN_TILES, LOAD_MARGIN_TILES, residentTiles, runTiles } from './ring';
import { HFOV_MAX_DEG } from './view';

const sky = {} as PhysicalSky;
const manifest = parseManifest(wireManifest({}, 3, 32), '/d/'); // the ring as the baker cuts it: 32 tiles of 11.25 degrees, 3 cards
const tileOf = (url: string) => Number(/-t(\d\d)-/.exec(url)?.[1]);

/** A decoder that keeps count: which bitmaps are open, which tiles are being decoded at once. */
const rig = (fail: (url: string) => boolean = () => false, missing: (url: string) => boolean = () => false) => {
  const fetched: string[] = [];
  const bitmaps: { url: string; closed: boolean; close: () => void }[] = [];
  let inFlight = new Map<number, number>();
  let mostTiles = 0;
  let clock = 0;
  const fetchBlob = vi.fn(async (url: string, _signal?: AbortSignal) => {
    fetched.push(url);
    if (missing(url)) throw new NotFound('ridge: 404');
    if (fail(url)) throw new Error('ridge: 503');
    return { url } as unknown as Blob;
  });
  const decode = vi.fn(async (blob: Blob) => {
    const { url } = blob as unknown as { url: string };
    const t = tileOf(url);
    inFlight.set(t, (inFlight.get(t) ?? 0) + 1);
    mostTiles = Math.max(mostTiles, inFlight.size);
    await new Promise((r) => setTimeout(r, 0));
    inFlight.set(t, (inFlight.get(t) ?? 1) - 1);
    if (inFlight.get(t) === 0) inFlight.delete(t);
    const b = { url, closed: false, close: () => (b.closed = true) };
    bitmaps.push(b);
    return b as unknown as ImageBitmap;
  });
  const canvases: { tile: number; card: number; width: number; height: number }[] = [];
  const lighter = (): Lighter & { light: Mock<[CardBitmaps, number, number], HTMLCanvasElement> } => ({
    lost: false,
    scale: 1,
    lightMs: [],
    renderer: 'test',
    release: vi.fn(),
    light: vi.fn((_b: CardBitmaps, tile: number, card: number) => {
      const c = { tile, card, width: 202, height: 100 };
      canvases.push(c);
      return c as unknown as HTMLCanvasElement;
    }),
  });
  return {
    fetched,
    bitmaps,
    fetchBlob,
    decode,
    canvases,
    lighter,
    mostTiles: () => mostTiles,
    now: () => clock,
    tick: (ms: number) => void (clock += ms),
  };
};

const urlsOfTiles = (tiles: number[]) =>
  tiles.flatMap((t) =>
    manifest.tiles[t].flatMap((e) => (e ? [`/d/${e.colour}`, `/d/${e.geometry}`] : []))
  );
const arc72 = (centre: number) => ({ fromDeg: centre - 36, toDeg: centre + 36 });

afterEach(() => {
  vi.useRealTimers();
});

describe('createBackdrop', () => {
  it('fetches nothing until it is asked, and then the files of the tiles of the arc and one tile beyond it, straight, and no others', async () => {
    const r = rig();
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: r.lighter });
    expect(r.fetchBlob).not.toHaveBeenCalled();
    await bd.ensure(arc72(180));
    const want = residentTiles(manifest.view, 180, 36 + LOAD_MARGIN_TILES * 11.25).map((t) => t.tile);
    expect(want).toHaveLength(10);
    expect([...r.fetched].sort()).toEqual(urlsOfTiles(want).sort());
    expect(bd.litTiles().map((t) => t.tile).sort((a, b) => a - b)).toEqual(
      want.flatMap((t) => manifest.tiles[t].flatMap((e, card) => (e ? [t] : []))).sort((a, b) => a - b)
    );
    r.bitmaps.forEach((b) => expect(b.closed).toBe(true));
  });

  it('lights each card of a tile that holds it, naming the tile and the card, and leaves a card the tile lacks out', async () => {
    const r = rig();
    const lighter = r.lighter();
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: () => lighter });
    await bd.ensure({ fromDeg: 208, toDeg: 209 });
    const calls = lighter.light.mock.calls.map((c) => [c[1], c[2]]);
    // Tile 17 holds three cards; tile 18 (18 % 4 = 2) holds only two: card 2 is absent there.
    expect(calls).toContainEqual([17, 2]);
    expect(calls).toContainEqual([18, 1]);
    expect(calls).not.toContainEqual([18, 2]);
    const colourOf = (c: unknown[]) => (c[0] as { colour: { url: string } }).colour.url;
    expect(lighter.light.mock.calls.every((c) => colourOf(c).includes(`-t${String(c[1]).padStart(2, '0')}-`))).toBe(true);
  });

  it('decodes with straight alpha and no colour management by default', async () => {
    const made: unknown[] = [];
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async (_b: unknown, opts: unknown) => {
        made.push(opts);
        return { close: () => undefined };
      })
    );
    const r = rig();
    const bd = createBackdrop(manifest, sky, 1, { fetchBlob: r.fetchBlob, lighter: r.lighter });
    await bd.ensure({ fromDeg: 0, toDeg: 1 });
    expect(made.length).toBeGreaterThan(0);
    made.forEach((o) => expect(o).toEqual({ premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
    vi.unstubAllGlobals();
  });

  it('decodes one tile at a time', async () => {
    const r = rig();
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: r.lighter });
    await bd.ensure(arc72(100));
    expect(r.decode).toHaveBeenCalled();
    expect(r.mostTiles()).toBe(1);
  });

  it('sweeping the heading through 360 degrees fetches each tile once on the way and never holds more than the baker counted', async () => {
    const r = rig();
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: r.lighter });
    const N = runTiles(manifest.view, HFOV_MAX_DEG, manifest.camera.rMaxM, 1000);
    const per = new Map<number, number>();
    let most = 0;
    for (let h = 0; h <= 360; h += 6) {
      await bd.ensure(arc72(h));
      most = Math.max(most, new Set(bd.litTiles().map((t) => t.tile)).size);
    }
    // Card 0 is in every tile: its colour file counts a tile's fetches.
    for (const u of r.fetched) {
      if (u.includes('card-0-') && u.endsWith('colour.webp')) per.set(tileOf(u), (per.get(tileOf(u)) ?? 0) + 1);
    }
    expect(per.size).toBe(32);
    // The tiles round north are held at the start and wanted again at the end of the turn: those two fetches aside, every tile came once.
    const start = new Set(residentTiles(manifest.view, 0, 36 + LOAD_MARGIN_TILES * 11.25).map((t) => t.tile));
    for (const [t, n] of per) expect(n, `tile ${t}`).toBe(start.has(t) ? 2 : 1);
    expect(most).toBeLessThanOrEqual(N);
    expect(most).toBeLessThanOrEqual(
      Math.ceil((72 + 2 * KEEP_MARGIN_TILES * 11.25) / 11.25) + 1
    );
  });

  it('lets go of the tiles beyond the arc and two tiles of margin, and makes nothing twice that it still holds', async () => {
    const r = rig();
    const lighter = r.lighter();
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: () => lighter });
    await bd.ensure(arc72(180));
    const first = bd.litTiles();
    const lit = lighter.light.mock.calls.length;
    await bd.ensure(arc72(180)); // the same arc again: nothing is made
    expect(lighter.light.mock.calls.length).toBe(lit);
    await bd.ensure(arc72(0)); // the far side of the ring: everything held before is let go
    first.forEach((t) => expect(t.canvas.width).toBe(0));
    const keep = new Set(
      residentTiles(manifest.view, 0, 36 + KEEP_MARGIN_TILES * 11.25).map((t) => t.tile)
    );
    expect(bd.litTiles().length).toBeGreaterThan(0);
    bd.litTiles().forEach((t) => {
      expect(keep.has(t.tile)).toBe(true);
      expect(t.canvas.width).toBe(202);
    });
  });

  it('a tile that fails is absent, not an error, and is made at the next ensure', async () => {
    let broken = true;
    const r = rig((u) => broken && tileOf(u) === 16 && u.includes('card-1-'));
    const lighter = r.lighter();
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: () => lighter });
    await expect(bd.ensure({ fromDeg: 180, toDeg: 181 })).resolves.toBeUndefined();
    expect(bd.litTiles().some((t) => t.tile === 16)).toBe(false); // a tile is lit whole or not at all
    expect(bd.litTiles().some((t) => t.tile === 15)).toBe(true);
    r.bitmaps.forEach((b) => expect(b.closed).toBe(true));
    broken = false;
    r.tick(RETRY_FIRST_MS); // after its pause
    await bd.ensure({ fromDeg: 180, toDeg: 181 });
    expect(bd.litTiles().filter((t) => t.tile === 16).map((t) => t.card).sort()).toEqual([0, 1, 2]);
  });

  it('a lighting pass that throws is a failed tile too', async () => {
    const r = rig();
    const lighter = r.lighter();
    lighter.light.mockImplementation(() => {
      throw new Error('no 2D context');
    });
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: () => lighter });
    await expect(bd.ensure({ fromDeg: 0, toDeg: 1 })).resolves.toBeUndefined();
    expect(bd.litTiles()).toEqual([]);
    r.bitmaps.forEach((b) => expect(b.closed).toBe(true));
  });

  it('is made only where the cards can be lit: a lighter that throws is the caller to answer for', () => {
    const r = rig();
    expect(() =>
      createBackdrop(manifest, sky, 1, {
        ...r,
        lighter: () => {
          throw new Error('ridge: no WebGL2');
        },
      })
    ).toThrow(/WebGL2/);
  });

  it('makes another lighter after the context is lost, and releases the spent one', async () => {
    const r = rig();
    const first = r.lighter();
    const second = r.lighter();
    const make = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: make });
    await bd.ensure({ fromDeg: 0, toDeg: 1 });
    expect(first.light).toHaveBeenCalled();
    (first as { lost: boolean }).lost = true;
    await bd.ensure({ fromDeg: 180, toDeg: 181 });
    expect(make).toHaveBeenCalledTimes(2);
    expect(first.release).toHaveBeenCalled();
    expect(second.light).toHaveBeenCalled();
  });

  it('takes the newest arc when asked again mid-pass, and answers every caller once everything it could make is made', async () => {
    const r = rig();
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: r.lighter });
    const a = bd.ensure(arc72(40));
    const b = bd.ensure(arc72(220));
    await Promise.all([a, b]);
    const held = new Set(bd.litTiles().map((t) => t.tile));
    residentTiles(manifest.view, 220, 36 + LOAD_MARGIN_TILES * 11.25).forEach((t) => expect(held.has(t.tile)).toBe(true));
  });

  it('tells a listener of each tile as it is made, not of a tile that failed, and no longer once it stops listening or the backdrop is disposed', async () => {
    const r = rig((url) => tileOf(url) === 17);
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: r.lighter });
    const seen: number[] = [];
    const off = bd.onTile(() => seen.push(bd.litTiles().length));
    await bd.ensure({ fromDeg: 180, toDeg: 181 }); // tiles 15 to 17 and the margin: 17 fails
    const made = new Set(bd.litTiles().map((t) => t.tile));
    expect(made.has(17)).toBe(false);
    expect(seen).toHaveLength(made.size); // one call per tile held, each with its tile already held
    seen.forEach((n, i) => expect(n).toBeGreaterThan(i));
    off();
    await bd.ensure({ fromDeg: 0, toDeg: 1 });
    expect(seen).toHaveLength(made.size);
    const late = vi.fn();
    bd.onTile(late);
    bd.dispose();
    await bd.ensure({ fromDeg: 100, toDeg: 101 });
    expect(late).not.toHaveBeenCalled();
  });

  it('disposes: the canvases are dropped, the lighting context released, and a later ensure does nothing', async () => {
    const r = rig();
    const lighter = r.lighter();
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: () => lighter });
    await bd.ensure({ fromDeg: 0, toDeg: 1 });
    const lit = bd.litTiles().map((t) => t.canvas);
    expect(lit.length).toBeGreaterThan(0);
    bd.dispose();
    bd.dispose();
    expect(lighter.release).toHaveBeenCalledTimes(1);
    lit.forEach((c) => expect(c.width).toBe(0));
    expect(bd.litTiles()).toEqual([]);
    const n = r.fetched.length;
    await bd.ensure({ fromDeg: 100, toDeg: 101 });
    expect(r.fetched).toHaveLength(n);
  });

  it('asks for the tile under the view first and then outward, not outward from the middle of the sweep', async () => {
    const r = rig();
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: r.lighter });
    // The sweep spans 144 to 216 degrees; the view is at its start, in tile 13 (146.25 to 157.5).
    await bd.ensure({ fromDeg: 144, toDeg: 216 }, { fromDeg: 150, toDeg: 152 });
    const order = [...new Set(r.fetched.map(tileOf))];
    expect(order[0]).toBe(13);
    const dist = (t: number) => Math.abs(t * 11.25 + 5.625 - 151);
    expect(order.map(dist)).toEqual([...order.map(dist)].sort((a, b) => a - b));
    // Without a view it is outward from the middle of the arc, as before.
    const r2 = rig();
    const bd2 = createBackdrop(manifest, sky, 1, { ...r2, lighter: r2.lighter });
    await bd2.ensure({ fromDeg: 144, toDeg: 216 });
    expect([15, 16]).toContain(tileOf(r2.fetched[0])); // the two tiles either side of 180
  });

  it('asks for the files of the tiles of an arc a few at a time, not one after another and not all at once', async () => {
    let active = 0;
    let most = 0;
    const r = rig();
    const fetchBlob = vi.fn(async (url: string) => {
      active += 1;
      most = Math.max(most, active);
      await new Promise((go) => setTimeout(go, 5));
      active -= 1;
      return { url } as unknown as Blob;
    });
    const bd = createBackdrop(manifest, sky, 1, { ...r, fetchBlob, lighter: r.lighter });
    await bd.ensure(arc72(180)); // ten tiles of up to six files each
    expect(most).toBeGreaterThan(1); // the files are not asked for one after another
    expect(most).toBe(FETCH_PARALLEL); // and the pipe is kept full while there is more to ask, and no fuller
    expect(bd.litTiles().length).toBeGreaterThan(20);
  });

  it('keeps the cap while the arc changes under it: aborted passes hand their slots on, and a pass begun at once takes none of them', async () => {
    vi.useFakeTimers();
    let live = 0;
    let most = 0;
    const r = rig();
    const fetchBlob = vi.fn(
      (url: string, signal?: AbortSignal) =>
        new Promise<Blob>((resolve, reject) => {
          live += 1;
          most = Math.max(most, live);
          const timer = setTimeout(() => {
            live -= 1;
            resolve({ url } as unknown as Blob);
          }, 300);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            live -= 1;
            reject(new Error('aborted'));
          });
        })
    );
    const bd = createBackdrop(manifest, sky, 1, { ...r, fetchBlob, lighter: r.lighter });
    for (let i = 0; i < 60; i += 1) {
      void bd.ensure({ fromDeg: 100 + i * 2, toDeg: 180 + i * 2 }); // a turning view: a new arc every half second, each one aborting the last
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(fetchBlob.mock.calls.length).toBeGreaterThan(FETCH_PARALLEL * 3); // the loader worked the whole time
    expect(most).toBeLessThanOrEqual(FETCH_PARALLEL);
  });

  it('gives up on a request that never answers, draws absence and goes on, and aborts it', async () => {
    vi.useFakeTimers();
    const r = rig();
    const signals: AbortSignal[] = [];
    const fetchBlob = vi.fn((url: string, signal?: AbortSignal) => {
      if (tileOf(url) === 17) {
        signals.push(signal as AbortSignal);
        return new Promise<Blob>(() => undefined); // never settles, and ignores its signal
      }
      return Promise.resolve({ url } as unknown as Blob);
    });
    const bd = createBackdrop(manifest, sky, 1, { ...r, fetchBlob, lighter: r.lighter });
    const done = bd.ensure({ fromDeg: 200, toDeg: 201 });
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 10);
    await done;
    expect(signals.length).toBeGreaterThan(0);
    signals.forEach((s) => expect(s.aborted).toBe(true));
    expect(bd.litTiles().some((t) => t.tile === 17)).toBe(false);
    expect(bd.litTiles().some((t) => t.tile === 16 || t.tile === 18)).toBe(true);
  });

  it('does not ask again at once for a tile that failed: the pause doubles to a cap, so a tile that keeps failing is a few requests a minute', async () => {
    const r = rig((u) => tileOf(u) === 19);
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: r.lighter });
    const tile19 = () =>
      r.fetched.filter((u) => tileOf(u) === 19 && u.includes('card-0-') && u.endsWith('colour.webp')).length;
    await bd.ensure({ fromDeg: 215, toDeg: 216 });
    expect(tile19()).toBe(1);
    // The scene asks every half second for a minute: the broken tile is asked for about as often as its pauses allow.
    for (let t = 0; t < 120; t += 1) {
      r.tick(500);
      await bd.ensure({ fromDeg: 215, toDeg: 216 });
    }
    expect(tile19()).toBeGreaterThan(3);
    expect(tile19()).toBeLessThanOrEqual(8); // 1 s, 2 s, 4 s, 8 s, 16 s, 32 s: not 121
    expect(RETRY_MAX_MS).toBeGreaterThanOrEqual(32_000);
    expect(bd.litTiles().some((t) => t.tile === 19)).toBe(false);
  });

  describe('the loader asks again on its own', () => {
    /** Nothing waits on a timer but the retry: files and decodes settle at once. */
    const quick = (fail: (url: string) => boolean) => {
      const r = rig(fail);
      const decode = vi.fn(async (blob: Blob) => ({ url: (blob as unknown as { url: string }).url, close: () => undefined }) as unknown as ImageBitmap);
      return { r, deps: { ...r, decode, lighter: r.lighter } };
    };
    const tile = (r: ReturnType<typeof rig>, t: number) => r.fetched.filter((u) => tileOf(u) === t && u.includes('card-1-') && u.endsWith('colour.webp')).length;

    it('a tile that failed is asked for again at the end of its pause with no one asking, and the listener hears it arrive', async () => {
      vi.useFakeTimers();
      let broken = true;
      const { r, deps } = quick((u) => broken && tileOf(u) === 16 && u.includes('card-1-'));
      const bd = createBackdrop(manifest, sky, 1, deps);
      const heard = vi.fn();
      bd.onTile(heard);
      await bd.ensure({ fromDeg: 180, toDeg: 181 }); // the only ask: a still has no timer to make another
      expect(bd.litTiles().some((t) => t.tile === 16)).toBe(false);
      const arrived = heard.mock.calls.length;
      broken = false;
      r.tick(RETRY_FIRST_MS - 1);
      await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS - 1);
      expect(tile(r, 16)).toBe(1); // not before its pause
      r.tick(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(bd.litTiles().filter((t) => t.tile === 16).map((t) => t.card).sort()).toEqual([0, 1, 2]);
      expect(heard.mock.calls.length).toBe(arrived + 1);
      const n = r.fetched.length;
      r.tick(10 * RETRY_MAX_MS);
      await vi.advanceTimersByTimeAsync(10 * RETRY_MAX_MS);
      expect(r.fetched.length).toBe(n); // nothing is left to ask for
      bd.dispose();
    });

    it('keeps asking, on a pause that doubles, while the arc wants the tile, and stops when the arc has moved on or the backdrop is gone', async () => {
      vi.useFakeTimers();
      const { r, deps } = quick((u) => tileOf(u) === 19);
      const bd = createBackdrop(manifest, sky, 1, deps);
      await bd.ensure({ fromDeg: 215, toDeg: 216 });
      expect(tile(r, 19)).toBe(1);
      for (let s = 0; s < 120; s += 1) {
        r.tick(1000);
        await vi.advanceTimersByTimeAsync(1000);
      }
      expect(tile(r, 19)).toBeGreaterThan(3);
      expect(tile(r, 19)).toBeLessThanOrEqual(8); // 1 s, 2 s, 4 s, 8 s, 16 s, 32 s: a few a minute, not one a second
      await bd.ensure({ fromDeg: 0, toDeg: 1 }); // the view has gone the other way: tile 19 is no longer wanted
      const asked = tile(r, 19);
      for (let s = 0; s < 300; s += 1) {
        r.tick(1000);
        await vi.advanceTimersByTimeAsync(1000);
      }
      expect(tile(r, 19)).toBe(asked);
      await bd.ensure({ fromDeg: 215, toDeg: 216 });
      bd.dispose();
      const n = r.fetched.length;
      r.tick(10 * RETRY_MAX_MS);
      await vi.advanceTimersByTimeAsync(10 * RETRY_MAX_MS);
      expect(r.fetched.length).toBe(n); // a disposed backdrop asks for nothing
    });
  });

  it('does not ask again for a file the server does not have: the tile is drawn with the cards that came', async () => {
    const r = rig(
      () => false,
      (u) => tileOf(u) === 19 && u.includes('card-1-')
    );
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: r.lighter });
    const tile19 = () => r.fetched.filter((u) => tileOf(u) === 19).length;
    await bd.ensure({ fromDeg: 215, toDeg: 216 });
    const first = tile19();
    expect(first).toBeGreaterThan(0);
    expect(bd.litTiles().filter((t) => t.tile === 19).map((t) => t.card)).toEqual([0, 2]); // card 1 is absent, the others are there
    for (let t = 0; t < 40; t += 1) {
      r.tick(5_000);
      await bd.ensure({ fromDeg: 215, toDeg: 216 });
    }
    expect(tile19()).toBe(first); // not once more while the tile stays
    r.bitmaps.forEach((b) => expect(b.closed).toBe(true));
  });

  it('gives up on a tile every file of which is gone, without a retry loop, and draws its neighbours', async () => {
    const r = rig(
      () => false,
      (u) => tileOf(u) === 19
    );
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: r.lighter });
    await bd.ensure({ fromDeg: 215, toDeg: 216 });
    const n = r.fetched.length;
    r.tick(RETRY_MAX_MS * 2);
    await bd.ensure({ fromDeg: 215, toDeg: 216 });
    expect(r.fetched.length).toBe(n);
    expect(bd.litTiles().some((t) => t.tile === 19)).toBe(false);
    expect(bd.litTiles().some((t) => t.tile === 18)).toBe(true);
  });
});

describe('setScale', () => {
  type Fake = { tile: number; card: number; scale: number; width: number; height: number };
  /** A lighter factory that lights canvases as wide as their scale says and remembers every lighter made, in order. */
  const scaled = () => {
    const made: { scale: number; lighter: Lighter; lit: Fake[] }[] = [];
    const lighterAt = (_m: unknown, _s: unknown, scale: number): Lighter => {
      const lit: Fake[] = [];
      const lighter: Lighter = {
        lost: false,
        scale,
        lightMs: [],
        renderer: 'test',
        release: vi.fn(),
        light: vi.fn((_b: CardBitmaps, tile: number, card: number) => {
          const c = { tile, card, scale, width: Math.round(202 * scale), height: Math.round(100 * scale) };
          lit.push(c);
          return c as unknown as HTMLCanvasElement;
        }),
      };
      made.push({ scale, lighter, lit });
      return lighter;
    };
    return { made, lighterAt };
  };
  const keys = (bd: ReturnType<typeof createBackdrop>) =>
    bd
      .litTiles()
      .map((t) => `${t.tile}.${t.card}`)
      .sort();

  it('lights every held tile again at the new scale, nearest the view first, and never leaves a tile without a canvas in between', async () => {
    const r = rig();
    const { made, lighterAt } = scaled();
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: lighterAt });
    const arc = { fromDeg: 150, toDeg: 160 };
    await bd.ensure(arc);
    const before = bd.litTiles();
    const names = keys(bd);
    expect(before.length).toBeGreaterThan(4);
    expect(before.every((t) => (t.canvas as unknown as Fake).scale === 1)).toBe(true);

    // At every tile made while the rescale runs, the same tiles and cards are held, whichever canvases they are.
    const seen: string[][] = [];
    bd.onTile(() => seen.push(keys(bd)));
    bd.setScale(2);
    expect(made.map((m) => m.scale)).toEqual([1, 2]);
    expect(made[0].lighter.release).toHaveBeenCalled();
    expect(keys(bd)).toEqual(names); // nothing is blanked by asking
    expect(bd.litTiles().every((t) => (t.canvas as unknown as Fake).scale === 1)).toBe(true); // the old canvases are held and drawn until replaced
    await bd.ensure(arc, { fromDeg: 150, toDeg: 152 });
    expect(seen.length).toBeGreaterThan(0);
    seen.forEach((k) => expect(k).toEqual(names));
    expect(keys(bd)).toEqual(names);
    expect(bd.litTiles().every((t) => (t.canvas as unknown as Fake).scale === 2)).toBe(true);
    // Nearest the view first: the tiles of the second lighter come in order of their distance from the view's 151 degrees.
    const order = [...new Set(made[1].lit.map((c) => c.tile))];
    const dist = (t: number) => Math.abs(t * 11.25 + 5.625 - 151);
    expect(order.map(dist)).toEqual([...order.map(dist)].sort((a, b) => a - b));
    expect(order[0]).toBe(13);
    expect(bd.stats().scale).toBe(2);
  });

  it('does nothing at the scale it has, and keeps its scale when the new lighter cannot be made', async () => {
    const r = rig();
    const { made, lighterAt } = scaled();
    let fail = false;
    const bd = createBackdrop(manifest, sky, 1.5, {
      ...r,
      lighter: (m, s, sc) => {
        if (fail) throw new Error('ridge: no WebGL2');
        return lighterAt(m, s, sc);
      },
    });
    await bd.ensure({ fromDeg: 150, toDeg: 160 });
    const fetched = r.fetched.length;
    bd.setScale(1.5);
    await bd.ensure({ fromDeg: 150, toDeg: 160 });
    expect(made).toHaveLength(1);
    expect(r.fetched.length).toBe(fetched); // not one file asked for again
    fail = true;
    bd.setScale(2);
    await bd.ensure({ fromDeg: 150, toDeg: 160 });
    expect(bd.stats().scale).toBe(1.5);
    expect(made[0].lighter.release).not.toHaveBeenCalled();
    expect(bd.litTiles().every((t) => (t.canvas as unknown as Fake).scale === 1.5)).toBe(true);
  });

  it('empties a replaced canvas only after the scene has read the held tiles twice, so a mount that has it up is not blanked', async () => {
    const r = rig();
    const { lighterAt } = scaled();
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: lighterAt });
    await bd.ensure({ fromDeg: 150, toDeg: 160 });
    const old = bd.litTiles().map((t) => t.canvas as unknown as Fake);
    bd.setScale(2);
    await bd.ensure({ fromDeg: 150, toDeg: 160 });
    expect(old.every((c) => c.width > 0)).toBe(true); // replaced, still not emptied
    bd.litTiles(); // the scene's mount that leaves them out
    expect(old.every((c) => c.width > 0)).toBe(true);
    bd.litTiles();
    expect(old.every((c) => c.width === 0)).toBe(true);
  });

  it('lights a tile again that was made while the scale changed under it', async () => {
    const r = rig();
    const { made, lighterAt } = scaled();
    const bd = createBackdrop(manifest, sky, 1, { ...r, lighter: lighterAt });
    const done = bd.ensure({ fromDeg: 150, toDeg: 160 });
    bd.setScale(2); // while the first pass is on the wire
    await done;
    await bd.ensure({ fromDeg: 150, toDeg: 160 });
    expect(made.map((m) => m.scale)).toEqual([1, 2]);
    expect(bd.litTiles().every((t) => (t.canvas as unknown as Fake).scale === 2)).toBe(true);
  });
});
