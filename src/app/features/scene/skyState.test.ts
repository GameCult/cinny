import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baked } from '../../../sky/baked';
import { AA, luminance } from '../../../sky/skyTokens.js';
import {
  SKY_STATES,
  SKY_STATE_KEY,
  skyBackdrop,
  type SkyBackdrop,
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

describe('skyBackdrop', () => {
  it('orders the fixed skies night < dusk < day by their lightest sky', () => {
    expect(skyBackdrop('night').lightest).toBeLessThan(skyBackdrop('dusk').lightest);
    expect(skyBackdrop('dusk').lightest).toBeLessThan(skyBackdrop('day').lightest);
  });

  it('is the luminance of the baked gradients for day and night', () => {
    const lum = (g: readonly string[]) => g.map(luminance);
    expect(skyBackdrop('day').lightest).toBe(Math.max(...lum(baked.noonday.gradient)));
    expect(skyBackdrop('night').darkest).toBe(Math.min(...lum(baked.midnight.gradient)));
  });

  it('bounds every fixed sky when auto', () => {
    const a = skyBackdrop('auto');
    (['day', 'dusk', 'night'] as const).forEach((s) => {
      expect(a.lightest).toBeGreaterThanOrEqual(skyBackdrop(s).lightest);
      expect(a.darkest).toBeLessThanOrEqual(skyBackdrop(s).darkest);
    });
  });

  it('never has darkest above lightest', () => {
    SKY_STATES.forEach((s) =>
      expect(skyBackdrop(s).darkest).toBeLessThanOrEqual(skyBackdrop(s).lightest)
    );
  });
});

// Login text and link, per theme, from the card variables in pages/auth/styles.css.ts and the sky
// themes' baked bubble text and link. The Light/Silver/Dark/Butter row uses the ink those themes
// actually render: under data-scene the auth card text is var(--sky-bubble-text, #b7c7d9), not each
// theme's own OnContainer.
const inks = [
  { theme: 'Light/Silver/Dark/Butter', text: '#b7c7d9', link: '#99c7ff' },
  { theme: 'Midnight Sky', text: baked.midnight.bubbles.OtherText, link: baked.midnight.link },
  { theme: 'Noonday Sky', text: baked.noonday.bubbles.OtherText, link: baked.noonday.link },
];
// WCAG contrast of an ink against the sky: the worse of its two ends, so a mid-luminance ink is
// measured against whichever end it is closer to.
const against = (ink: string, bg: number) => {
  const li = luminance(ink);
  const [hi, lo] = li > bg ? [li, bg] : [bg, li];
  return (hi + 0.05) / (lo + 0.05);
};
const ratio = (ink: string, b: SkyBackdrop) =>
  Math.min(against(ink, b.lightest), against(ink, b.darkest));

describe('login ink against the sky backdrop', () => {
  const rows = SKY_STATES.flatMap((state) =>
    inks.flatMap(({ theme, text, link }) =>
      (
        [
          ['text', text],
          ['link', link],
        ] as const
      ).map(([role, ink]) => ({ state, theme, role, ratio: ratio(ink, skyBackdrop(state)) }))
    )
  );

  it('prints the measured ratios', () => {
    // eslint-disable-next-line no-console
    console.table(rows.map((r) => ({ ...r, ratio: r.ratio.toFixed(2), ok: r.ratio >= AA })));
    expect(rows).toHaveLength(SKY_STATES.length * inks.length * 2);
  });

  // Bare sky does not hold either ink in most states: the card behind the login form stays opaque
  // (pages/auth/styles.css.ts) for that reason. These are the cells that clear AA; every other
  // cell is asserted to fail, so a sky or theme change that fixes one turns it red until listed.
  const clears = new Set([
    'day|Noonday Sky|text',
    'day|Noonday Sky|link',
    'night|Light/Silver/Dark/Butter|text',
    'night|Light/Silver/Dark/Butter|link',
    'night|Midnight Sky|text',
  ]);
  describe.each(rows)('$theme $role in $state', (r) => {
    const holds = clears.has(`${r.state}|${r.theme}|${r.role}`);
    (holds ? it : it.fails)(holds ? 'is at least AA' : 'is below AA (known)', () => {
      expect(r.ratio).toBeGreaterThanOrEqual(AA);
    });
  });
});
