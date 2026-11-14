// The weather over the viewpoint as one `weather.ts` number, read from a static `weather.json` next to the page (config.json's
// neighbour). The browser never calls a weather service: Eureka's refresher (gamecult-ops, docs/weather-feed.md; the only writer)
// writes the file from GeoSphere Austria's TAWES 10-minute observations (station 11035, Wien Hohe
// Warte). Rain is the gauge. CLOUD IS AN ESTIMATE: TAWES has no cloud cover. By day it is the measured global radiation (GLOW) against
// what a clear sky gives at the sun's position now (`clearSkyGhi`, Haurwitz), cross-checked by the sunshine duration (`SO`, seconds of
// 600 the direct beam was strong enough to burn the card); with the sun low or down it is a ramp of the humidity. A file that is
// missing, unreadable, malformed or stale (below) is no observation, and no observation is a clear sky.
import { WEATHER_CREDIT } from './credits';
import { sunAt } from './sunAt';
import { FALLBACK_VIEW } from './view';

/** Reader rule of docs/weather-feed.md: the file is stale 30 minutes after it was fetched or 40 after the observation it holds (the station reports every 10). */
export const STALE_MS = 30 * 60_000;
export const OBSERVATION_STALE_MS = 40 * 60_000;
export const STATION = 11035;
const SKEW_MS = 5 * 60_000;
export const CLEAR_SKY = 0;
/** The credit GeoSphere's legal page asks for. */
export const WEATHER_ATTRIBUTION = WEATHER_CREDIT;

/** The file's shape; every measurement is null when the station did not report it. Times are ISO 8601. */
export interface WeatherFile {
  fetched_at: string;
  observed_at: string;
  station: number;
  precip_mm_10min: number | null;
  humidity_pct: number | null;
  /** Global radiation, W/m2, last 10 minutes. */
  glow_wm2: number | null;
  sunshine_s_10min: number | null;
  attribution: string;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** An ISO time that names its zone (`Z` or an offset); `Date.parse` would read a bare one in the client's local time. */
const isZonedTime = (v: unknown): v is string =>
  typeof v === 'string' && /(Z|[+-]\d\d:?\d\d)$/.test(v) && !Number.isNaN(Date.parse(v));

/** A `WeatherFile` from parsed JSON, or null when it does not have the shape (times missing or unparseable). */
export function parseWeatherFile(json: unknown): WeatherFile | null {
  const j = json as Record<string, unknown> | null;
  if (!j || typeof j !== 'object') return null;
  if (!isZonedTime(j.observed_at) || !isZonedTime(j.fetched_at)) return null;
  if (j.station !== STATION) return null;
  return {
    fetched_at: j.fetched_at,
    observed_at: j.observed_at,
    station: STATION,
    precip_mm_10min: num(j.precip_mm_10min),
    humidity_pct: num(j.humidity_pct),
    glow_wm2: num(j.glow_wm2),
    sunshine_s_10min: num(j.sunshine_s_10min),
    attribution: typeof j.attribution === 'string' ? j.attribution : WEATHER_ATTRIBUTION,
  };
}

/** Global horizontal radiation of a clear sky, W/m2, sun at `el` degrees: Haurwitz (1945), 1098 cos(z) exp(-0.057 / cos(z)). */
export function clearSkyGhi(el: number): number {
  const c = Math.sin((el * Math.PI) / 180);
  return c <= 0 ? 0 : 1098 * c * Math.exp(-0.057 / c);
}

/** Below this sun elevation the radiation says too little (clear-sky ~100 W/m2 at 8 degrees) and the humidity is read instead. */
export const GLOW_FROM_DEG = 8;

/**
 * Cloud 0..1 from measured global radiation against the clear-sky value: the clearness ratio k inverted through Kasten and
 * Czeplak (1980), k = 1 - 0.75 (N/8)^3.4, N the oktas. Null when the sun is too low or the reading is missing or 0.
 */
export function cloudFromGlow(glow: number | null, sunEl: number): number | null {
  if (glow === null || glow <= 0 || sunEl < GLOW_FROM_DEG) return null;
  const k = Math.min(1, glow / clearSkyGhi(sunEl));
  return clamp01(((1 - k) / 0.75) ** (1 / 3.4));
}

/** The cloud the sunshine duration implies: the share of the ten minutes the sun did not shine. Null when the sun is too low or it is unreported. */
export function cloudFromSunshine(so: number | null, sunEl: number): number | null {
  if (so === null || so < 0 || sunEl < GLOW_FROM_DEG) return null;
  return 1 - clamp01(so / 600);
}

/** The cloud estimate by day, or null when the sun is too low for either instrument (the caller reads the humidity). */
export function cloudEstimate(f: WeatherFile, sunEl: number): number | null {
  const g = cloudFromGlow(f.glow_wm2, sunEl);
  const s = cloudFromSunshine(f.sunshine_s_10min, sunEl);
  if (g !== null && s !== null) return Math.abs(g - s) > 0.5 ? (g + s) / 2 : g; // instruments that disagree by half a sky are each half trusted
  return g ?? s;
}

/**
 * The weather number of an observation with the sun at `sunEl` degrees. Rain sets 0.8..1 by rate (0.1 mm in ten minutes is the
 * gauge's step: drizzle). Without rain, cloud (above) puts the number up to 0.7 (overcast); where the instruments cannot give it
 * (the sun low or down), cloud is a ramp of the humidity, 0 at 60% to 1 at 95%. Saturated air (92% to 100%) sets a mist floor of up to 0.75 when the sky is
 * more than half cloud.
 */
export function weatherFromFile(f: WeatherFile, sunEl: number): number {
  const rain = f.precip_mm_10min ?? 0;
  if (rain > 0) return clamp01(0.8 + 0.2 * Math.min(1, rain / 1.5));
  const cloud =
    cloudEstimate(f, sunEl) ?? (f.humidity_pct === null ? 0 : clamp01((f.humidity_pct - 60) / 35));
  const mist =
    f.humidity_pct === null || cloud < 0.5 ? 0 : clamp01((f.humidity_pct - 92) / 8) * 0.75;
  return Math.max(0.7 * cloud, mist);
}

/** The weather number now: the file's, or a clear sky when there is none or it is stale (see STALE_MS) or from the future. */
export function currentWeather(f: WeatherFile | null, now: Date = new Date()): number {
  if (!f) return CLEAR_SKY;
  const fetched = now.getTime() - Date.parse(f.fetched_at);
  const observed = now.getTime() - Date.parse(f.observed_at);
  if (
    !(
      fetched <= STALE_MS &&
      fetched >= -SKEW_MS &&
      observed <= OBSERVATION_STALE_MS &&
      observed >= -SKEW_MS
    )
  )
    return CLEAR_SKY;
  // GLOW and SO are means of the ten minutes ending at observed_at: the sun of their midpoint is the one to set them against.
  return weatherFromFile(f, sunAt(FALLBACK_VIEW.place, new Date(Date.parse(f.observed_at) - 5 * 60_000)).elevation);
}

/** Fetch and parse `weather.json`; null on any failure. */
export async function fetchWeatherFile(
  url: string,
  fetcher: typeof fetch = fetch
): Promise<WeatherFile | null> {
  try {
    const res = await fetcher(url, { cache: 'no-store' });
    return res.ok ? parseWeatherFile(await res.json()) : null;
  } catch {
    return null;
  }
}
