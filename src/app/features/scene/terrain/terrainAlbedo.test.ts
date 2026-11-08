/* eslint-disable no-restricted-syntax -- tests loop over skies, heights and slopes */
import { describe, expect, it } from 'vitest';
import { SKY } from './terrainSky';
import { ALBEDO, albedoAt, albedoPalette, grainAt, wobble } from './terrainAlbedo';
import { GRID_FRAG } from './terrainShaders';

const near = (a: readonly number[], b: readonly number[], eps = 1e-6) =>
  a.every((v, i) => Math.abs(v - b[i]) < eps);
const luma = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
// A point where the wobble is zero, so band edges sit exactly where the palette says.
const FLAT_X = Math.PI / 0.043;
const at = (sky: keyof typeof SKY, h: number, ny: number) =>
  albedoAt(albedoPalette(SKY[sky]), h, ny, FLAT_X, 0);

describe('albedo by slope and height', () => {
  it('the test point really has no wobble', () => {
    expect(Math.abs(wobble(FLAT_X, 0))).toBeLessThan(1e-9);
  });

  it('steep faces are rock at every height, gentle low ones are soil, gentle high ones are snow', () => {
    const p = albedoPalette(SKY.noonday);
    for (const h of [10, 90, 160, 220]) expect(near(at('noonday', h, 0.3), p.rock)).toBe(true);
    expect(near(at('noonday', 10, 1), p.soil)).toBe(true);
    expect(near(at('noonday', 220, 1), p.snow)).toBe(true);
  });

  it('soil grades to scree by height on gentle ground, halfway at the middle of the band', () => {
    const p = albedoPalette(SKY.noonday);
    const half = p.soil.map((v, i) => (v + p.scree[i]) / 2);
    expect(near(at('noonday', (ALBEDO.screeFrom + ALBEDO.screeTo) / 2, 1), half)).toBe(true);
  });

  it('snow is shed as the face steepens: the same height goes snow, then mixed, then rock', () => {
    const l = [1, 0.8, 0.5].map((ny) => luma(at('noonday', 220, ny)));
    expect(l[0]).toBeGreaterThan(l[1]);
    expect(l[1]).toBeGreaterThan(l[2]);
  });

  it('is continuous: a small step in height or slope never jumps a channel by more than a tenth', () => {
    for (const sky of ['midnight', 'noonday'] as const)
      for (let h = 0; h < 250; h += 1)
        for (let ny = 0.3; ny <= 1; ny += 0.05) {
          const a = at(sky, h, ny);
          const b = at(sky, h + 1, ny + 0.01);
          a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(0.1));
        }
  });

  it('never returns a negative or a super-white channel', () => {
    for (const sky of ['midnight', 'noonday'] as const)
      for (let h = -20; h < 300; h += 7)
        for (let ny = 0; ny <= 1; ny += 0.1)
          for (const v of albedoAt(albedoPalette(SKY[sky]), h, ny, h * 3, ny * 91)) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
  });

  it('the wobble moves band edges but stays inside its stated amplitude', () => {
    for (let i = 0; i < 400; i += 1)
      expect(Math.abs(wobble(i * 13.7, i * -9.1))).toBeLessThanOrEqual(1);
  });
});

describe('per-sky palette', () => {
  const mid = albedoPalette(SKY.midnight);
  const noon = albedoPalette(SKY.noonday);

  it('midnight snows lower than noonday', () => {
    expect(mid.snowLine).toBeLessThan(noon.snowLine);
  });

  it('midnight is tinted toward the cool horizon haze, noonday toward the warm sun', () => {
    // blue share of the same material is higher at night
    const blueShare = (c: readonly number[]) => c[2] / (c[0] + c[1] + c[2]);
    expect(blueShare(mid.scree)).toBeGreaterThan(blueShare(noon.scree));
    expect(blueShare(mid.snow)).toBeGreaterThan(blueShare(noon.snow));
  });

  it('a sun at the horizon lands between the two palettes', () => {
    const dusk = albedoPalette({ ...SKY.noonday, elevation: 2 });
    expect(dusk.snowLine).toBeLessThan(noon.snowLine);
    expect(dusk.snowLine).toBeGreaterThan(mid.snowLine);
  });

  it('keeps every material in 0..1', () => {
    for (const p of [mid, noon])
      for (const c of [p.soil, p.scree, p.rock, p.snow])
        c.forEach((v) => {
          expect(v).toBeGreaterThan(0);
          expect(v).toBeLessThanOrEqual(1);
        });
  });
});

describe('shader agrees with the pure function on its numbers', () => {
  it('takes every band number from ALBEDO, and reads no texture for colour', () => {
    expect(GRID_FRAG).toContain(`#define ALB_SNOW_BAND ${ALBEDO.snowBand.toFixed(1)}`);
    expect(GRID_FRAG).toContain(`#define ALB_ROCK_LO ${ALBEDO.rockLo}`);
    expect(GRID_FRAG).toContain(`#define ALB_WOBBLE_S ${ALBEDO.wobbleSlope}`);
    expect(GRID_FRAG).toContain(`#define ALB_GRAIN_COARSE ${ALBEDO.grainCoarse}`);
    expect(GRID_FRAG).toContain(`#define ALB_STRATA ${ALBEDO.strata}`);
    // the only fetch for colour-by-material would be a texture; the height map's texelFetch is the only other read, and the sky lookup is the baked scattering table's
    expect(GRID_FRAG.match(/texelFetch|texture\((?!uSky)/g)).toHaveLength(1);
  });
});

describe('grain', () => {
  const samples = (rock: number, distance: number) =>
    Array.from({ length: 400 }, (_, i) => grainAt(i * 1.7, i * 0.9, 100 + i * 0.3, rock, distance));
  const spread = (v: number[]) => Math.max(...v) - Math.min(...v);

  it('varies the surface near the eye, never goes negative, and averages about 1', () => {
    const v = samples(0, 50);
    expect(spread(v)).toBeGreaterThan(0.4);
    expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
    expect(v.reduce((a, b) => a + b, 0) / v.length).toBeGreaterThan(0.85);
  });

  it('drops its fine octave with distance, so far ground does not shimmer', () => {
    const rangeOf = (d: number) =>
      spread(Array.from({ length: 400 }, (_, i) => grainAt(i * 0.37, i * 0.21, 100, 0, d)));
    expect(rangeOf(900)).toBeLessThan(rangeOf(50));
  });

  it('layers the rock: strata show only where the face is rock', () => {
    const height = (rock: number) =>
      spread(Array.from({ length: 400 }, (_, i) => grainAt(0, 0, 100 + i * 0.05, rock, 2000)));
    expect(height(1)).toBeGreaterThan(0.2);
    expect(height(0)).toBeLessThan(1e-9);
  });
});
