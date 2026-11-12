// The sun over the server's viewpoint in Vienna (48.1929826 N, 16.3534237 E, 183 m: Meta's location, the Copernicus DSM height there) at a real moment: one ephemeris, `sunPosition` of src/sky/sun.js (the
// low-precision NOAA/Meeus series, a hundredth of a degree for 1900..2100; no refraction), and the choice of a moment for each
// fixed sky state. The ridge sky is the physical atmosphere (`earthAtmosphere.ts`) lit from this sun.
import { sunPosition } from '../../../../sky/sun.js';
import { DAY_FROM } from '../skyState';
import type { FixedSkyState } from '../skyBand';

export const VIENNA = { lat: 48.1929826, lon: 16.3534237, altitudeKm: 0.183 } as const;

export interface SunSample {
  /** Degrees above the horizon, no refraction. */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
  /** The moment this is the sun of. */
  time: Date;
}

export function viennaSun(time: Date): SunSample {
  const { elevation, azimuth } = sunPosition(time, VIENNA.lat, VIENNA.lon) as {
    elevation: number;
    azimuth: number;
  };
  return { elevation, azimuth, time };
}

const MIN = 60_000;

/** Sun elevation range of each fixed state: the thresholds `resolveSkyState` uses (day from DAY_FROM, night below -DAY_FROM). */
export const STATE_ELEVATION: Record<FixedSkyState, readonly [number, number]> = {
  day: [DAY_FROM, 90],
  dusk: [-DAY_FROM, DAY_FROM],
  night: [-90, -DAY_FROM],
};

const startOfUtcDay = (t: Date): number => Math.floor(t.getTime() / (24 * 60 * MIN)) * 24 * 60 * MIN;

/** The moment of the day (UTC day of `t`, every 5 minutes) the sun is highest over Vienna: solar noon to the step. */
export function solarNoon(t: Date): Date {
  const d0 = startOfUtcDay(t);
  let best = d0;
  let bestEl = -90;
  for (let m = 0; m < 24 * 60; m += 5) {
    const el = viennaSun(new Date(d0 + m * MIN)).elevation;
    if (el > bestEl) {
      bestEl = el;
      best = d0 + m * MIN;
    }
  }
  return new Date(best);
}

/**
 * The sun a state draws. The real sun over Vienna now when it is in the state's range (so 'auto' is the real sky); otherwise the
 * sun of today at a moment that is: noon for Day, the evening sunset for Dusk, the opposite of noon for Night. A picker that
 * forces Day at night shows a noon sky, as a person looking at a noon photograph would.
 */
export function sunForState(state: FixedSkyState, now: Date): SunSample {
  const real = viennaSun(now);
  const [lo, hi] = STATE_ELEVATION[state];
  if (real.elevation >= lo && real.elevation <= hi) return real;
  const noon = solarNoon(now);
  if (state === 'day') return viennaSun(noon);
  if (state === 'night') return viennaSun(new Date(noon.getTime() + 12 * 60 * MIN));
  // Dusk: bisect the evening crossing of the horizon between noon and the opposite moment.
  let a = noon.getTime();
  let b = noon.getTime() + 12 * 60 * MIN;
  for (let i = 0; i < 30; i += 1) {
    const m = (a + b) / 2;
    if (viennaSun(new Date(m)).elevation > 0) a = m;
    else b = m;
  }
  return viennaSun(new Date((a + b) / 2));
}
