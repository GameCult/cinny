/* eslint-disable no-restricted-syntax -- tests loop over skies, normals and distances */
import { describe, expect, it } from 'vitest';
import { buildGrid, CAMERA, GRID, seedOffset, TERRAIN, triangleCount, view } from './terrainWorld';
import { heightFragmentSource } from './terrainShaders';

describe('seed', () => {
  it('same seed, same offset, so the baked height map is the same; a different seed moves it', () => {
    expect(seedOffset(7)).toEqual(seedOffset(7));
    expect(seedOffset(0)).toEqual([0, 0]);
    expect(seedOffset(1)).not.toEqual(seedOffset(2));
  });

  it('the height-bake source is a pure function of nothing but the world constants', () => {
    expect(heightFragmentSource()).toBe(heightFragmentSource());
    const src = heightFragmentSource();
    expect(src.startsWith('#version 300 es')).toBe(true);
    expect(src).toContain('cultmath_phacelle');
    expect(src).toContain(`/ ${TERRAIN.hmax.toFixed(1)}`);
    expect(src).toContain('uSeed');
  });
});

describe('grid', () => {
  it('has (n+1)^2 vertices in 0..1 and 2n^2 triangles that index them all in range', () => {
    const n = 8;
    const g = buildGrid(n);
    expect(g.uv.length).toBe((n + 1) * (n + 1) * 2);
    expect(g.indices.length / 3).toBe(triangleCount(n));
    expect(Math.max(...g.indices)).toBe((n + 1) * (n + 1) - 1);
    expect(Math.min(...g.uv)).toBe(0);
    expect(Math.max(...g.uv)).toBe(1);
  });

  it('each tier fits a 32-bit index and the cheap tiers stay cheap', () => {
    expect(triangleCount(GRID.low.grid)).toBeLessThan(40000);
    expect(GRID.full.grid).toBeGreaterThan(GRID.low.grid);
    expect(GRID.still.tex).toBeLessThanOrEqual(GRID.low.tex);
  });
});

describe('camera', () => {
  const project = (m: Float32Array, p: number[]) => {
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    return { x: x / w, y: y / w, z: z / w, w };
  };

  it('a point straight ahead lands in the middle of the screen, in front, inside the depth range', () => {
    for (const turns of [0, 0.25, 0.6]) {
      const v = view(0.46, turns);
      const p = v.eye.map((e, i) => e + 800 * v.forward[i]);
      const s = project(v.viewProj, p);
      expect(s.w).toBeGreaterThan(0);
      expect(s.x).toBeCloseTo(0, 5);
      expect(s.y).toBeCloseTo(0, 5);
      expect(Math.abs(s.z)).toBeLessThan(1);
    }
  });

  it('looks down by the pitch, and one full turn comes back to the same heading', () => {
    const a = view(1, 0);
    const b = view(1, 1);
    expect(a.forward[1]).toBeCloseTo(-Math.sin(CAMERA.pitch), 9);
    for (let i = 0; i < 3; i += 1) expect(a.forward[i]).toBeCloseTo(b.forward[i], 9);
  });

  it('sits above the highest possible terrain, so the eye is never inside a hill', () => {
    expect(CAMERA.eye).toBeGreaterThan(TERRAIN.hmax);
  });

  it('the basis is orthonormal', () => {
    const v = view(0.5, 0.37);
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(v.right, v.up)).toBeCloseTo(0, 9);
    expect(dot(v.right, v.forward)).toBeCloseTo(0, 9);
    expect(dot(v.up, v.forward)).toBeCloseTo(0, 9);
    expect(Math.hypot(...v.up)).toBeCloseTo(1, 9);
  });
});
