// What a baked frame's recorded luma (manifest `frames[].luma`, WCAG linear relative luminance of the composited planes where they are
// solid enough, export.py) means for the text over it: the contrast of the state's theme ink against the ridge's own extremes, no scrim.
// Data for ridge-ad-legibility, which sizes the scrim from it and owns the 4.5:1 pass/fail; nothing here gates.
import { baked } from '../../../../sky/baked';
import { luminance } from '../../../../sky/skyTokens.js';
import type { FixedSkyState } from '../skyBand';

export interface FrameLuma {
  min: number;
  max: number;
}

/** The theme text ink skyBand.ts's header derives: Noonday Sky's for day and dusk, Midnight Sky's for night. */
export const themeInk = (state: FixedSkyState): string =>
  (state === 'night' ? baked.midnight : baked.noonday).tokens.Surface.OnContainer;

const ratio = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * WCAG contrast of the state's ink over a plain backdrop of the ridge's darkest and of its lightest luminance, and `worst`: the lowest
 * contrast over every luminance between them (the ink's own luminance clamped into the range, where the two are closest).
 */
export function inkContrast(
  luma: FrameLuma,
  state: FixedSkyState
): { atMin: number; atMax: number; worst: number } {
  const ink = luminance(themeInk(state));
  return {
    atMin: ratio(ink, luma.min),
    atMax: ratio(ink, luma.max),
    worst: ratio(ink, Math.min(luma.max, Math.max(luma.min, ink))),
  };
}
