import { describe, expect, it } from 'vitest';
import {
  AZIMUTH_SAMPLES,
  AZIMUTH_STEP_DEG,
  STORE_SCALE,
  SUN_ELEVATIONS_DEG,
  VIEW_SAMPLES,
  bakeScatter,
  decode,
  fromHalf,
  skyRadiance,
  sunIndex,
  toHalf,
  transmittance,
  viewElevation,
  viewIndex,
} from './scatter.js';
import { TAU } from './sun.js';
import { baked } from './baked';

const table = (b64: string): Uint16Array => {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new Uint16Array(bytes.buffer);
};
// Checksums of the baked halves, so a change to the model or the encoding is a deliberate re-pin.
const SKY_CHECKSUM = 622927107;
const TRANS_CHECKSUM = 1498461058;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const scatter = baked.scatter as any;
const sky = table(scatter.sky_view.data);
const trans = table(scatter.transmittance.data);
const sunIndex_ = (deg: number) => SUN_ELEVATIONS_DEG.indexOf(deg);
// Texel of the sky table: x = azimuth, y = view elevation, z = sun elevation; value = three halves.
const texel = (s: number, v: number, a: number) =>
  [0, 1, 2].map((c) => decode(sky[((s * VIEW_SAMPLES + v) * AZIMUTH_SAMPLES + a) * 3 + c]));

describe('half floats', () => {
  it('round-trip within half precision across the table range, ties to even', () => {
    [6.1e-5, 1e-4, 0.0123, 0.3, 1, 20, 1000].forEach((x) =>
      expect(Math.abs(fromHalf(toHalf(x)) - x) / x).toBeLessThan(5.1e-4)
    );
    expect(toHalf(0)).toBe(0);
    expect(toHalf(1)).toBe(0x3c00);
    expect(toHalf(2 ** -24)).toBe(1); // smallest subnormal
    expect(toHalf(1 + 2 ** -11)).toBe(0x3c00); // exact tie goes to the even neighbour
    expect(toHalf(1 + 3 * 2 ** -11)).toBe(0x3c02);
    expect(fromHalf(0x7bff)).toBe(65504);
  });

  it('keeps twilight radiance, ~1e-4, within 0.1% thanks to the store scale', () => {
    const x = 1.234e-4;
    expect(Math.abs(decode(toHalf(x * STORE_SCALE)) - x) / x).toBeLessThan(1e-3);
  });
});

describe('sunIndex', () => {
  it('is the fractional position of an elevation on the sun axis, clamped to the table', () => {
    expect(sunIndex(-18)).toBe(0);
    expect(sunIndex(90)).toBe(SUN_ELEVATIONS_DEG.length - 1);
    expect(sunIndex(-100)).toBe(0);
    expect(sunIndex(100)).toBe(SUN_ELEVATIONS_DEG.length - 1);
    expect(sunIndex(0)).toBe(sunIndex_(0));
    expect(sunIndex(1.5)).toBeCloseTo(sunIndex_(0) + 0.5, 12); // halfway between 0 and 3
    expect(sunIndex(35)).toBeCloseTo(sunIndex_(25) + 0.5, 12); // halfway between 25 and 45
  });
});

describe('scattering tables', () => {
  it('are what scripts/bake-sky.mjs would write now (run npm run bake:sky if not)', () => {
    expect(JSON.parse(JSON.stringify(bakeScatter()))).toEqual(JSON.parse(JSON.stringify(scatter)));
  });

  it('have the documented layout and size', () => {
    expect(scatter.format).toBe('half-float');
    expect(scatter.sky_view).toMatchObject({
      width: AZIMUTH_SAMPLES,
      height: VIEW_SAMPLES,
      depth: SUN_ELEVATIONS_DEG.length,
      channels: 3,
      azimuth_step_deg: AZIMUTH_STEP_DEG,
    });
    expect(sky.length).toBe(AZIMUTH_SAMPLES * VIEW_SAMPLES * SUN_ELEVATIONS_DEG.length * 3);
    expect(trans.length).toBe(VIEW_SAMPLES * 3);
    expect(sky.length * 2).toBe(16128); // bytes: the budget the README states
  });

  it('pin the view-elevation axis and its inverse', () => {
    expect(viewElevation(0)).toBe(-4);
    expect(viewElevation(VIEW_SAMPLES - 1)).toBe(90);
    expect(viewElevation(6)).toBeCloseTo(-4 + 94 * (6 / 31) ** 2, 10);
    [0, 5, 6, 17, 31].forEach((i) => expect(viewIndex(viewElevation(i))).toBeCloseTo(i, 9));
  });

  it('transmittance to space agrees with sun.js at the zenith and falls toward the horizon', () => {
    const top = VIEW_SAMPLES - 1;
    [0, 1, 2].forEach((c) =>
      expect(Math.abs(decode(trans[top * 3 + c]) / Math.exp(-TAU[c]) - 1)).toBeLessThan(0.01)
    );
    expect(transmittance(90).map((v, c) => v / Math.exp(-TAU[c]))).toSatisfy((r: number[]) =>
      r.every((x) => Math.abs(x - 1) < 0.01)
    );
    // blue goes first: lower view, lower blue, and redder light at the horizon
    let prev = Infinity;
    for (let i = top; i >= 8; i -= 1) {
      const blue = decode(trans[i * 3 + 2]);
      expect(blue).toBeLessThanOrEqual(prev);
      prev = blue;
    }
    expect(decode(trans[8 * 3]) / decode(trans[8 * 3 + 2])).toBeGreaterThan(10); // ~2 degrees up: sunset red
    expect(decode(trans[0])).toBe(0); // -4 degrees looks at the ground
  });

  it('colour the daytime sky blue, and a low sun redder toward it than away from it', () => {
    const noon = texel(sunIndex_(45), VIEW_SAMPLES - 1, 0);
    expect(noon[2]).toBeGreaterThan(noon[1]);
    expect(noon[1]).toBeGreaterThan(noon[0]);
    const horizon = Math.round(viewIndex(5));
    const toward = texel(sunIndex_(3), horizon, 0);
    const away = texel(sunIndex_(3), horizon, AZIMUTH_SAMPLES - 1);
    expect(toward[0] / toward[2]).toBeGreaterThan(5);
    expect(toward[0] / toward[2]).toBeGreaterThan(2 * (away[0] / away[2]));
    expect(toward[0]).toBeGreaterThan(5 * away[0]); // the glow is around the sun
  });

  it('fade through twilight to black below the planet-shadow limit', () => {
    const mid = Math.round(viewIndex(30));
    const lum = (s: number) => texel(sunIndex_(s), mid, 3).reduce((x, y) => x + y, 0);
    expect(lum(8)).toBeGreaterThan(lum(3));
    expect(lum(3)).toBeGreaterThan(lum(-2));
    expect(lum(-2)).toBeGreaterThan(lum(-5));
    expect(lum(-5)).toBeGreaterThan(0);
    expect(lum(-12)).toBe(0);
    expect(lum(-18)).toBe(0);
  });

  it('hold the model to half-float precision, with no quantised steps along the horizon glow', () => {
    // Every table texel off a handful of sampled ones is the model's own value to < 0.2%.
    [
      [sunIndex_(3), 6, 0],
      [sunIndex_(3), 9, 2],
      [sunIndex_(0), 8, 0],
      [sunIndex_(45), 20, 3],
      [sunIndex_(-2), 12, 1],
    ].forEach(([s, v, a]) => {
      const direct = skyRadiance(SUN_ELEVATIONS_DEG[s], viewElevation(v), a * AZIMUTH_STEP_DEG);
      texel(s, v, a).forEach((got, c) => expect(Math.abs(got / direct[c] - 1)).toBeLessThan(2e-3));
    });
    // Moving up from the horizon toward the sun, red drops smoothly: distinct, strictly decreasing.
    const s = sunIndex_(3);
    const reds = Array.from({ length: 8 }, (_, k) => texel(s, 7 + k, 0)[0]);
    reds.slice(1).forEach((r, k) => expect(r).toBeLessThan(reds[k]));
    expect(new Set(reds).size).toBe(reds.length);
  });

  it('are the same bytes as when pinned', () => {
    const sum = (a: Uint16Array) => a.reduce((x, y) => (x * 31 + y) % 2147483647, 7);
    expect([sum(sky), sum(trans)]).toEqual([SKY_CHECKSUM, TRANS_CHECKSUM]);
  });
});
