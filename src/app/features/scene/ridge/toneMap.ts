// The one display transform of the ridge scene: linear scene radiance in, 8-bit sRGB out. Exposure, then the ACES fit of
// Stephen Hill (BakingLab, "ACES.hlsl": the sRGB-to-AP1 input matrix, the RRT and ODT rational fit, the AP1-to-sRGB output
// matrix), then the sRGB encode. A per-pixel function with no state, applied once to the baked sky (CPU: the scene is a 2D
// canvas, there is no float render target to fall back from).
//
// Exposure adapts to the sky's own luminance in every state (the sky is physical radiance, so brightness is the camera's); night
// adapts only in part (`Budget.partial`), so a new-moon night reads darker than a full-moon one. Before exposure a scotopic grade
// (`scotopic`: desaturation and a blue shift as the adapted luminance falls through the mesopic range) carries the night read. After
// ACES comes one more curve, per channel in display-linear: a monotone cubic through five knots, fitted per sky from the luminance
// distribution of the sky grid so that its 5th, 50th and 95th percentiles land on the state's target display luminances. The curve
// starts at a small black lift and ends at white, or at the state's ceiling when it has one. It is fitted on the sky grid alone: the
// cards are not sampled, they ride the same curve.
import type { FixedSkyState } from '../skyState';
import { SUN_LUX } from './nightSky';

type Rgb = readonly [number, number, number];

export const ACES_IN: readonly Rgb[] = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
];
export const ACES_OUT: readonly Rgb[] = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];
/** Hill's rational fit, `(v (v + a) - b) / (v (c v + d) + e)`: the display the lit cards share (`lightCards.ts` writes the same into its shader). */
export const ACES_FIT = [0.0245786, 0.000090537, 0.983729, 0.432951, 0.238081] as const;
const fit = (v: number): number =>
  (v * (v + ACES_FIT[0]) - ACES_FIT[1]) / (v * (ACES_FIT[2] * v + ACES_FIT[3]) + ACES_FIT[4]);
const encode = (l: number): number => {
  const c = Math.min(1, Math.max(0, l));
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
};

/** ACES (Hill's fit) of linear radiance `r, g, b` times `exposure`, to linear display RGB 0..1, written into `out`. */
export function acesLinear(r: number, g: number, b: number, exposure: number, out: number[]): void {
  const x = r * exposure;
  const y = g * exposure;
  const z = b * exposure;
  const p = [0, 1, 2].map((i) =>
    fit(Math.max(0, ACES_IN[i][0] * x + ACES_IN[i][1] * y + ACES_IN[i][2] * z))
  );
  for (let i = 0; i < 3; i += 1)
    out[i] = Math.min(
      1,
      Math.max(0, ACES_OUT[i][0] * p[0] + ACES_OUT[i][1] * p[1] + ACES_OUT[i][2] * p[2])
    );
}

/** Scotopic luminance of linear sRGB (Jensen et al. 2001, from CIE XYZ): the response of the rods, which see red as nearly black. */
export const scotopicLuminance = (r: number, g: number, b: number): number => {
  const X = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  return Math.max(0, Y * (1.33 * (1 + (Y + Z) / Math.max(X, 1e-30)) - 1.68));
};

/**
 * The scotopic grade of linear radiance `r, g, b` at weight `w` (0 photopic .. 1 scotopic): toward the rods' luminance in a blue-shifted grey. A neutral grey keeps its luminance, so the grade moves colour more than brightness. Written into `out`.
 * `lightCards.ts` writes the same into its shader.
 */
export function scotopic(r: number, g: number, b: number, w: number, out: number[]): void {
  if (w <= 0) {
    out[0] = r;
    out[1] = g;
    out[2] = b;
    return;
  }
  const v = scotopicLuminance(r, g, b);
  // Scale the rods' grey to the cones' luminance for a neutral, so only the colour is graded.
  const grey = scotopicLuminance(1, 1, 1);
  const k = v / grey;
  for (let i = 0; i < 3; i += 1) {
    const target = k * SCOTOPIC.tint[i];
    out[i] = [r, g, b][i] + (target - [r, g, b][i]) * w;
  }
}

/** How scotopic a sky is, 0..1, from its log-mean luminance per unit of sun irradiance: through the mesopic range (`SCOTOPIC`). */
export function scotopicWeight(meanLuma: number): number {
  const lg = Math.log10(Math.max(meanLuma * SUN_LUX, 1e-12));
  const [lo, hi] = SCOTOPIC.mesopic;
  const t = Math.min(1, Math.max(0, (lg - lo) / (hi - lo)));
  return SCOTOPIC.strength * (1 - t * t * (3 - 2 * t));
}

/** The 8-bit sRGB of linear radiance, exposed and tone-mapped. */
export function toneMap8(r: number, g: number, b: number, exposure: number, out: number[]): void {
  acesLinear(r, g, b, exposure, out);
  out[0] = Math.round(encode(out[0]));
  out[1] = Math.round(encode(out[1]));
  out[2] = Math.round(encode(out[2]));
}

/** WCAG relative luminance of linear display RGB. */
export const displayLuma = (c: ArrayLike<number>): number =>
  0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** What a sky state needs of its backdrop's display luminance, and the targets its curve is fitted to. */
export interface Budget {
  /** The darkest texel the curve can draw (its black lift, less one 8-bit step). */
  floor: number;
  /** What black is drawn as, display-linear: the curve's first knot. */
  lift: number;
  /** The lightest texel may not be lighter than this (light ink needs a dark one); it is the curve's top knot. 1: white. */
  ceiling: number;
  /** Display luminance the log-mean of the sky is exposed to before the curve; undefined: a fixed exposure. */
  key?: number;
  /** Exposure range, in multiples of scene radiance (per unit sun irradiance). */
  min: number;
  max: number;
  /** Display luminance the 5th, 50th and 95th percentile of the sky's luminance are mapped to. */
  targets: readonly [number, number, number];
  /**
   * Partial adaptation: the targets are scaled by `(meanLuma / ref) ^ (1 - exponent)` (clamped to `levelMin`..`levelMax`) where `meanLuma` is the sky's
   * log-mean luminance per unit of sun irradiance and `ref` the one the targets were set at. Exponent 1 is full adaptation (day, dusk).
   */
  partial?: { ref: number; exponent: number; levelMin: number; levelMax: number };
  /** The most the curve may steepen the sky's own spread about its median (display luminance per unit of ACES output): a nearly flat overcast sky is not blown up into a gradient. */
  maxGain: number;
}

/** The one absolute lift of day and dusk: what black is drawn as, display-linear. The rest of the range is made by the curve. */
export const BLACK_LIFT = 0.02;
/** Night's black lift: a little lower than day's, the darks stay soft rather than crushed. */
export const NIGHT_LIFT = 0.004;
/** The night's ceiling, display-linear: the top of its curve (1 is white). EYEBALLED: the operator tunes it by eye; the moon and the stars are drawn through the same display and need the room. */
export const NIGHT_CEILING = 1;

/**
 * The scotopic grade (Thompson, Shirley & Ferwerda 2002; Kirk & O'Brien 2011; Jensen et al. 2001): `strength` scales it (EYEBALLED, 0 off),
 * the mesopic range is log10 of the adapted luminance in cd/m^2 from `mesopic[0]` (fully scotopic) to `mesopic[1]` (fully photopic),
 * and `tint` is the blue shift of the scotopic luminance (Jensen et al.).
 */
export const SCOTOPIC = {
  strength: 1,
  mesopic: [-2, 0.5] as const,
  tint: [1.05, 0.97, 1.27] as const,
};

export const BUDGET: Record<FixedSkyState, Budget> = {
  day: { floor: BLACK_LIFT - 0.001, lift: BLACK_LIFT, ceiling: 1, key: 0.45, min: 4, max: 60, targets: [0.22, 0.58, 0.9], maxGain: 4 },
  dusk: { floor: BLACK_LIFT - 0.001, lift: BLACK_LIFT, ceiling: 1, key: 0.5, min: 4, max: 400, targets: [0.12, 0.45, 0.85], maxGain: 4 },
  night: {
    floor: NIGHT_LIFT - 0.001,
    lift: NIGHT_LIFT,
    ceiling: NIGHT_CEILING,
    // The key sits at the targets (not day's 0.45): the sky is exposed to where the curve wants it, so the curve is near the identity over it and
    // the per-channel curve does not blow a small colour difference (the scotopic blue shift) up into a saturated sky.
    key: 0.03,
    min: 4,
    max: 1e13,
    targets: [0.012, 0.03, 0.07],
    maxGain: 4,
    // A full-moon sky is about 2e-7 of the sun's irradiance in radiance; a moonless one about 2e-9. Partial adaptation of 0.7 puts
    // the second at about a quarter of the first.
    partial: { ref: 2e-7, exponent: 0.7, levelMin: 0.2, levelMax: 1.3 },
  },
};

/** Knots of the curve: black, the 5th, 50th, 95th percentile, white. */
export const KNOTS = 5;

/** A monotone piecewise-cubic Hermite curve over display-linear 0..1: knot positions, values and slopes. */
export interface Curve {
  x: number[];
  y: number[];
  m: number[];
}

/** The monotone cubic (Fritsch-Carlson, Brodlie's weighted harmonic mean) through strictly increasing `x` and non-decreasing `y`. */
export function makeCurve(x: number[], y: number[]): Curve {
  const n = x.length;
  const h = x.slice(1).map((v, i) => v - x[i]);
  const d = h.map((hk, i) => (y[i + 1] - y[i]) / hk);
  const m = new Array<number>(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k += 1) {
    if (d[k - 1] * d[k] <= 0) continue;
    const w1 = 2 * h[k] + h[k - 1];
    const w2 = h[k] + 2 * h[k - 1];
    m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
  }
  return { x, y, m };
}

/** The curve at `v` (clamped to 0..1). `lightCards.ts` writes the same evaluation into its shader. */
export function applyCurve(c: Curve, v: number): number {
  const t0 = Math.min(1, Math.max(0, v));
  let k = 0;
  for (let i = 1; i < c.x.length - 1; i += 1) if (t0 > c.x[i]) k = i;
  const h = c.x[k + 1] - c.x[k];
  const t = (t0 - c.x[k]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * c.y[k] +
    (t3 - 2 * t2 + t) * h * c.m[k] +
    (-2 * t3 + 3 * t2) * c.y[k + 1] +
    (t3 - t2) * h * c.m[k + 1]
  );
}

/** The display transform of a sky: exposure, then ACES, then the fitted curve in display-linear. */
export interface Display {
  exposure: number;
  curve: Curve;
  /** Weight of the scotopic grade before exposure, 0 (photopic, the default) .. 1 (`scotopicWeight`). */
  grade?: number;
}

/** The 8-bit sRGB of linear radiance through a display. */
export function display8(r: number, g: number, b: number, d: Display, out: number[]): void {
  if (d.grade) {
    scotopic(r, g, b, d.grade, out);
    acesLinear(out[0], out[1], out[2], d.exposure, out);
  } else acesLinear(r, g, b, d.exposure, out);
  for (let i = 0; i < 3; i += 1) out[i] = Math.round(encode(applyCurve(d.curve, out[i])));
}

const decode = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
/** Display luminance (WCAG relative, from the encoded bytes) of a radiance through a display. */
export function displayLumaOf(
  r: number,
  g: number,
  b: number,
  d: Display,
  tmp: number[] = [0, 0, 0]
): number {
  display8(r, g, b, d, tmp);
  return displayLuma([decode(tmp[0]), decode(tmp[1]), decode(tmp[2])]);
}

export interface Fit {
  display: Display;
  /** Darkest and lightest display luminance of the grid under `display`. */
  lo: number;
  hi: number;
  /** The exposure the state's key chose (the curve does the rest). */
  keyExposure: number;
}

/**
 * Choose the display of a sky, the one place brightness is decided. `hdr` is the grid's radiance (3 floats a texel) and `meanLuma` its
 * log-mean luminance. Exposure is the state's key (adaptation); the targets of a state with partial adaptation are scaled by the sky's level. The scotopic grade's weight comes from the sky's luminance. The curve is then fitted: the 5th, 50th and 95th percentile of the
 * grid's luminance after ACES go to the state's targets (the outer two held to the budget's `maxGain` times the sky's own spread about the median),
 * between a black lift below and white (or the night ceiling) above. Monotone by construction, so the ceiling holds for every texel
 * of every grid and card, and no pass over another viewport's grid is needed.
 */
export function fitDisplay(state: FixedSkyState, hdr: Float32Array, meanLuma: number): Fit {
  const b = BUDGET[state];
  const keyExposure =
    b.key === undefined
      ? b.min
      : Math.min(b.max, Math.max(b.min, (b.key * 1.6) / Math.max(meanLuma, 1e-9)));
  const n = hdr.length / 3;
  const tmp = [0, 0, 0];
  const xs: number[] = [];
  const grade = scotopicWeight(meanLuma);
  for (let i = 0; i < n; i += 1) {
    scotopic(hdr[i * 3], hdr[i * 3 + 1], hdr[i * 3 + 2], grade, tmp);
    acesLinear(tmp[0], tmp[1], tmp[2], keyExposure, tmp);
    xs.push(displayLuma(tmp));
  }
  xs.sort((p, q) => p - q);
  const pct = (q: number) => xs[Math.min(n - 1, Math.floor(q * n))];
  const x = [0, pct(0.05), pct(0.5), pct(0.95), 1];
  x[1] = Math.max(x[1], 1e-7);
  x[2] = Math.max(x[2], x[1] * 1.001 + 1e-7);
  x[3] = Math.max(x[3], x[2] * 1.001 + 1e-7);
  if (x[3] > 0.97) {
    x[3] = 0.97;
    x[2] = Math.min(x[2], 0.965);
    x[1] = Math.min(x[1], 0.96);
  }
  const p = b.partial;
  const level = p
    ? Math.min(p.levelMax, Math.max(p.levelMin, (Math.max(meanLuma, 1e-30) / p.ref) ** (1 - p.exponent)))
    : 1;
  const [t0, t1, t2] = b.targets.map((t) => t * level);
  const y = [
    b.lift,
    Math.max(b.lift + 1e-4, t0, t1 - b.maxGain * (x[2] - x[1])),
    t1,
    Math.min(b.ceiling - 1e-4, t2, t1 + b.maxGain * (x[3] - x[2])),
    b.ceiling,
  ];
  y[1] = Math.min(y[1], y[2] - 1e-4);
  y[3] = Math.max(y[3], y[2] + 1e-4);
  const display: Display = { exposure: keyExposure, curve: makeCurve(x, y), grade };
  let lo = 2;
  let hi = -1;
  const stride = Math.max(1, Math.floor(n / 4000));
  for (let i = 0; i < n; i += stride) {
    const l = displayLumaOf(hdr[i * 3], hdr[i * 3 + 1], hdr[i * 3 + 2], display, tmp);
    if (l < lo) lo = l;
    if (l > hi) hi = l;
  }
  return { display, lo, hi, keyExposure };
}
