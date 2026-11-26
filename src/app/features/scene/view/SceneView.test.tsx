import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneHit } from '../../../styles/PhoneHit.css';
import SceneView, { Rail, SUBMENUS } from './SceneView';

// The hooks are held still (TimeSubmenu.test.tsx): the element tree is read, a function component is expanded by calling it.
const held = vi.hoisted(() => ({
  effects: [] as Array<() => unknown>,
  submenu: undefined as unknown,
  closed: 0,
  picked: [] as unknown[],
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = (init: unknown) => [
    typeof init === 'function' ? (init as () => unknown)() : init,
    () => undefined,
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
