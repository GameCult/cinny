// The real stars and constellation lines of the night sky, placed for a place and a moment. The data is nightSkyData.ts (generated, J2000;
// see its header for sources); the sidereal transform is the sun's own (`src/sky/sun.js` equatorialToHorizontal), after precessing the
// J2000 positions to the date. Proper motion and nutation are left out: both are under an arcminute here.
import { daysSinceJ2000, equatorialToHorizontal } from '../../../../sky/sun.js';
import { LINES_B64, LINE_CHAINS, STARS_B64, STAR_COUNT } from './nightSkyData';

const RAD = Math.PI / 180;
const ARCSEC = RAD / 3600;

/** Faintest star drawn, by catalogue Vmag. The data is cut at 5.5. */
export const MAG_LIMIT = 5.5;

export interface CatalogueStar {
  /** J2000, radians. */
  ra: number;
  dec: number;
  /** Visual magnitude. */
  mag: number;
  /** B-V colour index. */
  bv: number;
}

const bytes = (b64: string): Uint8Array => {
  const bin = atob(b64.replace(/\s+/g, ''));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const raOf = (u16: number): number => (u16 / 65536) * 360 * RAD;
const decOf = (u16: number): number => ((u16 / 65535) * 180 - 90) * RAD;

let stars: CatalogueStar[] | undefined;
let chains: { ra: number; dec: number }[][] | undefined;

/** The catalogue, brightest first (decoded once). */
export function catalogue(): readonly CatalogueStar[] {
  if (!stars) {
    const b = bytes(STARS_B64);
    const v = new DataView(b.buffer);
    stars = Array.from({ length: STAR_COUNT }, (_, i) => ({
      ra: raOf(v.getUint16(i * 6, true)),
      dec: decOf(v.getUint16(i * 6 + 2, true)),
      mag: b[i * 6 + 4] / 20 - 2,
      bv: b[i * 6 + 5] / 50 - 0.5,
    }));
  }
  return stars;
}

/** The constellation figures: chains of J2000 vertices (decoded once). */
export function lineChains(): readonly { ra: number; dec: number }[][] {
  if (!chains) {
    const b = bytes(LINES_B64);
    const v = new DataView(b.buffer);
    const out: { ra: number; dec: number }[][] = [];
    let at = 0;
    while (at < b.length) {
      const n = b[at];
      at += 1;
      out.push(
        Array.from({ length: n }, (_, k) => ({
          ra: raOf(v.getUint16(at + k * 4, true)),
          dec: decOf(v.getUint16(at + k * 4 + 2, true)),
        }))
      );
      at += n * 4;
    }
    if (out.length !== LINE_CHAINS) throw new Error('nightSkyData: line chains do not match the header');
    chains = out;
  }
  return chains;
}

/** J2000 right ascension and declination (radians) precessed to the date of `time` (IAU 1976, Meeus, "Astronomical Algorithms" 21.2). */
export function precess(ra: number, dec: number, time: Date | number): [number, number] {
  const t = daysSinceJ2000(time) / 36525;
  const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t ** 3) * ARCSEC;
  const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t ** 3) * ARCSEC;
  const theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t ** 3) * ARCSEC;
  const a = Math.cos(dec) * Math.sin(ra + zeta);
  const b = Math.cos(theta) * Math.cos(dec) * Math.cos(ra + zeta) - Math.sin(theta) * Math.sin(dec);
  const c = Math.sin(theta) * Math.cos(dec) * Math.cos(ra + zeta) + Math.cos(theta) * Math.sin(dec);
  return [Math.atan2(a, b) + z, Math.asin(Math.max(-1, Math.min(1, c)))];
}

interface Horizontal {
  azimuth: number;
  elevation: number;
}

export interface PlacedStar extends CatalogueStar, Horizontal {
  /** Index into the catalogue. */
  index: number;
}

/** The stars at or above `minElevation` degrees (and no fainter than `magLimit`) for the moment and place, brightest first. Degrees; azimuth clockwise from north; no refraction. */
export function starsAt(
  time: Date,
  lat: number,
  lon: number,
  magLimit: number = MAG_LIMIT,
  minElevation = -1
): PlacedStar[] {
  const out: PlacedStar[] = [];
  catalogue().forEach((s, index) => {
    if (s.mag > magLimit) return;
    const [ra, dec] = precess(s.ra, s.dec, time);
    const h = equatorialToHorizontal(ra, dec, time, lat, lon) as Horizontal;
    if (h.elevation >= minElevation) out.push({ ...s, index, azimuth: h.azimuth, elevation: h.elevation });
  });
  return out;
}

/** The constellation chains for the moment and place as azimuth and elevation (degrees), every vertex kept (the horizon is the ridge's to hide). */
export function linesAt(time: Date, lat: number, lon: number): Horizontal[][] {
  return lineChains().map((chain) =>
    chain.map((p) => {
      const [ra, dec] = precess(p.ra, p.dec, time);
      return equatorialToHorizontal(ra, dec, time, lat, lon) as Horizontal;
    })
  );
}
