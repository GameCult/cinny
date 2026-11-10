import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRidgeScene } from './Ridge';
import { fbmPeriodic, valueNoisePeriodic, hash2 } from './noise';
import { FrameSampler, frameStats, SLOW_P95_MS, WARMUP_FRAMES, WINDOW_MS } from './probe';
import {
  AERIAL,
  FBM,
  LAYERS,
  edgeBlur,
  hazeColour,
  layerColour,
  layerSize,
  profile,
  ridgeY,
  scatterAlpha,
  transmittance,
} from './ridgeWorld';
import { skyColours, SkyColours } from './skyColour';
import { makeStars } from './stars';
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

describe('aerial perspective', () => {
  const sky = skyColours();
  const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const chroma = (c: readonly number[]) => Math.max(...c) - Math.min(...c);
  const far = LAYERS[0];
  const near = LAYERS[LAYERS.length - 1];

  it('transmittance is Beer-Lambert in distance: 1 at the viewer, exp(-k d) behind, strictly falling', () => {
    expect(transmittance(near)).toBe(1);
    for (const l of LAYERS)
      expect(transmittance(l)).toBeCloseTo(Math.exp(-AERIAL.extinction * (1 - l.depth)), 12);
    for (let i = 1; i < LAYERS.length; i += 1)
      expect(transmittance(LAYERS[i])).toBeGreaterThan(transmittance(LAYERS[i - 1]));
    // two layers' optical depths add: T(a)*T(b) = T(a+b)
    const t = (d: number) => Math.exp(-AERIAL.extinction * d);
    expect(t(0.3) * t(0.4)).toBeCloseTo(t(0.7), 12);
  });

  it('the nearest layer is exactly the ground colour; the farthest tends to the haze', () => {
    expect(layerColour(near, sky)).toEqual([...sky.ground]);
    const h = hazeColour(sky);
    const f = layerColour(far, sky);
    const dist = (a: readonly number[], b: readonly number[]) =>
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(dist(f, h)).toBeLessThan(dist(sky.ground, h) * (transmittance(far) + 0.2));
  });

  it('colour moves toward the haze and loses chroma with distance, beyond what the mix alone does', () => {
    const h = hazeColour(sky);
    for (const l of LAYERS.slice(0, -1)) {
      const t = transmittance(l);
      const c = layerColour(l, sky);
      const mixed = [0, 1, 2].map((i) => sky.ground[i] * t + h[i] * (1 - t));
      expect(chroma(c)).toBeLessThan(chroma(mixed));
      expect(Math.abs(lum(c) - lum(mixed))).toBeLessThan(1.5); // desaturation keeps luma
    }
  });

  it('edge softening grows with distance and is zero at the viewer', () => {
    expect(edgeBlur(near)).toBe(0);
    for (let i = 1; i < LAYERS.length; i += 1)
      expect(edgeBlur(LAYERS[i])).toBeLessThan(edgeBlur(LAYERS[i - 1]));
    expect(edgeBlur(far)).toBeLessThanOrEqual(AERIAL.blurPx);
  });

  it('in-scatter peaks at the sun azimuth, is periodic, faint, grows with distance, and is off without a sun', () => {
    const az = 0.3;
    const s = { ...sky, sunAzimuth: az };
    expect(scatterAlpha(far, s, az)).toBeGreaterThan(scatterAlpha(far, s, az + 0.5));
    expect(scatterAlpha(far, s, 0)).toBeCloseTo(scatterAlpha(far, s, 1), 12);
    expect(scatterAlpha(far, s, az)).toBeLessThanOrEqual(AERIAL.scatter);
    expect(scatterAlpha(near, s, az)).toBe(0);
    expect(scatterAlpha(LAYERS[1], s, az)).toBeLessThan(scatterAlpha(far, s, az));
    expect(scatterAlpha(far, { ...sky, sunAzimuth: undefined }, az)).toBe(0);
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
// A day sky has no stars, so the scene tests below see only the ridge loop; the dusk default
// carries stars and a twinkle overlay, tested in 'the starfield in the scene'.
const DAY: SkyColours = {
  top: [96, 150, 220],
  mid: [150, 190, 235],
  horizon: [240, 215, 190],
  ground: [7, 17, 26],
  sunAzimuth: 0.3,
};
const draws: string[] = [];
function ctx(withFilter = false) {
  const c: any = {
    globalCompositeOperation: 'source-over',
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    fillRect() {
      draws.push(c.globalCompositeOperation === 'source-atop' ? 'scatter' : 'sky');
    },
    beginPath() {},
    moveTo() {},
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
    drawImage: () => draws.push('flatten'),
    set fillStyle(_v: unknown) {},
  };
  if (withFilter) c.filter = 'none';
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

  it('bakes the sky once and paints four layers at integer sizes, farthest first', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY })!;
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
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY })!;
    const before = draws.length;
    runFrames(16.7, 400);
    expect(draws.length).toBe(before);
    expect(rafQueue).toHaveLength(0); // no per-frame work left
    s.dispose();
  });

  it('p95 over 33 ms across 2 s flattens to a still image and removes the layers', () => {
    const { parent, canvas } = host();
    const onProbe = vi.fn();
    const s = createRidgeScene({ canvas, tier: 'full', onProbe, sky: DAY })!;
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
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY })!;
    const anims = canvas.anims.concat(...canvas.parentElement.children.map((c: any) => c.anims));
    expect(anims.length).toBe(LAYERS.length);
    anims.forEach((a: any) => expect(a.play).not.toHaveBeenCalled());
    expect(rafQueue).toHaveLength(0);
    s.dispose();
  });

  it('pauses the drift when the tab is hidden and resumes when it is visible', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY })!;
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
    const before = parent.children.length;
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY })!;
    expect(parent.children.length).toBe(before + LAYERS.length);
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
    expect(parent.children).toEqual([canvas]);
    expect(draws).toHaveLength(0);
    // Still zero: a resize does not paint either.
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 300));
    expect(parent.children).toEqual([canvas]);
    (window as any).innerWidth = 400;
    (window as any).innerHeight = 800;
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 300));
    expect(parent.children.slice(1)).toHaveLength(LAYERS.length);
    expect(draws.filter((d) => d === 'sky')).toHaveLength(1);
    s!.dispose();
    expect(parent.children).toEqual([canvas]);
  });

  it('dispose cancels the loop, the animations and the layers', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY })!;
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

describe('aerial perspective in the scene', () => {
  it('is baked once: one scatter fill per hazy layer, none per frame, the nearest layer has none', () => {
    const { canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY })!;
    expect(draws.filter((d) => d === 'scatter')).toHaveLength(LAYERS.length - 1);
    const before = draws.length;
    runFrames(16.7, 400);
    expect(draws.length).toBe(before);
    s.dispose();
  });

  it('a sky without a sun bakes no scatter', () => {
    const { canvas } = host();
    const s = createRidgeScene({
      canvas,
      tier: 'full',
      sky: { ...DAY, sunAzimuth: undefined },
    })!;
    expect(draws.filter((d) => d === 'scatter')).toHaveLength(0);
    s.dispose();
  });

  it('softens with the canvas filter where it exists, blur scaled by DPR, tiled so the wrap does not fade', () => {
    const { parent, canvas } = host();
    const filters: string[] = [];
    const orig = (document as any).createElement;
    (document as any).createElement = (t: string) => {
      const el = orig(t);
      el.getContext = vi.fn(() => {
        const c = ctx(true);
        let f = 'none';
        Object.defineProperty(c, 'filter', {
          get: () => f,
          set: (v: string) => {
            f = v;
            filters.push(v);
          },
        });
        return c;
      });
      return el;
    };
    const s = createRidgeScene({ canvas, tier: 'full', sky: DAY })!;
    const blurs = filters.filter((f) => f !== 'none');
    expect(blurs).toHaveLength(LAYERS.length - 1); // nearest is sharp
    expect(blurs[0]).toBe(`blur(${edgeBlur(LAYERS[0]) * 2}px)`); // DPR 2
    expect(parent.children).toHaveLength(1 + LAYERS.length);
    s.dispose();
  });

  it("'still' tier keeps the sky and flattens the aerial layers without extra elements", () => {
    const { parent, canvas } = host();
    createRidgeScene({ canvas, tier: 'still' });
    expect(parent.children).toEqual([canvas]);
    expect(draws.filter((d) => d === 'sky')).toHaveLength(1);
    expect(draws.filter((d) => d === 'flatten')).toHaveLength(LAYERS.length);
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
  // Everything but the overlay's own marks: the bake and the ridges.
  const baked = () => draws.filter((d) => d !== 'twinkle' && d !== 'clear').length;

  it('bakes every star once into the sky; per frame only the overlay is touched', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: night })!;
    expect(count('star')).toBe(N);
    expect(count('sky')).toBe(1);
    expect(parent.children.indexOf(parent.children[1])).toBe(1);
    expect(parent.children[1].anims).toHaveLength(0); // the overlay: above the sky, under the ridges
    expect(parent.children).toHaveLength(2 + LAYERS.length);
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
    expect(parent.children).toHaveLength(1 + LAYERS.length);
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

  it('flattening to a still (slow frames) drops the overlay and leaves every star baked under the ridges', () => {
    const { parent, canvas } = host();
    const s = createRidgeScene({ canvas, tier: 'full', sky: night })!;
    runFrames(100, 100);
    expect(parent.children).toEqual([canvas]);
    expect(count('star')).toBe(N);
    expect(draws.indexOf('flatten')).toBeGreaterThan(draws.lastIndexOf('star'));
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
