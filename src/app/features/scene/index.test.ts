import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atSolarTime } from './ridge/skyTestkit';
import type { Scene } from './Scene';
import { PREPARE_DEADLINE_MS, startBackgroundScene } from './index';
import { getResolvedSkyState, getSkyPlace, pickSkyChoice, setSkyChoice, setSkyClock, setSkyPlace, subscribe } from './skyState';
import { skyBand } from './ridge/skyMoment';
import type { SkyChoice } from './ridge/skyMoment';
import { ridgeSkyFor } from './skyForState';
import { forgetManifests } from './ridge/manifest';
import { wireIndex, wireManifest } from './ridge/manifest.fixture';
import { FALLBACK_VIEW, HFOV_MAX_DEG, maxSpeed } from './ridge/view';
import { headingAt, hold, resetHeading } from './ridge/heading';
import { resetCamera, setCamera } from './cameraState';
import { sunAt } from './ridge/sunAt';
import { ridgeWeather } from './ridge/weather';
import { parseWeatherFile, WEATHER_ATTRIBUTION, weatherFromFile } from './ridge/weatherFeed';

const { createRidgeScene, createScene, createBackdrop } = vi.hoisted(() => ({
  createRidgeScene: vi.fn(),
  createScene: vi.fn(),
  createBackdrop: vi.fn(),
}));
vi.mock('./ridge/Ridge', () => ({ createRidgeScene }));
// Decoding and lighting are the cards' own tests' (Backdrop.test.ts, lightCards.test.ts); here the door sees a backdrop whose first arc it can hold, fail and count.
vi.mock('./ridge/Backdrop', () => ({ createBackdrop }));
vi.mock('./Scene', () => ({ createScene }));
// The physical sky is baked per call (tens of ms: atmosphere LUTs) and the clock here is fixed, so a state always
// draws the same sky. Baking once per state keeps the 21-offset sweep under the default timeout when the machine is
// loaded; the sky each build receives is still the one `ridgeSkyFor` makes for that state.
vi.mock('./skyForState', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./skyForState')>();
  const baked = new Map<string, ReturnType<typeof actual.ridgeSkyFor>>();
  return {
    ...actual,
    ridgeSkyFor: (...args: Parameters<typeof actual.ridgeSkyFor>) => {
      const [state, view] = args;
      // One bake per choice and place; the view is the one owner of the place, so it is part of what a sky is.
      const key = `${JSON.stringify(state)}@${JSON.stringify(view.place)}`;
      if (!baked.has(key)) baked.set(key, actual.ridgeSkyFor(...args));
      return baked.get(key) as ReturnType<typeof actual.ridgeSkyFor>;
    },
  };
});

const AUTO: SkyChoice = { kind: 'auto' };
const NOON: SkyChoice = { kind: 'named', id: 'noon' };
const DUSK: SkyChoice = { kind: 'named', id: 'dusk' };
const NIGHT: SkyChoice = { kind: 'named', id: 'night' };

const canvas = {} as HTMLCanvasElement;
const config = { tier: 'low' as const };
const caps = { hardwareConcurrency: 8 };
const flush = () =>
  new Promise<void>((r) => {
    setTimeout(r, 0);
  });
// Resolves after `n` further turns of the microtask queue.
const microtasks = (n: number) =>
  Array.from({ length: n }).reduce<Promise<void>>(
    (p) => p.then(() => undefined),
    Promise.resolve()
  );
/** A `createBackdrop` whose first `ensure` waits on `ctl.hold` (queueing its settle in `ctl.pending`), then makes tiles or, with `ctl.fail` as it stood when asked, none. `ctl.calls` is the sky each backdrop was lit for; `ctl.made` the backdrops. */
const loader = () => {
  const ctl = {
    pending: [] as Array<() => void>,
    hold: false,
    fail: false,
    calls: [] as any[],
    made: [] as any[],
  };
  createBackdrop.mockImplementation((manifest: unknown, physical: unknown) => {
    const fails = ctl.fail; // the outcome belongs to the request, whenever it settles
    let made = false;
    const bd = {
      manifest,
      dispose: vi.fn(),
      litTiles: () => (made && !fails ? [{ tile: 0, card: 0, canvas: {} }] : []),
      ensure: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            const settle = () => {
              made = true;
              ctl.calls.push(physical);
              resolve();
            };
            if (ctl.hold) ctl.pending.push(settle);
            else settle();
          })
      ),
    };
    ctl.made.push(bd);
    return bd;
  });
  return {
    ctl,
    release: async () => {
      ctl.hold = false;
      ctl.pending.splice(0).forEach((s) => s());
      await flush();
    },
  };
};
const fakeScene = () => ({ login: vi.fn(), dispose: vi.fn() });
const hex = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  // Local midnight: 'auto' resolves to night.
  setSkyClock(() => atSolarTime(0, 0));
  setSkyChoice(AUTO);
  setSkyPlace(FALLBACK_VIEW.place);
  createRidgeScene.mockReset();
  createScene.mockReset();
  createBackdrop.mockReset();
});
afterEach(() => {
  setSkyClock();
  setSkyChoice(AUTO);
  vi.unstubAllGlobals();
});

describe('startBackgroundScene follows the sky state', () => {
  it('hands the ridge scene the sky auto resolves to (night at midnight)', async () => {
    createRidgeScene.mockReturnValue(fakeScene());
    const scene = await startBackgroundScene(config, caps, { canvas });
    expect(createRidgeScene).toHaveBeenCalledOnce();
    expect(hex(createRidgeScene.mock.calls[0][0].sky.top)).toBe(
      hex(ridgeSkyFor(AUTO, FALLBACK_VIEW).top)
    );
    scene?.dispose();
  });

  it('rebuilds when Auto is replaced by the named moment of the same band: live and frozen are different skies, and the same pick again is not a rebuild', async () => {
    const [a, b] = [fakeScene(), fakeScene()];
    createRidgeScene.mockReturnValueOnce(a).mockReturnValueOnce(b);
    const scene = await startBackgroundScene(config, caps, { canvas });
    setSkyChoice(NIGHT);
    await flush();
    expect(a.dispose).toHaveBeenCalledOnce();
    expect(createRidgeScene).toHaveBeenCalledTimes(2);
    setSkyChoice(NIGHT);
    await flush();
    expect(createRidgeScene).toHaveBeenCalledTimes(2);
    scene?.dispose();
  });

  it('starts on the stored state', async () => {
    setSkyChoice(NIGHT);
    createRidgeScene.mockReturnValue(fakeScene());
    const scene = await startBackgroundScene(config, caps, { canvas });
    expect(hex(createRidgeScene.mock.calls[0][0].sky.top)).toBe(
      hex(ridgeSkyFor(NIGHT, FALLBACK_VIEW).top)
    );
    scene?.dispose();
  });

  it('rebuilds on a change: the old scene is disposed, the new one draws the new sky', async () => {
    const first = fakeScene();
    const second = fakeScene();
    createRidgeScene.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const scene = await startBackgroundScene(config, caps, { canvas });
    setSkyChoice(NOON);
    await flush();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(hex(createRidgeScene.mock.calls[1][0].sky.top)).toBe(
      hex(ridgeSkyFor(NOON, FALLBACK_VIEW).top)
    );
    scene?.dispose();
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  it('rebuilds for a change that landed while the first build was awaited', async () => {
    const [a, b] = [fakeScene(), fakeScene()];
    createRidgeScene.mockReturnValueOnce(a).mockReturnValueOnce(b);
    const started = startBackgroundScene(config, caps, { canvas });
    setSkyChoice(NOON);
    const scene = await started;
    await flush();
    expect(createRidgeScene).toHaveBeenCalledTimes(2);
    expect(hex(createRidgeScene.mock.calls[1][0].sky.top)).toBe(
      hex(ridgeSkyFor(NOON, FALLBACK_VIEW).top)
    );
    expect(a.dispose).toHaveBeenCalledOnce();
    scene?.dispose();
    expect(b.dispose).toHaveBeenCalledOnce();
  });

  it('replays a login onto the rebuilt scene, but only if one happened', async () => {
    const [a, b, c] = [fakeScene(), fakeScene(), fakeScene()];
    createRidgeScene.mockReturnValueOnce(a).mockReturnValueOnce(b).mockReturnValueOnce(c);
    const scene = await startBackgroundScene(config, caps, { canvas });
    setSkyChoice(NOON);
    await flush();
    expect(b.login).not.toHaveBeenCalled();
    scene?.login();
    expect(b.login).toHaveBeenCalledOnce();
    setSkyChoice(DUSK);
    await flush();
    expect(c.login).toHaveBeenCalledOnce();
    scene?.dispose();
  });

  it('puts the ground back when a rebuild makes no scene, and lets it show when one returns', async () => {
    const [a, c] = [fakeScene(), fakeScene()];
    createRidgeScene.mockReturnValueOnce(a).mockReturnValueOnce(null).mockReturnValueOnce(c);
    const onInactive = vi.fn();
    const onActive = vi.fn();
    const scene = await startBackgroundScene(config, caps, { canvas, onInactive, onActive });
    expect(onInactive).not.toHaveBeenCalled();
    setSkyChoice(NOON);
    await flush();
    expect(onInactive).toHaveBeenCalledOnce();
    expect(onActive).not.toHaveBeenCalled();
    setSkyChoice(DUSK);
    await flush();
    expect(onActive).toHaveBeenCalledOnce();
    expect(onInactive).toHaveBeenCalledOnce();
    scene?.dispose();
  });

  it('does not report a dropped rebuild as inactive', async () => {
    createRidgeScene.mockReturnValueOnce(fakeScene()).mockReturnValueOnce(null);
    const onInactive = vi.fn();
    const scene = await startBackgroundScene(config, caps, { canvas, onInactive });
    setSkyChoice(NOON);
    scene?.dispose();
    await flush();
    expect(onInactive).not.toHaveBeenCalled();
  });

  it('removes the subscription on dispose', async () => {
    const first = fakeScene();
    createRidgeScene.mockReturnValue(first);
    const scene = await startBackgroundScene(config, caps, { canvas });
    scene?.dispose();
    scene?.dispose();
    setSkyChoice(NOON);
    await flush();
    expect(createRidgeScene).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
  });

  it('builds nothing for a rebuild that is disposed before it starts', async () => {
    createRidgeScene.mockReturnValueOnce(fakeScene()).mockReturnValueOnce(fakeScene());
    const scene = await startBackgroundScene(config, caps, { canvas });
    setSkyChoice(NOON);
    scene?.dispose();
    await flush();
    expect(createRidgeScene).toHaveBeenCalledOnce();
  });

  it('keeps only the latest of two quick changes: the last sky is built, the others are not left running', async () => {
    const scenes = [fakeScene(), fakeScene(), fakeScene()];
    scenes.forEach((s) => createRidgeScene.mockReturnValueOnce(s));
    const scene = await startBackgroundScene(config, caps, { canvas });
    setSkyChoice(NOON);
    setSkyChoice(DUSK);
    await flush();
    // The sky last built is dusk's, and it is the live scene: a login reaches it and nothing else.
    const built = createRidgeScene.mock.calls.length;
    expect(hex(createRidgeScene.mock.calls[built - 1][0].sky.top)).toBe(
      hex(ridgeSkyFor(DUSK, FALLBACK_VIEW).top)
    );
    const live = scenes[built - 1];
    scene?.login();
    expect(live.login).toHaveBeenCalledOnce();
    scenes.filter((s) => s !== live).forEach((s) => expect(s.login).not.toHaveBeenCalled());
    // Every scene but the live one was disposed, the live one not yet.
    scenes.slice(0, built).forEach((s) => {
      expect(s.dispose).toHaveBeenCalledTimes(s === live ? 0 : 1);
    });
    scene?.dispose();
    expect(live.dispose).toHaveBeenCalledOnce();
  });

  it('a rebuild for a sky that was replaced while its key was awaited builds nothing: only the newest sky is built', async () => {
    createRidgeScene.mockReturnValueOnce(fakeScene()).mockReturnValueOnce(fakeScene());
    createRidgeScene.mockReturnValue(fakeScene());
    const scene = await startBackgroundScene(config, caps, { canvas });
    setSkyChoice(NOON);
    setSkyChoice(DUSK);
    await flush();
    // The initial build and one rebuild, for dusk; day's rebuild stood down before building anything.
    expect(createRidgeScene).toHaveBeenCalledTimes(2);
    expect(hex(createRidgeScene.mock.calls[1][0].sky.top)).toBe(
      hex(ridgeSkyFor(DUSK, FALLBACK_VIEW).top)
    );
    scene?.dispose();
  });

  // A second sky change `ticks` microtasks after the first. True when it landed mid-build: the build for the first
  // change finished loading, was found stale and was never made (so it never showed or spoke), and only the newest sky was announced.
  const changeAfter = async (ticks: number) => {
    createRidgeScene.mockReset();
    setSkyChoice(AUTO);
    const [a, b, c] = [fakeScene(), fakeScene(), fakeScene()];
    createRidgeScene.mockReturnValueOnce(a).mockReturnValueOnce(b).mockReturnValueOnce(c);
    const onActive = vi.fn();
    const scene = await startBackgroundScene(config, caps, { canvas, onActive });
    setSkyChoice(NOON);
    await microtasks(ticks);
    setSkyChoice(DUSK);
    await flush();
    const at = `at ${ticks} microtasks`;
    const built = createRidgeScene.mock.calls.length;
    expect(hex(createRidgeScene.mock.calls[built - 1][0].sky.top), at).toBe(
      hex(ridgeSkyFor(DUSK, FALLBACK_VIEW).top)
    );
    // The newest build is live, every earlier one disposed exactly once, and only the live one is shown.
    const live = [a, b, c][built - 1];
    scene?.login();
    expect(live.login, at).toHaveBeenCalledOnce();
    [a, b, c].slice(0, built).forEach((x) => {
      expect(x.dispose, at).toHaveBeenCalledTimes(x === live ? 0 : 1);
      if (x !== live) expect(x.login, at).not.toHaveBeenCalled();
    });
    scene?.dispose();
    expect(live.dispose, at).toHaveBeenCalledOnce();
    return built === 2 && onActive.mock.calls.length === 1;
  };

  it('a sky change at any point of a build leaves only the newer build live; the stale one is disposed', async () => {
    // The offsets are swept, not pinned, so a shift in the awaits inside the build cannot move the change off the
    // build: at least one offset must land mid-build, or the sweep proves nothing.
    const offsets = Array.from({ length: 21 }, (_, i) => i);
    const landed = await offsets.reduce<Promise<number[]>>(
      (p, k) => p.then(async (acc) => ((await changeAfter(k)) ? [...acc, k] : acc)),
      Promise.resolve([])
    );
    // This can fail after a correct refactor that changes the await count in create/skyKey and moves every offset
    // off the build. Then widen the range of offsets until some land again; do not weaken the assertion.
    expect(landed.length, 'at least one offset must land mid-build').toBeGreaterThan(0);
  }, 30000);

  it('leaves the ray-march scene alone: it has one fixed dusk', async () => {
    const inner = fakeScene() as unknown as Scene;
    createScene.mockReturnValue(inner);
    const scene = await startBackgroundScene({ ...config, style: 'raymarch' }, caps, { canvas });
    expect(scene).toBe(inner);
    setSkyChoice(NOON);
    await flush();
    expect(createScene).toHaveBeenCalledOnce();
  });

  it('keeps the ground and reports a ray-march scene that throws while being created', async () => {
    const boom = new Error('shader link failed');
    createScene.mockImplementation(() => {
      throw boom;
    });
    const onCompileFail = vi.fn();
    const scene = await startBackgroundScene({ ...config, style: 'raymarch' }, caps, {
      canvas,
      onCompileFail,
    });
    expect(scene).toBeNull();
    expect(onCompileFail).toHaveBeenCalledOnce();
    expect(onCompileFail).toHaveBeenCalledWith(boom);
  });
});

describe('the ridge planes', () => {
  const served = (over: Record<string, unknown> = {}) => {
    const files: Record<string, unknown> = {
      '/public/ridge/index.json': wireIndex,
      '/public/ridge/vienna-abc123abc123/manifest.json': wireManifest(),
      '/public/ridge/graz-def456def456/manifest.json': wireManifest({
        place: { ...(wireManifest() as any).place, id: 'graz', name: 'Graz' },
      }),
      ...over,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url in files
          ? { ok: true, status: 200, json: async () => files[url] }
          : { ok: false, status: 404, json: async () => ({}) }
      )
    );
  };
  beforeEach(() => forgetManifests());

  it('hands the scene the lit cards of its manifest, lit once for the sky it was given, over the manifest view', async () => {
    served();
    const { ctl } = loader();
    createRidgeScene.mockReturnValue(fakeScene());
    const scene = await startBackgroundScene(config, caps, { canvas });
    const opts = createRidgeScene.mock.calls[0][0];
    expect(opts.backdrop.manifest.view.place.id).toBe('vienna');
    expect(opts.sky.physical.view).toBe(opts.backdrop.manifest.view);
    expect(ctl.calls).toHaveLength(1);
    expect(ctl.calls[0]).toBe(opts.sky.physical); // the sky the cards were lit for is the sky the scene paints
    expect(ctl.calls[0].state).toBe('night'); // midnight by the clock
    scene?.dispose();
  });

  it('awaits the first arc of tiles round the heading before the scene is made, and anchors a new place at its rest azimuth', async () => {
    served();
    resetHeading();
    const d = loader();
    createRidgeScene.mockReturnValue(fakeScene());
    d.ctl.hold = true;
    const started = startBackgroundScene(config, caps, { canvas });
    await flush();
    expect(createRidgeScene).not.toHaveBeenCalled(); // the tiles are not made yet
    expect(d.ctl.made).toHaveLength(1);
    const arc = d.ctl.made[0].ensure.mock.calls[0][0];
    expect((arc.fromDeg + arc.toDeg) / 2).toBeCloseTo(214, 0); // the Vienna rest azimuth, nothing having turned the view
    expect(arc.toDeg - arc.fromDeg).toBeCloseTo(HFOV_MAX_DEG, 6);
    await d.release();
    (await started)?.dispose();
    expect(createRidgeScene).toHaveBeenCalledOnce();
    // A rebuild for a new sky keeps the heading the view has turned to.
    hold(100, performance.now());
    forgetManifests();
    (await startBackgroundScene(config, caps, { canvas }))?.dispose();
    const second = d.ctl.made[1].ensure.mock.calls[0][0];
    expect((second.fromDeg + second.toDeg) / 2).toBeCloseTo(100, 0);
  });

  it('bounds the speed from the anchor: while the first tiles load the view turns no faster than the place sustains, whatever speed is stored', async () => {
    served({ '/public/ridge/vienna-abc123abc123/manifest.json': wireManifest({ camera: { r_max_m: 98.2, r_max_forward_m: 205.4 } }, 3, 32) }); // a ring whose gate holds fewer than all its tiles
    resetHeading();
    resetCamera();
    setCamera({ mode: 'both', speedDegPerS: 12 }, 0);
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1_000);
    const d = loader();
    let seen = NaN;
    createRidgeScene.mockImplementation(() => {
      seen = headingAt(performance.now());
      return fakeScene();
    });
    d.ctl.hold = true;
    const started = startBackgroundScene(config, caps, { canvas });
    await flush();
    clock.mockReturnValue(6_000); // the tiles took five seconds
    await d.release();
    (await started)?.dispose();
    const slow = maxSpeed(d.ctl.made[0].manifest, 'both');
    expect(slow).toBeLessThan(12);
    expect(seen).toBeCloseTo(214 + 5 * slow, 6); // not 214 + 60
    clock.mockRestore();
    resetCamera();
  });

  describe('a scene start with a deadline', () => {
    /** A backdrop whose first arc never settles, holding `tiles` tiles. */
    const silent = (tiles: number) => {
      const made: any[] = [];
      createBackdrop.mockImplementation((manifest: unknown) => {
        const bd = {
          manifest,
          dispose: vi.fn(),
          litTiles: () => Array.from({ length: tiles }, (_, tile) => ({ tile, card: 0, canvas: {} })),
          ensure: vi.fn(() => new Promise<void>(() => undefined)),
        };
        made.push(bd);
        return bd;
      });
      return made;
    };
    const real = () => new Promise<void>((r) => setImmediate(r));
    afterEach(() => {
      vi.useRealTimers();
    });

    it('draws with the tiles it has when the server is slow, and the rest fill in: the backdrop is the scene, not a finished load', async () => {
      served();
      resetHeading();
      const made = silent(2);
      createRidgeScene.mockReturnValue(fakeScene());
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const started = startBackgroundScene(config, caps, { canvas });
      for (let i = 0; i < 20; i += 1) await real();
      expect(made).toHaveLength(1);
      expect(createRidgeScene).not.toHaveBeenCalled(); // the first arc is still out
      await vi.advanceTimersByTimeAsync(PREPARE_DEADLINE_MS - 1);
      for (let i = 0; i < 5; i += 1) await real();
      expect(createRidgeScene).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      const scene = await started;
      expect(createRidgeScene).toHaveBeenCalledOnce();
      expect(createRidgeScene.mock.calls[0][0].backdrop).toBe(made[0]); // the scene holds it, and goes on asking it for the arcs ahead
      expect(made[0].dispose).not.toHaveBeenCalled();
      scene?.dispose();
    });

    it('is the sky alone, told once, when the deadline passes with no tile held, and lets go of the backdrop and its requests', async () => {
      served();
      resetHeading();
      const made = silent(0);
      createRidgeScene.mockReturnValue(fakeScene());
      const onPlanesFail = vi.fn();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const started = startBackgroundScene(config, caps, { canvas, onPlanesFail });
      for (let i = 0; i < 20; i += 1) await real();
      await vi.advanceTimersByTimeAsync(PREPARE_DEADLINE_MS);
      const scene = await started;
      expect(createRidgeScene).toHaveBeenCalledOnce();
      expect(createRidgeScene.mock.calls[0][0].backdrop).toBeUndefined();
      expect(made[0].dispose).toHaveBeenCalledOnce();
      expect(onPlanesFail).toHaveBeenCalledOnce();
      scene?.dispose();
    });
  });

  it('a build that goes stale disposes the backdrop it made, and a scene that fails to be made does too', async () => {
    served();
    const d = loader();
    createRidgeScene.mockReturnValue(fakeScene());
    const scene = await startBackgroundScene(config, caps, { canvas });
    d.ctl.hold = true;
    setSkyChoice(NOON); // stale once the next choice lands
    await flush();
    const day = d.ctl.pending.splice(0);
    setSkyChoice(DUSK);
    await flush();
    const dusk = d.ctl.pending.splice(0);
    dusk.forEach((s) => s());
    await flush();
    day.forEach((s) => s());
    await flush();
    const [, dayBackdrop, duskBackdrop] = d.ctl.made;
    expect(dayBackdrop.dispose).toHaveBeenCalledOnce();
    expect(duskBackdrop.dispose).not.toHaveBeenCalled(); // it is the live scene's
    scene?.dispose();
    createRidgeScene.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    d.ctl.hold = false;
    const onCompileFail = vi.fn();
    forgetManifests();
    await startBackgroundScene(config, caps, { canvas, onCompileFail });
    expect(onCompileFail).toHaveBeenCalled();
    expect(d.ctl.made[d.ctl.made.length - 1].dispose).toHaveBeenCalledOnce();
  });

  it('config place picks the index entry; an unknown id falls back to the default', async () => {
    served();
    loader();
    createRidgeScene.mockReturnValue(fakeScene());
    (await startBackgroundScene({ ...config, place: 'graz' }, caps, { canvas }))?.dispose();
    expect(createRidgeScene.mock.calls[0][0].backdrop.manifest.view.place.id).toBe('graz');
    forgetManifests();
    (await startBackgroundScene({ ...config, place: 'nowhere' }, caps, { canvas }))?.dispose();
    expect(createRidgeScene.mock.calls[1][0].backdrop.manifest.view.place.id).toBe('vienna');
  });

  it("makes the manifest's place the sky's place, so the ink and the scene read one place; a failed load makes it the drawn fallback's", async () => {
    served();
    loader();
    createRidgeScene.mockReturnValue(fakeScene());
    setSkyPlace(undefined);
    (await startBackgroundScene({ ...config, place: 'graz' }, caps, { canvas }))?.dispose();
    expect(getSkyPlace()?.id).toBe('graz');
    expect(getSkyPlace()?.tz).toBe('Europe/Vienna');
    forgetManifests();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
    );
    setSkyPlace(undefined);
    (await startBackgroundScene(config, caps, { canvas }))?.dispose();
    expect(getSkyPlace()).toEqual(FALLBACK_VIEW.place);
  });

  it('a manifest that fails to load: the ink follows the drawn fallback sky, and Auto still ticks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
    );
    createRidgeScene.mockReturnValue(fakeScene());
    setSkyPlace(undefined);
    setSkyChoice(NOON);
    const scene = await startBackgroundScene(config, caps, { canvas });
    try {
      const opts = createRidgeScene.mock.calls[0][0];
      expect(opts.sky.physical.view).toBe(FALLBACK_VIEW);
      expect(getSkyPlace()).toEqual(FALLBACK_VIEW.place);
      expect(getResolvedSkyState()).toBe('day');
      expect(getResolvedSkyState()).toBe(skyBand(opts.sky.physical.sun.elevation));
    } finally {
      scene?.dispose();
    }
    // Auto crosses dusk with the place the fallback scene drew.
    setSkyChoice(AUTO);
    vi.useFakeTimers();
    try {
      let now = atSolarTime(17, 0);
      setSkyClock(() => now);
      const heard = vi.fn();
      const off = subscribe(heard);
      now = atSolarTime(18, 10);
      vi.advanceTimersByTime(60_000);
      expect(heard).toHaveBeenCalledWith('dusk');
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cards that fail on a place that is not the fallback: the sky and the ink are at the one place, the fallback', async () => {
    const fuji = {
      ...(wireManifest() as any).place,
      id: 'fuji',
      lat: 35.36,
      lon: 138.73,
      tz: 'Asia/Tokyo',
    };
    served({ '/public/ridge/vienna-abc123abc123/manifest.json': wireManifest({ place: fuji }) });
    const { ctl } = loader();
    ctl.fail = true;
    createRidgeScene.mockReturnValue(fakeScene());
    setSkyPlace(undefined);
    setSkyChoice(NOON);
    const scene = await startBackgroundScene(config, caps, { canvas });
    try {
      const opts = createRidgeScene.mock.calls[0][0];
      expect(opts.backdrop).toBeUndefined();
      expect(opts.sky.physical.view).toBe(FALLBACK_VIEW);
      expect(getSkyPlace()).toEqual(FALLBACK_VIEW.place);
      expect(getResolvedSkyState()).toBe(skyBand(opts.sky.physical.sun.elevation));
      // The next key, made before the next build, is for the view that is drawn: the place does not flip back to the manifest's.
      setSkyChoice(DUSK);
      await flush();
      expect(getSkyPlace()).toEqual(FALLBACK_VIEW.place);
    } finally {
      scene?.dispose();
    }
  });

  const skyOnly = async (onPlanesFail = vi.fn(), onCompileFail = vi.fn()) => {
    createRidgeScene.mockReturnValue(fakeScene());
    const scene = await startBackgroundScene(config, caps, { canvas, onPlanesFail, onCompileFail });
    const opts = createRidgeScene.mock.calls[0][0];
    expect(scene).not.toBeNull();
    expect(opts.backdrop).toBeUndefined();
    expect(opts.sky.physical.view).toBe(FALLBACK_VIEW);
    expect(onPlanesFail).toHaveBeenCalledOnce();
    expect(onCompileFail).not.toHaveBeenCalled();
    scene?.dispose();
  };

  it('a 404 manifest gives the sky-only scene with the fallback view, one onPlanesFail and no onCompileFail', async () => {
    served({ '/public/ridge/index.json': undefined });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
    );
    loader();
    await skyOnly();
  });
});

describe('the ridge cards failing', () => {
  it('a card that will not load gives the same sky-only scene, and a rebuild does not report again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => (url.endsWith('index.json') ? wireIndex : wireManifest()),
      }))
    );
    loader().ctl.fail = true;
    forgetManifests();
    createRidgeScene.mockReturnValue(fakeScene());
    const onPlanesFail = vi.fn();
    const onCompileFail = vi.fn();
    const scene = await startBackgroundScene(config, caps, { canvas, onPlanesFail, onCompileFail });
    expect(createRidgeScene.mock.calls[0][0].backdrop).toBeUndefined();
    setSkyChoice(NOON);
    await flush();
    expect(createRidgeScene).toHaveBeenCalledTimes(2);
    expect(onPlanesFail).toHaveBeenCalledOnce();
    expect(onCompileFail).not.toHaveBeenCalled();
    scene?.dispose();
  });
});

describe('the ridge cards and the live scene', () => {
  const serve = (manifest: Record<string, unknown> = wireManifest()) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => (url.endsWith('index.json') ? wireIndex : manifest),
      }))
    );
  beforeEach(() => forgetManifests());

  it('says nothing about cards when they load', async () => {
    serve();
    loader();
    createRidgeScene.mockReturnValue(fakeScene());
    const onPlanesFail = vi.fn();
    const onPlanesOk = vi.fn();
    const scene = await startBackgroundScene(config, caps, { canvas, onPlanesFail, onPlanesOk });
    setSkyChoice(NOON);
    await flush();
    expect(createRidgeScene).toHaveBeenCalledTimes(2);
    expect(createRidgeScene.mock.calls.every((c) => c[0].backdrop)).toBe(true);
    expect(onPlanesFail).not.toHaveBeenCalled();
    expect(onPlanesOk).not.toHaveBeenCalled();
    scene?.dispose();
  });

  it('lights the cards again for the new sky on a sky-change rebuild, never otherwise', async () => {
    serve();
    const { ctl } = loader();
    createRidgeScene.mockReturnValue(fakeScene());
    const scene = await startBackgroundScene(config, caps, { canvas });
    expect(ctl.calls.map((s) => s.state)).toEqual(['night']);
    setSkyChoice(NOON);
    await flush();
    expect(ctl.calls.map((s) => s.state)).toEqual(['night', 'day']);
    setSkyChoice(NOON); // the sky already drawn: no rebuild, no lighting
    await flush();
    expect(ctl.calls).toHaveLength(2);
    expect(createRidgeScene.mock.calls[1][0].sky.physical).toBe(ctl.calls[1]);
    expect(createRidgeScene.mock.calls[1][0].backdrop.manifest.view.place.id).toBe('vienna');
    scene?.dispose();
  });

  it('rebuilds the scene with the constellation lines when Night is re-picked while Night is the choice, and again to take them off', async () => {
    serve();
    loader();
    createRidgeScene.mockReturnValue(fakeScene());
    const scene = await startBackgroundScene(config, caps, { canvas });
    expect(createRidgeScene.mock.calls[0][0].lines).toBe(false);
    pickSkyChoice(NIGHT); // from Auto: a choice, a frozen sky
    await flush();
    expect(createRidgeScene).toHaveBeenCalledTimes(2);
    expect(createRidgeScene.mock.calls[1][0].lines).toBe(false);
    pickSkyChoice(NIGHT); // re-picked: the lines
    await flush();
    expect(createRidgeScene).toHaveBeenCalledTimes(3);
    expect(createRidgeScene.mock.calls[2][0].lines).toBe(true);
    pickSkyChoice(NIGHT);
    await flush();
    expect(createRidgeScene.mock.calls[3][0].lines).toBe(false);
    scene?.dispose();
  });

  it('a lighting pass that throws (no WebGL2) is the sky alone, one onPlanesFail and never onCompileFail', async () => {
    serve();
    createBackdrop.mockImplementation(() => {
      throw new Error('ridge: no WebGL2');
    });
    createRidgeScene.mockReturnValue(fakeScene());
    const onPlanesFail = vi.fn();
    const onCompileFail = vi.fn();
    const scene = await startBackgroundScene(config, caps, { canvas, onPlanesFail, onCompileFail });
    expect(createRidgeScene.mock.calls[0][0].backdrop).toBeUndefined();
    expect(createRidgeScene.mock.calls[0][0].sky.physical.view).toBe(FALLBACK_VIEW);
    expect(onPlanesFail).toHaveBeenCalledOnce();
    expect(onPlanesFail.mock.calls[0][0].message).toMatch(/WebGL2/);
    expect(onCompileFail).not.toHaveBeenCalled();
    scene?.dispose();
  });

  it("keys a rebuild by the manifest's place: the same sky over a rebaked place rebuilds", async () => {
    serve();
    loader();
    const [a, b] = [fakeScene(), fakeScene()];
    createRidgeScene.mockReturnValueOnce(a).mockReturnValueOnce(b);
    const w = wireManifest() as any;
    setSkyChoice(NIGHT);
    const scene = await startBackgroundScene(config, caps, { canvas });
    // The same choice, told again while the place is the one drawn: no rebuild.
    setSkyPlace(undefined);
    await flush();
    expect(createRidgeScene).toHaveBeenCalledOnce();
    forgetManifests();
    serve({ ...w, place: { ...w.place, id: 'graz' } });
    setSkyPlace(undefined);
    await flush();
    expect(createRidgeScene).toHaveBeenCalledTimes(2);
    expect(createRidgeScene.mock.calls[1][0].backdrop.manifest.view.place.id).toBe('graz');
    scene?.dispose();
  });

  it("reads the weather against the manifest place's sun, not the fallback place's", async () => {
    const w = wireManifest() as any;
    const place = { ...w.place, id: 'weather-place', lat: -33, lon: -163.65, tz_h: -11 };
    const now = new Date('2026-11-11T10:50:00Z');
    const wx = {
      fetched_at: '2026-11-11T10:45:00Z',
      observed_at: '2026-11-11T10:40:00Z',
      station: 11035,
      precip_mm_10min: 0,
      humidity_pct: 60,
      sunshine_s_10min: null,
      glow_wm2: 100,
      attribution: WEATHER_ATTRIBUTION,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          url.endsWith('weather.json')
            ? wx
            : url.endsWith('index.json')
            ? wireIndex
            : { ...w, place },
      }))
    );
    loader();
    setSkyClock(() => now);
    createRidgeScene.mockReturnValue(fakeScene());
    (await startBackgroundScene(config, caps, { canvas }))?.dispose();
    const file = parseWeatherFile(wx)!;
    const at = (p: { lat: number; lon: number }) =>
      weatherFromFile(
        file,
        sunAt({ id: 'x', altitudeKm: 0, tz: 'UTC', ...p }, new Date(Date.parse(wx.observed_at) - 5 * 60_000))
          .elevation
      );
    expect(at(FALLBACK_VIEW.place)).not.toBe(at(place));
    expect(ridgeWeather()).toBe(at(place));
  });

  it('a failed load is the sky alone on the fallback view, never the manifest place', async () => {
    serve();
    const { ctl } = loader();
    ctl.fail = true;
    createRidgeScene.mockReturnValue(fakeScene());
    const scene = await startBackgroundScene(config, caps, { canvas });
    const opts = createRidgeScene.mock.calls[0][0];
    expect(opts.backdrop).toBeUndefined();
    expect(opts.sky.physical.view).toBe(FALLBACK_VIEW);
    scene?.dispose();
  });

  it('a rebuild keeps the old scene until the new planes have loaded, then swaps', async () => {
    serve();
    const d = loader();
    const first = fakeScene();
    const second = fakeScene();
    createRidgeScene.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const onActive = vi.fn();
    const scene = await startBackgroundScene(config, caps, { canvas, onActive });
    d.ctl.hold = true;
    setSkyChoice(NOON);
    await flush();
    expect(d.ctl.pending.length).toBeGreaterThan(0);
    expect(first.dispose).not.toHaveBeenCalled();
    expect(createRidgeScene).toHaveBeenCalledOnce();
    scene?.login();
    expect(first.login).toHaveBeenCalledOnce();
    await d.release();
    expect(createRidgeScene).toHaveBeenCalledTimes(2);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).not.toHaveBeenCalled();
    expect(onActive).toHaveBeenCalledOnce();
    expect(second.login).toHaveBeenCalledOnce(); // replayed onto the swapped-in scene
    scene?.dispose();
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  it('a build that fails after the scene is disposed makes nothing and says nothing', async () => {
    serve();
    const d = loader();
    createRidgeScene.mockReturnValue(fakeScene());
    const onPlanesFail = vi.fn();
    const scene = await startBackgroundScene(config, caps, { canvas, onPlanesFail });
    d.ctl.hold = true;
    d.ctl.fail = true;
    setSkyChoice(NOON);
    await flush();
    scene?.dispose();
    await d.release();
    expect(createRidgeScene).toHaveBeenCalledOnce();
    expect(onPlanesFail).not.toHaveBeenCalled();
  });

  it('a superseded build that fails does not speak for the live scene, which has planes', async () => {
    serve();
    const d = loader();
    createRidgeScene.mockReturnValue(fakeScene());
    const onPlanesFail = vi.fn();
    const scene = await startBackgroundScene(config, caps, { canvas, onPlanesFail });
    d.ctl.hold = true;
    d.ctl.fail = true;
    setSkyChoice(NOON); // stale: its decodes will reject
    await flush();
    d.ctl.fail = false;
    setSkyChoice(DUSK); // the live one: its decodes will succeed
    await flush();
    const stale = d.ctl.pending.splice(0, 1);
    d.ctl.pending.length = 0;
    d.ctl.hold = false;
    stale.forEach((s) => s()); // the first six are day's, settled in order
    await flush();
    expect(onPlanesFail).not.toHaveBeenCalled();
    scene?.dispose();
  });

  it('a superseded build that finishes after the newer one touches nothing of the live scene', async () => {
    serve();
    const d = loader();
    const [first, second, third] = [fakeScene(), fakeScene(), fakeScene()];
    createRidgeScene
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockReturnValueOnce(third);
    const onActive = vi.fn();
    const scene = await startBackgroundScene(config, caps, { canvas, onActive });
    d.ctl.hold = true;
    setSkyChoice(NOON); // stale: its decodes are held until after the newer build is live
    await flush();
    const dayDecodes = d.ctl.pending.splice(0);
    setSkyChoice(DUSK);
    await flush();
    const duskDecodes = d.ctl.pending.splice(0);
    expect(dayDecodes.length).toBeGreaterThan(0);
    expect(duskDecodes.length).toBeGreaterThan(0);
    duskDecodes.forEach((s) => s());
    await flush();
    expect(createRidgeScene).toHaveBeenCalledTimes(2);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(onActive).toHaveBeenCalledOnce();
    dayDecodes.forEach((s) => s()); // the stale build finishes last
    await flush();
    expect(createRidgeScene).toHaveBeenCalledTimes(2);
    expect(second.dispose).not.toHaveBeenCalled(); // the live scene is not disposed by a build that lost
    expect(onActive).toHaveBeenCalledOnce();
    scene?.login();
    expect(second.login).toHaveBeenCalledOnce();
    scene?.dispose();
    expect(second.dispose).toHaveBeenCalledOnce();
    expect(third.dispose).not.toHaveBeenCalled();
  });

  it('a build that finishes after dispose makes nothing, shows nothing and disposes nothing twice', async () => {
    serve();
    const d = loader();
    const first = fakeScene();
    createRidgeScene.mockReturnValueOnce(first).mockReturnValueOnce(fakeScene());
    const onActive = vi.fn();
    const scene = await startBackgroundScene(config, caps, { canvas, onActive });
    d.ctl.hold = true;
    setSkyChoice(NOON);
    await flush();
    scene?.dispose();
    await d.release();
    expect(createRidgeScene).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(onActive).not.toHaveBeenCalled();
  });

  it('a rebuild that makes no scene says nothing about planes and leaves the host inactive', async () => {
    serve();
    const d = loader();
    createRidgeScene.mockReturnValueOnce(fakeScene()).mockReturnValueOnce(null);
    const onPlanesFail = vi.fn();
    const onInactive = vi.fn();
    const scene = await startBackgroundScene(config, caps, { canvas, onPlanesFail, onInactive });
    d.ctl.fail = true;
    setSkyChoice(NOON);
    await flush();
    expect(onInactive).toHaveBeenCalledOnce();
    expect(onPlanesFail).not.toHaveBeenCalled();
    scene?.dispose();
  });

  it('tells the host when the live scene loses its planes and when it gets them back', async () => {
    serve();
    const d = loader();
    d.ctl.fail = true;
    createRidgeScene.mockReturnValue(fakeScene());
    const onPlanesFail = vi.fn();
    const onPlanesOk = vi.fn();
    const scene = await startBackgroundScene(config, caps, { canvas, onPlanesFail, onPlanesOk });
    expect(onPlanesFail).toHaveBeenCalledOnce();
    setSkyChoice(NOON); // still failing: the host is not told twice
    await flush();
    expect(onPlanesFail).toHaveBeenCalledOnce();
    expect(onPlanesOk).not.toHaveBeenCalled();
    d.ctl.fail = false;
    setSkyChoice(DUSK);
    await flush();
    expect(onPlanesOk).toHaveBeenCalledOnce();
    expect(createRidgeScene.mock.calls[2][0].backdrop).toBeDefined();
    d.ctl.fail = true;
    setSkyChoice(NIGHT);
    await flush();
    expect(onPlanesFail).toHaveBeenCalledTimes(2);
    scene?.dispose();
  });
});
