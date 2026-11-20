import { describe, expect, it } from 'vitest';
import { sunAt } from './sunAt';
import { momentFor } from './skyMoment';
import { FALLBACK_VIEW } from './view';

const P = FALLBACK_VIEW.place;

const at = (iso: string) => new Date(iso);
/** The sun's noon of the local day of `t` (the named moment of the sky menu). */
const noonOf = (p: typeof P, t: Date) => momentFor({ kind: 'named', id: 'noon' }, p, t);

describe('the sun over Vienna', () => {
  it('the Vienna place reproduces the sun the old Vienna constant gave, exactly, at three dates', () => {
    // Values taken from the old constant's sunPosition before it was replaced.
    const pinned: [string, number, number][] = [
      ['2026-03-20T06:30:00Z', 14.339283830037077, 106.82531633377323],
      ['2026-06-21T10:40:00Z', 65.0288142821217, 171.0604046707017],
      ['2026-12-21T15:20:00Z', -3.19313392852625, 237.64629073006313],
    ];
    for (const [iso, el, az] of pinned) {
      const s = sunAt(P, at(iso));
      expect(s.elevation).toBe(el);
      expect(s.azimuth).toBe(az);
    }
  });

  it('stands at 90 - lat + declination at solar noon: the solstices and equinox', () => {
    const june = sunAt(P, noonOf(P, at('2026-06-21T12:00:00Z')));
    expect(june.elevation).toBeCloseTo(90 - P.lat + 23.44, 0);
    const december = sunAt(P, noonOf(P, at('2026-12-21T12:00:00Z')));
    expect(december.elevation).toBeCloseTo(90 - P.lat - 23.44, 0);
    const march = sunAt(P, noonOf(P, at('2026-03-20T12:00:00Z')));
    expect(march.elevation).toBeCloseTo(90 - P.lat, 0);
  });

  it('is due south at solar noon, east in the morning and west in the afternoon', () => {
    const noon = noonOf(P, at('2026-09-23T12:00:00Z'));
    expect(Math.abs(sunAt(P, noon).azimuth - 180)).toBeLessThan(2); // noonOf is found to under a minute
    expect(sunAt(P, new Date(noon.getTime() - 3 * 3600_000)).azimuth).toBeLessThan(150);
    expect(sunAt(P, new Date(noon.getTime() + 3 * 3600_000)).azimuth).toBeGreaterThan(210);
  });

  it('solar noon at 16.35 E falls near 10:40 UTC in mid November', () => {
    // 16.3534 E is 65.4 minutes ahead of Greenwich; the equation of time in mid November is +15 minutes (sun early): 12:00 - 65.5 - 15 = 10:40 UTC.
    const n = noonOf(P, at('2026-11-11T12:00:00Z'));
    const minutes = n.getUTCHours() * 60 + n.getUTCMinutes();
    expect(minutes).toBeGreaterThan(10 * 60 + 30);
    expect(minutes).toBeLessThan(10 * 60 + 50);
  });

  it('has a short day in December and a long one in June: published 8 h 4 min and 16 h 0 min with refraction, which adds about 6 minutes each end the ephemeris leaves out', () => {
    const daylight = (day: string) => {
      let n = 0;
      for (let m = 0; m < 24 * 60; m += 1)
        if (sunAt(P, new Date(Date.parse(day) + m * 60_000)).elevation > 0) n += 1;
      return n;
    };
    expect(Math.abs(daylight('2026-12-21T00:00:00Z') - (8 * 60 + 4))).toBeLessThan(15);
    expect(Math.abs(daylight('2026-06-21T00:00:00Z') - (16 * 60 + 0))).toBeLessThan(15);
  });
});
