import { describe, expect, it } from 'vitest';
import { baked } from '../../../sky/baked';
import { luminance } from '../../../sky/skyTokens.js';
import { skyColours } from './ridge/skyColour';
import { DUSK_SUN_ELEVATION, ridgeSkyFor, terrainSkyFor } from './skyForState';
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
