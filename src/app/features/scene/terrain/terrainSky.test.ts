/* eslint-disable no-restricted-syntax -- tests loop over skies, normals and distances */
import { AP_DISTANCE_SCALE } from './terrainScatter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { baked } from '../../../../sky/baked';
import {
  chooseSky,
  coldness,
  glowColour,
  hazeColour,
  hexToLinear,
  nightness,
  shade,
  SKY,
  skyAtSun,
  skyData,
  skyColour,
  sunDirection,
  aerialPerspective,
  SKY_FADE,
  metresToKm,
  groundLight,
  HAZE_K,
  HAZE_POWER,
  START_TURNS,
  Vec3,
} from './terrainSky';

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

describe('aerial perspective', () => {
  const ray = (el: number, az: number): Vec3 => look(el, az);
  const along = (d: typeof SKY.midnight, el: number, az: number, m: number) =>
    aerialPerspective(d, ray(el, az), m);

  it('opacity grows with distance from nothing at the eye toward the far value, never past 1', () => {
    let prev = along(SKY.noonday, -2, 200, 0).alpha;
    expect(prev).toBe(0);
    for (const m of [10, 100, 400, 800, 1000, 1300]) {
      const a = along(SKY.noonday, -2, 200, m).alpha;
      expect(a).toBeGreaterThan(prev);
      expect(a).toBeLessThanOrEqual(1);
      prev = a;
    }
  });

  it('leaves the near ground its own colour and takes the far ridges', () => {
    expect(along(SKY.noonday, -2, 200, 100).alpha).toBeLessThan(0.15);
    expect(along(SKY.noonday, -2, 200, SKY_FADE[0]).alpha).toBeGreaterThan(0.1);
  });

  it('the in-scatter is a function of the baked volume: its colour is bluer than the sun far by day', () => {
    const far = along(SKY.noonday, -2, 90, SKY_FADE[0]).colour;
    expect(far[2]).toBeGreaterThan(far[0]);
  });

  it('haze toward a setting sun is brighter than away from it, and red, not blue (the sun is reddened on its way)', () => {
    const dusk = skyAtSun(2, 270);
    const toward = along(dusk, -1, 270, SKY_FADE[0]).colour;
    const away = along(dusk, -1, 90, SKY_FADE[0]).colour;
    expect(luma(toward)).toBeGreaterThan(3 * luma(away));
    expect(toward[0]).toBeGreaterThan(toward[2]);
  });

  it('night haze is a deep blue floor, not grey: dark, blue over red by a wide margin, brighter than black', () => {
    const c = along(SKY.midnight, -2, 0, SKY_FADE[0]).colour;
    expect(luma(c)).toBeGreaterThan(0.0003);
    expect(luma(c)).toBeLessThan(0.08);
    expect(c[2]).toBeGreaterThan(2.5 * c[0]);
    expect(luma(along(SKY.noonday, -2, 0, SKY_FADE[0]).colour)).toBeGreaterThan(5 * luma(c));
  });

  it('moonlight lights the night haze toward the moon more than away from it', () => {
    const moon = groundLight(SKY.midnight).dir;
    const toward = aerialPerspective(SKY.midnight, [moon[0], -0.02, moon[2]], SKY_FADE[0]).colour;
    const away = aerialPerspective(SKY.midnight, [-moon[0], -0.02, -moon[2]], SKY_FADE[0]).colour;
    expect(luma(toward)).toBeGreaterThan(luma(away));
  });

  it('with distance a dark surface rises toward the haze and its own colour is lost', () => {
    const d = SKY.noonday;
    const view = ray(-4, 200);
    const dark = (x: number) => luma(shade(d, [0.02, 0.02, 0.02], UP, x, view));
    expect(dark(SKY_FADE[0])).toBeGreaterThan(dark(100));
    const own = (x: number) => 1 - aerialPerspective(d, view, x).alpha;
    expect(own(SKY_FADE[0])).toBeLessThan(0.9 * own(100));
  });

  it('is continuous in the sun elevation through dusk: no step between neighbours', () => {
    const at = (e: number) => luma(along(skyAtSun(e, 270), -1, 270, SKY_FADE[0]).colour);
    for (let e = -12; e < 12; e += 0.5) expect(Math.abs(at(e + 0.5) - at(e))).toBeLessThan(0.45);
  });

  it('far terrain is the sky: past the fade it is the horizon sky colour in its azimuth, by day, dusk and night, whatever it was', () => {
    for (const [d, az] of [
      [SKY.midnight, 0],
      [skyAtSun(-1, 90), 90],
      [skyAtSun(2, 270), 200],
      [SKY.noonday, 120],
    ] as const) {
      const view = ray(-0.5, az);
      const hz = skyColour(d, [view[0], 0, view[2]]);
      const far = aerialPerspective(d, view, SKY_FADE[1]);
      expect(far.alpha).toBe(1);
      for (let i = 0; i < 3; i += 1) expect(far.colour[i]).toBeCloseTo(hz[i], 9);
      expect(shade(d, [0.5, 0.5, 0.5], UP, SKY_FADE[1] + 500, view)).toEqual(far.colour);
    }
  });

  it('the metres-to-km law is the scene metres times the baked distance scale', () => {
    expect(metresToKm(1000)).toBeCloseTo(AP_DISTANCE_SCALE, 9);
    expect(metresToKm(-5)).toBe(0);
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

  it('the camera starts with the noon sun off its axis, so the light rakes the relief', () => {
    const yaw = 2 * Math.PI * START_TURNS;
    const forward = [Math.sin(yaw), 0, -Math.cos(yaw)];
    const sun = sunDirection(SKY.noonday);
    const along = (forward[0] * sun[0] + forward[2] * sun[2]) / Math.hypot(sun[0], sun[2]);
    expect(Math.abs(along)).toBeLessThan(0.4);
  });
});

describe('chooseSky: an explicit sky wins over the page URL', () => {
  const at = (search: string) => vi.stubGlobal('window', { location: { search } });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lets the URL steer when no option is given', () => {
    at('?sun=40&az=90');
    expect(chooseSky({})).toEqual(skyAtSun(40, 90));
    at('?sky=noonday');
    expect(chooseSky({})).toEqual(skyData('noonday'));
  });

  it('prefers an explicit baked sky to ?sun= and ?sky=', () => {
    at('?sun=40&az=90&sky=noonday');
    expect(chooseSky({ sky: 'midnight' })).toEqual(skyData('midnight'));
    at('?sky=noonday');
    expect(chooseSky({ sky: 'midnight' })).toEqual(skyData('midnight'));
  });

  it('prefers an explicit sun to ?sun=, and takes no azimuth from ?az=', () => {
    at('?sun=40&az=90&sky=noonday');
    expect(chooseSky({ sun: { elevation: 2 } })).toEqual(skyAtSun(2, undefined));
    expect(chooseSky({ sun: { elevation: 2, azimuth: 10 } })).toEqual(skyAtSun(2, 10));
  });
});
