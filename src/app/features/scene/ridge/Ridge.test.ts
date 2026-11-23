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
import { plateCamera, plateSize } from './skyTurn';
import { ringAzimuth, sunColumns, sunInColumn } from './lightCards';
import { norm, residentTiles } from './ring';
import { anchor, hold, poseAt, resetHeading, settledAt, STAGE_MS } from './heading';
import { effectiveMode, getCamera, isHeld, resetCamera, setCamera } from '../cameraState';

/** The two stages of the ease of a mode pick (the angle, then the offset, or the other way round). */
const EASE_MS = 2 * STAGE_MS;
/** A card's pose as the heading owner has the view at `t`: what the rig lays the card out from. */
const posed = (m: Parameters<typeof cardPose>[0], card: number, t: number, w: Parameters<typeof cardPose>[5]) => {
  const p = poseAt(t);
  return cardPose(m, card, p.h, p.phi, p.r, w);
};

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
    insertBefore(c: any, before: any) {
      c.parentElement = this;
      this.children.splice(this.children.indexOf(before), 0, c);
      return c;
    },
    animate: vi.fn((keyframes: any[], options: any) => {
      const a: any = {
        currentTime: 0,
        /** The clock it was issued at (the mocked `performance.now`). */
        at: performance.now(),
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
/** Where each sun disc (its gradient's centre) and each body (an arc) was drawn into a sky canvas, in that canvas's device px, in paint order. */
const suns: number[][] = [];
const arcs: number[][] = [];
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
    createRadialGradient: (x: number, y: number) => {
      suns.push([x, y]);
      return { addColorStop: vi.fn() };
    },
    lineTo() {},
    closePath() {},
    // Stars: arc+fill is one draw. A context that has cleared a rect is the twinkle overlay's.
    clearRect() {
      c.overlay = true;
      draws.push('clear');
    },
    arc(x: number, y: number) {
      draws.push(c.overlay ? 'twinkle' : 'star');
      if (!c.overlay) arcs.push([x, y]);
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
  suns.length = 0;
  arcs.length = 0;
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
    // a live sky is a plate about the heading, which with no ridge is the View's rest azimuth
    const win = windowFor(ELSEWHERE_VIEW, 400, 800);
    const want = paintPhysicalSky(physical, plateSize(win, 400, 800, 2).cssW, 800, plateCamera(win, ELSEWHERE_VIEW.lookAzDeg));
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
  const view400 = windowFor(FALLBACK_VIEW, 400, 800);
  /** The stars of a still, painted through the viewport's own camera, and of a live plate, painted through the viewport's plus the slack each side. */
  const N = nightBodies(physical, paintPhysicalSky(physical, 400, 800, view400.camera), false).stars.length;
  const NPLATE = nightBodies(
    physical,
    paintPhysicalSky(physical, plateSize(view400, 400, 800, 2).cssW, 800, plateCamera(view400, FALLBACK_VIEW.lookAzDeg)),
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
    expect(count('star')).toBe(NPLATE);
    expect(painted).toHaveLength(1); // the physical sky's one grid
    const plate = parent.children[1]; // one element over the host canvas: the sky and, above it, the twinkle canvas
    expect(plate.children.map((c: any) => c.tag)).toEqual(['canvas', 'canvas']);
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
    expect(count('star')).toBe(NPLATE + N); // the plate's, then the still's own in the host canvas
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
  const rainEls = (parent: any) => parent.children.filter((c: any) => c.tag === 'div' && c.style.backgroundImage);

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

  it('keeps the live sky, with every body baked into it, and the twinkle canvas in one plate under the rig; the host canvas is not painted', () => {
    const { parent, canvas } = host();
    createRidgeScene({ canvas, tier: 'full', sky: { ...night }, backdrop: litCards(), lines: true });
    const rig = rigOf(parent);
    const plate = parent.children.find((c: any) => c.children.some((g: any) => g.tag === 'canvas'));
    expect(plate.children.map((c: any) => c.tag)).toEqual(['canvas', 'canvas']); // the sky, then the twinkle canvas over it
    expect(parent.children.indexOf(rig)).toBeGreaterThan(parent.children.indexOf(plate));
    expect(draws.filter((d) => d === 'image')).toHaveLength(1); // only the plate's sky upscale: nothing in the host canvas, the cards are DOM above the plate
    expect(live(plate)).toHaveLength(1); // one animation slides it
  });

  it('stacks the rig after the twinkle canvas and before the rain, with no z-index and no fixed position, and disposes the backdrop with itself', () => {
    const { parent, canvas } = host();
    const bd = litCards();
    const s = createRidgeScene({ canvas, tier: 'full', sky: night, backdrop: bd })!;
    const kinds = parent.children.map((c: any) => c.tag);
    expect(kinds).toEqual(['canvas', 'div', 'div', 'div', 'div']); // the host canvas, the sky plate, the rig, the rain
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
        posed(manifest, card, t, win);
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

  describe('the sky turns with the heading', () => {
    const W = 400;
    const SUN_ABOVE_REST = 5; // the sun stands this many degrees clockwise of the rest azimuth, 15 degrees up
    const sunSky = (): SkyColours => ({
      ...DAY,
      physical: makePhysicalSky({ azimuth: view.lookAzDeg + SUN_ABOVE_REST, elevation: 15, time: new Date('2026-06-21T10:40:00Z') }, 0, view),
    });
    const nightSky = (): SkyColours => ({
      ...DAY,
      physical: makePhysicalSky(sunOfBand(view.place, 'night', new Date('2026-12-04T00:00:00Z')), 0, view),
    });
    const px = (v: string) => parseFloat(v);
    const plateOf = (parent: any) => parent.children.find((c: any) => c.children.some((g: any) => g.tag === 'canvas'));
    /** The plate's pan (px) at the clock `t`, read from its running animation: its keyframes are a second apart. */
    const panAt = (plate: any, t: number): number => {
      const a = live(plate)[0];
      const at = (n: number) => px(/translate3d\((-?[\d.e+-]+)px/.exec(a.keyframes[n].transform)![1]);
      const s = Math.max(0, (t - a.at) / 1000);
      const i = Math.min(Math.floor(s), a.keyframes.length - 2);
      return at(i) * (1 - (s - i)) + at(i + 1) * (s - i);
    };
    /** Where a point drawn at `x` device px of the plate's sky canvas is on the viewport at `t`, CSS px from its left edge. */
    const onViewport = (plate: any, x: number, t: number): number => {
      const ratio = plate.children[0].width / px(plate.style.width);
      return px(plate.style.left) + x / ratio + panAt(plate, t);
    };
    const ticking = () => {
      vi.useFakeTimers();
      (window as any).setTimeout = setTimeout;
      (window as any).clearTimeout = clearTimeout;
    };

    it('paints the plate about the heading the view has, not the rest azimuth, and holds it still there', () => {
      hold(100, T0);
      const { parent, canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'full', sky: sunSky(), backdrop: litCards() })!;
      const sky = sunSky().physical!;
      const wn = windowFor(view, W, 800);
      const want = paintPhysicalSky(sky, plateSize(wn, W, 800, 2).cssW, 800, plateCamera(wn, 100));
      expect(Array.from(painted[0])).toEqual(Array.from(want.data));
      expect(painted).toHaveLength(1); // the host canvas has none: the plate is the sky
      const plate = plateOf(parent);
      expect(px(plate.style.left)).toBeCloseTo((W - plateSize(wn, W, 800, 2).cssW) / 2, 9); // centred on the viewport
      expect(panAt(plate, T0)).toBeCloseTo(0, 9);
      s.dispose();
    });

    it('moves the sun and a catalogue star by exactly the turn times the px per degree between a plate centred on h and one centred on h + delta', () => {
      const first = host();
      const a = createRidgeScene({ canvas: first.canvas, tier: 'full', sky: sunSky(), backdrop: litCards() })!;
      const sunA = [...suns[0]];
      const plateA = plateOf(first.parent);
      const xA = onViewport(plateA, sunA[0], T0);
      expect(xA).toBeCloseTo(W / 2 + SUN_ABOVE_REST * k, 0); // the sun at its true azimuth against the heading
      a.dispose();
      suns.length = 0;
      hold(view.lookAzDeg + 10, T0);
      const second = host();
      const b = createRidgeScene({ canvas: second.canvas, tier: 'full', sky: sunSky(), backdrop: litCards() })!;
      const xB = onViewport(plateOf(second.parent), suns[0][0], T0);
      expect(xA - xB).toBeCloseTo(10 * k, 0);
      expect(suns[0][1]).toBe(sunA[1]); // the sun does not climb: only the azimuth turns
      b.dispose();

    });

    it('moves a catalogue star by exactly the turn times the px per degree too, and the stars that stay in sight are the same ones', () => {
      const starsAt = (heading: number) => {
        resetHeading();
        anchor(view.place.id, heading, T0);
        arcs.length = 0;
        const h = host();
        createRidgeScene({ canvas: h.canvas, tier: 'full', sky: nightSky(), backdrop: litCards() })!.dispose();
        return arcs.map((p) => [p[0], p[1]]);
      };
      const plateX = (device: number) => {
        const wn = windowFor(view, W, 800);
        const size = plateSize(wn, W, 800, 2);
        return (device / Math.floor(size.cssW * size.ratio)) * size.cssW + (W - size.cssW) / 2;
      };
      const here = starsAt(view.lookAzDeg).map(([x, y]) => [plateX(x), y]);
      const turned = starsAt(view.lookAzDeg + 10).map(([x, y]) => [plateX(x), y]);
      const inSight = here.filter(([x]) => x - 10 * k > 0 && x - 10 * k < W && x > 0 && x < W);
      expect(inSight.length).toBeGreaterThan(3);
      inSight.forEach(([x, y]) => {
        // pan 0 in both: the viewport position is the plate's, and it moved left by ten degrees of pixels
        const found = turned.find(([tx, ty]) => ty === y && Math.abs(tx - (x - 10 * k)) < 0.75);
        expect(found).toBeDefined();
      });
    });

    it('keeps the sun and every star where the view faces them across a re-centre: the old plate goes, a new one stands in its place, the sun moves by less than a pixel', () => {
      ticking();
      const now = vi.mocked(performance.now);
      setCamera({ speedDegPerS: 4 }); // the view turns 4 degrees a second: the plate runs to 14 degrees off its centre in 3.5 s
      const { parent, canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'full', sky: sunSky(), backdrop: litCards() })!;
      const first = plateOf(parent);
      const kinds = parent.children.map((c: any) => c.tag);
      const seen = new Set<any>([first]);
      let last = onViewport(first, suns[suns.length - 1][0], T0);
      for (let ms = 500; ms <= 9_000; ms += 500) {
        now.mockReturnValue(T0 + ms);
        vi.advanceTimersByTime(500);
        const plate = plateOf(parent);
        seen.add(plate);
        const x = onViewport(plate, suns[suns.length - 1][0], T0 + ms);
        const want = W / 2 + (view.lookAzDeg + SUN_ABOVE_REST - poseAt(T0 + ms).h) * k; // the sun's true place on the viewport
        expect(Math.abs(x - want)).toBeLessThan(1);
        expect(Math.abs(x - last + 4 * 0.5 * k)).toBeLessThan(1); // it moved only as the view turned (half a second of it)
        last = x;
        expect(parent.children.map((c: any) => c.tag)).toEqual(kinds); // the plate is replaced in its place: nothing stacks up
      }
      expect(seen.size).toBe(3); // 36 degrees of turn: replaced at 16 and at 32 degrees
      expect([...seen].filter((p) => p.parentElement).length).toBe(1);
      expect(live(plateOf(parent))).toHaveLength(1);
      s.dispose();
      expect(parent.children).toEqual([canvas]);
      vi.useRealTimers();
    });

    it('does not repaint a plate for a view that stays or turns within its slack', () => {
      ticking();
      const now = vi.mocked(performance.now);
      const { parent, canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'full', sky: sunSky(), backdrop: litCards() })!; // 0.6 degrees a second
      const first = plateOf(parent);
      for (let ms = 500; ms <= 20_000; ms += 500) {
        now.mockReturnValue(T0 + ms);
        vi.advanceTimersByTime(500);
      }
      expect(plateOf(parent)).toBe(first); // 12 degrees of turn: inside the 14
      expect(painted).toHaveLength(1);
      s.dispose();
      vi.useRealTimers();
    });

    it('re-centres on a reissue too: a turn by hand past the edge paints a plate about where the view now faces', () => {
      ticking();
      const { parent, canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'full', sky: sunSky(), backdrop: litCards() })!;
      const first = plateOf(parent);
      hold(view.lookAzDeg + 60, T0);
      const plate = plateOf(parent);
      expect(plate).not.toBe(first);
      expect(panAt(plate, T0)).toBeCloseTo(0, 6);
      expect(live(plate)).toHaveLength(1);
      s.dispose();
      vi.useRealTimers();
    });

    it('puts the twinkle canvas in the plate, over the sky, and nothing animates but the plate', () => {
      const { parent, canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'full', sky: nightSky(), backdrop: litCards() })!;
      const plate = plateOf(parent);
      expect(plate.children.map((c: any) => c.tag)).toEqual(['canvas', 'canvas']);
      expect([plate.children[1].width, plate.children[1].height]).toEqual([plate.children[0].width, plate.children[0].height]);
      plate.children.forEach((c: any) => expect(c.anims).toHaveLength(0)); // they ride the plate
      expect(parent.children.filter((c: any) => c.tag === 'canvas')).toEqual([canvas]); // no twinkle canvas of the page's own
      s.dispose();
    });

    it('paints a plate that stays under the pixel cap and pans by the same px per degree as the cards', () => {
      const { parent, canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'full', sky: sunSky(), backdrop: litCards() })!;
      const plate = plateOf(parent);
      expect(plate.children[0].width * plate.children[0].height).toBeLessThanOrEqual(3_000_000);
      expect(px(plate.style.width) / (win.camera.hfovDeg + 40)).toBeCloseTo(k, 9);
      hold(view.lookAzDeg + 10, T0); // a turn by hand inside the slack: the same plate slides ten degrees of pixels
      expect(panAt(plateOf(parent), T0)).toBeCloseTo(-10 * k, 6);
      s.dispose();
    });

    it('shows the sun at the azimuth the ridge is lit from: facing it the sky puts it on the centre column and the ridge faces it; facing away it is off the plate and the ridge is in shade', () => {
      const sun = { azimuth: view.lookAzDeg + 17, elevation: 12 };
      const lit = { ...DAY, physical: makePhysicalSky({ ...sun, time: new Date('2026-06-21T10:40:00Z') }, 0, view) };
      // The ridge's own: the column whose face looks at the sun is the one the lit table gives most to.
      const cols = sunColumns(view, sun);
      let best = 0;
      for (let c = 0; c < view.ringW; c += 1) if (cols[c * 4] > cols[best * 4]) best = c;
      expect(Math.abs(ringAzimuth(best, view.ringW) - sun.azimuth)).toBeLessThanOrEqual(360 / view.ringW);

      resetHeading();
      anchor(view.place.id, sun.azimuth, T0);
      const facing = host();
      createRidgeScene({ canvas: facing.canvas, tier: 'full', sky: lit, backdrop: litCards() })!.dispose();
      expect(suns).toHaveLength(1);
      const wn = windowFor(view, W, 800);
      const size = plateSize(wn, W, 800, 2);
      const centreCol = (suns[0][0] / Math.floor(size.cssW * size.ratio)) * size.cssW + (W - size.cssW) / 2;
      expect(Math.abs(centreCol - W / 2)).toBeLessThan(1); // the sky's sun is on the column the view centres, whose face the ridge lights fullest
      expect(sunInColumn(sun, sun.azimuth)[0]).toBeCloseTo(Math.cos((sun.elevation * Math.PI) / 180), 12);

      suns.length = 0;
      resetHeading();
      anchor(view.place.id, sun.azimuth + 180, T0);
      const away = host();
      createRidgeScene({ canvas: away.canvas, tier: 'full', sky: lit, backdrop: litCards() })!.dispose();
      expect(suns).toHaveLength(0); // the sun is behind the camera: no disc anywhere on the plate
      expect(sunInColumn(sun, sun.azimuth + 180)[0]).toBeLessThan(0); // and the ridge faces it away
    });
  });

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
        heading: poseAt(T0).h,
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
    expect(poseAt(T0 + 10_000).h).toBe(poseAt(T0).h); // nothing turns, whatever the viewer chose
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
    const p = posed(manifest, 0, T0 + 60_000, win);
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
      const at = poseAt(T0).h;
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(300); // the debounced rebuild: startRig runs again
      expect(effectiveMode()).toBe('still'); // held, and the chosen mode untouched
      expect(getCamera().mode).toBe('both');
      expect(poseAt(T0 + 60_000).h).toBe(at);
      rigOf(parent).children.forEach((box: any) => expect(frame(box, 30)).toBe(frame(box, 0)));
      s.dispose();
      // And a scene made afterwards, as a sky change makes one.
      const again = createRidgeScene({ canvas: host().canvas, tier: 'full', sky: night, backdrop: litCards() })!;
      expect(poseAt(T0 + 60_000).h).toBe(at);
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
      expect(poseAt(T0 + 10_000).h).toBeCloseTo(106, 9);
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
      let from = Infinity;
      let to = -Infinity;
      let endFrom = Infinity;
      let endTo = -Infinity;
      for (let ms = 0; ms <= 30_000; ms += 100) {
        for (let i = 0; i < 3; i += 1) {
          const a = cardArc(ring.view, w2, 400, posed(ring, i, T0 + ms, w2));
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
      const now = [0, 1, 2].map((i) => cardArc(ring.view, w2, 400, posed(ring, i, T0, w2)));
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
        resetHeading(); // a page of its own for each mode: the view starts where the choice puts it
        anchor(view.place.id, view.lookAzDeg, T0);
        setCamera({ mode, speedDegPerS: 0.6, offsetM: 200 });
        const { parent, canvas } = host();
        const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: ringBackdrop(ring) })!;
        const got = frame(rigOf(parent).children[2], 0);
        s.dispose();
        return got;
      };
      const posed = (offset: number) => {
        const p = cardPose(ring, 0, poseAt(T0).h, poseAt(T0).phi, offset, w2);
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
      expect(poseAt(T0 + 10_000).h - poseAt(T0).h).toBeCloseTo(10 * slow, 9);
      setCamera({ speedDegPerS: -50 });
      expect(getCamera().speedDegPerS).toBe(-50);
      expect(poseAt(T0 + 10_000).h - poseAt(T0).h).toBeCloseTo(-10 * slow, 9);
      setCamera({ mode: 'offset', speedDegPerS: 11 }); // the offset-only mode sweeps the circle the gate counts, whatever the speed
      expect(poseAt(T0 + 20_000).phi - poseAt(T0 + 10_000).phi).toBeCloseTo(110, 9);
      setCamera({ mode: 'both' });
      expect(getCamera().speedDegPerS).toBe(11); // still the viewer's value
      expect(poseAt(T0 + 10_000).h - poseAt(T0).h).toBeCloseTo(10 * slow, 9);
      s.dispose();
    });

    it('derives the offset clamp at read and never writes it back: offset-only to a forward mode restores 200 m', () => {
      const ring = fixtureRing();
      const w2 = windowFor(ring.view, 400, 800);
      setCamera({ mode: 'offset', speedDegPerS: 0.6, offsetM: 200 });
      const { parent, canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: ringBackdrop(ring) })!;
      const posed = (offset: number) => {
        const p = cardPose(ring, 0, poseAt(T0).h, poseAt(T0).phi, offset, w2);
        return `translate3d(${p.shiftPx}px,0,0) scale(${p.scale})`;
      };
      expect(frame(rigOf(parent).children[2], 0)).toBe(posed(98.2));
      expect(getCamera().offsetM).toBe(200);
      setCamera({ mode: 'both' });
      expect(getCamera().offsetM).toBe(200);
      const keys = live(rigOf(parent).children[2])[0].keyframes;
      expect(keys[0].transform).toBe(posed(98.2)); // the view leaves from the offset it showed (the pick does not move it) ...
      const p = cardPose(ring, 0, poseAt(T0 + STAGE_MS).h, 0, 200, w2);
      expect(keys.find((f: any) => f.offset >= STAGE_MS / (SEGMENT_S * 1000) - 1e-9).transform).toBe(`translate3d(${p.shiftPx}px,0,0) scale(${p.scale})`); // ... and is at 200 when the ease is spent
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
        const p = cardPose(ring, 0, poseAt(at + ms).h, phi, offset, w2);
        return { text: `translate3d(${p.shiftPx}px,0,0) scale(${p.scale})`, scale: p.scale };
      };
      expect(poseAt(at).phi).toBeCloseTo(90, 6);
      const seen = tf(0, poseAt(at).phi, 98.2);
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
      /** The baker's `fit_px` (export.py): the worst error, in card px, of a card at distance `d` metres seen from offset `r` at camera angle `phiDeg`, against its best line over the widest field, the continuous error (the line by the trapezoid rule on 1025 samples, the error on the same). */
      const fitPx = (d: number, r: number, phiDeg: number, n = 1025): number => {
        const phi = (phiDeg * Math.PI) / 180;
        const half = (HFOV_MAX_DEG * Math.PI) / 360;
        const b = Array.from({ length: n }, (_, i) => -half + (2 * half * i) / (n - 1));
        const a = b.map((x) => Math.atan2(d * Math.sin(x) - r * Math.sin(phi), d * Math.cos(x) - r * Math.cos(phi)));
        const w = (i: number) => (i === 0 || i === n - 1 ? 0.5 : 1);
        let sw = 0;
        let sa = 0;
        let sab = 0;
        let sbb = 0;
        a.forEach((y, i) => {
          sw += w(i);
          sa += w(i) * y;
          sab += w(i) * y * b[i];
          sbb += w(i) * b[i] * b[i];
        });
        const mean = sa / sw;
        const s = sab / sbb;
        return (Math.max(...a.map((y, i) => Math.abs(y - (mean + s * b[i])))) * 180) / Math.PI * vienna.view.pxPerDegH;
      };
      const distances = vienna.tiles.flatMap((row) => row.flatMap((e) => (e ? [e.distanceM] : [])));
      /** The worst of every card of the bake at the camera angle `phiDeg` and offset `r`. */
      const worstPx = (r: number, phiDeg: number): number => Math.max(...distances.map((d) => fitPx(d, r, phiDeg)));
      /** The same over the six nearest cards and 129 samples (the trapezoid rule is exact to a few thousandths of a pixel there): the nearest cards bind, and a property run asks it thousands of times. */
      const nearest = [...distances].sort((a, b) => a - b).slice(0, 6);
      const quickPx = (r: number, phiDeg: number): number => Math.max(...nearest.map((d) => fitPx(d, r, phiDeg, 129)));
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
          const phi = poseAt(at + ms).phi;
          return { phi, ms, ...offsetOf(f.transform, poseAt(at + ms).h, phi) };
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
        expect([rMaxM, rMaxForwardM]).toEqual([95.8, 198.4]);
        const circle = Array.from({ length: 24 }, (_, i) => i * 15);
        expect(Math.max(...circle.map((phi) => worstPx(rMaxM, phi)))).toBeGreaterThan(FIT_PX_MAX - 0.5);
        expect(Math.max(...circle.map((phi) => worstPx(rMaxM, phi)))).toBeLessThanOrEqual(FIT_PX_MAX + 0.05);
        expect(worstPx(rMaxForwardM, 0)).toBeGreaterThan(FIT_PX_MAX - 0.5);
        expect(worstPx(rMaxForwardM, 0)).toBeLessThanOrEqual(FIT_PX_MAX + 0.05);
        expect(worstPx(200, 90)).toBeGreaterThan(FIT_PX_MAX); // the blend the ease used to pass through
        expect(worstPx(rMaxForwardM + 1, 0)).toBeGreaterThan(FIT_PX_MAX); // past the forward bound, and the circle's bound is not the forward one
        expect(Math.max(...circle.map((phi) => worstPx(rMaxM + 1, phi)))).toBeGreaterThan(FIT_PX_MAX);
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
          expect(last.r).toBeCloseTo(to === 'both' ? Math.min(200, vienna.camera.rMaxForwardM) : vienna.camera.rMaxM, 1); // the offset owed: the default 200 or the forward bound, or the bound of the circling mode
          if (to === 'both') expect(last.phi % 360).toBe(0);
        });
      });

      /** A transform's two numbers. */
      const parsed = (transform: string): { shift: number; scale: number } => {
        const m = /translate3d\((-?[\d.e+-]+)px,0,0\) scale\((-?[\d.e+-]+)\)/.exec(transform)!;
        return { shift: Number(m[1]), scale: Number(m[2]) };
      };
      /** What the compositor shows `ms` into an animation: the keyframes' straight lines. */
      const playedAt = (anim: any, ms: number): { shift: number; scale: number } => {
        const keys: any[] = anim.keyframes;
        const at = (k: number) => (keys[k].offset ?? k / (keys.length - 1)) * anim.options.duration;
        let k = 1;
        while (k < keys.length - 1 && at(k) < ms) k += 1;
        const [a, b] = [parsed(keys[k - 1].transform), parsed(keys[k].transform)];
        const x = Math.min(1, Math.max(0, (ms - at(k - 1)) / (at(k) - at(k - 1))));
        return { shift: a.shift + (b.shift - a.shift) * x, scale: a.scale + (b.scale - a.scale) * x };
      };

      describe('a pick made while an ease is under way, and a rebuild in the middle of one', () => {
        const picks: { name: string; from: 'both' | 'offset'; waitS: number; then: ['still' | 'offset' | 'both', number][] }[] = [
          { name: 'offset-only to both, then to still a moment later', from: 'offset', waitS: 7.8, then: [['both', 0], ['still', 100]] },
          { name: 'offset-only to both, then back to offset-only', from: 'offset', waitS: 7.8, then: [['both', 0], ['offset', 100]] },
          { name: 'offset-only to both, to still, and to both again', from: 'offset', waitS: 7.8, then: [['both', 0], ['still', 100], ['both', 150]] },
          { name: 'offset-only to both, then offset-only as the angle lands', from: 'offset', waitS: 7.8, then: [['both', 0], ['offset', 295]] },
          { name: 'offset-only to both, then still with the offset on its way out', from: 'offset', waitS: 7.8, then: [['both', 0], ['still', 450]] },
          { name: 'both to offset-only, then to both before the offset is in', from: 'both', waitS: 3, then: [['offset', 0], ['both', 150]] },
          { name: 'both to offset-only, then to still, then to offset-only', from: 'both', waitS: 3, then: [['offset', 0], ['still', 100], ['offset', 120]] },
        ];
        picks.forEach(({ name, from, waitS, then }) => {
          it(`${name}: every keyframe the last pick lays out is the pose of an angle and an offset inside the card fit`, () => {
            setCamera({ mode: from, speedDegPerS: 12, offsetM: 200 });
            const { parent, canvas } = host();
            const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: ringBackdrop(vienna) })!;
            let at = T0 + waitS * 1000;
            for (const [mode, after] of then) {
              at += after;
              vi.mocked(performance.now).mockReturnValue(at);
              setCamera({ mode }, at);
            }
            const got = pairsOf(rigOf(parent).children[2], at);
            got.forEach((g) => expect(g.miss, `a pose of the camera at ${g.phi.toFixed(1)} degrees, ${g.r.toFixed(1)} m`).toBeLessThan(0.05));
            const worst = Math.max(...got.map((g) => worstPx(g.r, g.phi)));
            expect(worst).toBeLessThanOrEqual(FIT_PX_MAX + 0.05);
            s.dispose();
          });
        });

        it('a rebuild in the middle of an ease lands where the old scene was: the first frame of the new rig is the frame the old one showed', () => {
          pending();
          for (const gap of [100, 250, 400, 550]) {
            resetHeading();
            resetCamera();
            vi.mocked(performance.now).mockReturnValue(T0);
            anchor(vienna.view.place.id, vienna.view.lookAzDeg, T0);
            setCamera({ mode: 'offset', speedDegPerS: 12, offsetM: 200 });
            const { parent, canvas } = host();
            const s = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: ringBackdrop(vienna) })!;
            const at = T0 + 7_800;
            vi.mocked(performance.now).mockReturnValue(at);
            setCamera({ mode: 'both' }, at);
            const old = rigOf(parent).children.map((box: any) => live(box)[0]);
            vi.mocked(performance.now).mockReturnValue(at + gap);
            window.dispatchEvent(new Event('resize'));
            vi.advanceTimersByTime(300); // the debounced rebuild: a new rig at this clock
            const now = rigOf(parent).children.map((box: any) => live(box)[0]);
            now.forEach((a: any, i: number) => {
              expect(a).not.toBe(old[i]);
              const was = playedAt(old[i], gap);
              const is = parsed(a.keyframes[0].transform);
              expect(Math.abs(is.shift - was.shift), `card ${i} ${gap} ms into the ease`).toBeLessThan(2);
              expect(Math.abs(is.scale - was.scale), `card ${i} ${gap} ms into the ease`).toBeLessThan(0.01);
            });
            s.dispose();
          }
          vi.useRealTimers();
        });
      });

      describe('random sequences of picks, holds, speeds, offsets and rebuilds at random times', () => {
        /** A seeded generator (mulberry32): a failing sequence is the seed it prints. */
        const random = (seed: number) => () => {
          seed = (seed + 0x6d2b79f5) | 0;
          let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const modes = ['still', 'offset', 'both'] as const;
        const inside = ([lo, hi]: [number, number], v: number, slack = 1e-6) => v >= lo - slack && v <= hi + slack;

        /** Every pose a laid-out stretch passes through is one the baker's bound allows, at the offset it has: whenever the camera angle moves, the circle's bound holds at both ends; and the keyframes are the poses the heading owner has. */
        const checkLayout = (parent: any, label: string) => {
          const boxes = rigOf(parent).children as any[];
          boxes.forEach((box) => expect(live(box)).toHaveLength(1));
          // The rig lays every card out from the owner's pose at the clock of each keyframe.
          boxes.forEach((box) => {
            const card = Number(box.id.slice(-1));
            const { keyframes, options, at } = live(box)[0];
            keyframes.forEach((f: any, n: number) => {
              const t = at + (f.offset ?? n / (keyframes.length - 1)) * options.duration;
              const p = poseAt(t);
              const c = cardPose(vienna, card, p.h, p.phi, p.r, w2);
              expect(f.transform, `${label}: card ${card} keyframe ${n}`).toBe(`translate3d(${c.shiftPx}px,0,0) scale(${c.scale})`);
            });
          });
          // The pose itself, every 2 ms through the ease and every half second after.
          const t0: number = live(boxes[0])[0].at;
          const home = Math.max(t0, settledAt());
          const times: number[] = [];
          for (let t = t0; t <= home + 2; t += 2) times.push(t);
          for (let t = home; t <= t0 + SEGMENT_S * 1000; t += 500) times.push(t);
          let last = poseAt(times[0]);
          times.forEach((t, i) => {
            const p = poseAt(t);
            expect(inside(offsetRange(vienna, w2, 'both', p.phi), p.r), `${label}: phi ${p.phi}, r ${p.r} at +${t - t0} ms`).toBe(true);
            if (i && Math.abs(p.phi - last.phi) > 1e-9) {
              const circle = offsetRange(vienna, w2, 'offset');
              expect(inside(circle, p.r, 0.02) && inside(circle, last.r, 0.02), `${label}: the angle moves with r ${last.r} then ${p.r} at +${t - t0} ms`).toBe(true);
            }
            if (i % 40 === 0 || i === times.length - 1) expect(quickPx(p.r, p.phi), `${label}: fit at phi ${p.phi}, r ${p.r}`).toBeLessThanOrEqual(FIT_PX_MAX + 0.1);
            last = p;
          });
        };

        let inEase = 0;
        const sequence = (seed: number): number => {
          const next = random(seed);
          const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
          resetHeading();
          resetCamera();
          const clock = vi.mocked(performance.now);
          let now = T0;
          clock.mockReturnValue(now);
          anchor(vienna.view.place.id, vienna.view.lookAzDeg, T0);
          setCamera({ mode: pick(modes), speedDegPerS: pick([0.6, 3, 12, -12, 0]), offsetM: pick([200, 98, -60, 0, 999]) }, now);
          let { parent, canvas } = host();
          let scene = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: ringBackdrop(vienna) })!;
          let rebuilds = 0;
          for (let step = 0; step < 36; step += 1) {
            const gap = pick([0, 20, 60, 100, 150, 299, 301, 450, 700, 3000, 24_500]);
            now += gap;
            clock.mockReturnValue(now);
            vi.advanceTimersByTime(gap);
            const label = `seed ${seed} step ${step}`;
            const op = Math.floor(next() * 9);
            const before = poseAt(now);
            const fine = now <= settledAt(); // the old stretch is keyed every 50 ms here, a second apart after: the straight lines between keyframes are the pose only where they are close
            const old = rigOf(parent).children.map((box: any) => live(box)[0]);
            if (op <= 2) setCamera({ mode: pick(modes) }, now);
            else if (op === 3) hold(next() * 1000 - 300, now);
            else if (op === 4) setCamera({ speedDegPerS: pick([0.6, 3, 12, -12, 0, 7.5]) }, now);
            else if (op === 5) setCamera({ offsetM: Math.round(next() * 600 - 300) }, now);
            else if (op === 6) setCamera({ mode: pick(modes), speedDegPerS: pick([0.6, 12, -12]), offsetM: pick([200, 0, 50]) }, now);
            else if (op === 7) {
              window.dispatchEvent(new Event('resize'));
              vi.advanceTimersByTime(300);
            } else {
              scene.dispose();
              ({ parent, canvas } = host());
              scene = createRidgeScene({ canvas, tier: 'full', sky: DAY, backdrop: ringBackdrop(vienna) })!;
            }
            if (op >= 7) {
              rebuilds += 1;
              if (fine) inEase += 1;
              // A rebuild changes where nothing is: the owner's pose is the same before and after it, and the first frame laid out is the frame that was showing.
              const after = poseAt(now);
              expect(after.r, label).toBeCloseTo(before.r, 9);
              expect(norm(after.phi), label).toBeCloseTo(norm(before.phi), 6);
              expect(norm(after.h), label).toBeCloseTo(norm(before.h), 6);
              rigOf(parent).children.forEach((box: any, i: number) => {
                if (!fine) return;
                const was = playedAt(old[i], now - old[i].at);
                const is = parsed(live(box)[0].keyframes[0].transform);
                // The new stretch is laid out from angles brought into [0, 360): a whole turn of the heading is a whole turn of the shift, the same picture.
                const turn = is.scale * w2.plane.scale * vienna.view.pxPerDegH * 360;
                const jump = Math.abs(is.shift - was.shift);
                expect(Math.abs(jump - turn * Math.round(jump / turn)), `${label}: card ${i} popped at the rebuild`).toBeLessThan(3);
                expect(Math.abs(is.scale - was.scale), `${label}: card ${i} popped at the rebuild`).toBeLessThan(0.02);
              });
            }
            checkLayout(parent, label);
          }
          scene.dispose();
          return rebuilds;
        };

        it('every pose laid out is inside the bound the baker set, and a rebuild never moves the view', () => {
          pending();
          let rebuilds = 0;
          for (let seed = 1; seed <= 24; seed += 1) rebuilds += sequence(seed);
          expect(rebuilds).toBeGreaterThan(100);
          expect(inEase).toBeGreaterThan(10); // and some of them in the middle of eases, not only at rest
          vi.useRealTimers();
        }, 120_000);
      });
    });

    describe('under reduced motion there is no ease: the pose owed is the pose issued', () => {
      const owed = (ring: typeof manifest, offset: number, phi: number, at = T0) => {
        const p = cardPose(ring, 0, poseAt(at).h, phi, offset, windowFor(ring.view, 400, 800));
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
        expect(poseAt(at).phi).toBeCloseTo(90, 6);
        setCamera({ mode: 'both' }, at);
        expect(poseAt(at + 10_000).phi).toBe(0);
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
      const h = poseAt(T0 + fiveDays).h;
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
      const p = posed(manifest, card, T0, win);
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

    it('a still shows one pose: a tile that arrives half a minute late is drawn at the pose of the first paint, and a resize takes the pose of its own clock', () => {
      timers();
      const { bd, arrive } = arriving([18]);
      const { canvas } = host();
      const s = createRidgeScene({ canvas, tier: 'still', sky: DAY, backdrop: bd })!;
      const placed = (id: string) => images.filter((a) => (a[0] as any).id?.startsWith(id)).map((a: any) => [a.t, a[1], a[2], a[3], a[4], a.k]);
      const first = placed('t18');
      expect(first.length).toBeGreaterThan(0);
      images.length = 0;
      vi.spyOn(performance, 'now').mockReturnValue(T0 + 30_000); // the clock has turned the heading 18 degrees on
      arrive(17);
      vi.advanceTimersByTime(300);
      expect(drawnTiles()).toEqual(new Set(['t18', 't17'])); // the tile chosen for the first pose is on the canvas
      expect(placed('t18')).toEqual(first); // and the old ones have not moved
      expect(bd.ensure).not.toHaveBeenCalled();
      images.length = 0;
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(300);
      expect(bd.ensure).toHaveBeenCalledTimes(1); // a new view: the tiles of the pose it takes
      const arc = bd.ensure.mock.calls[0][0];
      expect((arc.fromDeg + arc.toDeg) / 2).toBeCloseTo(poseAt(T0 + 30_000).h, 6);
      expect(placed('t18')).not.toEqual(first);
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
