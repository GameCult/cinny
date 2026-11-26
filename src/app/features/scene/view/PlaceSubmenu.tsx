import React from 'react';
import { Box, Text } from 'folds';
import { useDrawnPlace } from '../../../hooks/useSkyState';
import { terrainCredit, WEATHER_CREDIT_URL, WEATHER_DATASET } from '../ridge/credits';
import type { RidgeManifest } from '../ridge/manifest';
import { FALLBACK_VIEW } from '../ridge/view';

/**
 * The Place submenu of the scene view: the shell and its credits. The carousel of baked places is cut ridge-places; until it lands this names the place shown.
 * The elevation credit lives here, under the place it credits (ruling ridge-view-credits-home), with the weather's, which GeoSphere asks for with any view of
 * its data.
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
          Datenquelle: GeoSphere Austria -{' '}
          <a href={WEATHER_CREDIT_URL} target="_blank" rel="noreferrer noopener">
            {WEATHER_CREDIT_URL}
          </a>
          . {WEATHER_DATASET}.
        </Text>
      </Box>
    </Box>
  );
}
