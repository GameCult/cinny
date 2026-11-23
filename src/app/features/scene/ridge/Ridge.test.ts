import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRidgeScene } from './Ridge';
import { valueNoise, hash2 } from './noise';
import { FrameSampler, frameStats, SLOW_P95_MS, WARMUP_FRAMES, WINDOW_MS } from './probe';
import type { SkyColours } from './skyColour';
import { nightBodies } from './nightBodies';
import { sunAt } from './sunAt';
import { makePhysicalSky, paintSky as paintPhysicalSky } from './physicalSky';
import { sunOfBand } from './skyTestkit';
import { startBackgroundScene } from '../index';
import { parseIndex, parseManifest } from './manifest';
import { ELSEWHERE_VIEW, wireManifest } from './manifest.fixture';
import type { Arc, Backdrop, LitTile } from './Backdrop';
import type { Mock } from 'vitest';
import { cardArc, cardPose, FALLBACK_VIEW, HFOV_MAX_DEG, maxSpeed, offsetRange, SEGMENT_S, windowFor } from './view';
import { residentTiles } from './ring';
import { anchor, EASE_MS, headingAt, hold, phiAt, resetHeading, shownPhiAt } from './heading';
import { effectiveMode, getCamera, isHeld, resetCamera, setCamera } from '../cameraState';

describe('noise', () => {
  it('is deterministic and in [0, 1)', () => {
    expect(hash2(3, 5)).toBe(hash2(3, 5));
    for (let i = 0; i < 200; i += 1) {
      const v = valueNoise(i * 0.37 - 20, 2);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(valueNoise(i * 0.37 - 20, 2)).toBe(v);
    }
  });

  it('different rows are different profiles', () => {
    expect(valueNoise(1.5, 0)).not.toBeCloseTo(valueNoise(1.5, 1), 3);
  });
});

describe('frame sampler', () => {
  const feed = (s: FrameSampler, dt: number, frames: number, from = 0) => {
    let t = from;
    let done = false;
    for (let i = 0; i < frames && !done; i += 1) {
      t += dt;
      done = s.push(t);
    }
    return done;
  };

  it('median and p95 of known intervals', () => {
    const v = Array.from({ length: 100 }, (_, i) => (i < 90 ? 16 : 50));
    expect(frameStats(v)).toEqual({ n: 100, medianMs: 16, p95Ms: 50 });
    expect(frameStats([])).toEqual({ n: 0, medianMs: 0, p95Ms: 0 });
  });

  it('does not complete before 2 s of measured frames, and ignores the warm-up', () => {
    const s = new FrameSampler();
    expect(feed(s, 16, 100)).toBe(false); // 1.6 s
    expect(feed(s, 16, 40, 1600)).toBe(true);
    expect(s.stats().n).toBeLessThan(100 + 40 - WARMUP_FRAMES + 1);
  });

  it('a smooth 60 Hz run is not slow; a run of 40 ms frames is', () => {
    const good = new FrameSampler();
    feed(good, 16.7, 400);
    expect(good.slow()).toBe(false);
    const bad = new FrameSampler();
    feed(bad, 100, 400); // ~100 ms frames, the PR #13 readout
    expect(bad.stats().p95Ms).toBeGreaterThan(SLOW_P95_MS);
    expect(bad.slow()).toBe(true);
  });

  it('a long warm-up frame does not poison the window', () => {
    const s = new FrameSampler();
    let t = 0;
    s.push(t);
    for (let i = 0; i < WARMUP_FRAMES; i += 1) s.push((t += 300)); // setup, upload, JIT
    feed(s, 16.7, 200, t);
    expect(s.slow()).toBe(false);
    expect(WINDOW_MS).toBe(2000);
  });

  it('reset forgets a hidden-tab gap', () => {
    const s = new FrameSampler();
    feed(s, 16, 20);
    s.reset();
    expect(s.stats().n).toBe(0);
  });
});

// A minimal DOM: just what createRidgeScene touches.
function fakeEl(tag = 'div') {
  const el: any = {
    tag,
    style: {},
    children: [] as any[],
    parentElement: null as any,
    width: 0,
    height: 0,
    clientWidth: 400,
    clientHeight: 800,
    attrs: {} as Record<string, string>,
    setAttribute(k: string, v: string) {
      this.attrs[k] = v;
    },
    getContext: vi.fn(() => ctx()),
    toDataURL: () => 'data:,',
    remove() {
      if (this.parentElement)
        this.parentElement.children = this.parentElement.children.filter((c: any) => c !== this);
      this.parentElement = null;
    },
    appendChild(c: any) {
      c.parentElement = this;
      this.children.push(c);
      return c;
    },
    animate: vi.fn((keyframes: any[], options: any) => {
      const a: any = {
        currentTime: 0,
        keyframes,
        options,
        onfinish: null,
        play: vi.fn(),
        pause: vi.fn(),
        cancel: vi.fn(),
        /** The animation reaches its end: what the compositor's finish event does. */
        finish() {
          a.currentTime = options.duration;
          a.onfinish?.();
        },
      };
      el.anims.push(a);
      return a;
    }),
    anims: [] as any[],
  };
  return el;
}
// A day sky has no stars, so the scene tests above see only the sky; the dusk default
// carries stars and a twinkle overlay, tested in 'the starfield in the scene'.
const DAY: SkyColours = {
  top: [96, 150, 220],
  mid: [150, 190, 235],
  horizon: [240, 215, 190],
};
const draws: string[] = [];
const images: unknown[][] = [];
/** Every RGBA grid the host canvas was painted from (the small canvas's putImageData). */
const painted: Uint8ClampedArray[] = [];
function ctx() {
  const c: any = {
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    fillRect() {
      draws.push('sky');
    },
    save() {},
    restore() {
      c.t = undefined;
      c.k = undefined;
    },
    translate(x: number, y: number) {
      c.t = [x, y];
    },
    scale(k: number) {
      c.k = k;
    },
    rect() {},
    clip() {},
    rotate() {},
    ellipse() {},
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData(img: { data: Uint8ClampedArray }) {
      painted.push(img.data);
    },
    beginPath() {},
    moveTo() {},
    stroke() {
      draws.push('line');
    },
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
    lineTo() {},
    closePath() {},
    // Stars: arc+fill is one draw. A context that has cleared a rect is the twinkle overlay's.
    clearRect() {
      c.overlay = true;
      draws.push('clear');
    },
    arc() {
      draws.push(c.overlay ? 'twinkle' : 'star');
      c.arcing = true;
    },
    fill: () => {
      if (c.arcing) c.arcing = false;
      else draws.push('fill');
    },
    drawImage(...a: unknown[]) {
      draws.push('image');
      images.push(
        Object.assign(a, { alpha: c.globalAlpha, op: c.globalCompositeOperation, t: c.t, k: c.k })
      );
    },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    set fillStyle(_v: unknown) {},
  };
  return c;
}

let rafQueue: Array<(t: number) => void>;
let motion: { matches: boolean; addEventListener: any; removeEventListener: any };
let doc: any;
let search: string;

beforeEach(() => {
  rafQueue = [];
  draws.length = 0;
  images.length = 0;
  painted.length = 0;
  search = '';
  motion = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible',
    createElement: (t: string) => fakeEl(t),
  });
  vi.stubGlobal('document', doc);
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), {
      devicePixelRatio: 2,
      innerWidth: 400,
      innerHeight: 800,
      matchMedia: () => motion,
      clearTimeout,
      location: {
        get search() {
          return search;
        },
      },
      setTimeout,
    })
  );
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => rafQueue.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {
    rafQueue = [];
  });
});
afterEach(() => vi.unstubAllGlobals());

function host() {
  const parent = fakeEl('div');
  const canvas = fakeEl('canvas');
  parent.appendChild(canvas);
  return { parent, canvas };
}
const runFrames = (dt: number, n: number, from = 0) => {
  let t = from;
  for (let i = 0; i < n && rafQueue.length; i += 1) {
    t += dt;
    // One display frame: every callback queued for it sees the same timestamp.
    rafQueue.splice(0).forEach((cb) => cb(t));
  }
  return t;
};

describe('createRidgeScene', () => {
  it("returns null at tier 'off' and touches nothing", () => {
    const { canvas } = host();
    expect(createRidgeScene({ canvas, tier: 'off' })).toBeNull();
    expect(canvas.getContext).not.toHaveBeenCalled();
  });

  it('returns null when 2D context is missing, so the host keeps its CSS ground', () => {
    const { canvas } = host();
    canvas.getContext = vi.fn(() => null);
    expect(createRidgeScene({ canvas, tier: 'full', sky: DAY })).toBeNull();
  });

  it('paints the sky once at the viewport in canvas pixels and adds nothing to the page in a clear day', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY })!;
    expect(s).not.toBeNull();
    expect([canvas.width, canvas.height]).toEqual([800, 1600]);
    expect(draws.filter((d) => d === 'sky')).toHaveLength(1);
    expect(parent.children).toEqual([canvas]);
    s.dispose();
  });

  it("paints the sky through the camera of the physical sky's own View, not a default one", () => {
    const { canvas } = host();
    const physical = makePhysicalSky(sunOfBand(ELSEWHERE_VIEW.place, 'day', new Date('2026-06-21T10:40:00Z')), 0, ELSEWHERE_VIEW);
    const s = createRidgeScene({ canvas, tier: 'full', sky: { ...DAY, physical } })!;
    const want = paintPhysicalSky(physical, 400, 800, windowFor(ELSEWHERE_VIEW, 400, 800).camera);
    expect(painted).toHaveLength(1);
    expect(Array.from(painted[0])).toEqual(Array.from(want.data));
    s.dispose();
  });

  it('a smooth run draws nothing more and ends its rAF loop', () => {
    const { canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY })!;
    const before = draws.length;
    runFrames(16.7, 400);
    expect(draws.length).toBe(before);
    expect(rafQueue).toHaveLength(0); // no per-frame work left
    s.dispose();
  });

  it('p95 over 33 ms across 2 s settles to a still and reports it', () => {
    const { canvas } = host();
    const onProbe = vi.fn();
    const s = createRidgeScene({ canvas, tier: 'full', onProbe, sky: DAY })!;
    runFrames(100, 100);
    expect(onProbe).toHaveBeenLastCalledWith(expect.objectContaining({ still: true }));
    expect(rafQueue).toHaveLength(0);
    s.dispose();
  });

  it("'still' tier never starts a loop", () => {
    const { parent, canvas } = host();
    createRidgeScene({ canvas, tier: 'still' });
    expect(parent.children).toEqual([canvas]);
    expect(rafQueue).toHaveLength(0);
  });

  it('?probe=1 keeps the rAF loop alive and shows median and p95', () => {
    search = '?probe=1';
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, debug: true })!;
    const readout = parent.children[parent.children.length - 1];
    runFrames(16.7, 300);
    expect(rafQueue.length).toBe(1); // still sampling
    expect(readout.textContent).toMatch(/median 16\.\d ms · p95 1[67]\.\d ms/);
    s.dispose();
    expect(parent.children.some((c: any) => c === readout)).toBe(false);
  });

  it('?probe=1 does nothing where the overlays are not allowed: no readout, the loop ends', () => {
    search = '?probe=1';
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY })!;
    expect(parent.children).toEqual([canvas]);
    runFrames(16.7, 300);
    expect(rafQueue.length).toBe(0);
    s.dispose();
  });

  it('a scene started at zero size paints nothing, then builds on the first non-zero resize', async () => {
    const { parent, canvas } = host();
    canvas.clientWidth = 0;
    canvas.clientHeight = 0;
    (window as any).innerWidth = 0;
    (window as any).innerHeight = 0;
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY });
    expect(s).not.toBeNull();
    expect(draws).toHaveLength(0);
    // Still zero: a resize does not paint either.
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 300));
    expect(draws).toHaveLength(0);
    (window as any).innerWidth = 400;
    (window as any).innerHeight = 800;
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 300));
    expect(draws.filter((d) => d === 'sky')).toHaveLength(1);
    s!.dispose();
    expect(parent.children).toEqual([canvas]);
  });
});

describe('the door', () => {
  it('runs the ridge scene by default and never requests a WebGL context', async () => {
    const { canvas } = host();
    const getContext = vi.fn((kind: string) => (kind === '2d' ? ctx() : null));
    canvas.getContext = getContext;
    const scene = await startBackgroundScene({ tier: 'full' }, {}, { canvas });
    expect(scene).not.toBeNull();
    expect(getContext.mock.calls.every(([k]) => k === '2d')).toBe(true);
    scene!.dispose();
  });

  it('the tier flag still defaults to off: nothing imported, no context', async () => {
    const { canvas } = host();
    expect(await startBackgroundScene(undefined, {}, { canvas })).toBeNull();
    expect(canvas.getContext).not.toHaveBeenCalled();
  });
});

describe('the starfield in the scene', () => {
  const count = (kind: string) => draws.filter((d) => d === kind).length;
  // A moonless-horizon night over Vienna (the moon is 17 degrees below it): the real stars of that moment, and no moon to count as an arc.
  const t = new Date('2026-12-04T00:00:00Z');
  const physical = makePhysicalSky(sunAt(FALLBACK_VIEW.place, t), 0, FALLBACK_VIEW);
  const night: SkyColours = { ...DAY, physical };
  const N = nightBodies(
    physical,
    paintPhysicalSky(physical, 400, 800, windowFor(FALLBACK_VIEW, 400, 800).camera),
    false
  ).stars.length;
  const hear = (name: string) => {
    const calls = motion.addEventListener.mock.calls.filter((c: any[]) => c[0] === name);
    return calls[calls.length - 1][1] as () => void;
  };
  // Everything but the overlay's own marks: the sky and its stars.
  const baked = () => draws.filter((d) => d !== 'twinkle' && d !== 'clear').length;

  it('bakes every star once into the sky; per frame only the overlay is touched', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: night })!;
    expect(count('star')).toBe(N);
    expect(painted).toHaveLength(1); // the physical sky's one grid
    expect(parent.children[1].anims).toHaveLength(0); // the overlay, above the sky
    expect(parent.children).toHaveLength(2);
    const before = baked();
    runFrames(16.7, 300); // 5 s at 60 fps; the overlay repaints at 20 fps
    expect(baked()).toBe(before);
    expect(count('clear')).toBeGreaterThan(60);
    expect(count('clear')).toBeLessThanOrEqual(101);
    // each pass paints at most SLOTS stars, each as its cover and the star again
    expect(count('twinkle')).toBeLessThanOrEqual(count('clear') * 64);
    expect(count('twinkle')).toBeGreaterThan(0);
    s.dispose();
  });

  it('a day sky has no stars and no overlay layer', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY })!;
    expect(count('star')).toBe(0);
    expect(parent.children).toHaveLength(1);
    runFrames(16.7, 60);
    expect(count('clear')).toBe(0);
    s.dispose();
  });

  it("tier 'still' bakes the stars and has no overlay or loop", () => {
    const { parent, canvas } = host();
    createRidgeScene({ canvas, tier: 'still', sky: night });
    expect(count('star')).toBe(N);
    expect(parent.children).toEqual([canvas]);
    expect(rafQueue).toHaveLength(0);
  });

  it('stops twinkling under reduced motion, live, and resumes when it is lifted', () => {
    const { canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: night })!;
    let t = runFrames(16.7, 30);
    expect(count('twinkle')).toBeGreaterThan(0);
    motion.matches = true;
    hear('change')();
    t = runFrames(16.7, 5, t);
    const stopped = draws.length;
    t = runFrames(16.7, 200, t);
    expect(draws.length).toBe(stopped);
    expect(rafQueue).toHaveLength(0);
    motion.matches = false;
    hear('change')();
    runFrames(16.7, 30, t);
    expect(draws.length).toBeGreaterThan(stopped);
    s.dispose();
  });

  it('starts steady, with nothing painted over the stars, when reduced motion is already on', () => {
    motion.matches = true;
    const { canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: night })!;
    expect(rafQueue).toHaveLength(0);
    runFrames(16.7, 60);
    expect(count('twinkle')).toBe(0);
    s.dispose();
  });

  it('stops while the tab is hidden and resumes when it is visible', () => {
    const { canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: night })!;
    let t = runFrames(16.7, 30);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    const hidden = draws.length;
    t = runFrames(16.7, 200, t);
    expect(draws.length).toBe(hidden);
    expect(rafQueue).toHaveLength(0);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    runFrames(16.7, 30, t);
    expect(draws.length).toBeGreaterThan(hidden);
    s.dispose();
  });

  it('flattening to a still (slow frames) drops the overlay and leaves every star baked into the sky', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: night })!;
    runFrames(100, 100);
    expect(parent.children).toEqual([canvas]);
    expect(count('star')).toBe(N);
    expect(rafQueue).toHaveLength(0);
    s.dispose();
  });

  it('dispose removes the overlay and stops the loop', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: night })!;
    s.dispose();
    expect(parent.children).toEqual([canvas]);
    expect(rafQueue).toHaveLength(0);
  });
});

describe('rain in the scene', () => {
  const rainy = (w: number): SkyColours => ({
    ...DAY,
    physical: makePhysicalSky(sunOfBand(FALLBACK_VIEW.place, 'day', new Date('2026-06-21T10:40:00Z')), w, FALLBACK_VIEW),
  });
  const rainEls = (parent: any) => parent.children.filter((c: any) => c.tag === 'div');

  it('lays one falling tile per rain layer over the sky when it rains, each slid by its own height on the compositor', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: rainy(1) })!;
    const els = rainEls(parent);
    expect(els).toHaveLength(2);
    els.forEach((e: any) => {
      expect(e.anims).toHaveLength(1);
      expect(e.anims[0].options.iterations).toBe(Infinity);
    });
    s.dispose();
    expect(rainEls(parent)).toHaveLength(0);
    els.forEach((e: any) => expect(e.anims[0].cancel).toHaveBeenCalled());
  });

  it('draws no rain in dry weather, and none in a still', () => {
    const dry = host();
    createRidgeScene({ canvas: dry.canvas, tier: 'full', sky: rainy(0.3) })!.dispose();
    const a = host();
    const sa = createRidgeScene({ canvas: a.canvas, tier: 'full', sky: rainy(0.3) })!;
    expect(rainEls(a.parent)).toHaveLength(0);
    sa.dispose();
    const still = host();
    const ss = createRidgeScene({ canvas: still.canvas, tier: 'still', sky: rainy(1) })!;
    expect(rainEls(still.parent)).toHaveLength(0);
    ss.dispose();
  });

  it('pauses with the rest when motion is reduced', () => {
    motion.matches = true;
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: rainy(1) })!;
    rainEls(parent).forEach((e: any) => expect(e.anims[0].play).not.toHaveBeenCalled());
    s.dispose();
  });
});

describe('the ridge cards in the scene', () => {
  const manifest = parseManifest(wireManifest(), '/d/'); // four tiles of 90 degrees, three cards (card 2 absent in tile 2); rest azimuth 214
  const { view } = manifest;
  const tilesOf = (): LitTile[] =>
    manifest.tiles.flatMap((row, tile) =>
      row.flatMap((e, card) => {
        if (!e) return [];
        const canvas = fakeEl('canvas');
        canvas.id = `t${tile}c${card}`;
        canvas.width = 1602;
        return [{ tile, card, canvas: canvas as unknown as HTMLCanvasElement }];
      })
    );
  const litCards = (): Backdrop & { ensure: Mock<[Arc, Arc?], Promise<void>>; dispose: Mock<[], void> } => {
    const lit = tilesOf();
    return {
      manifest,
      ensure: vi.fn(async (_arc: Arc): Promise<void> => undefined),
      litTiles: () => lit,
      onTile: () => () => undefined,
      dispose: vi.fn(),
    };
  };
  const night: SkyColours = {
    ...DAY,
    top: [10, 14, 40],
    mid: [30, 34, 80],
    horizon: [60, 50, 90],
    physical: makePhysicalSky(sunOfBand(FALLBACK_VIEW.place, 'night', new Date('2026-06-21T22:40:00Z')), 1, FALLBACK_VIEW),
  };
  const rigOf = (parent: any) =>
    parent.children.find((c: any) => c.children.some((g: any) => g.anims.length));
  const win = windowFor(manifest.view, 400, 800);
  const planeTop = 800 - win.plane.bottom - win.plane.h;
  const horizonY = planeTop + view.horizonRow * win.plane.scale;
  const k = win.plane.scale * view.pxPerDegH;
  /** The animations of a box that are still running: a reissue cancels the one before it. */
  const live = (box: any): any[] => box.anims.filter((a: any) => a.cancel.mock.calls.length === 0);
  const mountedIds = (rig: any): string[] =>
    rig.children.flatMap((box: any) => box.children.map((c: any) => c.id)).sort();
  const T0 = 5_000;

  beforeEach(() => {
    resetHeading();
    resetCamera();
    vi.spyOn(performance, 'now').mockReturnValue(T0);
    anchor(view.place.id, view.lookAzDeg, T0); // what index.ts prepare does before the scene is made
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lays the night bodies (lines, stars, moon) in the sky before any card, so the cards occlude them', () => {
    const { canvas } = host();
    createRidgeScene({
      canvas,
      tier: 'still',
      sky: { ...night },
      backdrop: litCards(),
      lines: true,
    });
    const bodies = draws.map((d, i) => (d === 'line' || d === 'star' ? i : -1)).filter((i) => i >= 0);
    const images = draws.map((d, i) => (d === 'image' ? i : -1)).filter((i) => i >= 0);
    expect(bodies.length).toBeGreaterThan(0);
    expect(draws).toContain('line'); // the lines are drawn (the sky is a night one)
    const cards = images.slice(1); // the sky's upscale first, then the cards' tiles
    expect(cards.length).toBeGreaterThan(0);
    expect(Math.max(...bodies)).toBeLessThan(Math.min(...cards));
  });

  it('keeps the live sky canvas, with every body baked into it, under the twinkle canvas and the rig', () => {
    const { parent, canvas } = host();
    createRidgeScene({ canvas, tier: 'full', sky: { ...night }, backdrop: litCards(), lines: true });
    const rig = rigOf(parent);
    const twinkle = parent.children.findIndex((c: any) => c.tag === 'canvas');
    expect(twinkle).toBeGreaterThanOrEqual(0);
    expect(parent.children.indexOf(rig)).toBeGreaterThan(twinkle);
    expect(draws.filter((d) => d === 'image')).toHaveLength(1); // only the sky's own upscale is in the host canvas: the cards are DOM above it
  });

  it('stacks the rig after the twinkle canvas and before the rain, with no z-index and no fixed position, and disposes the backdrop with itself', () => {
    const { parent, canvas } = host();
    const bd = litCards();
    const s = createRidgeScene({ canvas, tier: 'full', sky: night, backdrop: bd })!;
    const kinds = parent.children.map((c: any) => c.tag);
    expect(kinds).toEqual(['canvas', 'canvas', 'div', 'div', 'div']);
    expect(parent.children[2].children).toHaveLength(3);
    parent.children.forEach((c: any) => {
      expect(c.style.zIndex).toBeUndefined();
      expect(c.style.position).not.toBe('fixed');
    });
    expect(bd.dispose).not.toHaveBeenCalled();
    s.dispose();
    expect(parent.children).toEqual([canvas]);
    expect(bd.dispose).toHaveBeenCalledOnce();
  });

  it('is one box per card, farthest first, spanning the viewport with its origin on the horizon centre, holding that card’s tiles', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: litCards() })!;
    const rig = rigOf(parent);
    expect(rig.children.map((c: any) => c.id)).toEqual(['card-2', 'card-1', 'card-0']);
    rig.children.forEach((el: any) => {
      expect(el.style.left).toBe('0');
      expect(el.style.width).toBe('400px');
      expect(el.style.height).toBe('800px');
      expect(el.style.transformOrigin).toBe(`200px ${horizonY}px`);
    });
    // Each card's tiles are its own: the box of card 0 holds only c0 canvases.
    rig.children.forEach((el: any) => {
      const card = Number(el.id.slice(-1));
      el.children.forEach((c: any) => expect(c.id.endsWith(`c${card}`)).toBe(true));
    });
    s.dispose();
  });

  it('mounts the tiles of the arc about to be seen at their unwrapped azimuth, at their own rows of the plane, one overlap column before the interior', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: litCards() })!;
    const rig = rigOf(parent);
    // Rest azimuth 214: tile 2 (180..270). Tile 1 and tile 3 are out of sight for the next 30 s at 0.6 degrees per second.
    expect(mountedIds(rig)).toEqual(['t2c0', 't2c1']);
    const c0 = rig.children[2].children[0];
    const e = manifest.tiles[2][0]!;
    const colDeg = 360 / view.ringW;
    const px = (v: string) => parseFloat(v);
    expect(px(c0.style.left)).toBeCloseTo(200 + (180 - colDeg - 214) * k, 6);
    expect(px(c0.style.top)).toBeCloseTo(horizonY + (e.top - view.horizonRow) * win.plane.scale, 6);
    expect(px(c0.style.width)).toBeCloseTo((view.tileW + 2) * win.plane.scale, 6);
    expect(px(c0.style.height)).toBeCloseTo(e.h * win.plane.scale, 6);
    s.dispose();
  });

  it('is one animation per card, not per tile, carrying the pose the heading owner gives each second for 30 seconds', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: litCards() })!;
    const rig = rigOf(parent);
    rig.children.forEach((box: any) => expect(live(box)).toHaveLength(1));
    rig.children.forEach((box: any) => {
      const card = Number(box.id.slice(-1));
      const { keyframes, options } = live(box)[0];
      expect(options).toEqual({ duration: 30000, easing: 'linear', fill: 'forwards' });
      expect(keyframes).toHaveLength(31);
      const pose = (t: number) =>
        cardPose(manifest, card, headingAt(t), phiAt(t), clampOffset(), win);
      [0, 1, 17, 30].forEach((n) => {
        const p = pose(T0 + n * 1000);
        expect(keyframes[n]).toEqual({ transform: `translate3d(${p.shiftPx}px,0,0) scale(${p.scale})` });
      });
      // The view turns at the viewer's 0.6 degrees per second: the container moves one pan per second, a nearer card faster.
    });
    const near = live(rig.children[2])[0].keyframes;
    const far = live(rig.children[0])[0].keyframes;
    const shift = (kf: any) => Number(/translate3d\((-?[\d.e-]+)px/.exec(kf.transform)?.[1]);
    expect(Math.abs(shift(near[30]) - shift(near[0]))).toBeGreaterThan(Math.abs(shift(far[30]) - shift(far[0])));
    s.dispose();
  });

  const clampOffset = () => {
    const [lo, hi] = offsetRange(manifest, win, getCamera().mode, phiAt(T0));
    return Math.min(hi, Math.max(lo, getCamera().offsetM));
  };

  it('a heading of 400 degrees places the tiles a heading of 40 does, a revolution on', () => {
    const at = (h: number) => {
      resetHeading();
      anchor(view.place.id, view.lookAzDeg, T0);
      hold(h, T0);
      const { parent, canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: litCards() })!;
      const rig = rigOf(parent);
      const out = {
        ids: mountedIds(rig),
        left: Number(rig.children[2].children[0].style.left.slice(0, -2)),
        heading: headingAt(T0),
      };
      s.dispose();
      return out;
    };
    // A manual turn leaves the rotation off, and a scene made over it keeps it off.
    const a = at(40);
    const b = at(400);
    expect(b.ids).toEqual(a.ids);
    // The rig lays out from the heading brought into [0, 360): a revolution on is the same picture, with nothing grown.
    expect(b.heading).toBeCloseTo(a.heading, 9);
    expect(b.left).toBeCloseTo(a.left, 6);
  });

  it('asks the backdrop for the arc between now and the end of the stretch, at once and every half second, and mounts what it has made', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = setTimeout;
    (window as any).clearTimeout = clearTimeout;
    const { parent, canvas } = host();
    const bd = litCards();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: bd })!;
    expect(bd.ensure).not.toHaveBeenCalled(); // the first arc was made before the scene (index.ts prepare)
    vi.advanceTimersByTime(500);
    expect(bd.ensure).toHaveBeenCalledTimes(1);
    const arc = bd.ensure.mock.calls[0][0];
    // The heading is 214 and turns 0.6 degrees per second to 232 in 30 s; on a 400 x 800 viewport a card shows about 28 degrees of itself.
    expect(arc.fromDeg).toBeLessThan(214 - 10);
    expect(arc.toDeg).toBeGreaterThan(232 + 10);
    vi.advanceTimersByTime(1500);
    expect(bd.ensure).toHaveBeenCalledTimes(4);
    // The view is turned by hand to the north: the next tick holds the tiles there.
    const before = mountedIds(rigOf(parent));
    hold(300, T0);
    vi.advanceTimersByTime(500);
    const after = mountedIds(rigOf(parent));
    expect(before).toEqual(['t2c0', 't2c1']);
    expect(after).not.toContain('t2c0');
    expect(after.some((id) => id.startsWith('t3'))).toBe(true);
    s.dispose();
    vi.useRealTimers();
  });

  it('issues the next stretch of motion once 80% of the last has run, on any change of heading, mode or offset, and not otherwise', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = setTimeout;
    (window as any).clearTimeout = clearTimeout;
    const now = vi.mocked(performance.now);
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: litCards() })!;
    const rig = rigOf(parent);
    const issued = () => rig.children.map((b: any) => b.anims.length);
    const base = issued()[0];
    now.mockReturnValue(T0 + 20_000);
    vi.advanceTimersByTime(20_000);
    expect(issued()[0]).toBe(base); // 20 s of 30: not yet
    now.mockReturnValue(T0 + 24_500);
    vi.advanceTimersByTime(4_500);
    expect(issued()[0]).toBe(base + 1);
    expect(rig.children[0].anims[base - 1].cancel).toHaveBeenCalled();
    const afterReissue = issued()[0];
    setCamera({ offsetM: 20 });
    expect(issued()[0]).toBe(afterReissue + 1);
    setCamera({ offsetM: 20 }); // nothing changed
    expect(issued()[0]).toBe(afterReissue + 1);
    hold(10, T0 + 24_500);
    expect(issued()[0]).toBe(afterReissue + 2);
    s.dispose();
    setCamera({ offsetM: 30 });
    expect(issued()[0]).toBe(afterReissue + 2); // a disposed scene is deaf
    vi.useRealTimers();
  });

  it('adds no rAF of its own over ten idle seconds: the drift is Element.animate, the stars alone loop', () => {
    vi.useFakeTimers();
    (window as any).setTimeout = setTimeout;
    (window as any).clearTimeout = clearTimeout;
    const { canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: litCards() })!;
    expect(rafQueue).toHaveLength(1); // the frame sampler, as without cards
    vi.advanceTimersByTime(10_000);
    expect(rafQueue).toHaveLength(1);
    s.dispose();
    vi.useRealTimers();
  });

  it('runs constant keyframes under reduced motion, and the view turns nothing whatever the viewer asked for', () => {
    motion.matches = true;
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: litCards() })!;
    expect(headingAt(T0 + 10_000)).toBe(headingAt(T0)); // nothing turns, whatever the viewer chose
    expect(getCamera().mode).toBe('both'); // and the viewer's choice is not rewritten for it
    rigOf(parent).children.forEach((box: any) => {
      const { keyframes } = live(box)[0];
      expect(keyframes.length).toBeGreaterThan(0);
      keyframes.forEach((f: any) => expect(f).toEqual(keyframes[0]));
    });
    s.dispose();
  });

  it('pauses the motion in a hidden tab and when motion is reduced, plays it again from where the clock is, and cancels it on dispose', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: litCards() })!;
    const rig = rigOf(parent);
    const anims = () => rig.children.map((g: any) => g.anims[g.anims.length - 1]);
    anims().forEach((a: any) => expect(a.play).toHaveBeenCalled());
    const first = anims();
    first.forEach((a: any) => a.pause.mockClear());
    motion.matches = true;
    motion.addEventListener.mock.calls
      .filter((c: any[]) => c[0] === 'change')
      .forEach((c: any[]) => c[1]());
    anims().forEach((a: any) => expect(a.pause).toHaveBeenCalled());
    motion.matches = false;
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    anims().forEach((a: any) => expect(a.pause).toHaveBeenCalled());
    doc.visibilityState = 'visible';
    (performance.now as any).mockReturnValue(T0 + 60_000);
    doc.dispatchEvent(new Event('visibilitychange'));
    const resumed = anims();
    resumed.forEach((a: any) => expect(a.play).toHaveBeenCalled());
    // Back in view the motion starts from the clock now, not from where it stopped.
    const frame0 = (box: any) => box.anims[box.anims.length - 1].keyframes[0].transform;
    const p = cardPose(manifest, 0, headingAt(T0 + 60_000), phiAt(T0 + 60_000), clampOffset(), win);
    expect(frame0(rig.children[2])).toBe(`translate3d(${p.shiftPx}px,0,0) scale(${p.scale})`);
    s.dispose();
    resumed.forEach((a: any) => expect(a.cancel).toHaveBeenCalled());
  });

  describe('after the viewer takes the view by hand, and for the long run', () => {
    const fixtureRing = (camera: Record<string, number> = { r_max_m: 98.2, r_max_forward_m: 205.4 }) =>
      parseManifest(wireManifest({ camera }, 3, 32), '/d/'); // the ring as the baker cuts it, with Vienna's two offset bounds
    const ringBackdrop = (m: typeof manifest): Backdrop & { ensure: Mock<[Arc, Arc?], Promise<void>> } => {
      const lit = m.tiles.flatMap((row, tile) =>
        row.flatMap((e, card) => {
          if (!e) return [];
          const canvas = fakeEl('canvas');
          canvas.id = `t${tile}c${card}`;
          return [{ tile, card, canvas: canvas as unknown as HTMLCanvasElement }];
        })
      );
      return {
        manifest: m,
        ensure: vi.fn(async (_arc: Arc, _first?: Arc): Promise<void> => undefined),
        litTiles: () => lit,
        onTile: () => () => undefined,
        dispose: vi.fn(),
      };
    };
    const frame = (box: any, n: number) => live(box)[0].keyframes[n].transform as string;
    const pending = () => {
      vi.useFakeTimers();
      (window as any).setTimeout = setTimeout;
      (window as any).clearTimeout = clearTimeout;
    };

    it('a manual turn holds through a rebuild: a resize makes a new scene and the view stays where the viewer left it', () => {
      pending();
      const { parent, canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: litCards() })!;
      hold(100, T0);
      const at = headingAt(T0);
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(300); // the debounced rebuild: startRig runs again
      expect(effectiveMode()).toBe('still'); // held, and the chosen mode untouched
      expect(getCamera().mode).toBe('both');
      expect(headingAt(T0 + 60_000)).toBe(at);
      rigOf(parent).children.forEach((box: any) => expect(frame(box, 30)).toBe(frame(box, 0)));
      s.dispose();
      // And a scene made afterwards, as a sky change makes one.
      const again = createRidgeScene({ canvas: host().canvas, tier: 'full', sky: night, backdrop: litCards() })!;
      expect(headingAt(T0 + 60_000)).toBe(at);
      again.dispose();
      vi.useRealTimers();
    });

    it('picking the mode they already had after a hold resumes the turn, and the rig moves again', () => {
      const { parent, canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: litCards() })!;
      hold(100, T0);
      rigOf(parent).children.forEach((box: any) => expect(frame(box, 30)).toBe(frame(box, 0)));
      expect(isHeld()).toBe(true);
      setCamera({ mode: 'both' }); // what the View's rotation picker sends: the mode the viewer had when they took the view
      expect(isHeld()).toBe(false);
      expect(headingAt(T0 + 10_000)).toBeCloseTo(106, 9);
      rigOf(parent).children.forEach((box: any) => expect(frame(box, 30)).not.toBe(frame(box, 0)));
      s.dispose();
    });

    it('mounts and asks for the tiles of every pose a stretch passes through, not those at its ends: offset-only turning swings the near card out and back', () => {
      pending();
      const ring = fixtureRing();
      const bd = ringBackdrop(ring);
      const w2 = windowFor(ring.view, 400, 800);
      setCamera({ mode: 'offset', speedDegPerS: 12, offsetM: 98 });
      const { parent, canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: bd })!;
      vi.advanceTimersByTime(500);
      const asked = bd.ensure.mock.calls[0][0];
      const [, hi] = offsetRange(ring, w2, 'offset');
      let from = Infinity;
      let to = -Infinity;
      let endFrom = Infinity;
      let endTo = -Infinity;
      for (let ms = 0; ms <= 30_000; ms += 100) {
        for (let i = 0; i < 3; i += 1) {
          const a = cardArc(ring.view, w2, 400, cardPose(ring, i, headingAt(T0 + ms), phiAt(T0 + ms), Math.min(hi, 98), w2));
          from = Math.min(from, a.fromDeg);
          to = Math.max(to, a.toDeg);
          if (ms === 0 || ms === 30_000) {
            endFrom = Math.min(endFrom, a.fromDeg);
            endTo = Math.max(endTo, a.toDeg);
          }
        }
      }
      expect(endTo - endFrom).toBeLessThan(to - from - 5); // the ends alone miss degrees of it (a whole turn of the camera comes back to where it began)
      expect(asked.fromDeg).toBeLessThanOrEqual(from + 0.01);
      expect(asked.toDeg).toBeGreaterThanOrEqual(to - 0.01);
      const need = new Set(residentTiles(ring.view, (from + to) / 2, (to - from) / 2 - 0.02).map((r) => r.tile));
      const mounted = new Set(mountedIds(rigOf(parent)).map((id) => Number(/^t(\d+)c/.exec(id)?.[1])));
      need.forEach((t) => expect(mounted.has(t), `tile ${t}`).toBe(true));
      s.dispose();
      vi.useRealTimers();
    });

    it('tells the loader where the view is now besides the arc it will sweep, so the tiles on screen are asked for first', () => {
      pending();
      const ring = fixtureRing();
      const bd = ringBackdrop(ring);
      const w2 = windowFor(ring.view, 400, 800);
      const { canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: bd })!;
      vi.advanceTimersByTime(500);
      const [arc, first] = bd.ensure.mock.calls[0];
      expect(first).toBeDefined();
      const now = [0, 1, 2].map((i) => cardArc(ring.view, w2, 400, cardPose(ring, i, headingAt(T0), phiAt(T0), 200, w2)));
      expect(first!.fromDeg).toBeCloseTo(Math.min(...now.map((a) => a.fromDeg)), 6);
      expect(first!.toDeg).toBeCloseTo(Math.max(...now.map((a) => a.toDeg)), 6);
      expect(first!.toDeg - first!.fromDeg).toBeLessThan(arc.toDeg - arc.fromDeg);
      s.dispose();
      vi.useRealTimers();
    });

    it('takes the default 200 m where the camera stays on its heading and the bake allows it, and the worst-case bound where the camera circles', () => {
      const ring = fixtureRing();
      const w2 = windowFor(ring.view, 400, 800);
      const keyframe0 = (mode: 'both' | 'offset') => {
        setCamera({ mode, speedDegPerS: 0.6, offsetM: 200 });
        const { parent, canvas } = host();
        const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: ringBackdrop(ring) })!;
        const got = frame(rigOf(parent).children[2], 0);
        s.dispose();
        return got;
      };
      const posed = (offset: number) => {
        const p = cardPose(ring, 0, headingAt(T0), phiAt(T0), offset, w2);
        return `translate3d(${p.shiftPx}px,0,0) scale(${p.scale})`;
      };
      expect(keyframe0('both')).toBe(posed(200));
      expect(keyframe0('offset')).toBe(posed(98.2));
    });

    it('bounds the speed at read to what the baked resident count sustains, for the mode in force, and never rewrites the stored speed', () => {
      const ring = fixtureRing();
      const slow = maxSpeed(ring, 'both');
      expect(slow).toBeGreaterThan(0.6);
      expect(slow).toBeLessThan(12);
      setCamera({ mode: 'both', speedDegPerS: 50 }); // a stored or future-slider value
      anchor(view.place.id, view.lookAzDeg, T0, (m) => maxSpeed(ring, m)); // what index.ts prepare does with the manifest, before the scene is made
      const { canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: ringBackdrop(ring) })!;
      expect(getCamera().speedDegPerS).toBe(50);
      expect(headingAt(T0 + 10_000) - headingAt(T0)).toBeCloseTo(10 * slow, 9);
      setCamera({ speedDegPerS: -50 });
      expect(getCamera().speedDegPerS).toBe(-50);
      expect(headingAt(T0 + 10_000) - headingAt(T0)).toBeCloseTo(-10 * slow, 9);
      setCamera({ mode: 'offset', speedDegPerS: 11 }); // the offset-only mode sweeps the circle the gate counts, whatever the speed
      expect(phiAt(T0 + 10_000) - phiAt(T0)).toBeCloseTo(110, 9);
      setCamera({ mode: 'both' });
      expect(getCamera().speedDegPerS).toBe(11); // still the viewer's value
      expect(headingAt(T0 + 10_000) - headingAt(T0)).toBeCloseTo(10 * slow, 9);
      s.dispose();
    });

    it('derives the offset clamp at read and never writes it back: offset-only to a forward mode restores 200 m', () => {
      const ring = fixtureRing();
      const w2 = windowFor(ring.view, 400, 800);
      setCamera({ mode: 'offset', speedDegPerS: 0.6, offsetM: 200 });
      const { parent, canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: ringBackdrop(ring) })!;
      const posed = (offset: number) => {
        const p = cardPose(ring, 0, headingAt(T0), phiAt(T0), offset, w2);
        return `translate3d(${p.shiftPx}px,0,0) scale(${p.scale})`;
      };
      expect(frame(rigOf(parent).children[2], 0)).toBe(posed(98.2));
      expect(getCamera().offsetM).toBe(200);
      setCamera({ mode: 'both' });
      expect(getCamera().offsetM).toBe(200);
      const keys = live(rigOf(parent).children[2])[0].keyframes;
      expect(keys[0].transform).toBe(posed(98.2)); // the view leaves from the offset it showed (the pick does not move it) ...
      const p = cardPose(ring, 0, headingAt(T0 + EASE_MS), phiAt(T0 + EASE_MS), 200, w2);
      expect(keys.find((f: any) => f.offset >= EASE_MS / (SEGMENT_S * 1000) - 1e-9).transform).toBe(`translate3d(${p.shiftPx}px,0,0) scale(${p.scale})`); // ... and is at 200 when the ease is spent
      s.dispose();
    });

    it('eases a mode pick: the view the viewer saw is the first frame, the new regime the frame an EASE_MS later, one animation and no timer of its own', () => {
      const ring = fixtureRing();
      const w2 = windowFor(ring.view, 400, 800);
      setCamera({ mode: 'offset', speedDegPerS: 12, offsetM: 200 });
      const { parent, canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: ringBackdrop(ring) })!;
      const at = T0 + 7_500; // 90 degrees round its circle at 12 degrees a second, at the offset 98.2 the mode clamps to
      const tf = (ms: number, phi: number, offset: number) => {
        const p = cardPose(ring, 0, headingAt(at + ms), phi, offset, w2);
        return { text: `translate3d(${p.shiftPx}px,0,0) scale(${p.scale})`, scale: p.scale };
      };
      expect(phiAt(at)).toBeCloseTo(90, 6);
      const seen = tf(0, phiAt(at), 98.2);
      vi.mocked(performance.now).mockReturnValue(at);
      setCamera({ mode: 'both' }, at); // phi goes to 0 and the clamp releases to 200: both used to land in one frame
      const run = live(rigOf(parent).children[2])[0];
      expect(run.keyframes[0].transform).toBe(seen.text);
      const spent = EASE_MS / (SEGMENT_S * 1000);
      const end = run.keyframes.find((f: any) => f.offset >= spent - 1e-9);
      const there = tf(EASE_MS, 0, 200);
      expect(end.transform).toBe(there.text);
      const eased = run.keyframes.filter((f: any) => f.offset <= spent + 1e-9);
      expect(eased.length).toBeGreaterThan(10); // keyed finely while it runs
      const scale = (f: any) => parseFloat(/scale\(([^)]*)\)/.exec(f.transform)![1]);
      const jump = Math.abs(there.scale - seen.scale);
      expect(jump).toBeGreaterThan(0.05); // the pop this pick used to be
      eased.slice(1).forEach((f: any, i: number) => expect(Math.abs(scale(f) - scale(eased[i]))).toBeLessThan(jump / 4));
      expect(run.keyframes.at(-1).offset).toBe(1);
      s.dispose();
    });

    describe('the ease of a mode pick stays inside the fit of the card slide', () => {
      // The baked Vienna: its distances and its two bounds, as shipped.
      const root = join(process.cwd(), 'public', 'ridge');
      const dir = parseIndex(JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'))).places.vienna;
      const vienna = parseManifest(JSON.parse(readFileSync(join(root, dir, 'manifest.json'), 'utf8')), `${dir}/`);
      const FIT_PX_MAX = 24; // scripts/ridge-bake/export.py
      /** The baker's `fit_px` (export.py): the worst error, in card px, of a card at distance `d` metres seen from offset `r` at camera angle `phiDeg`, against its least-squares line over the widest field. */
      const fitPx = (d: number, r: number, phiDeg: number): number => {
        const n = 33;
        const b = Array.from({ length: n }, (_, i) => ((-HFOV_MAX_DEG / 2 + (HFOV_MAX_DEG * i) / (n - 1)) * Math.PI) / 180);
        const phi = (phiDeg * Math.PI) / 180;
        const a = b.map((x) => Math.atan2(d * Math.sin(x) - r * Math.sin(phi), d * Math.cos(x) - r * Math.cos(phi)));
        const mean = (v: number[]) => v.reduce((x, y) => x + y, 0) / v.length;
        const bc = b.map((x) => x - mean(b));
        const s = a.reduce((acc, y, i) => acc + y * bc[i], 0) / bc.reduce((acc, y) => acc + y * y, 0);
        const am = mean(a);
        return (Math.max(...a.map((y, i) => Math.abs(y - (am + s * bc[i])))) * 180) / Math.PI * vienna.view.pxPerDegH;
      };
      const distances = vienna.tiles.flatMap((row) => row.flatMap((e) => (e ? [e.distanceM] : [])));
      /** The worst of every card of the bake at the camera angle `phiDeg` and offset `r`. */
      const worstPx = (r: number, phiDeg: number): number => Math.max(...distances.map((d) => fitPx(d, r, phiDeg)));
      const w2 = windowFor(vienna.view, 400, 800);
      /** The offset a keyframe's pose was made from: the one `cardPose` gives the transform at this heading and camera angle (a scan, then a finer one), with how far it is off. */
      const offsetOf = (transform: string, heading: number, phi: number): { r: number; miss: number } => {
        const m = /translate3d\((-?[\d.e+-]+)px,0,0\) scale\((-?[\d.e+-]+)\)/.exec(transform)!;
        const want = { shiftPx: Number(m[1]), scale: Number(m[2]) };
        const miss = (r: number) => {
          const p = cardPose(vienna, 0, heading, phi, r, w2);
          return Math.hypot(p.shiftPx - want.shiftPx, (p.scale - want.scale) * 400);
        };
        let best = { r: 0, miss: Infinity };
        for (const step of [0.5, 0.02, 0.001]) {
          const from = best.miss === Infinity ? -300 : best.r - 20 * step;
          const to = best.miss === Infinity ? 300 : best.r + 20 * step;
          for (let r = from; r <= to; r += step) {
            const e = miss(r);
            if (e < best.miss) best = { r, miss: e };
          }
        }
        return best;
      };
      /** Every (camera angle, offset) a stretch of keyframes poses card 0 from, recovered from the transforms, from the pick on. */
      const pairsOf = (box: any, at: number): { phi: number; r: number; ms: number; miss: number }[] => {
        const keys = live(box)[0].keyframes;
        return keys.map((f: any, n: number) => {
          const ms = (f.offset ?? n / (keys.length - 1)) * SEGMENT_S * 1000;
          const phi = shownPhiAt(at + ms);
          return { phi, ms, ...offsetOf(f.transform, headingAt(at + ms), phi) };
        });
      };
      const pick = (from: { mode: 'both' | 'offset'; speed: number; waitS: number }, to: 'both' | 'offset') => {
        setCamera({ mode: from.mode, speedDegPerS: from.speed, offsetM: 200 });
        const { parent, canvas } = host();
        const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: ringBackdrop(vienna) })!;
        const at = T0 + from.waitS * 1000;
        vi.mocked(performance.now).mockReturnValue(at);
        setCamera({ mode: to }, at);
        const got = pairsOf(rigOf(parent).children[2], at);
        s.dispose();
        return got;
      };

      it('measures the fit as the baker does: Vienna sits at the bound at its two offsets, and above it past them', () => {
        const { rMaxM, rMaxForwardM } = vienna.camera;
        expect([rMaxM, rMaxForwardM]).toEqual([98.2, 205.4]);
        expect(Math.max(...[0, 15, 30, 45, 90, 135, 180, 270].map((phi) => worstPx(rMaxM, phi)))).toBeGreaterThan(FIT_PX_MAX - 0.5);
        expect(Math.max(...[0, 15, 30, 45, 90, 135, 180, 270].map((phi) => worstPx(rMaxM, phi)))).toBeLessThanOrEqual(FIT_PX_MAX);
        expect(worstPx(rMaxForwardM, 0)).toBeGreaterThan(FIT_PX_MAX - 0.5);
        expect(worstPx(rMaxForwardM, 0)).toBeLessThanOrEqual(FIT_PX_MAX);
        expect(worstPx(200, 90)).toBeGreaterThan(FIT_PX_MAX); // the blend the ease used to pass through
      });

      [
        { name: 'offset-only to both from the camera a quarter round', from: { mode: 'offset', speed: 12, waitS: 7.5 }, to: 'both' },
        { name: 'offset-only to both with the camera half way round', from: { mode: 'offset', speed: 12, waitS: 15 }, to: 'both' },
        { name: 'offset-only to both with the camera just off its heading', from: { mode: 'offset', speed: 12, waitS: 1.25 }, to: 'both' },
        { name: 'both to offset-only at the default speed', from: { mode: 'both', speed: 0.6, waitS: 3 }, to: 'offset' },
        { name: 'both to offset-only at the fastest turn', from: { mode: 'both', speed: 12, waitS: 3 }, to: 'offset' },
      ].forEach(({ name, from, to }) => {
        it(`${name}: every keyframe is the pose of an angle and an offset inside the card fit, at Vienna's bounds`, () => {
          const got = pick(from as any, to as any);
          expect(got.length).toBeGreaterThan(12);
          got.forEach((g) => expect(g.miss, `a pose of the camera at ${g.phi.toFixed(1)} degrees, ${g.r.toFixed(1)} m`).toBeLessThan(0.05));
          const worst = Math.max(...got.map((g) => worstPx(g.r, g.phi)));
          expect(worst).toBeLessThanOrEqual(FIT_PX_MAX + 0.05);
          // The angle and the offset take a stage each: never both between their ends at once.
          const moving = (v: number[], i: number) => i > 0 && Math.abs(v[i] - v[i - 1]) > 1e-3;
          const phis = got.map((g) => g.phi);
          const rs = got.map((g) => g.r);
          got.forEach((_, i) => expect(moving(phis, i) && moving(rs, i), `keyframe ${i}`).toBe(false));
          const last = got.at(-1)!;
          expect(last.r).toBeCloseTo(to === 'both' ? 200 : vienna.camera.rMaxM, 1); // the offset owed: the default 200, or the bound of the circling mode
          if (to === 'both') expect(last.phi).toBe(0);
        });
      });
    });

    describe('under reduced motion there is no ease: the pose owed is the pose issued', () => {
      const owed = (ring: typeof manifest, offset: number, phi: number, at = T0) => {
        const p = cardPose(ring, 0, headingAt(at), phi, offset, windowFor(ring.view, 400, 800));
        return `translate3d(${p.shiftPx}px,0,0) scale(${p.scale})`;
      };

      it('lands on the offset the mode allows at the pick, each way, and the next pick starts from there', () => {
        const ring = fixtureRing();
        motion.matches = true;
        setCamera({ mode: 'both', speedDegPerS: 0.6, offsetM: 200 });
        const { parent, canvas } = host();
        const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: ringBackdrop(ring) })!;
        const box = () => rigOf(parent).children[2];
        expect(frame(box(), 0)).toBe(owed(ring, 200, 0));
        setCamera({ mode: 'offset' });
        expect(frame(box(), 0)).toBe(owed(ring, 98.2, 0)); // the clamp, at once: not the 200 m it showed
        setCamera({ mode: 'both' });
        expect(frame(box(), 0)).toBe(owed(ring, 200, 0)); // and back, not the 98.2 it was left at
        s.dispose();
      });

      it('lands on the camera angle the mode owes when the setting arrives with the camera turned away from its heading', () => {
        const ring = fixtureRing();
        setCamera({ mode: 'offset', speedDegPerS: 12, offsetM: 200 });
        const { parent, canvas } = host();
        const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: ringBackdrop(ring) })!;
        const at = T0 + 7_500; // a quarter round
        vi.mocked(performance.now).mockReturnValue(at);
        motion.matches = true;
        motion.addEventListener.mock.calls.filter((c: any) => c[0] === 'change').forEach((c: any) => c[1]());
        expect(phiAt(at)).toBeCloseTo(90, 6);
        setCamera({ mode: 'both' }, at);
        expect(phiAt(at + 10_000)).toBe(0);
        expect(frame(rigOf(parent).children[2], 0)).toBe(owed(ring, 200, 0, at));
        s.dispose();
      });
    });

    it('keeps the angles, the transforms and the tile positions bounded after days of uptime: the rig normalizes before each stretch', () => {
      const now = vi.mocked(performance.now);
      const { parent, canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: litCards() })!;
      const fiveDays = 5 * 86_400_000;
      now.mockReturnValue(T0 + fiveDays);
      setCamera({ offsetM: 20 }); // any change issues the next stretch from the clock now
      const h = headingAt(T0 + fiveDays);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360 + 1);
      expect(h).toBeCloseTo((214 + 0.6 * (fiveDays / 1000)) % 360, 4); // the view is where five days of turning put it
      const rig = rigOf(parent);
      const shifts = rig.children.flatMap((box: any) =>
        live(box)[0].keyframes.map((f: any) => Math.abs(Number(/translate3d\((-?[\d.e+-]+)px/.exec(f.transform)?.[1])))
      );
      expect(Math.max(...shifts)).toBeLessThan(100_000); // days of turning would be millions of px
      rig.children.forEach((box: any) =>
        box.children.forEach((c: any) => expect(Math.abs(parseFloat(c.style.left))).toBeLessThan(100_000))
      );
      expect(mountedIds(rig).length).toBeGreaterThan(0); // the tiles the heading shows are mounted, not lost in the wrap
      s.dispose();
    });
  });

  it('a still draws the tiles of the arc in the host canvas, farthest card first, each card at its pose about the rig’s origin, at the heading now', () => {
    const { parent, canvas } = host();
    createRidgeScene({ canvas, tier: 'still', sky: DAY, backdrop: litCards() });
    const drawn = images.filter((a) => (a[0] as any).id) as any[];
    expect(drawn.map((a) => a[0].id)).toEqual(['t2c1', 't2c0']);
    expect(drawn[0][0].id.endsWith('c1')).toBe(true);
    const dpr = 2;
    drawn.forEach((a) => {
      const card = Number(a[0].id.slice(-1));
      const p = cardPose(manifest, card, headingAt(T0), phiAt(T0), clampOffset(), win);
      expect(a.k).toBe(p.scale);
      expect(a.t).toEqual([(200 + p.shiftPx) * dpr, horizonY * dpr]);
      const e = manifest.tiles[2][card]!;
      const colDeg = 360 / view.ringW;
      expect([a[1], a[2], a[3], a[4]]).toEqual([
        (180 - colDeg - 214) * k * dpr,
        (e.top - view.horizonRow) * win.plane.scale * dpr,
        (view.tileW + 2) * win.plane.scale * dpr,
        e.h * win.plane.scale * dpr,
      ]);
      expect([a.alpha, a.op]).toEqual([1, 'source-over']);
    });
    expect(parent.children).toEqual([canvas]);
  });

  describe('a still whose tiles arrive after its paint', () => {
    /** A backdrop holding the tiles of `held`, and tiles that arrive afterwards: `arrive` holds one more and tells whoever listens, as the loader does. */
    const ring = parseManifest(wireManifest({}, 3, 32), '/d/'); // 32 tiles of 11.25 degrees: the rest view shows tiles 16 to 21
    const arriving = (held: number[]) => {
      const all = ring.tiles.flatMap((row, tile) =>
        row.flatMap((e, card) => {
          if (!e) return [];
          const canvas = fakeEl('canvas');
          canvas.id = `t${String(tile).padStart(2, '0')}c${card}`;
          canvas.width = 202;
          return [{ tile, card, canvas: canvas as unknown as HTMLCanvasElement }];
        })
      );
      const lit = all.filter((t) => held.includes(t.tile));
      const heard = new Set<() => void>();
      const bd = {
        manifest: ring,
        ensure: vi.fn(async (_arc: Arc): Promise<void> => undefined),
        litTiles: () => lit,
        onTile: (cb: () => void) => (heard.add(cb), () => void heard.delete(cb)),
        dispose: vi.fn(),
      };
      const arrive = (tile: number) => {
        lit.push(...all.filter((t) => t.tile === tile));
        heard.forEach((cb) => cb());
      };
      return { bd, arrive, listeners: () => heard.size };
    };
    const drawnTiles = () => new Set(images.filter((a) => (a[0] as any).id).map((a: any) => a[0].id.slice(0, 3)));
    const timers = () => {
      vi.useFakeTimers();
      (window as any).setTimeout = setTimeout;
      (window as any).clearTimeout = clearTimeout;
    };
    afterEach(() => {
      vi.useRealTimers();
    });

    it('repaints once for a burst of arrivals, with every tile held by then, asks for nothing, and is done when the tiles stop', () => {
      timers();
      const { bd, arrive } = arriving([18]);
      const { canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'still', sky: DAY, backdrop: bd })!;
      expect(drawnTiles()).toEqual(new Set(['t18']));
      const first = images.length;
      arrive(17);
      vi.advanceTimersByTime(100);
      arrive(19); // a burst: the wait starts again
      vi.advanceTimersByTime(200);
      expect(images.length).toBe(first); // not yet
      vi.advanceTimersByTime(60);
      expect(drawnTiles()).toEqual(new Set(['t18', 't17', 't19'])); // one paint, with all of them
      const second = images.length;
      expect(second).toBeGreaterThan(first);
      vi.advanceTimersByTime(600_000);
      expect(images.length).toBe(second); // no loop, no timer left
      expect(bd.ensure).not.toHaveBeenCalled();
      arrive(20);
      vi.advanceTimersByTime(300);
      expect(drawnTiles().has('t20')).toBe(true); // a straggler is drawn too
      s.dispose();
    });

    it('is the same after a settle from the live tier, and stops listening with the scene', () => {
      timers();
      const { bd, arrive, listeners } = arriving([18]);
      const { canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: bd })!;
      arrive(17);
      vi.advanceTimersByTime(1_000);
      expect(images.length).toBe(0); // the live tier mounts tiles from its own timer: nothing is painted into the host canvas
      runFrames(100, 400); // a poor frame rate: it settles to a still
      const settled = images.length;
      expect(drawnTiles()).toEqual(new Set(['t18', 't17']));
      arrive(19);
      vi.advanceTimersByTime(300);
      expect(images.length).toBeGreaterThan(settled);
      expect(drawnTiles().has('t19')).toBe(true);
      s.dispose();
      expect(listeners()).toBe(0);
      const after = images.length;
      arrive(20);
      vi.advanceTimersByTime(1_000);
      expect(images.length).toBe(after);
    });
  });

  it('settles to a still with the tiles painted when the frame rate is poor', () => {
    const { parent, canvas } = host();
    createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: litCards() });
    runFrames(100, 400);
    expect(images.filter((a) => (a[0] as any).id).length).toBeGreaterThan(0);
    expect(parent.children).toEqual([canvas]);
  });

  it('with no backdrop it is the sky alone', () => {
    const { parent, canvas } = host();
    createRidgeScene({ canvas, tier: 'full', sky: DAY });
    expect(parent.children).toEqual([canvas]);
    expect(images.filter((a) => (a[0] as any).id)).toHaveLength(0);
  });

  it('asks the host canvas, and every canvas it makes, only for 2d: the tiles arrive lit', () => {
    const { canvas } = host();
    const kinds: string[] = [];
    const ask = (el: any) => {
      const real = el.getContext;
      el.getContext = vi.fn((k: string) => (kinds.push(k), real(k)));
    };
    ask(canvas);
    const make = doc.createElement;
    doc.createElement = (t: string) => {
      const el = make(t);
      ask(el);
      return el;
    };
    const s = createRidgeScene({ canvas, tier: 'full', sky: night, backdrop: litCards() })!;
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((k) => k === '2d')).toBe(true);
    s.dispose();
  });
});

describe('the scene wiring', () => {
  it('sizes from the window when the canvas has no client size', () => {
    const { canvas } = host();
    canvas.clientWidth = 0;
    canvas.clientHeight = 0;
    (window as any).innerWidth = 300;
    (window as any).innerHeight = 500;
    createRidgeScene({ canvas, tier: 'full', sky: DAY })!.dispose();
    expect([canvas.width, canvas.height]).toEqual([600, 1000]);
  });

  it('a burst of resizes rebuilds once, after 250 ms, and not after dispose', async () => {
    vi.useFakeTimers();
    (window as any).setTimeout = setTimeout;
    const { canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY })!;
    const skies = () => draws.filter((d) => d === 'sky').length;
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(200);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(200);
    expect(skies()).toBe(1);
    vi.advanceTimersByTime(60);
    expect(skies()).toBe(2);
    s.dispose();
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(1000);
    expect(skies()).toBe(2);
    vi.useRealTimers();
  });
});
