// What the Ridge background owes its data sources, shown in the Sky menu (SkyStateControl). Plain strings in their own module so the
// main chunk carries these and not the weather parser; credits.test.ts holds them equal to the sources'. The terrain credit is the loaded
// manifest's own `attribution` (terrainCredit): the baker writes it, so no constant here can drift from the bake.
import type { RidgeManifest } from './manifest';

/** GeoSphere's own requested credit line. It names no licence: that is the dataset's (below). */
export const WEATHER_CREDIT = 'Datenquelle: GeoSphere Austria - https://data.hub.geosphere.at';
export const WEATHER_CREDIT_URL = 'https://data.hub.geosphere.at';
/** The dataset the weather is read from, and its licence as the dataset page names it (data.hub.geosphere.at, tawes-v1-10min). */
export const WEATHER_DATASET = 'TAWES weather stations, 10-minute data (station 11035), CC BY 4.0';

/** The terrain's credit line and licence as the loaded bake states them; undefined until a manifest has loaded (no manifest, no line). */
export const terrainCredit = (
  manifest: Pick<RidgeManifest, 'attribution'> | undefined
): string | undefined =>
  manifest ? `${manifest.attribution.creditLine} ${manifest.attribution.licence}` : undefined;
