// Sun and sky light for a place and a moment. Dependency-free ES module: no DOM,
// no imports, so a build-time token script and a runtime shader can share it.
//
//   light({ time, lat, lon, cloud_cover = 0, precipitation = 0 })
//     -> { elevation, azimuth, direct: [r,g,b], diffuse: [r,g,b], wetness }
//
//   time           Date, epoch milliseconds, or an ISO string (read as UTC)
//   lat, lon       degrees, north and east positive
//   cloud_cover    0..1 (Open-Meteo reports percent: divide by 100)
//   precipitation  mm/h
//   elevation      degrees above the horizon, no refraction
//   azimuth        degrees clockwise from north (0 N, 90 E, 180 S), 0..360, no refraction
//   direct         sun colour at normal incidence, linear RGB. Clear zenith sun ~ 1.
//                  The consumer multiplies by max(0, dot(normal, toSun)).
//   diffuse        sky ambient on an upward surface, linear RGB
//   wetness        0..1, how soaked surfaces are right now; darkens bark and soil
//
// Everything marked EYEBALLED is a tuned constant, not a measurement. Change it
// by looking at the result. Sun position follows the low-precision NOAA/Meeus
// series, good to about a hundredth of a degree for 1900..2100.

const RAD = Math.PI / 180;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

const toMs = (time) => (time instanceof Date ? time.getTime() : typeof time === 'string' ? Date.parse(time) : Number(time));

/** Sun elevation and azimuth in degrees at a UTC moment and place. Azimuth runs clockwise from north. */
export function sunPosition(time, lat, lon) {
  const d = toMs(time) / 86400000 - 10957.5; // days since J2000.0 (2000-01-01 12:00 UTC)
  const L = (280.46 + 0.9856474 * d) * RAD; // mean longitude
  const g = (357.528 + 0.9856003 * d) * RAD; // mean anomaly
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const eps = (23.439 - 0.0000004 * d) * RAD; // obliquity
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (280.46061837 + 360.98564736629 * d) * RAD;
  const hourAngle = gmst + lon * RAD - ra;
  const phi = lat * RAD;
  const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle);
  // Hour angle is westward-positive, so atan2 gives azimuth from south, westward; +180 turns it into
  // clockwise from north.
  const south = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return {
    elevation: Math.asin(clamp(sinEl, -1, 1)) / RAD,
    azimuth: (((south / RAD + 180) % 360) + 360) % 360,
  };
}

/** Sun elevation in degrees at a UTC moment and place. */
export const sunElevation = (time, lat, lon) => sunPosition(time, lat, lon).elevation;

// Optical depth of the clear atmosphere at the zenith, per channel (R, G, B).
// Rayleigh at 650/550/450 nm plus a little ozone and haze (EYEBALLED to keep
// low sun orange rather than brown).
export const TAU = [0.06, 0.12, 0.26];

// Relative air mass, Kasten & Young 1989. Elevation in degrees, >= 0.
const airMass = (el) => 1 / (Math.sin(el * RAD) + 0.50572 * Math.pow(el + 6.07995, -1.6364));

// Zenith sky colour and brightness. EYEBALLED.
const SKY_DAY = [0.22, 0.42, 0.85]; // blue, linear
const SKY_DAY_LEVEL = 0.3; // clear-noon ambient relative to direct = 1
const SKY_TWILIGHT = [0.5, 0.35, 0.55]; // warm violet at the horizon (weight 0.05 below)
const SKY_NIGHT = [0.004, 0.006, 0.015]; // starlight and airglow floor

const GREY_TINT = [0.95, 1, 1.08]; // cool overcast. EYEBALLED
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export function light({ time, lat, lon, cloud_cover = 0, precipitation = 0 }) {
  const { elevation, azimuth } = sunPosition(time, lat, lon);
  const cloud = clamp(cloud_cover, 0, 1);
  const rain = Math.max(0, precipitation);

  // Rain implies cloud: even a reported 0 % cover goes grey once it is falling. EYEBALLED.
  const overcast = Math.max(cloud, smooth(0, 1, rain) * 0.85);

  // Direct sun: attenuated per channel along the air mass, off at the horizon.
  // Disc fully gone at -0.83 deg (centre below the upper limb); soft to 1.5 deg. EYEBALLED fade.
  const above = smooth(-0.83, 1.5, elevation);
  const m = elevation > 0 ? airMass(elevation) : airMass(0);
  const clearDirect = TAU.map((tau) => Math.exp(-tau * m) * above);
  // Cloud takes the sun away fast: 50 % cover leaves about a third. EYEBALLED.
  const directKeep = Math.pow(1 - overcast, 1.6);
  const direct = clearDirect.map((c) => c * directKeep);

  // Sky ambient: blue by day, a violet band around sunset, a floor at night.
  const dayAmount = smooth(-6, 10, elevation);
  const twilight = smooth(-18, -2, elevation) * (1 - smooth(-2, 8, elevation));
  const clearSky = SKY_NIGHT.map((night, i) => night + SKY_DAY[i] * SKY_DAY_LEVEL * dayAmount + SKY_TWILIGHT[i] * 0.05 * twilight);

  // Cloud: part of the sun's lost light is scattered into the sky (EYEBALLED 0.3),
  // and the colour drifts to a cool grey (EYEBALLED tint and 0.7 pull).
  const lostLuma = luma(clearDirect) * (1 - directKeep);
  const scattered = clearSky.map((c) => c + lostLuma * 0.3);
  const grey = luma(scattered);
  const rainDim = mix(1, 0.8, smooth(0, 4, rain)); // heavy rain darkens the sky. EYEBALLED
  const diffuse = scattered.map((c, i) => mix(c, grey * GREY_TINT[i], overcast * 0.7) * rainDim);

  // Surfaces take time to dry, but this is a point sample of the feed:
  // 0 dry, ~0.63 at 1 mm/h, ~0.98 at 4 mm/h. EYEBALLED.
  const wetness = 1 - Math.exp(-rain);

  return { elevation, azimuth, direct, diffuse, wetness };
}
