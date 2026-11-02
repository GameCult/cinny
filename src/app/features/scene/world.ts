// The scene's world constants. One owner: the shader prelude below is generated from this
// object, so a number lives here and nowhere else, and the Lipschitz bounds that make the
// sphere-trace step safe are computed beside the numbers they bound.

// Lipschitz constant of cultmath_snoise(vec3), CULTMATH_SNOISE_LIPSCHITZ in the vendored
// CultMath.glsl (provenance in CultLib math.Interval.cs).
export const SNOISE_LIPSCHITZ = 7.9640074;

export const WORLD = {
  far: 1400,
  // Terrain: height = mask(r) * (amp * fbm(xz * freq) + erodeAmp * phacelle(xz * erodeFreq)).
  amp: 70,
  freq: 1 / 520,
  octaves: 4,
  lacunarity: 2.0,
  gain: 0.45,
  // Flat ground (height 0) out to plateauInner, full terrain from plateauOuter. The login
  // camera stays inside plateauInner, so it can never end up inside the terrain.
  plateauInner: 135,
  plateauOuter: 380,
  erodeAmp: 2.5,
  erodeFreq: 1 / 38,
  // The stripe wave vector and normalization the terrain feeds cultmath_phacelle.
  erodeSide: [1.7, 0, 1] as const,
  erodeNorm: 0.5,
  // Bound on |grad| of the phasor's cos component for the side and norm above. Libby measured a
  // sup of 6.63 at |side| = 1.5, n = 0 (CultLib PR #1 head 990521b3); 7.0 adds margin.
  // The sup was measured, not proved. The
  // shader passes roughness n = 0 as a literal, so the doc envelope max(10, 1.25|side|)/(1-n)
  // needs no 1/(1-n) factor here; if n ever becomes nonzero, divide this bound by (1 - n).
  // |value| <= 1 holds by construction (the output is a normalized phasor).
  // Typed number, not the literal 7, so callers can build variants such as { ...WORLD, phacelleGradBound: 0 }.
  phacelleGradBound: 7.0 as number,
  // World tree at the origin.
  tree: {
    trunkHeight: 38,
    baseRadius: 3.4,
    topRadius: 1.9,
    canopyY: 52,
    canopyRadius: [30, 17, 30] as const,
  },
  // Atmosphere.
  atmosphereFar: 1400,
  cloudBase: 130,
  cloudTop: 230,
  fogDensity: 0.0028,
  fogFalloff: 0.011,
} as const;

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/** Sum over octaves of (lacunarity * gain)^i: the slope bound's octave factor. */
function slopeSum(octaves: number, lacunarity: number, gain: number): number {
  let s = 0;
  for (let i = 0; i < octaves; i += 1) s += (lacunarity * gain) ** i;
  return s;
}

/** Sum over octaves of gain^i: the fbm value bound. */
function valueSum(octaves: number, gain: number): number {
  let s = 0;
  for (let i = 0; i < octaves; i += 1) s += gain ** i;
  return s;
}

export interface TerrainBounds {
  /** Lipschitz bound of the envelope surface (no erosion). */
  slopeEnvelope: number;
  /** Lipschitz bound of the eroded surface. */
  slopeFull: number;
  /** Highest point the terrain can reach. */
  maxHeight: number;
}

export function terrainBounds(w: typeof WORLD = WORLD): TerrainBounds {
  const fbmMax = valueSum(w.octaves, w.gain);
  const maskSlope = 1.5 / (w.plateauOuter - w.plateauInner); // smoothstep's max slope
  const fbmSlope = w.amp * w.freq * SNOISE_LIPSCHITZ * slopeSum(w.octaves, w.lacunarity, w.gain);
  const slopeEnvelope = fbmSlope + (w.amp * fbmMax + w.erodeAmp) * maskSlope;
  const slopeFull = slopeEnvelope + w.erodeAmp * w.erodeFreq * w.phacelleGradBound;
  return { slopeEnvelope, slopeFull, maxHeight: w.amp * fbmMax + w.erodeAmp };
}

/** The #defines every stage sees. */
export function worldDefines(w: typeof WORLD = WORLD): string {
  const b = terrainBounds(w);
  const t = w.tree;
  const lines: Array<[string, string]> = [
    ['W_FAR', f(w.far)],
    ['W_AMP', f(w.amp)],
    ['W_FREQ', f(w.freq)],
    ['W_OCTAVES', String(w.octaves)],
    ['W_LACUNARITY', f(w.lacunarity)],
    ['W_GAIN', f(w.gain)],
    ['W_PLATEAU_IN', f(w.plateauInner)],
    ['W_PLATEAU_OUT', f(w.plateauOuter)],
    ['W_ERODE_AMP', f(w.erodeAmp)],
    ['W_ERODE_FREQ', f(w.erodeFreq)],
    ['W_ERODE_SIDE', `vec3(${w.erodeSide.map(f).join(', ')})`],
    ['W_ERODE_NORM', f(w.erodeNorm)],
    ['W_ERODE_ENABLED', w.phacelleGradBound > 0 ? '1' : '0'],
    ['W_SLOPE_ENV_INV', f(1 / Math.sqrt(1 + b.slopeEnvelope ** 2))],
    ['W_SLOPE_FULL_INV', f(1 / Math.sqrt(1 + b.slopeFull ** 2))],
    ['W_MAX_HEIGHT', f(Math.max(b.maxHeight, t.canopyY + t.canopyRadius[1] + 6))],
    ['W_TRUNK_H', f(t.trunkHeight)],
    ['W_TRUNK_R0', f(t.baseRadius)],
    ['W_TRUNK_R1', f(t.topRadius)],
    ['W_CANOPY_Y', f(t.canopyY)],
    ['W_CANOPY_R', `vec3(${t.canopyRadius.map(f).join(', ')})`],
    ['W_ATM_FAR', f(w.atmosphereFar)],
    ['W_CLOUD_Y0', f(w.cloudBase)],
    ['W_CLOUD_Y1', f(w.cloudTop)],
    ['W_FOG_DENSITY', f(w.fogDensity)],
    ['W_FOG_FALLOFF', f(w.fogFalloff)],
  ];
  return lines.map(([k, v]) => `#define ${k} ${v}`).join('\n');
}
