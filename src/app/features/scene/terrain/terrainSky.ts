// Lighting and haze for the terrain scene, as pure functions of one sky's baked numbers (./skyData.ts).
// No DOM, no GL. The fragment shader does the same arithmetic with these results as uniforms.
import { isNight } from '../ridge/stars';
import type { SkyColours } from '../ridge/skyColour';
import { SKY, SkyData, SkyName, Vec3 } from './skyData';

const RAD = Math.PI / 180;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Which baked sky a ridge-style `SkyColours` means: the night notion the stars use (`isNight`). */
export const skyNameFor = (sky: SkyColours): SkyName => (isNight(sky) ? 'midnight' : 'noonday');

export const isSkyName = (s: unknown): s is SkyName => s === 'midnight' || s === 'noonday';

/** sRGB hex `#rrggbb` to linear RGB 0..1. */
export function hexToLinear(hex: string): Vec3 {
  const ch = (at: number) => {
    const s = parseInt(hex.slice(at, at + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [ch(1), ch(3), ch(5)];
}

/** Unit vector toward the sun: x east, y up, z south (so azimuth 0, north, is -z). */
export function sunDirection(d: SkyData): Vec3 {
  const el = d.elevation * RAD;
  const az = d.azimuth * RAD;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

/**
 * The sun's colour as the ground sees it: baked `direct`, off at the horizon the way sun.js fades the disc
 * (gone at -0.83 degrees, soft to 1.5). A sun below the horizon lights nothing.
 */
export function sunColour(d: SkyData): Vec3 {
  const k = smooth(-0.83, 1.5, d.elevation);
  return [d.direct[0] * k, d.direct[1] * k, d.direct[2] * k];
}

/**
 * Ambient light on an upward surface, from the baked gradient's zenith stop. The gain is chosen so the
 * noonday value (0.075, 0.14, 0.25) matches sun.js's own `diffuse` there (0.07, 0.13, 0.27); at midnight
 * the same gain turns the gradient's glow into a faint moonlit fill, where `diffuse` alone would be black.
 */
export const AMBIENT_GAIN = 0.25;

/** 0 with the sun well up, 1 once it is below -6 degrees (civil twilight over): the night notion the palette and fill share. */
export const coldness = (d: SkyData): number => 1 - smooth(-6, 25, d.elevation);

/** Extra ambient at night, so a moonlit face is readable and not black on a phone: x4 at full night, 1 by day. */
export const NIGHT_LIFT = 4;

export function ambientColour(d: SkyData): Vec3 {
  const z = hexToLinear(d.gradient[0]);
  const k = AMBIENT_GAIN * (1 + (NIGHT_LIFT - 1) * coldness(d));
  return [z[0] * k, z[1] * k, z[2] * k];
}

/** The colour distance fades to: the gradient's horizon stop, linear. */
export const hazeColour = (d: SkyData): Vec3 => hexToLinear(d.gradient[d.gradient.length - 1]);

/** Haze: transmittance T = exp(-k d) at distance d metres. */
export const HAZE_K = 0.0004;
export const transmittance = (distance: number): number =>
  Math.exp(-HAZE_K * Math.max(0, distance));

/**
 * Linear colour of a surface: lambert from the sun plus ambient (full on an upward face, half on a
 * vertical one, none on a downward one: `0.5 + 0.5 n.y`), then hazed toward the horizon colour by distance.
 * `normal` is a unit vector. Never negative, whatever the sun does.
 */
export function shade(d: SkyData, albedo: Vec3, normal: Vec3, distance: number): Vec3 {
  const sun = sunDirection(d);
  const lambert = Math.max(0, normal[0] * sun[0] + normal[1] * sun[1] + normal[2] * sun[2]);
  const direct = sunColour(d);
  const amb = ambientColour(d);
  const hemi = 0.5 + 0.5 * normal[1];
  const haze = hazeColour(d);
  const t = transmittance(distance);
  return [0, 1, 2].map((i) => {
    const lit = albedo[i] * (direct[i] * lambert + amb[i] * Math.max(0, hemi));
    return lit * t + haze[i] * (1 - t);
  }) as unknown as Vec3;
}

export const skyData = (name: SkyName): SkyData => SKY[name];
