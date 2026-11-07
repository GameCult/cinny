import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Scene } from './index';
import { mountBackgroundScene } from './host';

const { startBackgroundScene } = vi.hoisted(() => ({ startBackgroundScene: vi.fn() }));
vi.mock('./index', () => ({ startBackgroundScene }));

const canvas = {} as HTMLCanvasElement;
const config = { tier: 'low' as const };
const caps = { hardwareConcurrency: 8 };

function fakeScene(): Scene & {
  login: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  return { login: vi.fn(), dispose: vi.fn() };
}
const flush = () =>
  new Promise<void>((r) => {
    setTimeout(r, 0);
  });

afterEach(() => {
  startBackgroundScene.mockReset();
});

describe('mountBackgroundScene', () => {
  it('starts the scene on the canvas with the config and capabilities', async () => {
    const scene = fakeScene();
    startBackgroundScene.mockResolvedValue(scene);
    const onActive = vi.fn();
    mountBackgroundScene(config, caps, canvas, { loggedIn: false, onActive });
    await flush();
    expect(startBackgroundScene).toHaveBeenCalledWith(
      config,
      caps,
      expect.objectContaining({ canvas })
    );
    expect(onActive).toHaveBeenCalledOnce();
    expect(scene.login).not.toHaveBeenCalled();
  });

  it('disposes the scene on unmount, once', async () => {
    const scene = fakeScene();
    startBackgroundScene.mockResolvedValue(scene);
    const dispose = mountBackgroundScene(config, caps, canvas, { loggedIn: false });
    await flush();
    dispose();
    dispose();
    expect(scene.dispose).toHaveBeenCalledOnce();
  });

  it('disposes a scene that resolves after unmount, without activating or logging in', async () => {
    const scene = fakeScene();
    let resolve!: (s: Scene) => void;
    startBackgroundScene.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    const onActive = vi.fn();
    const dispose = mountBackgroundScene(config, caps, canvas, { loggedIn: true, onActive });
    dispose();
    resolve(scene);
    await flush();
    expect(scene.dispose).toHaveBeenCalledOnce();
    expect(scene.login).not.toHaveBeenCalled();
    expect(onActive).not.toHaveBeenCalled();
  });

  it('leaves the ground alone when there is no scene', async () => {
    startBackgroundScene.mockResolvedValue(null);
    const onActive = vi.fn();
    const dispose = mountBackgroundScene(config, caps, canvas, { loggedIn: true, onActive });
    await flush();
    expect(onActive).not.toHaveBeenCalled();
    expect(dispose).not.toThrow();
  });

  it('reports a failed start instead of throwing', async () => {
    startBackgroundScene.mockRejectedValue(new Error('boom'));
    const onFail = vi.fn();
    mountBackgroundScene(config, caps, canvas, { loggedIn: false, onFail });
    await flush();
    expect(onFail).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
  });

  it('forwards the scene own compile failure to onFail', async () => {
    startBackgroundScene.mockImplementation(async (_c, _k, o) => {
      o.onCompileFail(new Error('shader'));
      return null;
    });
    const onFail = vi.fn();
    mountBackgroundScene(config, caps, canvas, { loggedIn: false, onFail });
    await flush();
    expect(onFail).toHaveBeenCalledWith(expect.objectContaining({ message: 'shader' }));
  });

  it('calls login() once the scene starts when a session already exists', async () => {
    const scene = fakeScene();
    startBackgroundScene.mockResolvedValue(scene);
    mountBackgroundScene(config, caps, canvas, { loggedIn: true });
    await flush();
    expect(scene.login).toHaveBeenCalledOnce();
  });
});
