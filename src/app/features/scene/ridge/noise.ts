// CultMath's value noise on the CPU, in one dimension, over the whole line (no period). Clean-room:
// the algorithm is read from shaders/CultMath.glsl (`cultmath_hash`, `cultmath_value_noise`), not
// copied from any other terrain. Doubles instead of floats, so values differ from the GLSL in the
// last digits; nothing here has to match a shader.

const frac = (v: number): number => v - Math.floor(v);

/** `cultmath_hash(vec2)`. */
export const hash2 = (x: number, y: number): number =>
  frac(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);

const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * `cultmath_value_noise` along row `row` of the lattice, in [0, 1). `row` is an integer, so the
 * vertical blend of the 2D original is the identity. The lattice is hashed per cell, never wrapped:
 * a ridge is a function of world-x, with no period for the eye to find.
 */
export function valueNoise(x: number, row: number): number {
  const cell = Math.floor(x);
  const u = smooth(x - cell);
  const a = hash2(cell, row);
  const b = hash2(cell + 1, row);
  return a + (b - a) * u;
}
