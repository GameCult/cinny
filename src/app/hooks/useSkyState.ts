import { useSyncExternalStore } from 'react';
import { getSkyState, subscribe, type SkyState } from '../features/scene/skyState';

export const useSkyState = (): SkyState => useSyncExternalStore(subscribe, getSkyState);
