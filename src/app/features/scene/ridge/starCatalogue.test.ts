import { describe, expect, it } from 'vitest';
import { moonPosition } from '../../../../sky/moon.js';
import { catalogue, lineChains, linesAt, precess, starsAt } from './starCatalogue';

const DEG = 180 / Math.PI;
const VIENNA = { lat: 48.1929826, lon: 16.3534237 };

/**
 * Reference altitude/azimuth (degrees, no refraction) from astropy 8.0.3 (ICRS to AltAz at Vienna 48.1929826 N 16.3534237 E, sea level,
 * UTC, J2000 coordinates of the stars as Hipparcos lists them), computed once and pasted: an independent implementation of the transform.
 */
const REFERENCE: { t: string; name: string; ra: number; dec: number; alt: number; az: number }[] = [
  { t: '2026-01-15T21:00:00Z', name: 'Sirius', ra: 101.2875, dec: -16.7161, alt: 23.711, az: 164.391 },
  { t: '2026-01-15T21:00:00Z', name: 'Betelgeuse', ra: 88.7929, dec: 7.4071, alt: 49.164, az: 176.246 },
  { t: '2026-11-20T21:00:00Z', name: 'Vega', ra: 279.2347, dec: 38.7837, alt: 15.924, az: 311.197 },
  { t: '2026-11-20T21:00:00Z', name: 'Polaris', ra: 37.9546, dec: 89.2641, alt: 48.79, az: 0.26 },
  { t: '2026-06-01T23:00:00Z', name: 'Arcturus', ra: 213.9153, dec: 19.1824, alt: 47.976, az: 239.397 },
];

describe('the catalogue', () => {
  it('is the Yale Bright Star Catalogue cut at naked-eye, brightest first, Sirius leading', () => {
    const c = catalogue();
    expect(c.length).toBeGreaterThan(2500);
    expect(c.length).toBeLessThan(3200);
    expect(c.every((s, i) => i === 0 || s.mag >= c[i - 1].mag - 1e-9)).toBe(true);
    const sirius = c[0];
    expect(sirius.mag).toBeCloseTo(-1.46, 1);
    // Sirius, J2000: RA 6h45m09s = 101.287 deg, Dec -16d42'58" = -16.716 deg.
    expect(sirius.ra * DEG).toBeCloseTo(101.287, 1);
    expect(sirius.dec * DEG).toBeCloseTo(-16.716, 1);
    expect(sirius.bv).toBeCloseTo(0.0, 1);
  });

  it('carries the figures: 150 chains of at least two vertices', () => {
    const l = lineChains();
    expect(l.length).toBe(150);
    expect(l.every((ch) => ch.length >= 2)).toBe(true);
  });
});

describe('precession', () => {
  it('moves Polaris in declination by 20.04 arcsec a year times cos(RA): 0.118 degrees in 26.9 years, and nothing at the epoch', () => {
    const polaris = catalogue().find((s) => Math.abs(s.dec * DEG - 89.264) < 0.05)!;
    const [, dec] = precess(polaris.ra, polaris.dec, new Date('2026-11-20T00:00:00Z'));
    expect(Math.abs(dec - polaris.dec) * DEG).toBeGreaterThan(0.1);
    expect(Math.abs(dec - polaris.dec) * DEG).toBeLessThan(0.13);
    const [ra0, dec0] = precess(polaris.ra, polaris.dec, new Date('2000-01-01T12:00:00Z'));
    expect(Math.abs(ra0 - polaris.ra) * DEG).toBeLessThan(1e-3);
    expect(Math.abs(dec0 - polaris.dec) * DEG).toBeLessThan(1e-3);
  });
});

describe('star placement', () => {
  it.each(REFERENCE)('puts $name at the reference altitude and azimuth at $t, within half a degree', (r) => {
    const placed = starsAt(new Date(r.t), VIENNA.lat, VIENNA.lon, 6, -90);
    // The catalogue's star nearest the reference position (the reference coordinates are rounded).
    const star = catalogue().reduce(
      (best, s, i) => {
        const d = Math.hypot((s.ra * DEG - r.ra) * Math.cos(r.dec / DEG), s.dec * DEG - r.dec);
        return d < best.d ? { d, i } : best;
      },
      { d: 1e9, i: -1 }
    );
    expect(star.d).toBeLessThan(0.1);
    const p = placed.find((s) => s.index === star.i)!;
    expect(Math.abs(p.elevation - r.alt)).toBeLessThan(0.5);
    // Azimuth error scales with 1/cos(alt); Polaris sits within 0.8 degree of the pole where azimuth swings fastest.
    const dAz = Math.abs(((p.azimuth - r.az + 540) % 360) - 180);
    expect(dAz * Math.cos(r.alt / DEG)).toBeLessThan(0.5);
  });

  it("puts Polaris at the observer's latitude in altitude, due north", () => {
    for (const t of ['2026-11-20T21:00:00Z', '2026-11-21T02:13:00Z', '2026-06-01T23:00:00Z']) {
      const polaris = starsAt(new Date(t), VIENNA.lat, VIENNA.lon).find(
        (s) => s.mag > 1.9 && s.mag < 2.1 && s.elevation > 47 && s.elevation < 50
      )!;
      expect(Math.abs(polaris.elevation - VIENNA.lat)).toBeLessThan(0.8);
      expect(Math.min(polaris.azimuth, 360 - polaris.azimuth)).toBeLessThan(2);
    }
  });

  it('hides what is below the horizon and keeps stars brightest first', () => {
    const placed = starsAt(new Date('2026-11-20T21:00:00Z'), VIENNA.lat, VIENNA.lon);
    expect(placed.length).toBeGreaterThan(900);
    expect(placed.length).toBeLessThan(1700);
    expect(placed.every((s) => s.elevation >= -1)).toBe(true);
    expect(placed.every((s, i) => i === 0 || s.mag >= placed[i - 1].mag - 1e-9)).toBe(true);
  });

  it('turns with the sky: a sidereal day later the same star is back within a quarter degree', () => {
    const t0 = Date.parse('2026-11-20T21:00:00Z');
    const a = starsAt(new Date(t0), VIENNA.lat, VIENNA.lon)[3];
    const b = starsAt(new Date(t0 + 86164091), VIENNA.lat, VIENNA.lon).find((s) => s.index === a.index)!;
    expect(Math.abs(a.elevation - b.elevation)).toBeLessThan(0.25);
  });
});

describe('the moon at Vienna', () => {
  it('is where astropy puts it, 2026-11-20 21:00 UTC (alt 42.576, az 215.016), within the series\' 0.5 degrees', () => {
    const m = moonPosition('2026-11-20T21:00:00Z', VIENNA.lat, VIENNA.lon);
    expect(Math.abs(m.elevation - 42.576)).toBeLessThan(0.5);
    expect(Math.abs(m.azimuth - 215.016)).toBeLessThan(0.7);
  });
  it('and 2026-06-01 23:00 UTC (alt 11.48, az 164.748)', () => {
    const m = moonPosition('2026-06-01T23:00:00Z', VIENNA.lat, VIENNA.lon);
    expect(Math.abs(m.elevation - 11.48)).toBeLessThan(0.5);
    expect(Math.abs(m.azimuth - 164.748)).toBeLessThan(0.7);
  });
});

describe('constellation lines', () => {
  it('place every vertex for the moment, in az/el, one chain per chain', () => {
    const l = linesAt(new Date('2026-11-20T21:00:00Z'), VIENNA.lat, VIENNA.lon);
    expect(l).toHaveLength(150);
    expect(l[0].every((p) => p.azimuth >= 0 && p.azimuth < 360 && Math.abs(p.elevation) <= 90)).toBe(true);
  });
});
