// The luminance band each fixed sky state's drawn sky is shaped into, so the state's theme ink
// clears 4.5:1 on bare sky (WCAG relative luminance, the `luminance` of src/sky/skyTokens.js).
//
//   day        Noonday Sky's dark text ink #342d25 (L 0.0274) needs a backdrop of at least 0.2983.
//              The floor is that text bound (0.30 as drawn); there is no ceiling, dark ink on light is fine.
//   dusk       The same ink, and its link #2a4f27 (L 0.0623), which needs a backdrop of at least 0.4554. The floor is
//              the link bound (0.4744 as drawn), so text clears 4.5:1 with room (6.6) and the link clears too.
//   night      Midnight Sky's light text ink #aeccff (L 0.594) needs a backdrop of at most 0.0931.
//              The baked night sky (0.058 to 0.077) is kept; the ceiling is the bound.
//
// Night's link ink is not part of the band: see skyTheme.ts.
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

/** How a displayed colour is read: as encoded, or moved one 8-bit step down or up in every channel ('low', 'high'). */
export type Reading = 'exact' | 'low' | 'high';

/**
 * Relative luminance of what the terrain shaders put on screen for a linear colour: they encode with
 * pow(1/2.2), not the sRGB curve, so the screen colour is read back through the sRGB curve. 'low' and 'high' move every
 * encoded channel one 8-bit step down or up first: rounding to 8 bits (half a step) plus the sky pass's dither (half a
 * step) cannot move a channel further, so they bound what the screen shows. A smooth bound, so a search can climb it.
 */
export function displayedLuminance(c: Linear, reading: Reading = 'exact'): number {
  const shift = { exact: 0, low: -1 / 255, high: 1 / 255 }[reading];
  const ch = (v: number) => {
    const e = Math.min(1, Math.max(0, Math.min(1, Math.max(0, v)) ** (1 / 2.2) + shift));
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
 * The shaping targets, in linear luma. Day's floor sits 0.019 above the text bound (0.2983), Dusk's 0.019 above the link
 * bound (0.4554), which skyForState.test.ts derives from the ink and ties to these: the screen encoding is
 * gamma 2.2, which reads about 0.006 darker through the sRGB curve at this level, and 8-bit rounding with the sky
 * pass's dither at its worst (one step in every channel) takes about 0.007 more. The night ceiling is lower than the text bound
 * (0.0931) by more than that: 0.077394 is the luma at which one step up reads 0.08164, the lightest the baked night sky shows
 * (skyState.ts), so a sky the page URL steers at night, scaled down to the ceiling, cannot show lighter than the baked one.
 */
export const SKY_BAND: Record<FixedSkyState, SkyBand> = {
  day: { floor: 0.317, ceiling: 1, lift: hexToLinear('#e2f4ff') },
  // Dusk lifts toward Day's pale blue rather than a rose: mixing a third of the sky toward rose washed the twilight pink, and
  // a rose lighter than the floor shifts hues by 47 to 72 degrees where Day's tint shifts them by 18 (measured, PR body).
  dusk: { floor: 0.4744, ceiling: 1, lift: hexToLinear('#e2f4ff') },
  night: { floor: 0, ceiling: 0.077394, lift: hexToLinear('#5a6a9a') },
};

/**
 * The ridge scene's night band, lower than the state's: the navigator's foldout headers wear a dimmer ink than its room rows
 * (L 0.386 against 0.594 measured on screen, rat-crest-a7c95ce-20261111), so they need a backdrop of at most 0.047 where rows need 0.093,
 * and the baked sky (0.058 to 0.077) sat above it (headers 3.9 to 4.2:1). 0.04 leaves the 8-bit rounding and the sky's blur
 * its share. The ridge draws its own sky, so it takes the darker ceiling alone; the terrain keeps SKY_BAND.night.
 */
export const RIDGE_NIGHT_BAND: SkyBand = { ...SKY_BAND.night, ceiling: 0.04 };

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
