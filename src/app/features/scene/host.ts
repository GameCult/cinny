import { startBackgroundScene } from './index';
import type { Scene } from './index';
import type { BackgroundSceneConfig, Capabilities } from './tier';

export type HostOptions = {
  /** A Matrix session already exists, so the scene starts past its login moment. */
  loggedIn: boolean;
  /** The scene is running: the host may now let it show through. Not called when there is none. */
  onActive?: () => void;
  /** The scene stopped because its GL context was lost: put the CSS ground back until it restores. */
  onInactive?: () => void;
  /** A shader failed to compile, the chunk failed to load, or starting threw. The CSS ground stays. */
  onFail?: (e: Error) => void;
};

/**
 * Start the background scene on `canvas` and return the function that ends it. The start is async,
 * so a dispose that arrives first wins: the scene is disposed the moment it resolves. A null scene
 * (tier off, no 2D context, load failure) leaves the canvas untouched and the ground showing.
 *
 * A lost WebGL context ends the scene it killed: the host disposes it, calls `onInactive` so the
 * CSS ground shows, and starts a fresh scene when the canvas's context is restored. The 2D sky
 * cannot take over on this canvas (a canvas that has held a WebGL context gives no 2D one), so the
 * ground is the fallback while the context is gone; a restore that cannot rebuild leaves it there.
 */
export function mountBackgroundScene(
  config: BackgroundSceneConfig | undefined,
  capabilities: Capabilities,
  canvas: HTMLCanvasElement,
  { loggedIn, onActive, onInactive, onFail }: HostOptions
): () => void {
  let cancelled = false;
  let scene: Scene | null = null;
  let generation = 0;

  const start = () => {
    generation += 1;
    const mine = generation;
    const stale = () => cancelled || mine !== generation;
    startBackgroundScene(config, capabilities, {
      canvas,
      onCompileFail: onFail,
      onContextLost: () => {
        if (stale()) return;
        generation += 1;
        scene?.dispose();
        scene = null;
        onInactive?.();
      },
    }).then(
      (started) => {
        if (stale()) {
          started?.dispose();
          return;
        }
        scene = started;
        if (!scene) return;
        onActive?.();
        if (loggedIn) scene.login();
      },
      (e) => {
        if (!stale()) onFail?.(e instanceof Error ? e : new Error(String(e)));
      }
    );
  };

  const onRestored = () => {
    if (!cancelled && !scene) start();
  };
  canvas.addEventListener('webglcontextrestored', onRestored);
  start();

  return () => {
    cancelled = true;
    canvas.removeEventListener('webglcontextrestored', onRestored);
    scene?.dispose();
    scene = null;
  };
}
