// The baked scattering tables (src/sky/baked.ts `scatter`, layout in src/sky/README.md) as the terrain scene
// uses them: decoded to half-float words for the GPU, a CPU twin of the shader's sky lookup for tests and
// for the sun's colour at an arbitrary elevation, and the GLSL both shaders share. No DOM, no GL.
import { baked } from '../../../../sky/baked';
import {
  AP_DISTANCE_SCALE,
  AP_ELEVATIONS,
  AP_SLICES,
  apElevationIndex,
  apSliceIndex,
  decode,
  sunIndex,
  viewIndex,
} from '../../../../sky/scatter.js';
import type { Vec3 } from './terrainSky';

const S = baked.scatter;
const AP = S.aerial_perspective;
const SKY = S.sky_view;
const VIEW = S.view_elevation_deg;

/** Raw little-endian half-float words of a base64 table, ready for `texImage3D(..., HALF_FLOAT, words)`. */
export function tableWords(b64: string): Uint16Array {
  const bytes = atob(b64);
  return Uint16Array.from(
    { length: bytes.length / 2 },
    (_, i) => bytes.charCodeAt(2 * i) + 256 * bytes.charCodeAt(2 * i + 1)
  );
}

export const SKY_VIEW = { width: SKY.width, height: SKY.height, depth: SKY.depth } as const;
export const STORE_SCALE = S.store_scale;
export const skyViewWords = (): Uint16Array => tableWords(SKY.data);

/** The aerial perspective volume (layout in src/sky/scatter.js): RGBA16F, x azimuth from the light, y slice-major block of elevations, z light elevation. */
export const AP_VOLUME = { width: AP.width, height: AP.height, depth: AP.depth } as const;
export const apVolumeWords = (): Uint16Array => tableWords(AP.data);
export { AP_DISTANCE_SCALE };

/** Decode a stored table to values, once. */
const decoded = (data: string) => {
  let values: Float32Array | undefined;
  return (): Float32Array => {
    if (!values) values = Float32Array.from(tableWords(data), decode);
    return values;
  };
};
const transmittanceTable = decoded(S.transmittance.data);
const skyTable = decoded(SKY.data);
const apTable = decoded(AP.data);

/** Sun colour at normal incidence for a sun at `elevationDeg`: the baked transmittance, per channel. Zero under the horizon. */
export function transmittanceAt(elevationDeg: number): Vec3 {
  const t = transmittanceTable();
  const f = Math.min(viewIndex(elevationDeg), VIEW.samples - 1);
  const i = Math.min(Math.floor(f), VIEW.samples - 2);
  const k = f - i;
  return [0, 1, 2].map((c) => t[i * 3 + c] * (1 - k) + t[(i + 1) * 3 + c] * k) as unknown as Vec3;
}

/**
 * Sky radiance per steradian for a sun of unit irradiance, trilinear in (azimuth from the sun, view
 * elevation, sun elevation) on texel centres, clamped at the edges: what the GPU's LINEAR sampler returns.
 */
export function scatterRadiance(sunElDeg: number, viewElDeg: number, azFromSunDeg: number): Vec3 {
  const t = skyTable();
  const at = [
    Math.min(Math.abs(azFromSunDeg) / 180, 1) * (SKY.width - 1),
    viewIndex(viewElDeg),
    sunIndex(sunElDeg),
  ];
  const lo = at.map((v, a) => Math.min(Math.floor(v), [SKY.width, SKY.height, SKY.depth][a] - 2));
  const f = at.map((v, a) => v - lo[a]);
  const out = [0, 0, 0];
  for (let corner = 0; corner < 8; corner += 1) {
    const dx = corner % 2;
    const dy = Math.floor(corner / 2) % 2;
    const dz = Math.floor(corner / 4);
    const w = (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (dz ? f[2] : 1 - f[2]);
    const base = (((lo[2] + dz) * SKY.height + lo[1] + dy) * SKY.width + lo[0] + dx) * 3;
    for (let c = 0; c < 3; c += 1) out[c] += w * t[base + c];
  }
  return [out[0], out[1], out[2]];
}

/**
 * Aerial perspective along a view ray: in-scatter luminance per channel (for a light of unit irradiance) and opacity
 * (1 - mean transmittance), for a light at `lightElDeg`, a ray `viewElDeg` (0 and below) and `azDeg` from the light,
 * `km` of baked path along it. Trilinear in (azimuth, elevation, light elevation) and linear between slices, the arithmetic the
 * shader's `aerial()` does on the GPU; below the first slice it fades to nothing at the observer (Hillaire's near-slice fade).
 */
export function aerialAt(
  lightElDeg: number,
  viewElDeg: number,
  azDeg: number,
  km: number
): { L: Vec3; alpha: number } {
  const t = apTable();
  const x = Math.min(Math.abs(azDeg) / 180, 1) * (AP.width - 1);
  const e = apElevationIndex(viewElDeg);
  const z = sunIndex(lightElDeg);
  const texel = (slice: number): number[] => {
    const lo = [
      Math.min(Math.floor(x), AP.width - 2),
      Math.min(Math.floor(e), AP_ELEVATIONS - 2),
      Math.min(Math.floor(z), AP.depth - 2),
    ];
    const f = [x - lo[0], e - lo[1], z - lo[2]];
    const out = [0, 0, 0, 0];
    for (let corner = 0; corner < 8; corner += 1) {
      const dx = corner % 2;
      const dy = Math.floor(corner / 2) % 2;
      const dz = Math.floor(corner / 4);
      const w = (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (dz ? f[2] : 1 - f[2]);
      const base =
        (((lo[2] + dz) * AP.height + slice * AP_ELEVATIONS + lo[1] + dy) * AP.width + lo[0] + dx) *
        4;
      for (let c = 0; c < 4; c += 1) out[c] += w * t[base + c];
    }
    return out;
  };
  const f = apSliceIndex(km);
  const fs = Math.min(Math.max(f, 0), AP_SLICES - 1);
  const k = Math.min(Math.floor(fs), AP_SLICES - 2);
  const a = texel(k);
  const b = texel(k + 1);
  const fade = Math.min(Math.max(f + 1, 0), 1);
  const v = [0, 1, 2, 3].map((c) => (a[c] + (b[c] - a[c]) * (fs - k)) * fade);
  return { L: [v[0], v[1], v[2]], alpha: v[3] };
}

/**
 * The lowest view elevation the sky is sampled at, degrees. The table dips toward the ground over its last degree
 * (its rows below the horizon are for an observer who would hit the ground), so at and below this the sky and the
 * terrain's haze both take the colour here, flat to the horizon, and meet without a seam.
 */
export const HORIZON_FLOOR = 1.5;

/** The sky shader's lookup, in GLSL: `skyScatter(viewDirection)` is unit-sun radiance, needs uSky, uSunIndex, uSun. */
export const SCATTER_GLSL = `
uniform highp sampler3D uSky;
uniform float uSunIndex;
uniform vec3 uSun;
vec3 skyScatter(vec3 d) {
  float el = max(degrees(asin(clamp(d.y, -1.0, 1.0))), ${HORIZON_FLOOR.toFixed(1)});
  vec2 h = d.xz, s = uSun.xz;
  float az = (length(h) < 1e-4 || length(s) < 1e-4) ? 0.0
    : degrees(acos(clamp(dot(normalize(h), normalize(s)), -1.0, 1.0)));
  float y = sqrt(clamp((el - (${VIEW.min.toFixed(1)})) / ${(VIEW.max - VIEW.min).toFixed(
  1
)}, 0.0, 1.0)) * ${(VIEW.samples - 1).toFixed(1)};
  float x = clamp(az / 180.0, 0.0, 1.0) * ${(SKY.width - 1).toFixed(1)};
  return texture(uSky, vec3((x + 0.5) / ${SKY.width}.0, (y + 0.5) / ${
  SKY.height
}.0, (uSunIndex + 0.5) / ${SKY.depth}.0)).rgb / ${S.store_scale.toFixed(1)};
}`;

/**
 * The aerial perspective lookup, in GLSL: `aerial(lightIndex, viewElDeg, azDeg, km)` is `aerialAt` on the GPU. Needs uAP.
 * Each slice is one hardware-filtered fetch, kept inside its block of elevation rows so the filter never reads a
 * neighbouring slice; two fetches and a lerp per call.
 */
export const AERIAL_GLSL = `
uniform highp sampler3D uAP;
vec4 apSlice(float k, float e, float x, float z) {
  return texture(uAP, vec3((x + 0.5) / ${AP.width}.0, (k * ${AP.elevations}.0 + e + 0.5) / ${
  AP.height
}.0, (z + 0.5) / ${AP.depth}.0)) / ${S.store_scale.toFixed(1)};
}
vec4 aerial(float lightIndex, float viewElDeg, float azDeg, float km) {
  float e = ${(AP.elevations - 1).toFixed(
    1
  )} * (1.0 - sqrt(clamp(-viewElDeg / ${(-AP.elevation_min_deg).toFixed(1)}, 0.0, 1.0)));
  float x = clamp(abs(azDeg) / 180.0, 0.0, 1.0) * ${(AP.width - 1).toFixed(1)};
  float f = ${AP.slices}.0 * sqrt(max(km, 0.0) / ${AP.max_km.toFixed(1)}) - 1.0;
  float fs = clamp(f, 0.0, ${(AP.slices - 1).toFixed(1)});
  float k = min(floor(fs), ${(AP.slices - 2).toFixed(1)});
  return mix(apSlice(k, e, x, lightIndex), apSlice(k + 1.0, e, x, lightIndex), fs - k) * clamp(f + 1.0, 0.0, 1.0);
}`;
