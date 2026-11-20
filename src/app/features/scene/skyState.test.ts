import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atStandardTime } from './standardTime.testkit';
import {
  SKY_STATE_KEY,
  resolveSkyState,
  type SkyState,
} from './skyState';

type Mod = typeof import('./skyState');

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
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

describe('sky state', () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
  });

  it('defaults to auto when nothing is stored', async () => {
    expect((await fresh()).getSkyState()).toBe('auto');
  });

  it.each(['night', 'day', 'dusk', 'auto'] as const)('restores a stored %s', async (s) => {
    storage.data.set(SKY_STATE_KEY, s);
    expect((await fresh()).getSkyState()).toBe(s);
  });

  it.each(['', 'noon', 'NIGHT', '"night"', 'null'])(
    'falls back to auto on stored %j',
    async (v) => {
      storage.data.set(SKY_STATE_KEY, v);
      expect((await fresh()).getSkyState()).toBe('auto');
    }
  );

  it('falls back to auto when storage throws', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    const m = await fresh();
    expect(m.getSkyState()).toBe('auto');
    m.setSkyState('night');
    expect(m.getSkyState()).toBe('night');
  });

  it('persists a set state under one key and reads it back after a reload', async () => {
    (await fresh()).setSkyState('dusk');
    expect([...storage.data.entries()]).toEqual([[SKY_STATE_KEY, 'dusk']]);
    expect((await fresh()).getSkyState()).toBe('dusk');
  });

  it('ignores an invalid state', async () => {
    const m = await fresh();
    m.setSkyState('night');
    m.setSkyState('noon' as SkyState);
    expect(m.getSkyState()).toBe('night');
    expect(storage.data.get(SKY_STATE_KEY)).toBe('night');
  });

  it('notifies subscribers on change only, and stops after unsubscribe', async () => {
    const m = await fresh();
    const cb = vi.fn();
    const off = m.subscribe(cb);
    m.setSkyState('day');
    m.setSkyState('day');
    expect(cb.mock.calls).toEqual([['day']]);
    off();
    m.setSkyState('night');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('tells a late subscriber nothing until the next change', async () => {
    const m = await fresh();
    m.setSkyState('day');
    const cb = vi.fn();
    m.subscribe(cb);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('auto follows the clock', () => {
  const local = (h: number, m = 0) => atStandardTime(h, m); // local solar time ~ local clock
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    vi.useFakeTimers();
    storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves noon to day, midnight to night and the twilight after sunset to dusk', () => {
    expect(resolveSkyState('auto', local(12))).toBe('day');
    expect(resolveSkyState('auto', local(0))).toBe('night');
    expect(resolveSkyState('auto', local(18, 10))).toBe('dusk');
    expect(resolveSkyState('auto', local(5, 50))).toBe('dusk');
    expect(resolveSkyState('day', local(0))).toBe('day');
  });

  it('tells listeners the resolved sky when the clock crosses a boundary, and only then', async () => {
    const m = await fresh();
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

  it('keeps no timer without listeners or when a fixed state is chosen', async () => {
    const m = await fresh();
    const off = m.subscribe(() => undefined);
    expect(vi.getTimerCount()).toBe(1);
    m.setSkyState('night');
    expect(vi.getTimerCount()).toBe(0);
    m.setSkyState('auto');
    expect(vi.getTimerCount()).toBe(1);
    off();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('notifies a change of choice with the resolved sky', async () => {
    const m = await fresh();
    m.setSkyClock(() => local(12));
    const cb = vi.fn();
    m.subscribe(cb);
    m.setSkyState('night');
    m.setSkyState('auto');
    expect(cb.mock.calls).toEqual([['night'], ['day']]);
  });
});

describe('the constellation lines toggle', () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
  });

  it('are off by default, and a first pick of Night is a plain choice that leaves them off', async () => {
    const m = await fresh();
    expect(m.getConstellationLines()).toBe(false);
    m.pickSkyState('night');
    expect(m.getSkyState()).toBe('night');
    expect(m.getConstellationLines()).toBe(false);
  });

  it('re-picking Night while the choice is Night toggles them, tells the listeners, and keeps the choice', async () => {
    const m = await fresh();
    m.pickSkyState('night');
    const cb = vi.fn();
    m.subscribe(cb);
    m.pickSkyState('night');
    expect(m.getConstellationLines()).toBe(true);
    expect(cb.mock.calls).toEqual([['night']]);
    expect(m.getSkyState()).toBe('night');
    m.pickSkyState('night');
    expect(m.getConstellationLines()).toBe(false);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('are not toggled by re-picking any other state, nor by picking Night from Auto that resolves to night', async () => {
    const m = await fresh();
    m.pickSkyState('day');
    m.pickSkyState('day');
    expect(m.getConstellationLines()).toBe(false);
    m.setSkyClock(() => new Date('2026-12-04T00:00:00Z'));
    m.pickSkyState('auto');
    m.pickSkyState('night');
    expect(m.getConstellationLines()).toBe(false);
  });

  it('persist per viewer, and come back from storage', async () => {
    const m = await fresh();
    m.pickSkyState('night');
    m.pickSkyState('night');
    expect(storage.data.get(m.SKY_LINES_KEY)).toBe('on');
    const again = await fresh();
    expect(again.getConstellationLines()).toBe(true);
  });

  it('survive a refused storage: they hold for the page and read as off from a broken store', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    const m = await fresh();
    expect(m.getConstellationLines()).toBe(false);
    m.pickSkyState('night');
    m.pickSkyState('night');
    expect(m.getConstellationLines()).toBe(true);
  });
});
