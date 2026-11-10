import { useSyncExternalStore } from 'react';
import {
  getResolvedSkyState,
  getSkyState,
  subscribe,
  type SkyState,
} from '../features/scene/skyState';
import type { FixedSkyState } from '../features/scene/skyBand';
import { readCapabilities, resolveTier } from '../features/scene/tier';
import { useClientConfig } from './useClientConfig';

/** The choice, as the control shows it ('auto' stays 'auto'). The sky being drawn is `useResolvedSkyState`. */
export const useSkyState = (): SkyState => useSyncExternalStore(subscribe, getSkyState);

/** The sky being drawn: day, dusk or night. Unlike the choice it changes as the clock crosses, so it re-renders. */
export const useResolvedSkyState = (): FixedSkyState =>
  useSyncExternalStore(subscribe, getResolvedSkyState);

/** Whether a background scene runs on this device and config (the tier the scene host will mount). */
export const useSceneOn = (): boolean =>
  resolveTier(useClientConfig().backgroundScene, readCapabilities(navigator)) !== 'off';
