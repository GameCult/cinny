import { afterEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_VIEW } from './ridge/view';
import { ELSEWHERE_VIEW } from './ridge/manifest.fixture';
import { atStandardTime } from './standardTime.testkit';
import { baked } from '../../../sky/baked';
import { AA, luminance } from '../../../sky/skyTokens.js';
import { ridgeDrawn, ridgeSkyFor, ridgeSkyKey, loadWeather } from './skyForState';
import { DAY_FROM, setSkyClock, skyBackdrop } from './skyState';
import type { FixedSkyState } from './skyState';
import { skyThemeId } from './skyTheme';
import { BUDGET } from './ridge/toneMap';

const STATES = ['day', 'dusk', 'night'] as const;
const SKY = { 'midnight-sky': baked.midnight, 'noonday-sky': baked.noonday } as const;

/**
 * The band each state needs, from the ink itself: dark ink needs a backdrop of at least
 * AA * (L + 0.05) - 0.05, light ink at most (L + 0.05) / AA - 0.05. Day 0.2983, night 0.0931; dusk is bound by its
 * link (0.4554), the darker ink to clear, whose floor also holds the text.
 */
const needs = (state: FixedSkyState) => {
  const sky = SKY[skyThemeId(state)];
  const l = luminance(sky.tokens.Background.OnContainer);
  const link = luminance(sky.link);
  return state === 'night'
    ? { floor: 0, ceiling: (l + 0.05) / AA - 0.05 }
    : { floor: AA * ((state === 'dusk' ? link : l) + 0.05) - 0.05, ceiling: 1 };
};

afterEach(() => {
  setSkyClock();
  vi.unstubAllGlobals();
});

describe('the bands the text ink needs', () => {
  it('are the numbers the shaping was set from', () => {
    expect(needs('day').floor).toBeCloseTo(0.2983, 3);
    expect(needs('dusk').floor).toBeCloseTo(0.4554, 3);
    expect(needs('night').ceiling).toBeCloseTo(0.0931, 3);
  });
});

describe('ridgeSkyFor', () => {
  it('carries the physical sky of the state', () => {
    for (const state of STATES) {
      const sky = ridgeSkyFor(state, FALLBACK_VIEW, 0.3);
      expect(sky.physical?.state).toBe(state);
      expect(sky.physical?.stops).toEqual({ top: sky.top, mid: sky.mid, horizon: sky.horizon });
    }
  });

  it('draws the sky auto resolves to, never nothing', () => {
    const key = (s: ReturnType<typeof ridgeSkyFor>) => [
      s.top,
      s.mid,
      s.horizon,
      s.physical?.sun,
    ];
    setSkyClock(() => atStandardTime(12, 0));
    expect(key(ridgeSkyFor('auto', FALLBACK_VIEW, 0.3))).toEqual(key(ridgeSkyFor('day', FALLBACK_VIEW, 0.3)));
    setSkyClock(() => atStandardTime(0, 0));
    expect(key(ridgeSkyFor('auto', FALLBACK_VIEW, 0.3))).toEqual(key(ridgeSkyFor('night', FALLBACK_VIEW, 0.3)));
    setSkyClock(() => atStandardTime(18, 10));
    expect(key(ridgeSkyFor('auto', FALLBACK_VIEW, 0.3))).toEqual(key(ridgeSkyFor('dusk', FALLBACK_VIEW, 0.3)));
  });

  it("is lit from the real sun over Vienna: a forced state's sun is inside the state, the clear noon sky is blue", () => {
    const day = ridgeSkyFor('day', FALLBACK_VIEW, 0);
    expect(day.physical?.sun.elevation).toBeGreaterThanOrEqual(DAY_FROM);
    expect(day.top[2]).toBeGreaterThan(day.top[0]);
    const dusk = ridgeSkyFor('dusk', FALLBACK_VIEW, 0);
    expect(Math.abs(dusk.physical?.sun.elevation ?? 99)).toBeLessThanOrEqual(DAY_FROM);
    expect(ridgeSkyFor('night', FALLBACK_VIEW, 0).physical?.sun.elevation).toBeLessThanOrEqual(-DAY_FROM);
  });

  it("is made over the View's place: the sun and the observer are the View's", () => {
    const sky = ridgeSkyFor('day', ELSEWHERE_VIEW, 0);
    expect(sky.physical?.view).toBe(ELSEWHERE_VIEW);
    expect(sky.physical?.atm.observerKm).toBe(ELSEWHERE_VIEW.place.altitudeKm);
  });

  it("keys a rebuild by the View's place as well: another place is another key", () => {
    const other = { ...FALLBACK_VIEW, place: { ...FALLBACK_VIEW.place, id: 'graz' } };
    expect(ridgeSkyKey('day', FALLBACK_VIEW, 0.3)).not.toBe(ridgeSkyKey('day', other, 0.3));
    expect(ridgeSkyKey('day', other, 0.3)).toContain('graz');
  });

  it('keys a rebuild by state and weather, not by the moving sun', () => {
    setSkyClock(() => atStandardTime(12, 0));
    expect(ridgeSkyKey('auto', FALLBACK_VIEW, 0.3)).toBe(ridgeSkyKey('day', FALLBACK_VIEW, 0.3));
    expect(ridgeSkyKey('day', FALLBACK_VIEW, 0.3)).not.toBe(ridgeSkyKey('day', FALLBACK_VIEW, 0.8));
    expect(ridgeSkyKey('day', FALLBACK_VIEW, 0.3)).not.toBe(ridgeSkyKey('night', FALLBACK_VIEW, 0.3));
  });

  // Night has no ink ceiling: its display top is a tunable (NIGHT_CEILING, ruling ridge-night-real-sky: the operator tunes it by eye),
  // because the moon and the stars are drawn through the same display.
  it.each(STATES)('%s: the display is the curve of its budget: black lift at the floor, and its ceiling', (state) => {
    const r = ridgeDrawn(state);
    expect(r.darkest).toBe(BUDGET[state].floor);
    if (state !== 'night') expect(r.lightest).toBeLessThanOrEqual(needs(state).ceiling);
    const fit = ridgeSkyFor(state, FALLBACK_VIEW, 0.3).physical?.fit;
    expect(fit?.lo).toBeGreaterThanOrEqual(r.darkest - 1e-9);
    expect(fit?.hi).toBeLessThanOrEqual(r.lightest + 1e-9);
  });
});

describe('skyBackdrop holds the ridge sky', () => {
  it.each(['day', 'dusk'] as const)('%s: the backdrop bound contains the ridge display ceiling', (state) => {
    expect(skyBackdrop(state).lightest).toBeGreaterThanOrEqual(ridgeDrawn(state).lightest);
  });
});

describe('loadWeather', () => {
  it('reads the file again for another place inside the refresh window: the weather it set belongs to the sun of the place it was read for', async () => {
    const fetched = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetched);
    const t = new Date('2030-01-01T00:00:00Z');
    await loadWeather('/w.json', FALLBACK_VIEW.place, t);
    await loadWeather('/w.json', FALLBACK_VIEW.place, new Date(t.getTime() + 60_000));
    expect(fetched).toHaveBeenCalledTimes(1);
    await loadWeather('/w.json', ELSEWHERE_VIEW.place, new Date(t.getTime() + 120_000));
    expect(fetched).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});

describe('the rebuild key and the constellation lines', () => {
  it('carries the lines at night only: toggling them is a different sky, a day sky is the same', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
    vi.resetModules();
    const st = await import('./skyState');
    const f = await import('./skyForState');
    const off = f.ridgeSkyKey('night', FALLBACK_VIEW, 0);
    const dayOff = f.ridgeSkyKey('day', FALLBACK_VIEW, 0);
    st.pickSkyState('night');
    st.pickSkyState('night');
    expect(f.ridgeSkyKey('night', FALLBACK_VIEW, 0)).toBe(`${off}:lines`);
    expect(f.ridgeSkyKey('day', FALLBACK_VIEW, 0)).toBe(dayOff);
  });
});
