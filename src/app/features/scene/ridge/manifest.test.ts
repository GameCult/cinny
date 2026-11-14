import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetManifests, loadManifest, parseManifest } from './manifest';
import { wireIndex, wireManifest } from './manifest.fixture';

describe('parseManifest', () => {
  it('reads a v1 manifest into the View the sky and planes share', () => {
    const m = parseManifest(wireManifest(), '/public/ridge/v/');
    expect(m.dir).toBe('/public/ridge/v/');
    expect(m.view).toMatchObject({
      lookAzDeg: 214,
      windowDeg: 72,
      planeW: 1280,
      planeH: 600,
      horizonRow: 314.5,
    });
    expect(m.view.place).toEqual({ id: 'vienna', lat: 48.19, lon: 16.35, altitudeKm: 0.183 });
    expect(m.frames.map((f) => f.key)).toEqual([
      'dawn',
      'morning',
      'noon',
      'golden',
      'dusk',
      'night',
    ]);
    expect(m.frames[2]).toMatchObject({
      sun: { az: 180, el: 60 },
      planes: { far: 'noon-far.webp', near: 'noon-near.webp' },
    });
    expect(m.attribution.creditLine).toBe('credit');
  });

  it('rejects a missing field, a wrong schema, a plane wider than 4096 and fewer than 6 frames', () => {
    const w = wireManifest() as any;
    expect(() => parseManifest({ ...w, bake_id: undefined }, '/')).toThrow(/bake_id/);
    expect(() => parseManifest({ ...w, schema: 2 }, '/')).toThrow(/schema/);
    expect(() => parseManifest({ ...w, view: { ...w.view, plane_w: 4097 } }, '/')).toThrow(/4096/);
    expect(() => parseManifest({ ...w, frames: w.frames.slice(1) }, '/')).toThrow(/frames/);
    expect(() => parseManifest({ ...w, view: { ...w.view, horizon_row: 'x' } }, '/')).toThrow(
      /horizon_row/
    );
    expect(() => parseManifest(null, '/')).toThrow();
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
