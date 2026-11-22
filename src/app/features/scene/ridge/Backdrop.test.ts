import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { createBackdrop, KEEP_MARGIN_TILES, LOAD_MARGIN_TILES } from './Backdrop';
import type { CardBitmaps, Lighter } from './lightCards';
import { parseManifest } from './manifest';
import { wireManifest } from './manifest.fixture';
import type { PhysicalSky } from './physicalSky';
import { residentTiles, runTiles } from './ring';
import { HFOV_MAX_DEG } from './view';

const sky = {} as PhysicalSky;
const manifest = parseManifest(wireManifest({}, 3, 32), '/d/'); // the ring as the baker cuts it: 32 tiles of 11.25 degrees, 3 cards
const tileOf = (url: string) => Number(/-t(\d\d)-/.exec(url)?.[1]);

/** A decoder that keeps count: which bitmaps are open, which tiles are being decoded at once. */
const rig = (fail: (url: string) => boolean = () => false) => {
  const fetched: string[] = [];
  const bitmaps: { url: string; closed: boolean; close: () => void }[] = [];
  let inFlight = new Map<number, number>();
  let mostTiles = 0;
  const fetchBlob = vi.fn(async (url: string) => {
    fetched.push(url);
    if (fail(url)) throw new Error('ridge: 404');
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
    release: vi.fn(),
    light: vi.fn((_b: CardBitmaps, tile: number, card: number) => {
      const c = { tile, card, width: 202, height: 100 };
      canvases.push(c);
      return c as unknown as HTMLCanvasElement;
    }),
  });
  return { fetched, bitmaps, fetchBlob, decode, canvases, lighter, mostTiles: () => mostTiles };
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
    const bd = createBackdrop(manifest, sky, { ...r, lighter: r.lighter });
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
    const bd = createBackdrop(manifest, sky, { ...r, lighter: () => lighter });
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
    const bd = createBackdrop(manifest, sky, { fetchBlob: r.fetchBlob, lighter: r.lighter });
    await bd.ensure({ fromDeg: 0, toDeg: 1 });
    expect(made.length).toBeGreaterThan(0);
    made.forEach((o) => expect(o).toEqual({ premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
    vi.unstubAllGlobals();
  });

  it('decodes one tile at a time', async () => {
    const r = rig();
    const bd = createBackdrop(manifest, sky, { ...r, lighter: r.lighter });
    await bd.ensure(arc72(100));
    expect(r.decode).toHaveBeenCalled();
    expect(r.mostTiles()).toBe(1);
  });

  it('sweeping the heading through 360 degrees fetches each tile once on the way and never holds more than the baker counted', async () => {
    const r = rig();
    const bd = createBackdrop(manifest, sky, { ...r, lighter: r.lighter });
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
    const bd = createBackdrop(manifest, sky, { ...r, lighter: () => lighter });
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
    const bd = createBackdrop(manifest, sky, { ...r, lighter: () => lighter });
    await expect(bd.ensure({ fromDeg: 180, toDeg: 181 })).resolves.toBeUndefined();
    expect(bd.litTiles().some((t) => t.tile === 16)).toBe(false); // a tile is lit whole or not at all
    expect(bd.litTiles().some((t) => t.tile === 15)).toBe(true);
    r.bitmaps.forEach((b) => expect(b.closed).toBe(true));
    broken = false;
    await bd.ensure({ fromDeg: 180, toDeg: 181 });
    expect(bd.litTiles().filter((t) => t.tile === 16).map((t) => t.card).sort()).toEqual([0, 1, 2]);
  });

  it('a lighting pass that throws is a failed tile too', async () => {
    const r = rig();
    const lighter = r.lighter();
    lighter.light.mockImplementation(() => {
      throw new Error('no 2D context');
    });
    const bd = createBackdrop(manifest, sky, { ...r, lighter: () => lighter });
    await expect(bd.ensure({ fromDeg: 0, toDeg: 1 })).resolves.toBeUndefined();
    expect(bd.litTiles()).toEqual([]);
    r.bitmaps.forEach((b) => expect(b.closed).toBe(true));
  });

  it('is made only where the cards can be lit: a lighter that throws is the caller to answer for', () => {
    const r = rig();
    expect(() =>
      createBackdrop(manifest, sky, {
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
    const bd = createBackdrop(manifest, sky, { ...r, lighter: make });
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
    const bd = createBackdrop(manifest, sky, { ...r, lighter: r.lighter });
    const a = bd.ensure(arc72(40));
    const b = bd.ensure(arc72(220));
    await Promise.all([a, b]);
    const held = new Set(bd.litTiles().map((t) => t.tile));
    residentTiles(manifest.view, 220, 36 + LOAD_MARGIN_TILES * 11.25).forEach((t) => expect(held.has(t.tile)).toBe(true));
  });

  it('disposes: the canvases are dropped, the lighting context released, and a later ensure does nothing', async () => {
    const r = rig();
    const lighter = r.lighter();
    const bd = createBackdrop(manifest, sky, { ...r, lighter: () => lighter });
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
});
