import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRidgeScene } from './Ridge';
import { valueNoise, hash2 } from './noise';
import { FrameSampler, frameStats, SLOW_P95_MS, WARMUP_FRAMES, WINDOW_MS } from './probe';
import type { SkyColours } from './skyColour';
import { makeStars } from './stars';
import { makePhysicalSky } from './physicalSky';
import { startBackgroundScene } from '../index';

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
function ctx() {
  const c: any = {
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    fillRect() {
      draws.push('sky');
    },
    save() {},
    restore() {},
    rect() {},
    clip() {},
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData() {},
    beginPath() {},
    moveTo() {},
    stroke() {},
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
    drawImage() {},
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
  const night = {
    ...DAY,
    top: [10, 14, 40],
    mid: [30, 34, 80],
    horizon: [60, 50, 90],
  } as SkyColours;
  const N = makeStars(night, 400, 800).length;
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
    expect(count('sky')).toBe(1);
    expect(parent.children[1].anims).toHaveLength(0); // the overlay, above the sky
    expect(parent.children).toHaveLength(2);
    const before = baked();
    runFrames(16.7, 300); // 5 s at 60 fps; the overlay repaints at 20 fps
    expect(baked()).toBe(before);
    expect(count('clear')).toBeGreaterThan(60);
    expect(count('clear')).toBeLessThanOrEqual(101);
    // each pass paints at most SLOTS stars
    expect(count('twinkle')).toBeLessThanOrEqual(count('clear') * 32);
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
    physical: makePhysicalSky('day', new Date('2026-06-21T10:40:00Z'), w),
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
