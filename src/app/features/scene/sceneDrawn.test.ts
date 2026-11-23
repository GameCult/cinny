import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SCENE_ACTIVE_ATTRIBUTE,
  getDrawnSky,
  getSceneDrawn,
  setSceneDrawn,
  subscribeSceneDrawn,
} from './sceneDrawn';

const attrs = new Set<string>();
vi.stubGlobal('document', {
  documentElement: {
    setAttribute: (n: string) => attrs.add(n),
    removeAttribute: (n: string) => attrs.delete(n),
  },
});

afterEach(() => setSceneDrawn(false));

describe('sceneDrawn: one store owns the flag and html[data-scene]', () => {
  it('starts off, and on/off move the flag, the attribute and the subscribers together', () => {
    const cb = vi.fn();
    const off = subscribeSceneDrawn(cb);
    expect(getSceneDrawn()).toBe(false);
    setSceneDrawn(true);
    expect(getSceneDrawn()).toBe(true);
    expect(attrs.has(SCENE_ACTIVE_ATTRIBUTE)).toBe(true);
    setSceneDrawn(true);
    expect(cb).toHaveBeenCalledTimes(1);
    setSceneDrawn(false);
    expect(getSceneDrawn()).toBe(false);
    expect(attrs.has(SCENE_ACTIVE_ATTRIBUTE)).toBe(false);
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    setSceneDrawn(true);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('owns the sky the scene that is up draws: set with the scene, told to subscribers when it changes, gone with the scene', () => {
    const cb = vi.fn();
    const off = subscribeSceneDrawn(cb);
    expect(getDrawnSky()).toBeUndefined();
    setSceneDrawn(true, 'day');
    expect(getDrawnSky()).toBe('day');
    setSceneDrawn(true, 'day');
    expect(cb).toHaveBeenCalledTimes(1);
    setSceneDrawn(true, 'night'); // a rebuilt scene replaced the one shown
    expect(getDrawnSky()).toBe('night');
    expect(cb).toHaveBeenCalledTimes(2);
    setSceneDrawn(false, 'night'); // no scene draws no sky
    expect(getDrawnSky()).toBeUndefined();
    off();
  });
});
