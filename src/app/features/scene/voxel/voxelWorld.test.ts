import { describe, expect, it } from 'vitest';
import { firstStep, heightBound, liveStrips, STEPS, stepDepth, VOXEL } from './voxelWorld';

describe('the strip schedule', () => {
  it('is the closed form of z += max(stepMin, z * stepRel) from near', () => {
    let z: number = VOXEL.near;
    for (let k = 0; k < STEPS; k++) {
      expect(stepDepth(k)).toBeCloseTo(z, 6);
      z += Math.max(VOXEL.stepMin, z * VOXEL.stepRel);
    }
  });

  it('covers every depth short of the far distance and no further', () => {
    const far = VOXEL.farCells * VOXEL.cell;
    expect(stepDepth(STEPS - 1)).toBeLessThan(far);
    expect(stepDepth(STEPS)).toBeGreaterThanOrEqual(far);
  });
});

describe('where the strips begin', () => {
  const camY = heightBound() + VOXEL.clearance;
  const tanY = Math.tan(0.5);
  const topAt = (k: number, h: number, horizon: number) =>
    horizon + (h - camY) / (stepDepth(k) * tanY);

  it('skips only strips whose every possible top is below the screen', () => {
    const horizon = 0.2;
    const first = firstStep(camY, horizon, tanY);
    expect(first).toBeGreaterThan(0);
    expect(topAt(first - 1, heightBound(), horizon)).toBeLessThan(-1);
    expect(topAt(first, heightBound(), horizon)).toBeGreaterThanOrEqual(-1 - 1e-9);
  });

  it('starts nearer when the camera is lower or the view steeper', () => {
    expect(firstStep(camY + 45, 0.3, tanY)).toBeGreaterThan(firstStep(camY, 0.3, tanY));
    expect(firstStep(camY, 0.5, tanY)).toBeLessThan(firstStep(camY, 0.1, tanY));
  });
});

describe('strips a frame shades', () => {
  it('loses the far corners of a wide view to the far plane, and nothing of a narrow one', () => {
    const wide = liveStrips(320, 10, 1.0);
    expect(wide).toBeLessThan(liveStrips(320, 10, 0.01));
    expect(liveStrips(320, 10, 0.01)).toBeCloseTo(320 * (STEPS - 10), -3);
  });
});
