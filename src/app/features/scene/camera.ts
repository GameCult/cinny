// The scene's camera: close under the tree at rest, pulled back on login, drifting after.
// Pure functions of time so the pull-back is testable without a GL context.

export type Vec3 = readonly [number, number, number];

export interface CameraPose {
  position: Vec3;
  /** Column-major right, up, forward: the layout of the shader's mat3 uniform. */
  basis: readonly [number, number, number, number, number, number, number, number, number];
  /** Vertical field of view in radians. */
  fov: number;
}

export const PULL_BACK_SECONDS = 6;

// Keep the end distance inside WORLD.plateauInner so the camera is always over flat ground.
const NEAR = { radius: 20, camY: 5, targetY: 34, fov: 1.15 };
const FAR = { radius: 110, camY: 50, targetY: 36, fov: 0.82 };
const DRIFT_RAD_PER_SEC = 0.025;

const smoother = (x: number) => x * x * x * (x * (x * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 0 before login, easing to 1 over PULL_BACK_SECONDS. `elapsed` is seconds since login. */
export function pullProgress(elapsed: number | undefined): number {
  if (elapsed === undefined || elapsed <= 0) return 0;
  return smoother(Math.min(1, elapsed / PULL_BACK_SECONDS));
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * @param pull 0..1 from pullProgress
 * @param time seconds since the scene started, for the slow orbit
 */
export function cameraPose(pull: number, time: number): CameraPose {
  const radius = lerp(NEAR.radius, FAR.radius, pull);
  const camY = lerp(NEAR.camY, FAR.camY, pull);
  const targetY = lerp(NEAR.targetY, FAR.targetY, pull);
  const azimuth = 0.9 + time * DRIFT_RAD_PER_SEC;
  const position: Vec3 = [radius * Math.cos(azimuth), camY, radius * Math.sin(azimuth)];
  const forward = norm([-position[0], targetY - position[1], -position[2]]);
  const right = norm(cross([0, 1, 0], forward));
  const up = cross(forward, right);
  return {
    position,
    basis: [...right, ...up, ...forward] as unknown as CameraPose['basis'],
    fov: lerp(NEAR.fov, FAR.fov, pull),
  };
}
