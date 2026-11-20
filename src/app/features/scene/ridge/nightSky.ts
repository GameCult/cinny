// The night's light and bodies, in the units of the day sky: radiance per unit of the sun's irradiance (`skyDome.ts`). The sun is 1; the moon
// is its brightness by phase (Krisciunas & Schaefer 1991) times the atmosphere's response to a light at the moon's elevation
// (`earthAtmosphere.ts`, the same sky-view LUT, baked for the moon instead of the sun); the airglow is a floor; a star is its illuminance
// over the point spread it is drawn with. Everything marked EYEBALLED is a knob of the look, tuned by eye, not a measurement.
import { moonPhase, moonPosition } from '../../../../sky/moon.js';
import type { Atmosphere, Vec3 } from './earthAtmosphere';
import type { Place } from './view';

const RAD = Math.PI / 180;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Illuminance in lux of a source of apparent visual magnitude `m` above the atmosphere (V = 0 is 2.13e-6 lux; the sun, V = -26.74, 1.06e5). */
export const luxOfMagnitude = (m: number): number => 10 ** (-0.4 * (m + 14.18));
export const SUN_V = -26.74;
/** The sun's illuminance, the unit of every radiance of the ridge sky. */
export const SUN_LUX = luxOfMagnitude(SUN_V);

/** The look of the night's bodies. EYEBALLED knobs: the operator tunes these by eye. */
export const NIGHT_LOOK = {
  /** Radius of the point spread a star's light is spread over, arcminutes: smaller is brighter and more of them saturate. */
  starPsfArcmin: 2.5,
  /** Atmospheric extinction in magnitudes per air mass (V band, a clean low site is 0.2). */
  extinctionPerAirmass: 0.2,
  /**
   * Display contrast of a star over its sky is the physical contrast to this power (1 = physical): the eye and a camera cannot show a
   * mag 0 star at the 1e4:1 it has over a dark sky. Brightest stars still saturate; the faintest keep a little.
   */
  starContrastExp: 0.65,
  /** The same for the moon's disc (physical contrast is 1e7 and more). */
  moonContrastExp: 0.3,
  /** Visible radius of a star, CSS px: `base` for the faintest, plus `perMag` for each magnitude brighter than 5.5. */
  starRadius: { base: 0.65, perMag: 0.22 },
  /** The moon's disc, as a multiple of its true angular size (1 is true; a viewer's eye sees it larger than a lens does). */
  moonScale: 1,
  /** Earthshine on the unlit part of the disc, as a fraction of the lit surface's radiance. */
  earthshine: 4e-5,
  /** Constellation lines: opacity of the stroke (a pale blue-white) and its width in CSS px. */
  lines: { alpha: 0.22, widthPx: 0.9, rgb: [160, 185, 235] as const },
};

// ---- Airglow ----------------------------------------------------------------------------------

/** Natural night-sky radiance at the zenith without moon or town, cd/m^2 (about 22 V mag/arcsec^2: 2.5e-4). */
export const AIRGLOW_CD = 2.5e-4;
/** Its colour, linear, luminance 1 (a faint cool grey). EYEBALLED. */
const AIRGLOW_TINT: Vec3 = [0.95, 1, 1.1];
const AIRGLOW_NORM = 0.2126 * 0.95 + 0.7152 + 0.0722 * 1.1;

/** The airglow floor, per unit of sun irradiance, at view elevation sine `vz` (brighter toward the horizon, van Rhijn). */
export function airglow(vz: number, out: number[]): void {
  const k = ((AIRGLOW_CD / SUN_LUX) * (0.6 + 1.4 * (1 - clamp(vz, 0, 1)))) / AIRGLOW_NORM;
  out[0] += AIRGLOW_TINT[0] * k;
  out[1] += AIRGLOW_TINT[1] * k;
  out[2] += AIRGLOW_TINT[2] * k;
}

// ---- Moon --------------------------------------------------------------------------------------

/** The moon over a place at a moment, with its light. */
export interface MoonSample {
  /** Degrees clockwise from north, and above the horizon (topocentric, no refraction). */
  azimuth: number;
  elevation: number;
  time: Date;
  /** Lit fraction of the disc, and the sun-moon-earth angle in degrees (0 full, 180 new). */
  illuminated: number;
  phaseAngleDeg: number;
  waxing: boolean;
  distanceKm: number;
  /** Angular radius in radians. */
  radius: number;
  /** The moon's illuminance relative to the sun's: its light on the ground per unit of the sun's. */
  ratio: number;
}

/** The moon's visual magnitude at phase angle `alphaDeg`: Krisciunas & Schaefer 1991 (the Allen / Lane & Irvine fit) plus the distance. */
export const moonMagnitude = (alphaDeg: number, distanceKm: number): number => {
  const a = Math.abs(alphaDeg);
  return -12.73 + 0.026 * a + 4e-9 * a ** 4 + 5 * Math.log10(distanceKm / 384400);
};

/** The moon's illuminance over the sun's. At full moon about 2.5e-6. */
export const moonIrradianceRatio = (alphaDeg: number, distanceKm: number): number =>
  10 ** (-0.4 * (moonMagnitude(alphaDeg, distanceKm) - SUN_V));

export function moonAt(place: Place, time: Date): MoonSample {
  const p = moonPosition(time, place.lat, place.lon) as { elevation: number; azimuth: number };
  const ph = moonPhase(time) as {
    illuminated: number;
    phaseAngleDeg: number;
    waxing: boolean;
    distanceKm: number;
  };
  return {
    ...p,
    time,
    illuminated: ph.illuminated,
    phaseAngleDeg: ph.phaseAngleDeg,
    waxing: ph.waxing,
    distanceKm: ph.distanceKm,
    radius: Math.asin(1737.4 / ph.distanceKm),
    ratio: moonIrradianceRatio(ph.phaseAngleDeg, ph.distanceKm),
  };
}

/**
 * The radiance of the moon's lit surface per unit of sun irradiance: its flux over the lit area of the disc. About 4000 cd/m^2 at full moon.
 * `lit` is the lit fraction (at least a sliver, so a thin crescent's surface brightness stays finite).
 */
export const moonSurface = (m: MoonSample): number =>
  m.ratio / (Math.max(m.illuminated, 0.02) * Math.PI * m.radius * m.radius);

// ---- The night's light, as the dome and the cards read it ------------------------------------

/** What lights the sky besides the sun: the moon (its own atmosphere bake, scaled by `ratio`) and the airglow. */
export interface NightLight {
  moon?: { azimuth: number; elevation: number; atm: Atmosphere; ratio: number };
}

/**
 * Add the night's radiance (the moon's scattered light and the airglow, per unit of sun irradiance) for a view ray: `vz` the sine of its
 * elevation, `azRad` its azimuth in radians, written onto `out`.
 */
export function addNightRadiance(
  n: NightLight | undefined,
  vz: number,
  azRad: number,
  out: number[]
): void {
  airglow(vz, out);
  if (!n?.moon) return;
  const m = n.moon;
  const tmp = [0, 0, 0];
  m.atm.radiance(vz, Math.cos(azRad - m.azimuth * RAD), tmp);
  out[0] += tmp[0] * m.ratio;
  out[1] += tmp[1] * m.ratio;
  out[2] += tmp[2] * m.ratio;
}

// ---- Stars -------------------------------------------------------------------------------------

/** Relative air mass, Kasten & Young 1989. Elevation in degrees. */
export const airMass = (elDeg: number): number =>
  1 / (Math.sin(Math.max(elDeg, 0) * RAD) + 0.50572 * Math.pow(Math.max(elDeg, 0) + 6.07995, -1.6364));

/** A star's magnitude after the air: extinction per air mass along its elevation. */
export const extinguished = (mag: number, elDeg: number): number =>
  mag + NIGHT_LOOK.extinctionPerAirmass * airMass(elDeg);

/** Linear sRGB colour of a black body of temperature `t` kelvin at luminance 1 (Kim et al. 2002 Planckian locus, sRGB primaries). */
export function blackbodyRgb(t: number): Vec3 {
  const T = clamp(t, 1700, 24000);
  const x =
    T <= 4000
      ? -0.2661239e9 / T ** 3 - 0.2343589e6 / T ** 2 + 0.8776956e3 / T + 0.17991
      : -3.0258469e9 / T ** 3 + 2.1070379e6 / T ** 2 + 0.2226347e3 / T + 0.24039;
  const y =
    T <= 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : T <= 4000
      ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
      : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  const X = x / y;
  const Z = (1 - x - y) / y;
  const rgb = [
    3.2406 * X - 1.5372 - 0.4986 * Z,
    -0.9689 * X + 1.8758 + 0.0415 * Z,
    0.0557 * X - 0.204 + 1.057 * Z,
  ].map((c) => Math.max(0, c));
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return [rgb[0] / lum, rgb[1] / lum, rgb[2] / lum];
}

/** Effective temperature of a star from its B-V colour index (Ballesteros 2012). */
export const temperatureOfBV = (bv: number): number => {
  const c = clamp(bv, -0.4, 2);
  return 4600 * (1 / (0.92 * c + 1.7) + 1 / (0.92 * c + 0.62));
};

/** A star's radiance when seen through the point spread, per unit of sun irradiance: its illuminance over the spread's solid angle. */
export const starRadiance = (mag: number): number => {
  const r = (NIGHT_LOOK.starPsfArcmin / 60) * RAD;
  return luxOfMagnitude(mag) / (Math.PI * r * r) / SUN_LUX;
};

/** Perceptual compression of a body's contrast over the sky behind it: `bg` the sky's radiance, `add` the body's on top; the exponent 1 is physical. */
export const compressed = (bg: number, add: number, exp: number): number => {
  const b = Math.max(bg, 1e-30);
  return b * ((b + add) / b) ** exp;
};
