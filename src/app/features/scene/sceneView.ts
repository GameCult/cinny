// The scene view: whether the fullscreen view of the scene is open, and which submenu it shows. The one owner of both (ruling ridge-scene-view-fullscreen). Opening
// pushes one history entry, so the browser's Back button, Escape and the Return icon are all the same act, closing; while it is open the app (#root) is inert and
// hidden but stays mounted, so the chat keeps its scroll and its composer. Closing is Return: the rotation a manual turn held resumes through `cameraState`
// (ruling ridge-view-turn-handback). The view's controls write the stores that own what they set (cameraState.ts, skyState.ts) and hold no copy of them.
// Main-chunk safe (no React, no ridge code), as skyState.ts and cameraState.ts are.
import { getCamera, setCamera } from './cameraState';

export type Submenu = 'view' | 'time' | 'sky' | 'place';

export interface SceneViewState {
  open: boolean;
  /** The submenu whose panel is up, if any: one at a time. */
  submenu: Submenu | undefined;
}

/** Set on <html> while the view is open: the shell is hidden and the view is the only thing over the scene. */
export const SCENE_VIEW_ATTRIBUTE = 'data-scene-view';
/** The mark the view's history entry carries beside whatever the router keeps in `history.state`. */
export const SCENE_VIEW_HISTORY_MARK = 'ratatoskrSceneView';

let state: SceneViewState = { open: false, submenu: undefined };
const listeners = new Set<() => void>();
/** The control that opened the view, which takes the focus back when it closes. */
let entry: HTMLElement | null = null;
/** Whether this view pushed a history entry that is still on top of the stack. */
let pushed = false;

export const getSceneView = (): SceneViewState => state;

export const subscribeSceneView = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const set = (next: SceneViewState): void => {
  state = next;
  [...listeners].forEach((cb) => cb());
};

const root = (): HTMLElement | null => document.getElementById('root');

/** Browser Back (or Forward over the entry) while the view is open: it is Return, and the entry is already gone. */
const onPopState = (): void => {
  pushed = false;
  finish();
};

/** Open the view: one history entry, the app inert and hidden behind it. A second call while open changes nothing. */
export function openSceneView(): void {
  if (state.open) return;
  entry = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  try {
    window.history.pushState(
      { ...(window.history.state ?? {}), [SCENE_VIEW_HISTORY_MARK]: true },
      ''
    );
    pushed = true;
  } catch {
    pushed = false; // no history to push to: Return and Escape still close it
  }
  window.addEventListener('popstate', onPopState);
  document.documentElement.setAttribute(SCENE_VIEW_ATTRIBUTE, '');
  root()?.setAttribute('inert', '');
  set({ open: true, submenu: undefined });
}

/** Everything closing does, whichever way it came: the app live again, the rotation a manual turn held resumed, the focus back where it was. */
function finish(): void {
  if (!state.open) return;
  window.removeEventListener('popstate', onPopState);
  document.documentElement.removeAttribute(SCENE_VIEW_ATTRIBUTE);
  root()?.removeAttribute('inert');
  // Picking the mode already chosen ends a hold (cameraState.ts): the scene behind the chat turns again from where the viewer left it.
  setCamera({ mode: getCamera().mode });
  const back = entry;
  entry = null;
  set({ open: false, submenu: undefined });
  back?.focus?.();
}

/** Return: close the view, and take its history entry off the stack when it is still the top one. */
export function closeSceneView(): void {
  if (!state.open) return;
  const wasPushed = pushed;
  finish(); // takes the popstate listener off first, so the back below does not close twice
  if (wasPushed && window.history.state?.[SCENE_VIEW_HISTORY_MARK]) window.history.back();
  pushed = false;
}

/** Show a submenu's panel, or none; choosing the one already shown closes its panel. */
export function setSubmenu(submenu: Submenu | undefined): void {
  if (!state.open) return;
  set({ open: true, submenu: submenu === state.submenu ? undefined : submenu });
}

/** The view's code, a chunk of its own: asked for when the entry is hovered or focused, and by the host when the view opens. */
export const loadSceneView = () => import('./view/SceneView');
