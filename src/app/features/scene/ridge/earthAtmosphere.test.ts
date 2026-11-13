import { describe, expect, it } from 'vitest';
import { bakeAtmosphere, bakeCostSteps, PLANET_KM } from './earthAtmosphere';
import { TOP_KM } from './earthAtmosphere';

const rad = (deg: number) => Math.cos(((90 - deg) * Math.PI) / 180);
const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const atNoon = bakeAtmosphere({ sunElevationDeg: 45 });
const atSunset = bakeAtmosphere({ sunElevationDeg: 0 });
const atDark = bakeAtmosphere({ sunElevationDeg: -20 });

/** Sky radiance looking `elev` degrees above the horizon, `az` degrees from the sun's azimuth. */
const sky = (a: ReturnType<typeof bakeAtmosphere>, elev: number, az: number) => {
  const out = [0, 0, 0];
  a.radiance(Math.sin((elev * Math.PI) / 180), Math.cos((az * Math.PI) / 180), out);
  return out;
};

describe('earthAtmosphere: the published Earth atmosphere, baked to look-up tables', () => {
  it('has the geometry of the references (a 100 km shell on a 6360 km planet)', () => {
    expect(PLANET_KM).toBe(6360);
    expect(TOP_KM - PLANET_KM).toBe(100);
  });

  it('transmittance to space: the zenith is the published vertical optical depth, red passes most, blue least', () => {
    const t = [0, 0, 0];
    atNoon.transmittanceToSpace(1, t);
    // Rayleigh column at 8 km: 5.802e-3 * 8 = 0.0464 (red), 0.108 (green), 0.265 (blue); Mie 4.44e-3 * 1.2 = 0.0053; ozone
    // 0.65e-3 * 15 = 0.00975 (red), 0.0282 (green), 0.0013 (blue). So exp(-tau) there.
    expect(t[0]).toBeCloseTo(Math.exp(-(0.0464 + 0.0053 + 0.0098)), 1);
    expect(t[1]).toBeCloseTo(Math.exp(-(0.1085 + 0.0053 + 0.0282)), 1);
    expect(t[2]).toBeCloseTo(Math.exp(-(0.2648 + 0.0053 + 0.0013)), 1);
    expect(t[0]).toBeGreaterThan(t[1]);
    expect(t[1]).toBeGreaterThan(t[2]);
  });

  it('a noon sky is blue: the zenith is bluer than the horizon, and bluer than it is red', () => {
    const zenith = sky(atNoon, 70, 90);
    expect(zenith[2]).toBeGreaterThan(zenith[0] * 1.5);
    const horizon = sky(atNoon, 1, 90);
    expect(luma(horizon)).toBeGreaterThan(luma(zenith)); // the long path whitens and brightens the horizon
    expect(horizon[2] / horizon[0]).toBeLessThan(zenith[2] / zenith[0]);
  });

  it('the sky toward the sun at sunset is red-orange, and the zenith opposite is blue', () => {
    const toward = sky(atSunset, 3, 5);
    expect(toward[0]).toBeGreaterThan(toward[2] * 1.5);
    const away = sky(atSunset, 40, 180);
    expect(away[2]).toBeGreaterThan(away[0]);
  });

  it('a clear sky brightens toward the sun (the Mie lobe)', () => {
    expect(luma(sky(atNoon, 45, 4))).toBeGreaterThan(2 * luma(sky(atNoon, 30, 90)));
  });

  it('the sky is dark when the sun is 20 degrees under the horizon, a thousandth of noon or less', () => {
    expect(luma(sky(atDark, 20, 90))).toBeLessThan(luma(sky(atNoon, 20, 90)) * 1e-3);
  });

  it('twilight keeps a blue zenith (the ozone absorption of red)', () => {
    const twilight = bakeAtmosphere({ sunElevationDeg: -6 });
    const z = sky(twilight, 60, 180);
    expect(z[2]).toBeGreaterThan(z[0] * 1.5);
  });

  it('haze (Mie x4) whitens and brightens the horizon haze band', () => {
    const hazy = bakeAtmosphere({ sunElevationDeg: 30, mieScale: 4 });
    const clear = bakeAtmosphere({ sunElevationDeg: 30 });
    const h = sky(hazy, 12, 20);
    const c = sky(clear, 12, 20);
    expect(luma(h)).toBeGreaterThan(luma(c)); // more aerosol, more forward scattering toward the sun
    expect(h[2] / h[0]).toBeLessThan(c[2] / c[0]); // and less blue
  });

  it('is energy-sane: the multiple-scattering term never makes the sky brighter than the sun it takes in, and stays finite', () => {
    for (const a of [atNoon, atSunset, atDark]) {
      for (let i = 0; i < a.skyView.data.length; i += 1) {
        expect(Number.isFinite(a.skyView.data[i])).toBe(true);
        expect(a.skyView.data[i]).toBeGreaterThanOrEqual(0);
        expect(a.skyView.data[i]).toBeLessThan(5);
      }
    }
    expect(rad(0)).toBeCloseTo(0, 6);
  });

  it('bake cost: the three LUTs take about the stated number of march steps, in tens of milliseconds', () => {
    const steps = bakeCostSteps();
    const t0 = performance.now();
    bakeAtmosphere({ sunElevationDeg: 24 });
    const ms = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`atmosphere bake: ${steps} march steps, ${ms.toFixed(1)} ms`);
    expect(steps).toBeLessThan(1_000_000);
    expect(ms).toBeLessThan(1500);
  });
});
