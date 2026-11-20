import { useEffect, useSyncExternalStore } from 'react';
import { getResolvedSkyState, getSkyChoice, subscribe } from '../features/scene/skyState';
import type { FixedSkyState, SkyChoice } from '../features/scene/ridge/skyMoment';
import { ensureSkyPlace } from '../features/scene/skyPlace';
import { getSceneDrawn, subscribeSceneDrawn } from '../features/scene/sceneDrawn';
import { useClientConfig } from './useClientConfig';

/** The choice, as the control shows it (Auto stays Auto). The sky being drawn is `useResolvedSkyState`. */
export const useSkyChoice = (): SkyChoice => useSyncExternalStore(subscribe, getSkyChoice);

/** The sky being drawn: day, dusk or night, or undefined until the place is known. Unlike the choice it changes as the clock crosses under Auto, so it re-renders. */
export const useResolvedSkyState = (): FixedSkyState | undefined =>
  useSyncExternalStore(subscribe, getResolvedSkyState);

/** Make the configured place the sky's (skyPlace.ts). Mounted once by each theme manager; the load is shared and idempotent. */
export const useSkyPlace = (): void => {
  const place = useClientConfig().backgroundScene?.place;
  useEffect(() => {
    ensureSkyPlace({ place });
  }, [place]);
};

/** Whether a background scene is drawing a sky right now (not merely configured): false on a failed or lost context. */
export const useSceneOn = (): boolean => useSyncExternalStore(subscribeSceneDrawn, getSceneDrawn);
