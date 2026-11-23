import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAMERA_KEY,
  DEFAULT_CAMERA,
  getCamera,
  parseCamera,
  resetCamera,
  setCamera,
  subscribe,
} from './cameraState';

const store = new Map<string, string>();
const reduced = { matches: false };

beforeEach(() => {
  store.clear();
  reduced.matches = false;
  resetCamera();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  vi.stubGlobal('window', { matchMedia: () => reduced });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the viewer camera', () => {
  it('starts at the defaults: both, a turn in ten minutes, 200 m forward', () => {
    expect(getCamera()).toEqual({ mode: 'both', speedDegPerS: 0.6, offsetM: 200 });
    expect(DEFAULT_CAMERA).toEqual(getCamera());
  });

  it('starts still under reduced motion, and a stored choice outranks that', () => {
    reduced.matches = true;
    expect(getCamera().mode).toBe('still');
    resetCamera();
    store.set(CAMERA_KEY, JSON.stringify({ mode: 'offset', speedDegPerS: 1, offsetM: -30 }));
    expect(getCamera()).toEqual({ mode: 'offset', speedDegPerS: 1, offsetM: -30 });
  });

  it('keeps each change per viewer, and tells listeners only of a change', () => {
    const cb = vi.fn();
    subscribe(cb);
    setCamera({ offsetM: 50 });
    expect(JSON.parse(store.get(CAMERA_KEY) as string)).toEqual({ ...DEFAULT_CAMERA, offsetM: 50 });
    setCamera({ offsetM: 50 });
    setCamera({ mode: 'both' });
    expect(cb).toHaveBeenCalledTimes(1);
    setCamera({ mode: 'offset', speedDegPerS: 2 });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(getCamera()).toEqual({ mode: 'offset', speedDegPerS: 2, offsetM: 50 });
  });

  it('tells listeners what the choice was and the clock it changed at, so the kinematics can be taken to that moment', () => {
    const cb = vi.fn();
    subscribe(cb);
    setCamera({ mode: 'offset' }, 1234);
    expect(cb).toHaveBeenCalledWith({ ...DEFAULT_CAMERA, mode: 'offset' }, DEFAULT_CAMERA, 1234);
  });

  it('ignores a stored value that is not a choice, and a change that is not one', () => {
    store.set(CAMERA_KEY, '{"mode":"spin","speedDegPerS":1,"offsetM":0}');
    expect(getCamera()).toEqual(DEFAULT_CAMERA);
    store.set(CAMERA_KEY, 'not json');
    resetCamera();
    expect(getCamera()).toEqual(DEFAULT_CAMERA);
    setCamera({ speedDegPerS: Number.NaN });
    setCamera({ mode: 'spin' as never });
    expect(getCamera()).toEqual(DEFAULT_CAMERA);
    expect(parseCamera({ mode: 'still', speedDegPerS: Infinity, offsetM: 0 })).toBeUndefined();
  });

  it('holds the choice for the page load when storage refuses', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    resetCamera();
    expect(getCamera()).toEqual(DEFAULT_CAMERA);
    setCamera({ offsetM: -10 });
    expect(getCamera().offsetM).toBe(-10);
  });
});
