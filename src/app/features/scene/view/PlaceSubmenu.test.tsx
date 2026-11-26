import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseManifest } from '../ridge/manifest';
import { wireManifest } from '../ridge/manifest.fixture';
import { FALLBACK_VIEW } from '../ridge/view';
import { LINES_CREDIT, STARS_CREDIT, WEATHER_CREDIT_URL } from '../ridge/credits';
import { PlaceSubmenu } from './PlaceSubmenu';
import { SkySubmenu } from './SkySubmenu';

const held = vi.hoisted(() => ({ place: undefined as unknown }));
vi.mock('../../../hooks/useSkyState', () => ({ useDrawnPlace: () => held.place }));
vi.mock('../../../hooks/useSceneView', () => ({ useConstellationLines: () => false }));
vi.mock('../skyState', () => ({ setConstellationLines: () => undefined }));

/** Every string reachable through any prop of the element tree. */
const strings = (node: unknown): string[] => {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(strings);
  if (node && typeof node === 'object' && 'props' in node)
    return Object.values((node as { props: object }).props).flatMap(strings);
  return [];
};
const text = (node: unknown) => strings(node).join(' ');
const manifest = parseManifest(wireManifest(), 'http://x/ridge/vienna/');

beforeEach(() => {
  held.place = FALLBACK_VIEW.place;
});

describe('the credits (ruling ridge-view-credits-home: Place alone)', () => {
  it('Place carries the terrain, stars and lines credits', () => {
    const t = text(PlaceSubmenu({ manifest }));
    expect(t).toContain(manifest.attribution.creditLine);
    expect(t).toContain(STARS_CREDIT);
    expect(t).toContain(LINES_CREDIT);
  });

  it('Sky carries none of them', () => {
    const t = text(SkySubmenu());
    expect(t).not.toContain(STARS_CREDIT);
    expect(t).not.toContain(LINES_CREDIT);
    expect(t).not.toMatch(/Data|Datenquelle/);
  });

  it("the weather's credit shows where the feed serves the place, and only there", () => {
    expect(text(PlaceSubmenu({ manifest }))).toContain(WEATHER_CREDIT_URL);
    held.place = { ...FALLBACK_VIEW.place, id: 'elsewhere' };
    const t = text(PlaceSubmenu({ manifest }));
    expect(t).not.toContain(WEATHER_CREDIT_URL);
    expect(t).not.toContain('GeoSphere');
    expect(t).toContain(STARS_CREDIT); // the other credits do not depend on the place
  });
});
