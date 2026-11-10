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
    expect(hex(createRidgeScene.mock.calls[0][0].sky.top)).toBe(baked.midnight.gradient[0]);
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
    expect(hex(createRidgeScene.mock.calls[0][0].sky.top)).toBe(baked.midnight.gradient[0]);
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

  it('leaves the ray-march scene alone: it has one fixed dusk', async () => {
    const inner = fakeScene() as unknown as Scene;
    createScene.mockReturnValue(inner);
    const scene = await startBackgroundScene({ ...config, style: 'raymarch' }, caps, { canvas });
    expect(scene).toBe(inner);
    setSkyState('day');
    await flush();
    expect(createScene).toHaveBeenCalledOnce();
  });
});
