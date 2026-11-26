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
  const VIENNA = FALLBACK_VIEW.place;
  const FUJI = { ...ELSEWHERE_VIEW.place, id: 'fuji' };
  const wx = (at: Date) => ({
    fetched_at: at.toISOString(),
    observed_at: at.toISOString(),
    station: 11035,
    precip_mm_10min: 2,
    humidity_pct: 99,
    glow_wm2: null,
    sunshine_s_10min: null,
    attribution: 'x',
  });
  const t = new Date('2030-01-01T10:00:00Z');

  it('draws a place with no feed clear and does not fetch: the one file is for one station', async () => {
    const fetched = vi.fn(async () => ({ ok: true, json: async () => wx(t) }));
    vi.stubGlobal('fetch', fetched);
    setFedWeather(0.9);
    await loadWeather('/w.json', FUJI, t);
    expect(fetched).toHaveBeenCalledTimes(0);
    expect(ridgeWeather()).toBe(CLEAR_SKY);
  });

  it('draws Vienna with a fresh file, and reads the file again on coming back from a place without one', async () => {
    const fetched = vi.fn(async () => ({ ok: true, json: async () => wx(t) }));
    vi.stubGlobal('fetch', fetched);
    await loadWeather('/w.json', VIENNA, t);
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(ridgeWeather()).toBeGreaterThan(0.7);
    await loadWeather('/w.json', VIENNA, new Date(t.getTime() + 60_000));
    expect(fetched).toHaveBeenCalledTimes(1); // inside the refresh window
    await loadWeather('/w.json', FUJI, new Date(t.getTime() + 120_000));
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(ridgeWeather()).toBe(CLEAR_SKY);
    await loadWeather('/w.json', VIENNA, new Date(t.getTime() + 180_000));
    expect(fetched).toHaveBeenCalledTimes(2);
    expect(ridgeWeather()).toBeGreaterThan(0.7);
  });

  it("a fetch that resolves after the place has changed writes nothing: the place the viewer is on is drawn clear, not with the old place's rain", async () => {
    let release = () => undefined as void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ ok: true, json: async () => wx(later) });
          })
      )
    );
    const later = new Date(t.getTime() + 24 * 3_600_000);
    setFedWeather(undefined);
    const slow = loadWeather('/w.json', VIENNA, later); // Vienna's file is on the wire
    await loadWeather('/w.json', FUJI, new Date(later.getTime() + 1_000)); // the viewer is on Fuji, which has no feed: clear
    expect(ridgeWeather()).toBe(CLEAR_SKY);
    release();
    await slow;
    expect(ridgeWeather()).toBe(CLEAR_SKY); // Vienna's rain is not Fuji's
  });

  it("rejects a file whose station is not the place's feed's: a clear sky", async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ ...wx(t), station: 99999 }) }));
    await loadWeather('/w.json', VIENNA, t);
    expect(ridgeWeather()).toBe(CLEAR_SKY);
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
