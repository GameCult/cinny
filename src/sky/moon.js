// The moon for a place and a moment. Dependency-free ES module beside sun.js, whose sidereal transform it shares.
//
//   moonEquatorial(time)  -> { ra, dec, distanceKm, lambda, beta }   radians, of date
//   moonPhase(time)       -> { elongationDeg, phaseAngleDeg, illuminated, waxing }
//   moonPosition(time, lat, lon) -> { elevation, azimuth }           degrees, topocentric, no refraction
//
// Position is the low-precision series of the Astronomical Almanac (section D, "Low precision formulae for the Moon", T in Julian
// centuries from J2000.0): about 0.3 degrees in longitude and 0.2 in latitude, a few hundred km in distance, for 1950..2050.
// Phase is the elongation from the sun (sun.js) and the phase angle of Meeus, "Astronomical Algorithms", 2nd ed., eq. 48.3.

import { daysSinceJ2000, equatorialToHorizontal, sunEquatorial } from './sun.js';

const RAD = Math.PI / 180;
const EARTH_RADIUS_KM = 6378.14;
const AU_KM = 149597870.7;

const sinD = (deg) => Math.sin(deg * RAD);
const cosD = (deg) => Math.cos(deg * RAD);

/** The moon's ecliptic longitude and latitude (radians), horizontal parallax (radians) and distance (km), of date. */
function moonEcliptic(time) {
  const T = daysSinceJ2000(time) / 36525;
  const lambda =
    218.32 +
    481267.881 * T +
    6.29 * sinD(135.0 + 477198.87 * T) -
    1.27 * sinD(259.3 - 413335.36 * T) +
    0.66 * sinD(235.7 + 890534.22 * T) +
    0.21 * sinD(269.9 + 954397.74 * T) -
    0.19 * sinD(357.5 + 35999.05 * T) -
    0.11 * sinD(186.5 + 966404.03 * T);
  const beta =
    5.13 * sinD(93.3 + 483202.02 * T) +
    0.28 * sinD(228.2 + 960400.89 * T) -
    0.28 * sinD(318.3 + 6003.15 * T) -
    0.17 * sinD(217.6 - 407332.21 * T);
  const parallax =
    0.9508 +
    0.0518 * cosD(135.0 + 477198.87 * T) +
    0.0095 * cosD(259.3 - 413335.36 * T) +
    0.0078 * cosD(235.7 + 890534.22 * T) +
    0.0028 * cosD(269.9 + 954397.74 * T);
  return {
    lambda: lambda * RAD,
    beta: beta * RAD,
    parallax: parallax * RAD,
    distanceKm: EARTH_RADIUS_KM / Math.sin(parallax * RAD),
  };
}

/** Right ascension, declination (radians, of date), distance (km) and ecliptic coordinates (radians) of the moon at a UTC moment. */
export function moonEquatorial(time) {
  const { lambda, beta, distanceKm } = moonEcliptic(time);
  const l = Math.cos(beta) * Math.cos(lambda);
  const m = 0.9175 * Math.cos(beta) * Math.sin(lambda) - 0.3978 * Math.sin(beta);
  const n = 0.3978 * Math.cos(beta) * Math.sin(lambda) + 0.9175 * Math.sin(beta);
  return { ra: Math.atan2(m, l), dec: Math.asin(n), distanceKm, lambda, beta };
}

/**
 * The phase at a UTC moment. `elongationDeg` is the geocentric angle sun-earth-moon side: 0 new, 90 first quarter, 180 full, 270 last quarter
 * (by the longitude difference, so it runs the whole circle). `phaseAngleDeg` is the angle sun-moon-earth: 0 full, 180 new. `illuminated` is
 * the lit fraction of the disc, (1 + cos i) / 2.
 */
export function moonPhase(time) {
  const moon = moonEquatorial(time);
  const sun = sunEquatorial(time);
  const sunDistanceKm = AU_KM;
  const cosPsi = Math.cos(moon.beta) * Math.cos(moon.lambda - sun.lambda);
  const psi = Math.acos(Math.min(1, Math.max(-1, cosPsi)));
  const i = Math.atan2(sunDistanceKm * Math.sin(psi), moon.distanceKm - sunDistanceKm * Math.cos(psi));
  const elongationDeg = ((((moon.lambda - sun.lambda) / RAD) % 360) + 360) % 360;
  return {
    elongationDeg,
    phaseAngleDeg: i / RAD,
    illuminated: (1 + Math.cos(i)) / 2,
    waxing: elongationDeg < 180,
    distanceKm: moon.distanceKm,
  };
}

/** Elevation and azimuth of the moon in degrees at a UTC moment and place, topocentric (the parallax lowers it up to a degree), no refraction. Azimuth clockwise from north. */
export function moonPosition(time, lat, lon) {
  const m = moonEquatorial(time);
  const { elevation, azimuth } = equatorialToHorizontal(m.ra, m.dec, time, lat, lon);
  const parallaxDeg = Math.asin(EARTH_RADIUS_KM / m.distanceKm) / RAD;
  return { elevation: elevation - parallaxDeg * cosD(elevation), azimuth };
}
