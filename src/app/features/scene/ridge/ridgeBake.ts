/* eslint-disable no-param-reassign -- `bakeSlice` fills the caller's pixel buffer */
// The pixels of a ridge chunk, as a pure function: no DOM, no canvas. Each column is lit from the
// slope of the heightfield's crest line against the sun; the face under it takes a light-to-haze
// gradient, erosion streaks and a lit rim on the crest. The depth treatment (colour, haze, contrast
// by distance) is ridgeWorld's `layerColour`, `hazeColour` and `transmittance`, used here and not redone.
import { gullyAt, LayerSpec, profile, hazeColour, layerColour, transmittance } from './ridgeWorld';
import type { SkyBand } from '../skyBand';
import { LUMA, SKY_BAND } from '../skyBand';
import type { SkyColours, Srgb } from './skyColour';

export type Vec3 = readonly [number, number, number];

/** Unit vector toward the sun: x across the screen (from the azimuth), y up, z toward the viewer. */
export function sunDirection(sky: SkyColours): Vec3 {
  const az = sky.sunAzimuth ?? 0.3;
  const x = 0.9 * Math.sin(2 * Math.PI * az);
  const l = Math.hypot(x, 0.35, 0.45);
  return [x / l, 0.35 / l, 0.45 / l];
}

/** How steeply the crest's slope tilts the face's normal sideways. */
const TILT = 1.2;

/**
 * Sun light on the face under a crest whose silhouette has `slope` (rows per column, positive when the
 * crest rises toward +x, so the face looks toward -x). 0 in full shadow .. 1 head-on to the sun.
 */
export function faceLight(slope: number, sun: Vec3): number {
  const nx = -slope * TILT;
  const inv = 1 / Math.hypot(nx, 0.55, 0.85);
  const d = (nx * sun[0] + 0.55 * sun[1] + 0.85 * sun[2]) * inv;
  return Math.min(1, Math.max(0, (d - 0.2) / 0.7));
}

export interface BakeParams {
  spec: LayerSpec;
  sky: SkyColours;
  /** Pixels in one viewport width: the unit of world-x. */
  period: number;
  /** CSS px to canvas px. */
  scale: number;
  /** Viewport height in canvas px. */
  viewH: number;
  /** Rows of the pixel buffer (the band plus any padding below it). */
  rows: number;
  /** Row count of the visible band; the crest is measured from the top of it. */
  bandH: number;
  /** World pixel of the buffer's column 0 (may be fractional-free negative: a chunk's left minus its padding). */
  px0: number;
  /** Columns of the buffer. */
  cols: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const SUN_WHITE: Srgb = [255, 238, 205];

/** Everything `bakeSlice` needs per layer, computed once. */
export interface LayerPaint {
  /** The state's band as a shift of linear light (raises the floor, lowers the ceiling); null when the sky has none. */
  shift: BandShift | null;
  base: Srgb;
  haze: Srgb;
  warm: Srgb;
  contrast: number;
  sun: Vec3;
}

const decode = (v: number): number => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const DECODE = Float32Array.from({ length: 256 }, (_, v) => decode(v));
const ENCODE_STEPS = 4095;
const ENCODE = Uint8ClampedArray.from({ length: ENCODE_STEPS + 1 }, (_, i) => {
  const l = i / ENCODE_STEPS;
  return 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
});
/** What the band is held clear of at its edges: the 8-bit rounding and the blur and in-scatter the chunk takes after the bake. */
const BAND_MARGIN = 0.012;

/** Linear light out = in * `scale` + `add[channel]`. */
export interface BandShift {
  add: readonly [number, number, number];
  scale: number;
}

/**
 * The state's band (skyBand.ts) as a shift of linear light, solved once per layer. Adding `add` (the zenith colour, so
 * the ridge reads as shadowed by the sky above, a hue apart from the horizon behind it) raises every pixel's
 * luminance by exactly the floor, so the face keeps its whole gradient and the darkest pixel is on the floor; scaling by
 * `scale` puts the lightest pixel on the ceiling. Smooth in the pixel's own luminance: no cut and no region.
 * The floor is the text bound (Day's), not Dusk's higher link bound: the link ink is not set on ridges, and Dusk's
 * floor washes the faces to a flat pale slab.
 */
export function bandShift(band: SkyBand | undefined, lift: Srgb): BandShift | null {
  if (!band) return null;
  const floor = Math.min(band.floor, SKY_BAND.day.floor);
  const scale = band.ceiling < 1 ? band.ceiling - BAND_MARGIN / 3 : 1;
  if (floor <= 0 && scale === 1) return null;
  const lin = lift.map(decode);
  const k =
    floor > 0
      ? (floor + BAND_MARGIN) / (LUMA[0] * lin[0] + LUMA[1] * lin[1] + LUMA[2] * lin[2])
      : 0;
  return { add: [lin[0] * k, lin[1] * k, lin[2] * k], scale };
}

export function layerPaint(spec: LayerSpec, sky: SkyColours): LayerPaint {
  const warm: Srgb = [
    (sky.horizon[0] + SUN_WHITE[0]) / 2,
    (sky.horizon[1] + SUN_WHITE[1]) / 2,
    (sky.horizon[2] + SUN_WHITE[2]) / 2,
  ];
  return {
    shift: bandShift(sky.band, sky.top),
    base: layerColour(spec, sky),
    haze: hazeColour(sky),
    warm,
    // Distance flattens relief: the same transmittance that thins the colour.
    contrast: 0.35 + 0.65 * transmittance(spec),
    sun: sunDirection(sky),
  };
}

/** Crest row (float, from the top of the band) of every buffer column from c0 - 1 to c1 (inclusive). */
function crestRows(p: BakeParams, c0: number, c1: number): Float64Array {
  const out = new Float64Array(c1 - c0 + 2);
  const amp = p.spec.relief * p.viewH;
  const lift = p.spec.base * p.viewH;
  for (let c = c0 - 1; c <= c1; c += 1) {
    const top = Math.min(p.bandH, lift + amp * profile(p.spec, (p.px0 + c) / p.period));
    out[c - c0 + 1] = p.bandH - top;
  }
  return out;
}

/**
 * Paint columns [c0, c1) of the chunk into `out` (RGBA, `p.cols` wide, `p.rows` tall, zeroed). One
 * call is a slice of a chunk, so a caller can keep each task short. Seams are exact: a column's pixels
 * depend only on its world pixel, never on where the slice or chunk begins.
 */
export function bakeSlice(
  out: Uint8ClampedArray,
  p: BakeParams,
  paint: LayerPaint,
  c0: number,
  c1: number
): void {
  const { spec } = p;
  const crest = crestRows(p, c0, c1);
  const faceH = 0.45 * p.viewH;
  const rim = 2.2 * p.scale;
  const glow = 9 * p.scale;
  const { base, haze, warm, contrast, sun, shift } = paint;
  for (let c = c0; c < c1; c += 1) {
    const cy = crest[c - c0 + 1];
    const slope = (crest[c - c0 + 2] - crest[c - c0]) * -0.5; // rows up per column
    const lit = faceLight(slope, sun);
    const steep = 0.45 + 0.55 * clamp01(Math.abs(slope) * 0.8);
    const gl = gullyAt(spec, (p.px0 + c) / p.scale) * steep;
    const y0 = Math.max(0, Math.floor(cy));
    for (let y = y0; y < p.rows; y += 1) {
      const d = y + 0.5 - cy;
      const dn = clamp01(d / faceH);
      const cover = clamp01(y + 1 - cy);
      const gully = spec.gully * gl * smoothstep(0, 0.2, dn);
      // Shade the ground colour by the sun; the lit warm light fades down the face and in the gullies.
      // Volume from the depth below the crest: the face darkens toward its foot (before the mist lifts it
      // toward the haze), and the sun catches its top. A few multiplies per pixel, in the bake only.
      const foot = 1 - 0.4 * contrast * smoothstep(0.05, 0.9, dn);
      const top = 1 - smoothstep(0, 0.3, dn);
      const shade = (0.7 + 0.3 * lit * contrast + 0.3 * (1 - contrast)) * (1 - 0.5 * gully) * foot;
      const warmK =
        0.22 * contrast * lit * lit * (1 - 0.7 * dn) * (1 - 0.6 * gully) +
        0.04 * contrast * lit * top;
      // A hard 2 px lip on the crest and a soft glow under it.
      const rimK =
        (clamp01(1 - d / rim) * 0.4 + (d < glow * 5 ? Math.exp(-d / glow) * 0.08 : 0)) *
        contrast *
        (0.3 + 0.7 * lit);
      const mist = spec.mist * smoothstep(0, 1, dn);
      const o = (y * p.cols + c) * 4;
      for (let i = 0; i < 3; i += 1) {
        let v = base[i] * shade + warm[i] * (warmK + rimK);
        v += (haze[i] - v) * mist;
        out[o + i] = shift
          ? ENCODE[
              Math.min(
                ENCODE_STEPS,
                ((DECODE[v >= 255 ? 255 : v <= 0 ? 0 : Math.round(v)] * shift.scale +
                  shift.add[i]) *
                  ENCODE_STEPS) |
                  0
              )
            ]
          : v;
      }
      out[o + 3] = cover * 255;
    }
  }
}
