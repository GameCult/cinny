// The one place the sky's colours come from. Void's `src/sky/sun.js` (`light({ time, lat, lon,
// cloud_cover, precipitation })`, PR #20) is the intended source; until it lands this returns a
// fixed twilight: lavender zenith, rose mid-sky, orange horizon. These are the raw stops: the scene draws them
// shaped into the dusk band of ../skyBand.ts (`ridgeSkyFor`, skyForState.ts), whose floor the link of Noonday Sky needs. Replace the body, keep the signature: the scene calls it once, at startup,
// and bakes the result.

export type Srgb = readonly [number, number, number];

export interface SkyColours {
  /** Top of the sky gradient, sRGB 0..255. */
  top: Srgb;
  /** Mid-sky band. */
  mid: Srgb;
  /** Colour at the horizon, which the far ridges fade into. */
  horizon: Srgb;
  /** Nearest ridge: the ground colour the farther layers mix away from. */
  ground: Srgb;
  /** Where the sun sits across one drift period, 0..1; the layers pick up a faint warm in-scatter there. Omit for none. */
  sunAzimuth?: number;
}

export function skyColours(_now: Date = new Date()): SkyColours {
  return {
    top: [170, 145, 220],
    mid: [225, 130, 165],
    horizon: [240, 150, 80],
    ground: [7, 17, 26],
    sunAzimuth: 0.3,
  };
}
