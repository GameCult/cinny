/* eslint-disable no-restricted-syntax -- tests loop over skies, normals and distances */
import { describe, expect, it } from 'vitest';
import { SKY } from './skyData';
import {
  AMBIENT_GAIN,
  NIGHT_LIFT,
  ambientColour,
  hazeColour,
  hexToLinear,
  shade,
  skyNameFor,
  sunColour,
  sunDirection,
  transmittance,
} from './terrainSky';
import { skyColours } from '../ridge/skyColour';

const UP = [0, 1, 0] as const;
const luma = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('baked sky numbers', () => {
  it('keep the two moments apart: night sun below the horizon, noon sun well above', () => {
    expect(SKY.midnight.elevation).toBeLessThan(0);
    expect(SKY.noonday.elevation).toBeGreaterThan(30);
    expect(SKY.midnight.gradient).toHaveLength(7);
    expect(SKY.noonday.gradient).toHaveLength(7);
  });

  it('sunDirection is a unit vector with y = sin(elevation), north at -z, south at +z', () => {
    for (const d of Object.values(SKY)) {
      const s = sunDirection(d);
      expect(Math.hypot(...s)).toBeCloseTo(1, 9);
      expect(s[1]).toBeCloseTo(Math.sin((d.elevation * Math.PI) / 180), 9);
    }
    expect(sunDirection({ ...SKY.noonday, elevation: 0, azimuth: 0 })[2]).toBeCloseTo(-1, 9);
    expect(sunDirection({ ...SKY.noonday, elevation: 0, azimuth: 180 })[2]).toBeCloseTo(1, 9);
  });

  it('hexToLinear decodes sRGB', () => {
    expect(hexToLinear('#000000')).toEqual([0, 0, 0]);
    expect(hexToLinear('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToLinear('#808080')[0]).toBeCloseTo(0.2158, 3);
  });

  it('the default sky from skyColours() is a night one, as the stars see it', () => {
    expect(skyNameFor(skyColours())).toBe('midnight');
    expect(skyNameFor({ ...skyColours(), top: [150, 198, 255] })).toBe('noonday');
  });
});

describe('night fill', () => {
  it('lifts ambient at night by NIGHT_LIFT and leaves a high sun at the plain gain', () => {
    const z = (d: typeof SKY.midnight) => hexToLinear(d.gradient[0]);
    ambientColour(SKY.midnight).forEach((v, i) => expect(v).toBeCloseTo(z(SKY.midnight)[i] * AMBIENT_GAIN * NIGHT_LIFT, 9));
    ambientColour(SKY.noonday).forEach((v, i) => expect(v).toBeCloseTo(z(SKY.noonday)[i] * AMBIENT_GAIN, 9));
  });
});

describe('lighting', () => {
  it('noonday lights an upward face with the sun; midnight has none', () => {
    expect(luma(sunColour(SKY.noonday))).toBeGreaterThan(0.5);
    expect(sunColour(SKY.midnight)).toEqual([0, 0, 0]);
  });

  it('a sun below the horizon gives no negative or sun light on any normal, even with a lit colour', () => {
    const forcedDown = { ...SKY.noonday, elevation: -30 };
    expect(sunColour(forcedDown)).toEqual([0, 0, 0]);
    for (const n of [UP, [1, 0, 0], [0, -1, 0], [0, 0.6, -0.8]] as const) {
      const c = shade(forcedDown, [1, 1, 1], n, 0);
      for (const ch of c) expect(ch).toBeGreaterThanOrEqual(0);
    }
  });

  it('the sun fades out through the horizon instead of switching', () => {
    const at = (elevation: number) => luma(sunColour({ ...SKY.noonday, elevation }));
    expect(at(-2)).toBe(0);
    expect(at(0.3)).toBeGreaterThan(0);
    expect(at(0.3)).toBeLessThan(at(1.5));
    expect(at(1.5)).toBeCloseTo(at(60), 9);
  });

  it('shade never goes negative on any normal at either sky, at any distance', () => {
    for (const d of Object.values(SKY))
      for (const n of [UP, [0, -1, 0], [1, 0, 0], [-0.6, 0.0, 0.8]] as const)
        for (const dist of [0, 100, 5000])
          for (const ch of shade(d, [0.3, 0.3, 0.3], n, dist)) expect(ch).toBeGreaterThanOrEqual(0);
  });

  it('a face turned to the noon sun is brighter than one turned away; at midnight the two match to ambient', () => {
    const toSun = sunDirection(SKY.noonday);
    const away = [-toSun[0], 0, -toSun[2]] as const;
    const lit = luma(shade(SKY.noonday, [0.5, 0.5, 0.5], toSun, 0));
    const dark = luma(shade(SKY.noonday, [0.5, 0.5, 0.5], away, 0));
    expect(lit).toBeGreaterThan(3 * dark);
    const m = (n: readonly [number, number, number]) => shade(SKY.midnight, [0.5, 0.5, 0.5], n, 0);
    expect(luma(m(UP))).toBeGreaterThan(0); // moonlit fill, not black
    expect(luma(m(UP))).toBeLessThan(0.05);
  });

  it('noon is much brighter than midnight, ambient included', () => {
    expect(luma(ambientColour(SKY.noonday))).toBeGreaterThan(2 * luma(ambientColour(SKY.midnight)));
    expect(luma(shade(SKY.noonday, [0.4, 0.4, 0.4], UP, 0))).toBeGreaterThan(
      10 * luma(shade(SKY.midnight, [0.4, 0.4, 0.4], UP, 0))
    );
  });

  it('noon ambient matches sun.js diffuse at that moment to within a few percent (the gain)', () => {
    const a = ambientColour(SKY.noonday);
    const diffuse = [0.07, 0.132, 0.27]; // light() at 2026-09-22T12:00Z, 45N 0E, revision 7b4aa2f
    for (let i = 0; i < 3; i += 1) expect(a[i] / diffuse[i]).toBeGreaterThan(0.85);
    for (let i = 0; i < 3; i += 1) expect(a[i] / diffuse[i]).toBeLessThan(1.2);
  });
});

describe('haze', () => {
  it('transmittance falls monotonically from 1 toward 0', () => {
    let prev = transmittance(0);
    expect(prev).toBe(1);
    for (const d of [10, 100, 400, 1000, 3000, 8000]) {
      const t = transmittance(d);
      expect(t).toBeLessThan(prev);
      expect(t).toBeGreaterThan(0);
      prev = t;
    }
  });

  it('far surfaces take the horizon colour of the baked gradient, at both skies', () => {
    for (const d of Object.values(SKY)) {
      const far = shade(d, [0.9, 0.2, 0.1], UP, 100000);
      const h = hazeColour(d);
      for (let i = 0; i < 3; i += 1) expect(far[i]).toBeCloseTo(h[i], 6);
    }
    expect(hazeColour(SKY.noonday)).toEqual(hexToLinear('#e2f4ff'));
    expect(hazeColour(SKY.midnight)).toEqual(hexToLinear('#484e64'));
  });

  it('haze colour differs between the two skies: pale day horizon, dim night one', () => {
    expect(luma(hazeColour(SKY.noonday))).toBeGreaterThan(5 * luma(hazeColour(SKY.midnight)));
  });

  it('with distance a dark surface rises toward the haze and a bright one falls toward it', () => {
    const d = SKY.noonday;
    const h = luma(hazeColour(d));
    const dark = (x: number) => luma(shade(d, [0.02, 0.02, 0.02], UP, x));
    expect(dark(2000)).toBeGreaterThan(dark(200));
    expect(dark(2000)).toBeLessThan(h);
  });
});
