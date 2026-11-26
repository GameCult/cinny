import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseManifest } from '../ridge/manifest';
import { wireManifest } from '../ridge/manifest.fixture';
import { maxSpeed, offsetRange, SPEED_CEILING_DEG_S, windowFor } from '../ridge/view';
import type { CameraChoice } from '../cameraState';
import { ViewSubmenu, floorToTenth, offsetBounds, speedBounds } from './ViewSubmenu';

// The hooks are held still, as in TimeSubmenu.test.tsx: the element tree is read, a function component is expanded by calling it, and the native events
// are dispatched on a fake input.
const held = vi.hoisted(() => ({
  effects: [] as Array<() => unknown>,
  cam: { mode: 'both', speedDegPerS: 0.6, offsetM: 200 } as unknown,
  heldView: false,
  commits: [] as unknown[],
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = (init: unknown) => [
    typeof init === 'function' ? (init as () => unknown)() : init,
    () => undefined,
  ];
  const useRef = (init: unknown) => ({ current: init });
  const useEffect = (fn: () => unknown) => {
    held.effects.push(fn);
  };
  return {
    ...actual,
    default: { ...actual, useState, useRef, useEffect },
    useState,
    useRef,
    useEffect,
  };
});
vi.mock('../../../hooks/useSceneView', () => ({
  useCamera: () => held.cam,
  useCameraHeld: () => held.heldView,
}));
vi.mock('../cameraState', () => ({ setCamera: (c: unknown) => held.commits.push(c) }));

type El = { type?: unknown; ref?: unknown; props?: Record<string, unknown> };
const walk = (node: unknown): El[] => {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (node && typeof node === 'object' && 'props' in node) {
    const el = node as El;
    return [el, ...Object.values(el.props ?? {}).flatMap(walk)];
  }
  return [];
};
const fakeInput = (value: string) => Object.assign(new EventTarget(), { value });
const fire = (el: EventTarget, type: 'input' | 'change') => el.dispatchEvent(new Event(type));

const manifest = parseManifest(wireManifest(), 'http://x/ridge/vienna/');
const SIZE = { w: 1920, h: 1080 };
const tree = () => walk(ViewSubmenu({ manifest, size: SIZE }));
const slider = (label: string) => tree().find((e) => e.props?.label === label);

beforeEach(() => {
  held.effects.length = 0;
  held.commits.length = 0;
  held.cam = { mode: 'both', speedDegPerS: 0.6, offsetM: 200 } satisfies CameraChoice;
  held.heldView = false;
});

describe('the View submenu', () => {
  it('lists the three rotation modes, the chosen one checked, and picking one sets the camera mode', () => {
    const radios = () => tree().filter((e) => e.props?.role === 'radio');
    expect(radios().map((e) => e.props?.['aria-checked'])).toEqual([false, false, true]);
    held.cam = { mode: 'still', speedDegPerS: 0.6, offsetM: 0 };
    expect(radios().map((e) => e.props?.['aria-checked'])).toEqual([true, false, false]);
    (radios()[1].props?.onClick as () => void)();
    expect(held.commits).toEqual([{ mode: 'offset' }]);
  });

  it('the speed slider is bounded by what the baked place sustains in the mode, never past the ceiling', () => {
    for (const mode of ['still', 'offset', 'both'] as const) {
      const [lo, hi] = speedBounds(manifest, mode);
      expect(lo).toBe(0);
      expect(hi).toBeLessThanOrEqual(maxSpeed(manifest, mode));
      expect(hi).toBeLessThanOrEqual(SPEED_CEILING_DEG_S);
      expect(hi).toBeGreaterThan(maxSpeed(manifest, mode) - 0.1 - 1e-9);
    }
    held.cam = { mode: 'both', speedDegPerS: 99, offsetM: 0 };
    const s = slider('Rotation speed');
    expect(s?.props?.max).toBe(speedBounds(manifest, 'both')[1]);
    expect(s?.props?.value).toBe(speedBounds(manifest, 'both')[1]); // a stored speed past the bound shows at the bound
    expect(speedBounds(undefined, 'both')).toEqual([0, SPEED_CEILING_DEG_S]);
  });

  it('the speed bound is the place\'s own, far under the global ceiling, when the ring is cut as the baker cuts it', () => {
    const ring = parseManifest(wireManifest({}, 3, 32), 'http://x/ridge/vienna/');
    const slow = maxSpeed(ring, 'both');
    expect(slow).toBeLessThan(SPEED_CEILING_DEG_S / 4);
    const [, hi] = speedBounds(ring, 'both');
    expect(hi).toBeLessThanOrEqual(slow);
    expect(hi).toBeGreaterThan(slow - 0.1);
    expect(hi).toBeLessThan(SPEED_CEILING_DEG_S);
    expect(speedBounds(ring, 'offset')[1]).toBe(SPEED_CEILING_DEG_S); // the modes with no bound take the ceiling
    held.cam = { mode: 'both', speedDegPerS: 99, offsetM: 0 };
    const s = walk(ViewSubmenu({ manifest: ring, size: SIZE })).find(
      (e) => e.props?.label === 'Rotation speed'
    );
    expect(s?.props?.max).toBe(hi);
    expect(s?.props?.value).toBe(hi);
  });

  it('no stepped bound exceeds the speed it bounds: a tenth multiplied in floats is not trusted', () => {
    for (let k = 0; k <= 120; k += 1) {
      const v = Number(`${k / 10}`);
      expect(floorToTenth(v)).toBeLessThanOrEqual(v);
      expect(floorToTenth(v + 0.04)).toBeGreaterThanOrEqual(v);
    }
    expect(floorToTenth(0.3)).toBeLessThanOrEqual(0.3);
    expect(floorToTenth(0.975)).toBe(0.9);
  });

  it('the offset slider spans offsetRange for the mode on this viewport, signed, and follows the mode', () => {
    const win = windowFor(manifest.view, SIZE.w, SIZE.h);
    const [lo, hi] = offsetRange(manifest, win, 'both');
    const s = slider('Parallax offset');
    expect(s?.props?.min).toBeLessThanOrEqual(0);
    expect(s?.props?.min).toBeGreaterThanOrEqual(lo);
    expect(s?.props?.min as number).toBeGreaterThan(lo - 5);
    expect(s?.props?.max).toBeLessThanOrEqual(hi);
    expect(s?.props?.max as number).toBeGreaterThan(hi - 5);
    expect(offsetBounds(manifest, SIZE, 'offset')[1]).toBeLessThanOrEqual(manifest.camera.rMaxM);
    held.cam = { mode: 'offset', speedDegPerS: 0.6, offsetM: 200 };
    const [, ohi] = offsetRange(manifest, win, 'offset');
    expect((slider('Parallax offset')?.props?.max as number) <= ohi).toBe(true);
  });

  it('a slider commits once, on release, not on each input tick', () => {
    const s = slider('Parallax offset') as El;
    const expanded = walk((s.type as (p: unknown) => unknown)(s.props));
    const range = expanded.find((e) => e.type === 'input') as El;
    const input = fakeInput('120');
    (range.ref as { current: unknown }).current = input;
    held.effects.forEach((run) => run());
    for (let i = 0; i < 5; i += 1) fire(input, 'input');
    expect(held.commits).toEqual([]);
    fire(input, 'change');
    expect(held.commits).toEqual([{ offsetM: 120 }]);
  });

  it('says so while a manual turn holds the view', () => {
    const text = () =>
      walk(ViewSubmenu({ manifest, size: SIZE }))
        .map((e) => e.props?.children)
        .filter((c) => typeof c === 'string' && /Held/.test(c));
    expect(text()).toEqual([]);
    held.heldView = true;
    expect(text()).toHaveLength(1);
  });
});
