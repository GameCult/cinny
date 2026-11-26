import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atSolarTime } from './ridge/skyTestkit';
import { FALLBACK_VIEW } from './ridge/view';
import { sceneThemeId } from './skyTheme';
import { SKY_CHOICE_KEY } from './skyState';
import type { SkyChoice } from './ridge/skyMoment';

type Mod = typeof import('./skyState');
const VIENNA = FALLBACK_VIEW.place;
const OLD_KEY = 'ratatoskr.skyState';
const noon: SkyChoice = { kind: 'named', id: 'noon' };
const dusk: SkyChoice = { kind: 'named', id: 'dusk' };
const night: SkyChoice = { kind: 'named', id: 'night' };
const auto: SkyChoice = { kind: 'auto' };

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
const fresh = (): Promise<Mod> => {
  vi.resetModules();
  return import('./skyState');
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('persistence', () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
  });

  it('defaults to Auto when nothing is stored', async () => {
    expect((await fresh()).getSkyChoice()).toEqual(auto);
  });

  it.each([auto, noon, night, { kind: 'free', date: '2026-12-21', minutes: 400 }] as SkyChoice[])(
    'restores a stored %j',
    async (c) => {
      storage.data.set(SKY_CHOICE_KEY, JSON.stringify(c));
      expect((await fresh()).getSkyChoice()).toEqual(c);
    }
  );

  it.each([
    '',
    'night',
    'null',
    '{',
    JSON.stringify({ kind: 'named', id: 'midday' }),
    JSON.stringify({ kind: 'named' }),
    JSON.stringify({ kind: 'free', date: '1899-12-31', minutes: 0 }),
    JSON.stringify({ kind: 'free', date: '2101-01-01', minutes: 0 }),
    JSON.stringify({ kind: 'free', date: '2026-02-30', minutes: 0 }),
    JSON.stringify({ kind: 'free', date: '2026-06-21', minutes: 1440 }),
    JSON.stringify({ kind: 'free', date: '2026-06-21', minutes: -1 }),
    JSON.stringify({ kind: 'free', date: '2026-06-21', minutes: 1.5 }),
    JSON.stringify({ kind: 'free', date: 20260621, minutes: 5 }),
  ])('reads %j as Auto', async (v) => {
    storage.data.set(SKY_CHOICE_KEY, v);
    expect((await fresh()).getSkyChoice()).toEqual(auto);
  });

  it.each([
    ['auto', auto],
    ['day', noon],
    ['dusk', dusk],
    ['night', night],
  ] as const)('migrates the old key %s to %j once, and removes it', async (old, want) => {
    storage.data.set(OLD_KEY, old);
    const m = await fresh();
    expect(m.getSkyChoice()).toEqual(want);
    expect(storage.data.has(OLD_KEY)).toBe(false);
    expect(JSON.parse(storage.data.get(SKY_CHOICE_KEY) as string)).toEqual(want);
    m.setSkyChoice(dusk);
    expect(storage.data.has(OLD_KEY)).toBe(false);
    expect((await fresh()).getSkyChoice()).toEqual(dusk);
  });

  it.each(['noon', 'NIGHT', '', '"night"', 'null'])('ignores the old key holding %j, and removes it', async (old) => {
    storage.data.set(OLD_KEY, old);
    expect((await fresh()).getSkyChoice()).toEqual(auto);
    expect(storage.data.has(OLD_KEY)).toBe(false);
  });

  it('the new key wins over a stale old one', async () => {
    storage.data.set(OLD_KEY, 'night');
    storage.data.set(SKY_CHOICE_KEY, JSON.stringify(dusk));
    expect((await fresh()).getSkyChoice()).toEqual(dusk);
    expect(storage.data.has(OLD_KEY)).toBe(false);
  });

  it('keeps the pick for the page load when storage is refused', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    const m = await fresh();
    expect(m.getSkyChoice()).toEqual(auto);
    m.setSkyChoice(night);
    expect(m.getSkyChoice()).toEqual(night);
  });

  it('migrates an old pick even when the new key cannot be written: the pick holds for the page load, the old key stays', async () => {
    storage.data.set(OLD_KEY, 'day');
    vi.stubGlobal('localStorage', {
      ...storage,
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect((await fresh()).getSkyChoice()).toEqual(noon);
    expect(storage.data.has(OLD_KEY)).toBe(true);
  });

  it('writes the new key before it removes the old one', async () => {
    storage.data.set(OLD_KEY, 'dusk');
    const order: string[] = [];
    vi.stubGlobal('localStorage', {
      ...storage,
      setItem: (k: string, v: string) => {
        order.push(`set ${k}`);
        storage.data.set(k, v);
      },
      removeItem: (k: string) => {
        order.push(`remove ${k}`);
        storage.data.delete(k);
      },
    });
    expect((await fresh()).getSkyChoice()).toEqual(dusk);
    expect(order).toEqual([`set ${SKY_CHOICE_KEY}`, `remove ${OLD_KEY}`]);
  });

  it('persists a set choice under one key and reads it back after a reload', async () => {
    (await fresh()).setSkyChoice(dusk);
    expect([...storage.data.entries()]).toEqual([[SKY_CHOICE_KEY, JSON.stringify(dusk)]]);
    expect((await fresh()).getSkyChoice()).toEqual(dusk);
  });

  it('ignores an invalid choice', async () => {
    const m = await fresh();
    m.setSkyChoice(night);
    m.setSkyChoice({ kind: 'named', id: 'midday' } as unknown as SkyChoice);
    expect(m.getSkyChoice()).toEqual(night);
  });

  it('notifies subscribers on change only, and stops after unsubscribe', async () => {
    const m = await fresh();
    m.setSkyPlace(VIENNA);
    const cb = vi.fn();
    const off = m.subscribe(cb);
    m.setSkyChoice(noon);
    m.setSkyChoice(noon);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    m.setSkyChoice(night);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('tells a late subscriber nothing until the next change', async () => {
    const m = await fresh();
    m.setSkyChoice(noon);
    const cb = vi.fn();
    m.subscribe(cb);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('one authority: the choice at the place decides the sky and the ink', () => {
  let m: Mod;
  beforeEach(async () => {
    vi.stubGlobal('localStorage', fakeStorage());
    m = await fresh();
    m.setSkyClock(() => atSolarTime(0, 0));
  });

  it('Noon picked at local midnight is day, and the ink theme is Noonday Sky', () => {
    m.setSkyPlace(VIENNA);
    m.setSkyChoice(noon);
    expect(m.getResolvedSkyState()).toBe('day');
    expect(sceneThemeId(m.getResolvedSkyState(), true)).toBe('noonday-sky');
  });

  it('Night picked at noon is night, and the ink theme is Midnight Sky', () => {
    m.setSkyPlace(VIENNA);
    m.setSkyClock(() => atSolarTime(12, 0));
    m.setSkyChoice(night);
    expect(m.getResolvedSkyState()).toBe('night');
    expect(sceneThemeId(m.getResolvedSkyState(), true)).toBe('midnight-sky');
  });

  it('a free moment is its own sky: December at 06:40 Vienna is dusk or night, July at 13:00 day', () => {
    m.setSkyPlace(VIENNA);
    m.setSkyChoice({ kind: 'free', date: '2026-12-21', minutes: 6 * 60 + 40 });
    expect(m.getResolvedSkyState()).toBe('night');
    m.setSkyChoice({ kind: 'free', date: '2026-07-15', minutes: 13 * 60 });
    expect(m.getResolvedSkyState()).toBe('day');
  });

  it('with no place the resolved sky is undefined and the theme is not decided', () => {
    m.setSkyChoice(noon);
    expect(m.getResolvedSkyState()).toBeUndefined();
    expect(sceneThemeId(m.getResolvedSkyState(), true)).toBeUndefined();
  });

  it('setting the place tells the listeners, once', () => {
    const cb = vi.fn();
    m.subscribe(cb);
    m.setSkyPlace(VIENNA);
    m.setSkyPlace({ ...VIENNA });
    expect(cb.mock.calls).toEqual([['night']]);
    expect(m.getSkyPlace()).toEqual(VIENNA);
  });
});

describe('Auto follows the clock', () => {
  const local = (h: number, m = 0) => atSolarTime(h, m);
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', fakeStorage());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is the real sun over the place: noon is day, midnight night and the twilight after sunset dusk', async () => {
    const m = await fresh();
    m.setSkyPlace(VIENNA);
    const at = (t: Date) => {
      m.setSkyClock(() => t);
      return m.getResolvedSkyState();
    };
    expect(at(local(12))).toBe('day');
    expect(at(local(0))).toBe('night');
    expect(at(local(18, 10))).toBe('dusk');
    expect(at(local(5, 50))).toBe('dusk');
  });

  it('tells listeners the resolved sky when the clock crosses a boundary, and only then', async () => {
    const m = await fresh();
    m.setSkyPlace(VIENNA);
    let now = local(17, 0);
    m.setSkyClock(() => now);
    const cb = vi.fn();
    const off = m.subscribe(cb);
    vi.advanceTimersByTime(5 * 60_000);
    expect(cb).not.toHaveBeenCalled();
    now = local(18, 10);
    vi.advanceTimersByTime(60_000);
    expect(cb.mock.calls).toEqual([['dusk']]);
    vi.advanceTimersByTime(5 * 60_000);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it('still tells everyone when a listener comes or goes inside the window before the clock crosses', async () => {
    const m = await fresh();
    m.setSkyPlace(VIENNA);
    let now = local(17, 0);
    m.setSkyClock(() => now);
    const [a, b, late] = [vi.fn(), vi.fn(), vi.fn()];
    m.subscribe(a);
    const offB = m.subscribe(b);
    vi.advanceTimersByTime(30_000);
    now = local(18, 10); // the clock has crossed; no tick has seen it yet
    const offLate = m.subscribe(late);
    offB();
    vi.advanceTimersByTime(60_000);
    expect(a.mock.calls).toEqual([['dusk']]);
    expect(b).not.toHaveBeenCalled();
    expect(late.mock.calls).toEqual([['dusk']]);
    offLate();
  });

  it('keeps no timer without listeners or when a free moment is chosen; one timer serves Auto and a named moment', async () => {
    const m = await fresh();
    const off = m.subscribe(() => undefined);
    expect(vi.getTimerCount()).toBe(1);
    m.setSkyChoice({ kind: 'free', date: '2026-07-01', minutes: 600 });
    expect(vi.getTimerCount()).toBe(0);
    m.setSkyChoice(night);
    expect(vi.getTimerCount()).toBe(1);
    m.setSkyChoice(auto);
    expect(vi.getTimerCount()).toBe(1);
    off();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a named moment is told again when the place-local day rolls over, once, and not before', async () => {
    const m = await fresh();
    m.setSkyPlace(VIENNA);
    m.setSkyChoice(noon);
    let now = new Date('2026-06-21T21:30:00Z'); // 23:30 in Vienna
    m.setSkyClock(() => now);
    const cb = vi.fn();
    const off = m.subscribe(cb);
    vi.advanceTimersByTime(10 * 60_000);
    expect(cb).not.toHaveBeenCalled();
    now = new Date('2026-06-21T22:05:00Z'); // 00:05 on the 22nd
    vi.advanceTimersByTime(60_000);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60 * 60_000);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it('notifies a change of choice with the resolved sky', async () => {
    const m = await fresh();
    m.setSkyPlace(VIENNA);
    m.setSkyClock(() => local(12));
    const cb = vi.fn();
    m.subscribe(cb);
    m.setSkyChoice(night);
    m.setSkyChoice(auto);
    expect(cb.mock.calls).toEqual([['night'], ['day']]);
  });
});

describe('the constellation lines', () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
  });

  it('are off by default, and picking Night is a plain choice that leaves them off', async () => {
    const m = await fresh();
    expect(m.getConstellationLines()).toBe(false);
    m.setSkyChoice(night);
    expect(m.getSkyChoice()).toEqual(night);
    expect(m.getConstellationLines()).toBe(false);
  });

  it('picking Night while the choice is Night does nothing: no toggle, no notice', async () => {
    const m = await fresh();
    m.setSkyPlace(VIENNA);
    m.setSkyChoice(night);
    const cb = vi.fn();
    m.subscribe(cb);
    m.setSkyChoice(night);
    m.setSkyChoice(night);
    expect(m.getConstellationLines()).toBe(false);
    expect(cb).not.toHaveBeenCalled();
    expect(m.getSkyChoice()).toEqual(night);
  });

  it('setConstellationLines sets them, tells the listeners once per change, and keeps the choice', async () => {
    const m = await fresh();
    m.setSkyPlace(VIENNA);
    m.setSkyChoice(night);
    const cb = vi.fn();
    m.subscribe(cb);
    m.setConstellationLines(true);
    m.setConstellationLines(true);
    expect(m.getConstellationLines()).toBe(true);
    expect(cb.mock.calls).toEqual([['night']]);
    expect(m.getSkyChoice()).toEqual(night);
    m.setConstellationLines(false);
    expect(m.getConstellationLines()).toBe(false);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('persist per viewer, and come back from storage', async () => {
    const m = await fresh();
    m.setConstellationLines(true);
    expect(storage.data.get(m.SKY_LINES_KEY)).toBe('on');
    const again = await fresh();
    expect(again.getConstellationLines()).toBe(true);
    again.setConstellationLines(false);
    expect(storage.data.get(again.SKY_LINES_KEY)).toBe('off');
  });

  it('survive a refused storage: they hold for the page and read as off from a broken store', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    const m = await fresh();
    expect(m.getConstellationLines()).toBe(false);
    m.setConstellationLines(true);
    expect(m.getConstellationLines()).toBe(true);
  });
});
