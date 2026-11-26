import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetManifests } from './ridge/manifest';
import { wireIndex, wireManifest } from './ridge/manifest.fixture';
import { momentFor } from './ridge/skyMoment';
import type { SkyChoice } from './ridge/skyMoment';
import { sunAt } from './ridge/sunAt';
import { drawnView, ensureSkyPlace, loadPlaceManifest, resolvePlaceId } from './skyPlace';
import { forgetPlaceChoice, setPlaceChoice } from './placeState';
import { getSkyPlace, setSkyPlace, subscribe } from './skyState';

const index = {
  default: 'vienna',
  places: { vienna: 'v', fuji: 'f', matterhorn: 'm', amadablam: 'a', grandcanyon: 'g' },
};

describe('which place is drawn', () => {
  it('is the listed viewer choice before the config place, the config place before the default', () => {
    expect(resolvePlaceId(index, 'matterhorn', 'fuji')).toBe('fuji');
    expect(resolvePlaceId(index, 'matterhorn', undefined)).toBe('matterhorn');
    expect(resolvePlaceId(index, undefined, undefined)).toBe('vienna');
  });
  it('ignores an unlisted viewer choice, and falls to the default for an unlisted config place', () => {
    expect(resolvePlaceId(index, 'matterhorn', 'atlantis')).toBe('matterhorn');
    expect(resolvePlaceId(index, 'atlantis', 'atlantis')).toBe('vienna');
    expect(resolvePlaceId(index, undefined, 'constructor')).toBe('vienna');
  });
});

describe('the place drawn follows the choice through the one resolution', () => {
  const noon: SkyChoice = { kind: 'named', id: 'noon' };
  const at = new Date('2030-06-21T09:00:00Z');
  const names: Record<string, string> = {
    'v/manifest.json': 'vienna',
    'f/manifest.json': 'fuji',
  };
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
    forgetPlaceChoice();
    forgetManifests();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const id = Object.entries(names).find(([k]) => url.endsWith(`/${k}`))?.[1];
        const w = wireManifest() as { place: Record<string, unknown> };
        const body = url.endsWith('index.json')
          ? { ...wireIndex, places: { vienna: 'v', fuji: 'f' } }
          : {
              ...w,
              place: {
                ...w.place,
                id,
                name: id,
                ...(id === 'fuji' ? { lat: 35.2, lon: 138.6, tz: 'Asia/Tokyo' } : {}),
              },
            };
        return { ok: true, status: 200, json: async () => body };
      })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetPlaceChoice();
  });

  it("a pick resolves to that place's own sun (Fuji at Noon is another instant than Vienna at Noon), and only a made scene moves the store's place", async () => {
    setSkyPlace(undefined);
    const heard = vi.fn();
    const off = subscribe(heard);
    const a = await ensureSkyPlace(undefined);
    expect(a.view.place.id).toBe('vienna');
    expect(getSkyPlace()).toBeUndefined(); // asked for, not drawn
    expect(heard).not.toHaveBeenCalled();
    setPlaceChoice('fuji');
    const b = await ensureSkyPlace(undefined);
    expect(b.view.place.id).toBe('fuji');
    expect(getSkyPlace()).toBeUndefined(); // a build that has not been made names nothing
    expect(heard).not.toHaveBeenCalled();
    drawnView(a.manifest);
    drawnView(a.manifest); // the same place again: no further change
    expect(getSkyPlace()?.id).toBe('vienna');
    expect(heard).toHaveBeenCalledTimes(1);
    drawnView(b.manifest);
    expect(getSkyPlace()?.id).toBe('fuji');
    expect(heard).toHaveBeenCalledTimes(2);
    const noonAt = (p: typeof a.view.place) => momentFor(noon, p, at).getTime();
    expect(noonAt(b.view.place)).not.toBe(noonAt(a.view.place));
    expect(sunAt(b.view.place, momentFor(noon, b.view.place, at)).elevation).toBeGreaterThan(60);
    off();
  });

  it('loads the manifest of the resolved place for any reader', async () => {
    setPlaceChoice('fuji');
    expect((await loadPlaceManifest({ place: 'vienna' })).name).toBe('fuji');
    setPlaceChoice('atlantis');
    expect((await loadPlaceManifest({ place: 'fuji' })).name).toBe('fuji');
    expect((await loadPlaceManifest(undefined)).name).toBe('vienna');
  });
});
