import type { Scene, SceneOptions } from './Scene';
import { BackgroundSceneConfig, Capabilities, SceneTier, resolveTier } from './tier';
import { debugOverlaysAllowed } from './debugOverlays';
import { getConstellationLines, getSkyChoice, subscribe } from './skyState';
import type { SkyChoice } from './ridge/skyMoment';
import { drawnView, ensureSkyPlace, resetSkyPlanes } from './skyPlace';
import type { SkyColours } from './ridge/skyColour';
import type { Backdrop } from './ridge/Backdrop';
import { FALLBACK_VIEW, HFOV_MAX_DEG, maxSpeed } from './ridge/view';

export type { Scene, SceneStats } from './Scene';
export type { SceneStyle, SceneTier } from './tier';

export type StartOptions = Omit<SceneOptions, 'tier' | 'patchSource' | 'onCompileFail'> & {
  /** A shader failed to compile, or the scene chunk failed to load. The host keeps its ground. */
  onCompileFail?: (e: Error) => void;
  /** A rebuild for a new sky made no scene: the host puts the CSS ground back (as on a lost context). */
  onInactive?: () => void;
  /** A rebuild made a scene again: the host lets it show. */
  onActive?: () => void;
  /** The live scene is the sky alone because the baked ridge cards did not load (no manifest, a missing or undecodable card, no WebGL2 to light them). The host may fill the ground. Told when the live scene changes to that state, never for a build that did not win. */
  onPlanesFail?: (e: Error) => void;
  /** The live scene has its planes after `onPlanesFail` said it had none: the host lets go of the ground it filled. */
  onPlanesOk?: () => void;
};

/** The observation file the ridge sky reads: the page's own, beside config.json. The browser calls no weather service. */
const weatherUrl = (): string => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/weather.json`;

/** A scene made ready: every await is done, so `make` is synchronous and a rebuild can keep the old scene until the instant it swaps. */
interface Prepared {
  make: () => Scene | null;
  /** Let go of what was made for a scene that will never be made (a build that went stale): the backdrop's lighting context. */
  discard: () => void;
  /** Why this scene is the sky alone, when the baked planes did not load; null when it has planes or none are asked for. */
  planesFail: Error | null;
}

/** How long the first scene start waits for the first tiles, ms: past it the scene draws with the tiles it has and the rest arrive into it; with none, it is the sky alone. A rebuild has no deadline: the scene it replaces stays up until it has its tiles. */
export const PREPARE_DEADLINE_MS = 6_000;

async function prepare(
  config: BackgroundSceneConfig | undefined,
  options: StartOptions & { tier: SceneTier; debug?: boolean },
  choice: SkyChoice,
  first: boolean
): Promise<Prepared> {
  // Whatever throws in making the scene is a compile failure, as whatever throws in loading it.
  let backdrop: Backdrop | null = null;
  const guarded = (make: () => Scene | null): Prepared => ({
    planesFail: null,
    discard: () => backdrop?.dispose(),
    make: () => {
      try {
        return make();
      } catch (e) {
        backdrop?.dispose();
        options.onCompileFail?.(e instanceof Error ? e : new Error(String(e)));
        return null;
      }
    },
  });
  try {
    // Loaded here, with the scenes, so the main chunk does not carry the ridge sky or the baked tables.
    const { loadWeather, ridgeSkyFor } = await import('./skyForState');
    if (config?.style === 'raymarch') {
      const { createScene } = await import('./Scene');
      return guarded(() => createScene(options));
    }
    const { createRidgeScene } = await import('./ridge/Ridge');
    const { manifest, fail } = await ensureSkyPlace(config);
    await loadWeather(weatherUrl(), (manifest?.view ?? FALLBACK_VIEW).place);
    // The tiles around the heading load with the scene chunk and the weather, and are lit here for this sky (a sky change comes through a rebuild), so
    // createRidgeScene stays synchronous and the scene's first frame has its ridge; it asks for the tiles ahead as the view turns. Any failure, a missing
    // WebGL2 included, is the sky alone, over the view the store is told of.
    let lit: SkyColours | undefined;
    let planesFail: Error | null = fail;
    if (manifest) {
      try {
        const manifestSky = ridgeSkyFor(choice, manifest.view);
        const { createBackdrop } = await import('./ridge/Backdrop');
        const heading = await import('./ridge/heading');
        backdrop = createBackdrop(
          manifest,
          manifestSky.physical as NonNullable<typeof manifestSky.physical>
        );
        // A place not shown before faces its rest azimuth; a rebuild for a sky keeps the heading the view has turned to. The speed is bounded from here on, not
        // from the scene's first frame: the view does not turn further than the place sustains while the tiles load.
        const now = performance.now();
        heading.anchor(manifest.view.place.id, manifest.view.lookAzDeg, now, (mode) => maxSpeed(manifest, mode));
        const { h } = heading.poseAt(now);
        // The first arc. The first scene of a page has nothing to show meanwhile, so it waits against a deadline (a slow or silent server must not hold it back):
        // what is held by then is drawn and the rest fills in. A rebuild has the old scene up and waits for its tiles as long as they take.
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            backdrop.ensure({ fromDeg: h - HFOV_MAX_DEG / 2, toDeg: h + HFOV_MAX_DEG / 2 }),
            new Promise<void>((late) => {
              if (first) timer = setTimeout(late, PREPARE_DEADLINE_MS);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        if (backdrop.litTiles().length === 0) throw new Error('ridge cards did not load');
        lit = manifestSky;
      } catch (e) {
        backdrop?.dispose();
        backdrop = null;
        planesFail = e instanceof Error ? e : new Error(String(e));
      }
    }
    const view = drawnView(backdrop ? manifest : null);
    if (!lit) await loadWeather(weatherUrl(), view.place);
    const sky = lit ?? ridgeSkyFor(choice, view);
    const made = guarded(() =>
      createRidgeScene({
        ...options,
        sky,
        backdrop: backdrop ?? undefined,
        lines: getConstellationLines(),
      })
    );
    return { ...made, planesFail };
  } catch (e) {
    options.onCompileFail?.(e instanceof Error ? e : new Error(String(e)));
    return { make: () => null, discard: () => undefined, planesFail: null };
  }
}

/**
 * What a rebuild is for: the sky options the scene would be built from. A change of choice that draws the same sky
 * (Auto picked as a named moment it already is drawing) is not a rebuild.
 */
async function skyKey(
  config: BackgroundSceneConfig | undefined,
  choice: SkyChoice
): Promise<string | null> {
  try {
    const { loadWeather, ridgeSkyKey } = await import('./skyForState');
    const { view } = await ensureSkyPlace(config);
    await loadWeather(weatherUrl(), view.place);
    return ridgeSkyKey(choice, view);
  } catch {
    // The chunk failed to load: no key, so every change rebuilds (and `create` reports the failure).
    return null;
  }
}

/**
 * The client's one door to the scene. When the tier resolves to 'off' nothing is imported and no
 * canvas context is requested; otherwise the scene code loads on demand, so it stays out of the
 * main chunk. `config.style` picks the scene: the ridges unless it says 'raymarch' (any other value, an old 'terrain' included, is the ridges). Null means
 * "keep the CSS ground", including when that chunk fails to load (offline, stale deploy): the
 * failure goes to onCompileFail and nothing throws.
 *
 * The ridge scene bakes its sky once, so it follows the sky (`skyState.ts`: the choice at the place, so Auto follows the clock) by
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
  const prepared = (choice: SkyChoice, first: boolean) => prepare(config, { ...options, tier, debug }, choice, first);
  resetSkyPlanes();
  const choice = getSkyChoice();
  const key0 = config?.style === 'raymarch' ? null : await skyKey(config, choice);
  const firstReady = await prepared(choice, true);
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
    const next = getSkyChoice();
    const key = await skyKey(config, next);
    if (getSkyChoice() !== next) return;
    if ((key !== null && key === built) || disposed) return;
    generation += 1;
    const mine = generation;
    built = key;
    // The old scene stays up while the next one loads; a build that is stale or after dispose is never made, so it never speaks.
    const ready = await prepared(next, false);
    if (disposed || mine !== generation) {
      ready.discard();
      return;
    }
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
