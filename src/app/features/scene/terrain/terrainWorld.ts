// The terrain scene's fixed numbers, grid and camera, as pure functions. No DOM, no GL.
// The height field itself is a function of world position written in GLSL (terrainShaders.ts), baked once
// into a texture; the CPU owns only where it is looked at from, and the seed offset it is sampled at.

/** Metres across the patch, and the height in metres that normalised height 1.0 stands for. */
export const TERRAIN = { span: 3000, hmax: 256 };

/**
 * Grid quads per side and height-map texels per side, by tier. 'still' draws one frame, so it takes the cheap pair. The
 * mesh is dense enough that a quad is at most two texels wide at the nearest ground (terrainWorld.test.ts); a coarser mesh
 * under shading read from the height map shows as hard-edged facets and stepped crests.
 */
export const GRID = {
  still: { grid: 192, tex: 512 },
  low: { grid: 320, tex: 1024 },
  full: { grid: 384, tex: 1024 },
} as const;

/** The camera: at the patch centre, above the highest peak, turning slowly and looking a little down. */
export const CAMERA = {
  eye: 330,
  pitch: (13 * Math.PI) / 180,
  fov: (55 * Math.PI) / 180,
  near: 10,
  far: 6000,
  /** Seconds for one full turn. */
  seconds: 420,
};

/** The height map's sample offset in metres for a seed: same seed, same terrain. Seed 0 is the origin. */
export function seedOffset(seed: number): [number, number] {
  const s = Math.trunc(seed);
  return [(s * 7919) % 65536, (s * 104729) % 65536];
}

/**
 * Where grid coordinate `u` (0..1 across the patch) lands in the patch, 0..1. The camera stands at the centre, so the
 * grid is packed toward it: with s = 2u - 1 the spacing grows as 0.5 + |s| of the plain grid's, about half of it at the
 * centre and half again as much at the rim. The vertex shader does the same arithmetic (terrainShaders.ts GRID_VERT).
 */
export const warpUv = (u: number): number => {
  const s = 2 * u - 1;
  return 0.5 + 0.5 * (0.5 * s + 0.5 * s * Math.abs(s));
};

export const triangleCount = (grid: number): number => 2 * grid * grid;

/** Vertex grid in unit uv: (grid + 1)^2 positions, then the two-triangle-per-quad index list. */
export function buildGrid(grid: number): { uv: Float32Array; indices: Uint32Array } {
  const uv = new Float32Array((grid + 1) * (grid + 1) * 2);
  for (let j = 0, k = 0; j <= grid; j += 1)
    for (let i = 0; i <= grid; i += 1, k += 2) {
      uv[k] = i / grid;
      uv[k + 1] = j / grid;
    }
  const indices = new Uint32Array(grid * grid * 6);
  for (let j = 0, k = 0; j < grid; j += 1)
    for (let i = 0; i < grid; i += 1, k += 6) {
      const a = j * (grid + 1) + i;
      indices.set([a, a + grid + 1, a + 1, a + 1, a + grid + 1, a + grid + 2], k);
    }
  return { uv, indices };
}

export interface View {
  /** Column-major perspective * view. */
  viewProj: Float32Array;
  eye: [number, number, number];
  /** Camera basis in world space, for the sky pass. */
  right: [number, number, number];
  up: [number, number, number];
  forward: [number, number, number];
}

const norm = (a: number[]): [number, number, number] => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: number[], b: number[]): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The camera `turns` full turns round (0..1 wraps), for a viewport aspect (width / height). */
export function view(aspect: number, turns: number): View {
  const yaw = 2 * Math.PI * turns;
  const cp = Math.cos(CAMERA.pitch);
  const forward = norm([Math.sin(yaw) * cp, -Math.sin(CAMERA.pitch), -Math.cos(yaw) * cp]);
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const eye: [number, number, number] = [0, CAMERA.eye, 0];
  const t = (a: number[]) => -(a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2]);
  const v = [
    right[0],
    up[0],
    -forward[0],
    0,
    right[1],
    up[1],
    -forward[1],
    0,
    right[2],
    up[2],
    -forward[2],
    0,
    t(right),
    t(up),
    -t(forward),
    1,
  ];
  const f = 1 / Math.tan(CAMERA.fov / 2);
  const { near: n, far } = CAMERA;
  const p = [
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + n) / (n - far),
    -1,
    0,
    0,
    (2 * far * n) / (n - far),
    0,
  ];
  const viewProj = new Float32Array(16);
  for (let c = 0; c < 4; c += 1)
    for (let r = 0; r < 4; r += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += p[k * 4 + r] * v[c * 4 + k];
      viewProj[c * 4 + r] = s;
    }
  return { viewProj, eye, right, up, forward };
}
