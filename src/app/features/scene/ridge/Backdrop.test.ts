import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBackdrop } from './Backdrop';
import type { LitCard } from './lightCards';
import { parseManifest } from './manifest';
import { wireManifest } from './manifest.fixture';
import type { PhysicalSky } from './physicalSky';

const sky = {} as PhysicalSky;
const manifest = parseManifest(wireManifest(), '/d/');

const stubDecoder = () => {
  const made: { url: string; opts: unknown; closed: boolean }[] = [];
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (blob: Blob & { url: string }, opts: unknown) => {
      if (blob.url.endsWith('card-2-geometry.webp') && fail.on) throw new Error('bad card');
      const bmp = { url: blob.url, opts, closed: false, close: () => (bmp.closed = true) };
      made.push(bmp);
      return bmp;
    })
  );
  return made;
};
const fail = { on: false };
const blobFor = async (url: string) => ({ url } as unknown as Blob);
const lit = (m: typeof manifest): LitCard[] =>
  m.cards.map((c) => ({ canvas: {} as HTMLCanvasElement, top: c.top, h: c.h, scale: c.scale }));

afterEach(() => {
  fail.on = false;
  vi.unstubAllGlobals();
});

describe('loadBackdrop', () => {
  it('fetches and decodes both files of every card straight, lights once, and returns the cards nearest first', async () => {
    const made = stubDecoder();
    const light = vi.fn((m: typeof manifest) => lit(m));
    const bd = await loadBackdrop(manifest, sky, { fetchBlob: blobFor, light });
    expect(bd?.cards.map((c) => c.scale)).toEqual([1.2, 1.0167, 1.005]);
    expect(bd?.manifest).toBe(manifest);
    expect(made.map((b) => b.url).sort()).toEqual(
      [0, 1, 2].flatMap((i) => [`/d/card-${i}-colour.webp`, `/d/card-${i}-geometry.webp`]).sort()
    );
    made.forEach((b) =>
      expect(b.opts).toEqual({ premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
    );
    expect(light).toHaveBeenCalledOnce();
    // Handed over in manifest order, each card its own pair.
    const given = light.mock.calls[0] as unknown as [
      unknown,
      { colour: { url: string }; geometry: { url: string } }[],
      unknown
    ];
    expect(given[1].map((p) => [p.colour.url, p.geometry.url])).toEqual(
      [0, 1, 2].map((i) => [`/d/card-${i}-colour.webp`, `/d/card-${i}-geometry.webp`])
    );
    expect(given[2]).toBe(sky);
  });

  it('closes the decoded bitmaps once they are lit', async () => {
    const made = stubDecoder();
    await loadBackdrop(manifest, sky, { fetchBlob: blobFor, light: lit });
    expect(made).toHaveLength(6);
    expect(made.every((b) => b.closed)).toBe(true);
  });

  it('is null when any one card will not decode, lights nothing and closes what it decoded', async () => {
    const made = stubDecoder();
    fail.on = true;
    const light = vi.fn(lit);
    expect(await loadBackdrop(manifest, sky, { fetchBlob: blobFor, light })).toBeNull();
    expect(light).not.toHaveBeenCalled();
    expect(made.length).toBeGreaterThan(0);
    expect(made.every((b) => b.closed)).toBe(true);
  });

  it('is null when a file is missing, and when the lighting pass throws', async () => {
    const made = stubDecoder();
    const gone = async (url: string) => {
      if (url.endsWith('card-1-colour.webp')) throw new Error('ridge: 404');
      return blobFor(url);
    };
    expect(await loadBackdrop(manifest, sky, { fetchBlob: gone, light: lit })).toBeNull();
    const boom = () => {
      throw new Error('no WebGL2');
    };
    expect(await loadBackdrop(manifest, sky, { fetchBlob: blobFor, light: boom })).toBeNull();
    expect(made.every((b) => b.closed)).toBe(true);
  });
});
