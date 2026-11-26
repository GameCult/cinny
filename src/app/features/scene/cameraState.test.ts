import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as camera from './cameraState';
import {
  bindOwner,
  CAMERA_KEY,
  DEFAULT_CAMERA,
  effectiveMode,
  getCamera,
  holdCamera,
  isHeld,
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

  it('a reduced-motion visit starts still with the default speed and offset kept, which apply once a moving mode is chosen (ruling ridge-reduced-motion-starts-still)', () => {
    reduced.matches = true;
    expect(getCamera()).toEqual({ mode: 'still', speedDegPerS: 0.6, offsetM: 200 });
    expect(effectiveMode()).toBe('still');
    setCamera({ mode: 'both' });
    expect(getCamera()).toEqual({ mode: 'both', speedDegPerS: 0.6, offsetM: 200 });
    expect(effectiveMode()).toBe('both');
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
    expect(cb).toHaveBeenCalledWith({ ...DEFAULT_CAMERA, mode: 'offset' }, DEFAULT_CAMERA, 1234, false);
  });

  it('hands a change to the owner before any listener, at its clock, whenever the listeners registered, and keeps no log of it', () => {
    const order: string[] = [];
    subscribe(() => order.push('early'));
    bindOwner((at) => order.push(`owner ${at}`));
    subscribe(() => order.push('late'));
    setCamera({ offsetM: 5 }, 42);
    holdCamera(43);
    setCamera({ mode: 'both' }, 44); // picking a mode ends the hold
    setCamera({ offsetM: 5 }, 45); // nothing changed
    expect(order).toEqual(['owner 42', 'early', 'late', 'owner 43', 'early', 'late', 'owner 44', 'early', 'late']);
    resetCamera(); // a reload of the choice does not unbind the owner: it outlives the scenes
    setCamera({ offsetM: 9 }, 50);
    expect(order.at(-1)).toBe('owner 50');
    expect(Object.keys(camera)).not.toContain('takeChanges');
    bindOwner(undefined);
  });

  it('a hold is session state: the mode in effect is still, the chosen mode is untouched and stored as chosen, and a reload does not hold', () => {
    setCamera({ mode: 'offset', speedDegPerS: 2 });
    const cb = vi.fn();
    subscribe(cb);
    holdCamera(5);
    expect(isHeld()).toBe(true);
    expect(effectiveMode()).toBe('still');
    expect(getCamera().mode).toBe('offset');
    expect(JSON.parse(store.get(CAMERA_KEY) as string).mode).toBe('offset');
    expect(cb).toHaveBeenCalledTimes(1);
    holdCamera(6); // already held
    expect(cb).toHaveBeenCalledTimes(1);
    setCamera({ offsetM: 10 }); // a slider does not end a hold
    expect(isHeld()).toBe(true);
    resetCamera(); // a reload
    expect(isHeld()).toBe(false);
    expect(effectiveMode()).toBe('offset');
  });

  it('picking a mode ends a hold, the one already chosen included, and is heard as a change though nothing stored moved', () => {
    setCamera({ mode: 'both' });
    holdCamera(1);
    const cb = vi.fn();
    subscribe(cb);
    setCamera({ mode: 'both' }, 9);
    expect(isHeld()).toBe(false);
    expect(effectiveMode()).toBe('both');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][2]).toBe(9);
    expect(cb.mock.calls[0][3]).toBe(true); // it was held until this change
    setCamera({ mode: 'both' }, 10); // nothing held, nothing changed
    expect(cb).toHaveBeenCalledTimes(1);
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
