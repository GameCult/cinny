import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LINES_CREDIT,
  LINES_SOURCE_URL,
  STARS_CREDIT,
  STARS_SOURCE_URL,
  terrainCredit,
} from './credits';
import { parseIndex, parseManifest } from './manifest';
import { wireManifest } from './manifest.fixture';

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
