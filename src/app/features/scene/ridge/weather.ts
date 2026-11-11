// One weather number, 0..1, and what it does to the sky. No network source yet: the number is a constant, or the page URL's
// `?weather=` for a still. 0 clear, about 0.3 fair (a few clouds), 0.55 overcast, 0.75 drizzle and mist, 1 steady rain.
// What each part touches: haze multiplies the atmosphere's Mie coefficients before the LUTs are baked (`earthAtmosphere.ts`:
// the same air, more aerosol); cloud cover, mist and rain are layers over the baked sky (`clouds.ts`, `Ridge.ts`).

export const DEFAULT_WEATHER = 0.3;

export interface Weather {
  /** The number it was made from. */
  value: number;
  /** 0..1 share of the sky the cloud layer covers. */
  cover: number;
  /** Multiplier on the Mie coefficients: 1 is the reference air. */
  mieScale: number;
  /** 0..1 strength of the mist over the lower ridges. */
  mist: number;
  /** 0..1 rain streaks; 0 draws none and builds no layer. */
  rain: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function weatherOf(value: number): Weather {
  const w = clamp01(Number.isFinite(value) ? value : DEFAULT_WEATHER);
  return {
    value: w,
    cover: smooth(0.1, 0.7, w),
    mieScale: 1 + 5 * smooth(0.2, 1, w),
    mist: smooth(0.45, 0.9, w),
    rain: smooth(0.68, 0.95, w),
  };
}

/** The page URL's `?weather=<0..1>`, when it is a number. */
export function urlWeather(search: string = typeof location === 'undefined' ? '' : location.search): number | undefined {
  const v = new URLSearchParams(search).get('weather');
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? clamp01(n) : undefined;
}
