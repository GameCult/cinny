import { describe, expect, it } from 'vitest';
import { displayedLuminance, hexToLinear, luma, shapeToBand, SKY_BAND } from './skyBand';
import type { Linear } from './skyBand';
import { GRID_FRAG, SHAPE_SKY_GLSL, SKY_FRAG } from './terrain/terrainShaders';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe('shapeToBand', () => {
  const dark: Linear = [0.02, 0.05, 0.2]; // a deep blue
  const { day } = SKY_BAND;

  it('lifts a sky below the floor onto the floor, mixing toward the tint so the hue is kept', () => {
    const c = shapeToBand(dark, day);
    expect(near(luma(c), day.floor)).toBe(true);
    // Between the sky and the tint on every channel: a mix, not a grey clamp.
    [0, 1, 2].forEach((i) => {
      expect(c[i]).toBeGreaterThanOrEqual(Math.min(dark[i], day.lift[i]));
      expect(c[i]).toBeLessThanOrEqual(Math.max(dark[i], day.lift[i]));
    });
    expect(c[2]).toBeGreaterThan(c[0]); // still blue
  });

  it('lifts black to the tint scaled in, not to grey', () => {
    const c = shapeToBand([0, 0, 0], SKY_BAND.dusk);
    expect(near(luma(c), SKY_BAND.dusk.floor)).toBe(true);
    expect(c[0]).toBeGreaterThan(c[2]); // the dusk tint is rose
  });

  it('leaves a sky already in the band as it is, and is continuous at the floor', () => {
    const ok: Linear = [0.5, 0.6, 0.7];
    expect(shapeToBand(ok, day)).toEqual(ok);
    const lo = shapeToBand([0.31, 0.31, 0.31], day);
    const below = shapeToBand([0.3099, 0.3099, 0.3099], day);
    expect(Math.abs(lo[0] - below[0])).toBeLessThan(1e-3);
  });

  it('scales a sky above the ceiling down to it, keeping its hue', () => {
    const c = shapeToBand([0.9, 0.8, 1], SKY_BAND.night);
    expect(near(luma(c), SKY_BAND.night.ceiling)).toBe(true);
    expect(near(c[0] / c[2], 0.9)).toBe(true);
  });

  it('clamps to 0..1 as the screen does, and never leaves the band when shaped twice', () => {
    expect(shapeToBand([4, 4, 4], day)).toEqual([1, 1, 1]);
    const once = shapeToBand(dark, day);
    shapeToBand(once, day).forEach((v, i) => expect(v).toBeCloseTo(once[i], 12));
  });
});

describe('the bands', () => {
  it('have a tint above the floor to lift toward', () => {
    Object.values(SKY_BAND).forEach((b) => expect(luma(b.lift)).toBeGreaterThan(b.floor));
  });

  it('keep the floor above the 0.2983 text bound by what gamma 2.2, 8-bit rounding and dither can take', () => {
    const grey = shapeToBand([0, 0, 0], SKY_BAND.day);
    const shown = displayedLuminance(grey, 'low');
    expect(shown).toBeGreaterThanOrEqual(0.2983);
    expect(shown).toBeLessThan(SKY_BAND.day.floor);
  });

  it('decode hex as linear light', () => {
    expect(hexToLinear('#ffffff')).toEqual([1, 1, 1]);
  });
});

describe('the GLSL twin', () => {
  it('shapes with the same arithmetic: clamp, luma weights, mix to the floor, scale to the ceiling', () => {
    expect(SHAPE_SKY_GLSL).toContain('c = clamp(c, 0.0, 1.0);');
    expect(SHAPE_SKY_GLSL).toContain('const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);');
    expect(SHAPE_SKY_GLSL).toContain(
      'if (l < uBand.x) return mix(c, uLift, (uBand.x - l) / (dot(uLift, LUMA) - l));'
    );
    expect(SHAPE_SKY_GLSL).toContain('if (l > uBand.y) return c * (uBand.y / l);');
  });

  it('is applied to the sky colour in both shaders that draw it, the sky pass and the haze that fades into it', () => {
    [SKY_FRAG, GRID_FRAG].forEach((src) => {
      expect(src).toContain(SHAPE_SKY_GLSL);
      expect(src).toMatch(/return shapeSky\(1\.0 - exp\(-45\.0 \* skyScatter\(d\)\)/);
    });
  });
});
