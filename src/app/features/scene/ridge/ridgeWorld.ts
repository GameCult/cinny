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

/** Layer colour: the haze for depth 0, the ground colour for depth 1, mixed in sRGB. */
export function layerColour(spec: LayerSpec, sky: SkyColours): Srgb {
  const h = hazeColour(sky);
  const m = (a: number, b: number) => Math.round(a + (b - a) * spec.depth);
  return [m(h[0], sky.ground[0]), m(h[1], sky.ground[1]), m(h[2], sky.ground[2])];
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
