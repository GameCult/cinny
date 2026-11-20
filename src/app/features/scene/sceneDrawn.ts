// Whether a background scene is drawing a sky right now. BackgroundScene is the only writer: it sets this when the
// ridge scene starts, and clears it when the scene stops, fails to start, or loses its WebGL context (a restored
// context sets it again). This store also owns html[data-scene], so the attribute the CSS reads and the flag the theme
// hooks read cannot disagree. The configured tier only says a scene may run; this says one does.

/** Set on <html> while a scene is drawn, so signed-out screens can let it show through. */
export const SCENE_ACTIVE_ATTRIBUTE = 'data-scene';

let drawn = false;
const listeners = new Set<() => void>();

export const getSceneDrawn = (): boolean => drawn;

export const subscribeSceneDrawn = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export function setSceneDrawn(on: boolean): void {
  if (typeof document !== 'undefined') {
    if (on) document.documentElement.setAttribute(SCENE_ACTIVE_ATTRIBUTE, '');
    else document.documentElement.removeAttribute(SCENE_ACTIVE_ATTRIBUTE);
  }
  if (on === drawn) return;
  drawn = on;
  [...listeners].forEach((cb) => cb());
}
