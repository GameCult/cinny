// The place the sky is over: the baked place's manifest, loaded once and shared. Its View is the one owner of the sun's place and the camera
// for the weather, the sky, the rebuild key and the planes; its Place is what the sky store (skyState.ts) resolves the drawn sky for, so the
// ink and the scene read one place. Main-chunk safe: no sky, no ridge code, only the manifest parser and the store.
import type { BackgroundSceneConfig } from './tier';
import { loadManifest } from './ridge/manifest';
import type { RidgeManifest } from './ridge/manifest';
import { setSkyPlace } from './skyState';

/**
 * Load the manifest of the place `config` names (unknown or absent: the index's default, as `loadManifest` decides) and make its place the
 * sky's. Safe to call whenever a reader wants the manifest: the load is memoised and setting the same place is not a change. A failed load
 * leaves the place as it was (none, at first: no sky is drawn for ink) and is returned, so the scene can be the sky alone.
 */
export async function ensureSkyPlace(
  config: Pick<BackgroundSceneConfig, 'place'> | undefined
): Promise<{ manifest: RidgeManifest | null; fail: Error | null }> {
  try {
    const manifest = await loadManifest(import.meta.env.BASE_URL, config?.place);
    setSkyPlace(manifest.view.place);
    return { manifest, fail: null };
  } catch (e) {
    return { manifest: null, fail: e instanceof Error ? e : new Error(String(e)) };
  }
}
