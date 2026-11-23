// Whether a background scene is drawing a sky right now, and which sky (day, dusk or night) the scene that is up draws. BackgroundScene is the only
// writer: it sets this when a scene is up (told the band of the scene it shows, so a rebuild still loading changes nothing here until it replaces it),
// and clears it when the scene stops, fails to start, or loses its WebGL context (a restored context sets it again). The page theme and ink follow
// this sky, never the band the clock or the choice announces (ruling ink-follows-drawn-sky). This store also owns html[data-scene], so the attribute
// the CSS reads and the flag the theme hooks read cannot disagree. The configured tier only says a scene may run; this says one does.
import type { FixedSkyState } from './ridge/skyMoment';

/** Set on <html> while a scene is drawn, so signed-out screens can let it show through. */
export const SCENE_ACTIVE_ATTRIBUTE = 'data-scene';

let drawn = false;
let drawnSky: FixedSkyState | undefined;
const listeners = new Set<() => void>();

export const getSceneDrawn = (): boolean => drawn;

/** The sky the scene that is up draws; undefined with no scene, or a scene whose sky is not known. */
export const getDrawnSky = (): FixedSkyState | undefined => drawnSky;

export const subscribeSceneDrawn = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export function setSceneDrawn(on: boolean, sky?: FixedSkyState): void {
  if (typeof document !== 'undefined') {
    if (on) document.documentElement.setAttribute(SCENE_ACTIVE_ATTRIBUTE, '');
    else document.documentElement.removeAttribute(SCENE_ACTIVE_ATTRIBUTE);
  }
  const next = on ? sky : undefined;
  if (on === drawn && next === drawnSky) return;
  drawn = on;
  drawnSky = next;
  [...listeners].forEach((cb) => cb());
}
