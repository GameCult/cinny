import { describe, expect, it } from 'vitest';
import { moonEquatorial, moonPhase, moonPosition } from './moon.js';
import { sunPosition } from './sun.js';

const DEG = 180 / Math.PI;

describe('moon position', () => {
  it('matches Meeus, Astronomical Algorithms ex. 47.a (1992 April 12, 0h TD) within the series\' 0.3 degrees', () => {
    // Meeus: ra 134.688470, dec +13.768368, distance 368409.7 km (full series).
    const m = moonEquatorial(Date.UTC(1992, 3, 12, 0, 0, 0));
    expect(Math.abs(m.ra * DEG - 134.68847)).toBeLessThan(0.3);
    expect(Math.abs(m.dec * DEG - 13.768368)).toBeLessThan(0.3);
    expect(Math.abs(m.distanceKm - 368409.7)).toBeLessThan(1500);
  });

  it('is opposite the sun at full moon, with the parallax of a few tenths of a degree at most', () => {
    // Total lunar eclipse of 2026-03-03, greatest eclipse 11:33 UTC: the moon sits opposite the sun.
    const t = '2026-03-03T11:33:00Z';
    const moon = moonPosition(t, 48.19, 16.35);
    const sun = sunPosition(t, 48.19, 16.35);
    expect(Math.abs(moon.elevation + sun.elevation)).toBeLessThan(1.5);
    const dAz = Math.abs(((moon.azimuth - sun.azimuth + 360) % 360) - 180);
    expect(dAz).toBeLessThan(2);
  });
});

describe('moon phase', () => {
  // US Naval Observatory phases of January 2000 and the lunar eclipse of March 2026 (UTC); the series is good to ~0.5 degree of
  // elongation, which is an hour of the moon's 12.2 degrees a day relative to the sun, so these hold to a degree and a half.
  const phases: [string, number][] = [
    ['2000-01-06T18:14:00Z', 0],
    ['2000-01-14T13:34:00Z', 90],
    ['2000-01-21T04:40:00Z', 180],
    ['2000-01-28T07:57:00Z', 270],
    ['2026-03-03T11:38:00Z', 180],
  ];
  it.each(phases)('elongation at %s is %d degrees', (t, e) => {
    const d = ((moonPhase(t).elongationDeg - e + 540) % 360) - 180;
    expect(Math.abs(d)).toBeLessThan(1.5);
  });

  it('lit fraction: dark at new, half at the quarters, full at full; waxing between new and full', () => {
    expect(moonPhase('2000-01-06T18:14:00Z').illuminated).toBeLessThan(0.01);
    expect(moonPhase('2000-01-14T13:34:00Z').illuminated).toBeCloseTo(0.5, 1);
    expect(moonPhase('2000-01-21T04:40:00Z').illuminated).toBeGreaterThan(0.99);
    expect(moonPhase('2000-01-10T00:00:00Z').waxing).toBe(true);
    expect(moonPhase('2000-01-25T00:00:00Z').waxing).toBe(false);
    expect(moonPhase('2000-01-21T04:40:00Z').phaseAngleDeg).toBeLessThan(2);
  });
});
