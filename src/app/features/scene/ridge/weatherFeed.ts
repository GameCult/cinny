// The weather over the viewpoint as one `weather.ts` number, from GeoSphere Austria's TAWES 10-minute observations
// (station 11035, Wien Innere Stadt; open data, CC BY 4.0, no key, CORS open; 5 requests/s and 240/hour per client). TAWES measures
// rain, humidity and sunshine duration, not cloud cover, so the number is what those three imply. Open-Meteo has cloud cover but its
// free API is for non-commercial use only, so it is not used.
export const TAWES_STATION = '11035';
export const TAWES_URL =
  `https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min?parameters=RR&parameters=RF&parameters=SO&station_ids=${TAWES_STATION}`;
export const WEATHER_ATTRIBUTION = 'Weather: GeoSphere Austria (CC BY 4.0), station Wien Innere Stadt';

export interface Observation {
  /** Rain in the last 10 minutes, mm. */
  rainMm: number;
  /** Relative humidity, %. */
  humidity: number;
  /** Sunshine in the last 10 minutes, seconds (0..600). */
  sunshineS: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * The weather number of an observation. Rain sets 0.8..1 by rate (0.1 mm in ten minutes is the gauge's step: drizzle). Without rain,
 * sunshine says how much of the sky is open when the sun is up (`sunUp`); at night, or with the sun up and no sunshine, humidity
 * says it: saturated air with no sun is overcast and misty.
 */
export function weatherFromObservation(o: Observation, sunUp: boolean): number {
  if (o.rainMm > 0) return clamp01(0.8 + 0.2 * Math.min(1, o.rainMm / 1.5));
  const mist = clamp01((o.humidity - 85) / 15) * 0.75;
  if (!sunUp) return mist;
  const sun = clamp01(o.sunshineS / 600);
  return Math.max(mist * (1 - sun), 0.55 * (1 - sun));
}

interface TawesFeature {
  properties?: { parameters?: Record<string, { data?: (number | null)[] } | undefined> };
}

/** Parse a TAWES `station/current` response; null when a parameter is missing or has no value. */
export function parseTawes(json: unknown): Observation | null {
  const f = (json as { features?: TawesFeature[] } | null)?.features?.[0];
  const p = f?.properties?.parameters;
  const val = (k: string): number | null => p?.[k]?.data?.[0] ?? null;
  const rainMm = val('RR');
  const humidity = val('RF');
  const sunshineS = val('SO');
  if (rainMm === null || humidity === null) return null;
  return { rainMm, humidity, sunshineS: sunshineS ?? 0 };
}

export async function fetchObservation(fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<Observation | null> {
  const res = await fetcher(TAWES_URL, { signal });
  return res.ok ? parseTawes(await res.json()) : null;
}
