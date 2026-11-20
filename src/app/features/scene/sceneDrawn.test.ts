import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SCENE_ACTIVE_ATTRIBUTE,
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
});
