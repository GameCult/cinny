// Terrain surface colour as a pure function of height, slope and world position, no texture reads: the shader
// (terrainShaders.ts GRID_FRAG) does the same arithmetic with these numbers as uniforms and #defines. No DOM, no GL.
// Rock where the face is steep, then by height soil, scree and snow; snow only settles on gentle faces. The per-sky
// part reads the baked sky (./skyData.ts): the snow line drops and every material is tinted toward the sky's colour
// as the sun goes down, warm by the sun's own colour by day and cool by the horizon haze at night.
import { SkyData, Vec3 } from './skyData';
import { coldness, hazeColour, sunColour } from './terrainSky';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Every number the shader shares: band edges in metres, slope edges as the normal's y (cosine of the slope angle). */
export const ALBEDO = {
  /** soil fades to scree across these heights. */
  screeFrom: 80,
  screeTo: 160,
  /** half-width in metres of the snow line's fade. */
  snowBand: 22,
  /** n.y edges: faces with n.y below `rockLo` are all rock, above `rockHi` none. */
  rockLo: 0.78,
  rockHi: 0.95,
  /** n.y edges: snow is shed entirely below `snowLo` and settles fully above `snowHi`. */
  snowLo: 0.74,
  snowHi: 0.93,
  /** world-position wobble of the height edges (metres) and the slope edges, so bands are not contour lines. */
  wobbleHeight: 14,
  wobbleSlope: 0.05,
} as const;

export interface AlbedoPalette {
  soil: Vec3;
  scree: Vec3;
  rock: Vec3;
  snow: Vec3;
  /** Metres where snow is half in. */
  snowLine: number;
}

const BASE = {
  soil: [0.045, 0.08, 0.02],
  scree: [0.3, 0.235, 0.16],
  rock: [0.075, 0.062, 0.06],
  snow: [0.72, 0.75, 0.8],
} as const;

const SNOW_LINE_DAY = 165;
const SNOW_LINE_NIGHT = 135;

const unit = (c: Vec3): Vec3 => {
  const m = Math.max(c[0], c[1], c[2], 1e-6);
  return [c[0] / m, c[1] / m, c[2] / m];
};

/** The palette one baked sky gives: base reflectances tinted toward the sky's colour, and its snow line. */
export function albedoPalette(d: SkyData): AlbedoPalette {
  const cold = coldness(d);
  const sun = unit(sunColour(d));
  const haze = unit(hazeColour(d));
  const tint = [0, 1, 2].map((i) => mix(sun[i], haze[i], cold));
  const k = mix(0.15, 0.5, cold);
  const tinted = (c: Vec3): Vec3 =>
    [0, 1, 2].map((i) => c[i] * mix(1, tint[i], k)) as unknown as Vec3;
  return {
    soil: tinted(BASE.soil),
    scree: tinted(BASE.scree),
    rock: tinted(BASE.rock),
    snow: tinted(BASE.snow),
    snowLine: mix(SNOW_LINE_DAY, SNOW_LINE_NIGHT, cold),
  };
}

/** Cheap two-sine value in -1..1 from world position; stands in for noise so no texture or hash is read. */
export const wobble = (x: number, z: number): number =>
  Math.sin(x * 0.043 + z * 0.017) * Math.sin(z * 0.051 - x * 0.023);

/**
 * Linear albedo at a surface point. `height` in metres, `ny` the unit normal's y, `x`/`z` world metres.
 * Rock takes the steep faces at any height; on the rest, soil to scree by height, then snow above the snow
 * line, thinning to nothing as the face steepens.
 */
export function albedoAt(p: AlbedoPalette, height: number, ny: number, x: number, z: number): Vec3 {
  const w = wobble(x, z);
  const h = height + ALBEDO.wobbleHeight * w;
  const flat = ny + ALBEDO.wobbleSlope * w;
  const ground = (i: number) =>
    mix(p.soil[i], p.scree[i], smooth(ALBEDO.screeFrom, ALBEDO.screeTo, h));
  const snow =
    smooth(p.snowLine - ALBEDO.snowBand, p.snowLine + ALBEDO.snowBand, h) *
    smooth(ALBEDO.snowLo, ALBEDO.snowHi, flat);
  const rock = 1 - smooth(ALBEDO.rockLo, ALBEDO.rockHi, flat);
  return [0, 1, 2].map((i) =>
    mix(mix(ground(i), p.snow[i], snow), p.rock[i], rock)
  ) as unknown as Vec3;
}
