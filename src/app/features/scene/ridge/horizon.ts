// The terrain horizon seen from the viewpoint, baked from open DEM by `scripts/bake-horizon.py` (source, licence and attribution are
// in the file's `source` block and in `HORIZON_ATTRIBUTION`).
import bake from './viennaHorizon.json';

export const HORIZON_ATTRIBUTION = bake.source.attribution;

const N = bake.elevationDeg.length;

/** Index pair and weight of an azimuth (degrees clockwise from north) on the baked ring. */
function at(azimuth: number): [number, number, number] {
  const f = ((((azimuth / bake.stepDeg) % N) + N) % N);
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
