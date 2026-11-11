import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atStandardTime } from './standardTime.testkit';
import { baked } from '../../../sky/baked';
import type { Scene } from './Scene';
import { startBackgroundScene } from './index';
import { setSkyClock, setSkyState } from './skyState';
import { ridgeSkyFor } from './skyForState';

const { createRidgeScene, createScene } = vi.hoisted(() => ({
  createRidgeScene: vi.fn(),
  createScene: vi.fn(),
}));
vi.mock('./ridge/Ridge', () => ({ createRidgeScene }));
vi.mock('./Scene', () => ({ createScene }));

const canvas = {} as HTMLCanvasElement;
const config = { tier: 'low' as const };
const caps = { hardwareConcurrency: 8 };
const flush = () =>
  new Promise<void>((r) => {
    setTimeout(r, 0);
  });
// Resolves after `n` further turns of the microtask queue.
const microtasks = (n: number) =>
  Array.from({ length: n }).reduce<Promise<void>>(
    (p) => p.then(() => undefined),
    Promise.resolve()
  );
const fakeScene = () => ({ login: vi.fn(), dispose: vi.fn() });
const hex = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  // Local midnight: 'auto' resolves to night.
  setSkyClock(() => atStandardTime(0, 0));
  setSkyState('auto');
  createRidgeScene.mockReset();
  createScene.mockReset();
});
afterEach(() => {
  setSkyClock();
  setSkyState('auto');
  vi.unstubAllGlobals();
});

describe('startBackgroundScene follows the sky state', () => {
  it('hands the ridge scene the sky auto resolves to (night at midnight)', async () => {
    createRidgeScene.mockReturnValue(fakeScene());
    const scene = await startBackgroundScene(config, caps, { canvas });
    expect(createRidgeScene).toHaveBeenCalledOnce();
    expect(hex(createRidgeScene.mock.calls[0][0].sky.top)).toBe(hex(ridgeSkyFor('night').top));
    scene?.dispose();
  });

  it('does not rebuild when auto is replaced by the explicit state it already resolves to', async () => {
    const a = fakeScene();
    createRidgeScene.mockReturnValueOnce(a);
    const scene = await startBackgroundScene(config, caps, { canvas });
    setSkyState('night');
    await flush();
    expect(a.dispose).not.toHaveBeenCalled();
    expect(createRidgeScene).toHaveBeenCalledOnce();
    scene?.dispose();
  });

  it('starts on the stored state', async () => {
    setSkyState('night');
    createRidgeScene.mockReturnValue(fakeScene());
    const scene = await startBackgroundScene(config, caps, { canvas });
    expect(hex(createRidgeScene.mock.calls[0][0].sky.top)).toBe(hex(ridgeSkyFor('night').top));
    scene?.dispose();
  });

  it('rebuilds on a change: the old scene is disposed, the new one draws the new sky', async () => {
    const first = fakeScene();
    const second = fakeScene();
    createRidgeScene.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const scene = await startBackgroundScene(config, caps, { canvas });
    setSkyState('day');
    await flush();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(hex(createRidgeScene.mock.calls[1][0].sky.top)).toBe(baked.noonday.gradient[0]);
    scene?.dispose();
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  it('rebuilds for a change that landed while the first build was awaited', async () => {
    const [a, b] = [fakeScene(), fakeScene()];
    createRidgeScene.mockReturnValueOnce(a).mockReturnValueOnce(b);
    const started = startBackgroundScene(config, caps, { canvas });
    setSkyState('day');
    const scene = await started;
    await flush();
    expect(createRidgeScene).toHaveBeenCalledTimes(2);
    expect(hex(createRidgeScene.mock.calls[1][0].sky.top)).toBe(baked.noonday.gradient[0]);
    expect(a.dispose).toHaveBeenCalledOnce();
    scene?.dispose();
    expect(b.dispose).toHaveBeenCalledOnce();
  });

  it('replays a login onto the rebuilt scene, but only if one happened', async () => {
    const [a, b, c] = [fakeScene(), fakeScene(), fakeScene()];
    createRidgeScene.mockReturnValueOnce(a).mockReturnValueOnce(b).mockReturnValueOnce(c);
    const scene = await startBackgroundScene(config, caps, { canvas });
    setSkyState('day');
    await flush();
    expect(b.login).not.toHaveBeenCalled();
    scene?.login();
    expect(b.login).toHaveBeenCalledOnce();
    setSkyState('dusk');
    await flush();
    expect(c.login).toHaveBeenCalledOnce();
    scene?.dispose();
  });

  it('puts the ground back when a rebuild makes no scene, and lets it show when one returns', async () => {
    const [a, c] = [fakeScene(), fakeScene()];
    createRidgeScene.mockReturnValueOnce(a).mockReturnValueOnce(null).mockReturnValueOnce(c);
    const onInactive = vi.fn();
    const onActive = vi.fn();
    const scene = await startBackgroundScene(config, caps, { canvas, onInactive, onActive });
    expect(onInactive).not.toHaveBeenCalled();
    setSkyState('day');
    await flush();
    expect(onInactive).toHaveBeenCalledOnce();
    expect(onActive).not.toHaveBeenCalled();
    setSkyState('dusk');
    await flush();
    expect(onActive).toHaveBeenCalledOnce();
    expect(onInactive).toHaveBeenCalledOnce();
    scene?.dispose();
  });

  it('does not report a dropped rebuild as inactive', async () => {
    createRidgeScene.mockReturnValueOnce(fakeScene()).mockReturnValueOnce(null);
    const onInactive = vi.fn();
    const scene = await startBackgroundScene(config, caps, { canvas, onInactive });
    setSkyState('day');
    scene?.dispose();
    await flush();
    expect(onInactive).not.toHaveBeenCalled();
  });

  it('removes the subscription on dispose', async () => {
    const first = fakeScene();
    createRidgeScene.mockReturnValue(first);
    const scene = await startBackgroundScene(config, caps, { canvas });
    scene?.dispose();
    scene?.dispose();
    setSkyState('day');
    await flush();
    expect(createRidgeScene).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
  });

  it('builds nothing for a rebuild that is disposed before it starts', async () => {
    createRidgeScene.mockReturnValueOnce(fakeScene()).mockReturnValueOnce(fakeScene());
    const scene = await startBackgroundScene(config, caps, { canvas });
    setSkyState('day');
    scene?.dispose();
    await flush();
    expect(createRidgeScene).toHaveBeenCalledOnce();
  });

  it('keeps only the latest of two quick changes: the last sky is built, the others are not left running', async () => {
    const scenes = [fakeScene(), fakeScene(), fakeScene()];
    scenes.forEach((s) => createRidgeScene.mockReturnValueOnce(s));
    const scene = await startBackgroundScene(config, caps, { canvas });
    setSkyState('day');
    setSkyState('dusk');
    await flush();
    // The sky last built is dusk's, and it is the live scene: a login reaches it and nothing else.
    const built = createRidgeScene.mock.calls.length;
    expect(hex(createRidgeScene.mock.calls[built - 1][0].sky.top)).toBe(
      hex(ridgeSkyFor('dusk').top)
    );
    const live = scenes[built - 1];
    scene?.login();
    expect(live.login).toHaveBeenCalledOnce();
    scenes.filter((s) => s !== live).forEach((s) => expect(s.login).not.toHaveBeenCalled());
    // Every scene but the live one was disposed, the live one not yet.
    scenes.slice(0, built).forEach((s) => {
      expect(s.dispose).toHaveBeenCalledTimes(s === live ? 0 : 1);
    });
    scene?.dispose();
    expect(live.dispose).toHaveBeenCalledOnce();
  });

  // A second sky change `ticks` microtasks after the first. True when it landed mid-build: the build for the first
  // change finished, was found stale and dropped (never shown), and only the newest sky was announced.
  const changeAfter = async (ticks: number) => {
    createRidgeScene.mockReset();
    setSkyState('auto');
    const [a, b, c] = [fakeScene(), fakeScene(), fakeScene()];
    createRidgeScene.mockReturnValueOnce(a).mockReturnValueOnce(b).mockReturnValueOnce(c);
    const onActive = vi.fn();
    const scene = await startBackgroundScene(config, caps, { canvas, onActive });
    setSkyState('day');
    await microtasks(ticks);
    setSkyState('dusk');
    await flush();
    const at = `at ${ticks} microtasks`;
    const built = createRidgeScene.mock.calls.length;
    expect(hex(createRidgeScene.mock.calls[built - 1][0].sky.top), at).toBe(
      hex(ridgeSkyFor('dusk').top)
    );
    // The newest build is live, every earlier one disposed exactly once, and only the live one is shown.
    const live = [a, b, c][built - 1];
    scene?.login();
    expect(live.login, at).toHaveBeenCalledOnce();
    [a, b, c].slice(0, built).forEach((x) => {
      expect(x.dispose, at).toHaveBeenCalledTimes(x === live ? 0 : 1);
      if (x !== live) expect(x.login, at).not.toHaveBeenCalled();
    });
    scene?.dispose();
    expect(live.dispose, at).toHaveBeenCalledOnce();
    return built === 3 && onActive.mock.calls.length === 1;
  };

  it('a sky change at any point of a build leaves only the newer build live; the stale one is disposed', async () => {
    // The offsets are swept, not pinned, so a shift in the awaits inside the build cannot move the change off the
    // build: at least one offset must land mid-build, or the sweep proves nothing.
    const offsets = Array.from({ length: 21 }, (_, i) => i);
    const landed = await offsets.reduce<Promise<number[]>>(
      (p, k) => p.then(async (acc) => ((await changeAfter(k)) ? [...acc, k] : acc)),
      Promise.resolve([])
    );
    // This can fail after a correct refactor that changes the await count in create/skyKey and moves every offset
    // off the build. Then widen the range of offsets until some land again; do not weaken the assertion.
    expect(landed.length, 'at least one offset must land mid-build').toBeGreaterThan(0);
  });

  it('leaves the ray-march scene alone: it has one fixed dusk', async () => {
    const inner = fakeScene() as unknown as Scene;
    createScene.mockReturnValue(inner);
    const scene = await startBackgroundScene({ ...config, style: 'raymarch' }, caps, { canvas });
    expect(scene).toBe(inner);
    setSkyState('day');
    await flush();
    expect(createScene).toHaveBeenCalledOnce();
  });

  it('keeps the ground and reports a ray-march scene that throws while being created', async () => {
    const boom = new Error('shader link failed');
    createScene.mockImplementation(() => {
      throw boom;
    });
    const onCompileFail = vi.fn();
    const scene = await startBackgroundScene({ ...config, style: 'raymarch' }, caps, {
      canvas,
      onCompileFail,
    });
    expect(scene).toBeNull();
    expect(onCompileFail).toHaveBeenCalledOnce();
    expect(onCompileFail).toHaveBeenCalledWith(boom);
  });
});
