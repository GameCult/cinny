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
  terrainDrawn,
  terrainSkyFor,
} from './skyForState';
import { displayedLuminance, SKY_BAND } from './skyBand';
import type { FixedSkyState } from './skyBand';
import { setSkyClock, skyBackdrop } from './skyState';
import { view } from './terrain/terrainWorld';
import { skyThemeId } from './skyTheme';

const hex = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const EPS = 1e-9;
const STATES = ['day', 'dusk', 'night'] as const;
const SKY = { 'midnight-sky': baked.midnight, 'noonday-sky': baked.noonday } as const;

/**
 * The band each state's text ink needs, from the ink itself: dark ink needs a backdrop of at least
 * AA * (L + 0.05) - 0.05, light ink at most (L + 0.05) / AA - 0.05. Day 0.2983, dusk 0.2983, night 0.0931.
 */
const needs = (state: FixedSkyState) => {
  const l = luminance(SKY[skyThemeId(state)].tokens.Background.OnContainer);
  return state === 'night'
    ? { floor: 0, ceiling: (l + 0.05) / AA - 0.05 }
    : { floor: AA * (l + 0.05) - 0.05, ceiling: 1 };
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
    expect(needs('dusk').floor).toBeCloseTo(0.2983, 3);
    expect(needs('night').ceiling).toBeCloseTo(0.0931, 3);
  });
});

describe('ridgeSkyFor', () => {
  it('draws the gradient of the sky auto resolves to, never nothing', () => {
    setSkyClock(() => atStandardTime(12, 0));
    expect(ridgeSkyFor('auto')).toEqual(ridgeSkyFor('day'));
    setSkyClock(() => atStandardTime(0, 0));
    expect(ridgeSkyFor('auto')).toEqual(ridgeSkyFor('night'));
    setSkyClock(() => atStandardTime(18, 10));
    expect(ridgeSkyFor('auto')).toEqual(ridgeSkyFor('dusk'));
  });

  it('draws a lavender, rose and orange twilight for dusk', () => {
    const d = ridgeSkyFor('dusk');
    expect(d).toEqual(skyColours());
    const [t, m, h] = [d.top, d.mid, d.horizon];
    expect(t[2]).toBeGreaterThan(t[1]); // lavender: blue over green
    expect(t[0]).toBeGreaterThan(t[1]);
    expect(m[0]).toBeGreaterThan(m[2]); // rose: red over blue
    expect(m[2]).toBeGreaterThan(m[1]);
    expect(h[0]).toBeGreaterThan(h[1]); // orange: red over green over blue
    expect(h[1]).toBeGreaterThan(h[2]);
  });

  it('draws the baked gradients for day and night', () => {
    const day = ridgeSkyFor('day');
    const night = ridgeSkyFor('night');
    expect(hex(day.top)).toBe(baked.noonday.gradient[0]);
    expect(hex(day.horizon)).toBe(baked.noonday.gradient[6]);
    expect(hex(night.top)).toBe(baked.midnight.gradient[0]);
    expect(hex(night.horizon)).toBe(baked.midnight.gradient[6]);
  });

  it.each(STATES)('%s: every stop and blend lies in the band its text ink needs', (state) => {
    const { floor, ceiling } = needs(state);
    const r = ridgeDrawn(state);
    expect(r.darkest).toBeGreaterThanOrEqual(floor);
    expect(r.lightest).toBeLessThanOrEqual(ceiling);
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
  const computed = (state: FixedSkyState) => {
    const r = [ridgeDrawn(state), terrainDrawn(state)];
    return {
      darkest: Math.min(...r.map((x) => x.darkest)),
      lightest: Math.max(...r.map((x) => x.lightest)),
    };
  };

  it.each(STATES)(
    '%s: the constant bounds the computed range and sits within 1e-5 of it',
    (state) => {
      const c = computed(state);
      const b = skyBackdrop(state);
      expect(b.darkest).toBeLessThanOrEqual(c.darkest + EPS);
      expect(b.lightest).toBeGreaterThanOrEqual(c.lightest - EPS);
      expect(c.darkest - b.darkest).toBeLessThan(1e-5);
      expect(b.lightest - c.lightest).toBeLessThan(1e-5);
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
