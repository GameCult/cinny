// What the Ridge background owes its data sources, shown in the scene view (the Place submenu, all of them: ruling ridge-view-credits-home). Plain strings in their own module so the
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

/** The stars: the Yale Bright Star Catalogue, public domain (CDS/VizieR V/50; the file is the SAO Telescope Data Center's copy, see `nightSkyData.ts`). */
export const STARS_CREDIT =
  'Stars: Yale Bright Star Catalogue, 5th revised ed. (Hoffleit and Warren 1991), public domain, CDS VizieR V/50';
export const STARS_SOURCE_URL = 'http://tdc-www.harvard.edu/catalogs/bsc5.dat.gz';
/** The constellation lines: d3-celestial by Olaf Frohn, BSD-3-Clause (the repository's LICENSE, 2015). The licence asks for its notice to travel with redistributions: the full text is in `THIRD_PARTY_NOTICES.md` at the repository root. */
export const LINES_CREDIT =
  'Constellation lines: d3-celestial by Olaf Frohn (BSD-3-Clause, copyright 2015 Olaf Frohn), https://github.com/ofrohn/d3-celestial';
export const LINES_SOURCE_URL =
  'https://github.com/ofrohn/d3-celestial/blob/master/data/constellations.lines.json';

/** The one place the weather feed serves: the station (`weatherFeed.ts` STATION) stands at Vienna, and its credit is owed only where its data is drawn. */
export const WEATHER_PLACE_ID = 'vienna';
export const weatherServes = (place: { id: string }): boolean => place.id === WEATHER_PLACE_ID;
