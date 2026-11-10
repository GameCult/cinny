/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-empty-function -- fake GL and DOM stubs, as the other scene tests */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTerrainScene } from './Terrain';
import { GRID, triangleCount } from './terrainWorld';
import { groundLight, SKY, skyAtSun } from './terrainSky';
import { AP_VOLUME, apVolumeWords, SKY_VIEW, skyViewWords } from './terrainScatter';
import { SKY_FRAG } from './terrainShaders';
import { SKY_BAND } from '../skyBand';
import { terrainSkyFor } from '../skyForState';
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
    const uploaded = (opts: { sky?: 'midnight' | 'noonday' }) => {
      const { gl, calls } = fakeGl();
      createTerrainScene({ canvas: canvasWith(gl), tier: 'still', ...opts })!.dispose();
      // every vec3 uniform draw() sets: right, up, forward, sun, sunColour, glow, ambient, camera, soil...
      return calls.uniform3fv
        .filter((a) => (a[1] as ArrayLike<number>).length === 3)
        .map((a) => Array.from(a[1] as ArrayLike<number>));
    };
    const night = uploaded({});
    const day = uploaded({ sky: 'noonday' });
    const nightA = Array.from(groundLight(SKY.midnight).ambient);
    const dayA = Array.from(groundLight(SKY.noonday).ambient);
    const has = (all: number[][], v: number[]) =>
      all.some((a) => a.every((x, i) => Math.abs(x - v[i]) < 1e-6));
    expect(has(night, nightA)).toBe(true);
    expect(has(night, dayA)).toBe(false);
    expect(has(day, dayA)).toBe(true);
    search = '?sky=noonday';
    expect(has(uploaded({}), dayA)).toBe(true);
    search = '?sky=garbage';
    expect(has(uploaded({}), nightA)).toBe(true);
  });

  it.each(['day', 'dusk', 'night'] as const)(
    'uploads the %s band as uBand (floor, ceiling) and uLift, in the sky pass and the grid pass',
    (state) => {
      const { gl, calls } = fakeGl();
      const opts = terrainSkyFor(state);
      createTerrainScene({ canvas: canvasWith(gl), tier: 'still', ...opts })!.dispose();
      const { floor, ceiling, lift } = SKY_BAND[state];
      const pairs = calls.uniform2fv.filter(
        (a) =>
          Math.abs((a[1] as number[])[0] - floor) < 1e-6 &&
          Math.abs((a[1] as number[])[1] - ceiling) < 1e-6
      );
      expect(pairs).toHaveLength(2);
      const lifts = calls.uniform3fv.filter((a) =>
        Array.from(a[1] as ArrayLike<number>).every((x, i) => Math.abs(x - lift[i]) < 1e-6)
      );
      expect(lifts).toHaveLength(2);
    }
  );

  it('uploads no band (0, 1) and a zero lift without one', () => {
    const { gl, calls } = fakeGl();
    createTerrainScene({ canvas: canvasWith(gl), tier: 'still' })!.dispose();
    expect(calls.uniform2fv.filter((a) => (a[1] as number[])[1] === 1)).toHaveLength(2);
  });

  it('a sun elevation (option or ?sun=&az=) lights between the bakes, and wins over ?sky=', () => {
    const ambients = (opts: Record<string, unknown>) => {
      const { gl, calls } = fakeGl();
      createTerrainScene({ canvas: canvasWith(gl), tier: 'still', ...opts })!.dispose();
      return calls.uniform3fv.map((a) => Array.from(a[1] as ArrayLike<number>));
    };
    const dusk = skyAtSun(-1, 300);
    const has = (all: number[][], v: readonly number[]) =>
      all.some((a) => a.length === 3 && a.every((x, i) => Math.abs(x - v[i]) < 1e-6));
    expect(has(ambients({ sun: { elevation: -1, azimuth: 300 } }), groundLight(dusk).ambient)).toBe(
      true
    );
    search = '?sky=noonday&sun=-1&az=300';
    expect(has(ambients({}), groundLight(dusk).ambient)).toBe(true);
    search = '?sun=garbage';
    expect(has(ambients({}), groundLight(SKY.midnight).ambient)).toBe(true);
  });

  it('uploads the baked sky table and the aerial perspective volume once each, as half floats, to 3D textures', () => {
    const { gl, calls } = fakeGl();
    createTerrainScene({ canvas: canvasWith(gl), tier: 'full' })!.dispose();
    expect(calls.texImage3D).toHaveLength(2);
    const a = calls.texImage3D[0];
    expect([a[3], a[4], a[5]]).toEqual([SKY_VIEW.width, SKY_VIEW.height, SKY_VIEW.depth]);
    expect(a[9]).toEqual(skyViewWords());
    const ap = calls.texImage3D[1];
    expect([ap[3], ap[4], ap[5]]).toEqual([AP_VOLUME.width, AP_VOLUME.height, AP_VOLUME.depth]);
    expect(ap[9]).toEqual(apVolumeWords());
    expect(calls.deleteTexture).toHaveLength(3);
  });

  it('dithers the sky output by half an 8-bit step either way, and the terrain not at all', () => {
    expect(SKY_FRAG).toContain('- 0.5');
    expect(SKY_FRAG).toContain('dither / 255.0');
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
    expect(calls.deleteTexture).toHaveLength(3);
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

describe('stars in the terrain scene', () => {
  let overlays: any[];
  let arcs: number;
  const withOverlays = () => {
    overlays = [];
    arcs = 0;
    (document as any).createElement = () => {
      const el: any = {
        style: {},
        remove: vi.fn(),
        setAttribute() {},
        getContext: () => ({
          clearRect() {},
          beginPath() {},
          fill() {},
          arc: () => (arcs += 1),
        }),
      };
      overlays.push(el);
      return el;
    };
  };
  const scene = (sky: 'midnight' | 'noonday', tier: 'still' | 'low' = 'low') => {
    withOverlays();
    const canvas = canvasWith(fakeGl().gl);
    const s = createTerrainScene({ canvas, tier, sky })!;
    return { s, canvas };
  };

  it('a midnight sky gets one star overlay beside the canvas, painted with the terrain', () => {
    const { s, canvas } = scene('midnight');
    expect(overlays).toHaveLength(1);
    expect(canvas.parentElement.appendChild).toHaveBeenCalledWith(overlays[0]);
    rafQueue.shift()!(16);
    expect(arcs).toBeGreaterThan(0);
    s.dispose();
    expect(overlays[0].remove).toHaveBeenCalledOnce();
  });

  it('a noonday sky gets no overlay and paints no stars', () => {
    const { s } = scene('noonday');
    expect(overlays).toHaveLength(0);
    expect(arcs).toBe(0);
    s.dispose();
  });

  it("'still' paints the stars once at base and queues nothing", () => {
    const { s } = scene('midnight', 'still');
    expect(arcs).toBeGreaterThan(0);
    expect(rafQueue).toHaveLength(0);
    s.dispose();
  });

  it('a hidden tab or reduced motion paints no more stars than the first frame', () => {
    visibility = 'hidden';
    const { s } = scene('midnight');
    const n = arcs;
    expect(n).toBeGreaterThan(0);
    expect(rafQueue).toHaveLength(0); // the terrain loop never starts, so nothing repaints the stars
    s.dispose();
    visibility = 'visible';
    (window as any).matchMedia = () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    });
    const r = scene('midnight');
    expect(rafQueue).toHaveLength(0);
    expect(arcs).toBe(n);
    r.s.dispose();
  });

  it('stars turn with the terrain: a later frame is painted at a later heading', () => {
    let clock = 0;
    vi.stubGlobal('performance', { now: () => (clock += 1000) });
    const { s } = scene('midnight');
    rafQueue.shift()!(16);
    const first = arcs;
    rafQueue.shift()!(1000);
    expect(arcs).toBeGreaterThan(first);
    s.dispose();
  });
});
