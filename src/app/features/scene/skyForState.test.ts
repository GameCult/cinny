import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atStandardTime } from './standardTime.testkit';
import { baked } from '../../../sky/baked';
import { AA, luminance } from '../../../sky/skyTokens.js';
import { skyColours } from './ridge/skyColour';
import { chooseSky, skyColour } from './terrain/terrainSky';
import {
  DUSK_SUN_ELEVATION,
  TERRAIN_REACH_DEG,
  ridgeDrawn,
  ridgeSkyFor,
  ridgeSkyKey,
  terrainDrawn,
  terrainSkyFor,
} from './skyForState';
import { displayedLuminance, luma, shapeToBand, SKY_BAND } from './skyBand';
import type { FixedSkyState } from './skyBand';
import { DAY_FROM, setSkyClock, skyBackdrop } from './skyState';
import { view } from './terrain/terrainWorld';
import { skyThemeId } from './skyTheme';

const hex = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const EPS = 1e-9;
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

let search = '';
beforeEach(() => {
  search = '';
  vi.stubGlobal('window', {
    get location() {
      return { search };
    },
  });
});
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

  // The drawn floor and the lift are tied to those bounds, not to themselves: nudge either constant and this fails.
  it('give Dusk a floor 0.019 above the link bound (as Day has above the text bound) and a lift Day shares', () => {
    expect(SKY_BAND.dusk.floor).toBeCloseTo(needs('dusk').floor + 0.019, 4);
    expect(SKY_BAND.day.floor).toBeCloseTo(needs('day').floor + 0.019, 3);
    expect(SKY_BAND.dusk.lift).toEqual(SKY_BAND.day.lift);
    expect(luma(SKY_BAND.dusk.lift)).toBeGreaterThan(SKY_BAND.dusk.floor);
  });

  it.each(['day', 'dusk'] as const)(
    '%s: the darkest the shaping can show reads at the bound and under the floor',
    (state) => {
      const shown = displayedLuminance(shapeToBand([0, 0, 0], SKY_BAND[state]), 'low');
      expect(shown).toBeGreaterThanOrEqual(needs(state).floor);
      expect(shown).toBeLessThan(SKY_BAND[state].floor);
    }
  );
});

describe('ridgeSkyFor', () => {
  it('carries the state band, which the layers are shaped into, and the physical sky of that state', () => {
    for (const state of STATES) {
      const sky = ridgeSkyFor(state, 0.3);
      expect(sky.band).toEqual(SKY_BAND[state]);
      expect(sky.physical?.state).toBe(state);
      expect(sky.physical?.stops).toEqual({ top: sky.top, mid: sky.mid, horizon: sky.horizon });
    }
  });

  it('draws the sky auto resolves to, never nothing', () => {
    const key = (s: ReturnType<typeof ridgeSkyFor>) => [s.top, s.mid, s.horizon, s.band, s.physical?.sun];
    setSkyClock(() => atStandardTime(12, 0));
    expect(key(ridgeSkyFor('auto', 0.3))).toEqual(key(ridgeSkyFor('day', 0.3)));
    setSkyClock(() => atStandardTime(0, 0));
    expect(key(ridgeSkyFor('auto', 0.3))).toEqual(key(ridgeSkyFor('night', 0.3)));
    setSkyClock(() => atStandardTime(18, 10));
    expect(key(ridgeSkyFor('auto', 0.3))).toEqual(key(ridgeSkyFor('dusk', 0.3)));
  });

  it("is lit from the real sun over Vienna: a forced state's sun is inside the state, the clear noon sky is blue", () => {
    const day = ridgeSkyFor('day', 0);
    expect(day.physical?.sun.elevation).toBeGreaterThanOrEqual(DAY_FROM);
    expect(day.top[2]).toBeGreaterThan(day.top[0]);
    const dusk = ridgeSkyFor('dusk', 0);
    expect(Math.abs(dusk.physical?.sun.elevation ?? 99)).toBeLessThanOrEqual(DAY_FROM);
    expect(ridgeSkyFor('night', 0).physical?.sun.elevation).toBeLessThanOrEqual(-DAY_FROM);
    expect(day.ground).toEqual(skyColours().ground);
  });

  it('keys a rebuild by state and weather, not by the moving sun', () => {
    setSkyClock(() => atStandardTime(12, 0));
    expect(ridgeSkyKey('auto', 0.3)).toBe(ridgeSkyKey('day', 0.3));
    expect(ridgeSkyKey('day', 0.3)).not.toBe(ridgeSkyKey('day', 0.8));
    expect(ridgeSkyKey('day', 0.3)).not.toBe(ridgeSkyKey('night', 0.3));
  });

  it.each(STATES)('%s: the display is fitted to the budget its text ink needs', (state) => {
    const { floor, ceiling } = needs(state);
    const r = ridgeDrawn(state);
    expect(r.darkest).toBeGreaterThanOrEqual(floor);
    expect(r.lightest).toBeLessThanOrEqual(ceiling);
    const fit = ridgeSkyFor(state, 0.3).physical?.fit;
    expect(fit?.lo).toBeGreaterThanOrEqual(r.darkest - 1e-9);
    expect(fit?.hi).toBeLessThanOrEqual(r.lightest + 1e-9);
  });
});

// Not the generator's grid: a golden-angle spiral over the upper sphere (no shared rows or columns)
// plus a 0.05 degree grid across the sun, five times finer than the generator's.
const dirAt = (el: number, az: number): [number, number, number] => {
  const rad = Math.PI / 180;
  return [
    Math.cos(el * rad) * Math.sin(az * rad),
    Math.sin(el * rad),
    -Math.cos(el * rad) * Math.cos(az * rad),
  ];
};
/** Over the sweep: the darkest the 8-bit screen can show (dither at its worst), the lightest, and the darkest as encoded. */
const sweepOf = (sky: ReturnType<typeof chooseSky>, N = 4000, maxEl = TERRAIN_REACH_DEG) => {
  const rad = Math.PI / 180;
  const out = { low: Infinity, high: -Infinity, exactMin: Infinity };
  const see = (el: number, az: number) => {
    const c = skyColour(sky, dirAt(el, az));
    out.low = Math.min(out.low, displayedLuminance(c, 'low'));
    out.high = Math.max(out.high, displayedLuminance(c, 'high'));
    out.exactMin = Math.min(out.exactMin, displayedLuminance(c));
  };
  for (let i = 0; i < N; i += 1) {
    const y = ((i + 0.5) / N) * Math.sin(maxEl * rad); // sin(elevation): uniform from the horizon to maxEl
    see(Math.asin(y) / rad, (i * 137.50776405) % 360);
  }
  for (let dEl = -3; dEl <= 3; dEl += 0.05) {
    for (let dAz = -3; dAz <= 3; dAz += 0.05) {
      see(Math.min(maxEl, Math.max(0, sky.elevation + dEl)), sky.azimuth + dAz);
    }
  }
  return out;
};

describe('the terrain camera reach', () => {
  it('covers the highest ray the frozen camera sees, at any aspect, with a small margin', () => {
    const tanHalf = Math.tan((55 * Math.PI) / 360);
    const tops = [0.4, 0.5, 1, 16 / 9, 2.4].flatMap((aspect) =>
      [0, 0.125, 0.25, 0.5, 0.75].flatMap((turns) => {
        const v = view(aspect, turns);
        return [-1, 0, 1].map((nx) => {
          const d = [0, 1, 2].map(
            (i) => v.forward[i] + nx * tanHalf * aspect * v.right[i] + tanHalf * v.up[i]
          );
          return (Math.asin(d[1] / Math.hypot(d[0], d[1], d[2])) * 180) / Math.PI;
        });
      })
    );
    const top = Math.max(...tops);
    expect(top).toBeCloseTo(14.5, 1);
    expect(TERRAIN_REACH_DEG).toBeGreaterThanOrEqual(top);
    expect(TERRAIN_REACH_DEG - top).toBeLessThan(2);
  });
});

describe('terrainSkyFor', () => {
  it('draws the sky auto resolves to, with that state band', () => {
    setSkyClock(() => atStandardTime(12, 0));
    expect(terrainSkyFor('auto')).toEqual(terrainSkyFor('day'));
    setSkyClock(() => atStandardTime(0, 0));
    expect(terrainSkyFor('auto')).toEqual(terrainSkyFor('night'));
  });

  it('lets the page URL steer auto, shaped into the band of the state the clock resolves to', () => {
    setSkyClock(() => atStandardTime(0, 0)); // night
    search = '?sun=30&az=120';
    expect(terrainSkyFor('auto')).toEqual({
      sun: { elevation: 30, azimuth: 120 },
      band: SKY_BAND.night,
    });
    search = '?sky=noonday';
    expect(terrainSkyFor('auto')).toEqual({ sky: 'noonday', band: SKY_BAND.night });
    search = '?sky=garbage';
    expect(terrainSkyFor('auto')).toEqual(terrainSkyFor('night'));
    setSkyClock(() => atStandardTime(18, 10)); // dusk, URL azimuth honoured
    search = '?sun=2&az=250';
    expect(terrainSkyFor('auto').sun).toEqual({ elevation: 2, azimuth: 250 });
  });

  it('keeps a URL-chosen sun inside the band of the resolved state', () => {
    setSkyClock(() => atStandardTime(12, 0)); // day: floor
    search = '?sun=-30';
    const day = sweepOf(chooseSky(terrainSkyFor('auto')));
    expect(day.low).toBeGreaterThanOrEqual(needs('day').floor);
    setSkyClock(() => atStandardTime(0, 0)); // night: ceiling
    search = '?sun=60';
    const night = sweepOf(chooseSky(terrainSkyFor('auto')));
    expect(night.high).toBeLessThanOrEqual(needs('night').ceiling);
  });

  it('keeps a URL-steered sky at night no lighter than the Night backdrop the text was checked against', () => {
    setSkyClock(() => atStandardTime(0, 0));
    ['?sun=60', '?sun=10&az=40', '?sun=2&az=250', '?sky=noonday'].forEach((q) => {
      search = q;
      expect(terrainDrawn('auto').lightest).toBeLessThanOrEqual(skyBackdrop('night').lightest);
    });
  });

  it('lets an explicit state beat the URL, as before auto had one', () => {
    search = '?sun=30&az=120&sky=midnight';
    expect(terrainSkyFor('day')).toEqual({ sky: 'noonday', band: SKY_BAND.day });
    expect(terrainSkyFor('dusk').sun).toEqual({ elevation: DUSK_SUN_ELEVATION });
  });

  it('names the baked sky for day and night, and a low sun for dusk, each with its band', () => {
    expect(terrainSkyFor('day')).toEqual({ sky: 'noonday', band: SKY_BAND.day });
    expect(terrainSkyFor('night')).toEqual({ sky: 'midnight', band: SKY_BAND.night });
    expect(terrainSkyFor('dusk')).toEqual({
      sun: { elevation: DUSK_SUN_ELEVATION },
      band: SKY_BAND.dusk,
    });
  });
});

describe('the terrain sky lies in the band its text ink needs', () => {
  const sweep = (state: FixedSkyState) => sweepOf(chooseSky(terrainSkyFor(state)));

  it('dusk needs its lift: the scatter sky alone dips below the text bound within the reach', () => {
    const { sun } = terrainSkyFor('dusk');
    expect(sweepOf(chooseSky({ sun })).exactMin).toBeLessThan(needs('dusk').floor - 0.02);
    expect(sweep('dusk').low).toBeGreaterThanOrEqual(needs('dusk').floor);
  });

  it.each(STATES)('%s', (state) => {
    const { floor, ceiling } = needs(state);
    const l = sweep(state);
    expect(l.low).toBeGreaterThanOrEqual(floor);
    expect(l.high).toBeLessThanOrEqual(ceiling);
  });

  it.each(STATES)('%s holds for a sun at any elevation, as ?sun= can put it', (state) => {
    const { floor, ceiling } = needs(state);
    for (let e = -90; e <= 90; e += 10) {
      const l = sweepOf(chooseSky({ sun: { elevation: e }, band: SKY_BAND[state] }), 4000, 90);
      expect(l.low).toBeGreaterThanOrEqual(floor);
      expect(l.high).toBeLessThanOrEqual(ceiling);
    }
  });

  it('and the terrain dusk still reaches the sun glow the ridge dusk does not', () => {
    expect(skyBackdrop('dusk').lightest).toBeGreaterThan(0.9);
  });
});

describe('skyBackdrop holds the union of what the scenes draw', () => {
  // An independent extremum of the screen reading ('low' for the darkest, 'high' for the lightest: one 8-bit step each way) over the terrain camera's reach: not terrainDrawn's grid and compass search but alternating golden-section
  // line searches in elevation and azimuth from 60 starts (a golden-angle spiral and scatter about the sun), the bracket
  // shrinking to 1e-3 degrees. A plateau (the shader clamps) cannot stall it: each line search always
  // moves to the better end of its bracket.
  const extremes = (state: FixedSkyState) => {
    const sky = chooseSky(terrainSkyFor(state));
    const rad = Math.PI / 180;
    const f = (el: number, az: number, reading: 'low' | 'high') => {
      const e = Math.min(TERRAIN_REACH_DEG, Math.max(0, el)) * rad;
      const a = az * rad;
      return displayedLuminance(
        skyColour(sky, [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)]),
        reading
      );
    };
    const P = 0.6180339887;
    const line = (g: (x: number) => number, mid: number, w: number) => {
      let a = mid - w;
      let b = mid + w;
      for (let k = 0; k < 40; k += 1) {
        const c = b - P * (b - a);
        const d = a + P * (b - a);
        if (g(c) > g(d)) b = d;
        else a = c;
      }
      return (a + b) / 2;
    };
    const hunt = (sign: 1 | -1) => {
      const reading = sign === 1 ? 'high' : 'low';
      let best = -Infinity;
      for (let i = 0; i < 60; i += 1) {
        let el =
          i % 2
            ? sky.elevation + (((i * 7919) % 1600) - 800) / 100
            : Math.asin(((i + 0.5) / 60) * Math.sin(TERRAIN_REACH_DEG * rad)) / rad;
        let az =
          i % 2 ? sky.azimuth + (((i * 104729) % 1600) - 800) / 100 : (i * 137.50776405) % 360;
        for (let w = 8; w > 1e-3; w /= 2) {
          const [el0, az0] = [el, az];
          el = line((x) => sign * f(Math.max(0, x), az0, reading), el0, w);
          const el1 = el;
          az = line((x) => sign * f(el1, x, reading), az0, w);
          best = Math.max(best, sign * f(el, az, reading));
        }
      }
      return sign * best;
    };
    return { darkest: hunt(-1), lightest: hunt(1) };
  };

  // At night a sky the page URL steers (?sun= ?sky=) is shaped to the band's ceiling, so the lightest it can show is one
  // 8-bit step above the ceiling's own grey: the Night constant must cover it too, or text is checked against a sky
  // lighter than the one it sits on.
  const steeredNight = displayedLuminance(
    [SKY_BAND.night.ceiling, SKY_BAND.night.ceiling, SKY_BAND.night.ceiling],
    'high'
  );

  const computed = (state: FixedSkyState) => {
    const r = [ridgeDrawn(state), terrainDrawn(state)];
    const ind = extremes(state);
    return {
      darkest: Math.min(...r.map((x) => x.darkest), ind.darkest),
      lightest: Math.max(
        ...r.map((x) => x.lightest),
        ind.lightest,
        ...(state === 'night' ? [steeredNight] : [])
      ),
    };
  };

  // The constants are the swept extremes rounded outward to six places, so each lies in [extreme, extreme + 1e-6):
  // a constant 1e-6 low is under the extreme, one 2e-5 high is over the bound. SEARCH is the searches' own error.
  const SEARCH = 1e-8;
  it.each(STATES)(
    '%s: the constant is the swept extreme rounded outward, within 1e-6 above it',
    (state) => {
      const c = computed(state);
      const b = skyBackdrop(state);
      expect(b.darkest).toBeLessThanOrEqual(c.darkest);
      expect(b.lightest).toBeGreaterThanOrEqual(c.lightest);
      expect(c.darkest - b.darkest).toBeLessThan(1e-6 + SEARCH);
      expect(b.lightest - c.lightest).toBeLessThan(1e-6 + SEARCH);
    }
  );

  it.each(STATES)('%s: an independent sweep, no looser than 5e-4 from the constant', (state) => {
    // The sweep is not the generator's grid (see above), so it cannot share its blind spots.
    const l = sweepOf(chooseSky(terrainSkyFor(state)), 20000);
    const b = skyBackdrop(state);
    const r = ridgeDrawn(state);
    expect(l.low).toBeGreaterThanOrEqual(b.darkest - EPS);
    expect(l.high).toBeLessThanOrEqual(b.lightest + EPS);
    expect(b.lightest - Math.max(l.high, r.lightest)).toBeLessThan(5e-4);
    expect(Math.min(l.low, r.darkest) - b.darkest).toBeLessThan(5e-4);
  });
});
