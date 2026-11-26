import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'ratatoskr.skyPlace';
const store = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  const set = vi.fn((k: string, v: string) => void data.set(k, v));
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: set });
  return { data, set };
};
const fresh = async () => {
  vi.resetModules();
  return import('./placeState');
};

beforeEach(() => {
  store();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the viewer place choice', () => {
  it('is none until picked, then persists per viewer under ratatoskr.skyPlace', async () => {
    const { data } = store();
    const a = await fresh();
    expect(a.getPlaceChoice()).toBeUndefined();
    a.setPlaceChoice('fuji');
    expect(a.getPlaceChoice()).toBe('fuji');
    expect(data.get(KEY)).toBe('fuji');
    store({ [KEY]: 'fuji' });
    expect((await fresh()).getPlaceChoice()).toBe('fuji');
  });

  it('reads garbage as no choice', async () => {
    for (const bad of ['', ' ', '{"id":"fuji"}', 'Fuji!', '../x', 'a'.repeat(65)]) {
      store({ [KEY]: bad });
      expect((await fresh()).getPlaceChoice()).toBeUndefined();
    }
  });

  it('holds for the page load when storage refuses, reading and writing', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    const s = await fresh();
    expect(s.getPlaceChoice()).toBeUndefined();
    s.setPlaceChoice('matterhorn');
    expect(s.getPlaceChoice()).toBe('matterhorn');
  });

  it('tells listeners of every valid pick, a repeat of the id included (a tap on a place that has not come up asks again), and not of a malformed one', async () => {
    const s = await fresh();
    const heard = vi.fn();
    const off = s.subscribePlaceChoice(heard);
    s.setPlaceChoice('fuji');
    s.setPlaceChoice('fuji');
    s.setPlaceChoice('NOT AN ID');
    expect(heard).toHaveBeenCalledTimes(2);
    s.setPlaceChoice('amadablam');
    expect(heard).toHaveBeenCalledTimes(3);
    off();
    s.setPlaceChoice('fuji');
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it('does not write storage for a choice it already holds', async () => {
    const { set } = store({ [KEY]: 'fuji' });
    const s = await fresh();
    s.setPlaceChoice('fuji');
    expect(set).not.toHaveBeenCalled();
  });
});
