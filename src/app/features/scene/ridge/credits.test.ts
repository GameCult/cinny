import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEATHER_CREDIT, WEATHER_CREDIT_URL, WEATHER_DATASET, terrainCredit } from './credits';
import { parseIndex, parseManifest } from './manifest';
import { wireManifest } from './manifest.fixture';
import { WEATHER_ATTRIBUTION } from './weatherFeed';

describe('the credits the Sky menu shows', () => {
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
