import type { Scene, SceneOptions } from './Scene';
import { BackgroundSceneConfig, Capabilities, resolveTier } from './tier';

export type { Scene, SceneStats } from './Scene';
export type { SceneStyle, SceneTier } from './tier';

export type StartOptions = Omit<SceneOptions, 'tier' | 'patchSource' | 'onCompileFail'> & {
  /** A shader failed to compile, or the scene chunk failed to load. The host keeps its ground. */
  onCompileFail?: (e: Error) => void;
};

/**
 * The client's one door to the scene. When the tier resolves to 'off' nothing is imported and no
 * canvas context is requested; otherwise the scene code loads on demand, so it stays out of the
 * main chunk. `config.style` picks the scene: the ridges unless it says 'raymarch' or 'terrain' (which falls back to its
 * sky alone, `terrain/TerrainSky2D.ts`, where WebGL2 is missing). Null means
 * "keep the CSS ground", including when that chunk fails to load (offline, stale deploy): the
 * failure goes to onCompileFail and nothing throws.
 */
export async function startBackgroundScene(
  config: BackgroundSceneConfig | undefined,
  capabilities: Capabilities,
  options: StartOptions
): Promise<Scene | null> {
  const tier = resolveTier(config, capabilities);
  if (tier === 'off') return null;
  let createScene: (o: SceneOptions) => Scene | null;
  try {
    if (config?.style === 'raymarch') createScene = (await import('./Scene')).createScene;
    else if (config?.style === 'terrain') {
      const { createTerrainScene } = await import('./terrain/Terrain');
      const scene = createTerrainScene({ ...options, tier });
      // No WebGL2 (or no usable GL): the terrain's sky alone on the same canvas, not bare ground.
      if (scene) return scene;
      const { createTerrainSkyScene } = await import('./terrain/TerrainSky2D');
      return createTerrainSkyScene({ ...options, tier });
    } else createScene = (await import('./ridge/Ridge')).createRidgeScene;
  } catch (e) {
    options.onCompileFail?.(e instanceof Error ? e : new Error(String(e)));
    return null;
  }
  return createScene({ ...options, tier });
}
