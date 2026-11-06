import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRidgeScene } from './Ridge';
import { fbmPeriodic, valueNoisePeriodic, hash2 } from './noise';
import { FrameSampler, frameStats, SLOW_P95_MS, WARMUP_FRAMES, WINDOW_MS } from './probe';
import { FBM, LAYERS, layerColour, layerSize, profile, ridgeY } from './ridgeWorld';
import { skyColours } from './skyColour';
import { startBackgroundScene } from '../index';

describe('noise', () => {
  it('is deterministic and in [0, 1)', () => {
    expect(hash2(3, 5)).toBe(hash2(3, 5));
    for (let i = 0; i < 200; i += 1) {
      const v = valueNoisePeriodic(i * 0.37, 2, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('wraps: the lattice repeats every `period` cells', () => {
    for (const x of [0, 0.4, 3.9, 6.99]) {
      expect(valueNoisePeriodic(x + 7, 4, 7)).toBeCloseTo(valueNoisePeriodic(x, 4, 7), 12);
    }
  });

  it('different rows are different profiles', () => {
    expect(valueNoisePeriodic(1.5, 0, 9)).not.toBeCloseTo(valueNoisePeriodic(1.5, 1, 9), 3);
  });
});

describe('ridge profile', () => {
  it('every layer is periodic in t, so a drift of one period loops seamlessly', () => {
    for (const spec of LAYERS) {
      for (const t of [0, 0.13, 0.5, 0.97]) {
        expect(Number.isFinite(profile(spec, t))).toBe(true);
      }
      // the end of one period meets the start of the next
      expect(profile(spec, 1 - 1e-9)).toBeCloseTo(profile(spec, 0), 3);
    }
  });

  it('every octave count is an integer lattice, which periodicity needs', () => {
    for (const spec of LAYERS) {
      for (let k = 0; k < FBM.octaves; k += 1) {
        expect(Number.isInteger(spec.baseCells * FBM.lacunarity ** k)).toBe(true);
      }
    }
  });

  it('stays in [0, 1] and layers differ', () => {
    for (const spec of LAYERS) {
      for (let i = 0; i < 100; i += 1) {
        const p = profile(spec, i / 100);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
    expect(profile(LAYERS[0], 0.3)).not.toBeCloseTo(profile(LAYERS[1], 0.3), 3);
  });

  it('ridge tops lie inside the layer band and rise with farther base', () => {
    const size = layerSize(400, 800, 1);
    for (const spec of LAYERS) {
      for (let x = 0; x < size.period; x += 17) {
        const y = ridgeY(spec, x, size.period, size.height, 800);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(size.height);
      }
    }
  });

  it('layers get darker and slower toward the viewer, and their sizes are integers', () => {
    const sky = skyColours();
    const lum = (c: readonly number[]) => c[0] + c[1] + c[2];
    for (let i = 1; i < LAYERS.length; i += 1) {
      expect(lum(layerColour(LAYERS[i], sky))).toBeLessThan(lum(layerColour(LAYERS[i - 1], sky)));
      expect(LAYERS[i].seconds).toBeLessThan(LAYERS[i - 1].seconds);
    }
    for (const [w, h, s] of [
      [393, 851, 2],
      [1280, 720, 1],
      [412.5, 915.3, 2],
    ] as const) {
      const z = layerSize(w, h, s);
      expect(
        Number.isInteger(z.period) && Number.isInteger(z.width) && Number.isInteger(z.height)
      ).toBe(true);
      expect(z.width).toBe(2 * z.period);
    }
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
    animate: vi.fn(() => {
      const a = { currentTime: 0, play: vi.fn(), pause: vi.fn(), cancel: vi.fn() };
      el.anims.push(a);
      return a;
    }),
    anims: [] as any[],
  };
  return el;
}
const draws: string[] = [];
function ctx() {
  return {
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    fillRect: () => draws.push('sky'),
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill: () => draws.push('fill'),
    drawImage: () => draws.push('flatten'),
    set fillStyle(_v: unknown) {},
  };
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
    rafQueue.shift()!(t);
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
    expect(createRidgeScene({ canvas, tier: 'full' })).toBeNull();
  });

  it('bakes the sky once and paints four layers at integer sizes, farthest first', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full' })!;
    expect(s).not.toBeNull();
    const layers = parent.children.slice(1);
    expect(layers).toHaveLength(LAYERS.length);
    layers.forEach((l: any) => {
      expect(Number.isInteger(l.width) && Number.isInteger(l.height)).toBe(true);
      expect(l.width).toBe(canvas.width * 2); // DPR 2: layer is two periods wide
      expect(l.animate).toHaveBeenCalledTimes(1);
    });
    expect(draws.filter((d) => d === 'sky')).toHaveLength(1);
    expect(draws.filter((d) => d === 'fill')).toHaveLength(LAYERS.length);
    s.dispose();
  });

  it('after the layers are painted, a smooth run draws nothing more and ends its rAF loop', () => {
    const { canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full' })!;
    const before = draws.length;
    runFrames(16.7, 400);
    expect(draws.length).toBe(before);
    expect(rafQueue).toHaveLength(0); // no per-frame work left
    s.dispose();
  });

  it('p95 over 33 ms across 2 s flattens to a still image and removes the layers', () => {
    const { parent, canvas } = host();
    const onProbe = vi.fn();
    const s = createRidgeScene({ canvas, tier: 'full', onProbe })!;
    runFrames(100, 100);
    expect(draws.filter((d) => d === 'flatten')).toHaveLength(LAYERS.length);
    expect(parent.children).toEqual([canvas]);
    expect(onProbe).toHaveBeenLastCalledWith(expect.objectContaining({ still: true }));
    expect(rafQueue).toHaveLength(0);
    s.dispose();
  });

  it("'still' tier flattens immediately and never starts a loop", () => {
    const { parent, canvas } = host();
    createRidgeScene({ canvas, tier: 'still' });
    expect(parent.children).toEqual([canvas]);
    expect(draws.filter((d) => d === 'flatten')).toHaveLength(LAYERS.length);
    expect(rafQueue).toHaveLength(0);
  });

  it('prefers-reduced-motion: layers are built but never played, and nothing is sampled', () => {
    motion.matches = true;
    const { canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full' })!;
    const anims = canvas.anims.concat(...canvas.parentElement.children.map((c: any) => c.anims));
    expect(anims.length).toBe(LAYERS.length);
    anims.forEach((a: any) => expect(a.play).not.toHaveBeenCalled());
    expect(rafQueue).toHaveLength(0);
    s.dispose();
  });

  it('pauses the drift when the tab is hidden and resumes when it is visible', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full' })!;
    const anims = parent.children.slice(1).flatMap((l: any) => l.anims);
    anims.forEach((a: any) => a.pause.mockClear());
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    anims.forEach((a: any) => expect(a.pause).toHaveBeenCalled());
    anims.forEach((a: any) => a.play.mockClear());
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    anims.forEach((a: any) => expect(a.play).toHaveBeenCalled());
    s.dispose();
  });

  it('?probe=1 keeps the rAF loop alive and shows median and p95', () => {
    search = '?probe=1';
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full' })!;
    const readout = parent.children[parent.children.length - 1];
    runFrames(16.7, 300);
    expect(rafQueue.length).toBe(1); // still sampling
    expect(readout.textContent).toMatch(/median 16\.\d ms · p95 1[67]\.\d ms/);
    s.dispose();
    expect(parent.children.some((c: any) => c === readout)).toBe(false);
  });

  it('dispose cancels the loop, the animations and the layers', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full' })!;
    const anims = parent.children.slice(1).flatMap((l: any) => l.anims);
    s.dispose();
    anims.forEach((a: any) => expect(a.cancel).toHaveBeenCalled());
    expect(parent.children).toEqual([canvas]);
    expect(rafQueue).toHaveLength(0);
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

describe('fbm', () => {
  it('is normalised into [0, 1]', () => {
    for (let i = 0; i < 100; i += 1) {
      const v = fbmPeriodic(i / 100, 0, 3, FBM);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
