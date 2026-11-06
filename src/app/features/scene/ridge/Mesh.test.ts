import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeshScene } from './Mesh';
import { triangleCount } from './meshWorld';
import { startBackgroundScene } from '../index';

// A GL context that accepts every call, remembers draws, and reports success for compile and link.
function fakeGl() {
  const calls: Record<string, unknown[][]> = {};
  const gl: any = new Proxy(
    {},
    {
      get(_t, name: string) {
        if (name === 'getShaderParameter' || name === 'getProgramParameter') return () => true;
        if (name === 'getAttribLocation' || name === 'getUniformLocation') return () => 1;
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
beforeEach(() => {
  rafQueue = [];
  visibility = 'visible';
  vi.stubGlobal('document', {
    ...new EventTarget(),
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
    location: { search: '' },
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

describe('createMeshScene', () => {
  it("returns null at tier 'off' and touches nothing", () => {
    const canvas = canvasWith(null);
    expect(createMeshScene({ canvas, tier: 'off' })).toBeNull();
    expect(canvas.getContext).not.toHaveBeenCalled();
  });

  it('returns null without WebGL, so the host keeps its CSS ground', () => {
    expect(createMeshScene({ canvas: canvasWith(null), tier: 'full' })).toBeNull();
  });

  it('reports a shader that does not compile and returns null', () => {
    const { gl } = fakeGl();
    const bad = new Proxy(gl, {
      get: (t, n: string) => (n === 'getShaderParameter' ? () => false : t[n]),
    });
    const onCompileFail = vi.fn();
    expect(createMeshScene({ canvas: canvasWith(bad), tier: 'full', onCompileFail })).toBeNull();
    expect(onCompileFail).toHaveBeenCalledOnce();
  });

  it('draws the whole mesh in one indexed call per frame and then keeps drifting', () => {
    const { gl, calls } = fakeGl();
    const scene = createMeshScene({ canvas: canvasWith(gl), tier: 'full' })!;
    expect(scene).not.toBeNull();
    rafQueue.shift()!(16);
    expect(calls.drawElements).toHaveLength(1);
    expect(calls.drawElements[0][1]).toBe(triangleCount() * 3);
    expect(rafQueue).toHaveLength(1); // the next frame is already queued
    scene.dispose();
  });

  it("'still' draws once and queues no frames", () => {
    const { gl, calls } = fakeGl();
    const scene = createMeshScene({ canvas: canvasWith(gl), tier: 'still' })!;
    expect(calls.drawElements).toHaveLength(1);
    expect(rafQueue).toHaveLength(0);
    scene.dispose();
  });

  it('falls back to a still frame when the measured p95 is over 33 ms', () => {
    const { gl, calls } = fakeGl();
    const onProbe = vi.fn();
    const scene = createMeshScene({ canvas: canvasWith(gl), tier: 'full', onProbe })!;
    let t = 0;
    for (let i = 0; i < 400 && rafQueue.length; i += 1) rafQueue.shift()!((t += 50));
    expect(rafQueue).toHaveLength(0);
    expect(onProbe).toHaveBeenLastCalledWith(expect.objectContaining({ still: true }));
    expect(calls.drawElements.length).toBeLessThan(400);
    scene.dispose();
  });

  it('does not draw while the tab is hidden', () => {
    const { gl, calls } = fakeGl();
    const scene = createMeshScene({ canvas: canvasWith(gl), tier: 'full' })!;
    visibility = 'hidden';
    rafQueue.shift()!(16);
    expect(calls.drawElements ?? []).toHaveLength(0);
    scene.dispose();
  });

  it('dispose frees its buffers and programs and queues nothing more', () => {
    const { gl, calls } = fakeGl();
    const scene = createMeshScene({ canvas: canvasWith(gl), tier: 'full' })!;
    scene.dispose();
    expect(calls.deleteBuffer).toHaveLength(4);
    expect(calls.deleteProgram).toHaveLength(2);
    expect(rafQueue).toHaveLength(0);
  });
});

describe("startBackgroundScene style 'mesh'", () => {
  it('is off by default: nothing loads and no context is requested', async () => {
    const canvas = canvasWith(null);
    expect(await startBackgroundScene({ style: 'mesh' }, {}, { canvas })).toBeNull();
    expect(await startBackgroundScene(undefined, {}, { canvas })).toBeNull();
    expect(canvas.getContext).not.toHaveBeenCalled();
  });

  it("asks for WebGL, not 2D, when the tier is on and the style is 'mesh'", async () => {
    const { gl } = fakeGl();
    const canvas = canvasWith(gl);
    const scene = await startBackgroundScene({ tier: 'still', style: 'mesh' }, {}, { canvas });
    expect(scene).not.toBeNull();
    expect(canvas.getContext).toHaveBeenCalledWith('webgl', expect.anything());
    scene!.dispose();
  });
});
