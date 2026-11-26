import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FALLBACK_VIEW } from './view';
import {
  LINES_CREDIT,
  LINES_SOURCE_URL,
  STARS_CREDIT,
  STARS_SOURCE_URL,
  WEATHER_CREDIT,
  WEATHER_CREDIT_URL,
  WEATHER_DATASET,
  terrainCredit,
  weatherServes,
} from './credits';
import { parseIndex, parseManifest } from './manifest';
import { wireManifest } from './manifest.fixture';
import { WEATHER_ATTRIBUTION } from './weatherFeed';

describe('the credits the scene view shows', () => {
  it("are the sources' own", () => {
    expect(WEATHER_CREDIT).toBe(WEATHER_ATTRIBUTION);
  });
  it('credit GeoSphere with its requested line, and state a licence only with the dataset named', () => {
    expect(WEATHER_CREDIT).toBe(`Datenquelle: GeoSphere Austria - ${WEATHER_CREDIT_URL}`);
    expect(WEATHER_CREDIT).not.toMatch(/CC BY/);
    expect(WEATHER_DATASET).toMatch(/TAWES.*10-minute.*CC BY 4\.0/);
  });
});

describe('the terrain credit', () => {
  const shipped = (): { attribution: { credit_line: string; licence: string } } | undefined => {
    const root = join(process.cwd(), 'public', 'ridge');
    const index = parseIndex(JSON.parse(readFileSync(join(root, 'index.json'), 'utf8')));
    return JSON.parse(
      readFileSync(join(root, index.places[index.default], 'manifest.json'), 'utf8')
    );
  };

  it("is the shipped manifest's attribution, credit line then licence", () => {
    const wire = shipped();
    const manifest = parseManifest(wireManifest({ attribution: wire?.attribution }), '/d/');
    expect(terrainCredit(manifest)).toBe(
      `${wire?.attribution.credit_line} ${wire?.attribution.licence}`
    );
    expect(terrainCredit(manifest)).toMatch(/Copernicus/);
  });

  it('is absent without a manifest', () => {
    expect(terrainCredit(undefined)).toBeUndefined();
  });
});

describe('the night sky credits', () => {
  const data = readFileSync(join(__dirname, 'nightSkyData.ts'), 'utf8');
  it("name the sources the generated data's header names, with their licences", () => {
    expect(data).toContain(STARS_SOURCE_URL);
    expect(data).toContain(LINES_SOURCE_URL);
    expect(data).toMatch(/BSD-3-Clause/);
    expect(STARS_CREDIT).toMatch(/Yale Bright Star Catalogue.*public domain/);
    expect(LINES_CREDIT).toMatch(/Olaf Frohn.*BSD-3-Clause/);
  });
});

describe('the weather credit', () => {
  it("is owed where the feed's station stands, and nowhere else", () => {
    expect(weatherServes(FALLBACK_VIEW.place)).toBe(true);
    expect(weatherServes({ id: 'elsewhere' })).toBe(false);
  });
});
