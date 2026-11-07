// Every number of the ridge scene, and the pure functions that turn them into silhouettes. No DOM.
import { fbmPeriodic, FbmShape } from './noise';
import type { Srgb, SkyColours } from './skyColour';

export interface LayerSpec {
  /** 0 farthest. Also the noise row, so layers never share a profile. */
  index: number;
  /** Lattice cells across one period for the first octave; the fbm octaves scale it by `lacunarity`. */
  baseCells: number;
  /** Peak-to-valley height of the silhouette, as a fraction of the layer band. */
  relief: number;
  /** 0 hills (plain fbm) .. 1 crags (ridged: 1 - |2n - 1|). */
  crag: number;
  /** Ridge top at its lowest point, fraction of the viewport height up from the bottom. */
  base: number;
  /** 0 = the layer is the horizon haze, 1 = the nearest ground colour. */
  depth: number;
  /** Seconds for the layer to drift one period. Farther layers are slower. */
  seconds: number;
}

/** Four layers. `lacunarity` 2 with these base cell counts keeps every octave an integer. */
export const LAYERS: readonly LayerSpec[] = [
  { index: 0, baseCells: 3, relief: 0.24, crag: 0.8, base: 0.34, depth: 0.12, seconds: 420 },
  { index: 1, baseCells: 4, relief: 0.2, crag: 0.55, base: 0.26, depth: 0.38, seconds: 300 },
  { index: 2, baseCells: 5, relief: 0.16, crag: 0.3, base: 0.17, depth: 0.66, seconds: 210 },
  { index: 3, baseCells: 6, relief: 0.12, crag: 0.1, base: 0.08, depth: 1, seconds: 150 },
];

export const FBM: FbmShape = { octaves: 5, lacunarity: 2, gain: 0.5 };

/** Silhouette height in [0, 1] at `t` (0..1 across one period); periodic in t. */
export function profile(spec: LayerSpec, t: number): number {
  const n = fbmPeriodic(t, spec.index * 101, spec.baseCells, FBM);
  const crag = 1 - Math.abs(2 * n - 1);
  return n + (crag - n) * spec.crag;
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
 * Alpha of the warm sun-side in-scatter at `t` (0..1 across one period; periodic). Zero when the sky has
 * no sun; grows with distance, peaks at the sun's azimuth.
 */
export function scatterAlpha(spec: LayerSpec, sky: SkyColours, t: number): number {
  if (sky.sunAzimuth === undefined) return 0;
  const lobe = 0.5 + 0.5 * Math.cos(2 * Math.PI * (t - sky.sunAzimuth));
  return AERIAL.scatter * (1 - transmittance(spec)) * lobe * lobe;
}

/** Integer pixel sizes of a layer for a viewport: one period wide, twice that painted, so a drift of one period loops. */
export function layerSize(cssW: number, cssH: number, scale: number) {
  const period = Math.round(cssW * scale);
  const band = Math.round(cssH * scale * 0.6);
  return { period, width: period * 2, height: band };
}

/** Ridge-top y (canvas pixels, from the top of the layer's band) for pixel column x. */
export function ridgeY(
  spec: LayerSpec,
  x: number,
  period: number,
  bandH: number,
  viewH: number
): number {
  const amp = spec.relief * viewH;
  const bottomOffset = spec.base * viewH; // lowest the top sits above the viewport bottom
  const topFromBottom = bottomOffset + amp * profile(spec, (x % period) / period);
  return bandH - Math.min(bandH, topFromBottom);
}
