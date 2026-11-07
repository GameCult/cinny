/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-empty-function -- fake GL and DOM stubs, as the other scene tests */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTerrainScene } from './Terrain';
import { GRID, triangleCount } from './terrainWorld';
import { SKY } from './skyData';
import { ambientColour } from './terrainSky';
import { startBackgroundScene } from '../index';

/** A GL context that accepts every call, remembers them, reports success for compile, link and framebuffer. */
function fakeGl(over: Record<string, unknown> = {}) {
  const calls: Record<string, unknown[][]> = {};
  const gl: any = new Proxy(
    {},
    {
      get(_t, name: string) {
        if (name in over) return over[name];
        if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
        if (name === 'getAttribLocation' || name === 'getUniformLocation') return () => 1;
        if (name === 'checkFramebufferStatus') return () => 1;
        if (name === 'getParameter') return () => 16;
        if (/^[A-Z_0-9]+$/.test(name)) return 1;
        return (...args: unknown[]) => {
          (calls[name] ??= []).push(args);
          return {};
        };
      },
    }
  );
  return { gl, calls };
}

let rafQueue: Array<(t: number) => void>;
let visibility: string;
let search: string;
beforeEach(() => {
  rafQueue = [];
  visibility = 'visible';
  search = '';
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    get visibilityState() {
      return visibility;
    },
    createElement: () => ({ style: {}, remove() {} }),
  });
  vi.stubGlobal('window', {
    devicePixelRatio: 1,
    innerWidth: 400,
    innerHeight: 800,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    get location() {
      return { search };
    },
    setTimeout,
  });
  vi.stubGlobal('performance', { now: () => 0 });
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => rafQueue.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {
    rafQueue = [];
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function canvasWith(gl: unknown) {
  return {
    width: 0,
    height: 0,
    clientWidth: 400,
    clientHeight: 800,
    parentElement: { appendChild: vi.fn() },
    getContext: vi.fn(() => gl),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as any;
}

describe('createTerrainScene', () => {
  it("returns null at tier 'off' and touches nothing", () => {
    const canvas = canvasWith(null);
    expect(createTerrainScene({ canvas, tier: 'off' })).toBeNull();
    expect(canvas.getContext).not.toHaveBeenCalled();
  });

  it('returns null without WebGL2, so the host keeps its CSS ground', () => {
    const canvas = canvasWith(null);
    expect(createTerrainScene({ canvas, tier: 'full' })).toBeNull();
    expect(canvas.getContext).toHaveBeenCalledWith('webgl2', expect.anything());
  });

  it('returns null with no vertex texture units, or an incomplete bake target', () => {
    expect(
      createTerrainScene({ canvas: canvasWith(fakeGl({ getParameter: () => 0 }).gl), tier: 'full' })
    ).toBeNull();
    const { gl, calls } = fakeGl({ checkFramebufferStatus: () => 0 });
    expect(createTerrainScene({ canvas: canvasWith(gl), tier: 'full' })).toBeNull();
    expect(calls.deleteProgram).toHaveLength(3);
  });

  it('reports a shader that does not compile to onCompileFail and returns null', () => {
    const { gl } = fakeGl({ getShaderParameter: () => false, getShaderInfoLog: () => 'bad' });
    const onCompileFail = vi.fn();
    expect(createTerrainScene({ canvas: canvasWith(gl), tier: 'full', onCompileFail })).toBeNull();
    expect(onCompileFail).toHaveBeenCalledOnce();
    expect(onCompileFail.mock.calls[0][0].log).toContain('terrain height');
  });

  it('bakes the height map once, then draws sky and grid each frame and keeps turning', () => {
    const { gl, calls } = fakeGl();
    const scene = createTerrainScene({ canvas: canvasWith(gl), tier: 'low' })!;
    expect(scene).not.toBeNull();
    const bakes = calls.drawArrays.length;
    expect(bakes).toBe(1);
    rafQueue.shift()!(16);
    rafQueue.shift()!(32);
    expect(calls.drawArrays).toHaveLength(bakes + 2); // one sky draw per frame
    expect(calls.drawElements).toHaveLength(2);
    expect(calls.drawElements[0][1]).toBe(triangleCount(GRID.low.grid) * 3);
    expect(calls.texImage2D).toHaveLength(1); // the baked map is never re-uploaded
    expect(rafQueue).toHaveLength(1);
    scene.dispose();
  });

  it("'still' draws one frame and queues nothing", () => {
    const { gl, calls } = fakeGl();
    const scene = createTerrainScene({ canvas: canvasWith(gl), tier: 'still' })!;
    expect(calls.drawElements).toHaveLength(1);
    expect(rafQueue).toHaveLength(0);
    scene.dispose();
  });

  it('lights with the sky chosen: option, then ?sky=, then the night default', () => {
    const ambientUploaded = (opts: { sky?: 'midnight' | 'noonday' }) => {
      const { gl, calls } = fakeGl();
      createTerrainScene({ canvas: canvasWith(gl), tier: 'still', ...opts })!.dispose();
      const hit = calls.uniform3fv.filter((a) => (a[1] as ArrayLike<number>).length === 3);
      // uniform3fv order in draw(): right, up, forward, then sun, sunColour, ambient, haze (+ camera)
      return hit.map((a) => Array.from(a[1] as ArrayLike<number>));
    };
    const night = ambientUploaded({});
    const day = ambientUploaded({ sky: 'noonday' });
    const nightA = Array.from(ambientColour(SKY.midnight));
    const dayA = Array.from(ambientColour(SKY.noonday));
    const has = (all: number[][], v: number[]) =>
      all.some((a) => a.every((x, i) => Math.abs(x - v[i]) < 1e-6));
    expect(has(night, nightA)).toBe(true);
    expect(has(night, dayA)).toBe(false);
    expect(has(day, dayA)).toBe(true);
    search = '?sky=noonday';
    expect(has(ambientUploaded({}), dayA)).toBe(true);
    search = '?sky=garbage';
    expect(has(ambientUploaded({}), nightA)).toBe(true);
  });

  it('falls back to a still frame when the measured p95 is over 33 ms', () => {
    const { gl, calls } = fakeGl();
    const onProbe = vi.fn();
    const scene = createTerrainScene({ canvas: canvasWith(gl), tier: 'full', onProbe })!;
    let t = 0;
    for (let i = 0; i < 400 && rafQueue.length; i += 1) rafQueue.shift()!((t += 50));
    expect(rafQueue).toHaveLength(0);
    expect(onProbe).toHaveBeenLastCalledWith(expect.objectContaining({ still: true }));
    expect(calls.drawElements.length).toBeLessThan(400);
    scene.dispose();
  });

  it('does not draw while the tab is hidden, or under reduced motion', () => {
    const { gl, calls } = fakeGl();
    const scene = createTerrainScene({ canvas: canvasWith(gl), tier: 'full' })!;
    const before = (calls.drawElements ?? []).length;
    visibility = 'hidden';
    rafQueue.shift()!(16);
    expect((calls.drawElements ?? []).length).toBe(before);
    scene.dispose();
    vi.stubGlobal('window', {
      ...(window as object),
      matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    });
    visibility = 'visible';
    const g2 = fakeGl();
    const still = createTerrainScene({ canvas: canvasWith(g2.gl), tier: 'full' })!;
    expect(rafQueue).toHaveLength(0);
    expect(g2.calls.drawElements).toHaveLength(1); // one frame, then still
    still.dispose();
  });

  it('a lost context stops the scene and tells the host', () => {
    const { gl, calls } = fakeGl();
    const canvas = canvasWith(gl);
    const onContextLost = vi.fn();
    createTerrainScene({ canvas, tier: 'full', onContextLost })!;
    const handler = canvas.addEventListener.mock.calls.find(
      (c: unknown[]) => c[0] === 'webglcontextlost'
    )[1];
    handler({ preventDefault() {} });
    expect(onContextLost).toHaveBeenCalledOnce();
    const n = (calls.drawElements ?? []).length;
    rafQueue.splice(0).forEach((f) => f(16));
    expect((calls.drawElements ?? []).length).toBe(n);
  });

  it('dispose frees its programs, buffers and texture and queues nothing more', () => {
    const { gl, calls } = fakeGl();
    createTerrainScene({ canvas: canvasWith(gl), tier: 'full' })!.dispose();
    expect(calls.deleteProgram).toHaveLength(3);
    expect(calls.deleteBuffer).toHaveLength(2);
    expect(calls.deleteTexture).toHaveLength(1);
    expect(rafQueue).toHaveLength(0);
  });
});

describe("startBackgroundScene style 'terrain'", () => {
  it('requests webgl2 and returns a scene once the tier is on', async () => {
    const { gl } = fakeGl();
    const canvas = canvasWith(gl);
    const scene = await startBackgroundScene({ tier: 'still', style: 'terrain' }, {}, { canvas });
    expect(scene).not.toBeNull();
    expect(canvas.getContext).toHaveBeenCalledWith('webgl2', expect.anything());
    scene!.dispose();
  });

  it('stays off by default, and the default style is still the ridge (no WebGL2)', async () => {
    const canvas = canvasWith(null);
    expect(await startBackgroundScene({ style: 'terrain' }, {}, { canvas })).toBeNull();
    expect(canvas.getContext).not.toHaveBeenCalled();
    const { gl } = fakeGl();
    const c2 = { ...canvasWith(gl), getContext: vi.fn(() => null) };
    await startBackgroundScene({ tier: 'still' }, {}, { canvas: c2 });
    expect(c2.getContext).not.toHaveBeenCalledWith('webgl2', expect.anything());
  });
});
