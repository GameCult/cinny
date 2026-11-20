import { useSyncExternalStore } from 'react';
import {
  getResolvedSkyState,
  getSkyState,
  subscribe,
  type FixedSkyState,
  type SkyState,
} from '../features/scene/skyState';
import { getSceneDrawn, subscribeSceneDrawn } from '../features/scene/sceneDrawn';

/** The choice, as the control shows it ('auto' stays 'auto'). The sky being drawn is `useResolvedSkyState`. */
export const useSkyState = (): SkyState => useSyncExternalStore(subscribe, getSkyState);

/** The sky being drawn: day, dusk or night. Unlike the choice it changes as the clock crosses, so it re-renders. */
export const useResolvedSkyState = (): FixedSkyState =>
  useSyncExternalStore(subscribe, getResolvedSkyState);

/** Whether a background scene is drawing a sky right now (not merely configured): false on a failed or lost context. */
export const useSceneOn = (): boolean => useSyncExternalStore(subscribeSceneDrawn, getSceneDrawn);
