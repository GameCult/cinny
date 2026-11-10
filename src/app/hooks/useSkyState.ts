import { useSyncExternalStore } from 'react';
import { getSkyState, subscribe, type SkyState } from '../features/scene/skyState';

/** The choice, as the control shows it ('auto' stays 'auto'). The sky being drawn is `getResolvedSkyState`. */
export const useSkyState = (): SkyState => useSyncExternalStore(subscribe, getSkyState);
