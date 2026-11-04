import { describe, expect, it } from 'vitest';
import { Cell, cellAt, ringRects, windowOrigin } from './ring';
import { HALF_RING, VOXEL } from './voxelWorld';

const N = VOXEL.ring;

/** What each ring texel holds after applying rewrites: the world cell it was last written as, x then z. */
type Ring = Int32Array;
const UNWRITTEN = -2147483648;

function applyRects(ring: Ring, rects: ReturnType<typeof ringRects>, to: Cell) {
  const o = windowOrigin(to);
  for (const r of rects)
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        ring[(y * N + x) * 2] = cellAt(o.x, x);
        ring[(y * N + x) * 2 + 1] = cellAt(o.z, y);
      }
}

/** Index of the first texel where the rings differ, or -1. (toEqual on 131k numbers is far too slow.) */
const firstDifference = (a: Ring, b: Ring) => a.findIndex((v, i) => v !== b[i]);

const fill = (cell: Cell) => {
  const ring: Ring = new Int32Array(N * N * 2).fill(UNWRITTEN);
  applyRects(ring, ringRects(undefined, cell), cell);
  return ring;
};

describe('height ring bookkeeping', () => {
  it('the first window is the whole ring, and standing still rewrites nothing', () => {
    expect(ringRects(undefined, { x: 5, z: -3 })).toEqual([{ x: 0, y: 0, w: N, h: N }]);
    expect(ringRects({ x: 5, z: -3 }, { x: 5, z: -3 })).toEqual([]);
  });

  it('the window is the N x N block centred on the camera cell, one world cell per texel', () => {
    const cam = { x: 1000, z: -777 };
    const o = windowOrigin(cam);
    expect(o).toEqual({ x: cam.x - HALF_RING, z: cam.z - HALF_RING });
    const seen = new Set<string>();
    for (let i = 0; i < N; i++) {
      const cx = cellAt(o.x, i);
      expect(cx).toBeGreaterThanOrEqual(o.x);
      expect(cx).toBeLessThan(o.x + N);
      expect(((cx % N) + N) % N).toBe(i); // the cell lives at its own residue
      seen.add(String(cx));
    }
    expect(seen.size).toBe(N);
  });

  it('after any walk of strip rewrites, every texel holds the cell a full fill would put there', () => {
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let cam: Cell = { x: -3, z: 250 }; // straddles the wrap on both axes
    const ring = fill(cam);
    for (let step = 0; step < 150; step++) {
      // mostly single-cell moves, some multi-cell jumps, some diagonals, some standing still
      const jump = rand() < 0.1 ? 40 : 2;
      const next = {
        x: cam.x + Math.round((rand() - 0.5) * jump),
        z: cam.z + Math.round((rand() - 0.5) * jump),
      };
      applyRects(ring, ringRects(cam, next), next);
      cam = next;
      expect(firstDifference(ring, fill(cam))).toBe(-1);
    }
  });

  it('writes only what it must: the cells the move admitted, not one texel more', () => {
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-2, 3],
    ]) {
      const prev = { x: N - 1, z: 0 }; // wraps on x for positive dx
      const rects = ringRects(prev, { x: prev.x + dx, z: prev.z + dz });
      const touched = new Set<number>();
      for (const r of rects)
        for (let y = r.y; y < r.y + r.h; y++)
          for (let x = r.x; x < r.x + r.w; x++) touched.add(y * N + x);
      const ax = Math.abs(dx);
      const az = Math.abs(dz);
      expect(touched.size).toBe(N * N - (N - ax) * (N - az));
    }
  });

  it('a move of a whole ring or more is a full rewrite', () => {
    expect(ringRects({ x: 0, z: 0 }, { x: N, z: 0 })).toEqual([{ x: 0, y: 0, w: N, h: N }]);
    expect(ringRects({ x: 0, z: 0 }, { x: 3, z: -N - 1 })).toEqual([{ x: 0, y: 0, w: N, h: N }]);
  });
});
