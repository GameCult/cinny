import type { Scene, SceneOptions } from './Scene';
import { BackgroundSceneConfig, Capabilities, resolveTier } from './tier';

export type { Scene, SceneStats } from './Scene';
export type { SceneTier } from './tier';

export type StartOptions = Omit<SceneOptions, 'tier' | 'patchSource'>;

/**
 * The client's one door to the scene. When the tier resolves to 'off' nothing is imported and no
 * canvas context is requested; otherwise the scene code loads on demand, so it stays out of the
 * main chunk. Null means "keep the CSS ground".
 */
export async function startBackgroundScene(
  config: BackgroundSceneConfig | undefined,
  capabilities: Capabilities,
  options: StartOptions
): Promise<Scene | null> {
  const tier = resolveTier(config, capabilities);
  if (tier === 'off') return null;
  const { createScene } = await import('./Scene');
  return createScene({ ...options, tier });
}
