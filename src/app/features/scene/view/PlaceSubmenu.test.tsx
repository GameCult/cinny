import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseManifest } from '../ridge/manifest';
import type { PlaceListing } from '../ridge/manifest';
import { wireManifest } from '../ridge/manifest.fixture';
import { FALLBACK_VIEW } from '../ridge/view';
import { LINES_CREDIT, STARS_CREDIT } from '../ridge/credits';
import { WEATHER_FEEDS, creditLine } from '../ridge/weatherFeed';
import { PlaceCarousel, PlaceSubmenu, SETTLE_MS } from './PlaceSubmenu';
import { SkySubmenu } from './SkySubmenu';

// The hooks are held still (TimeSubmenu.test.tsx): the element tree is read, a function component is expanded by calling it.
const held = vi.hoisted(() => ({
  place: undefined as unknown,
  places: undefined as unknown,
  picked: [] as string[],
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useRef = (init: unknown) => ({ current: init });
  const useEffect = () => undefined;
  return { ...actual, default: { ...actual, useRef, useEffect }, useRef, useEffect };
});
vi.mock('../../../hooks/useSkyState', () => ({ useDrawnPlace: () => held.place }));
vi.mock('../../../hooks/useSceneView', () => ({
  usePlaceList: () => held.places,
  useConstellationLines: () => false,
}));
vi.mock('../placeState', () => ({ setPlaceChoice: (id: string) => held.picked.push(id) }));
vi.mock('../skyState', () => ({
  setConstellationLines: () => undefined,
  skyNow: () => new Date('2030-06-21T10:00:00Z'),
}));

type El = { type?: unknown; props?: Record<string, unknown> };
const walk = (node: unknown): El[] => {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (node && typeof node === 'object' && 'props' in node) {
    const el = node as El;
    return [el, ...Object.values(el.props ?? {}).flatMap(walk)];
  }
  return [];
};
const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return textOf((node as El).props?.children);
  }
  return '';
};
const strings = (node: unknown): string[] => {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(strings);
  if (node && typeof node === 'object' && 'props' in node)
    return Object.values((node as { props: object }).props).flatMap(strings);
  return [];
};
const text = (node: unknown) => strings(node).join(' ');

const manifest = parseManifest(wireManifest(), 'http://x/ridge/vienna/');
const FIVE: PlaceListing[] = [
  { id: 'vienna', name: 'Vienna', tz: 'Europe/Vienna' },
  { id: 'fuji', name: 'Fuji', tz: 'Asia/Tokyo' },
  { id: 'matterhorn', name: 'Matterhorn', tz: 'Europe/Zurich' },
  { id: 'amadablam', name: 'Ama Dablam', tz: 'Asia/Kathmandu' },
  { id: 'grandcanyon', name: 'Grand Canyon', tz: 'America/Phoenix' },
];
const NOW = new Date('2030-06-21T10:00:00Z');
const cardsOf = (tree: El[]) => tree.filter((e) => e.props?.['aria-current'] !== undefined);

beforeEach(() => {
  held.place = FALLBACK_VIEW.place;
  held.places = FIVE;
  held.picked.length = 0;
});

describe('the Place carousel', () => {
  it('is one card per baked place, named by the index and showing each place local time now', () => {
    const tree = walk(PlaceCarousel({ places: FIVE, current: 'vienna', now: NOW, onPick: () => undefined }));
    expect(cardsOf(tree).map(textOf)).toEqual([
      'Vienna12:00 local',
      'Fuji19:00 local',
      'Matterhorn12:00 local',
      'Ama Dablam15:45 local',
      'Grand Canyon03:00 local',
    ]);
    expect(cardsOf(tree).map((e) => e.props?.['aria-current'])).toEqual([true, false, false, false, false]);
  });

  it('is in the panel over the index list, and a card or an arrow picks through the choice store', () => {
    const carousel = walk(PlaceSubmenu({ manifest })).find((e) => e.type === PlaceCarousel);
    expect(carousel?.props?.places).toBe(FIVE);
    const onPick = carousel?.props?.onPick as (id: string) => void;
    onPick('grandcanyon');
    expect(held.picked).toEqual(['grandcanyon']);
    held.picked.length = 0;
    const own = walk(PlaceCarousel({ places: FIVE, current: 'vienna', now: NOW, onPick }));
    const click = (label: string) =>
      (own.find((e) => e.props?.['aria-label'] === label)?.props?.onClick as () => void)();
    click('Previous place'); // the ring: before Vienna is the last
    click('Next place');
    (cardsOf(own)[2].props?.onClick as () => void)();
    expect(held.picked).toEqual(['grandcanyon', 'fuji', 'matterhorn']);
  });

  it('is absent while the index lists one place or none has loaded; the credits stay', () => {
    for (const places of [undefined, [FIVE[0]], []]) {
      held.places = places;
      expect(walk(PlaceSubmenu({ manifest })).some((e) => e.type === PlaceCarousel)).toBe(false);
      expect(text(PlaceSubmenu({ manifest }))).toContain(STARS_CREDIT);
    }
  });

  it('settles a swipe on the card in the middle and picks it once it rests, not the drawn place', () => {
    vi.useFakeTimers();
    try {
      const strip = {
        scrollLeft: 0,
        clientWidth: 100,
        children: FIVE.map((_, i) => ({ offsetLeft: i * 100, offsetWidth: 100 })),
      };
      const own = walk(
        PlaceCarousel({ places: FIVE, current: 'vienna', now: NOW, onPick: (id) => held.picked.push(id) })
      );
      const onScroll = own.find((e) => typeof e.props?.onScroll === 'function')?.props?.onScroll as (e: unknown) => void;
      const scrollTo = (left: number) => {
        strip.scrollLeft = left;
        onScroll({ currentTarget: strip });
      };
      scrollTo(100);
      scrollTo(200); // still moving: nothing is picked until it rests
      expect(held.picked).toEqual([]);
      vi.advanceTimersByTime(SETTLE_MS);
      expect(held.picked).toEqual(['matterhorn']);
      scrollTo(0); // at the drawn place: not a pick
      vi.advanceTimersByTime(SETTLE_MS);
      expect(held.picked).toEqual(['matterhorn']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the credits follow the place (ruling ridge-view-credits-home: Place alone)', () => {
  it('Place carries the terrain, stars and lines credits', () => {
    const t = text(PlaceSubmenu({ manifest }));
    expect(t).toContain(manifest.attribution.creditLine);
    expect(t).toContain(STARS_CREDIT);
    expect(t).toContain(LINES_CREDIT);
  });

  it('Sky carries only the lines switch and its note: no credit of any wording', () => {
    expect(strings(SkySubmenu()).filter((x) => /\s/.test(x))).toEqual([
      'Constellation lines',
      'Drawn over the stars of a night sky.',
    ]);
  });

  it("the weather's credit is the feed row's, shown for a place with a feed and for no other", () => {
    const feed = WEATHER_FEEDS.vienna;
    const t = text(PlaceSubmenu({ manifest }));
    expect(t).toContain(feed.credit);
    expect(t).toContain(feed.url);
    expect(t).toContain(feed.dataset);
    expect(creditLine(feed)).toBe(`${feed.credit} - ${feed.url}`);
    for (const id of ['fuji', 'matterhorn', 'amadablam', 'grandcanyon']) {
      held.place = { ...FALLBACK_VIEW.place, id };
      const other = text(PlaceSubmenu({ manifest }));
      expect(other).not.toContain(feed.url);
      expect(other).not.toContain('GeoSphere');
      expect(other).toContain(STARS_CREDIT); // the other credits do not depend on the place
    }
  });
});
