// The voxel scene's camera: a free-yaw rail. The camera slides along a fixed heading while its yaw
// wanders either side of it, always above the highest terrain; login() lifts it and tips it down.
// Pure functions of time, so the path is testable without a GL context.
import { heightBound, VOXEL } from './voxelWorld';

export interface VoxelPose {
  /** World x, y (up), z. */
  position: readonly [number, number, number];
  /** Radians about +y; 0 looks down +x. */
  yaw: number;
  /** Radians, negative looks down. */
  pitch: number;
  /** Vertical field of view in radians. */
  fov: number;
}

/** The rail's heading and the world units it covers per second. */
export const RAIL_HEADING = 0.6;
export const RAIL_SPEED = 14;
const SWAY = 40;
const YAW_SWING = 0.35;

/** @param pull 0..1 from pullProgress. @param time seconds since the scene started. */
export function voxelPose(pull: number, time: number): VoxelPose {
  const hx = Math.cos(RAIL_HEADING);
  const hz = Math.sin(RAIL_HEADING);
  const sway = SWAY * Math.sin(time * 0.05);
  return {
    position: [
      hx * RAIL_SPEED * time - hz * sway,
      heightBound() + VOXEL.clearance + VOXEL.pullClimb * pull,
      hz * RAIL_SPEED * time + hx * sway,
    ],
    yaw: RAIL_HEADING + YAW_SWING * Math.sin(time * 0.07),
    pitch: -0.1 - 0.12 * pull,
    fov: 1.0 - 0.1 * pull,
  };
}
