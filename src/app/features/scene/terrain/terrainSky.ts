// Lighting, haze and sky for the terrain scene, as pure functions of one sky's baked numbers (src/sky/baked.ts, Void's
// bake, GameCult/Void PR #22). No DOM, no GL. The fragment shaders do the same arithmetic with these results as uniforms.
import { baked } from '../../../../sky/baked';
import { isNight } from '../ridge/stars';
import { skyColours } from '../ridge/skyColour';
import type { SkyColours } from '../ridge/skyColour';
import { HORIZON_FLOOR, scatterRadiance, transmittanceAt } from './terrainScatter';

export type SkyName = 'midnight' | 'noonday';
export type Vec3 = readonly [number, number, number];

export interface SkyData {
  /** Degrees above the horizon, no refraction. Negative: the sun is down. */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Sun colour at normal incidence, linear RGB. Black when the sun is down. */
  direct: Vec3;
  /** Sky ambient on an upward surface, linear RGB; at night a moonlit floor, not black. */
  ambient: Vec3;
  /** The horizon, linear RGB: the baked `horizon_hex`. */
  horizon: Vec3;
}

const RAD = Math.PI / 180;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mixVec = (a: Vec3, b: Vec3, t: number): Vec3 =>
  [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as unknown as Vec3;

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

const fromBaked = (b: typeof baked.midnight | typeof baked.noonday): SkyData => ({
  elevation: b.sun.elevation_deg,
  azimuth: b.sun.azimuth_deg,
  direct: b.sun.color_linear,
  ambient: b.ambient_linear,
  horizon: hexToLinear(b.horizon_hex),
});

export const SKY: Record<SkyName, SkyData> = {
  midnight: fromBaked(baked.midnight),
  noonday: fromBaked(baked.noonday),
};

export const skyData = (name: SkyName): SkyData => SKY[name];

/**
 * A sky for a sun at any elevation, between the two baked ones. The sun's colour is the baked transmittance at
 * that elevation, faded out across the disc's last degrees the way sun.js does (gone at -0.83, whole by 1.5);
 * ambient and horizon blend from the midnight bake to the noonday one as the sun climbs from -8 to 25 degrees.
 */
export function skyAtSun(elevation: number, azimuth: number = SKY.noonday.azimuth): SkyData {
  const day = smooth(-8, 25, elevation);
  const fade = smooth(-0.83, 1.5, elevation);
  const t = transmittanceAt(Math.max(elevation, -4));
  return {
    elevation,
    azimuth,
    direct: [t[0] * fade, t[1] * fade, t[2] * fade],
    ambient: mixVec(SKY.midnight.ambient, SKY.noonday.ambient, day),
    horizon: mixVec(SKY.midnight.horizon, SKY.noonday.horizon, day),
  };
}

/** Unit vector toward the sun: x east, y up, z south (so azimuth 0, north, is -z). */
export function sunDirection(d: SkyData): Vec3 {
  const el = d.elevation * RAD;
  const az = d.azimuth * RAD;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

/** 0 with the sun well up, 1 once it is below -6 degrees (civil twilight over): the night notion the palette shares. */
export const coldness = (d: SkyData): number => 1 - smooth(-6, 25, d.elevation);

/** The colour distance fades to when the air has nothing to scatter: the baked horizon. Albedo tints toward it at night. */
export const hazeColour = (d: SkyData): Vec3 => d.horizon;

/** Sky radiance (see the sun's `skyScatter` in terrainScatter.ts) is for unit sun irradiance; this lifts it to the image. EYEBALLED. */
export const SKY_EXPOSURE = 45;
/** How far the night glow dims from the horizon to the zenith (1 at the horizon). EYEBALLED. */
export const GLOW_ZENITH = 0.75;

/** 1 with the sun below -4 degrees, 0 above 4: where the midnight horizon colour stands in for light the single-scattering tables lack. */
export const nightness = (elevation: number): number => 1 - smooth(-4, 4, elevation);

/** The night glow colour: the midnight bake's horizon, fading out as the sun nears the horizon (whatever horizon the day blend gives `d`). */
export const glowColour = (d: SkyData): Vec3 => {
  const k = nightness(d.elevation);
  const h = SKY.midnight.horizon;
  return [h[0] * k, h[1] * k, h[2] * k];
};

/**
 * Linear colour of the sky along a unit view direction (x east, y up, z south): the baked single-scattering
 * radiance for this sun, lifted by SKY_EXPOSURE and tone-mapped `1 - exp(-x)`, plus the night glow, which sits
 * brightest at the horizon; at and below the horizon, the horizon's colour. The fragment shader does the same.
 */
export function skyColour(d: SkyData, dir: Vec3): Vec3 {
  const el = Math.max(HORIZON_FLOOR, Math.asin(Math.min(1, Math.max(-1, dir[1]))) / RAD);
  const sun = sunDirection(d);
  const h = Math.hypot(dir[0], dir[2]);
  const s = Math.hypot(sun[0], sun[2]);
  const az =
    h < 1e-4 || s < 1e-4
      ? 0
      : Math.acos(Math.min(1, Math.max(-1, (dir[0] * sun[0] + dir[2] * sun[2]) / (h * s)))) / RAD;
  const r = scatterRadiance(d.elevation, el, az);
  const glow = glowColour(d);
  const shape = 1 + (GLOW_ZENITH - 1) * Math.sqrt(clamp01(dir[1]));
  return [0, 1, 2].map(
    (i) => 1 - Math.exp(-SKY_EXPOSURE * r[i]) + glow[i] * shape
  ) as unknown as Vec3;
}

/**
 * Haze: transmittance T = exp(-(k d)^HAZE_POWER) at distance d metres. The power above 1 keeps the near and middle
 * ground at its own colour and lets only the far ridges melt toward the sky; a plain exp(-k d) greyed everything.
 */
export const HAZE_K = 0.0007;
export const HAZE_POWER = 1.6;
export const transmittance = (distance: number): number =>
  Math.exp(-((HAZE_K * Math.max(0, distance)) ** HAZE_POWER));

/** Added to the ambient on a dark sky, scaled by `nightness`: the baked night floor is too dark to show any form on a phone. */
export const NIGHT_AMBIENT_LIFT = 3;
/** Cool light from the mirror of the sun's below-horizon position, linear, scaled by `nightness`: gives the terrain a lit side at night. */
export const MOON_COLOUR: Vec3 = [0.05, 0.07, 0.13];

/** The light on the ground: the sun, or at night the moon standing where the sun is mirrored above the horizon. Continuous through sunset. */
export function groundLight(d: SkyData): { dir: Vec3; colour: Vec3; ambient: Vec3 } {
  const sun = sunDirection(d);
  const k = nightness(d.elevation);
  return {
    dir: [sun[0], Math.abs(sun[1]), sun[2]],
    colour: [0, 1, 2].map((i) => d.direct[i] + MOON_COLOUR[i] * k) as unknown as Vec3,
    ambient: [0, 1, 2].map((i) => d.ambient[i] * (1 + NIGHT_AMBIENT_LIFT * k)) as unknown as Vec3,
  };
}

/**
 * The heading the camera starts at, in turns from north: the noonday sun a hundred degrees to its right, so the light
 * rakes across the relief instead of flattening it from behind. Fixed, so `?az=` still moves the sun in the picture.
 */
export const START_TURNS = ((SKY.noonday.azimuth - 100) / 360 + 1) % 1;

/**
 * Linear colour of a surface seen along the unit direction `view` (from the eye to the surface): lambert from
 * the ground light plus ambient (full on an upward face, half on a vertical one, none on a downward one: `0.5 + 0.5 n.y`),
 * then hazed by distance toward the sky at the horizon in that direction. `normal` is a unit vector. Never negative.
 */
export function shade(d: SkyData, albedo: Vec3, normal: Vec3, distance: number, view: Vec3): Vec3 {
  const light = groundLight(d);
  const sun = light.dir;
  const lambert = Math.max(0, normal[0] * sun[0] + normal[1] * sun[1] + normal[2] * sun[2]);
  const hemi = 0.5 + 0.5 * normal[1];
  const flat = Math.hypot(view[0], view[2]) || 1;
  const haze = skyColour(d, [view[0] / flat, 0, view[2] / flat]);
  const t = transmittance(distance);
  return [0, 1, 2].map((i) => {
    const lit = albedo[i] * (light.colour[i] * lambert + light.ambient[i] * Math.max(0, hemi));
    return lit * t + haze[i] * (1 - t);
  }) as unknown as Vec3;
}

/** The sky to use: a sun elevation from the option or `?sun=` (with `?az=`), else the baked sky from the option, then `?sky=midnight|noonday`, then the night notion of `skyColours()`. */
export function chooseSky(opts: {
  sky?: SkyName;
  sun?: { elevation: number; azimuth?: number };
}): SkyData {
  const q = new URLSearchParams(window.location.search);
  const number = (key: string) => (q.get(key)?.trim() ? Number(q.get(key)) : NaN);
  const elevation = opts.sun?.elevation ?? number('sun');
  if (Number.isFinite(elevation)) {
    const azimuth = opts.sun?.azimuth ?? number('az');
    return skyAtSun(elevation, Number.isFinite(azimuth) ? azimuth : undefined);
  }
  if (opts.sky) return skyData(opts.sky);
  const name = q.get('sky');
  return skyData(isSkyName(name) ? name : skyNameFor(skyColours()));
}
