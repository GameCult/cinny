import React from 'react';
import { Box, Text } from 'folds';
import { useDrawnPlace } from '../../../hooks/useSkyState';
import {
  LINES_CREDIT,
  STARS_CREDIT,
  terrainCredit,
  WEATHER_CREDIT_URL,
  WEATHER_DATASET,
  weatherServes,
} from '../ridge/credits';
import type { RidgeManifest } from '../ridge/manifest';
import { FALLBACK_VIEW } from '../ridge/view';

/**
 * The Place submenu of the scene view: the shell and every credit the view owes (ruling ridge-view-credits-home: Place alone, no footer, no credit in Sky). The
 * carousel of baked places is cut ridge-places; until it lands this names the place shown. The terrain credit is the bake's, the stars and the lines are drawn
 * over any place at night, and GeoSphere's credit appears only where the weather feed serves the place shown.
 */
export function PlaceSubmenu({ manifest }: { manifest: RidgeManifest | undefined }) {
  const place = useDrawnPlace() ?? FALLBACK_VIEW.place;
  const credit = terrainCredit(manifest);
  return (
    <Box direction="Column" gap="300">
      <Text size="T300">{place.id}</Text>
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
        {weatherServes(place) && (
          <Text size="T200" priority="300">
            Datenquelle: GeoSphere Austria -{' '}
            <a href={WEATHER_CREDIT_URL} target="_blank" rel="noreferrer noopener">
              {WEATHER_CREDIT_URL}
            </a>
            . {WEATHER_DATASET}.
          </Text>
        )}
      </Box>
    </Box>
  );
}
