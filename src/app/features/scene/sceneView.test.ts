import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCamera, holdCamera, isHeld, resetCamera } from './cameraState';
import {
  SCENE_VIEW_ATTRIBUTE,
  SCENE_VIEW_HISTORY_MARK,
  closeSceneView,
  getSceneView,
  loadSceneView,
  loadSceneViewOrClose,
  openSceneView,
  setSubmenu,
  subscribeSceneView,
} from './sceneView';

// No DOM here: the few things the module touches (<html>, #root, the focused element, the history stack and the window's popstate) are stand-ins.
class Entry {
  focused = 0;
  focus() {
    this.focused += 1;
  }
}
const entryEl = new Entry();
let attrs: Set<string>;
let rootAttrs: Set<string>;
let stack: Array<Record<string, unknown> | null>;
let pops: Set<() => void>;
let back: number;

beforeEach(() => {
  attrs = new Set();
  rootAttrs = new Set();
  stack = [{ idx: 0 }];
  pops = new Set();
  back = 0;
  entryEl.focused = 0;
  vi.stubGlobal('HTMLElement', Entry);
  vi.stubGlobal('document', {
    activeElement: entryEl,
    documentElement: {
      setAttribute: (k: string) => attrs.add(k),
      removeAttribute: (k: string) => attrs.delete(k),
    },
    getElementById: (id: string) =>
      id === 'root'
        ? {
            setAttribute: (k: string) => rootAttrs.add(k),
            removeAttribute: (k: string) => rootAttrs.delete(k),
          }
        : null,
  });
  const history = {
    get state() {
      return stack[stack.length - 1];
    },
    pushState: (s: Record<string, unknown>) => stack.push(s),
    back: () => {
      back += 1;
      stack.pop();
      [...pops].forEach((cb) => cb());
    },
  };
  vi.stubGlobal('window', {
    history,
    addEventListener: (t: string, cb: () => void) => t === 'popstate' && pops.add(cb),
    removeEventListener: (t: string, cb: () => void) => t === 'popstate' && pops.delete(cb),
  });
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  resetCamera();
});

afterEach(() => {
  closeSceneView();
  vi.unstubAllGlobals();
});

describe('the scene view', () => {
  it('opens with one history entry that keeps what the router keeps, the app inert and the page marked', () => {
    openSceneView();
    openSceneView();
    expect(getSceneView()).toEqual({ open: true, submenu: undefined });
    expect(stack).toHaveLength(2);
    expect(stack[1]).toEqual({ idx: 0, [SCENE_VIEW_HISTORY_MARK]: true });
    expect(rootAttrs.has('inert')).toBe(true);
    expect(attrs.has(SCENE_VIEW_ATTRIBUTE)).toBe(true);
  });

  it('the Return icon closes it, takes its entry off the stack, frees the app and gives the focus back to the entry', () => {
    openSceneView();
    closeSceneView();
    expect(getSceneView().open).toBe(false);
    expect(stack).toHaveLength(1);
    expect(back).toBe(1);
    expect(rootAttrs.size).toBe(0);
    expect(attrs.size).toBe(0);
    expect(entryEl.focused).toBe(1);
    closeSceneView();
    expect(back).toBe(1);
  });

  it("the browser's Back button closes it (the entry is already gone), once, and the focus returns", () => {
    openSceneView();
    const seen = vi.fn();
    subscribeSceneView(seen);
    window.history.back();
    expect(getSceneView().open).toBe(false);
    expect(stack).toHaveLength(1);
    expect(back).toBe(1); // that one was the browser's; the close did not go back again
    expect(seen).toHaveBeenCalledTimes(1);
    expect(rootAttrs.size).toBe(0);
    expect(entryEl.focused).toBe(1);
  });

  it('shows one submenu at a time, and choosing the one shown closes its panel', () => {
    setSubmenu('view');
    expect(getSceneView().submenu).toBeUndefined(); // closed: nothing to show
    openSceneView();
    setSubmenu('view');
    expect(getSceneView().submenu).toBe('view');
    setSubmenu('time');
    expect(getSceneView().submenu).toBe('time');
    setSubmenu('time');
    expect(getSceneView().submenu).toBeUndefined();
    setSubmenu('sky');
    closeSceneView();
    openSceneView();
    expect(getSceneView().submenu).toBeUndefined();
  });

  it('Return resumes a rotation a manual turn held, through the camera store', () => {
    openSceneView();
    holdCamera(0);
    expect(isHeld()).toBe(true);
    const mode = getCamera().mode;
    closeSceneView();
    expect(isHeld()).toBe(false);
    expect(getCamera().mode).toBe(mode);
  });
});

describe('the view code failing to load', () => {
  it('closes an open view: the app is live again, nothing stays hidden, and the next open can ask again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    openSceneView();
    const got = await loadSceneViewOrClose(() => Promise.reject(new Error('chunk')));
    expect(got).toBeUndefined();
    expect(getSceneView().open).toBe(false);
    expect(rootAttrs.size).toBe(0);
    expect(attrs.size).toBe(0);
    openSceneView();
    expect(getSceneView().open).toBe(true);
  });

  it('a load that succeeds leaves the view open and hands back the module', async () => {
    openSceneView();
    const mod = { default: () => null } as unknown as Awaited<ReturnType<typeof loadSceneView>>;
    expect(await loadSceneViewOrClose(() => Promise.resolve(mod))).toBe(mod);
    expect(getSceneView().open).toBe(true);
  });
});
