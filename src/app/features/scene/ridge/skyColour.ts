// The one place the sky's colours come from. Void's `src/sky/sun.js` (`light({ time, lat, lon,
// cloud_cover, precipitation })`, PR #20) is the intended source; until it lands this returns a
// fixed twilight: lavender zenith, rose mid-sky, orange horizon. Replace the body, keep the signature: the scene calls it once, at startup,
// and paints the result.

import type { PhysicalSky } from './physicalSky';

export type Srgb = readonly [number, number, number];

export interface SkyColours {
  /** Top of the sky gradient, sRGB 0..255. */
  top: Srgb;
  /** Mid-sky band. */
  mid: Srgb;
  /** Colour at the horizon. */
  horizon: Srgb;
  /** The physical sky this palette was read from; when present the host canvas is painted from it, not from the three stops. */
  physical?: PhysicalSky;
}

export function skyColours(_now: Date = new Date()): SkyColours {
  return {
    top: [170, 145, 220],
    mid: [225, 130, 165],
    horizon: [240, 150, 80],
  };
}
