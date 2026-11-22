import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetManifests, loadManifest, parseManifest } from './manifest';
import { wireIndex, wireManifest } from './manifest.fixture';

describe('parseManifest', () => {
  it('reads a schema 3 manifest into the View the sky and cards share, the offset bound, and the cards by tile', () => {
    const m = parseManifest(wireManifest(), '/public/ridge/v/');
    expect(m.dir).toBe('/public/ridge/v/');
    expect(m.view).toMatchObject({
      lookAzDeg: 214,
      ringW: 6400,
      tileW: 1600,
      tiles: 4,
      apron: 2,
      planeH: 600,
      pxPerDegH: 6400 / 360,
      pxPerDegV: 171.7, // not px_per_deg_h: a real bake's two differ 10x
      horizonRow: 357,
    });
    expect(m.view.place).toEqual({
      id: 'vienna',
      lat: 48.19,
      lon: 16.35,
      altitudeKm: 0.183,
      tz: 'Europe/Vienna',
    });
    expect(m.encoding).toEqual({ logDMin: 4.6, logDMax: 11.5 });
    expect(m.camera).toEqual({ rMaxM: 100 });
    expect(m.cards).toEqual([
      { nearM: null, farM: 4000 },
      { nearM: 4000, farM: 40000 },
      { nearM: 40000, farM: null },
    ]);
    expect(m.tiles).toHaveLength(4);
    expect(m.tiles[1][1]).toEqual({
      top: 100,
      h: 500,
      distanceM: 12000,
      colour: 'card-1-t01-colour.webp',
      geometry: 'card-1-t01-geometry.webp',
    });
    expect(m.tiles[2][2]).toBeNull(); // the third card holds nothing over the south
    expect(m.attribution.creditLine).toBe('credit');
  });

  it.each([1, 2, 3])('parses a bake of %i cards', (k) => {
    const m = parseManifest(wireManifest({}, k), '/');
    expect(m.cards).toHaveLength(k);
    m.tiles.forEach((row) => expect(row).toHaveLength(k));
  });

  it('refuses schema 2 naming the stale deploy, and any other schema', () => {
    const w = wireManifest() as any;
    expect(() => parseManifest({ ...w, schema: 2 }, '/')).toThrow(/stale ridge bake/);
    expect(() => parseManifest({ ...w, schema: 1 }, '/')).toThrow(/schema/);
  });

  it('refuses no cards, seven cards, a ring that is not tiles x tile_w, a tile row of the wrong length, a card in no tile, a band past the plane', () => {
    const w = wireManifest() as any;
    expect(() => parseManifest({ ...w, cards: [] }, '/')).toThrow(/cards/);
    expect(() => parseManifest({ ...w, cards: Array(7).fill({ near_m: null, far_m: null }) }, '/')).toThrow(/cards/);
    expect(() => parseManifest({ ...w, view: { ...w.view, ring_w: 6401 } }, '/')).toThrow(/ring_w/);
    expect(() => parseManifest({ ...w, tiles: w.tiles.slice(1) }, '/')).toThrow(/tiles/);
    expect(() => parseManifest({ ...w, tiles: w.tiles.map((r: unknown[]) => r.slice(1)) }, '/')).toThrow(/entries/);
    expect(() =>
      parseManifest({ ...w, tiles: w.tiles.map((r: unknown[]) => [r[0], r[1], null]) }, '/')
    ).toThrow(/null in every tile/);
    const withTile = (e: unknown) => ({ ...w, tiles: [[e, w.tiles[0][1], w.tiles[0][2]], ...w.tiles.slice(1)] });
    const t = w.tiles[0][0];
    expect(() => parseManifest(withTile({ ...t, top: 300, h: 301 }), '/')).toThrow(/rows/);
    expect(() => parseManifest(withTile({ ...t, top: -1 }), '/')).toThrow(/rows/);
    expect(() => parseManifest(withTile({ ...t, distance_m: 0 }), '/')).toThrow(/distance/);
    expect(() => parseManifest(withTile({ ...t, distance_m: Infinity }), '/')).toThrow(/distance/);
    expect(() => parseManifest({ ...w, camera: undefined }, '/')).toThrow(/camera/);
    expect(() => parseManifest({ ...w, camera: { r_max_m: 0 } }, '/')).toThrow(/r_max_m/);
  });

  it('rejects a missing field, a normal that is not rt8 and a backwards encoding', () => {
    const w = wireManifest() as any;
    expect(() => parseManifest({ ...w, bake_id: undefined }, '/')).toThrow(/bake_id/);
    expect(() => parseManifest({ ...w, view: { ...w.view, horizon_row: 'x' } }, '/')).toThrow(
      /horizon_row/
    );
    expect(() => parseManifest({ ...w, encoding: { ...w.encoding, normal: 'oct' } }, '/')).toThrow(
      /normal/
    );
    expect(() =>
      parseManifest({ ...w, encoding: { ...w.encoding, log_d_max: w.encoding.log_d_min } }, '/')
    ).toThrow(/encoding/);
    expect(() => parseManifest(null, '/')).toThrow();
  });

  it('rejects a manifest without place.tz and one naming a zone Intl does not know', () => {
    const w = wireManifest() as any;
    expect(() => parseManifest({ ...w, place: { ...w.place, tz: undefined } }, '/')).toThrow(/place\.tz/);
    expect(() => parseManifest({ ...w, place: { ...w.place, tz: 'Not/AZone' } }, '/')).toThrow(/place\.tz/);
    expect(parseManifest({ ...w, place: { ...w.place, tz: 'Asia/Kathmandu' } }, '/').view.place.tz).toBe('Asia/Kathmandu');
  });

  it('never echoes a value it refused', () => {
    const w = wireManifest() as any;
    const refusal = (bad: unknown) => {
      try {
        parseManifest(bad, '/');
      } catch (e) {
        return String(e);
      }
      return '';
    };
    for (const bad of [
      { ...w, schema: 'SECRET-VALUE-42' },
      { ...w, camera: { r_max_m: 'SECRET-VALUE-42' } },
      { ...w, tiles: [[{ ...w.tiles[0][0], distance_m: 'SECRET-VALUE-42' }, ...w.tiles[0].slice(1)], ...w.tiles.slice(1)] },
    ]) {
      const msg = refusal(bad);
      expect(msg).not.toBe('');
      expect(msg).not.toContain('SECRET-VALUE-42');
    }
  });
});

const serve = (files: Record<string, unknown>) => {
  const f = vi.fn(async (url: string) =>
    url in files
      ? { ok: true, status: 200, json: async () => files[url] }
      : { ok: false, status: 404, json: async () => ({}) }
  );
  vi.stubGlobal('fetch', f);
  return f;
};
const files = () => ({
  '/b/public/ridge/index.json': wireIndex,
  '/b/public/ridge/vienna-abc123abc123/manifest.json': wireManifest(),
  '/b/public/ridge/graz-def456def456/manifest.json': wireManifest({
    place: { ...(wireManifest() as any).place, id: 'graz', name: 'Graz' },
  }),
});

describe('loadManifest', () => {
  afterEach(() => {
    forgetManifests();
    vi.unstubAllGlobals();
  });

  it('reads the index then the default place, with its directory', async () => {
    const f = serve(files());
    const m = await loadManifest('/b/');
    expect(m.view.place.id).toBe('vienna');
    expect(m.dir).toBe('/b/public/ridge/vienna-abc123abc123/');
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      '/b/public/ridge/index.json',
      '/b/public/ridge/vienna-abc123abc123/manifest.json',
    ]);
  });

  it('revalidates the index, the one mutable pointer, and leaves the content-addressed manifest to the cache', async () => {
    const f = serve(files());
    await loadManifest('/b/');
    expect(f.mock.calls).toEqual([
      ['/b/public/ridge/index.json', { cache: 'no-cache' }],
      ['/b/public/ridge/vienna-abc123abc123/manifest.json', undefined],
    ]);
  });

  it('place picks the index entry; an unknown id falls back to the default', async () => {
    serve(files());
    expect((await loadManifest('/b/', 'graz')).view.place.id).toBe('graz');
    expect((await loadManifest('/b/', 'nowhere')).view.place.id).toBe('vienna');
  });

  it('is memoised per URL and place', async () => {
    const f = serve(files());
    await loadManifest('/b/');
    await loadManifest('/b/');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('rejects on a 404 and does not remember the failure', async () => {
    serve({});
    await expect(loadManifest('/b/')).rejects.toThrow(/404/);
    serve(files());
    await expect(loadManifest('/b/')).resolves.toBeTruthy();
  });
});
