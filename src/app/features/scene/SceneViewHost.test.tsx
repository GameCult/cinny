import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneHit } from '../../styles/PhoneHit.css';
import { SceneViewHost, SceneViewLoading } from './SceneViewHost';

// The hooks are held still (view/SceneView.test.tsx): the element tree is read, effects are kept and run by the test.
const held = vi.hoisted(() => ({
  effects: [] as Array<() => unknown>,
  open: true,
  offered: true,
  view: undefined as unknown,
  closed: 0,
  restored: 0,
  sets: [] as unknown[],
  loads: [] as Array<(m: unknown) => void>,
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = () => [held.view, (v: unknown) => held.sets.push(v)];
  const useEffect = (fn: () => unknown) => {
    held.effects.push(fn);
  };
  return { ...actual, default: { ...actual, useState, useEffect }, useState, useEffect };
});
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
vi.mock('../../hooks/useSceneView', () => ({
  useSceneViewState: () => ({ open: held.open, submenu: undefined }),
  useSceneViewOffered: () => held.offered,
}));
vi.mock('./sceneView', () => ({
  closeSceneView: () => {
    held.closed += 1;
  },
  restoreEntryFocus: () => {
    held.restored += 1;
  },
  loadSceneViewOrClose: () => new Promise((res) => held.loads.push(res)),
}));

type El = { type?: unknown; props?: Record<string, unknown> };
const walk = (node: unknown): El[] => {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (node && typeof node === 'object' && 'props' in node) {
    const el = node as El;
    return [el, ...Object.values(el.props ?? {}).flatMap(walk)];
  }
  return [];
};

beforeEach(() => {
  held.effects.length = 0;
  held.open = true;
  held.offered = true;
  held.view = undefined;
  held.closed = 0;
  held.restored = 0;
  held.sets.length = 0;
  held.loads.length = 0;
  vi.stubGlobal('document', { getElementById: () => ({}) });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the view while its code loads', () => {
  it('shows a Return that closes the view, with the phone tap target', () => {
    const ret = walk(SceneViewLoading()).find((e) => e.props?.['aria-label'] === 'Return');
    expect(String(ret?.props?.className)).toContain(PhoneHit);
    (ret?.props?.onClick as () => void)();
    expect(held.closed).toBe(1);
  });

  it('closes on Escape, and takes its listener off', () => {
    const on: Record<string, (e: unknown) => void> = {};
    let off = 0;
    vi.stubGlobal('window', {
      addEventListener: (t: string, cb: (e: unknown) => void) => {
        on[t] = cb;
      },
      removeEventListener: () => {
        off += 1;
      },
    });
    SceneViewLoading();
    const cleanup = held.effects[0]() as () => void;
    on.keydown({ key: 'a', stopPropagation: () => undefined });
    expect(held.closed).toBe(0);
    on.keydown({ key: 'Escape', stopPropagation: () => undefined });
    expect(held.closed).toBe(1);
    cleanup();
    expect(off).toBe(1);
  });

  it('the open host stands Return in the portal until the view is loaded', () => {
    expect((SceneViewHost() as unknown as El).type).toBe(SceneViewLoading);
  });

  it('asks for the code when the view opens, and the failed load (which closes the view) is the loader, not the host', () => {
    SceneViewHost();
    held.effects.forEach((run) => run());
    expect(held.loads).toHaveLength(1);
  });
});

describe('the host and the focus', () => {
  it('gives the entry its focus once the view is closed, and never while it is open', () => {
    SceneViewHost();
    held.effects.forEach((run) => run());
    expect(held.restored).toBe(0);
    held.effects.length = 0;
    held.open = false;
    SceneViewHost();
    held.effects.forEach((run) => run());
    expect(held.restored).toBe(1);
  });
});

describe('the view code arriving', () => {
  const run = () => {
    SceneViewHost();
    return held.effects.map((e) => e()).filter((c): c is () => void => typeof c === 'function');
  };
  it('is mounted when it arrives while the view is open', async () => {
    const View = () => null;
    run();
    held.loads[0]({ default: View });
    await Promise.resolve();
    await Promise.resolve();
    expect(held.sets).toEqual([{ View }]);
  });
  it('is dropped when it arrives after the view closed again', async () => {
    const cleanups = run();
    cleanups.forEach((c) => c());
    held.loads[0]({ default: () => null });
    await Promise.resolve();
    await Promise.resolve();
    expect(held.sets).toEqual([]);
  });
});

describe('the host', () => {
  it('renders nothing and loads nothing while the view is closed', () => {
    held.open = false;
    expect(SceneViewHost()).toBeNull();
    held.effects.forEach((run) => run());
    expect(held.loads).toHaveLength(0);
    expect(held.closed).toBe(0);
  });

  it('with the scene tier off an open view closes, shows nothing and loads nothing', () => {
    held.offered = false;
    expect(SceneViewHost()).toBeNull();
    held.effects.forEach((run) => run());
    expect(held.closed).toBe(1);
    expect(held.loads).toHaveLength(0);
  });
});
