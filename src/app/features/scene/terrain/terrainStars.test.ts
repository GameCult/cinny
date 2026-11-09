/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function -- DOM stubs, as the other scene tests */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SKY, skyAtSun } from './terrainSky';
import {
  BRIGHTEN,
  createTerrainStars,
  elevationOf,
  ELEVATION_TOP,
  FRAME_MS,
  horizonY,
  PERIOD,
  nightColours,
  project,
  starGain,
} from './terrainStars';
import { CAMERA, view } from './terrainWorld';
import { isNight, makeStars } from '../ridge/stars';

/** A 2D context that only counts: arcs painted and clears since the last reset. */
function fakeCtx() {
  const c = {
    arcs: [] as Array<[number, number, number]>,
    clears: 0,
    alpha: 1,
    alphas: [] as number[],
  };
  const ctx: any = {
    clearRect: () => {
      c.clears += 1;
      c.arcs = [];
      c.alphas = [];
    },
    beginPath() {},
    fill() {
      c.alphas.push(ctx.globalAlpha);
    },
    arc: (x: number, y: number, r: number) => c.arcs.push([x, y, r]),
    globalAlpha: 1,
    fillStyle: '',
  };
  return { c, ctx };
}

let overlay: any;
let ctx2d: ReturnType<typeof fakeCtx>;
let parent: any;
beforeEach(() => {
  ctx2d = fakeCtx();
  overlay = {
    style: {},
    width: 0,
    height: 0,
    setAttribute: vi.fn(),
    getContext: vi.fn(() => ctx2d.ctx),
    remove: vi.fn(),
  };
  parent = { appendChild: vi.fn() };
  vi.stubGlobal('document', { createElement: () => overlay });
  vi.stubGlobal('window', { devicePixelRatio: 1, innerWidth: 390, innerHeight: 844 });
});
afterEach(() => vi.unstubAllGlobals());

const glCanvas = (w = 390, h = 844) =>
  ({ clientWidth: w, clientHeight: h, parentElement: parent } as any);

describe('which skies get stars', () => {
  it('the field is placed against the baked night gradient, which the ridge module calls dark', () => {
    expect(isNight(nightColours())).toBe(true);
  });

  it('starGain: full below -12 degrees, none above -6, smooth and monotone between', () => {
    expect(starGain(-44.6)).toBe(1);
    expect(starGain(-12)).toBe(1);
    expect(starGain(-6)).toBe(0);
    expect(starGain(45.2)).toBe(0);
    expect(starGain(-9)).toBeCloseTo(0.5, 9);
    let prev = 1;
    for (let e = -12; e <= -6; e += 0.25) {
      expect(starGain(e)).toBeLessThanOrEqual(prev);
      prev = starGain(e);
    }
  });

  it('noonday gets no layer and no element', () => {
    expect(createTerrainStars(glCanvas(), SKY.noonday)).toBeNull();
    expect(parent.appendChild).not.toHaveBeenCalled();
  });

  it('twilight is a fade, not a gate: a sun at -9 degrees paints the stars at half alpha', () => {
    createTerrainStars(glCanvas(), skyAtSun(-9))?.draw(0);
    const half = Math.max(...ctx2d.c.alphas);
    ctx2d.c.alphas = [];
    createTerrainStars(glCanvas(), SKY.midnight)?.draw(0);
    expect(half).toBeGreaterThan(0);
    expect(half / Math.max(...ctx2d.c.alphas)).toBeCloseTo(0.5, 6);
    expect(createTerrainStars(glCanvas(), skyAtSun(-6.5))).not.toBeNull();
    expect(createTerrainStars(glCanvas(), skyAtSun(-6))).toBeNull();
  });

  it('midnight adds one overlay to the canvas parent; dispose removes it', () => {
    const s = createTerrainStars(glCanvas(), SKY.midnight)!;
    expect(parent.appendChild).toHaveBeenCalledWith(overlay);
    s.dispose();
    expect(overlay.remove).toHaveBeenCalledOnce();
  });

  it('is absent without a parent or a 2D context', () => {
    expect(
      createTerrainStars({ ...glCanvas(), parentElement: null } as any, SKY.midnight)
    ).toBeNull();
    overlay.getContext = () => null;
    expect(createTerrainStars(glCanvas(), SKY.midnight)).toBeNull();
    expect(parent.appendChild).not.toHaveBeenCalled();
  });
});

describe('sky only', () => {
  it('the overlay is as tall as the horizon line is low, never the whole screen', () => {
    createTerrainStars(glCanvas(), SKY.midnight);
    expect(overlay.height).toBe(Math.ceil(horizonY(844)));
    expect(overlay.height).toBeLessThan(844 / 2);
    expect(overlay.style.pointerEvents).toBe('none');
  });

  it('a star at the horizon lands on the horizon line, one above it lands above', () => {
    for (const aspect of [0.46, 1.78]) {
      const h = 800;
      const w = h * aspect;
      const onLine = project(0.2, 0, w, h)!;
      expect(onLine.y).toBeCloseTo(horizonY(h), 5);
      expect(project(0.2, 0.05, w, h)!.y).toBeLessThan(horizonY(h));
    }
  });

  it('the camera eye clears the peaks, so the horizon line bounds the terrain', () => {
    expect(CAMERA.eye).toBeGreaterThan(256);
  });

  it('every painted star is above the horizon line, at any heading', () => {
    const s = createTerrainStars(glCanvas(), SKY.midnight)!;
    for (let k = 0; k < 40; k += 1) {
      s.draw(k / 40);
      for (const [, y] of ctx2d.c.arcs) expect(y).toBeLessThanOrEqual(overlay.height);
    }
  });

  it('agrees with the camera the terrain draws: the projection matches view()', () => {
    const w = 390;
    const h = 844;
    const turns = 0.137;
    const v = view(w / h, turns);
    const yaw = 2 * Math.PI * turns;
    const az = yaw + 0.1;
    const e = 0.15;
    const d = [Math.sin(az) * Math.cos(e), Math.sin(e), -Math.cos(az) * Math.cos(e)];
    const dot = (a: number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const t = Math.tan(CAMERA.fov / 2);
    const f = dot(d, v.forward);
    const nx = dot(d, v.right) / f / (t * (w / h));
    const ny = dot(d, v.up) / f / t;
    const at = project(0.1, e, w, h)!;
    expect(at.x).toBeCloseTo(((nx + 1) / 2) * w, 6);
    expect(at.y).toBeCloseTo(((1 - ny) / 2) * h, 6);
  });
});

describe('turning with the camera', () => {
  it('stars are on screen, and slide sideways as the camera turns', () => {
    const s = createTerrainStars(glCanvas(), SKY.midnight)!;
    s.draw(0);
    const first = ctx2d.c.arcs.slice();
    expect(first.length).toBeGreaterThan(10);
    s.draw(0.002);
    const later = ctx2d.c.arcs;
    expect(later).not.toEqual(first);
    const m = (a: number[][]) => a.reduce((t, p) => t + p[0], 0) / a.length;
    expect(m(later)).not.toBeCloseTo(m(first), 1);
  });

  it('repeats every PERIOD of heading', () => {
    const s = createTerrainStars(glCanvas(), SKY.midnight)!;
    s.draw(0.1);
    const a = ctx2d.c.arcs.map((p) => p.map((n) => Math.round(n * 1e3)));
    s.draw(0.1 + PERIOD / (2 * Math.PI));
    expect(ctx2d.c.arcs.map((p) => p.map((n) => Math.round(n * 1e3)))).toEqual(a);
  });

  it('the field fills the screen top and thins toward the horizon, inside the elevation band', () => {
    expect(elevationOf(0)).toBeCloseTo(ELEVATION_TOP, 9);
    expect(elevationOf(0.78)).toBeCloseTo(0, 9);
  });
});

describe('brightness', () => {
  it('draws every star at BRIGHTEN times its ridge-field alpha, capped at 1', () => {
    createTerrainStars(glCanvas(), SKY.midnight)?.draw(0);
    const want = makeStars(nightColours(), 390, 844).map((st) => Math.min(1, st.alpha * BRIGHTEN));
    ctx2d.c.alphas.forEach((a) => expect(want.some((w) => Math.abs(w - a) < 1e-9)).toBe(true));
    // and it is brighter than the ridge field's own top alpha
    const top = Math.max(...makeStars(nightColours(), 390, 844).map((st) => st.alpha));
    expect(Math.max(...ctx2d.c.alphas)).toBeGreaterThan(top * 1.5);
  });
});

describe('motion', () => {
  it('with no clock every star is at base and a repeat draw repaints; no twinkle', () => {
    const s = createTerrainStars(glCanvas(), SKY.midnight)!;
    s.draw(0.3);
    const alphas = ctx2d.c.alphas.slice();
    s.draw(0.3);
    expect(ctx2d.c.alphas).toEqual(alphas);
  });

  it('with the clock the twinklers swing away from base, and the repaint is throttled', () => {
    const s = createTerrainStars(glCanvas(), SKY.midnight)!;
    s.draw(0.3);
    const still = ctx2d.c.alphas.slice();
    let moved = false;
    for (let t = 1; t < 60 && !moved; t += 1.7) {
      s.draw(0.3, t);
      moved = ctx2d.c.alphas.some((a, i) => a !== still[i]);
    }
    expect(moved).toBe(true);
    const clears = ctx2d.c.clears;
    s.draw(0.3, 100);
    s.draw(0.3, 100 + FRAME_MS / 4000);
    expect(ctx2d.c.clears).toBe(clears + 1);
  });

  it('resize refits the canvas and the next draw repaints at once', () => {
    const c = glCanvas();
    const s = createTerrainStars(c, SKY.midnight)!;
    s.draw(0.1, 5);
    c.clientHeight = 400;
    s.resize();
    expect(overlay.height).toBe(Math.ceil(horizonY(400)));
    const clears = ctx2d.c.clears;
    s.draw(0.1, 5.001);
    expect(ctx2d.c.clears).toBe(clears + 1);
  });
});
