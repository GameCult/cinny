// The one display transform of the ridge scene: linear scene radiance in, 8-bit sRGB out. Exposure, then the ACES fit of
// Stephen Hill (BakingLab, "ACES.hlsl": the sRGB-to-AP1 input matrix, the RRT and ODT rational fit, the AP1-to-sRGB output
// matrix), then the sRGB encode. A per-pixel function with no state, applied once to the baked sky (CPU: the scene is a 2D
// canvas, there is no float render target to fall back from).
//
// Exposure is chosen per sky state (`exposureFor`): the sky is physical radiance, so brightness is the camera's, not a
// shaping of the result. Day and dusk expose to the sky's own luminance (adaptation, as an eye or auto-exposure does) so the
// darkest of the sky stays where the state's dark ink needs a backdrop; night is fixed, the physical dark.
import type { FixedSkyState } from '../skyBand';

type Rgb = readonly [number, number, number];

const IN: readonly Rgb[] = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
];
const OUT: readonly Rgb[] = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];
const fit = (v: number): number => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
const encode = (l: number): number => {
  const c = Math.min(1, Math.max(0, l));
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
};

/** ACES (Hill's fit) of linear radiance `r, g, b` times `exposure`, to linear display RGB 0..1, written into `out`. */
export function acesLinear(r: number, g: number, b: number, exposure: number, out: number[]): void {
  const x = r * exposure;
  const y = g * exposure;
  const z = b * exposure;
  const p = [0, 1, 2].map((i) => fit(Math.max(0, IN[i][0] * x + IN[i][1] * y + IN[i][2] * z)));
  for (let i = 0; i < 3; i += 1) out[i] = Math.min(1, Math.max(0, OUT[i][0] * p[0] + OUT[i][1] * p[1] + OUT[i][2] * p[2]));
}

/** The 8-bit sRGB of linear radiance, exposed and tone-mapped. */
export function toneMap8(r: number, g: number, b: number, exposure: number, out: number[]): void {
  acesLinear(r, g, b, exposure, out);
  out[0] = Math.round(encode(out[0]));
  out[1] = Math.round(encode(out[1]));
  out[2] = Math.round(encode(out[2]));
}

/** WCAG relative luminance of linear display RGB. */
export const displayLuma = (c: ArrayLike<number>): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** What a sky state needs of its backdrop's display luminance, from the ink it wears (skyBand.ts, skyInk.ts). */
export interface Budget {
  /** The darkest texel may not be darker than this (dark ink needs a light backdrop). 0: no floor. */
  floor: number;
  /** The lightest texel may not be lighter than this (light ink needs a dark one). 1: no ceiling. */
  ceiling: number;
  /** Display luminance the log-mean of the sky is exposed to, before the budget is applied; undefined: a fixed exposure. */
  key?: number;
  /** Exposure range, in multiples of scene radiance (per unit sun irradiance). */
  min: number;
  max: number;
}

/** Display luminance slack for the 8-bit rounding and the smooth upscale of the baked grid. */
export const MARGIN = 0.004;

/**
 * Day and Dusk wear the same dark ink, so one floor: its bound plus margin, 0.4744, which is what the dark link needs (about 0.4554 for 4.5:1, skyTheme.test.ts); a lower day floor (0.317 was tried) leaves the link at 3.3:1. Night wears light ink, and its
 * dimmer foldout headers (L 0.386 on screen, rat-crest-a7c95ce-20261111) need a backdrop of at most 0.047.
 */
export const BUDGET: Record<FixedSkyState, Budget> = {
  day: { floor: 0.4744 + MARGIN, ceiling: 1, key: 0.45, min: 4, max: 60 },
  dusk: { floor: 0.4744 + MARGIN, ceiling: 1, key: 0.5, min: 4, max: 400 },
  night: { floor: 0, ceiling: 0.047 - MARGIN, key: 0.03, min: 8, max: 3000 },
};

/** The display transform of a sky: exposure, then ACES, then a black lift (veiling glare) in display-linear. */
export interface Display {
  exposure: number;
  /** Added to every channel after the curve, then rescaled so white stays white: out = lift + (1 - lift) * aces. */
  lift: number;
}

/** The 8-bit sRGB of linear radiance through a display. */
export function display8(r: number, g: number, b: number, d: Display, out: number[]): void {
  acesLinear(r, g, b, d.exposure, out);
  for (let i = 0; i < 3; i += 1) out[i] = Math.round(encode(d.lift + (1 - d.lift) * out[i]));
}

const decode = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
/** Display luminance (WCAG relative, from the encoded bytes) of a radiance through a display. */
export function displayLumaOf(r: number, g: number, b: number, d: Display, tmp: number[] = [0, 0, 0]): number {
  display8(r, g, b, d, tmp);
  return displayLuma([decode(tmp[0]), decode(tmp[1]), decode(tmp[2])]);
}

export interface Fit {
  display: Display;
  /** Darkest and lightest display luminance of the grid under `display`. */
  lo: number;
  hi: number;
  /** The exposure before the budget moved it, and what the budget took (for the numbers a report cites). */
  keyExposure: number;
}

/**
 * Choose the display of a sky, the one place brightness is decided. `hdr` is the grid's radiance (3 floats a texel) and
 * `meanLuma` its log-mean luminance. Exposure starts at the state's key (adaptation); a ceiling lowers it until the
 * lightest texel is inside the budget (bisection: luminance is monotone in exposure); a floor raises the black lift until the
 * darkest is (luminance is monotone in lift, and linear: the lift needed is solved in one step).
 */
export function fitDisplay(state: FixedSkyState, hdr: Float32Array, meanLuma: number): Fit {
  const b = BUDGET[state];
  const keyExposure =
    b.key === undefined ? b.min : Math.min(b.max, Math.max(b.min, (b.key * 1.6) / Math.max(meanLuma, 1e-9)));
  const n = hdr.length / 3;
  const stride = Math.max(1, Math.floor(n / 4000));
  const tmp = [0, 0, 0];
  const range = (d: Display) => {
    let lo = 2;
    let hi = -1;
    for (let i = 0; i < n; i += stride) {
      const l = displayLumaOf(hdr[i * 3], hdr[i * 3 + 1], hdr[i * 3 + 2], d, tmp);
      if (l < lo) lo = l;
      if (l > hi) hi = l;
    }
    return { lo, hi };
  };
  let exposure = keyExposure;
  let r = range({ exposure, lift: 0 });
  if (r.hi > b.ceiling) {
    let lo = 0;
    let hiE = exposure;
    for (let k = 0; k < 24; k += 1) {
      const mid = (lo + hiE) / 2;
      if (range({ exposure: mid, lift: 0 }).hi > b.ceiling) hiE = mid;
      else lo = mid;
    }
    exposure = lo;
    r = range({ exposure, lift: 0 });
  }
  let lift = 0;
  if (r.lo < b.floor) {
    // Linear in the displayed linear luminance: L' = lift + (1 - lift) L, but through the 8-bit encode; solve in linear then check once.
    lift = (b.floor - r.lo) / (1 - r.lo);
    let probe = range({ exposure, lift });
    for (let k = 0; k < 6 && probe.lo < b.floor; k += 1) {
      lift += (b.floor - probe.lo) * 1.05;
      probe = range({ exposure, lift });
    }
    r = probe;
  }
  return { display: { exposure, lift }, lo: r.lo, hi: r.hi, keyExposure };
}
