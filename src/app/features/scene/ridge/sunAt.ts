// The sun over a Place (`view.ts`) at a real moment: one ephemeris, `sunPosition` of src/sky/sun.js (the
// low-precision NOAA/Meeus series, a hundredth of a degree for 1900..2100; no refraction). The moment a sky is drawn at is skyMoment.ts's. The ridge sky is the physical atmosphere (`earthAtmosphere.ts`) lit from this sun.
import { sunPosition } from '../../../../sky/sun.js';
import type { Place } from './view';

export interface SunSample {
  /** Degrees above the horizon, no refraction. */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
  /** The moment this is the sun of. */
  time: Date;
}

export function sunAt(place: Place, time: Date): SunSample {
  const { elevation, azimuth } = sunPosition(time, place.lat, place.lon) as {
    elevation: number;
    azimuth: number;
  };
  return { elevation, azimuth, time };
}
