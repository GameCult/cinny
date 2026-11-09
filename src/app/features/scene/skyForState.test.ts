import { describe, expect, it } from 'vitest';
import { baked } from '../../../sky/baked';
import { luminance } from '../../../sky/skyTokens.js';
import { skyColours } from './ridge/skyColour';
import { chooseSky, skyColour } from './terrain/terrainSky';
import {
  DUSK_SUN_ELEVATION,
  ridgeDrawn,
  ridgeSkyFor,
  terrainDrawn,
  terrainSkyFor,
} from './skyForState';
import { skyBackdrop } from './skyState';

const hex = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const EPS = 1e-9;

describe('ridgeSkyFor', () => {
  it('leaves auto to the scene, so it draws what it drew before there was a state', () => {
    expect(ridgeSkyFor('auto')).toBeUndefined();
  });

  it('draws the current ridge dusk for dusk', () => {
    expect(ridgeSkyFor('dusk')).toEqual(skyColours());
  });

  it('draws the baked gradients for day and night', () => {
    const day = ridgeSkyFor('day');
    const night = ridgeSkyFor('night');
    expect(hex(day?.top ?? [])).toBe(baked.noonday.gradient[0]);
    expect(hex(day?.horizon ?? [])).toBe(baked.noonday.gradient[6]);
    expect(hex(night?.top ?? [])).toBe(baked.midnight.gradient[0]);
    expect(hex(night?.horizon ?? [])).toBe(baked.midnight.gradient[6]);
  });

  it.each(['day', 'dusk', 'night'] as const)(
    'paints a %s sky whose colours lie inside skyBackdrop',
    (state) => {
      const sky = ridgeSkyFor(state);
      const { darkest, lightest } = skyBackdrop(state);
      [sky?.top, sky?.mid, sky?.horizon].forEach((c) => {
        const l = luminance(hex(c ?? []));
        expect(l).toBeGreaterThanOrEqual(darkest - EPS);
        expect(l).toBeLessThanOrEqual(lightest + EPS);
      });
    }
  );
});

describe('terrainSkyFor', () => {
  it('leaves auto to the clock and the URL', () => {
    expect(terrainSkyFor('auto')).toEqual({});
  });

  it('names the baked sky for day and night, and a low sun for dusk', () => {
    expect(terrainSkyFor('day')).toEqual({ sky: 'noonday' });
    expect(terrainSkyFor('night')).toEqual({ sky: 'midnight' });
    expect(terrainSkyFor('dusk')).toEqual({ sun: { elevation: DUSK_SUN_ELEVATION } });
  });

  it.each([
    ['day', 'noonday'],
    ['night', 'midnight'],
  ] as const)('lights %s from a gradient inside skyBackdrop', (state, name) => {
    const { darkest, lightest } = skyBackdrop(state);
    expect(terrainSkyFor(state).sky).toBe(name);
    baked[name].gradient.forEach((c) => {
      expect(luminance(c)).toBeGreaterThanOrEqual(darkest - EPS);
      expect(luminance(c)).toBeLessThanOrEqual(lightest + EPS);
    });
  });
});

describe('the terrain sky lies inside skyBackdrop', () => {
  // Not the generator's grid: a golden-angle spiral over the upper sphere (no shared rows or columns)
  // plus a 0.05 degree grid across the sun, five times finer than the generator's.
  const luma = (c: readonly number[]) => {
    const [r, g, b] = c.map((v) => Math.min(1, Math.max(0, v)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const sweep = (state: 'day' | 'dusk' | 'night') => {
    const sky = chooseSky(terrainSkyFor(state));
    const rad = Math.PI / 180;
    const dirAt = (el: number, az: number): [number, number, number] => [
      Math.cos(el * rad) * Math.sin(az * rad),
      Math.sin(el * rad),
      -Math.cos(el * rad) * Math.cos(az * rad),
    ];
    const out: number[] = [];
    const N = 20000;
    for (let i = 0; i < N; i += 1) {
      const y = (i + 0.5) / N; // sin(elevation): uniform over the upper hemisphere
      out.push(luma(skyColour(sky, dirAt(Math.asin(y) / rad, (i * 137.50776405) % 360))));
    }
    for (let dEl = -3; dEl <= 3; dEl += 0.05) {
      for (let dAz = -3; dAz <= 3; dAz += 0.05) {
        out.push(luma(skyColour(sky, dirAt(Math.max(0, sky.elevation + dEl), sky.azimuth + dAz))));
      }
    }
    return out;
  };

  it.each(['day', 'dusk', 'night'] as const)('for %s, and no looser than 5e-4 from it', (state) => {
    const { darkest, lightest } = skyBackdrop(state);
    const l = sweep(state);
    expect(Math.min(...l)).toBeGreaterThanOrEqual(darkest - EPS);
    expect(Math.max(...l)).toBeLessThanOrEqual(lightest + EPS);
    const top = Math.max(Math.max(...l), ridgeDrawn(state)?.lightest ?? 0);
    expect(lightest - top).toBeLessThan(5e-4);
    const bottom = Math.min(Math.min(...l), ridgeDrawn(state)?.darkest ?? 1);
    expect(bottom - darkest).toBeLessThan(5e-4);
  });

  it('and the terrain dusk reaches the sun glow the ridge dusk does not', () => {
    expect(skyBackdrop('dusk').lightest).toBeGreaterThan(0.9);
    expect(skyBackdrop('dusk').lightest).toBeGreaterThan(Math.max(...sweep('night')));
  });
});

describe('both scenes of a state lie inside skyBackdrop', () => {
  it.each(['day', 'dusk', 'night'] as const)('%s', (state) => {
    const b = skyBackdrop(state);
    const r = ridgeDrawn(state);
    const t = terrainDrawn(state);
    [r, t].forEach((x) => {
      expect(x?.darkest).toBeGreaterThanOrEqual(b.darkest - EPS);
      expect(x?.lightest).toBeLessThanOrEqual(b.lightest + EPS);
    });
  });
});

describe('skyBackdrop holds the union of what the scenes draw', () => {
  // An independent extremum: not terrainDrawn's grid and compass search but alternating golden-section
  // line searches in elevation and azimuth from 60 starts (a golden-angle spiral and scatter about the sun),
  // the bracket shrinking to 1e-3 degrees. A plateau (the shader clamps) cannot stall it: each line search
  // always moves to the better end of its bracket.
  const extremes = (state: 'day' | 'dusk' | 'night') => {
    const sky = chooseSky(terrainSkyFor(state));
    const rad = Math.PI / 180;
    const f = (el: number, az: number) => {
      const e = Math.min(90, Math.max(0, el)) * rad;
      const a = az * rad;
      const [r, g, b] = skyColour(sky, [
        Math.cos(e) * Math.sin(a),
        Math.sin(e),
        -Math.cos(e) * Math.cos(a),
      ]).map((v) => Math.min(1, Math.max(0, v)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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
    const search = (sign: 1 | -1) => {
      let best = -Infinity;
      for (let i = 0; i < 60; i += 1) {
        let el =
          i % 2
            ? sky.elevation + (((i * 7919) % 1600) - 800) / 100
            : Math.asin((i + 0.5) / 60) / rad;
        let az =
          i % 2 ? sky.azimuth + (((i * 104729) % 1600) - 800) / 100 : (i * 137.50776405) % 360;
        for (let w = 8; w > 1e-3; w /= 2) {
          const [el0, az0] = [el, az];
          el = line((x) => sign * f(Math.max(0, x), az0), el0, w);
          const el1 = el;
          az = line((x) => sign * f(el1, x), az0, w);
          best = Math.max(best, sign * f(el, az));
        }
      }
      return sign * best;
    };
    return { darkest: search(-1), lightest: search(1) };
  };

  const computed = (state: 'day' | 'dusk' | 'night') => {
    const r = [ridgeDrawn(state), terrainDrawn(state)].filter((x) => x !== undefined) as {
      darkest: number;
      lightest: number;
    }[];
    const ind = extremes(state);
    const ridge = ridgeDrawn(state);
    return {
      darkest: Math.min(...r.map((x) => x.darkest), ind.darkest, ridge?.darkest ?? 1),
      lightest: Math.max(...r.map((x) => x.lightest), ind.lightest, ridge?.lightest ?? 0),
    };
  };

  // The constants are the swept extremes rounded outward to six places, so each lies in [extreme, extreme + 1e-6):
  // a constant 1e-6 low is under the extreme, one 2e-5 high is over the bound. SEARCH is the searches' own error.
  const SEARCH = 1e-8;
  it.each(['day', 'dusk', 'night'] as const)(
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

  it('auto is the union of the three fixed states', () => {
    const all = (['day', 'dusk', 'night'] as const).map(skyBackdrop);
    expect(skyBackdrop('auto')).toEqual({
      darkest: Math.min(...all.map((x) => x.darkest)),
      lightest: Math.max(...all.map((x) => x.lightest)),
    });
  });
});
