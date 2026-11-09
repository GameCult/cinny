import type { Scene, SceneOptions } from './Scene';
import { BackgroundSceneConfig, Capabilities, SceneTier, resolveTier } from './tier';
import { getSkyState, subscribe } from './skyState';
import type { SkyState } from './skyState';
import { ridgeSkyFor, terrainSkyFor } from './skyForState';

export type { Scene, SceneStats } from './Scene';
export type { SceneStyle, SceneTier } from './tier';

export type StartOptions = Omit<SceneOptions, 'tier' | 'patchSource' | 'onCompileFail'> & {
  /** A shader failed to compile, or the scene chunk failed to load. The host keeps its ground. */
  onCompileFail?: (e: Error) => void;
  /** A rebuild for a new sky state made no scene: the host puts the CSS ground back (as on a lost context). */
  onInactive?: () => void;
  /** A rebuild made a scene again: the host lets it show. */
  onActive?: () => void;
};

async function create(
  config: BackgroundSceneConfig | undefined,
  options: StartOptions & { tier: SceneTier },
  state: SkyState
): Promise<Scene | null> {
  let createScene: (o: SceneOptions) => Scene | null;
  try {
    if (config?.style === 'raymarch') createScene = (await import('./Scene')).createScene;
    else if (config?.style === 'terrain') {
      const { createTerrainScene } = await import('./terrain/Terrain');
      const sky = terrainSkyFor(state);
      const scene = createTerrainScene({ ...options, ...sky });
      // No WebGL2 (or no usable GL): the terrain's sky alone on the same canvas, not bare ground.
      if (scene) return scene;
      const { createTerrainSkyScene } = await import('./terrain/TerrainSky2D');
      return createTerrainSkyScene({ ...options, ...sky });
    } else {
      const { createRidgeScene } = await import('./ridge/Ridge');
      return createRidgeScene({ ...options, sky: ridgeSkyFor(state) });
    }
  } catch (e) {
    options.onCompileFail?.(e instanceof Error ? e : new Error(String(e)));
    return null;
  }
  return createScene(options);
}

/**
 * The client's one door to the scene. When the tier resolves to 'off' nothing is imported and no
 * canvas context is requested; otherwise the scene code loads on demand, so it stays out of the
 * main chunk. `config.style` picks the scene: the ridges unless it says 'raymarch' or 'terrain' (which falls back to its
 * sky alone, `terrain/TerrainSky2D.ts`, where WebGL2 is missing). Null means
 * "keep the CSS ground", including when that chunk fails to load (offline, stale deploy): the
 * failure goes to onCompileFail and nothing throws.
 *
 * The ridge and terrain scenes bake their sky once, so they follow the sky state (`skyState.ts`) by
 * being rebuilt on the same canvas when it changes: the door subscribes on start and the returned
 * scene's `dispose` unsubscribes. The pull-back restarts from the tree; a later `login()` is
 * replayed on the new scene. The ray-march scene has one fixed dusk and ignores the state.
 */
export async function startBackgroundScene(
  config: BackgroundSceneConfig | undefined,
  capabilities: Capabilities,
  options: StartOptions
): Promise<Scene | null> {
  const tier = resolveTier(config, capabilities);
  if (tier === 'off') return null;
  const build = (state: SkyState) => create(config, { ...options, tier }, state);
  const first = await build(getSkyState());
  if (!first || config?.style === 'raymarch') return first;

  let inner: Scene | null = first;
  let loggedIn = false;
  let disposed = false;
  let generation = 0;
  const off = subscribe(async (state) => {
    generation += 1;
    const mine = generation;
    inner?.dispose();
    inner = null;
    const next = await build(state);
    if (disposed || mine !== generation) {
      next?.dispose();
      return;
    }
    inner = next;
    if (!next) options.onInactive?.();
    else {
      options.onActive?.();
      if (loggedIn) next.login();
    }
  });
  return {
    login() {
      loggedIn = true;
      inner?.login();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      off();
      inner?.dispose();
      inner = null;
    },
  };
}
