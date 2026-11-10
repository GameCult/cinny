// Temporary: which background the viewer picked (terrain or ridges), kept in one localStorage key so the two scenes we
// serve can be compared on any device. Absent, the client config's backgroundScene.style decides.
import type { SceneStyle } from './tier';

export type ServedSceneStyle = Extract<SceneStyle, 'terrain' | 'ridge'>;
export const SERVED_SCENE_STYLES: readonly ServedSceneStyle[] = ['terrain', 'ridge'];
export const SCENE_STYLE_KEY = 'ratatoskr.sceneStyle';

export function getSceneStyleOverride(): ServedSceneStyle | undefined {
  try {
    const v = localStorage.getItem(SCENE_STYLE_KEY);
    return SERVED_SCENE_STYLES.includes(v as ServedSceneStyle)
      ? (v as ServedSceneStyle)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Store the pick and reload, so the scene host mounts the other scene from a clean page. */
export function setSceneStyle(s: ServedSceneStyle): void {
  try {
    localStorage.setItem(SCENE_STYLE_KEY, s);
  } catch {
    return;
  }
  window.location.reload();
}
