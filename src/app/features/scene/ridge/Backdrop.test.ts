import { describe, expect, it, vi } from 'vitest';
import { loadBackdrop } from './Backdrop';
import { frameChoice } from './frameChoice';
import { parseManifest } from './manifest';
import { wireManifest } from './manifest.fixture';

const manifest = parseManifest(wireManifest(), '/d/');
const img = (src: string) => ({ src } as unknown as HTMLImageElement);

describe('loadBackdrop', () => {
  it('loads the planes of the needed frames only, by manifest directory', async () => {
    const load = vi.fn(async (u: string) => img(u));
    const one = await loadBackdrop(
      manifest,
      frameChoice(manifest.frames, { elevation: 60, azimuth: 180 }),
      load
    );
    expect(load.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/d/noon-far.webp',
      '/d/noon-mid.webp',
      '/d/noon-near.webp',
    ]);
    expect(one?.b).toBeNull();
    load.mockClear();
    const two = await loadBackdrop(
      manifest,
      frameChoice(manifest.frames, { elevation: 10, azimuth: 130 }),
      load
    );
    expect(load).toHaveBeenCalledTimes(6);
    expect(two?.b?.far.src).toBe('/d/morning-far.webp');
    expect(two?.a.near.src).toBe('/d/dawn-near.webp');
  });

  it('is null, and does not throw, when any image rejects', async () => {
    const load = vi.fn(async (u: string) => {
      if (u.includes('mid')) throw new Error('decode');
      return img(u);
    });
    await expect(
      loadBackdrop(manifest, frameChoice(manifest.frames, { elevation: 60, azimuth: 180 }), load)
    ).resolves.toBeNull();
  });
});
