import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { createScene, ShaderCompileError, HALF_START_BIAS, HALF_START_SCALE } from './Scene';
import { WORLD } from './world';
import { LEVELS } from './budget';
import { fragmentSource } from './shaderSource';
import { startBackgroundScene } from './index';

type Fn = Mock;

/** A GL context where every call is a spy and every constant is 1. Compiles succeed until `failFrom`. */
function fakeGl(failFrom = Infinity, missing: string[] = []) {
  let compiles = 0;
  const calls: Record<string, Fn> = {};
  const spy = (name: string, impl: (...a: any[]) => unknown = () => ({})): Fn => {
    if (!calls[name]) calls[name] = vi.fn(impl);
    return calls[name];
  };
  const gl = new Proxy({} as Record<string, unknown>, {
    get(_, prop: string) {
      // the two start-target formats must be told apart; every other constant is 1
      if (prop === 'RGBA32F') return 32;
      if (prop === 'RGBA16F') return 16;
      if (/^[A-Z][A-Z0-9_]*$/.test(prop)) return 1;
      if (prop === 'getExtension')
        return spy(prop, (n: string) => (missing.includes(n) ? null : {}));
      if (prop === 'compileShader') {
        return spy(prop, () => {
          compiles += 1;
        });
      }
      if (prop === 'getShaderParameter') return spy(prop, () => compiles < failFrom);
      if (prop === 'getShaderInfoLog') return spy(prop, () => 'ERROR: 0:1: bad');
      if (prop === 'getProgramParameter') return spy(prop, () => true);
      return spy(prop);
    },
  });
  return { gl: gl as unknown as WebGL2RenderingContext, calls };
}

function fakeCanvas(gl: WebGL2RenderingContext | null) {
  const canvas = new EventTarget() as EventTarget & {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    getContext: Fn;
  };
  canvas.clientWidth = 400;
  canvas.clientHeight = 300;
  canvas.width = 0;
  canvas.height = 0;
  canvas.getContext = vi.fn(() => gl);
  return canvas;
}

let rafQueue: Array<(t: number) => void>;
let cancelled: number;
let win: EventTarget;
let motion: EventTarget & { matches: boolean };
let doc: EventTarget & { visibilityState: string };

beforeEach(() => {
  rafQueue = [];
  cancelled = 0;
  motion = Object.assign(new EventTarget(), { matches: false });
  win = Object.assign(new EventTarget(), {
    devicePixelRatio: 1,
    matchMedia: () => motion,
  });
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => rafQueue.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {
    cancelled += 1;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const runFrame = (now: number) => {
  const cb = rafQueue.shift();
  if (!cb) throw new Error('no frame was scheduled');
  cb(now);
};
const asCanvas = (c: ReturnType<typeof fakeCanvas>) => c as unknown as HTMLCanvasElement;

describe('createScene tiers', () => {
  it("'off' returns null without asking the canvas for a context", () => {
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    expect(createScene({ canvas: asCanvas(canvas), tier: 'off' })).toBeNull();
    expect(canvas.getContext).not.toHaveBeenCalled();
    expect(rafQueue).toHaveLength(0);
  });

  it("'still' draws one frame and schedules no more", () => {
    const { gl, calls } = fakeGl();
    const scene = createScene({ canvas: asCanvas(fakeCanvas(gl)), tier: 'still' });
    expect(scene).not.toBeNull();
    runFrame(1000);
    expect(calls.drawArrays).toHaveBeenCalledTimes(5); // prepass and four passes, one frame
    expect(rafQueue).toHaveLength(0);
  });

  it("'still' ignores login(): the pull-back is for a moving scene", () => {
    const { gl } = fakeGl();
    const scene = createScene({ canvas: asCanvas(fakeCanvas(gl)), tier: 'still' });
    runFrame(1000);
    scene?.login();
    expect(rafQueue).toHaveLength(0);
  });

  it("'full' keeps scheduling frames", () => {
    const { gl } = fakeGl();
    createScene({ canvas: asCanvas(fakeCanvas(gl)), tier: 'full' });
    runFrame(1000);
    expect(rafQueue).toHaveLength(1);
  });

  it("'low' traces with a cheaper level than 'full'", () => {
    const traceSteps = (tier: 'low' | 'full') => {
      rafQueue.length = 0; // each call is a fresh scene
      const { gl, calls } = fakeGl();
      createScene({ canvas: asCanvas(fakeCanvas(gl)), tier });
      runFrame(1000);
      // u_maxSteps is the only uniform1i whose value is a trace-step count
      return calls.uniform1i.mock.calls.map((c) => c[1]).filter((v) => v >= 40);
    };
    expect(traceSteps('full')).toContain(LEVELS[0].traceSteps);
    expect(traceSteps('low')).toContain(LEVELS[2].traceSteps);
    expect(traceSteps('low')).not.toContain(LEVELS[0].traceSteps);
  });

  it('returns null when WebGL2 is missing, so the host keeps its ground', () => {
    expect(createScene({ canvas: asCanvas(fakeCanvas(null)) })).toBeNull();
  });
});

describe('cone prepass', () => {
  const programsFor = (prepass?: boolean) => {
    rafQueue.length = 0;
    const { gl, calls } = fakeGl();
    createScene({ canvas: asCanvas(fakeCanvas(gl)), prepass });
    return calls.createProgram.mock.calls.length;
  };

  it('is one more program than the baseline, and off means off', () => {
    expect(programsFor(true)).toBe(programsFor(false) + 1);
    expect(programsFor(undefined)).toBe(programsFor(true));
  });

  it('draws before pass 1 and only when on', () => {
    const drawsFor = (prepass: boolean) => {
      rafQueue.length = 0;
      const { gl, calls } = fakeGl();
      createScene({ canvas: asCanvas(fakeCanvas(gl)), prepass });
      runFrame(1000);
      return calls.drawArrays.mock.calls.length;
    };
    expect(drawsFor(true)).toBe(drawsFor(false) + 1);
  });

  it('the trace-step output exists in pass 1 only when the host asked to measure', () => {
    expect(fragmentSource('terrain')).not.toContain('TRACE_STATS 1');
    expect(fragmentSource('terrain', '#define TRACE_STATS 1\n')).toContain('#define TRACE_STATS 1');
  });

  it('reads the step bytes tightly packed, whatever the width', () => {
    rafQueue.length = 0;
    const { gl, calls } = fakeGl();
    createScene({ canvas: asCanvas(fakeCanvas(gl)), onTraceStats: () => {} });
    runFrame(1000);
    // fake constants are all 1: PACK_ALIGNMENT is 1, so a restore to 4 is the only other call
    const packs = calls.pixelStorei.mock.calls.map((c) => c[1]);
    expect(packs[0]).toBe(1);
    expect(packs).toContain(4);
    expect(calls.readPixels.mock.invocationCallOrder[0]).toBeGreaterThan(
      calls.pixelStorei.mock.invocationCallOrder[0]
    );
  });

  it('shares one distance bound between pass 1 and the prepass', () => {
    const bound = (stage: 'terrain' | 'prepass') =>
      fragmentSource(stage).match(/float sceneDistance\([^)]*\)\s*\{[^}]*\}/)?.[0];
    expect(bound('prepass')).toBeDefined();
    expect(bound('prepass')).toBe(bound('terrain'));
    expect(fragmentSource('atmosphere')).not.toContain('sceneDistance');
  });
});

describe('device without EXT_color_buffer_float', () => {
  const FLOAT = 'EXT_color_buffer_float';
  const HALF = 'EXT_color_buffer_half_float';
  const build = (missing: string[], extra: Partial<Parameters<typeof createScene>[0]> = {}) => {
    rafQueue.length = 0;
    const { gl, calls } = fakeGl(Infinity, missing);
    const onUnavailable = vi.fn();
    const scene = createScene({ canvas: asCanvas(fakeCanvas(gl)), onUnavailable, ...extra });
    if (scene) runFrame(1000); // targets are allocated on the first frame
    const formats = calls.texStorage2D?.mock.calls.map((c) => c[2]) ?? [];
    const sources = (calls.shaderSource?.mock.calls ?? []).map((c) => c[1] as string);
    return {
      scene,
      onUnavailable,
      formats,
      prepassSource: sources.find((x) => x.includes('o_start')),
    };
  };

  it('names why the scene is unavailable: no WebGL2, or neither float nor half-float colour buffers', () => {
    const none = vi.fn();
    createScene({ canvas: asCanvas(fakeCanvas(null)), onUnavailable: none });
    expect(none).toHaveBeenCalledTimes(1);
    expect(none).toHaveBeenCalledWith('no-webgl2');
    const r = build([FLOAT, HALF]);
    expect(r.scene).toBeNull();
    expect(r.onUnavailable).toHaveBeenCalledTimes(1);
    expect(r.onUnavailable).toHaveBeenCalledWith('no-float-or-half-float-colour-buffer');
    expect(build([]).onUnavailable).not.toHaveBeenCalled();
  });

  it('with only half-float colour buffers, starts the prepass in an RGBA16F target with the rounding-down write', () => {
    const r = build([FLOAT]);
    expect(r.scene?.startFormat).toBe('RGBA16F');
    expect(r.formats).not.toContain(32);
    expect(r.prepassSource).toContain('#define START_HALF 1');
    expect(r.prepassSource).toContain(`#define START_HALF_SCALE ${HALF_START_SCALE}`);
  });

  it('keeps RGBA32F and the plain write where it is renderable, unless asked for half', () => {
    const wide = build([HALF]);
    expect(wide.scene?.startFormat).toBe('RGBA32F');
    expect(wide.formats).toContain(32);
    expect(wide.prepassSource).not.toContain('#define START_HALF');
    expect(build([], { halfStart: true }).scene?.startFormat).toBe('RGBA16F');
  });

  // The shader writes max(0, t*SCALE - BIAS) into a half, which rounds to nearest (even); this is
  // that rounding. The GPU's rounding of a half write is the unknown a phone must confirm.
  const toHalf = (x: number) => {
    if (x === 0) return 0;
    let e = Math.max(Math.floor(Math.log2(x)), -14);
    if (2 ** e > x) e -= 1;
    const ulp = 2 ** (e - 10);
    const q = x / ulp;
    let r = Math.floor(q);
    const d = q - r;
    if (d > 0.5 || (d === 0.5 && r % 2 === 1)) r += 1;
    return r * ulp;
  };
  const stored = (t: number) => toHalf(Math.max(0, t * HALF_START_SCALE - HALF_START_BIAS));

  it('stores a start distance never past the true one, and not much short of it', () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const ts = [0, 1e-6, 1e-4, 6.1e-5, 0.01, 1, 1023.9, 1024, 2047.9];
    for (let i = 0; i < 20000; i++) ts.push(rand() * WORLD.far, rand() * rand() * 4);
    for (let t = 0; t <= WORLD.far; t += 0.37) ts.push(t);
    for (const t of ts) {
      expect(stored(t)).toBeLessThanOrEqual(t);
      expect(t - stored(t)).toBeLessThanOrEqual(t * 0.0021 + 6e-5);
    }
  });

  it('holds the miss sentinel W_FAR exactly, so pass 1 still skips a tile the prepass proved empty', () => {
    expect(toHalf(WORLD.far)).toBe(WORLD.far);
  });
});

describe('shader compile failure', () => {
  it('reports through onCompileFail, returns null, and frees the programs already linked', () => {
    const { gl, calls } = fakeGl(4); // terrain compiles both shaders; atmosphere's fragment is the 4th and fails
    const onCompileFail = vi.fn();
    const scene = createScene({ canvas: asCanvas(fakeCanvas(gl)), onCompileFail });
    expect(scene).toBeNull();
    expect(onCompileFail).toHaveBeenCalledTimes(1);
    const err = onCompileFail.mock.calls[0][0] as ShaderCompileError;
    expect(err).toBeInstanceOf(ShaderCompileError);
    expect(err.stage).toBe('atmosphere');
    expect(err.log).toContain('bad');
    expect(calls.deleteProgram).toHaveBeenCalled(); // the terrain program that did link
    expect(rafQueue).toHaveLength(0);
  });

  it('does not throw out of createScene when no callback is given', () => {
    const { gl } = fakeGl(0);
    expect(() => createScene({ canvas: asCanvas(fakeCanvas(gl)) })).not.toThrow();
  });
});

describe('context loss', () => {
  it('stops the loop, tells the host, and detaches every listener', () => {
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const onContextLost = vi.fn();
    createScene({ canvas: asCanvas(canvas), onContextLost });
    const lost = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(onContextLost).toHaveBeenCalledTimes(1);
    expect(cancelled).toBe(1);
    // listeners are gone: a second loss, a resize and a visibility change do nothing
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    win.dispatchEvent(new Event('resize'));
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(onContextLost).toHaveBeenCalledTimes(1);
    expect(rafQueue.length).toBe(1); // only the frame queued before the loss, never run
  });

  it('does not render a queued frame after the loss', () => {
    const { gl, calls } = fakeGl();
    const canvas = fakeCanvas(gl);
    createScene({ canvas: asCanvas(canvas) });
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    runFrame(1000);
    expect(calls.drawArrays).toBeUndefined();
  });
});

describe('prefers-reduced-motion', () => {
  const runAll = (t0: number) => {
    let t = t0;
    let n = 0;
    while (rafQueue.length && n < 200) {
      runFrame(t);
      t += 40;
      n += 1;
    }
    return n;
  };

  it('freezes to a bounded run when the preference turns on mid-flight', () => {
    const { gl } = fakeGl();
    createScene({ canvas: asCanvas(fakeCanvas(gl)) });
    runFrame(1000);
    expect(rafQueue).toHaveLength(1); // moving: keeps going
    motion.matches = true;
    motion.dispatchEvent(new Event('change'));
    expect(runAll(1040)).toBeLessThan(200); // ends
    expect(rafQueue).toHaveLength(0);
  });

  it('thaws a frozen scene when the preference turns off', () => {
    motion.matches = true;
    const { gl } = fakeGl();
    createScene({ canvas: asCanvas(fakeCanvas(gl)) });
    runAll(1000);
    expect(rafQueue).toHaveLength(0);
    motion.matches = false;
    motion.dispatchEvent(new Event('change'));
    expect(rafQueue).toHaveLength(1);
    runFrame(5000);
    expect(rafQueue).toHaveLength(1); // unbounded again
  });

  it('removes the listener on dispose and on context loss', () => {
    const { gl } = fakeGl();
    const scene = createScene({ canvas: asCanvas(fakeCanvas(gl)) });
    scene?.dispose();
    rafQueue.length = 0;
    motion.dispatchEvent(new Event('change'));
    expect(rafQueue).toHaveLength(0);

    const lostCanvas = fakeCanvas(fakeGl().gl);
    createScene({ canvas: asCanvas(lostCanvas) });
    lostCanvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    rafQueue.length = 0;
    motion.matches = true;
    motion.dispatchEvent(new Event('change'));
    expect(rafQueue).toHaveLength(0);
  });

  it('a still does not listen: one frame stays one frame', () => {
    const { gl } = fakeGl();
    createScene({ canvas: asCanvas(fakeCanvas(gl)), tier: 'still' });
    runFrame(1000);
    motion.matches = false;
    motion.dispatchEvent(new Event('change'));
    expect(rafQueue).toHaveLength(0);
  });
});

describe('startBackgroundScene', () => {
  it("does not request a context when the config leaves the tier 'off'", async () => {
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    expect(await startBackgroundScene(undefined, {}, { canvas: asCanvas(canvas) })).toBeNull();
    expect(
      await startBackgroundScene({ tier: 'off' }, {}, { canvas: asCanvas(canvas) })
    ).toBeNull();
    expect(canvas.getContext).not.toHaveBeenCalled();
  });

  it('applies the device ceiling: saveData runs a still, one frame', async () => {
    const { gl, calls } = fakeGl();
    const scene = await startBackgroundScene(
      { tier: 'full' },
      { saveData: true },
      { canvas: asCanvas(fakeCanvas(gl)) }
    );
    expect(scene).not.toBeNull();
    runFrame(1000);
    expect(calls.drawArrays).toHaveBeenCalledTimes(5);
    expect(rafQueue).toHaveLength(0);
  });

  it('reports a failed scene chunk to onCompileFail and returns null instead of throwing', async () => {
    vi.resetModules();
    vi.doMock('./Scene', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    try {
      const { startBackgroundScene: start } = await import('./index');
      const onCompileFail = vi.fn();
      const canvas = fakeCanvas(fakeGl().gl);
      const scene = await start({ tier: 'full' }, {}, { canvas: asCanvas(canvas), onCompileFail });
      expect(scene).toBeNull();
      expect(onCompileFail).toHaveBeenCalledTimes(1);
      expect(onCompileFail.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(canvas.getContext).not.toHaveBeenCalled();
      // and with no callback it still does not throw
      expect(await start({ tier: 'full' }, {}, { canvas: asCanvas(canvas) })).toBeNull();
    } finally {
      vi.doUnmock('./Scene');
      vi.resetModules();
    }
  });

  it('hands compile failure to the host and returns null, the fall to the CSS ground', async () => {
    const { gl } = fakeGl(0);
    const onCompileFail = vi.fn();
    const scene = await startBackgroundScene(
      { tier: 'full' },
      {},
      { canvas: asCanvas(fakeCanvas(gl)), onCompileFail }
    );
    expect(scene).toBeNull();
    expect(onCompileFail).toHaveBeenCalledTimes(1);
  });
});
