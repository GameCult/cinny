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
  const computed = (state: 'day' | 'dusk' | 'night') => {
    const r = [ridgeDrawn(state), terrainDrawn(state)].filter((x) => x !== undefined) as {
      darkest: number;
      lightest: number;
    }[];
    return {
      darkest: Math.min(...r.map((x) => x.darkest)),
      lightest: Math.max(...r.map((x) => x.lightest)),
    };
  };

  it.each(['day', 'dusk', 'night'] as const)(
    '%s: the constant bounds the computed range and sits within 1e-5 of it',
    (state) => {
      const c = computed(state);
      const b = skyBackdrop(state);
      expect(b.darkest).toBeLessThanOrEqual(c.darkest);
      expect(b.lightest).toBeGreaterThanOrEqual(c.lightest);
      expect(c.darkest - b.darkest).toBeLessThan(1e-5);
      expect(b.lightest - c.lightest).toBeLessThan(1e-5);
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
