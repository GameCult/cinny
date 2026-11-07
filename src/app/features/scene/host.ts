import { startBackgroundScene } from './index';
import type { Scene } from './index';
import type { BackgroundSceneConfig, Capabilities } from './tier';

export type HostOptions = {
  /** A Matrix session already exists, so the scene starts past its login moment. */
  loggedIn: boolean;
  /** The scene is running: the host may now let it show through. Not called when there is none. */
  onActive?: () => void;
  /** A shader failed to compile, the chunk failed to load, or starting threw. The CSS ground stays. */
  onFail?: (e: Error) => void;
};

/**
 * Start the background scene on `canvas` and return the function that ends it. The start is async,
 * so a dispose that arrives first wins: the scene is disposed the moment it resolves. A null scene
 * (tier off, no 2D context, load failure) leaves the canvas untouched and the ground showing.
 */
export function mountBackgroundScene(
  config: BackgroundSceneConfig | undefined,
  capabilities: Capabilities,
  canvas: HTMLCanvasElement,
  { loggedIn, onActive, onFail }: HostOptions
): () => void {
  let cancelled = false;
  let scene: Scene | null = null;

  startBackgroundScene(config, capabilities, { canvas, onCompileFail: onFail }).then(
    (started) => {
      if (cancelled) {
        started?.dispose();
        return;
      }
      scene = started;
      if (!scene) return;
      onActive?.();
      if (loggedIn) scene.login();
    },
    (e) => {
      if (!cancelled) onFail?.(e instanceof Error ? e : new Error(String(e)));
    }
  );

  return () => {
    cancelled = true;
    scene?.dispose();
    scene = null;
  };
}
