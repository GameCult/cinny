// Every number of the ridge scene, and the pure functions that turn them into silhouettes. No DOM.
// A ridge is a function of world-x (t, in viewport widths): ridged multifractal noise, domain-warped,
// one function for every layer with the parameters below. Nothing in it repeats.
import { valueNoise } from './noise';
import type { Srgb, SkyColours } from './skyColour';

export interface LayerSpec {
  /** 0 farthest. Also the noise row, so layers never share a profile. */
  index: number;
  /** Lattice cells per viewport width for the first octave; each octave multiplies it by LACUNARITY. */
  baseCells: number;
  /** Peak-to-valley height of the silhouette, as a fraction of the viewport height. */
  relief: number;
  /** 0 rounded hills .. 1 sharp crags: how tightly each octave is folded at its crest. */
  crag: number;
  /** Ridge top at its lowest point, fraction of the viewport height up from the bottom. */
  base: number;
  /** 0 = the layer is the horizon haze, 1 = the nearest ground colour. */
  depth: number;
  /** Seconds for the layer to drift one viewport width. Farther layers are slower. */
  seconds: number;
  /** Octaves of the ridged multifractal; the bake cost is linear in it. */
  octaves: number;
  /** Domain warp, in cells of the first octave. */
  warp: number;
  /** 0..1 depth of the erosion streaks down the face. */
  gully: number;
  /** Width of one gully, CSS px. */
  gullyPx: number;
  /** 0..1 how far the foot of the face dissolves into the valley mist. */
  mist: number;
}

/** Four layers: one function, four parameter rows. */
export const LAYERS: readonly LayerSpec[] = [
  {
    index: 0,
    baseCells: 2.2,
    relief: 0.24,
    crag: 0.85,
    base: 0.34,
    depth: 0.12,
    seconds: 420,
    octaves: 5,
    warp: 0.6,
    gully: 0.3,
    gullyPx: 16,
    mist: 0.35,
  },
  {
    index: 1,
    baseCells: 3.0,
    relief: 0.2,
    crag: 0.7,
    base: 0.26,
    depth: 0.38,
    seconds: 300,
    octaves: 5,
    warp: 0.55,
    gully: 0.5,
    gullyPx: 20,
    mist: 0.3,
  },
  {
    index: 2,
    baseCells: 3.8,
    relief: 0.16,
    crag: 0.5,
    base: 0.17,
    depth: 0.66,
    seconds: 210,
    octaves: 5,
    warp: 0.5,
    gully: 0.6,
    gullyPx: 24,
    mist: 0.22,
  },
  {
    index: 3,
    baseCells: 4.6,
    relief: 0.12,
    crag: 0.3,
    base: 0.08,
    depth: 1,
    seconds: 150,
    octaves: 4,
    warp: 0.45,
    gully: 0.7,
    gullyPx: 30,
    mist: 0.16,
  },
];

/** Not an integer power of two, so no octave's lattice lines up with another's. */
export const LACUNARITY = 2.07;
/** Each octave is weighted by the previous octave's folded signal, times this, clamped to 1. */
export const WEIGHT_GAIN = 2;
const AMP_GAIN = 0.5;
/** Calibration: the weighted sum's typical top is about 1 / this. */
const PEAK_NORM = 1.25;

/** Silhouette height in [0, 1] at world-x `t` (viewport widths); defined for every real t. */
export function profile(spec: LayerSpec, t: number): number {
  const row = spec.index * 101;
  const wt =
    t + (spec.warp * (2 * valueNoise(t * spec.baseCells * 0.7, row + 97) - 1)) / spec.baseCells;
  const e = 0.03 + (1 - spec.crag) * 0.4;
  const top = Math.sqrt(1 + e * e);
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let f = spec.baseCells;
  let w = 1;
  for (let k = 0; k < spec.octaves; k += 1) {
    const v = 2 * valueNoise(wt * f, row + k * 13) - 1;
    // Fold: 1 at the zero crossing of the noise, 0 at its extremes; `e` rounds the crease.
    let sig = 1 - Math.sqrt(v * v + e * e) / top;
    sig *= sig;
    sig *= w;
    w = Math.min(1, sig * WEIGHT_GAIN);
    sum += sig * amp;
    norm += amp;
    amp *= AMP_GAIN;
    f *= LACUNARITY;
  }
  // A soft swell under the folds, so the valleys between sharp crests are not flat floors.
  const swell = valueNoise(wt * spec.baseCells * 0.6, row + 211);
  return Math.min(1, 0.85 * (sum / norm) * PEAK_NORM + 0.15 * swell);
}

/** Erosion streak strength in [0, 1] at world-x `wxCss` (CSS px): a folded noise at gully width. */
export function gullyAt(spec: LayerSpec, wxCss: number): number {
  const g = 1 - Math.abs(2 * valueNoise(wxCss / spec.gullyPx, spec.index * 131 + 5) - 1);
  return g * g;
}

/** The distance haze the far layers dissolve into: between the mid sky and the horizon, not the horizon glow itself. */
export function hazeColour(sky: SkyColours): Srgb {
  const m = (a: number, b: number) => Math.round(a + (b - a) * 0.4);
  return [
    m(sky.mid[0], sky.horizon[0]),
    m(sky.mid[1], sky.horizon[1]),
    m(sky.mid[2], sky.horizon[2]),
  ];
}

/**
 * Aerial perspective, applied once at bake time. A layer at distance d (0 nearest, 1 farthest) is seen
 * through Beer-Lambert transmittance T = exp(-extinction * d): it shows T of its own colour and 1 - T of
 * the haze, then loses `desaturate * (1 - T)` of its chroma, is softened by up to `blurPx` (canvas
 * pixels at scale 1) and takes a faint warm in-scatter of at most `scatter` on the sun side.
 */
export const AERIAL = { extinction: 1.6, desaturate: 0.5, blurPx: 2, scatter: 0.16 };

/** Distance of a layer from the viewer, 0 (nearest) .. 1 (farthest). */
export const layerDistance = (spec: LayerSpec): number => 1 - spec.depth;

export const transmittance = (spec: LayerSpec): number =>
  Math.exp(-AERIAL.extinction * layerDistance(spec));

/** Layer colour as seen: its own ground colour thinned by the haze between it and the eye. */
export function layerColour(spec: LayerSpec, sky: SkyColours): Srgb {
  const h = hazeColour(sky);
  const t = transmittance(spec);
  const seen = (i: number) => sky.ground[i] * t + h[i] * (1 - t);
  const luma = 0.2126 * seen(0) + 0.7152 * seen(1) + 0.0722 * seen(2);
  const keep = 1 - AERIAL.desaturate * (1 - t);
  const out = (i: number) => Math.round(luma + (seen(i) - luma) * keep);
  return [out(0), out(1), out(2)];
}

/** Edge softening for a layer, in canvas pixels at scale 1; 0 for the nearest. */
export const edgeBlur = (spec: LayerSpec): number => AERIAL.blurPx * (1 - transmittance(spec));

/**
 * Alpha of the warm sun-side in-scatter at world-x `t` (viewport widths). Zero when the sky has no
 * sun; grows with distance. The lobe is the product of two cosines with incommensurate wavelengths
 * (1.9 and 1.9 * golden ratio), so it is not periodic; its peaks are where the sun's azimuth puts them.
 */
export function scatterAlpha(spec: LayerSpec, sky: SkyColours, t: number): number {
  if (sky.sunAzimuth === undefined) return 0;
  const a = 0.5 + 0.5 * Math.cos(2 * Math.PI * (t / 1.9 - sky.sunAzimuth));
  const b = 0.75 + 0.25 * Math.cos((2 * Math.PI * t) / (1.9 * 1.618034));
  return AERIAL.scatter * (1 - transmittance(spec)) * a * a * b;
}

/** Chunk width as a multiple of the viewport width: room for the yaw sway on top of the viewport. */
export const CHUNK_OVER = 1.2;

/**
 * Integer pixel sizes for a viewport. `period` is one viewport width, the unit of world-x; a chunk
 * is `chunk` pixels of world, `height` the band a layer is painted in.
 */
export function layerSize(cssW: number, cssH: number, scale: number) {
  const period = Math.round(cssW * scale);
  const band = Math.round(cssH * scale * 0.6);
  return { period, chunk: Math.round(period * CHUNK_OVER), height: band };
}

/** Ridge-top y (canvas pixels, from the top of the layer's band) at world-x `t` (viewport widths). */
export function ridgeY(spec: LayerSpec, t: number, bandH: number, viewH: number): number {
  const topFromBottom = spec.base * viewH + spec.relief * viewH * profile(spec, t);
  return bandH - Math.min(bandH, topFromBottom);
}
