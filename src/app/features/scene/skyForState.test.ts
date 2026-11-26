import { afterEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_VIEW } from './ridge/view';
import { ELSEWHERE_VIEW } from './ridge/manifest.fixture';
import { atSolarTime } from './ridge/skyTestkit';
import { CLEAR_SKY, ridgeDrawn, ridgeSkyFor, ridgeSkyKey, loadWeather } from './skyForState';
import { setSkyClock } from './skyState';
import { DAY_FROM } from './ridge/skyMoment';
import type { SkyChoice } from './ridge/skyMoment';
import { BUDGET } from './ridge/toneMap';
import { ridgeWeather, setFedWeather } from './ridge/weather';

const auto: SkyChoice = { kind: 'auto' };
const named = (id: 'dawn' | 'morning' | 'noon' | 'golden' | 'dusk' | 'night'): SkyChoice => ({
  kind: 'named',
  id,
});
const BANDS = [
  ['day', named('noon')],
  ['dusk', named('dusk')],
  ['night', named('night')],
] as const;

afterEach(() => {
  setSkyClock();
  setFedWeather(undefined);
  vi.unstubAllGlobals();
});

describe('ridgeSkyFor', () => {
  it.each(BANDS)('carries the physical sky of the %s moment', (band, choice) => {
    const sky = ridgeSkyFor(choice, FALLBACK_VIEW, 0.3);
    expect(sky.physical?.state).toBe(band);
    expect(sky.physical?.stops).toEqual({ top: sky.top, mid: sky.mid, horizon: sky.horizon });
  });

  it('Auto draws the real sun now, never nothing', () => {
    const key = (s: ReturnType<typeof ridgeSkyFor>) => [s.top, s.mid, s.horizon, s.physical?.sun.time];
    const noon = atSolarTime(12, 0);
    expect(key(ridgeSkyFor(auto, FALLBACK_VIEW, 0.3, noon))[3]).toEqual(noon);
    expect(ridgeSkyFor(auto, FALLBACK_VIEW, 0.3, noon).physical?.state).toBe('day');
    expect(ridgeSkyFor(auto, FALLBACK_VIEW, 0.3, atSolarTime(0, 0)).physical?.state).toBe('night');
    expect(ridgeSkyFor(auto, FALLBACK_VIEW, 0.3, atSolarTime(18, 10)).physical?.state).toBe('dusk');
  });

  it("is lit from the real sun over Vienna: a moment's sun is inside its band, the clear noon sky is blue", () => {
    const day = ridgeSkyFor(named('noon'), FALLBACK_VIEW, 0);
    expect(day.physical?.sun.elevation).toBeGreaterThanOrEqual(DAY_FROM);
    expect(day.top[2]).toBeGreaterThan(day.top[0]);
    expect(Math.abs(ridgeSkyFor(named('dusk'), FALLBACK_VIEW, 0).physical?.sun.elevation ?? 99)).toBeLessThanOrEqual(DAY_FROM);
    expect(ridgeSkyFor(named('night'), FALLBACK_VIEW, 0).physical?.sun.elevation).toBeLessThanOrEqual(-DAY_FROM);
  });

  it('a free moment is lit from the sun of its own date', () => {
    const sky = ridgeSkyFor({ kind: 'free', date: '2026-07-15', minutes: 13 * 60 }, FALLBACK_VIEW);
    expect(sky.physical?.sun.time.toISOString()).toBe('2026-07-15T11:00:00.000Z');
    expect(sky.physical?.state).toBe('day');
  });

  it("is made over the View's place: the sun and the observer are the View's", () => {
    const sky = ridgeSkyFor(named('noon'), ELSEWHERE_VIEW, 0);
    expect(sky.physical?.view).toBe(ELSEWHERE_VIEW);
    expect(sky.physical?.atm.observerKm).toBe(ELSEWHERE_VIEW.place.altitudeKm);
  });

  // Each band's ceiling is its budget's (night's is a tunable, NIGHT_CEILING: the operator tunes it by eye).
  it.each(BANDS)('%s: the display is the curve of its budget: black lift at the floor, and its ceiling', (band, choice) => {
    const r = ridgeDrawn(band);
    expect(r.darkest).toBe(BUDGET[band].floor);
    expect(r.lightest).toBeLessThanOrEqual(BUDGET[band].ceiling);
    const fit = ridgeSkyFor(choice, FALLBACK_VIEW, 0.3).physical?.fit;
    expect(fit?.lo).toBeGreaterThanOrEqual(r.darkest - 1e-9);
    expect(fit?.hi).toBeLessThanOrEqual(r.lightest + 1e-9);
  });
});

describe('ridgeSkyKey', () => {
  const noonNow = atSolarTime(12, 0);

  it("keys a rebuild by the View's place as well: another place is another key", () => {
    const other = { ...FALLBACK_VIEW, place: { ...FALLBACK_VIEW.place, id: 'graz' } };
    expect(ridgeSkyKey(named('noon'), FALLBACK_VIEW, 0.3, noonNow)).not.toBe(ridgeSkyKey(named('noon'), other, 0.3, noonNow));
    expect(ridgeSkyKey(named('noon'), other, 0.3, noonNow)).toContain('graz');
  });

  it('differs between Auto-at-day and Noon: live against frozen', () => {
    expect(ridgeSkyKey(auto, FALLBACK_VIEW, 0.3, noonNow)).not.toBe(ridgeSkyKey(named('noon'), FALLBACK_VIEW, 0.3, noonNow));
  });

  it('is equal for one named moment across two calls on one local date, and changes with the weather and the moment', () => {
    const a = ridgeSkyKey(named('noon'), FALLBACK_VIEW, 0.3, atSolarTime(9, 0));
    expect(ridgeSkyKey(named('noon'), FALLBACK_VIEW, 0.3, atSolarTime(21, 0))).toBe(a);
    expect(ridgeSkyKey(named('noon'), FALLBACK_VIEW, 0.8, noonNow)).not.toBe(a);
    expect(ridgeSkyKey(named('night'), FALLBACK_VIEW, 0.3, noonNow)).not.toBe(a);
    expect(ridgeSkyKey(named('noon'), FALLBACK_VIEW, 0.3, new Date(noonNow.getTime() + 24 * 3_600_000))).not.toBe(a);
  });

  it('changes with the free date or minutes', () => {
    const k = (date: string, minutes: number) => ridgeSkyKey({ kind: 'free', date, minutes }, FALLBACK_VIEW, 0, noonNow);
    expect(k('2026-07-15', 300)).not.toBe(k('2026-07-16', 300));
    expect(k('2026-07-15', 300)).not.toBe(k('2026-07-15', 305));
    expect(k('2026-07-15', 300)).toBe(k('2026-07-15', 300));
  });

  it('is stable under the minute tick inside a band (Auto)', () => {
    const at = (m: number) => ridgeSkyKey(auto, FALLBACK_VIEW, 0.3, new Date(atSolarTime(11, 0).getTime() + m * 60_000));
    expect(at(0)).toBe(at(1));
    expect(at(0)).toBe(at(90));
  });
});

describe('the weather of a moment', () => {
  it('a free moment draws a clear sky whatever the feed holds; Auto and the named moments draw the feed', () => {
    setFedWeather(0.9);
    expect(ridgeWeather()).toBe(0.9);
    const noonNow = atSolarTime(12, 0);
    const free: SkyChoice = { kind: 'free', date: '2026-07-15', minutes: 13 * 60 };
    expect(ridgeSkyFor(free, FALLBACK_VIEW, undefined, noonNow).physical?.weather).toEqual(
      ridgeSkyFor(free, FALLBACK_VIEW, CLEAR_SKY, noonNow).physical?.weather
    );
    expect(ridgeSkyKey(free, FALLBACK_VIEW, undefined, noonNow)).toContain(`:${CLEAR_SKY}:`);
    for (const choice of [auto, named('noon')]) {
      expect(ridgeSkyKey(choice, FALLBACK_VIEW, undefined, noonNow)).toContain(':0.9:');
      expect(ridgeSkyFor(choice, FALLBACK_VIEW, undefined, noonNow).physical?.weather).toEqual(
        ridgeSkyFor(choice, FALLBACK_VIEW, 0.9, noonNow).physical?.weather
      );
    }
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
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    vi.resetModules();
    const st = await import('./skyState');
    const f = await import('./skyForState');
    const now = atSolarTime(12, 0);
    const off = f.ridgeSkyKey(named('night'), FALLBACK_VIEW, 0, now);
    const dayOff = f.ridgeSkyKey(named('noon'), FALLBACK_VIEW, 0, now);
    st.setConstellationLines(true);
    expect(f.ridgeSkyKey(named('night'), FALLBACK_VIEW, 0, now)).toBe(`${off}:lines`);
    expect(f.ridgeSkyKey(named('noon'), FALLBACK_VIEW, 0, now)).toBe(dayOff);
  });
});
