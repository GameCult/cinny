// The place the sky is over, and the one decision of which place is drawn: the viewer's choice (placeState.ts) if the index lists it, else the config's place if
// listed, else the index's default. The store (skyState.ts) holds the place; this file is the only writer
// of it: the baked place's manifest, loaded once and shared, when the ridge planes are drawn, and the fallback view (view.ts FALLBACK_VIEW) when
// they are not (the manifest or its cards did not load), because the scene is then the sky alone over that view. So the sky, the weather, the
// rebuild key, the ink and the Auto timer all read the place the scene draws. Main-chunk safe: no sky, no ridge code, only the manifest parser,
// the fallback view and the store.
import type { BackgroundSceneConfig } from './tier';
import { loadIndex, loadManifest } from './ridge/manifest';
import type { RidgeIndex, RidgeManifest } from './ridge/manifest';
import { getPlaceChoice } from './placeState';
import { FALLBACK_VIEW } from './ridge/view';
import type { View } from './ridge/view';
import { setSkyPlace } from './skyState';

// Set when a build drew the sky alone, so a rebuild key made before the next build is for the view that is drawn.
let skyOnly = false;

/** The id of the place to draw: the viewer's choice if the index lists it, else the config's if listed, else the index's default. An id the index does not list decides nothing. */
export const resolvePlaceId = (
  index: Pick<RidgeIndex, 'default' | 'places'>,
  configPlace: string | undefined,
  choice: string | undefined = getPlaceChoice()
): string =>
  [choice, configPlace].find(
    (id): id is string => id !== undefined && Object.prototype.hasOwnProperty.call(index.places, id)
  ) ?? index.default;

/** The manifest of the place to draw (`resolvePlaceId`); memoised, rejects on any failure. */
export async function loadPlaceManifest(
  config: Pick<BackgroundSceneConfig, 'place'> | undefined
): Promise<RidgeManifest> {
  const base = import.meta.env.BASE_URL;
  return loadManifest(base, resolvePlaceId(await loadIndex(base), config?.place));
}

/** A scene start is a fresh attempt at the planes. */
export function resetSkyPlanes(): void {
  skyOnly = false;
}

/**
 * Load the manifest of the place to draw (`resolvePlaceId`) and make the view being
 * drawn the sky's place. Safe to call whenever a reader wants the view: the load is memoised and setting the same place is not a change. A
 * failed load is the fallback view, returned with its error so the scene can be the sky alone.
 */
export async function ensureSkyPlace(
  config: Pick<BackgroundSceneConfig, 'place'> | undefined
): Promise<{ manifest: RidgeManifest | null; view: View; fail: Error | null }> {
  let manifest: RidgeManifest | null = null;
  let fail: Error | null = null;
  try {
    manifest = await loadPlaceManifest(config);
  } catch (e) {
    fail = e instanceof Error ? e : new Error(String(e));
  }
  const view = manifest && !skyOnly ? manifest.view : FALLBACK_VIEW;
  setSkyPlace(view.place);
  return { manifest, view, fail };
}

/** A build has settled what it draws: the manifest's planes (the manifest), or the sky alone (null). Makes that view's place the sky's and returns the view. */
export function drawnView(manifest: RidgeManifest | null): View {
  skyOnly = manifest === null;
  const view = manifest?.view ?? FALLBACK_VIEW;
  setSkyPlace(view.place);
  return view;
}
