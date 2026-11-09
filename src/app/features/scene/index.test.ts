import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baked } from '../../../sky/baked';
import type { Scene } from './Scene';
import { startBackgroundScene } from './index';
import { setSkyState } from './skyState';

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
  setSkyState('auto');
  createRidgeScene.mockReset();
  createScene.mockReset();
});
afterEach(() => {
  setSkyState('auto');
  vi.unstubAllGlobals();
});

describe('startBackgroundScene follows the sky state', () => {
  it('hands the ridge scene no sky for auto, as before there was a state', async () => {
    createRidgeScene.mockReturnValue(fakeScene());
    const scene = await startBackgroundScene(config, caps, { canvas });
    expect(createRidgeScene).toHaveBeenCalledOnce();
    expect(createRidgeScene.mock.calls[0][0].sky).toBeUndefined();
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

  it('drops a scene whose rebuild finishes after dispose', async () => {
    const second = fakeScene();
    createRidgeScene.mockReturnValueOnce(fakeScene()).mockReturnValueOnce(second);
    const scene = await startBackgroundScene(config, caps, { canvas });
    setSkyState('day');
    scene?.dispose();
    await flush();
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  it('keeps only the latest of two quick changes', async () => {
    const scenes = [fakeScene(), fakeScene(), fakeScene()];
    scenes.forEach((s) => createRidgeScene.mockReturnValueOnce(s));
    const scene = await startBackgroundScene(config, caps, { canvas });
    setSkyState('day');
    setSkyState('night');
    await flush();
    expect(scenes[1].dispose).toHaveBeenCalledOnce();
    expect(scenes[2].dispose).not.toHaveBeenCalled();
    scene?.dispose();
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
