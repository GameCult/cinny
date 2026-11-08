// Atmospheric scattering tables, baked for a WebGL2 shader (layout: src/sky/README.md).
// Dependency-free apart from sun.js, so scripts/bake-sky.mjs and the tests run it under plain node.
//
//   bakeScatter() -> { transmittance, sky_view, ... } with base64 RGB16F tables (half floats).
//
// A Hillaire-style single-scattering model (Rayleigh + Mie, spherical planet, observer 100 m up),
// reduced to two small tables: the transmittance of the whole atmosphere along a view direction, and
// the sky's radiance by sun elevation, view elevation and azimuth from the sun. sun.js stays the
// single source of the air: its zenith optical depths (TAU, per channel) are the vertical optical
// depth of this atmosphere, split into a grey aerosol part and a Rayleigh part. So the direct sun
// sun.js returns and the transmittance here agree at the zenith; only the air-mass law differs
// (Kasten-Young there, the spherical integral here).

import { TAU } from './sun.js';

const RAD = Math.PI / 180;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Geometry (km) and scale heights.
export const PLANET_RADIUS_KM = 6360;
export const ATMOSPHERE_HEIGHT_KM = 100;
export const OBSERVER_ALTITUDE_KM = 0.1;
const H_RAYLEIGH = 8;
const H_MIE = 1.2;
const MIE_ALBEDO = 0.9; // single-scattering albedo of the aerosol (EYEBALLED)
const MIE_G = 0.8; // Henyey-Greenstein asymmetry (Hillaire 2020)
const MIE_TAU = 0.02; // grey aerosol vertical optical depth (EYEBALLED); the rest of TAU is Rayleigh

// Vertical optical depth of an exponential layer of scale height H over the atmosphere.
const column = (H) => H * (1 - Math.exp(-ATMOSPHERE_HEIGHT_KM / H));
const BETA_RAYLEIGH = TAU.map((tau) => (tau - MIE_TAU) / column(H_RAYLEIGH)); // per km at sea level
const BETA_MIE_EXT = MIE_TAU / column(H_MIE);
const BETA_MIE_SCA = BETA_MIE_EXT * MIE_ALBEDO;

// Table axes.
export const SUN_ELEVATIONS_DEG = [-18, -12, -8, -5, -2, 0, 3, 8, 15, 25, 45, 90];
export const VIEW_SAMPLES = 32;
export const AZIMUTH_SAMPLES = 7; // 0, 30, ... 180 degrees from the sun
export const AZIMUTH_STEP_DEG = 30;
export const VIEW_MIN_DEG = -4;
export const VIEW_MAX_DEG = 90;
// Tables hold IEEE 754 half floats, little-endian, holding value * STORE_SCALE. The scale lifts the
// dark end (twilight sky radiance is ~1e-4) clear of the half-float subnormals; the brightest
// stored value, a Mie peak near 0.3 x 64, is far below the format's 65504.
export const STORE_SCALE = 64;

/** View elevation in degrees of sample index i of VIEW_SAMPLES: finest at the horizon. */
export const viewElevation = (i) =>
  VIEW_MIN_DEG + (VIEW_MAX_DEG - VIEW_MIN_DEG) * (i / (VIEW_SAMPLES - 1)) ** 2;

/** Fractional index into SUN_ELEVATIONS_DEG of a sun elevation (clamped to the table): the z texel coordinate. */
export const sunIndex = (elevationDeg) => {
  const e = clamp(
    elevationDeg,
    SUN_ELEVATIONS_DEG[0],
    SUN_ELEVATIONS_DEG[SUN_ELEVATIONS_DEG.length - 1]
  );
  const k = Math.min(SUN_ELEVATIONS_DEG.findIndex((x) => x > e) - 1, SUN_ELEVATIONS_DEG.length - 2);
  const i = k < 0 ? SUN_ELEVATIONS_DEG.length - 2 : k;
  return i + (e - SUN_ELEVATIONS_DEG[i]) / (SUN_ELEVATIONS_DEG[i + 1] - SUN_ELEVATIONS_DEG[i]);
};

/** Inverse of viewElevation: the fractional sample index of an elevation. */
export const viewIndex = (elevationDeg) =>
  Math.sqrt(clamp((elevationDeg - VIEW_MIN_DEG) / (VIEW_MAX_DEG - VIEW_MIN_DEG), 0, 1)) *
  (VIEW_SAMPLES - 1);

/** Round a non-negative number to the nearest IEEE 754 half float (ties to even); returns its 16 bits. */
export function toHalf(x) {
  if (!(x > 0)) return 0;
  const u = new Uint32Array(new Float32Array([x]).buffer)[0];
  const exp = ((u >> 23) & 0xff) - 127 + 15;
  const mant = u & 0x7fffff;
  if (exp >= 31) return 0x7bff;
  let half;
  let rem;
  let halfway;
  if (exp <= 0) {
    if (exp < -10) return 0;
    const m = mant | 0x800000;
    const shift = 14 - exp;
    half = m >> shift;
    rem = m & ((1 << shift) - 1);
    halfway = 1 << (shift - 1);
  } else {
    half = (exp << 10) | (mant >> 13);
    rem = mant & 0x1fff;
    halfway = 0x1000;
  }
  return rem > halfway || (rem === halfway && half & 1) ? half + 1 : half;
}

/** The exact value of 16 half-float bits (finite values only). */
export const fromHalf = (h) => {
  const e = (h >> 10) & 31;
  const m = h & 1023;
  return e === 0 ? m * 2 ** -24 : (1 + m / 1024) * 2 ** (e - 15);
};

/** Stored 16 bits of a value, and the value back out of them. */
export const encode = (v) => toHalf(v * STORE_SCALE);
export const decode = (h) => fromHalf(h) / STORE_SCALE;

const extinction = (h) => {
  const r = Math.exp(-h / H_RAYLEIGH);
  const m = Math.exp(-h / H_MIE);
  return BETA_RAYLEIGH.map((b) => b * r + BETA_MIE_EXT * m);
};

// Distance along ray (origin o, unit direction d) to the sphere of radius r centred on the origin
// of the planet: the far root, or the near root if `near`. Infinity when it misses or is behind.
function sphereHit(o, d, r, near) {
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  const t = near ? -b - sq : -b + sq;
  return t > 0 ? t : Infinity;
}

// Optical depth per channel from p along d to the top of the atmosphere; Infinity if the planet is in the way.
function opticalDepthToSpace(p, d, steps) {
  if (sphereHit(p, d, PLANET_RADIUS_KM, true) !== Infinity) return null;
  const top = sphereHit(p, d, PLANET_RADIUS_KM + ATMOSPHERE_HEIGHT_KM, false);
  const dt = top / steps;
  const depth = [0, 0, 0];
  for (let k = 0; k < steps; k += 1) {
    const t = (k + 0.5) * dt;
    const q = [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
    const e = extinction(Math.hypot(...q) - PLANET_RADIUS_KM);
    for (let c = 0; c < 3; c += 1) depth[c] += e[c] * dt;
  }
  return depth;
}

const observer = [0, PLANET_RADIUS_KM + OBSERVER_ALTITUDE_KM, 0];
const viewDirection = (elevationDeg, azimuthDeg) => {
  const e = elevationDeg * RAD;
  const a = azimuthDeg * RAD;
  return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
};
const sunDirection = (elevationDeg) => [
  Math.cos(elevationDeg * RAD),
  Math.sin(elevationDeg * RAD),
  0,
];

/** Transmittance per channel from the observer along an elevation to space; zeros where the ground is in the way. */
export function transmittance(elevationDeg) {
  const depth = opticalDepthToSpace(observer, viewDirection(elevationDeg, 0), 64);
  return depth ? depth.map((x) => Math.exp(-x)) : [0, 0, 0];
}

const rayleighPhase = (c) => (3 / (16 * Math.PI)) * (1 + c * c);
const miePhase = (c) =>
  (1 - MIE_G * MIE_G) / (4 * Math.PI * (1 + MIE_G * MIE_G - 2 * MIE_G * c) ** 1.5);

/**
 * Sky radiance per channel, per steradian, for a sun of unit irradiance (so the consumer multiplies by
 * its own sun colour), in a view direction at an elevation and an azimuth measured from the sun.
 * Single scattering, no ground bounce, no sun disc.
 */
export function skyRadiance(sunElevationDeg, viewElevationDeg, azimuthDeg) {
  const v = viewDirection(viewElevationDeg, azimuthDeg);
  const s = sunDirection(sunElevationDeg);
  const cosTheta = v[0] * s[0] + v[1] * s[1] + v[2] * s[2];
  const pr = rayleighPhase(cosTheta);
  const pm = miePhase(cosTheta);
  const ground = sphereHit(observer, v, PLANET_RADIUS_KM, true);
  const top = sphereHit(observer, v, PLANET_RADIUS_KM + ATMOSPHERE_HEIGHT_KM, false);
  const end = Math.min(ground, top);
  const steps = 24;
  const dt = end / steps;
  const along = [0, 0, 0];
  const radiance = [0, 0, 0];
  for (let k = 0; k < steps; k += 1) {
    const t = (k + 0.5) * dt;
    const q = [observer[0] + v[0] * t, observer[1] + v[1] * t, observer[2] + v[2] * t];
    const h = Math.hypot(...q) - PLANET_RADIUS_KM;
    const e = extinction(h);
    for (let c = 0; c < 3; c += 1) along[c] += e[c] * dt;
    const toSun = opticalDepthToSpace(q, s, 12);
    if (toSun) {
      const r = Math.exp(-h / H_RAYLEIGH);
      const m = Math.exp(-h / H_MIE);
      for (let c = 0; c < 3; c += 1) {
        const scatter = BETA_RAYLEIGH[c] * r * pr + BETA_MIE_SCA * m * pm;
        radiance[c] += Math.exp(-along[c] - toSun[c]) * scatter * dt;
      }
    }
  }
  return radiance;
}

const base64 = (halves) => {
  const bytes = new Uint8Array(halves.length * 2);
  halves.forEach((h, i) => {
    bytes[i * 2] = h & 0xff; // little-endian
    bytes[i * 2 + 1] = h >> 8;
  });
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
};

export function bakeScatter() {
  const view = Array.from({ length: VIEW_SAMPLES }, (_, i) => viewElevation(i));

  const t = new Uint16Array(VIEW_SAMPLES * 3);
  view.forEach((e, i) => transmittance(e).forEach((v, c) => (t[i * 3 + c] = encode(v))));

  // x = azimuth, y = view elevation, z = sun elevation, three half floats per texel: a 3D texture.
  const sky = new Uint16Array(SUN_ELEVATIONS_DEG.length * VIEW_SAMPLES * AZIMUTH_SAMPLES * 3);
  let at = 0;
  SUN_ELEVATIONS_DEG.forEach((sun) =>
    view.forEach((e) => {
      for (let a = 0; a < AZIMUTH_SAMPLES; a += 1) {
        skyRadiance(sun, e, a * AZIMUTH_STEP_DEG).forEach((v) => {
          sky[at] = encode(v);
          at += 1;
        });
      }
    })
  );

  return {
    planet_radius_km: PLANET_RADIUS_KM,
    atmosphere_height_km: ATMOSPHERE_HEIGHT_KM,
    observer_altitude_km: OBSERVER_ALTITUDE_KM,
    // Extinction per km at the observer, per channel, for aerial perspective: exp(-k * distance_km).
    extinction_per_km: extinction(OBSERVER_ALTITUDE_KM),
    format: 'half-float',
    store_scale: STORE_SCALE,
    view_elevation_deg: { min: VIEW_MIN_DEG, max: VIEW_MAX_DEG, samples: VIEW_SAMPLES },
    transmittance: { width: VIEW_SAMPLES, height: 1, channels: 3, data: base64(t) },
    sky_view: {
      sun_elevations_deg: SUN_ELEVATIONS_DEG,
      azimuth_step_deg: AZIMUTH_STEP_DEG,
      width: AZIMUTH_SAMPLES,
      height: VIEW_SAMPLES,
      depth: SUN_ELEVATIONS_DEG.length,
      channels: 3,
      data: base64(sky),
    },
  };
}
