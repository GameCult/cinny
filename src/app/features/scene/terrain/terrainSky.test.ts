/* eslint-disable no-restricted-syntax -- tests loop over skies, normals and distances */
import { describe, expect, it } from 'vitest';
import { baked } from '../../../../sky/baked';
import {
  coldness,
  glowColour,
  hazeColour,
  hexToLinear,
  nightness,
  shade,
  SKY,
  skyAtSun,
  skyColour,
  skyNameFor,
  sunDirection,
  transmittance,
  groundLight,
  HAZE_K,
  HAZE_POWER,
  START_TURNS,
  Vec3,
} from './terrainSky';
import { skyColours } from '../ridge/skyColour';

const UP = [0, 1, 0] as const;
const luma = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** Unit view direction at an elevation (degrees) and an azimuth clockwise from north. */
const look = (el: number, az: number): Vec3 => {
  const e = (el * Math.PI) / 180;
  const a = (az * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
};

describe('the baked sky is read, not copied', () => {
  it('SKY carries Void’s numbers: sun, ambient, horizon', () => {
    for (const name of ['midnight', 'noonday'] as const) {
      const b = baked[name];
      expect(SKY[name].elevation).toBe(b.sun.elevation_deg);
      expect(SKY[name].azimuth).toBe(b.sun.azimuth_deg);
      expect(SKY[name].direct).toEqual(b.sun.color_linear);
      expect(SKY[name].ambient).toEqual(b.ambient_linear);
      expect(SKY[name].horizon).toEqual(hexToLinear(b.horizon_hex));
    }
  });

  it('keeps the two moments apart: night sun below the horizon, noon sun well above', () => {
    expect(SKY.midnight.elevation).toBeLessThan(0);
    expect(SKY.noonday.elevation).toBeGreaterThan(30);
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

describe('a sun at any elevation (skyAtSun)', () => {
  it('lights nothing under the horizon and fades in across the last degrees, as sun.js does', () => {
    expect(skyAtSun(-2).direct).toEqual([0, 0, 0]);
    expect(skyAtSun(-30).direct).toEqual([0, 0, 0]);
    const at = (e: number) => luma(skyAtSun(e).direct);
    expect(at(0.3)).toBeGreaterThan(0);
    expect(at(0.3)).toBeLessThan(at(1.5));
    expect(at(1.5)).toBeLessThan(at(60));
  });

  it('agrees with the baked noon sun colour where they overlap, to a couple of percent', () => {
    const want = SKY.noonday.direct;
    const got = skyAtSun(SKY.noonday.elevation).direct;
    got.forEach((v, i) => expect(Math.abs(v / want[i] - 1)).toBeLessThan(0.02));
  });

  it('the sun goes red as it sets: less blue left in the direct light at 2 degrees than at 45', () => {
    const lo = skyAtSun(2).direct;
    const hi = skyAtSun(45).direct;
    expect(lo[2] / lo[0]).toBeLessThan(0.6 * (hi[2] / hi[0]));
  });

  it('ambient and horizon run from the midnight bake to the noonday one as the sun climbs', () => {
    expect(luma(skyAtSun(-30).ambient)).toBeCloseTo(luma(SKY.midnight.ambient), 9);
    expect(luma(skyAtSun(60).ambient)).toBeCloseTo(luma(SKY.noonday.ambient), 9);
    expect(luma(skyAtSun(5).ambient)).toBeGreaterThan(luma(SKY.midnight.ambient));
    expect(luma(skyAtSun(5).ambient)).toBeLessThan(luma(SKY.noonday.ambient));
    expect(skyAtSun(10, 270).azimuth).toBe(270);
  });
});

describe('lighting', () => {
  it('noonday lights an upward face with the sun; midnight has none', () => {
    expect(luma(SKY.noonday.direct)).toBeGreaterThan(0.5);
    expect(SKY.midnight.direct).toEqual([0, 0, 0]);
  });

  it('shade never goes negative on any normal at either sky, at any distance', () => {
    for (const d of [...Object.values(SKY), skyAtSun(-3), skyAtSun(1)])
      for (const n of [UP, [0, -1, 0], [1, 0, 0], [-0.6, 0.0, 0.8]] as const)
        for (const dist of [0, 100, 5000])
          for (const ch of shade(d, [0.3, 0.3, 0.3], n, dist, look(-5, 40)))
            expect(ch).toBeGreaterThanOrEqual(0);
  });

  it('a face turned to the noon sun is brighter than one turned away; at midnight the two match to ambient', () => {
    const toSun = sunDirection(SKY.noonday);
    const away = [-toSun[0], 0, -toSun[2]] as const;
    const view = look(-5, 0);
    const lit = luma(shade(SKY.noonday, [0.5, 0.5, 0.5], toSun, 0, view));
    const dark = luma(shade(SKY.noonday, [0.5, 0.5, 0.5], away, 0, view));
    expect(lit).toBeGreaterThan(3 * dark);
    const m = (n: readonly [number, number, number]) =>
      shade(SKY.midnight, [0.5, 0.5, 0.5], n, 0, view);
    expect(luma(m(UP))).toBeGreaterThan(0); // moonlit fill, not black
    expect(luma(m(UP))).toBeLessThan(0.12);
  });

  it('noon is much brighter than midnight, ambient included', () => {
    expect(luma(SKY.noonday.ambient)).toBeGreaterThan(2 * luma(SKY.midnight.ambient));
    const view = look(-5, 0);
    expect(luma(shade(SKY.noonday, [0.4, 0.4, 0.4], UP, 0, view))).toBeGreaterThan(
      3 * luma(shade(SKY.midnight, [0.4, 0.4, 0.4], UP, 0, view))
    );
  });

  it('the cold tint (albedo) is 0 with the sun up and 1 once it is below -6', () => {
    expect(coldness(SKY.noonday)).toBe(0);
    expect(coldness(SKY.midnight)).toBe(1);
    expect(hazeColour(SKY.noonday)).toEqual(SKY.noonday.horizon);
  });
});

describe('the scattered sky', () => {
  it('noon is blue overhead: more blue than red, much brighter than the night glow', () => {
    const zenith = skyColour(SKY.noonday, [0, 1, 0]);
    expect(zenith[2]).toBeGreaterThan(1.5 * zenith[0]);
    expect(luma(zenith)).toBeGreaterThan(5 * luma(skyColour(SKY.midnight, [0, 1, 0])));
    zenith.forEach((v) => expect(v).toBeLessThan(1));
  });

  it('a sun at the horizon reddens the sky toward it and darkens it away', () => {
    const dusk = skyAtSun(-1, 270);
    const toward = skyColour(dusk, look(3, 270));
    const away = skyColour(dusk, look(3, 90));
    const blueShare = (c: Vec3) => c[2] / (c[0] + c[1] + c[2]);
    expect(blueShare(toward)).toBeLessThan(blueShare(away));
    expect(luma(toward)).toBeGreaterThan(3 * luma(away));
  });

  it('under a deep night sun the tables are black and only the glow remains, brightest at the horizon', () => {
    const d = SKY.midnight;
    const horizon = skyColour(d, look(0, 180));
    const zenith = skyColour(d, [0, 1, 0]);
    horizon.forEach((v, i) => expect(v).toBeCloseTo(d.horizon[i], 6));
    expect(luma(zenith)).toBeLessThan(luma(horizon));
    expect(luma(zenith)).toBeGreaterThan(0.5 * luma(horizon));
  });

  it('the night glow fades out as the sun reaches the horizon', () => {
    expect(nightness(-10)).toBe(1);
    expect(nightness(5)).toBe(0);
    expect(glowColour(SKY.noonday)).toEqual([0, 0, 0]);
    expect(glowColour(SKY.midnight)).toEqual(SKY.midnight.horizon);
    expect(luma(glowColour(skyAtSun(-2)))).toBeLessThan(luma(glowColour(skyAtSun(-6))));
  });

  it('is continuous in the sun’s elevation through dusk: no step between neighbours', () => {
    const at = (e: number) => luma(skyColour(skyAtSun(e, 270), look(10, 200)));
    for (let e = -20; e < 30; e += 0.5) {
      expect(Math.abs(at(e + 0.5) - at(e))).toBeLessThan(0.05);
    }
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

  it('far surfaces take the scattered sky at the horizon in their azimuth, at both skies', () => {
    for (const d of [...Object.values(SKY), skyAtSun(2, 270)]) {
      const far = shade(d, [0.9, 0.2, 0.1], UP, 100000, look(-3, 200));
      const sky = skyColour(d, look(0, 200));
      for (let i = 0; i < 3; i += 1) expect(far[i]).toBeCloseTo(sky[i], 6);
    }
  });

  it('haze toward the dusk sun is warmer and brighter than haze away from it', () => {
    const dusk = skyAtSun(-1, 270);
    const toward = shade(dusk, [0, 0, 0], UP, 100000, look(-3, 270));
    const away = shade(dusk, [0, 0, 0], UP, 100000, look(-3, 90));
    const blueShare = (c: Vec3) => c[2] / (c[0] + c[1] + c[2]);
    expect(luma(toward)).toBeGreaterThan(3 * luma(away));
    expect(blueShare(toward)).toBeLessThan(blueShare(away));
  });

  it('haze colour differs between the two skies: pale day horizon, dim night one', () => {
    const far = (d: typeof SKY.midnight) => luma(shade(d, [0, 0, 0], UP, 1e6, look(-3, 180)));
    expect(far(SKY.noonday)).toBeGreaterThan(5 * far(SKY.midnight));
  });

  it('with distance a dark surface rises toward the haze and a bright one falls toward it', () => {
    const d = SKY.noonday;
    const view = look(-4, 200);
    const h = luma(skyColour(d, look(0, 200)));
    const dark = (x: number) => luma(shade(d, [0.02, 0.02, 0.02], UP, x, view));
    expect(dark(2000)).toBeGreaterThan(dark(200));
    expect(dark(2000)).toBeLessThan(h);
  });
});

describe('ground light and haze', () => {
  it("at night the ground has a moon above the horizon on the sun's mirrored side, and a lifted ambient; by day it is the sun", () => {
    const night = groundLight(SKY.midnight);
    expect(night.dir[1]).toBeGreaterThan(0.5);
    expect(luma(night.colour)).toBeGreaterThan(0.03);
    expect(luma(night.ambient)).toBeGreaterThan(2 * luma(SKY.midnight.ambient));
    const day = groundLight(SKY.noonday);
    expect(Array.from(day.dir)).toEqual(Array.from(sunDirection(SKY.noonday)));
    expect(Array.from(day.colour)).toEqual(Array.from(SKY.noonday.direct));
    expect(Array.from(day.ambient)).toEqual(Array.from(SKY.noonday.ambient));
  });

  it('the ground light is continuous through sunset', () => {
    const at = (e: number) => luma(groundLight(skyAtSun(e)).colour);
    for (let e = -10; e < 10; e += 0.5) expect(Math.abs(at(e + 0.5) - at(e))).toBeLessThan(0.35);
  });

  it('haze leaves the near ground nearly clear and takes the far ridges: a power law, not plain exp(-k d)', () => {
    expect(transmittance(300)).toBeGreaterThan(0.85);
    expect(transmittance(300)).toBeGreaterThan(Math.exp(-HAZE_K * 300));
    expect(transmittance(2500)).toBeLessThan(0.15);
    expect(HAZE_POWER).toBeGreaterThan(1);
  });

  it('the camera starts with the noon sun off its axis, so the light rakes the relief', () => {
    const yaw = 2 * Math.PI * START_TURNS;
    const forward = [Math.sin(yaw), 0, -Math.cos(yaw)];
    const sun = sunDirection(SKY.noonday);
    const along = (forward[0] * sun[0] + forward[2] * sun[2]) / Math.hypot(sun[0], sun[2]);
    expect(Math.abs(along)).toBeLessThan(0.4);
  });
});
