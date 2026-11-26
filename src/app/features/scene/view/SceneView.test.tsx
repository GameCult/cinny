import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneHit } from '../../../styles/PhoneHit.css';
import SceneView, { Rail, SUBMENUS } from './SceneView';
import { TURNING_CHROME_OPACITY } from './SceneView.css';

// The hooks are held still (TimeSubmenu.test.tsx): the element tree is read, a function component is expanded by calling it.
const held = vi.hoisted(() => ({
  effects: [] as Array<() => unknown>,
  submenu: undefined as unknown,
  closed: 0,
  picked: [] as unknown[],
  turning: [] as boolean[],
  turner: [] as Array<[string, ...unknown[]]>,
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = (init: unknown) => [
    typeof init === 'function' ? (init as () => unknown)() : init,
    (v: unknown) => typeof v === 'boolean' && held.turning.push(v),
  ];
  const useRef = (init: unknown) => ({ current: init });
  const useMemo = (fn: () => unknown) => fn();
  const useEffect = (fn: () => unknown) => {
    held.effects.push(fn);
  };
  return {
    ...actual,
    default: { ...actual, useState, useRef, useEffect, useMemo },
    useState,
    useRef,
    useEffect,
    useMemo,
  };
});
vi.mock('../../../hooks/useSceneView', () => ({
  useSceneViewState: () => ({ open: true, submenu: held.submenu }),
  useRidgeManifest: () => undefined,
}));
vi.mock('../sceneView', () => ({
  closeSceneView: () => {
    held.closed += 1;
  },
  setSubmenu: (s: unknown) => held.picked.push(s),
}));
vi.mock('./turning', () => ({
  pxPerDegreeOf: () => 20,
  createTurner: () => ({
    down: (x: number) => held.turner.push(['down', x]),
    move: (x: number) => held.turner.push(['move', x]),
    up: () => held.turner.push(['up']),
    wheel: (dx: number) => held.turner.push(['wheel', dx]),
    key: () => false,
  }),
}));
vi.mock('focus-trap-react', () => ({ default: ({ children }: { children: unknown }) => children }));

type El = { type?: unknown; ref?: unknown; key?: unknown; props?: Record<string, unknown> };
const walk = (node: unknown): El[] => {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (node && typeof node === 'object' && 'props' in node) {
    const el = node as El;
    return [el, ...Object.values(el.props ?? {}).flatMap(walk)];
  }
  return [];
};
const labels = (els: El[]) => els.map((e) => e.props?.['aria-label']).filter(Boolean);

beforeEach(() => {
  held.effects.length = 0;
  held.submenu = undefined;
  held.closed = 0;
  held.picked.length = 0;
  held.turning.length = 0;
  held.turner.length = 0;
  vi.stubGlobal('window', {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the rail', () => {
  const rail = () =>
    walk(
      Rail({
        items: SUBMENUS,
        active: undefined,
        onReturn: () => undefined,
        onPick: () => undefined,
      })
    );

  it('lists Return first, then View, Time, Sky and Place, as a vertical toolbar', () => {
    const els = rail();
    expect(els[0].props).toMatchObject({ role: 'toolbar', 'aria-orientation': 'vertical' });
    expect(
      els.filter((e) => typeof e.props?.label === 'string').map((e) => e.props?.label)
    ).toEqual(['Return', 'View', 'Time', 'Sky', 'Place']);
  });

  it('every rail icon is an IconButton carrying PhoneHit, with a label and a roving tab stop on Return', () => {
    const buttons = rail()
      .filter((e) => typeof e.props?.label === 'string')
      .map((e) =>
        walk((e.type as (p: unknown) => unknown)(e.props)).find(
          (x) => x.props?.className === PhoneHit
        )
      );
    expect(buttons).toHaveLength(5);
    buttons.forEach((b) => expect(b?.props?.['aria-label']).toBeTruthy());
    expect(buttons.map((b) => b?.props?.tabIndex)).toEqual([0, -1, -1, -1, -1]);
  });

  it('marks the submenu whose panel is up, and Return and a pick go to their handlers', () => {
    const onPick = vi.fn();
    const onReturn = vi.fn();
    const els = walk(Rail({ items: SUBMENUS, active: 'time', onReturn, onPick }));
    const item = (label: string) =>
      els.find((e) => e.props?.label === label)?.props as Record<string, unknown>;
    expect(['View', 'Time', 'Sky', 'Place'].map((l) => item(l).pressed)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    (item('Return').onClick as () => void)();
    (item('Sky').onClick as () => void)();
    expect(onReturn).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledWith('sky');
  });
});

describe('the view', () => {
  const tree = () => walk(SceneView());
  const panels = () => tree().filter((e) => e.type === 'section');

  it('shows no panel until a submenu is picked, then exactly one', () => {
    expect(panels()).toHaveLength(0);
    for (const s of ['view', 'time', 'sky', 'place']) {
      held.submenu = s;
      expect(panels()).toHaveLength(1);
    }
  });

  it('a drag over the rail or its panel does not turn the view: the turning surface holds neither', () => {
    held.submenu = 'view';
    const els = walk(SceneView());
    const surface = els.find((e) => typeof e.props?.onPointerDown === 'function') as El;
    expect(walk(surface.props?.children)).toEqual([]);
    expect(labels(walk(surface))).toEqual([]);
    // the chrome is a sibling of the surface, so a pointer on a plate never reaches the surface's handlers
    const root = els.find((e) => e.props?.['data-turning'] !== undefined) as El;
    const kids = (root.props?.children as El[]).filter(Boolean);
    expect(kids).toHaveLength(2);
    expect(kids[0]).toBe(surface);
  });

  it('Escape is Return: the key listener closes the view', () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    vi.stubGlobal('window', {
      innerWidth: 1280,
      innerHeight: 720,
      addEventListener: (t: string, cb: (e: unknown) => void) => {
        listeners[t] = cb;
      },
      removeEventListener: () => undefined,
    });
    SceneView();
    held.effects.forEach((run) => run());
    listeners.keydown({ key: 'Escape', stopPropagation: () => undefined });
    expect(held.closed).toBe(1);
  });
});

describe('one finger on the phone (ruling ridge-view-phone-one-finger)', () => {
  const surface = () =>
    walk(SceneView()).find((e) => typeof e.props?.onPointerDown === 'function') as El;
  const on = (name: string, evt: Record<string, unknown>) =>
    (surface().props?.[name] as (e: unknown) => void)({
      currentTarget: { setPointerCapture: () => undefined },
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      clientX: 0,
      clientY: 0,
      ...evt,
    });

  it('the rail and the panel fade while a finger is down and come back when it lifts', () => {
    expect(TURNING_CHROME_OPACITY).toBeGreaterThan(0);
    expect(TURNING_CHROME_OPACITY).toBeLessThan(0.5);
    on('onPointerDown', { clientX: 100 });
    on('onPointerUp', {});
    on('onPointerDown', { clientX: 100 });
    on('onPointerCancel', {});
    expect(held.turning).toEqual([true, false, true, false]);
  });

  it('only horizontal movement turns: the vertical is never given to the turner', () => {
    on('onPointerDown', { clientX: 100, clientY: 50 });
    on('onPointerMove', { clientX: 140, clientY: 900 });
    on('onPointerMove', { clientX: 140, clientY: -900 });
    expect(held.turner).toEqual([['down', 100], ['move', 140], ['move', 140]]);
    held.turner.length = 0;
    on('onWheel', { deltaX: 2, deltaY: 90 });
    expect(held.turner).toEqual([]); // a mostly vertical wheel is not a turn either
  });

  it('a second finger (not the primary pointer) starts nothing', () => {
    on('onPointerDown', { isPrimary: false, clientX: 100 });
    expect(held.turner).toEqual([]);
    expect(held.turning).toEqual([]);
  });

  it('a mouse turns only with its main button', () => {
    on('onPointerDown', { pointerType: 'mouse', button: 2, clientX: 100 });
    expect(held.turner).toEqual([]);
    on('onPointerDown', { pointerType: 'mouse', button: 0, clientX: 100 });
    expect(held.turner).toEqual([['down', 100]]);
  });
});
