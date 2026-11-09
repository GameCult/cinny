/* eslint-disable no-restricted-syntax -- tests walk table texels */
import { describe, expect, it } from 'vitest';
import { baked } from '../../../../sky/baked';
import {
  aerialRay,
  AP_ELEVATIONS,
  AP_SLICES,
  apElevation,
  apSliceKm,
  decode,
  SUN_ELEVATIONS_DEG,
  viewElevation,
} from '../../../../sky/scatter.js';
import {
  AERIAL_GLSL,
  aerialAt,
  AP_VOLUME,
  apVolumeWords,
  SCATTER_GLSL,
  scatterRadiance,
  skyViewWords,
  SKY_VIEW,
  tableWords,
  transmittanceAt,
} from './terrainScatter';

const S = baked.scatter.sky_view;

describe('the table upload', () => {
  it('decodes the baked base64 to one half-float word per channel per texel', () => {
    const w = skyViewWords();
    expect(w.length).toBe(S.width * S.height * S.depth * S.channels);
    expect(SKY_VIEW).toEqual({ width: S.width, height: S.height, depth: S.depth });
    expect(tableWords(baked.scatter.transmittance.data)).toHaveLength(32 * 3);
  });

  it('words are little-endian: the base64 bytes lo, hi make a word hi << 8 | lo', () => {
    expect(Array.from(tableWords(btoa(String.fromCharCode(0x34, 0x12, 0xff, 0x7b))))).toEqual([
      0x1234, 0x7bff,
    ]);
  });
});

describe('scatterRadiance (the CPU twin of the sampler)', () => {
  it('returns the stored texel exactly at a texel centre: layout x azimuth, y view, z sun', () => {
    const w = skyViewWords();
    for (const [z, y, x] of [
      [10, 31, 0],
      [8, 5, 3],
      [5, 20, 6],
      [11, 0, 2],
    ]) {
      const base = ((z * S.height + y) * S.width + x) * 3;
      const got = scatterRadiance(
        S.sun_elevations_deg[z],
        viewElevation(y),
        x * S.azimuth_step_deg
      );
      got.forEach((v, c) => expect(v).toBeCloseTo(decode(w[base + c]), 9));
    }
  });

  it('interpolates between texels and clamps beyond the table', () => {
    const a = scatterRadiance(25, 10, 0)[2];
    const b = scatterRadiance(45, 10, 0)[2];
    const mid = scatterRadiance(35, 10, 0)[2]; // 35 is halfway between 25 and 45 on the sun axis
    expect(mid).toBeCloseTo((a + b) / 2, 9);
    expect(scatterRadiance(500, 10, 400)).toEqual(scatterRadiance(90, 10, 180));
    expect(scatterRadiance(30, 10, -90)).toEqual(scatterRadiance(30, 10, 90));
  });

  it('is black under the planet’s shadow limit and blue at a high noon zenith', () => {
    scatterRadiance(-18, 30, 0).forEach((v) => expect(v).toBeLessThan(1e-6));
    const noon = scatterRadiance(45, 85, 90);
    expect(noon[2]).toBeGreaterThan(1.5 * noon[0]);
  });
});

describe('transmittanceAt', () => {
  it('is the zenith transmittance exp(-TAU) overhead and redder at the horizon', () => {
    const z = transmittanceAt(90);
    [0.06, 0.12, 0.26].forEach((tau, i) => expect(z[i]).toBeCloseTo(Math.exp(-tau), 2));
    const h = transmittanceAt(2);
    expect(h[2] / h[0]).toBeLessThan(0.5 * (z[2] / z[0]));
  });

  it('is zero where the ground is in the way', () => {
    expect(transmittanceAt(-4)).toEqual([0, 0, 0]);
  });
});

describe('the GLSL sampler', () => {
  it('uses the layout the README documents: texel-centre coordinates over a 7 x 32 x 12 texture, decoded by the store scale', () => {
    expect(SCATTER_GLSL).toContain('(x + 0.5) / 7.0');
    expect(SCATTER_GLSL).toContain('(y + 0.5) / 32.0');
    expect(SCATTER_GLSL).toContain('(uSunIndex + 0.5) / 12.0');
    expect(SCATTER_GLSL).toContain('/ 64.0');
    expect(SCATTER_GLSL).toContain('sqrt(clamp((el - (-4.0)) / 94.0, 0.0, 1.0)) * 31.0');
    expect(SCATTER_GLSL).toContain('* 6.0');
  });
});

describe('the aerial perspective volume as the terrain reads it', () => {
  it('uploads RGBA half floats in the baked layout', () => {
    const a = baked.scatter.aerial_perspective;
    expect(apVolumeWords()).toHaveLength(a.width * a.height * a.depth * 4);
    expect(AP_VOLUME).toEqual({ width: a.width, height: a.height, depth: a.depth });
  });

  it('on a texel centre the CPU twin returns the baked ray exactly (to half-float precision)', () => {
    const sunI = 8;
    const ei = 5;
    const slice = 6;
    const want = aerialRay(SUN_ELEVATIONS_DEG[sunI], apElevation(ei), 90)[slice];
    const got = aerialAt(SUN_ELEVATIONS_DEG[sunI], apElevation(ei), 90, apSliceKm(slice));
    for (let c = 0; c < 3; c += 1) expect(got.L[c]).toBeCloseTo(want[c], 3);
    expect(got.alpha).toBeCloseTo(want[3], 3);
  });

  it('between texels it is near the model: the filtering error is small against the signal', () => {
    const want = aerialRay(10, -1.3, 75)[AP_SLICES - 2];
    const got = aerialAt(10, -1.3, 75, apSliceKm(AP_SLICES - 2));
    expect(Math.abs(got.alpha - want[3])).toBeLessThan(0.03);
    expect(got.L[0] / want[0]).toBeGreaterThan(0.6);
    expect(got.L[0] / want[0]).toBeLessThan(1.6);
  });

  it('fades to nothing at the observer, and clamps past the last slice', () => {
    expect(aerialAt(45, -2, 90, 0)).toEqual({ L: [0, 0, 0], alpha: 0 });
    const last = aerialAt(45, -2, 90, apSliceKm(AP_SLICES - 1));
    const beyond = aerialAt(45, -2, 90, 1e6);
    expect(beyond.alpha).toBeCloseTo(last.alpha, 9);
  });

  it('the shader lookup carries the same constants as the table', () => {
    const a = baked.scatter.aerial_perspective;
    expect(AERIAL_GLSL).toContain(`/ ${a.height}.0`);
    expect(AERIAL_GLSL).toContain(`${a.max_km.toFixed(1)}`);
    expect(AERIAL_GLSL).toContain(`${AP_ELEVATIONS}.0 +`);
  });
});
