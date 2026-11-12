/* eslint-disable no-param-reassign -- `cloudRadiance` fills the caller's array */
// A cloud deck over the sky dome: per texel, the view ray hits a plane at cloud height, a three-octave value noise there is the
// deck's thickness, `cover` says how much of it is cloud, and a cloudy texel is the cloud's own radiance (lit by the sun through the
// air and by the sky, thinned for the thickness of the deck) in place of the sky behind it. One noise sample per octave per texel on
// the dome's small grid: no march, no texture, nothing per frame.
import { hash2 } from './noise';
import type { Weather } from './weather';

const smooth = (t: number): number => t * t * (3 - 2 * t);
const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return smooth(t);
};

/** 2D value noise in [0, 1). */
export function noise2(x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const u = smooth(x - cx);
  const v = smooth(y - cy);
  const a = hash2(cx, cy);
  const b = hash2(cx + 1, cy);
  const c = hash2(cx, cy + 1);
  const d = hash2(cx + 1, cy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Plane-projected texels per unit of ray slope, and the octave gain. */
const SCALE = 1.6;
/** Below this ray elevation (sine) the deck fades into the horizon haze. */
const HORIZON_FADE: readonly [number, number] = [0.02, 0.22];

/**
 * Cloud amount 0..1 along a ray with horizontal direction (`dx`, `dy`) and vertical sine `vz`. At cover 0 there is none and at 1
 * the sky is solid overcast; between, the noise thresholds into puffs with soft edges. `drift` offsets the pattern (the weather's
 * wind, in plane units).
 */
export function cloudAmount(dx: number, dy: number, vz: number, cover: number, drift = 0): number {
  if (cover <= 0 || vz <= 0) return 0;
  const px = (dx / (vz + 0.1)) * SCALE + drift;
  const py = (dy / (vz + 0.1)) * SCALE;
  let n = 0;
  let amp = 0.55;
  let f = 1;
  let norm = 0;
  for (let k = 0; k < 3; k += 1) {
    n += amp * noise2(px * f + k * 17.3, py * f + k * 5.1);
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  n /= norm;
  // cover 1 puts the threshold below every value: solid; cover 0 above every value: none.
  const thr = 1.05 - cover * 0.95;
  return smoothstep(thr - 0.12, thr + 0.12, n) * smoothstep(HORIZON_FADE[0], HORIZON_FADE[1], vz);
}

/**
 * The radiance of cloud, per unit of sun irradiance, for a sun at sine `sunSin` seen through `sunTrans` (the air's transmittance to
 * the sun) over a sky whose zenith radiance is `zenith`. A white scatterer (albedo 0.8): the sun's direct light, which thick cover
 * blocks (`cover` 1 passes a fifth), and the sky's, which it does not. Written into `out`.
 */
export function cloudRadiance(
  sunSin: number,
  sunTrans: readonly number[],
  zenith: readonly number[],
  cover: number,
  out: number[]
): void {
  const direct = (Math.max(sunSin, 0) / Math.PI) * (1 - 0.8 * cover);
  for (let i = 0; i < 3; i += 1) out[i] = 0.8 * (sunTrans[i] * direct + zenith[i]);
}

export const hasClouds = (w: Weather): boolean => w.cover > 0.02;
