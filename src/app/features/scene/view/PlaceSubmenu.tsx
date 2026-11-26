import React, { useEffect, useRef } from 'react';
import { Box, Icon, IconButton, Icons, Text } from 'folds';
import { useDrawnPlace } from '../../../hooks/useSkyState';
import { usePlaceList } from '../../../hooks/useSceneView';
import { PhoneHit } from '../../../styles/PhoneHit.css';
import { LINES_CREDIT, STARS_CREDIT, terrainCredit } from '../ridge/credits';
import type { RidgeManifest, PlaceListing } from '../ridge/manifest';
import { localMinutes } from '../ridge/skyMoment';
import { FALLBACK_VIEW } from '../ridge/view';
import { feedFor } from '../ridge/weatherFeed';
import { setPlaceChoice } from '../placeState';
import { skyNow } from '../skyState';
import { hhmm } from './TimeSubmenu';
import * as css from './SceneView.css';

/** How long a swipe rests before the card it stopped on is picked, ms. */
export const SETTLE_MS = 120;

/** Index of the child of `strip` whose centre is nearest the strip's centre. */
const centredIndex = (strip: HTMLElement): number => {
  const mid = strip.scrollLeft + strip.clientWidth / 2;
  let best = 0;
  let gap = Infinity;
  Array.from(strip.children).forEach((c, i) => {
    const el = c as HTMLElement;
    const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
    if (d < gap) {
      gap = d;
      best = i;
    }
  });
  return best;
};

/**
 * The baked places, one card each (its name and its local time now), swiped or stepped with the arrows; the card in the middle is the place drawn
 * (`current`), and a pick, a tap on a card, an arrow or a swipe that comes to rest on another, goes to `onPick`. The list is the index's: nothing here keeps a copy.
 */
export function PlaceCarousel({
  places,
  current,
  now,
  onPick,
}: {
  places: PlaceListing[];
  current: string;
  now: Date;
  onPick: (id: string) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout>>();
  const shown = useRef(current);
  shown.current = current;
  const at = Math.max(
    0,
    places.findIndex((p) => p.id === current)
  );

  // The drawn place's card goes to the middle, at once (a programmed scroll is not a swipe: it must not end on a card the viewer did not pick).
  useEffect(() => {
    const el = strip.current;
    const card = el?.children[at] as HTMLElement | undefined;
    if (el && card) el.scrollLeft = card.offsetLeft - (el.clientWidth - card.offsetWidth) / 2;
  }, [at, places]);
  useEffect(() => () => clearTimeout(settle.current), []);

  const step = (by: number) => {
    const next = places[(at + by + places.length) % places.length];
    if (next) onPick(next.id);
  };
  return (
    <Box className={css.Carousel} role="group" aria-label="Places" aria-roledescription="carousel">
      <IconButton
        className={PhoneHit}
        variant="Background"
        size="300"
        aria-label="Previous place"
        onClick={() => step(-1)}
      >
        <Icon size="200" src={Icons.ChevronLeft} />
      </IconButton>
      <div
        ref={strip}
        className={css.Strip}
        onScroll={(evt) => {
          const el = evt.currentTarget;
          clearTimeout(settle.current);
          settle.current = setTimeout(() => {
            const to = places[centredIndex(el)];
            if (to && to.id !== shown.current) onPick(to.id);
          }, SETTLE_MS);
        }}
      >
        {places.map((p) => (
          <button
            key={p.id}
            type="button"
            className={css.PlaceCard}
            aria-current={p.id === current}
            onClick={() => onPick(p.id)}
          >
            <Text size="T400">{p.name}</Text>
            <Text size="T200" priority="300">
              {hhmm(localMinutes(now, p.tz))} local
            </Text>
          </button>
        ))}
      </div>
      <IconButton
        className={PhoneHit}
        variant="Background"
        size="300"
        aria-label="Next place"
        onClick={() => step(1)}
      >
        <Icon size="200" src={Icons.ChevronRight} />
      </IconButton>
    </Box>
  );
}

/**
 * The Place submenu of the scene view: the carousel of the baked places (ruling ridge-places-dropdown-first-four; absent while the index lists one) and every credit the
 * view owes (ruling ridge-view-credits-home: Place alone, no footer, no credit in Sky). The terrain credit is the bake's, the stars and the lines are drawn
 * over any place at night, and the weather's credit is the feed row's, shown only where the place shown has a feed (`weatherFeed.ts`).
 */
export function PlaceSubmenu({ manifest }: { manifest: RidgeManifest | undefined }) {
  const place = useDrawnPlace() ?? FALLBACK_VIEW.place;
  const places = usePlaceList();
  const credit = terrainCredit(manifest);
  const feed = feedFor(place.id);
  return (
    <Box direction="Column" gap="300">
      {places && places.length > 1 ? (
        <PlaceCarousel places={places} current={place.id} now={skyNow()} onPick={setPlaceChoice} />
      ) : (
        <Text size="T300">{manifest?.name ?? place.id}</Text>
      )}
      <Box direction="Column" gap="100">
        <Text size="L400" priority="300">
          Data
        </Text>
        {credit && (
          <Text size="T200" priority="300">
            {credit}
          </Text>
        )}
        <Text size="T200" priority="300">
          {STARS_CREDIT}.
        </Text>
        <Text size="T200" priority="300">
          {LINES_CREDIT}.
        </Text>
        {feed && (
          <Text size="T200" priority="300">
            {feed.credit} -{' '}
            <a href={feed.url} target="_blank" rel="noreferrer noopener">
              {feed.url}
            </a>
            . {feed.dataset}.
          </Text>
        )}
      </Box>
    </Box>
  );
}
