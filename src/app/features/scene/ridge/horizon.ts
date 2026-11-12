// The terrain horizon seen from the viewpoint, baked from open DEM by `scripts/bake-horizon.py` (source, licence and attribution are
// in the file's `source` block and in `HORIZON_ATTRIBUTION`).
import bake from './viennaHorizon.json';

export const HORIZON_ATTRIBUTION = bake.source.attribution;

const N = bake.elevationDeg.length;

/** Index pair and weight of an azimuth (degrees clockwise from north) on the baked ring. */
function at(azimuth: number): [number, number, number] {
  const f = (((azimuth / bake.stepDeg) % N) + N) % N;
  const i = Math.floor(f);
  return [i, (i + 1) % N, f - i];
}

const lerp = (arr: readonly number[], az: number): number => {
  const [a, b, t] = at(az);
  return arr[a] * (1 - t) + arr[b] * t;
};

/** Elevation of the horizon, degrees above the astronomical horizon, at an azimuth. */
export const horizonElevation = (azimuth: number): number => lerp(bake.elevationDeg, azimuth);

/** Distance of the terrain that sets the horizon, km. */
export const horizonDistanceKm = (azimuth: number): number => lerp(bake.distanceKm, azimuth);

/** Unit surface normal of the terrain at the horizon point: x east, y up, z north. */
export function horizonNormal(azimuth: number): [number, number, number] {
  const e = lerp(bake.slopeEast, azimuth);
  const n = lerp(bake.slopeNorth, azimuth);
  const l = Math.hypot(e, 1, n);
  return [-e / l, 1 / l, -n / l];
}

/** The elevations blurred over +-SMOOTH_DEG (a box, around the ring): at 30 m a city's roofs are the horizon's teeth, and a silhouette of them reads as a fence. */
const SMOOTH_DEG = 1.5;
const SMOOTH = Array.from({ length: N }, (_, i) => {
  const k = Math.round(SMOOTH_DEG / bake.stepDeg);
  let sum = 0;
  for (let d = -k; d <= k; d += 1) sum += bake.elevationDeg[(i + d + N) % N];
  return sum / (2 * k + 1);
});
const MIN_E = Math.min(...SMOOTH);
const RANGE_E = Math.max(...SMOOTH) - MIN_E;

/** The horizon at an azimuth as 0..1 of the ring's own range (the lowest point of the horizon 0, the highest 1): the silhouette's shape, not its scale. */
export const horizonShape = (azimuth: number): number => (lerp(SMOOTH, azimuth) - MIN_E) / RANGE_E;

/** Real range of the smoothed horizon, degrees: what `horizonShape` stretches to the layer's relief. */
export const HORIZON_RANGE_DEG = RANGE_E;

/** Horizontal field of view, degrees, of a camera with the sky's vertical field (`skyDome.ts` VFOV_DEG) at an aspect ratio. */
export const hfovDeg = (aspect: number, vfovDeg: number): number =>
  (2 * Math.atan(aspect * Math.tan((vfovDeg * Math.PI) / 360)) * 180) / Math.PI;
