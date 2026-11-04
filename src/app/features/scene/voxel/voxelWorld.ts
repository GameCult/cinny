// The voxel scene's constants. One owner: the shader defines below are generated from this object.
// The terrain itself is the ray-march scene's (../world.ts: fbm plus Phacelle erosion) with the
// plateau mask left out, sampled once per cell into a wrapping ring of heights.
import { terrainBounds } from '../world';

export const VOXEL = {
  /** Texels per side of the wrapping height ring: world cell (x, z) lives at texel (x mod ring, z mod ring). */
  ring: 256,
  /** World units per cell. */
  cell: 8,
  /** Furthest sample, in cells from the camera. The ring holds 128 each way; the margin keeps a ray from reading cells the camera has not generated. */
  farCells: 120,
  /** Height lookups one column march may spend. */
  maxLookups: 128,
  /** First sample depth along the view axis. */
  near: 2,
  /** A march step is max(stepMin, depth * stepRel): about a cell up close, coarser far away. */
  stepMin: 4.8,
  stepRel: 0.02,
  /** Fog: 1 - exp(-distance * fog) of the way to the horizon colour. */
  fog: 0.0016,
  /** Camera altitude above the highest possible terrain, so the camera is never inside a column. */
  clearance: 30,
  /** Extra altitude the login pull-back climbs. */
  pullClimb: 45,
} as const;

/** Terrain heights lie in [-heightBound, heightBound] and are stored as 16 bits across that range. */
export const heightBound = (): number => terrainBounds().maxHeight;

/** Half the ring, in cells: the camera cell sits at the centre of the window. */
export const HALF_RING = VOXEL.ring / 2;

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/** `#define` lines every voxel stage sees. */
export function voxelDefines(): string {
  return [
    `#define VOX_RING ${VOXEL.ring}`,
    `#define VOX_CELL ${f(VOXEL.cell)}`,
    `#define VOX_FAR ${f(VOXEL.farCells * VOXEL.cell)}`,
    `#define VOX_MAX_LOOKUPS ${VOXEL.maxLookups}`,
    `#define VOX_NEAR ${f(VOXEL.near)}`,
    `#define VOX_STEP_MIN ${f(VOXEL.stepMin)}`,
    `#define VOX_STEP_REL ${f(VOXEL.stepRel)}`,
    `#define VOX_HB ${f(heightBound())}`,
    `#define VOX_FOG ${VOXEL.fog}`,
    '',
  ].join('\n');
}
