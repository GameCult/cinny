import { useSyncExternalStore } from 'react';
import {
  getResolvedSkyState,
  getSkyState,
  subscribe,
  type FixedSkyState,
  type SkyState,
} from '../features/scene/skyState';

/** The choice, as the control shows it ('auto' stays 'auto'). */
export const useSkyState = (): SkyState => useSyncExternalStore(subscribe, getSkyState);

/** The sky being drawn: the choice, resolved from the clock for 'auto'. */
export const useResolvedSkyState = (): FixedSkyState =>
  useSyncExternalStore(subscribe, getResolvedSkyState);
