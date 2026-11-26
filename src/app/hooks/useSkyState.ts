import { useEffect, useState, useSyncExternalStore } from 'react';
import { getSkyChoice, getSkyPlace, skyNow, subscribe } from '../features/scene/skyState';
import type { Place } from '../features/scene/ridge/view';
import type { FixedSkyState, SkyChoice } from '../features/scene/ridge/skyMoment';
import { getDrawnSky, getSceneDrawn, subscribeSceneDrawn } from '../features/scene/sceneDrawn';

/** The choice, as the control shows it (Auto stays Auto). The sky being drawn is `useDrawnSky`. */
export const useSkyChoice = (): SkyChoice => useSyncExternalStore(subscribe, getSkyChoice);

/** The sky the scene that is up draws: day, dusk or night, or undefined with no scene. It moves when a scene replaces the one shown, not when the clock or the choice announces a band the scene has not caught up with. */
export const useDrawnSky = (): FixedSkyState | undefined => useSyncExternalStore(subscribeSceneDrawn, getDrawnSky);

/** The place the sky is over, or undefined until a scene has settled what it draws (skyPlace.ts). */
export const useDrawnPlace = (): Place | undefined => useSyncExternalStore(subscribe, getSkyPlace);

/** Whether a background scene is drawing a sky right now (not merely configured): false on a failed or lost context. */
export const useSceneOn = (): boolean => useSyncExternalStore(subscribeSceneDrawn, getSceneDrawn);

const MINUTE_MS = 60_000;

/**
 * The sky's clock (`skyNow`) for a surface that shows the minute: re-read at every minute boundary while `live` (the sky follows the clock: Auto), and at each
 * render otherwise, since a frozen moment does not move with it. The clock is the sky's own; this holds no second one.
 */
export function useSkyMinute(live: boolean): Date {
  const [now, setNow] = useState<Date>(skyNow);
  useEffect(() => {
    setNow(skyNow());
    if (!live) return undefined;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(() => {
        setNow(skyNow());
        next();
      }, MINUTE_MS - (skyNow().getTime() % MINUTE_MS));
    };
    next();
    return () => clearTimeout(timer);
  }, [live]);
  return live ? now : skyNow();
}
