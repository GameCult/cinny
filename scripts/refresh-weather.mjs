#!/usr/bin/env node
// Reference refresher for the ridge scene's weather.json: one GeoSphere Austria TAWES request (station 11035, Wien Hohe Warte; no key; credit as GeoSphere's legal page asks), the
// current 10-minute observation written as the file the client reads (src/app/features/scene/ridge/weatherFeed.ts). No dependencies.
// Eureka hosts the timer; run it no more often than every 5 minutes. The service allows 5 requests/s and 240/hour per client: this
// makes one request per run and, on any failure or a 429, leaves the previous file in place (the client treats a file older than 30 min
// as clear sky) and exits 1.
//   node scripts/refresh-weather.mjs <path to weather.json>
import { renameSync, writeFileSync } from 'node:fs';

export const STATION = 11035;
export const URL_TAWES = `https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min?parameters=RR&parameters=RF&parameters=GLOW&parameters=SO&station_ids=${STATION}`;
export const ATTRIBUTION = 'Datenquelle: GeoSphere Austria - https://data.hub.geosphere.at';

/** The file's content from a TAWES `station/current` response; null when there is no observation time. Missing measurements are null. */
export function fileFromTawes(json, fetchedAt = new Date()) {
  const observed = json?.timestamps?.[0];
  if (typeof observed !== 'string' || Number.isNaN(Date.parse(observed))) return null;
  const p = json?.features?.[0]?.properties?.parameters ?? {};
  const val = (k) => {
    const v = p[k]?.data?.[0];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  return {
    fetched_at: fetchedAt.toISOString(),
    observed_at: new Date(observed).toISOString(),
    station: STATION,
    precip_mm_10min: val('RR'),
    humidity_pct: val('RF'),
    glow_wm2: val('GLOW'),
    sunshine_s_10min: val('SO'),
    attribution: ATTRIBUTION,
  };
}

async function main(out) {
  if (!out) throw new Error('usage: refresh-weather.mjs <path to weather.json>');
  const res = await fetch(URL_TAWES, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`TAWES answered ${res.status}`);
  const file = fileFromTawes(await res.json());
  if (!file) throw new Error('TAWES answered without an observation');
  writeFileSync(`${out}.tmp`, `${JSON.stringify(file)}\n`);
  renameSync(`${out}.tmp`, out);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv[2]).catch((e) => {
    console.error(String(e.message ?? e));
    process.exit(1);
  });
}
