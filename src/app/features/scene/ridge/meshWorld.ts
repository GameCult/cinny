// The far heightfield of the mesh scene, as pure functions: grid, heights, camera, haze. No DOM, no GL.
import { fbmPeriodic, FbmShape } from './noise';
import type { Srgb } from './skyColour';

/** A few thousand triangles. Columns span two periods so a drift of one period loops. */
export const MESH = {
  /** Quads across one period. */
  colsPerPeriod: 48,
  /** Quads from the near edge to the far edge. */
  rows: 20,
  /** Lattice rows of noise per grid row: heights vary smoothly in depth rather than per row. */
  rowsPerCell: 2,
  /** Distances in world units (view-space depth of the near and far rows with the camera at the origin's height). */
  near: 6,
  far: 150,
  /** Peak height of the terrain. */
  relief: 55,
  /** Camera height above the terrain's zero, vertical FOV in radians, pitch down in radians. */
  eye: 20,
  fov: (42 * Math.PI) / 180,
  pitch: (1 * Math.PI) / 180,
  /** Seconds for the field to drift one period. */
  seconds: 240,
};

export const FBM_MESH: FbmShape = { octaves: 4, lacunarity: 2, gain: 0.5 };

/** Haze: transmittance T = exp(-extinction * d / far) at view-space depth d; chroma drops by desaturate * (1 - T). */
export const HAZE = { extinction: 3, desaturate: 0.45 };

export const triangleCount = (): number => 2 * 2 * MESH.colsPerPeriod * MESH.rows;
export const vertexCount = (): number => (2 * MESH.colsPerPeriod + 1) * (MESH.rows + 1);

/** World width of one period: what the view sees at the far row, so the far edge never shows a seam. */
export function periodWidth(aspect: number): number {
  return 2 * MESH.far * Math.tan(MESH.fov / 2) * Math.max(aspect, 1) * 1.15;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Terrain height in [0, relief] at column fraction `t` (0..1 across one period, periodic) and grid row `r`. */
export function height(t: number, r: number): number {
  const cell = r / MESH.rowsPerCell;
  const r0 = Math.floor(cell);
  const u = smooth(cell - r0);
  const base = 7; // lattice cells per period for the first octave: integer at every octave
  const a = fbmPeriodic(t, 500 + r0 * 17, base, FBM_MESH);
  const b = fbmPeriodic(t, 500 + (r0 + 1) * 17, base, FBM_MESH);
  // Depth bands: rows of ridgelines one behind another, bent sideways by the noise so no band is straight.
  const band = 0.5 + 0.5 * Math.sin(r * 0.8 + 5 * (a + (b - a) * u));
  const n = 0.3 * (a + (b - a) * u) + 0.7 * band;
  // Ridged fold, so the far field reads as ridgelines rather than lumps.
  const crag = 1 - Math.abs(2 * n - 1);
  // Low in front of the camera, tall toward the horizon, so the eye is never inside a hill.
  const lift = 0.12 + 0.88 * (r / MESH.rows) ** 1.2;
  return MESH.relief * lift * (0.55 * n + 0.45 * crag);
}

export interface MeshData {
  /** x, y, z per vertex (z is negative depth: camera looks down -z). */
  positions: Float32Array;
  /** Smooth normal per vertex. */
  normals: Float32Array;
  indices: Uint16Array;
}

/** Build the grid for a viewport aspect. Rows run from `near` (row 0) to `far`; columns from 0 to two periods. */
export function buildMesh(aspect: number): MeshData {
  const cols = 2 * MESH.colsPerPeriod;
  const w = periodWidth(aspect);
  const x0 = -w * 0.5;
  const nv = (cols + 1) * (MESH.rows + 1);
  const positions = new Float32Array(nv * 3);
  const heights = new Float32Array(nv);
  const idx = (c: number, r: number) => r * (cols + 1) + c;
  for (let r = 0; r <= MESH.rows; r += 1) {
    // Rows bunch toward the camera, where a given depth step is more pixels.
    const z = MESH.near + (MESH.far - MESH.near) * (r / MESH.rows) ** 1.5;
    for (let c = 0; c <= cols; c += 1) {
      const t = (c % MESH.colsPerPeriod) / MESH.colsPerPeriod;
      const h = height(t, r);
      const i = idx(c, r);
      heights[i] = h;
      positions.set([x0 + (c / MESH.colsPerPeriod) * w, h, -z], i * 3);
    }
  }
  const normals = new Float32Array(nv * 3);
  for (let r = 0; r <= MESH.rows; r += 1) {
    for (let c = 0; c <= cols; c += 1) {
      const i = idx(c, r);
      const l = positions.subarray(
        idx(Math.max(c - 1, 0), r) * 3,
        idx(Math.max(c - 1, 0), r) * 3 + 3
      );
      const rt = positions.subarray(
        idx(Math.min(c + 1, cols), r) * 3,
        idx(Math.min(c + 1, cols), r) * 3 + 3
      );
      const d = positions.subarray(
        idx(c, Math.max(r - 1, 0)) * 3,
        idx(c, Math.max(r - 1, 0)) * 3 + 3
      );
      const u = positions.subarray(
        idx(c, Math.min(r + 1, MESH.rows)) * 3,
        idx(c, Math.min(r + 1, MESH.rows)) * 3 + 3
      );
      const dx = [rt[0] - l[0], rt[1] - l[1], rt[2] - l[2]];
      const dz = [u[0] - d[0], u[1] - d[1], u[2] - d[2]];
      // dz points away from the camera (-z); dx x dz points up.
      const n = [
        dx[1] * dz[2] - dx[2] * dz[1],
        dx[2] * dz[0] - dx[0] * dz[2],
        dx[0] * dz[1] - dx[1] * dz[0],
      ];
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      normals.set([n[0] / len, n[1] / len, n[2] / len], i * 3);
    }
  }
  const indices = new Uint16Array(cols * MESH.rows * 6);
  let k = 0;
  for (let r = 0; r < MESH.rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const a = idx(c, r);
      const b = idx(c + 1, r);
      const d = idx(c, r + 1);
      const e = idx(c + 1, r + 1);
      indices.set([a, d, b, b, d, e], k);
      k += 6;
    }
  }
  return { positions, normals, indices };
}

/** Column-major perspective * view matrix for the fixed camera: at (0, eye, 0), pitched down, looking along -z. */
export function viewProjection(aspect: number): Float32Array {
  const f = 1 / Math.tan(MESH.fov / 2);
  const zn = 1;
  const zf = MESH.far * 1.2;
  const cp = Math.cos(MESH.pitch);
  const sp = Math.sin(MESH.pitch);
  // view = R(pitch down) * T(0, -eye, 0), column-major: y' = cp y - sp z, z' = sp y + cp z.
  const view = [
    1,
    0,
    0,
    0, //
    0,
    cp,
    sp,
    0,
    0,
    -sp,
    cp,
    0,
    0,
    -MESH.eye * cp,
    -MESH.eye * sp,
    1,
  ];
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
    (zf + zn) / (zn - zf),
    -1,
    0,
    0,
    (2 * zf * zn) / (zn - zf),
    0,
  ];
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1)
    for (let r = 0; r < 4; r += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += p[k * 4 + r] * view[c * 4 + k];
      out[c * 4 + r] = s;
    }
  return out;
}

/** View-space depth (distance along the view axis) of a world point, as the vertex shader computes it. */
export function viewDepth(y: number, z: number): number {
  const cp = Math.cos(MESH.pitch);
  const sp = Math.sin(MESH.pitch);
  return -(sp * (y - MESH.eye) + cp * z);
}

/** Beer-Lambert transmittance at view-space depth d. */
export const hazeTransmittance = (d: number): number => Math.exp((-HAZE.extinction * d) / MESH.far);

/** `base` seen through the haze toward `sky`, then desaturated by HAZE.desaturate * (1 - T). The same arithmetic the fragment shader runs. */
export function hazed(base: Srgb, sky: Srgb, d: number): Srgb {
  const t = hazeTransmittance(d);
  const seen = (i: number) => base[i] * t + sky[i] * (1 - t);
  const luma = 0.2126 * seen(0) + 0.7152 * seen(1) + 0.0722 * seen(2);
  const keep = 1 - HAZE.desaturate * (1 - t);
  return [0, 1, 2].map((i) => luma + (seen(i) - luma) * keep) as unknown as Srgb;
}
