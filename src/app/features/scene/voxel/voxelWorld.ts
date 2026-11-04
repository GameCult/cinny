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
  /** First strip depth along the view axis. */
  near: 2,
  /** A strip step is max(stepMin, depth * stepRel): about a cell up close, coarser far away. */
  stepMin: 8,
  stepRel: 0.03,
  /** Pixel budget of the drawing buffer at scale 1 (320x180); the buffer takes the canvas's aspect. */
  pixels: 320 * 180,
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

/**
 * The strip schedule, one copy for the shader and the host. Depth k along the view axis is
 * near + k * stepMin while a step is the minimum one, then grows by (1 + stepRel) per strip: the
 * closed form of z += max(stepMin, z * stepRel), so a vertex shader can evaluate any k directly.
 */
const LINEAR_STEPS = Math.ceil((VOXEL.stepMin / VOXEL.stepRel - VOXEL.near) / VOXEL.stepMin);
const GROW_FROM = VOXEL.near + LINEAR_STEPS * VOXEL.stepMin;

export const stepDepth = (k: number): number =>
  k <= LINEAR_STEPS
    ? VOXEL.near + k * VOXEL.stepMin
    : GROW_FROM * (1 + VOXEL.stepRel) ** (k - LINEAR_STEPS);

/** Strips per column: the first k whose depth reaches the far distance on the view axis (a column's own far is nearer). */
export const STEPS = (() => {
  let k = 0;
  while (stepDepth(k) < VOXEL.farCells * VOXEL.cell) k += 1;
  return k;
})();

/** The farthest depth a column with ground direction length `dl` draws to: its far plane is a distance, not a depth. */
const columnReach = (dl: number) => (VOXEL.farCells * VOXEL.cell) / dl;

/**
 * Where the strips begin for a camera at `camY` with the horizon at `horizon` (ndc). Terrain tops
 * at most heightBound high, so a strip nearer than this projects entirely below the screen; the
 * first strip drawn runs down to the screen bottom instead of to its nearer neighbour's top.
 */
export function firstStep(camY: number, horizon: number, tanY: number): number {
  const reach = (camY - heightBound()) / ((1 + horizon) * tanY);
  let k = 0;
  while (k < STEPS - 1 && stepDepth(k) < reach) k += 1;
  return k;
}

/** How many strips a frame shades: those from `first` out, per column, that lie inside the column's far plane. */
export function liveStrips(columns: number, first: number, tanX: number): number {
  let n = 0;
  for (let c = 0; c < columns; c++) {
    const x = ((c + 0.5) / columns) * 2 - 1;
    const reach = columnReach(Math.hypot(1, x * tanX));
    let k = first;
    while (k < STEPS && stepDepth(k) < reach) k += 1;
    n += k - first;
  }
  return n;
}

/**
 * Ring lookups per live strip: each of the three bottom vertices reads the nearer neighbour's
 * height, each of the three top vertices its own, and the two that carry the strip's colour read
 * the neighbour's too.
 */
export const LOOKUPS_PER_STRIP = 8;
export const VERTICES_PER_STRIP = 6;

const f = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

/** `#define` lines every voxel stage sees. */
export function voxelDefines(): string {
  return [
    `#define VOX_RING ${VOXEL.ring}`,
    `#define VOX_CELL ${f(VOXEL.cell)}`,
    `#define VOX_FAR ${f(VOXEL.farCells * VOXEL.cell)}`,
    `#define VOX_STEPS ${STEPS}`,
    `#define VOX_LINEAR ${LINEAR_STEPS}`,
    `#define VOX_GROW_FROM ${f(GROW_FROM)}`,
    `#define VOX_NEAR ${f(VOXEL.near)}`,
    `#define VOX_STEP_MIN ${f(VOXEL.stepMin)}`,
    `#define VOX_STEP_REL ${f(VOXEL.stepRel)}`,
    `#define VOX_HB ${f(heightBound())}`,
    `#define VOX_FOG ${VOXEL.fog}`,
    '',
  ].join('\n');
}
