import { describe, expect, it } from 'vitest';
import { cameraPose, pullProgress, PULL_BACK_SECONDS } from './camera';
import { WORLD } from './world';

const dist = (p: readonly [number, number, number]) => Math.hypot(p[0], p[2]);

describe('login pull-back', () => {
  it('is at rest before login and complete after PULL_BACK_SECONDS', () => {
    expect(pullProgress(undefined)).toBe(0);
    expect(pullProgress(0)).toBe(0);
    expect(pullProgress(PULL_BACK_SECONDS)).toBe(1);
    expect(pullProgress(PULL_BACK_SECONDS * 10)).toBe(1);
  });

  it('only moves away from the tree and never reverses', () => {
    let last = -1;
    for (let s = 0; s <= PULL_BACK_SECONDS; s += 0.1) {
      const d = dist(cameraPose(pullProgress(s), 0).position);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
  });

  it('ends over the flat ground so it cannot be inside the terrain, whatever the orbit angle', () => {
    for (let t = 0; t < 2000; t += 37) {
      expect(dist(cameraPose(1, t).position)).toBeLessThan(WORLD.plateauInner);
    }
  });

  it('looks at the tree: forward points at the axis and the basis is orthonormal', () => {
    const pose = cameraPose(0.5, 12);
    const [rx, ry, rz, ux, uy, uz, fx, fy, fz] = pose.basis;
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot([rx, ry, rz], [ux, uy, uz])).toBeCloseTo(0, 6);
    expect(dot([rx, ry, rz], [fx, fy, fz])).toBeCloseTo(0, 6);
    expect(dot([ux, uy, uz], [fx, fy, fz])).toBeCloseTo(0, 6);
    expect(Math.hypot(fx, fy, fz)).toBeCloseTo(1, 6);
    // Forward points back across the tree axis, not away from it.
    const [px, , pz] = pose.position;
    expect(fx * px + fz * pz).toBeLessThan(0);
  });
});
