import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scene } from './index';
import { mountBackgroundScene } from './host';

const { startBackgroundScene } = vi.hoisted(() => ({ startBackgroundScene: vi.fn() }));
vi.mock('./index', () => ({ startBackgroundScene }));

let canvas: HTMLCanvasElement;
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

beforeEach(() => {
  canvas = new EventTarget() as HTMLCanvasElement;
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

  describe('a lost WebGL context', () => {
    const lose = () =>
      startBackgroundScene.mock.calls[
        startBackgroundScene.mock.calls.length - 1
      ][2].onContextLost();
    const restore = () => canvas.dispatchEvent(new Event('webglcontextrestored'));

    it('disposes the dead scene and puts the ground back, without rebuilding yet', async () => {
      const scene = fakeScene();
      startBackgroundScene.mockResolvedValue(scene);
      const onInactive = vi.fn();
      mountBackgroundScene(config, caps, canvas, { loggedIn: false, onInactive });
      await flush();
      lose();
      expect(scene.dispose).toHaveBeenCalledOnce();
      expect(onInactive).toHaveBeenCalledOnce();
      expect(startBackgroundScene).toHaveBeenCalledOnce();
    });

    it('starts a fresh scene on restore, activates it and logs in when a session exists', async () => {
      const first = fakeScene();
      const second = fakeScene();
      startBackgroundScene.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
      const onActive = vi.fn();
      mountBackgroundScene(config, caps, canvas, { loggedIn: true, onActive });
      await flush();
      lose();
      restore();
      await flush();
      expect(startBackgroundScene).toHaveBeenCalledTimes(2);
      expect(onActive).toHaveBeenCalledTimes(2);
      expect(second.login).toHaveBeenCalledOnce();
      expect(first.dispose).toHaveBeenCalledOnce();
    });

    it('rebuilds on every loss and restore, disposing each dead scene once', async () => {
      const scenes = [fakeScene(), fakeScene(), fakeScene()];
      scenes.forEach((s) => startBackgroundScene.mockResolvedValueOnce(s));
      mountBackgroundScene(config, caps, canvas, { loggedIn: false });
      await flush();
      lose();
      restore();
      await flush();
      lose();
      restore();
      await flush();
      expect(scenes.map((s) => s.dispose.mock.calls.length)).toEqual([1, 1, 0]);
    });

    it('ignores a restore while a scene is running', async () => {
      startBackgroundScene.mockResolvedValue(fakeScene());
      mountBackgroundScene(config, caps, canvas, { loggedIn: false });
      await flush();
      restore();
      await flush();
      expect(startBackgroundScene).toHaveBeenCalledOnce();
    });

    it('leaves the ground when the rebuild yields no scene', async () => {
      startBackgroundScene.mockResolvedValueOnce(fakeScene()).mockResolvedValueOnce(null);
      const onActive = vi.fn();
      mountBackgroundScene(config, caps, canvas, { loggedIn: false, onActive });
      await flush();
      lose();
      restore();
      await flush();
      expect(onActive).toHaveBeenCalledOnce();
    });

    it('does not rebuild after dispose, and removes its restore listener', async () => {
      startBackgroundScene.mockResolvedValue(fakeScene());
      const dispose = mountBackgroundScene(config, caps, canvas, { loggedIn: false });
      await flush();
      lose();
      dispose();
      restore();
      await flush();
      expect(startBackgroundScene).toHaveBeenCalledOnce();
    });

    it('drops a scene that resolves after a loss that arrived while it started', async () => {
      const late = fakeScene();
      let resolve!: (s: Scene) => void;
      startBackgroundScene.mockReturnValueOnce(
        new Promise((r) => {
          resolve = r;
        })
      );
      const onActive = vi.fn();
      mountBackgroundScene(config, caps, canvas, { loggedIn: false, onActive });
      lose();
      resolve(late);
      await flush();
      expect(late.dispose).toHaveBeenCalledOnce();
      expect(onActive).not.toHaveBeenCalled();
    });
  });
});
