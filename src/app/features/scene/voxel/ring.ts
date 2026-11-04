// The height ring's bookkeeping, as pure functions: which texels must be rewritten when the camera
// crosses into another cell. The ring is a torus: world cell (x, z) lives at texel (x mod N, z mod N),
// and the window of cells the camera can see is the N x N block centred on its cell. Moving one
// cell retires one column or row of cells and admits one, and the admitted cells reuse exactly the
// texels the retired ones held.
import { HALF_RING, VOXEL } from './voxelWorld';

const N = VOXEL.ring;

export interface Cell {
  x: number;
  z: number;
}

/** Texels to rewrite, in ring coordinates. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The window's lowest cell for a camera in `camera`. */
export const windowOrigin = (camera: Cell): Cell => ({
  x: camera.x - HALF_RING,
  z: camera.z - HALF_RING,
});

export const mod = (a: number, n: number) => ((a % n) + n) % n;

/** The world cell texel index `i` holds, along one axis, for a window starting at `origin`. */
export const cellAt = (origin: number, i: number) => origin + mod(i - origin, N);

/** `count` consecutive cells from `first`, as runs of ring texels (two when the run wraps). */
function runs(first: number, count: number): Array<[number, number]> {
  const start = mod(first, N);
  if (start + count <= N) return [[start, count]];
  return [
    [start, N - start],
    [0, start + count - N],
  ];
}

/**
 * The rewrites that take a ring filled for `prev` to one filled for `next`: the whole ring when
 * there is no previous window or the move is a full ring or more, else the newly admitted columns
 * and rows, and nothing when the cell has not changed.
 */
export function ringRects(prev: Cell | undefined, next: Cell): Rect[] {
  if (!prev) return [{ x: 0, y: 0, w: N, h: N }];
  const dx = next.x - prev.x;
  const dz = next.z - prev.z;
  if (Math.abs(dx) >= N || Math.abs(dz) >= N) return [{ x: 0, y: 0, w: N, h: N }];
  const o0 = windowOrigin(prev);
  const o1 = windowOrigin(next);
  const out: Rect[] = [];
  if (dx !== 0) {
    const first = dx > 0 ? o0.x + N : o1.x;
    for (const [x, w] of runs(first, Math.abs(dx))) out.push({ x, y: 0, w, h: N });
  }
  if (dz !== 0) {
    const first = dz > 0 ? o0.z + N : o1.z;
    for (const [y, h] of runs(first, Math.abs(dz))) out.push({ x: 0, y, w: N, h });
  }
  return out;
}
