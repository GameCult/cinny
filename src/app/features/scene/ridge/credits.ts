// What the Ridge background owes its data sources, shown in the scene view (the Place submenu, all of them: ruling ridge-view-credits-home). The terrain, stars and lines
// credits are plain strings in their own module; credits.test.ts holds them equal to the sources'. The weather's credit is owed place by place and is the feed row's (`weatherFeed.ts`). The terrain credit is the loaded
// manifest's own `attribution` (terrainCredit): the baker writes it, so no constant here can drift from the bake.
import type { RidgeManifest } from './manifest';

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
