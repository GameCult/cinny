import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetManifests, loadManifest, parseManifest } from './manifest';
import { wireIndex, wireManifest } from './manifest.fixture';

describe('parseManifest', () => {
  it('reads a v2 manifest into the View the sky and cards share, and K cards nearest first', () => {
    const m = parseManifest(wireManifest(), '/public/ridge/v/');
    expect(m.dir).toBe('/public/ridge/v/');
    expect(m.view).toMatchObject({
      lookAzDeg: 214,
      windowDeg: 72,
      planeW: 1280,
      planeH: 600,
      pxPerDegH: 1280 / 72,
      pxPerDegV: 177.8, // not px_per_deg_h: a real bake's two differ 10x
      horizonRow: 314.5,
    });
    expect(m.view.place).toEqual({ id: 'vienna', lat: 48.19, lon: 16.35, altitudeKm: 0.183 });
    expect(m.encoding).toEqual({ logDMin: 4.6, logDMax: 11.5 });
    expect(m.camera).toEqual({ headingMaxDeg: 23 });
    expect(m.cards.map((c) => c.scale)).toEqual([1.2, 1.0167, 1.005]);
    expect(m.cards[1]).toEqual({
      top: 100,
      h: 500,
      scale: 1.0167,
      colour: 'card-1-colour.webp',
      geometry: 'card-1-geometry.webp',
    });
    expect(m.attribution.creditLine).toBe('credit');
  });

  it.each([1, 2, 3, 4, 5, 6])('parses a bake of %i cards', (k) => {
    expect(parseManifest(wireManifest({}, k), '/').cards).toHaveLength(k);
  });

  it('keeps only what the runtime reads: no distances, no camera offset', () => {
    const m = parseManifest(wireManifest(), '/') as unknown as Record<string, any>;
    expect(JSON.stringify(m)).not.toMatch(/median|near_m|far_m|distance|rM|r_m/);
  });

  it('refuses schema 1, no cards, seven cards, a card past the plane, a scale that is not above 0, a missing camera', () => {
    const w = wireManifest() as any;
    expect(() => parseManifest({ ...w, schema: 1 }, '/')).toThrow(/schema/);
    expect(() => parseManifest({ ...w, cards: [] }, '/')).toThrow(/cards/);
    expect(() => parseManifest(wireManifest({}, 7), '/')).toThrow(/cards/);
    const card = w.cards[0];
    const withCard = (c: unknown) => ({ ...w, cards: [c] });
    expect(() => parseManifest(withCard({ ...card, top: 300, h: 301 }), '/')).toThrow(/rows/);
    expect(() => parseManifest(withCard({ ...card, top: -1 }), '/')).toThrow(/rows/);
    expect(() => parseManifest(withCard({ ...card, scale: 0 }), '/')).toThrow(/scale/);
    expect(() => parseManifest(withCard({ ...card, scale: -1 }), '/')).toThrow(/scale/);
    expect(() => parseManifest(withCard({ ...card, scale: Infinity }), '/')).toThrow(/scale/);
    expect(() => parseManifest({ ...w, camera: undefined }, '/')).toThrow(/camera/);
    expect(() => parseManifest({ ...w, camera: { heading_max_deg: 0 } }, '/')).toThrow(/heading/);
  });

  it('rejects a missing field, a plane wider than 4096, a normal that is not rt8 and a backwards encoding', () => {
    const w = wireManifest() as any;
    expect(() => parseManifest({ ...w, bake_id: undefined }, '/')).toThrow(/bake_id/);
    expect(() => parseManifest({ ...w, view: { ...w.view, plane_w: 4097 } }, '/')).toThrow(/4096/);
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
      { ...w, camera: { heading_max_deg: 'SECRET-VALUE-42' } },
      { ...w, cards: [{ ...w.cards[0], scale: 'SECRET-VALUE-42' }] },
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
