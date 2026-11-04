import { describe, expect, it } from 'vitest';
import { pullProgress } from '../camera';
import { RAIL_HEADING, RAIL_SPEED, voxelPose } from './rails';
import { VOXEL, heightBound } from './voxelWorld';

describe('voxel rails camera', () => {
  it('stays above the highest terrain at every time and pull-back', () => {
    for (let t = 0; t < 7200; t += 13.7)
      for (const pull of [0, 0.3, 1])
        expect(voxelPose(pull, t).position[1]).toBeGreaterThanOrEqual(
          heightBound() + VOXEL.clearance
        );
  });

  it('slides along the heading at the rail speed, swaying within a bound', () => {
    const a = voxelPose(0, 100).position;
    const b = voxelPose(0, 200).position;
    const along = (b[0] - a[0]) * Math.cos(RAIL_HEADING) + (b[2] - a[2]) * Math.sin(RAIL_HEADING);
    expect(along).toBeCloseTo(RAIL_SPEED * 100, 5);
    const across = (p: readonly number[]) =>
      -p[0] * Math.sin(RAIL_HEADING) + p[2] * Math.cos(RAIL_HEADING);
    expect(Math.abs(across(a))).toBeLessThanOrEqual(40);
    expect(Math.abs(across(b))).toBeLessThanOrEqual(40);
  });

  it('yaws freely either side of the heading, bounded', () => {
    const yaws = Array.from({ length: 500 }, (_, i) => voxelPose(0, i * 5).yaw - RAIL_HEADING);
    expect(Math.max(...yaws)).toBeGreaterThan(0.3);
    expect(Math.min(...yaws)).toBeLessThan(-0.3);
    expect(Math.max(...yaws.map(Math.abs))).toBeLessThanOrEqual(0.35 + 1e-9);
  });

  it('login lifts the camera and tips it down, and a time step moves it a little', () => {
    const rest = voxelPose(pullProgress(undefined), 50);
    const pulled = voxelPose(pullProgress(99), 50);
    expect(pulled.position[1]).toBeGreaterThan(rest.position[1]);
    expect(pulled.pitch).toBeLessThan(rest.pitch);
    const next = voxelPose(0, 50.033);
    expect(
      Math.hypot(next.position[0] - rest.position[0], next.position[2] - rest.position[2])
    ).toBeLessThan(1);
  });
});
