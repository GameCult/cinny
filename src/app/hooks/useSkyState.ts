import { useSyncExternalStore } from 'react';
import {
  getResolvedSkyState,
  getSkyChoice,
  getSkyPlace,
  subscribe,
} from '../features/scene/skyState';
import type { Place } from '../features/scene/ridge/view';
import type { FixedSkyState, SkyChoice } from '../features/scene/ridge/skyMoment';
import { getSceneDrawn, subscribeSceneDrawn } from '../features/scene/sceneDrawn';

/** The choice, as the control shows it (Auto stays Auto). The sky being drawn is `useResolvedSkyState`. */
export const useSkyChoice = (): SkyChoice => useSyncExternalStore(subscribe, getSkyChoice);

/** The sky being drawn: day, dusk or night, or undefined until the place is known. Unlike the choice it changes as the clock crosses under Auto, so it re-renders. */
export const useResolvedSkyState = (): FixedSkyState | undefined =>
  useSyncExternalStore(subscribe, getResolvedSkyState);

/** The place the sky is over, or undefined until a scene has settled what it draws (skyPlace.ts). */
export const useDrawnPlace = (): Place | undefined => useSyncExternalStore(subscribe, getSkyPlace);

/** Whether a background scene is drawing a sky right now (not merely configured): false on a failed or lost context. */
export const useSceneOn = (): boolean => useSyncExternalStore(subscribeSceneDrawn, getSceneDrawn);
