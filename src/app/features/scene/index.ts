import type { Scene, SceneOptions } from './Scene';
import { BackgroundSceneConfig, Capabilities, SceneTier, resolveTier } from './tier';
import { debugOverlaysAllowed } from './debugOverlays';
import { getSkyState, subscribe } from './skyState';
import type { SkyState } from './skyState';
import type { SkyColours } from './ridge/skyColour';
import type { Backdrop } from './ridge/Backdrop';
import { loadManifest } from './ridge/manifest';
import type { RidgeManifest } from './ridge/manifest';
import { FALLBACK_VIEW } from './ridge/view';
import { frameChoice } from './ridge/frameChoice';

export type { Scene, SceneStats } from './Scene';
export type { SceneStyle, SceneTier } from './tier';

export type StartOptions = Omit<SceneOptions, 'tier' | 'patchSource' | 'onCompileFail'> & {
  /** A shader failed to compile, or the scene chunk failed to load. The host keeps its ground. */
  onCompileFail?: (e: Error) => void;
  /** A rebuild for a new sky state made no scene: the host puts the CSS ground back (as on a lost context). */
  onInactive?: () => void;
  /** A rebuild made a scene again: the host lets it show. */
  onActive?: () => void;
  /** The live scene is the sky alone because the baked ridge planes did not load (no manifest, a missing image). The host may fill the ground. Told when the live scene changes to that state, never for a build that did not win. */
  onPlanesFail?: (e: Error) => void;
  /** The live scene has its planes after `onPlanesFail` said it had none: the host lets go of the ground it filled. */
  onPlanesOk?: () => void;
};

/** The observation file the ridge sky reads: the page's own, beside config.json. The browser calls no weather service. */
const weatherUrl = (): string => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/weather.json`;

/**
 * The baked place's manifest, or why there is none. Its View is the one owner of the sun's place and the camera for the weather, the sky,
 * the rebuild key and the planes; a scene with no manifest has FALLBACK_VIEW.
 */
async function manifestOf(
  config: BackgroundSceneConfig | undefined
): Promise<{ manifest: RidgeManifest | null; fail: Error | null }> {
  try {
    return { manifest: await loadManifest(import.meta.env.BASE_URL, config?.place), fail: null };
  } catch (e) {
    return { manifest: null, fail: e instanceof Error ? e : new Error(String(e)) };
  }
}

/** A scene made ready: every await is done, so `make` is synchronous and a rebuild can keep the old scene until the instant it swaps. */
interface Prepared {
  make: () => Scene | null;
  /** Why this scene is the sky alone, when the baked planes did not load; null when it has planes or none are asked for. */
  planesFail: Error | null;
}

async function prepare(
  config: BackgroundSceneConfig | undefined,
  options: StartOptions & { tier: SceneTier; debug?: boolean },
  state: SkyState
): Promise<Prepared> {
  // Whatever throws in making the scene is a compile failure, as whatever throws in loading it.
  const guarded = (make: () => Scene | null): Prepared => ({
    planesFail: null,
    make: () => {
      try {
        return make();
      } catch (e) {
        options.onCompileFail?.(e instanceof Error ? e : new Error(String(e)));
        return null;
      }
    },
  });
  try {
    // Loaded here, with the scenes, so the main chunk does not carry the terrain sky or the baked tables.
    const { loadWeather, ridgeSkyFor, terrainSkyFor } = await import('./skyForState');
    if (config?.style === 'raymarch') {
      const { createScene } = await import('./Scene');
      return guarded(() => createScene(options));
    }
    if (config?.style === 'terrain') {
      const { createTerrainScene } = await import('./terrain/Terrain');
      const { createTerrainSkyScene } = await import('./terrain/TerrainSky2D');
      const sky = terrainSkyFor(state);
      // No WebGL2 (or no usable GL): the terrain's sky alone on the same canvas, not bare ground.
      return guarded(
        () =>
          createTerrainScene({ ...options, ...sky }) ??
          createTerrainSkyScene({ ...options, ...sky })
      );
    }
    const { createRidgeScene } = await import('./ridge/Ridge');
    const { manifest, fail } = await manifestOf(config);
    await loadWeather(weatherUrl(), (manifest?.view ?? FALLBACK_VIEW).place);
    // The planes load with the scene chunk and the weather: createRidgeScene stays synchronous. Any failure is the sky alone.
    let backdrop: Backdrop | null = null;
    let sky: SkyColours | undefined;
    let planesFail: Error | null = fail;
    if (manifest) {
      try {
        const manifestSky = ridgeSkyFor(state, manifest.view);
        sky = manifestSky;
        const choice = frameChoice(
          manifest.frames,
          (manifestSky.physical as NonNullable<typeof manifestSky.physical>).sun
        );
        const { loadBackdrop } = await import('./ridge/Backdrop');
        backdrop = await loadBackdrop(manifest, choice);
        if (!backdrop) throw new Error('ridge planes did not load');
      } catch (e) {
        backdrop = null;
        sky = undefined;
        planesFail = e instanceof Error ? e : new Error(String(e));
      }
    }
    const made = guarded(() =>
      createRidgeScene({
        ...options,
        sky: sky ?? ridgeSkyFor(state, FALLBACK_VIEW),
        backdrop: backdrop ?? undefined,
      })
    );
    return { ...made, planesFail };
  } catch (e) {
    options.onCompileFail?.(e instanceof Error ? e : new Error(String(e)));
    return { make: () => null, planesFail: null };
  }
}

/**
 * What a rebuild is for: the sky options the scene would be built from. A change of choice that draws the same sky
 * (Day picked while the clock says day, 'auto' to the fixed state it resolves to) is not a rebuild; the page URL steers
 * only 'auto' (`terrainSkyFor`), so there the two differ and the key says so.
 */
async function skyKey(
  config: BackgroundSceneConfig | undefined,
  state: SkyState
): Promise<string | null> {
  try {
    const { loadWeather, ridgeSkyKey, terrainSkyFor } = await import('./skyForState');
    if (config?.style === 'terrain') return JSON.stringify(terrainSkyFor(state));
    const view = (await manifestOf(config)).manifest?.view ?? FALLBACK_VIEW;
    await loadWeather(weatherUrl(), view.place);
    return ridgeSkyKey(state, view);
  } catch {
    // The chunk failed to load: no key, so every change rebuilds (and `create` reports the failure).
    return null;
  }
}

/**
 * The client's one door to the scene. When the tier resolves to 'off' nothing is imported and no
 * canvas context is requested; otherwise the scene code loads on demand, so it stays out of the
 * main chunk. `config.style` picks the scene: the ridges unless it says 'raymarch' or 'terrain' (which falls back to its
 * sky alone, `terrain/TerrainSky2D.ts`, where WebGL2 is missing). Null means
 * "keep the CSS ground", including when that chunk fails to load (offline, stale deploy): the
 * failure goes to onCompileFail and nothing throws.
 *
 * The ridge and terrain scenes bake their sky once, so they follow the sky (`skyState.ts`: the choice, resolved, so 'auto' follows the clock) by
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
  const debug = debugOverlaysAllowed(config);
  // What the host was last told of the planes: only the live scene speaks, and only when its state changes.
  let planesFailed = false;
  const announce = (planesFail: Error | null) => {
    if (planesFail && !planesFailed) options.onPlanesFail?.(planesFail);
    if (!planesFail && planesFailed) options.onPlanesOk?.();
    planesFailed = planesFail !== null;
  };
  const prepared = (state: SkyState) => prepare(config, { ...options, tier, debug }, state);
  const state = getSkyState();
  const key0 = config?.style === 'raymarch' ? null : await skyKey(config, state);
  const firstReady = await prepared(state);
  const first = firstReady.make();
  if (!first || config?.style === 'raymarch') return first;
  announce(firstReady.planesFail);

  let inner: Scene | null = first;
  let built = key0;
  let loggedIn = false;
  let disposed = false;
  let generation = 0;
  // A rebuild is for a different sky ('auto' crossing a boundary, a new choice), not for a repeat of the one drawn.
  const rebuild = async () => {
    // The choice can move while the key is awaited; that change has its own rebuild, so this one stands down.
    const next = getSkyState();
    const key = await skyKey(config, next);
    if (getSkyState() !== next) return;
    if ((key !== null && key === built) || disposed) return;
    generation += 1;
    const mine = generation;
    built = key;
    // The old scene stays up while the next one loads; a build that is stale or after dispose is never made, so it never speaks.
    const ready = await prepared(next);
    if (disposed || mine !== generation) return;
    inner?.dispose();
    inner = null;
    const scene = ready.make();
    inner = scene;
    if (scene) announce(ready.planesFail);
    if (!scene) options.onInactive?.();
    else {
      options.onActive?.();
      if (loggedIn) scene.login();
    }
  };
  const off = subscribe(rebuild);
  // A change that landed while the first build was awaited was missed by the subscription.
  rebuild();
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
