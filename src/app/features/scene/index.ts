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
 * main chunk. `config.style` picks the scene: the voxel terrain unless it says 'raymarch'. Null
 * means "keep the CSS ground", including when that chunk fails to load (offline, stale deploy):
 * the failure goes to onCompileFail and nothing throws.
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
    createScene =
      config?.style === 'raymarch'
        ? (await import('./Scene')).createScene
        : (await import('./voxel/Voxel')).createVoxelScene;
  } catch (e) {
    options.onCompileFail?.(e instanceof Error ? e : new Error(String(e)));
    return null;
  }
  return createScene({ ...options, tier });
}
