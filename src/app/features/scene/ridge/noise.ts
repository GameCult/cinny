// CultMath's value noise and fbm on the CPU, in one dimension and periodic. Clean-room: the
// algorithm is read from shaders/CultMath.glsl (`cultmath_hash`, `cultmath_value_noise`), not copied
// from any other terrain. Doubles instead of floats, so values differ from the GLSL in the last
// digits; nothing here has to match a shader.

const frac = (v: number): number => v - Math.floor(v);

/** `cultmath_hash(vec2)`. */
export const hash2 = (x: number, y: number): number =>
  frac(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);

const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * `cultmath_value_noise` along row `row` of the lattice, with the lattice wrapping every `period`
 * cells: noise(x + period) === noise(x). `row` is an integer, so the vertical blend of the 2D
 * original is the identity.
 */
export function valueNoisePeriodic(x: number, row: number, period: number): number {
  const cell = Math.floor(x);
  const u = smooth(x - cell);
  const wrap = (c: number) => ((c % period) + period) % period;
  const a = hash2(wrap(cell), row);
  const b = hash2(wrap(cell + 1), row);
  return a + (b - a) * u;
}

export interface FbmShape {
  octaves: number;
  lacunarity: number;
  gain: number;
}

/**
 * Fractal sum in [0, 1]. `t` runs 0..1 across one period; the first octave has `baseCells` cells
 * per period and each next one `lacunarity` times more, so `baseCells * lacunarity^k` must be an
 * integer for the sum to be periodic (checked by the caller's config, not here).
 */
export function fbmPeriodic(t: number, row: number, baseCells: number, s: FbmShape): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let cells = baseCells;
  for (let k = 0; k < s.octaves; k += 1) {
    sum += amp * valueNoisePeriodic(t * cells, row + k * 13, cells);
    norm += amp;
    amp *= s.gain;
    cells *= s.lacunarity;
  }
  return sum / norm;
}
