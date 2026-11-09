// The luminance band each fixed sky state's drawn sky is shaped into, so the state's theme ink
// clears 4.5:1 on bare sky (WCAG relative luminance, the `luminance` of src/sky/skyTokens.js).
//
//   day, dusk  Noonday Sky's dark text ink #342d25 (L 0.0274) needs a backdrop of at least 0.2983.
//              The floor is that text bound (0.30 as drawn); there is no ceiling, dark ink on light is fine.
//   night      Midnight Sky's light text ink #aeccff (L 0.594) needs a backdrop of at most 0.0931.
//              The baked night sky (0.058 to 0.077) is kept; the ceiling is the bound.
//
// Link ink is not part of the band: see skyTheme.ts.
//
// The terrain sky is a physical scatter function, so it is shaped downstream, on its final colour:
// `shapeToBand` here, and its GLSL twin (`SHAPE_SKY_GLSL`) in terrain/terrainShaders.ts, built from the
// same constants. The ridge sky is a three-stop gradient whose stops are chosen inside the band
// (ridge/skyColour.ts, skyForState.ts), and its test sweeps the blends.
export type FixedSkyState = 'day' | 'dusk' | 'night';
export type Linear = readonly [number, number, number];

/** WCAG luma weights, applied to linear RGB. */
export const LUMA: Linear = [0.2126, 0.7152, 0.0722];
export const luma = (c: Linear): number => LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2];

/** sRGB hex `#rrggbb` to linear RGB 0..1. */
export function hexToLinear(hex: string): Linear {
  const ch = (at: number) => {
    const s = parseInt(hex.slice(at, at + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [ch(1), ch(3), ch(5)];
}

/**
 * Relative luminance of what the terrain shaders put on screen for a linear colour: they encode with
 * pow(1/2.2), not the sRGB curve, so the screen colour is read back through the sRGB curve.
 */
export function displayedLuminance(c: Linear): number {
  const ch = (v: number) => {
    const e = Math.min(1, Math.max(0, v)) ** (1 / 2.2);
    return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4;
  };
  return luma([ch(c[0]), ch(c[1]), ch(c[2])]);
}

export interface SkyBand {
  /** Linear luma the shaped colour is at least (0: no floor). */
  floor: number;
  /** Linear luma the shaped colour is at most (1: no ceiling). */
  ceiling: number;
  /** The colour a too-dark sky is mixed toward: the state's own tint, so the hue survives the lift. Its luma is above `floor`. */
  lift: Linear;
}

/**
 * The shaping targets, in linear luma. The floor sits 0.01 above the text bound (0.2983) because the
 * screen encoding is gamma 2.2, which reads about 0.006 darker through the sRGB curve at this level.
 */
export const SKY_BAND: Record<FixedSkyState, SkyBand> = {
  day: { floor: 0.31, ceiling: 1, lift: hexToLinear('#e2f4ff') },
  dusk: { floor: 0.31, ceiling: 1, lift: hexToLinear('#eba0b9') },
  night: { floor: 0, ceiling: 0.09, lift: hexToLinear('#484e64') },
};

/**
 * Shape a linear sky colour into the band. Below the floor it mixes toward `lift` by exactly the amount
 * that lands on the floor (continuous at the floor, hue kept); above the ceiling it scales down to the
 * ceiling. The colour is clamped to 0..1 first, as the screen does.
 */
export function shapeToBand(c: Linear, band: SkyBand): Linear {
  const k = [0, 1, 2].map((i) => Math.min(1, Math.max(0, c[i]))) as unknown as Linear;
  const l = luma(k);
  if (l < band.floor) {
    const t = (band.floor - l) / (luma(band.lift) - l);
    return [0, 1, 2].map((i) => k[i] + (band.lift[i] - k[i]) * t) as unknown as Linear;
  }
  if (l > band.ceiling) return [0, 1, 2].map((i) => (k[i] * band.ceiling) / l) as unknown as Linear;
  return k;
}
